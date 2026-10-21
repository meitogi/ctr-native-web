// A3 / A4 / A5 — scripted OnlineCTR clients.
//
// Three client processes (A = host, B, C), each running the real bridge
// (platform/native_online.c) over a real backend, on a stub game. The
// parent drives them in lockstep through a full room: join, names, track,
// characters, loading, race data, a weapon, C leaving mid-race, end of race,
// room reset. Assertions are on octr and on the stub game fields the bridge
// writes. Every client records the messages it receives; the traces of two
// runs are compared with --compare.
//
//   online_test --server <ctr_srv binary>   [--trace-dir D]  A3 / A4
//   online_test --loopback                  [--trace-dir D]  A5: A hosts sv_core in-process
//   online_test --compare <dirA> <dirB>                      trace equality

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#include "stub_game.h"
#include "../../platform/native_online.h"
#include "../../platform/native_online_loopback.h"
#include "../../platform/online_server/sv_enet.h"

int NativeOnlineEnet_LastReceivedReliable(void);
int NativeOnlineLoopback_LastReceivedReliable(void);

#define NUM_CLIENTS 3
#define MAX_TRACE 8192
#define TEST_ROOM 5 // item room: weapons are relayed

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
};

struct Cmd
{
	int op;
	int a, b, c, d;
};

struct Snapshot
{
	struct StubGame game;
	unsigned int frames;
	int traceCount;
};

struct TraceEntry
{
	int len;
	int reliable;
	unsigned char data[16];
};

// ===== client process =====

static struct TraceEntry trace[MAX_TRACE];
static int traceCount;
static int boolLoopbackHost;

// records every received message, then hands it to the bridge
static const OnlineTransport *inner;

static int Trace_Connect(const char *address) { return inner->connect(address); }
static void Trace_Send(const void *buf, int len, int reliable) { inner->send(buf, len, reliable); }
static void Trace_Disconnect(void) { inner->disconnect(); }

static int Trace_Poll(void *buf, int cap, int *event)
{
	int len = inner->poll(buf, cap, event);

	if (len >= 0 && *event == ONLINE_EVENT_DATA && traceCount < MAX_TRACE)
	{
		struct TraceEntry *e = &trace[traceCount++];
		e->len = len;
		e->reliable = boolLoopbackHost ? NativeOnlineLoopback_LastReceivedReliable() : NativeOnlineEnet_LastReceivedReliable();
		memcpy(e->data, buf, len < 16 ? len : 16);
	}
	return len;
}

static const OnlineTransport traceTransport = {Trace_Connect, Trace_Send, Trace_Poll, Trace_Disconnect};

static void WriteAll(int fd, const void *buf, size_t len)
{
	const char *p = buf;
	while (len > 0)
	{
		ssize_t n = write(fd, p, len);
		if (n < 0 && errno == EINTR) continue;
		if (n <= 0) _exit(90);
		p += n;
		len -= n;
	}
}

static int ReadAll(int fd, void *buf, size_t len)
{
	char *p = buf;
	while (len > 0)
	{
		ssize_t n = read(fd, p, len);
		if (n < 0 && errno == EINTR) continue;
		if (n <= 0) return -1;
		p += n;
		len -= n;
	}
	return 0;
}

static void DumpTrace(const char *path)
{
	FILE *f = fopen(path, "w");

	if (!f) _exit(91);
	for (int i = 0; i < traceCount; i++)
	{
		fprintf(f, "%d %d", trace[i].reliable, trace[i].len);
		for (int j = 0; j < trace[i].len && j < 16; j++)
			fprintf(f, " %02x", trace[i].data[j]);
		fprintf(f, "\n");
	}
	fclose(f);
}

