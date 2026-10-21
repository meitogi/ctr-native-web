// Browser backend of the OnlineCTR client bridge, and the host's server.
//
// Guest: connect() asks the page to open its link to the room's host
// (web/net/, WebRTC or WebSocket through ctr-relay). Host: the server core
// (sv_core.c) runs here, fed by the guests' links through the same JS queue,
// and the host's own client reaches it over the loopback backend.
//
// D6: JS network callbacks never call into wasm. They push
// {peer, event, bytes, reliable} into a JS queue (web/online/net.js), which
// poll() drains ; send() / kick() are synchronous calls into JS.
// docs/ONLINECTR_PORT.md, D3, D4, D6, and "Session 9 findings".

#include <stddef.h>
#include <string.h>

#define WINDOWS_INCLUDE
#include "../game/OnlineCTR/global.h"

#include "native_online.h"
#include "native_online_game.h"
#include "native_online_loopback.h"
#include "web_online_transport.h"

#define WEB_ONLINE_MAX_PACKET 64

enum WebOnlineRole
{
	WEB_ROLE_NONE,
	WEB_ROLE_HOST,
	WEB_ROLE_GUEST,
};

// web/online/library.js
extern void ctr_web_online_init(void *octrStorage, const int *layout, int layoutLen, const int *karts);
extern int ctr_web_online_role(char *name, int cap);
extern int ctr_web_online_connect(void);
extern void ctr_web_online_disconnect(void);
extern void ctr_web_online_send(int peer, const void *buf, int len, int reliable);
extern void ctr_web_online_kick(int peer);
// info: peer, event, reliable, address key low, address key high
extern int ctr_web_online_poll(void *buf, int cap, int *info);

static const OnlineTransport *active;
static const OnlineTransport *bridgeTransport = &WebOnline_Transport;
static int boolHost;
static int boolServerStarted;
static int boolServicedOnce;
static unsigned int servicedFrame;
static unsigned int sampledFrame;

// For the page's debug getter, sampled at the first poll of each bridge frame,
// that is after the game's own pad polling of that frame (R7): bridge frame
// count, then per driver slot: exists, posX, posY, posZ, angle, pad held.
#define WEB_KART_FIELDS 6
static int karts[1 + MAX_NUM_PLAYERS * WEB_KART_FIELDS];

static void SampleKarts(void)
{
	unsigned int frame = NativeOnline_FrameCount();
	struct NativeOnlineKart k;

	if (frame == sampledFrame)
		return;
	sampledFrame = frame;

	karts[0] = (int)frame;
	for (int slot = 0; slot < MAX_NUM_PLAYERS; slot++)
	{
		int *out = &karts[1 + slot * WEB_KART_FIELDS];
		out[0] = NativeOnlineGame_GetKart(slot, &k);
		out[1] = out[0] ? k.posX : 0;
		out[2] = out[0] ? k.posY : 0;
		out[3] = out[0] ? k.posZ : 0;
		out[4] = out[0] ? k.angle : 0;
		out[5] = NativeOnlineGame_PadHeld(slot);
	}
}

// === host: the server core's side of the guests' links ===

static void WebHost_Send(int peerId, const void *buf, int len, int reliable)
{
	ctr_web_online_send(peerId, buf, len, reliable);
}

static void WebHost_Kick(int peerId)
{
	ctr_web_online_kick(peerId);
}

// No setTimeout: a dead guest is its link closing (WebRTC connection
// failed, WebSocket bye or the relay's peer list), not an ENet idle timer.
static const SvCoreHost webCoreHost = {
	WebHost_Send,
	WebHost_Kick,
	NULL,
	NativeOnlineGame_Log,
};

// The guests' events into the core, then one tick ; once per bridge frame
// (D4), whichever poll() of that frame comes first.
static void WebHost_Service(void)
{
	unsigned char packet[WEB_ONLINE_MAX_PACKET];
	unsigned int frame = NativeOnline_FrameCount();
	int info[5];
	int len;

	if (boolServicedOnce && frame == servicedFrame)
		return;
	boolServicedOnce = 1;
	servicedFrame = frame;

	while ((len = ctr_web_online_poll(packet, sizeof(packet), info)) >= 0)
	{
		switch (info[1])
		{
			case ONLINE_EVENT_CONNECTED:
				SvCore_Connect(info[0],
					((unsigned long long)(unsigned int)info[4] << 32) | (unsigned int)info[3]);
				break;

			case ONLINE_EVENT_DATA:
				SvCore_Receive(info[0], packet, len);
				break;

			case ONLINE_EVENT_DISCONNECTED:
				SvCore_Disconnect(info[0]);
				break;

			default:
				break;
		}
	}

	SvCore_Tick(NativeOnlineGame_NowMs());
}

