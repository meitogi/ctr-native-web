// A guest whose host left mid-race finishes it alone (session 32,
// platform/native_online.c) : the host link's DISCONNECTED converts every
// unfinished kart to this game's AI, the AI's finishers fill the results,
// the title comes once the full results have shown ; the host itself, a
// load and Battle keep the retail leave.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "stub_game.h"
#include "../../platform/native_online.h"

static int connected;
static int dropped;

static int Fake_Connect(const char *address) { (void)address; connected = 0; dropped = 0; return 0; }
static void Fake_Send(const void *data, int size, int reliable) { (void)data; (void)size; (void)reliable; }
static void Fake_Disconnect(void) {}
static int Fake_Poll(void *buf, int size, int *event)
{
	(void)buf;
	(void)size;
	if (!connected)
	{
		connected = 1;
		*event = ONLINE_EVENT_CONNECTED;
		return 0;
	}
	if (dropped == 1)
	{
		dropped = 2;
		*event = ONLINE_EVENT_DISCONNECTED;
		return 0;
	}
	return -1;
}
static const OnlineTransport fake = {Fake_Connect, Fake_Send, Fake_Poll, Fake_Disconnect};

static int failures;
#define EXPECT(cond, ...) do { if (!(cond)) { printf("FAILED: " __VA_ARGS__); printf("\n"); failures++; } } while (0)

static int Ended(int slot)
{
	for (int k = 0; k < stub.octr.numDriversEnded; k++)
		if (stub.octr.raceStats[k].slot == slot)
			return stub.octr.raceStats[k].finalTime;
	return -1;
}

// a guest (client 2) in a race of 4 named karts : the host (slot 1), a bot of
// the host (slot 2), a guest who already finished (slot 3)
static void RaceAsGuest(int driverID)
{
	StubGame_Boot();
	NativeOnline_Configure(&fake, "Test", "fake");
	stub.octr.CurrState = LAUNCH_PICK_SERVER;
	stub.octr.serverLockIn1 = 1;
	NativeOnline_Frame(); // connect
	NativeOnline_Frame(); // connected

	stub.octr.CurrState = GAME_START_RACE;
	stub.octr.DriverID = driverID;
	stub.octr.NumDrivers = 4;
	for (int slot = 0; slot < 4; slot++)
	{
		snprintf(stub.octr.nameBuffer[slot], NAME_LEN + 1, "P%d", slot);
		stub.kartExists[slot] = 1;
		stub.karts[slot].bestLapTime = 30000 + slot;
	}
	stub.octr.raceStats[0].slot = 3;
	stub.octr.raceStats[0].finalTime = 80000;
	stub.octr.numDriversEnded = 1;
	stub.kartFinished[3] = 1;
	stub.raceClock = 60000;
}

static void Drop(void)
{
	dropped = 1;
	NativeOnline_Frame();
	StubGame_Frame();
}

int main(void)
{
	// the host leaves mid-race : the two unfinished karts go to the AI, nothing leaves
	RaceAsGuest(2);
	Drop();
	EXPECT(stub.octr.CurrState == GAME_START_RACE, "the race left at the drop (state %d)", stub.octr.CurrState);
	EXPECT(stub.takenOver[1] && stub.takenOver[2] && !stub.takenOver[3], "takeovers %d %d %d, wanted 1 1 0", stub.takenOver[1], stub.takenOver[2], stub.takenOver[3]);
	EXPECT(stub.hostBots == 0x6, "AI slots 0x%x, wanted 0x6", stub.hostBots);

	// the AI's finishers at the race clock, their best laps kept
	stub.raceClock = 90000;
	stub.kartFinished[1] = 1;
	NativeOnline_Frame();
	EXPECT(Ended(1) == 90000, "slot 1 ended at %d, wanted 90000", Ended(1));
	EXPECT(stub.octr.raceStats[1].bestLap == 30001, "slot 1 best lap %d", stub.octr.raceStats[1].bestLap);

	// this player finishes (OnlineEndOfRace : GAME_END_RACE), then the last AI
	stub.octr.CurrState = GAME_END_RACE;
	stub.raceClock = 92000;
	NativeOnline_Frame();
	EXPECT(Ended(0) >= 0, "this player's result missing");
	stub.raceClock = 95000;
	stub.kartFinished[2] = 1;
	NativeOnline_Frame();
	EXPECT(stub.octr.numDriversEnded == 4 && Ended(2) == 95000, "%d results, slot 2 at %d", stub.octr.numDriversEnded, Ended(2));
	NativeOnline_Frame();
	EXPECT(stub.deactivated == 0, "the title came with the results");

	// the results shown 6 s, then the title ; one result per slot throughout
	stub.raceClock = 100999;
	NativeOnline_Frame();
	EXPECT(stub.deactivated == 0, "the title came before 6 s of results");
	stub.raceClock = 101000;
	NativeOnline_Frame();
	EXPECT(stub.deactivated == 1, "no title after the results (deactivated %d)", stub.deactivated);
	EXPECT(stub.octr.numDriversEnded == 4, "%d results, wanted 4", stub.octr.numDriversEnded);

	// the host itself, a race still loading, Battle : the retail leave
	RaceAsGuest(0);
	Drop();
	EXPECT(stub.octr.CurrState == LAUNCH_PICK_SERVER && !stub.takenOver[1], "the host went solo");
	RaceAsGuest(2);
	stub.loadingStage = 3;
	Drop();
	EXPECT(stub.octr.CurrState == LAUNCH_PICK_SERVER && !stub.takenOver[1], "a loading race went solo");
	RaceAsGuest(2);
	stub.noAI = 1;
	Drop();
	EXPECT(stub.octr.CurrState == LAUNCH_PICK_SERVER && !stub.takenOver[1], "Battle went solo");

	if (failures == 0)
		printf("PASSED: a guest finishes alone (takeover, AI results, title after the results, retail leave elsewhere)\n");
	return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