static void HandleCmd(int fd, const struct Cmd *c, const char *tracePath)
{
	struct OnlineCTR *o = &stub.octr;

	switch (c->op)
	{
		case OP_QUERY:
		{
			struct Snapshot s;
			s.game = stub;
			s.frames = NativeOnline_FrameCount();
			s.traceCount = traceCount;
			WriteAll(fd, &s, sizeof(s));
			return;
		}
		case OP_PICK_SERVER: o->serverCountry = c->a; o->serverLockIn1 = 1; break;
		case OP_JOIN_ROOM: o->serverRoom = c->a; o->serverLockIn2 = 1; break;
		case OP_PICK_TRACK:
			o->levelID = c->a; o->lapID = c->b;
			o->boolLockedInLevel = 1; o->boolLockedInLap = 1;
			break;
		case OP_CHARACTER:
			stub.characterIDs[0] = c->a;
			o->boolLockedInCharacters[o->DriverID] = c->b;
			break;
		case OP_KART:
			stub.karts[0].posX = c->a; stub.karts[0].posY = c->b; stub.karts[0].posZ = c->c;
			stub.karts[0].angle = c->d;
			break;
		case OP_KART_ITEMS: stub.karts[0].numWumpas = c->a; stub.karts[0].reserves = c->b; break;
		case OP_HOLD: stub.localHeld = c->a; break;
		case OP_FIRE:
			o->Shoot[0].Weapon = c->a; o->Shoot[0].boolJuiced = c->b; o->Shoot[0].flags = c->c;
			o->Shoot[0].boolNow = 1;
			break;
		case OP_FINISH:
			stub.karts[0].courseTime = c->a; stub.karts[0].bestLapTime = c->b;
			o->CurrState = GAME_END_RACE; // OnlineEndOfRace
			break;
		case OP_DUMP:
			DumpTrace(tracePath);
			WriteAll(fd, c, sizeof(*c));
			_exit(0);
	}

	// ack
	WriteAll(fd, c, sizeof(*c));
}

static void ClientMain(int fd, int boolHost, int port, const char *tracePath, const char *playerName)
{
	char address[64];

	snprintf(address, sizeof(address), "127.0.0.1:%d", port);
	boolLoopbackHost = boolHost;

	if (boolHost)
	{
		if (SvEnet_Start(port) != 0)
			_exit(92);
		SvCore_Init(NativeOnlineLoopback_Wrap(SvEnet_CoreHost()));
		inner = &NativeOnline_LoopbackTransport;
	}
	else
		inner = &NativeOnline_EnetTransport;

	StubGame_Boot();
	NativeOnline_Configure(&traceTransport, playerName, address);

	fcntl(fd, F_SETFL, O_NONBLOCK);

	for (;;)
	{
		struct Cmd c;
		ssize_t n;

		while ((n = read(fd, &c, sizeof(c))) == (ssize_t)sizeof(c))
			HandleCmd(fd, &c, tracePath);
		if (n == 0)
			_exit(0);

		if (boolHost)
		{
			SvEnet_Service();
			SvCore_Tick(NativeOnlineGame_NowMs());
		}

		NativeOnline_Frame();
		StubGame_Frame();

		if (boolHost)
			SvEnet_Service();

		usleep(1000);
	}
}

// ===== parent: the script =====

static int fds[NUM_CLIENTS];
static pid_t pids[NUM_CLIENTS];
static pid_t serverPid;
static int failures;
static const char *names[NUM_CLIENTS] = {"A", "B", "C"};
static const char *playerNames[NUM_CLIENTS] = {"Alpha", "Bravo", "Charlie"};
static char traceDir[512] = ".";

static void Cleanup(void)
{
	for (int i = 0; i < NUM_CLIENTS; i++)
		if (pids[i] > 0)
			kill(pids[i], SIGKILL);
	if (serverPid > 0)
		kill(serverPid, SIGKILL);
}

static void Die(const char *fmt, ...)
{
	va_list args;
	va_start(args, fmt);
	printf("FATAL ");
	vprintf(fmt, args);
	va_end(args);
	printf("\n");
	Cleanup();
	exit(2);
}

static void Send(int i, int op, int a, int b, int c, int d)
{
	struct Cmd cmd = {op, a, b, c, d};
	struct Cmd ack;
	struct pollfd p = {fds[i], POLLIN, 0};

	WriteAll(fds[i], &cmd, sizeof(cmd));
	if (poll(&p, 1, 5000) <= 0 || ReadAll(fds[i], &ack, sizeof(ack)) != 0)
		Die("client %s did not ack op %d", names[i], op);
}

