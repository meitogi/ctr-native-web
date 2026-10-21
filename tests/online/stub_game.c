#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "stub_game.h"

struct StubGame stub;

// ===== native_online_game.h =====

struct OnlineCTR *NativeOnlineGame_Octr(void) { return &stub.octr; }
int NativeOnlineGame_LevelID(void) { return stub.levelID; }
int NativeOnlineGame_LoadingStage(void) { return stub.loadingStage; }
int NativeOnlineGame_GameMode1(void) { return stub.gameMode1; }

void NativeOnlineGame_SetRetroCheats(int boolRetro)
{
	stub.gameMode2 &= ~(0x100000 | 0x80000 | 0x400 | 0x400000 | 0x10000);
	if (boolRetro)
		stub.gameMode2 |= 0x100000;
}

void NativeOnlineGame_SetNumLaps(int numLaps) { stub.numLaps = (signed char)numLaps; }
int NativeOnlineGame_CharacterID(int slot) { return stub.characterIDs[slot]; }
void NativeOnlineGame_SetCharacterID(int slot, int characterID) { stub.characterIDs[slot] = (short)characterID; }
int NativeOnlineGame_PadHeld(int slot) { return stub.pads[slot].held; }

void NativeOnlineGame_SetPad(int slot, int held, int tapped, int released, int prev)
{
	stub.pads[slot].held = held;
	stub.pads[slot].tapped = tapped;
	stub.pads[slot].released = released;
	stub.pads[slot].prev = prev;
}

void NativeOnlineGame_SetPadStick(int slot, int stickLX, int stickLY)
{
	stub.pads[slot].stickLX = stickLX;
	stub.pads[slot].stickLY = stickLY;
}

int NativeOnlineGame_GetKart(int slot, struct NativeOnlineKart *kart)
{
	if (!stub.kartExists[slot])
		return 0;
	*kart = stub.karts[slot];
	return 1;
}

int NativeOnlineGame_SetKartPose(int slot, int posX, int posY, int posZ, int angle)
{
	if (!stub.kartExists[slot])
		return 0;
	stub.karts[slot].posX = posX;
	stub.karts[slot].posY = posY;
	stub.karts[slot].posZ = posZ;
	stub.karts[slot].angle = (short)angle;
	return 1;
}

int NativeOnlineGame_SetKartReserves(int slot, int reserves)
{
	if (!stub.kartExists[slot])
		return 0;
	stub.karts[slot].reserves = (short)reserves;
	return 1;
}

int NativeOnlineGame_SetKartWumpa(int slot, int numWumpas)
{
	if (!stub.kartExists[slot])
		return 0;
	stub.karts[slot].numWumpas = (signed char)numWumpas;
	return 1;
}

unsigned int NativeOnlineGame_NowMs(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (unsigned int)(ts.tv_sec * 1000u + ts.tv_nsec / 1000000u);
}

void NativeOnlineGame_Log(const char *fmt, ...)
{
	(void)fmt;
}

// ===== game side =====

void StubGame_Boot(void)
{
	memset(&stub, 0, sizeof(stub));

	// octr_entryHook
	stub.octr.IsBootedPS1 = 1;
	stub.octr.ver_psx = VERSION;

	// globe / lobby level, loaded
	stub.levelID = 0x26;
	stub.loadingStage = -1;
}

void StubGame_Frame(void)
{
	struct OnlineCTR *o = &stub.octr;

	// GAMEPAD_* under USE_ONLINE: only P1 is polled, slots 1-7 are
	// whatever the client wrote
	struct StubPad *p = &stub.pads[0];
	p->prev = p->held;
	p->held = stub.localHeld;
	p->tapped = ~p->prev & p->held;
	p->released = p->prev & ~p->held;

	// thread.c: client gone or server dropped us
	if (o->CurrState < 0)
	{
		o->CurrState = LAUNCH_PICK_SERVER;
		o->serverLockIn1 = 0;
		o->serverLockIn2 = 0;
		return;
	}

	switch (o->CurrState)
	{
		case LAUNCH_PICK_ROOM:
			// ResetPsxGlobals once the room is picked
			if (o->serverLockIn2)
				for (int i = 0; i < 8; i++)
				{
					stub.characterIDs[i] = 0;
					o->boolLockedInCharacters[i] = 0;
				}
			break;

		case LOBBY_ASSIGN_ROLE:
			if (o->DriverID == 0)
				o->CurrState = LOBBY_HOST_TRACK_PICK;
			else if (o->DriverID > 0)
				o->CurrState = LOBBY_GUEST_TRACK_WAIT;
			break;

		case LOBBY_START_LOADING:
			o->CountPressX++;
			if (o->CountPressX < 15)
				break;

			// MainRaceTrack_RequestLoad, then OnlineInit_Drivers
			if (stub.loadFrames == 0)
			{
				stub.loadingStage = 0;
				stub.loadFrames = 10;
			}
			else if (--stub.loadFrames == 0)
			{
				stub.loadingStage = -1;
				stub.levelID = o->levelID;
				for (int i = 0; i < o->NumDrivers && i < 8; i++)
					stub.kartExists[i] = 1;
				stub.gameMode1 |= 0x40; // camera fly-in
				stub.flyInFrames = 20;
				o->CurrState = GAME_WAIT_FOR_RACE;
			}
			break;

		case GAME_WAIT_FOR_RACE:
			if (stub.flyInFrames > 0 && --stub.flyInFrames == 0)
				stub.gameMode1 &= ~0x40;
			break;

		default:
			break;
	}
}
