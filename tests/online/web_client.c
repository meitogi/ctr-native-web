// One scripted OnlineCTR client in wasm, for web/online/test/wasm-room.test.mjs:
// the real bridge (platform/native_online.c) on the stub game, configured with
// the browser transport (platform/web_online_transport.c + web/online/), so
// the host instance runs sv_core.c behind the loopback backend and the guest
// instances reach it through a JS room. The script itself is online_test.c's,
// ported to JS ; the ops below are its ops.
//
// Like the game, the loop runs every frame and yields with emscripten_sleep()
// (ASYNCIFY) : the network delivers into the JS queue while the wasm sleeps.

#include <stdio.h>
#include <string.h>

#include <emscripten.h>

#include "stub_game.h"
#include "../../platform/native_online.h"
#include "../../platform/web_online_transport.h"

int NativeOnlineLoopback_LastReceivedReliable(void);

enum Op
{
	OP_QUERY,
	OP_PICK_SERVER,
	OP_JOIN_ROOM,
	OP_PICK_TRACK,
	OP_CHARACTER,
	OP_KART,
	OP_KART_ITEMS,
	OP_HOLD,
	OP_FIRE,
	OP_FINISH,
	OP_DUMP,
	OP_SLEEP, // web only: one frame that sleeps a ms while the network delivers
};

// next script command, 0 when there is none
EM_JS(int, webtest_next_cmd, (int *cmd), {
	const c = Module.cmds.shift();
	if (!c) return 0;
	HEAP32.set(c, cmd >> 2);
	return 1;
});

EM_JS(void, webtest_trace, (int reliable, const void *buf, int len), {
	Module.trace.push({ reliable, bytes: HEAPU8.slice(buf, buf + len) });
});

EM_JS(void, webtest_publish, (const char *json), {
	Module.snapshot = JSON.parse(UTF8ToString(json));
	Module.onFrame?.();
});

// the test ends by clearing Module.running ; node exits once main returns
EM_JS(int, webtest_running, (void), {
	return Module.running !== false;
});

// ms each frame sleeps: 1 by default, the game's 33 when a real network carries it
EM_JS(int, webtest_frame_ms, (void), {
	return Module.frameMs ?? 1;
});

EM_JS(int, webtest_is_host, (void), {
	return Module.ctrOnlineNet.role === 'host';
});

// records every received message, then hands it to the bridge
static int boolHost;

static int Trace_Connect(const char *address) { return WebOnline_Transport.connect(address); }
static void Trace_Send(const void *buf, int len, int reliable) { WebOnline_Transport.send(buf, len, reliable); }
static void Trace_Disconnect(void) { WebOnline_Transport.disconnect(); }

static int Trace_Poll(void *buf, int cap, int *event)
{
	int len = WebOnline_Transport.poll(buf, cap, event);

	// a guest's reliability is the link's channel: the JS test fills it in
	if (len >= 0 && *event == ONLINE_EVENT_DATA)
		webtest_trace(boolHost ? NativeOnlineLoopback_LastReceivedReliable() : -1, buf, len < 16 ? len : 16);
	return len;
}

static const OnlineTransport traceTransport = {Trace_Connect, Trace_Send, Trace_Poll, Trace_Disconnect};

static void HandleCmd(const int *c)
{
	struct OnlineCTR *o = &stub.octr;

	switch (c[0])
	{
		case OP_PICK_SERVER: o->serverCountry = c[1]; o->serverLockIn1 = 1; break;
		case OP_JOIN_ROOM: o->serverRoom = c[1]; o->serverLockIn2 = 1; break;
		case OP_PICK_TRACK:
			o->levelID = c[1]; o->lapID = c[2];
			o->boolLockedInLevel = 1; o->boolLockedInLap = 1;
			break;
		case OP_CHARACTER:
			stub.characterIDs[0] = c[1];
			o->boolLockedInCharacters[o->DriverID] = c[2];
			break;
		case OP_KART:
			stub.karts[0].posX = c[1]; stub.karts[0].posY = c[2]; stub.karts[0].posZ = c[3];
			stub.karts[0].angle = c[4];
			break;
		case OP_KART_ITEMS: stub.karts[0].numWumpas = c[1]; stub.karts[0].reserves = c[2]; break;
		case OP_HOLD: stub.localHeld = c[1]; break;
		case OP_FIRE:
			o->Shoot[0].Weapon = c[1]; o->Shoot[0].boolJuiced = c[2]; o->Shoot[0].flags = c[3];
			o->Shoot[0].boolNow = 1;
			break;
		case OP_FINISH:
			stub.karts[0].courseTime = c[1]; stub.karts[0].bestLapTime = c[2];
			o->CurrState = GAME_END_RACE; // OnlineEndOfRace
			break;
		case OP_SLEEP: emscripten_sleep(c[1]); break;
		default: break;
	}
}