static void Query(int i, struct Snapshot *s)
{
	struct Cmd cmd = {OP_QUERY, 0, 0, 0, 0};
	struct pollfd p = {fds[i], POLLIN, 0};

	WriteAll(fds[i], &cmd, sizeof(cmd));
	if (poll(&p, 1, 5000) <= 0 || ReadAll(fds[i], s, sizeof(*s)) != 0)
		Die("client %s did not answer", names[i]);
}

typedef int (*Pred)(int i, const struct Snapshot *s, const void *arg);

// waits until pred holds for every client in mask
static void WaitFor(const char *what, int mask, Pred pred, const void *arg, int timeoutMs)
{
	unsigned int start = NativeOnlineGame_NowMs();
	struct Snapshot s;

	for (;;)
	{
		int ok = 1;
		for (int i = 0; i < NUM_CLIENTS; i++)
		{
			if (!(mask & (1 << i))) continue;
			Query(i, &s);
			if (!pred(i, &s, arg)) { ok = 0; break; }
		}
		if (ok)
		{
			printf("ok   %s (%u ms)\n", what, NativeOnlineGame_NowMs() - start);
			return;
		}
		if (NativeOnlineGame_NowMs() - start > (unsigned int)timeoutMs)
		{
			failures++;
			for (int i = 0; i < NUM_CLIENTS; i++)
			{
				if (!(mask & (1 << i))) continue;
				Query(i, &s);
				printf("     %s: CurrState %d DriverID %d NumDrivers %d frames %u trace %d\n", names[i],
					s.game.octr.CurrState, s.game.octr.DriverID, s.game.octr.NumDrivers, s.frames, s.traceCount);
			}
			Die("timeout waiting for: %s", what);
		}
		usleep(5000);
	}
}

static void Expect(int cond, const char *fmt, ...)
{
	va_list args;
	va_start(args, fmt);
	printf("%s ", cond ? "ok  " : "FAIL");
	vprintf(fmt, args);
	printf("\n");
	va_end(args);
	if (!cond) failures++;
}

static int P_State(int i, const struct Snapshot *s, const void *arg)
{
	(void)i;
	return s->game.octr.CurrState == *(const int *)arg;
}

static int P_StateAtLeast(int i, const struct Snapshot *s, const void *arg)
{
	(void)i;
	return s->game.octr.CurrState >= *(const int *)arg;
}

static int P_RoomCount(int i, const struct Snapshot *s, const void *arg)
{
	(void)i;
	return s->game.octr.clientCount[TEST_ROOM] == *(const int *)arg;
}

static int P_Names(int i, const struct Snapshot *s, const void *arg)
{
	int n = *(const int *)arg;
	(void)i;
	if (s->game.octr.NumDrivers != n) return 0;
	for (int k = 0; k < n; k++)
		if (s->game.octr.nameBuffer[k][0] == 0) return 0;
	return 1;
}

static const int expectedHeld = 0x410; // Cross + L1 from the wire's 0x50

// remote karts of every other client match what their owners hold
static int P_RemoteKarts(int i, const struct Snapshot *s, const void *arg)
{
	int alive = *(const int *)arg;
	for (int other = 0; other < alive; other++)
	{
		if (other == i) continue;
		int slot = other < i ? other + 1 : other;
		const struct NativeOnlineKart *k = &s->game.karts[slot];
		if (k->posX != (1000 + other) * 256 || k->posY != -(2 + other) * 256 || k->posZ != (300 + other) * 256)
			return 0;
		if (k->angle != 0xABC + other)
			return 0;
		if (s->game.pads[slot].held != expectedHeld)
			return 0;
	}
	return 1;
}

static int P_Shoot(int i, const struct Snapshot *s, const void *arg)
{
	(void)arg;
	// A is clientID 0, slot 1 on everybody else
	return i == 0 || s->game.octr.Shoot[1].boolNow == 1;
}

static int P_Left(int i, const struct Snapshot *s, const void *arg)
{
	(void)i; (void)arg;
	// C (clientID 2) is slot 2 for both A and B
	return s->game.octr.nameBuffer[2][0] == 0 && s->game.pads[2].held == 0x20;
}

static int P_Ended(int i, const struct Snapshot *s, const void *arg)
{
	(void)i;
	return s->game.octr.numDriversEnded == *(const int *)arg;
}