// === guest: the link to the room's host ===

static int WebGuest_Connect(const char *address)
{
	(void)address;
	return ctr_web_online_connect();
}

static void WebGuest_Send(const void *buf, int len, int reliable)
{
	ctr_web_online_send(-1, buf, len, reliable);
}

static int WebGuest_Poll(void *buf, int cap, int *event)
{
	int info[5];
	int len = ctr_web_online_poll(buf, cap, info);

	*event = len < 0 ? ONLINE_EVENT_NONE : info[1];
	return len;
}

static const OnlineTransport webGuestTransport = {
	WebGuest_Connect,
	WebGuest_Send,
	WebGuest_Poll,
	ctr_web_online_disconnect,
};

// === the transport the bridge is configured with ===

static int Web_Connect(const char *address)
{
	char name[NAME_LEN + 1];
	int role;

	if (strcmp(address, WEB_ONLINE_ROOM_ADDRESS) != 0)
	{
		NativeOnlineGame_Log("[OnlineCTR] %s: public servers are not reachable from the browser, pick Private Room\n", address);
		return -1;
	}

	memset(name, 0, sizeof(name));
	role = ctr_web_online_role(name, sizeof(name));
	if (role == WEB_ROLE_NONE)
	{
		NativeOnlineGame_Log("[OnlineCTR] No room: host one or open a room link in the Online panel\n");
		return -1;
	}

	// the name may change in the panel until the player connects
	NativeOnline_Configure(bridgeTransport, name, NULL);

	boolHost = role == WEB_ROLE_HOST;
	if (boolHost)
	{
		if (!boolServerStarted)
		{
			SvCore_Init(NativeOnlineLoopback_Wrap(&webCoreHost));
			boolServerStarted = 1;
		}
		active = &NativeOnline_LoopbackTransport;
	}
	else
		active = &webGuestTransport;

	return active->connect(address);
}

static void Web_Send(const void *buf, int len, int reliable)
{
	if (active)
		active->send(buf, len, reliable);
}

static int Web_Poll(void *buf, int cap, int *event)
{
	*event = ONLINE_EVENT_NONE;
	if (!active)
		return -1;

	SampleKarts();
	if (boolHost)
		WebHost_Service();

	return active->poll(buf, cap, event);
}

static void Web_Disconnect(void)
{
	if (active)
		active->disconnect();
}

const OnlineTransport WebOnline_Transport = {
	Web_Connect,
	Web_Send,
	Web_Poll,
	Web_Disconnect,
};

void WebOnline_SetBridgeTransport(const OnlineTransport *t)
{
	bridgeTransport = t;
	NativeOnline_Configure(t, NULL, WEB_ONLINE_ROOM_ADDRESS);
}

// The bridge has no transport until something configures it, and nothing
// in game/ or main.c knows about the browser: install it before main().
__attribute__((constructor)) static void WebOnline_Install(void)
{
	struct OnlineCTR *o = NativeOnlineGame_Octr();

	// byte offsets the page's debug getter reads octr with (web/online/library.js)
	static const int layout[] = {
		offsetof(struct OnlineCTR, CurrState),
		offsetof(struct OnlineCTR, NumDrivers),
		offsetof(struct OnlineCTR, DriverID),
		offsetof(struct OnlineCTR, levelID),
		offsetof(struct OnlineCTR, numRooms),
		offsetof(struct OnlineCTR, numDriversEnded),
		offsetof(struct OnlineCTR, serverCountry),
		offsetof(struct OnlineCTR, serverRoom),
		offsetof(struct OnlineCTR, boolClientBusy),
		offsetof(struct OnlineCTR, clientCount),
		offsetof(struct OnlineCTR, windowsClientSync),
		offsetof(struct OnlineCTR, nameBuffer),
		NAME_LEN + 1,
		MAX_NUM_PLAYERS,
	};

	NativeOnline_Configure(&WebOnline_Transport, NULL, WEB_ONLINE_ROOM_ADDRESS);
	ctr_web_online_init(o, layout, (int)(sizeof(layout) / sizeof(layout[0])), karts);
}