static char json[8192];

static void Publish(void)
{
	const struct OnlineCTR *o = &stub.octr;
	int n = 0;

#define PUT(...) n += snprintf(json + n, sizeof(json) - n, __VA_ARGS__)
	PUT("{\"frames\":%u,\"CurrState\":%d,\"DriverID\":%d,\"NumDrivers\":%d,\"numRooms\":%d,\"ver_server\":%d,",
		NativeOnline_FrameCount(), o->CurrState, o->DriverID, o->NumDrivers, o->numRooms, o->ver_server);
	PUT("\"serverLockIn1\":%d,\"boolClientBusy\":%d,", o->serverLockIn1, o->boolClientBusy);
	PUT("\"levelID\":%d,\"lapID\":%d,\"numLaps\":%d,\"gameMode2\":%d,\"numDriversEnded\":%d,",
		o->levelID, o->lapID, stub.numLaps, stub.gameMode2, o->numDriversEnded);
	PUT("\"clientCount\":[");
	for (int i = 0; i < 16; i++) PUT("%s%d", i ? "," : "", o->clientCount[i]);
	PUT("],\"names\":[");
	for (int i = 0; i < 8; i++) PUT("%s\"%.9s\"", i ? "," : "", o->nameBuffer[i]);
	PUT("],\"characterIDs\":[");
	for (int i = 0; i < 8; i++) PUT("%s%d", i ? "," : "", stub.characterIDs[i]);
	PUT("],\"karts\":[");
	for (int i = 0; i < 8; i++)
	{
		const struct NativeOnlineKart *k = &stub.karts[i];
		PUT("%s{\"posX\":%d,\"posY\":%d,\"posZ\":%d,\"angle\":%d,\"numWumpas\":%d,\"reserves\":%d}", i ? "," : "",
			k->posX, k->posY, k->posZ, k->angle, k->numWumpas, k->reserves);
	}
	PUT("],\"pads\":[");
	for (int i = 0; i < 8; i++)
		PUT("%s{\"held\":%d,\"stickLX\":%d}", i ? "," : "", stub.pads[i].held, stub.pads[i].stickLX);
	PUT("],\"shoot\":[");
	for (int i = 0; i < 8; i++)
		PUT("%s{\"Weapon\":%d,\"boolJuiced\":%d,\"flags\":%d,\"boolNow\":%d}", i ? "," : "",
			o->Shoot[i].Weapon, o->Shoot[i].boolJuiced, o->Shoot[i].flags, o->Shoot[i].boolNow);
	PUT("],\"raceStats0\":{\"slot\":%d,\"finalTime\":%d,\"bestLap\":%d}}",
		o->raceStats[0].slot, o->raceStats[0].finalTime, o->raceStats[0].bestLap);
#undef PUT

	webtest_publish(json);
}

int main(void)
{
	int cmd[5];

	boolHost = webtest_is_host();

	StubGame_Boot();
	WebOnline_SetBridgeTransport(&traceTransport);

	while (webtest_running())
	{
		while (webtest_next_cmd(cmd))
			HandleCmd(cmd);

		NativeOnline_Frame();
		StubGame_Frame();
		Publish();

		emscripten_sleep(webtest_frame_ms());
	}
	return 0;
}
