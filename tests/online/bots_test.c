// The host's bots as virtual clients of its own server core (session 23,
// docs/ONLINECTR_PORT.md, D11) : what the guests receive, with sv_core.c
// unchanged. A host (peer 10) and two guests (11, 12) in room 5 ; the bots
// fill the room up to 8 ; a guest leaves mid-race and a bot keeps its kart ;
// after the room's reset the bots and the kept peer leave.

#include <stdio.h>
#include <string.h>

#include "stub_game.h"
#include "../../platform/native_online.h"
#include "../../platform/native_online_bots.h"

#define HOST 10
#define GUEST_B 11
#define GUEST_C 12
#define LATE 13

static const NativeOnlineBotHooks *hooks;
void NativeOnline_SetBotHooks(const NativeOnlineBotHooks *h) { hooks = h; }

// what each real peer received
static struct Received
{
	int names[8];         // SG_NAME : 1 named, -1 emptied, 0 none
	char name[8][NAME_LEN + 1];
	int characters[8];    // SG_CHARACTER : characterID + 1 when locked
	int raceData[8];      // SG_RACEDATA count per clientID
	int lastHold[8];
	int weapons[8];
	int ends[8];
	int endOrder[8], endTime[8], numEnds; // SG_ENDRACE in arrival order : clientID, courseTime
	int newClient, startLoading, startRace;
	int roomCount5;       // SG_ROOMS : room 5's count (+8 when locked)
} rx[SV_CORE_MAX_PEERS];

static int kicked[SV_CORE_MAX_PEERS];
static int failures;

static void Fail(const char *what)
{
	printf("FAILED: %s\n", what);
	failures++;
}

static void Record(int peerId, const void *buf, int len, int reliable)
{
	struct Received *r = &rx[peerId];
	(void)len;
	(void)reliable;

	switch (((const struct SG_Header *)buf)->type)
	{
		case SG_ROOMS: r->roomCount5 = ((const struct SG_MessageRooms *)buf)->numClients06; break;
		case SG_NEWCLIENT: r->newClient++; break;
		case SG_NAME:
		{
			const struct SG_MessageName *m = buf;
			r->names[m->clientID] = m->name[0] ? 1 : -1;
			memcpy(r->name[m->clientID], m->name, NAME_LEN);
			break;
		}
		case SG_CHARACTER:
		{
			const struct SG_MessageCharacter *m = buf;
			r->characters[m->clientID] = m->boolLockedIn ? m->characterID + 1 : 0;
			break;
		}
		case SG_STARTLOADING: r->startLoading++; break;
		case SG_STARTRACE: r->startRace++; break;
		case SG_RACEDATA:
		{
			const struct SG_EverythingKart *m = buf;
			r->raceData[m->clientID]++;
			r->lastHold[m->clientID] = m->buttonHold;
			break;
		}
		case SG_WEAPON: r->weapons[((const struct SG_MessageWeapon *)buf)->clientID]++; break;
		case SG_ENDRACE:
		{
			const struct SG_MessageEndRace *m = buf;
			r->ends[m->clientID]++;
			if (r->numEnds < 8)
			{
				r->endOrder[r->numEnds] = m->clientID;
				r->endTime[r->numEnds++] = m->courseTime;
			}
			break;
		}
		default: break;
	}
}

static void Kick(int peerId) { kicked[peerId] = 1; }
static void NoLog(const char *fmt, ...) { (void)fmt; }

static void Send(int peer, const void *msg, int len) { SvCore_Receive(peer, msg, len); }

static void Join(int peer, const char *name)
{
	struct CG_MessageRoom mr = {0};
	struct CG_MessageName mn = {0};

	SvCore_Connect(peer, 1000 + peer);
	mr.type = CG_JOINROOM;
	mr.room = 5;
	Send(peer, &mr, sizeof(mr));
	mn.type = CG_NAME;
	strncpy(mn.name, name, NAME_LEN);
	Send(peer, &mn, sizeof(mn));
}

static void Lock(int peer, int character)
{
	struct CG_MessageCharacter mc = {0};
	mc.type = CG_CHARACTER;
	mc.characterID = character;
	mc.boolLockedIn = 1;
	Send(peer, &mc, sizeof(mc));
}