static int P_ResetRole(int i, const struct Snapshot *s, const void *arg)
{
	(void)arg;
	int want = i == 0 ? LOBBY_HOST_TRACK_PICK : LOBBY_GUEST_TRACK_WAIT;
	return s->game.octr.CurrState == want && s->game.octr.numDriversEnded == 0;
}

static int FreePort(void)
{
	return 20000 + (getpid() % 20000);
}

static void Spawn(int i, int boolHost, int port)
{
	int sv[2];
	char tracePath[600];

	if (socketpair(AF_UNIX, SOCK_STREAM, 0, sv) != 0)
		Die("socketpair");

	snprintf(tracePath, sizeof(tracePath), "%s/trace-%s.txt", traceDir, names[i]);

	pids[i] = fork();
	if (pids[i] == 0)
	{
		close(sv[0]);
		ClientMain(sv[1], boolHost, port, tracePath, playerNames[i]);
	}
	close(sv[1]);
	fds[i] = sv[0];
}

static int RunScript(const char *serverBin, int boolLoopback)
{
	int port = FreePort();
	int all = 7, ab = 3;
	int st;
	struct Snapshot s;

	// mkdir -p
	for (char *p = traceDir + 1; *p; p++)
		if (*p == '/')
		{
			*p = 0;
			mkdir(traceDir, 0755);
			*p = '/';
		}
	mkdir(traceDir, 0755);

	if (boolLoopback)
	{
		// A runs the server core in-process, reached over loopback ; B and C over ENet
		Spawn(0, 1, port);
		usleep(200000);
		Spawn(1, 0, port);
		Spawn(2, 0, port);
	}
	else
	{
		char portStr[16];
		snprintf(portStr, sizeof(portStr), "%d", port);
		serverPid = fork();
		if (serverPid == 0)
		{
			int devnull = open("/dev/null", O_WRONLY);
			dup2(devnull, 1);
			execl(serverBin, serverBin, "-p", portStr, (char *)NULL);
			_exit(93);
		}
		usleep(300000);
		for (int i = 0; i < NUM_CLIENTS; i++)
			Spawn(i, 0, port);
	}

	printf("== %s, port %d\n", boolLoopback ? "loopback host" : serverBin, port);

	// --- connect: room list ---
	st = LAUNCH_PICK_SERVER;
	WaitFor("boot -> LAUNCH_PICK_SERVER", all, P_State, &st, 3000);
	for (int i = 0; i < NUM_CLIENTS; i++)
		Send(i, OP_PICK_SERVER, 7, 0, 0, 0); // private server
	st = LAUNCH_PICK_ROOM;
	WaitFor("connected, room list received", all, P_State, &st, 10000);
	Query(1, &s);
	Expect(s.game.octr.numRooms == 16 && s.game.octr.ver_server == VERSION, "SG_ROOMS: 16 rooms, version %d", s.game.octr.ver_server);

	// --- join, one by one ---
	int one = 1, two = 2, three = 3;
	Send(0, OP_JOIN_ROOM, TEST_ROOM, 0, 0, 0);
	st = LOBBY_HOST_TRACK_PICK;
	WaitFor("A joins as host -> LOBBY_HOST_TRACK_PICK", 1, P_State, &st, 3000);
	WaitFor("room list shows 1 player", 6, P_RoomCount, &one, 3000);

	Send(1, OP_JOIN_ROOM, TEST_ROOM, 0, 0, 0);
	st = LOBBY_GUEST_TRACK_WAIT;
	WaitFor("B joins as guest", 2, P_State, &st, 3000);
	WaitFor("A and B see 2 names", ab, P_Names, &two, 3000);

	Send(2, OP_JOIN_ROOM, TEST_ROOM, 0, 0, 0);
	WaitFor("C joins as guest", 4, P_State, &st, 3000);
	WaitFor("everyone sees 3 names", all, P_Names, &three, 3000);

	for (int i = 0; i < NUM_CLIENTS; i++)
	{
		Query(i, &s);
		Expect(s.game.octr.DriverID == i, "%s: DriverID %d", names[i], s.game.octr.DriverID);
		Expect((s.game.gameMode2 & 0x100000) == 0, "%s: item room, no retro turbo pads", names[i]);
	}
	Query(0, &s);
	Expect(strcmp(s.game.octr.nameBuffer[0], "Alpha") == 0 && strcmp(s.game.octr.nameBuffer[1], "Bravo") == 0 &&
		strcmp(s.game.octr.nameBuffer[2], "Charlie") == 0,
		"A: names by slot %s, %s, %s", s.game.octr.nameBuffer[0], s.game.octr.nameBuffer[1], s.game.octr.nameBuffer[2]);
	Query(1, &s);
	Expect(strcmp(s.game.octr.nameBuffer[1], "Alpha") == 0 && strcmp(s.game.octr.nameBuffer[2], "Charlie") == 0,
		"B: host in slot 1 (%s), C in slot 2 (%s)", s.game.octr.nameBuffer[1], s.game.octr.nameBuffer[2]);

	// --- track ---
	Send(0, OP_PICK_TRACK, 3, 1, 0, 0); // track 3, lapID 1 = 3 laps
	st = LOBBY_CHARACTER_PICK;
	WaitFor("track picked -> everyone LOBBY_CHARACTER_PICK", all, P_State, &st, 3000);
	for (int i = 0; i < NUM_CLIENTS; i++)
	{
		Query(i, &s);
		Expect(s.game.octr.levelID == 3 && s.game.numLaps == 3, "%s: levelID %d, numLaps %d", names[i], s.game.octr.levelID, s.game.numLaps);
	}

	// --- characters ---
	for (int i = 0; i < NUM_CLIENTS; i++)
	{
		Send(i, OP_CHARACTER, 10 + i, 1, 0, 0);
		st = i < NUM_CLIENTS - 1 ? LOBBY_WAIT_FOR_LOADING : GAME_WAIT_FOR_RACE;
		WaitFor(i < NUM_CLIENTS - 1 ? "character locked" : "last lock -> SG_STARTLOADING -> loaded",
			1 << i, P_StateAtLeast, &st, 5000);
		usleep(50000);
	}
	st = GAME_WAIT_FOR_RACE;
	WaitFor("everyone loaded -> GAME_WAIT_FOR_RACE", all, P_StateAtLeast, &st, 5000);
	Query(0, &s);
	Expect(s.game.characterIDs[1] == 11 && s.game.characterIDs[2] == 12, "A: characters of slots 1, 2 = %d, %d",
		s.game.characterIDs[1], s.game.characterIDs[2]);
	Query(2, &s);
	Expect(s.game.characterIDs[1] == 10 && s.game.characterIDs[2] == 11, "C: characters of slots 1, 2 = %d, %d",
		s.game.characterIDs[1], s.game.characterIDs[2]);

	// --- race ---
	st = GAME_START_RACE;
	WaitFor("fly-in done -> CG_STARTRACE -> SG_STARTRACE", all, P_State, &st, 5000);

	for (int i = 0; i < NUM_CLIENTS; i++)
	{
		Send(i, OP_KART, (1000 + i) * 256 + 0x7f, -(2 + i) * 256, (300 + i) * 256, 0xABC + i);
		Send(i, OP_KART_ITEMS, 7, 300, 0, 0);
		Send(i, OP_HOLD, 0x10 | 0x400, 0, 0, 0); // Cross + L1
	}
	WaitFor("remote kart pose, angle and pad bits on every side", all, P_RemoteKarts, &three, 5000);

	// R7: a remote pad survives a frame of the game's own pad polling
	Query(0, &s);
	unsigned int f0 = s.frames;
	usleep(30000);
	Query(0, &s);
	Expect(s.frames > f0 && s.game.pads[1].held == expectedHeld && s.game.pads[1].stickLX == 0x80,
		"A: B's pad 0x%x survives %u frames, stick centred", s.game.pads[1].held, s.frames - f0);
	Expect(s.game.karts[1].reserves == 200 && s.game.karts[1].numWumpas == 7,
		"A: B's reserves %d (>200 sent as 200), wumpa %d", s.game.karts[1].reserves, s.game.karts[1].numWumpas);

	// --- weapon (item room) ---
	Send(0, OP_FIRE, 3, 1, 2, 0);
	WaitFor("A fires: B and C get Shoot[1]", 6, P_Shoot, NULL, 3000);
	Query(1, &s);
	Expect(s.game.octr.Shoot[1].Weapon == 3 && s.game.octr.Shoot[1].boolJuiced == 1 && s.game.octr.Shoot[1].flags == 2,
		"B: weapon 3, juiced, flags 2");

	// --- C leaves mid-race (SELECT) ---
	Send(2, OP_HOLD, 0x2000, 0, 0, 0);
	WaitFor("C leaves: A and B see an empty name, slot holds SQUARE", ab, P_Left, NULL, 5000);
	Query(1, &s);
	Expect(s.game.octr.CurrState == GAME_START_RACE, "B: race goes on (CurrState %d)", s.game.octr.CurrState);

	// --- end of race ---
	Send(0, OP_FINISH, 1000, 300, 0, 0);
	WaitFor("A ends: B gets SG_ENDRACE", 2, P_Ended, &one, 3000);
	Query(1, &s);
	Expect(s.game.octr.raceStats[0].slot == 1 && s.game.octr.raceStats[0].finalTime == 1000 &&
		s.game.octr.raceStats[0].bestLap == 300 && s.game.pads[1].held == 0x20,
		"B: raceStats[0] = slot %d, %d, %d ; A holds SQUARE", s.game.octr.raceStats[0].slot,
		s.game.octr.raceStats[0].finalTime, s.game.octr.raceStats[0].bestLap);
	Send(1, OP_FINISH, 1100, 310, 0, 0);
	WaitFor("both ended", ab, P_Ended, &two, 3000);

	// upstream: 6 s of CPU time ; sv_core: 6 s of wall time (R10)
	WaitFor("room reset -> SG_NEWCLIENT -> back to track pick", ab, P_ResetRole, NULL, 60000);

	// --- traces ---
	for (int i = 0; i < NUM_CLIENTS; i++)
		Send(i, OP_DUMP, 0, 0, 0, 0);
	for (int i = 0; i < NUM_CLIENTS; i++)
	{
		waitpid(pids[i], NULL, 0);
		pids[i] = 0;
	}
	Cleanup();

	printf("%s: %d failure(s)\n", failures ? "FAILED" : "PASSED", failures);
	return failures ? 1 : 0;
}

