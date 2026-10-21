// Native side of OnlineCTR: what the PS1 build kept at fixed addresses,
// and the game fields the in-process client (platform/native_online.c)
// reads and writes by name instead of through DuckStation's RAM.
// docs/ONLINECTR_PORT.md, D2 and D3.

#include <stdarg.h>
#include <stdio.h>

#include "../../platform/native_online_game.h"

// octr lived at PS1 address 0x8000C000
struct OnlineCTR octr_storage;

// see native_compat.h
DriverModelExtraSlot onlineDriverModelExtras[ONLINE_DRIVER_MODEL_COUNT];

// upstream Mods7.c
unsigned int checkpointTimes[(MAX_LAPS * CPS_PER_LAP) + 1];

struct OnlineCTR *NativeOnlineGame_Octr(void)
{
	return octr;
}

int NativeOnlineGame_LevelID(void)
{
	return sdata->gGT->levelID;
}

int NativeOnlineGame_LoadingStage(void)
{
	return sdata->Loading.stage;
}

int NativeOnlineGame_GameMode1(void)
{
	return sdata->gGT->gameMode1;
}

void NativeOnlineGame_SetRetroCheats(int boolRetro)
{
	struct GameTracker *gGT = sdata->gGT;

	// default, disable cheats
	gGT->gameMode2 &= ~(CHEAT_TURBOPAD | CHEAT_ICY | CHEAT_MASK | CHEAT_BOMBS | CHEAT_ENGINE);

	if (boolRetro)
		gGT->gameMode2 |= CHEAT_TURBOPAD;
}

void NativeOnlineGame_SetNumLaps(int numLaps)
{
	sdata->gGT->numLaps = (s8)numLaps;
}

int NativeOnlineGame_CharacterID(int slot)
{
	return data.characterIDs[slot];
}

void NativeOnlineGame_SetCharacterID(int slot, int characterID)
{
	data.characterIDs[slot] = (s16)characterID;
}

int NativeOnlineGame_PadHeld(int slot)
{
	return sdata->gGamepads->gamepad[slot].buttonsHeldCurrFrame;
}

void NativeOnlineGame_SetPad(int slot, int held, int tapped, int released, int prev)
{
	struct GamepadBuffer *pad = &sdata->gGamepads->gamepad[slot];

	pad->buttonsHeldCurrFrame = held;
	pad->buttonsTapped = tapped;
	pad->buttonsReleased = released;
	pad->buttonsHeldPrevFrame = prev;
}

void NativeOnlineGame_SetPadStick(int slot, int stickLX, int stickLY)
{
	struct GamepadBuffer *pad = &sdata->gGamepads->gamepad[slot];

	pad->stickLX = (s16)stickLX;
	pad->stickLY = (s16)stickLY;
}

int NativeOnlineGame_GetKart(int slot, struct NativeOnlineKart *kart)
{
	struct Driver *d = sdata->gGT->drivers[slot];

	if (d == NULL)
		return 0;

	kart->posX = d->posCurr.x;
	kart->posY = d->posCurr.y;
	kart->posZ = d->posCurr.z;
	kart->angle = d->angle;
	kart->numWumpas = d->numWumpas;
	kart->reserves = d->reserves;
	kart->courseTime = d->timeElapsedInRace;
	kart->bestLapTime = d->bestLapTime;
	return 1;
}

int NativeOnlineGame_SetKartPose(int slot, int posX, int posY, int posZ, int angle)
{
	struct Driver *d = sdata->gGT->drivers[slot];

	if (d == NULL)
		return 0;

	d->posCurr.x = posX;
	d->posCurr.y = posY;
	d->posCurr.z = posZ;
	d->angle = (s16)angle;
	return 1;
}

int NativeOnlineGame_SetKartReserves(int slot, int reserves)
{
	struct Driver *d = sdata->gGT->drivers[slot];

	if (d == NULL)
		return 0;

	d->reserves = (s16)reserves;
	return 1;
}

int NativeOnlineGame_SetKartWumpa(int slot, int numWumpas)
{
	struct Driver *d = sdata->gGT->drivers[slot];

	if (d == NULL)
		return 0;

	// upstream wrote a short here, over the next byte: the field is s8
	d->numWumpas = (s8)numWumpas;
	return 1;
}

unsigned int NativeOnlineGame_NowMs(void)
{
	return (unsigned int)SDL_GetTicks();
}

void NativeOnlineGame_Log(const char *fmt, ...)
{
	char line[256];
	va_list args;

	va_start(args, fmt);
	vsnprintf(line, sizeof(line), fmt, args);
	va_end(args);
	Platform_Log("%s", line);
}
