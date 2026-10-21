#ifndef NATIVE_ONLINE_GAME_H
#define NATIVE_ONLINE_GAME_H

// Game memory the OnlineCTR client reads and writes, by name.
// CL_main.cpp reached these through raw PS1 addresses in DuckStation's RAM
// (docs/ONLINECTR_PORT.md, "Client memory contract"). The game build
// implements them in game/OnlineCTR/native_bridge.c ; tests/online stubs them.

struct OnlineCTR;

struct NativeOnlineKart
{
	int posX, posY, posZ;        // driver->posCurr
	int angle;                   // driver->angle
	int numWumpas;               // driver->numWumpas
	int reserves;                // driver->reserves, read unsigned upstream
	int courseTime;              // driver->timeElapsedInRace
	int bestLapTime;             // driver->bestLapTime (online-only field)
};

struct OnlineCTR *NativeOnlineGame_Octr(void);

int NativeOnlineGame_LevelID(void);          // gGT->levelID
int NativeOnlineGame_LoadingStage(void);     // sdata->Loading.stage
int NativeOnlineGame_GameMode1(void);        // gGT->gameMode1
void NativeOnlineGame_SetRetroCheats(int boolRetro); // gGT->gameMode2 cheat bits
void NativeOnlineGame_SetNumLaps(int numLaps);       // gGT->numLaps

int NativeOnlineGame_CharacterID(int slot);  // data.characterIDs[slot]
void NativeOnlineGame_SetCharacterID(int slot, int characterID);

// gGamepads->gamepad[slot]
int NativeOnlineGame_PadHeld(int slot);
void NativeOnlineGame_SetPad(int slot, int held, int tapped, int released, int prev);
void NativeOnlineGame_SetPadStick(int slot, int stickLX, int stickLY);

// gGT->drivers[slot] ; return 0 when that driver does not exist
int NativeOnlineGame_GetKart(int slot, struct NativeOnlineKart *kart);
int NativeOnlineGame_SetKartPose(int slot, int posX, int posY, int posZ, int angle);
int NativeOnlineGame_SetKartReserves(int slot, int reserves);
int NativeOnlineGame_SetKartWumpa(int slot, int numWumpas);

unsigned int NativeOnlineGame_NowMs(void);
void NativeOnlineGame_Log(const char *fmt, ...);

#endif