// ===== trace comparison (A4) =====

struct Msg
{
	int reliable, len;
	unsigned char b[16];
};

static int LoadTrace(const char *path, struct Msg *out, int max)
{
	FILE *f = fopen(path, "r");
	char line[256];
	int n = 0;

	if (!f)
		return -1;
	while (n < max && fgets(line, sizeof(line), f))
	{
		char *p = line;
		int off;
		struct Msg m = {0};
		if (sscanf(p, "%d %d%n", &m.reliable, &m.len, &off) != 2) continue;
		p += off;
		for (int j = 0; j < m.len && j < 16; j++)
		{
			unsigned int v;
			if (sscanf(p, " %x%n", &v, &off) != 1) break;
			m.b[j] = v;
			p += off;
		}
		out[n++] = m;
	}
	fclose(f);
	return n;
}

// Reliable messages must match exactly and in order, after three
// normalisations:
// - the 4 padding bits after `type` are masked: upstream sends SG_ROOMS and
//   the disconnect SG_NAME from uninitialised structs, so those bits are
//   stack garbage (no client reads them);
// - back-to-back identical SG_ROOMS (the 5 s refresh request) are collapsed;
// - a run of consecutive SG_NAME or SG_CHARACTER is compared as a set: those
//   answer messages several clients send in the same frame (entering the
//   character pick, the room reset), so their order is the network's.
// SG_RACEDATA is unreliable and its count depends on timing: it is checked
// to be unsequenced and present on both sides.
static int CmpMsg(const void *x, const void *y)
{
	return memcmp(x, y, sizeof(struct Msg));
}