static void Header(int peer, int type)
{
	struct CG_Header h = {0};
	h.type = type;
	Send(peer, &h, sizeof(h));
}

int main(void)
{
	static const SvCoreHost inner = {Record, Kick, NULL, NoLog};
	struct OnlineCTR *o = &stub.octr;
	unsigned int now = 1000;

	StubGame_Boot();
	SvCore_Init(NativeOnlineBots_Wrap(&inner));
	if (!hooks)
		Fail("the wrapper registered no bridge hooks");

	// the lobby : three humans, the host on ONLINE > ARCADE with P1-P3
	Join(HOST, "Host");
	Join(GUEST_B, "Bea");
	Join(GUEST_C, "Cal");
	strcpy(o->nameBuffer[0], "Host");
	strcpy(o->nameBuffer[1], "Bea");
	strcpy(o->nameBuffer[2], "Cal");
	stub.lobbyBots = 1;
	stub.lobbyCharacters[0] = 2;
	stub.lobbyCharacters[1] = 5;
	stub.lobbyCharacters[2] = 0;
	stub.lobbyCharacters[3] = -1;

	// the track lock : the bots enter before CG_TRACK, lock after it
	hooks->join();
	{
		struct CG_MessageTrack mt = {0};
		mt.type = CG_TRACK;
		mt.trackID = 3;
		mt.lapID = 1;
		Send(HOST, &mt, sizeof(mt));
	}
	hooks->lock();

	if (stub.hostBots != 0xf8) { printf("  hostBots 0x%x\n", stub.hostBots); Fail("five bots in clientIDs 3-7"); }
	{
		static const int want[8] = {0, 0, 0, 1 + 1, 3 + 1, 4 + 1, 6 + 1, 7 + 1}; // the base 8 minus 2, 5, 0
		for (int id = 3; id < 8; id++)
		{
			char expect[16];
			snprintf(expect, sizeof(expect), "Bot%d", want[id] - 1);
			if (rx[GUEST_C].names[id] != 1 || strcmp(rx[GUEST_C].name[id], expect) != 0)
			{
				printf("  clientID %d : name %s\n", id, rx[GUEST_C].name[id]);
				Fail("a guest gets each bot's SG_NAME, its character's name");
			}
			if (rx[GUEST_B].characters[id] != want[id])
			{
				printf("  clientID %d : character %d\n", id, rx[GUEST_B].characters[id] - 1);
				Fail("a guest gets each bot's SG_CHARACTER, locked, the characters the humans left");
			}
		}
	}

	// the humans lock : the room loads ; the bots need nothing more
	Lock(HOST, 2);
	Lock(GUEST_B, 5);
	Lock(GUEST_C, 0);
	SvCore_Tick(now);
	if (rx[GUEST_C].startLoading != 1)
		Fail("SG_STARTLOADING once the humans locked");

	// the race : the host's game has the 8 karts, the fly-in over
	o->CurrState = GAME_WAIT_FOR_RACE;
	stub.loadingStage = -1;
	stub.gameMode1 = 0;
	for (int s = 0; s < 8; s++)
	{
		stub.kartExists[s] = 1;
		stub.karts[s].posX = s * 25600;
		stub.karts[s].angle = 100;
	}
	hooks->frame(); // CG_STARTRACE + the first kart states
	stub.karts[4].angle = 140; // turning one way
	stub.botShot[4] = 2;
	hooks->frame();
	Header(HOST, CG_STARTRACE);
	Header(GUEST_B, CG_STARTRACE);
	Header(GUEST_C, CG_STARTRACE);
	SvCore_Tick(now += 16);
	if (rx[GUEST_C].startRace != 1)
		Fail("SG_STARTRACE : the bots sent their CG_STARTRACE");
	for (int id = 3; id < 8; id++)
		if (rx[GUEST_C].raceData[id] != 2)
			Fail("a guest gets every bot's kart state each frame");
	if (rx[GUEST_C].weapons[4] != 1)
		Fail("a bot's shot reaches the guests as SG_WEAPON");
	if ((rx[GUEST_C].lastHold[4] & 0x10) == 0 || (rx[GUEST_C].lastHold[4] & 0xc) == 0)
		Fail("a bot's pad on the wire : Cross, and a direction while it turns");

	// guest B leaves mid-race : a bot keeps its kart, nobody hears of it
	if (!NativeOnlineBots_TakeOver(GUEST_B))
		Fail("the leaver's peer is taken over");
	if (!stub.takenOver[1] || (stub.hostBots & 2) == 0)
		Fail("the host's game converts the leaver's kart (slot 1)");
	hooks->frame();
	if (rx[GUEST_C].names[1] != 1)
		Fail("the other guest never gets the leaver's empty SG_NAME");
	if (rx[GUEST_C].raceData[1] != 1)
		Fail("the leaver's kart goes on sending kart states, from the host's AI");

	// the host's skip mid-race does nothing (session 32d)
	{
		int before = rx[GUEST_C].newClient;
		SvCore_SkipReset();
		SvCore_Tick(now += 16);
		if (rx[GUEST_C].newClient != before)
			Fail("a skip mid-race leaves the race alone");
	}

	// the end : every kart finishes, each bot's CG_ENDRACE once. The bots of slots 3-7 were
	// ended where they stood (session 32c) with estimates out of slot order : their ends go
	// out in estimate order, with those times ; the leaver's kart (slot 1) crossed the line
	for (int s = 1; s < 8; s++)
		stub.kartFinished[s] = 1;
	stub.raceClock = 123456;
	{
		const int estimate[8] = {0, 0, 0, 150000, 140000, 170000, 130000, 160000};
		for (int s = 3; s < 8; s++)
			stub.botEndTime[s] = estimate[s];
	}
	if (NativeOnlineBots_TakeOver(GUEST_C))
		Fail("a guest who finished is not taken over when it leaves");
	for (int f = 0; f < 6; f++) // one estimated end a frame at most, the earliest first
		hooks->frame();
	{
		struct CG_MessageEndRace e = {0};
		e.type = CG_ENDRACE;
		Send(HOST, &e, sizeof(e));
		Send(GUEST_C, &e, sizeof(e));
	}
	for (int id = 1; id < 8; id++)
		if (id != 2 && rx[GUEST_C].ends[id] != 1)
		{
			printf("  clientID %d : %d ends\n", id, rx[GUEST_C].ends[id]);
			Fail("one SG_ENDRACE per bot and for the taken-over kart");
		}
	{
		int last = 0, estimated = 0;
		for (int k = 0; k < rx[GUEST_C].numEnds; k++)
		{
			int id = rx[GUEST_C].endOrder[k], t = rx[GUEST_C].endTime[k];
			if (id < 3) // the leaver's real finish (clientID 1 = slot 1), the host, guest C
				continue;
			estimated++;
			if (t != stub.botEndTime[id] || t <= last)
			{
				printf("  end %d : clientID %d at %d (estimate %d, previous %d)\n", k, id, t, stub.botEndTime[id], last);
				Fail("the bots ended where they stood arrive in their estimates' order, with those times");
			}
			last = t;
		}
		if (estimated != 5)
			Fail("five estimated bot ends");
	}
	memset(stub.botEndTime, 0, sizeof(stub.botEndTime));

	// the room's reset, 6 s after or at once when the host skips the wait (session 32d) : the
	// bots and the kept peer leave on the next frame
	SvCore_Tick(now += 16); // the core notes the end time
	SvCore_Tick(now += 16);
	if (rx[GUEST_C].newClient != 1)
		Fail("no reset before 6 s");
	SvCore_SkipReset();
	SvCore_Tick(now += 16);
	if (rx[GUEST_C].newClient != 2)
		Fail("the host's skip resets the room at the next tick (SG_NEWCLIENT to the guest)");
	hooks->frame();
	if (stub.hostBots != 0)
		Fail("no host bot left after the reset");
	for (int id = 1; id < 8; id++)
		if (id != 2 && rx[GUEST_C].names[id] != -1)
			Fail("each bot and the leaver are gone from the next lobby (empty SG_NAME)");

	// a newcomer sees two players in an open room
	SvCore_Connect(LATE, 1000 + LATE);
	if (rx[LATE].roomCount5 != 2)
	{
		printf("  room 5 count %d\n", rx[LATE].roomCount5);
		Fail("room 5 holds the host and guest C only, unlocked");
	}

	if (failures == 0)
		printf("PASSED: bots as virtual clients, takeover, reset, the host's skip\n");
	return failures ? 1 : 0;
}