static void SortRuns(struct Msg *m, int n)
{
	for (int i = 0; i < n;)
	{
		int type = m[i].b[0] & 0xf, j = i + 1;
		if (type != SG_NAME && type != SG_CHARACTER) { i++; continue; }
		while (j < n && (m[j].b[0] & 0xf) == type) j++;
		qsort(&m[i], j - i, sizeof(struct Msg), CmpMsg);
		i = j;
	}
}

static int CompareClient(const char *dirA, const char *dirB, const char *name)
{
	static struct Msg a[MAX_TRACE], b[MAX_TRACE];
	struct Msg ra[MAX_TRACE / 2], rb[MAX_TRACE / 2];
	char pa[600], pb[600];
	int na, nb, nra = 0, nrb = 0, bad = 0;
	int raceA = 0, raceB = 0, unreliableA = 0, unreliableB = 0;

	snprintf(pa, sizeof(pa), "%s/trace-%s.txt", dirA, name);
	snprintf(pb, sizeof(pb), "%s/trace-%s.txt", dirB, name);
	na = LoadTrace(pa, a, MAX_TRACE);
	nb = LoadTrace(pb, b, MAX_TRACE);
	if (na < 0 || nb < 0)
	{
		printf("FAIL %s: missing trace\n", name);
		return 1;
	}

	for (int pass = 0; pass < 2; pass++)
	{
		struct Msg *src = pass ? b : a, *dst = pass ? rb : ra;
		int n = pass ? nb : na, *nd = pass ? &nrb : &nra;
		int *race = pass ? &raceB : &raceA, *unrel = pass ? &unreliableB : &unreliableA;
		for (int i = 0; i < n; i++)
		{
			int type = src[i].b[0] & 0xf;
			if (type == SG_RACEDATA)
			{
				(*race)++;
				if (src[i].reliable) (*unrel)--;
				continue;
			}
			if (!src[i].reliable) (*unrel)++;
			if (type == SG_ROOMS || type == SG_NAME || type == SG_TRACK || type == SG_STARTLOADING || type == SG_STARTRACE)
				src[i].b[0] &= 0x0f;
			if (type == SG_ROOMS && *nd > 0 && (dst[*nd - 1].b[0] & 0xf) == SG_ROOMS &&
				memcmp(&dst[*nd - 1], &src[i], sizeof(struct Msg)) == 0)
				continue;
			dst[(*nd)++] = src[i];
		}
	}

	SortRuns(ra, nra);
	SortRuns(rb, nrb);

	if (nra != nrb)
		bad = 1;
	for (int i = 0; i < nra && i < nrb; i++)
		if (memcmp(&ra[i], &rb[i], sizeof(struct Msg)) != 0)
		{
			printf("     %s: first difference at reliable message %d (types %d / %d)\n", name, i, ra[i].b[0] & 0xf, rb[i].b[0] & 0xf);
			bad = 1;
			break;
		}

	// unreliable means exactly SG_RACEDATA, on both sides
	if (unreliableA || unreliableB || raceA == 0 || raceB == 0)
		bad = 1;

	printf("%s %s: %d / %d control messages, SG_RACEDATA %d / %d (unsequenced)\n",
		bad ? "FAIL" : "ok  ", name, nra, nrb, raceA, raceB);
	return bad;
}

int main(int argc, char **argv)
{
	const char *serverBin = NULL;
	int boolLoopback = 0;

	setvbuf(stdout, NULL, _IONBF, 0);
	signal(SIGPIPE, SIG_IGN);

	for (int i = 1; i < argc; i++)
	{
		if (strcmp(argv[i], "--server") == 0 && i + 1 < argc) serverBin = argv[++i];
		else if (strcmp(argv[i], "--loopback") == 0) boolLoopback = 1;
		else if (strcmp(argv[i], "--trace-dir") == 0 && i + 1 < argc) snprintf(traceDir, sizeof(traceDir), "%s", argv[++i]);
		else if (strcmp(argv[i], "--compare") == 0 && i + 2 < argc)
		{
			int bad = 0;
			for (int k = 0; k < NUM_CLIENTS; k++)
				bad |= CompareClient(argv[i + 1], argv[i + 2], names[k]);
			printf("%s\n", bad ? "FAILED: traces differ" : "PASSED: traces equal");
			return bad;
		}
	}

	if (!serverBin && !boolLoopback)
	{
		fprintf(stderr, "usage: %s --server <bin> | --loopback | --compare <dirA> <dirB> [--trace-dir D]\n", argv[0]);
		return 2;
	}

	return RunScript(serverBin, boolLoopback);
}
