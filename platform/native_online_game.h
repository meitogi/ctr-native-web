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

// One build (docs/ONLINECTR_PORT.md, D8) : the mod is on while a room is
// joined. Natively it is on from boot ; the web joins and leaves at runtime.
int NativeOnlineGame_Active(void);
int NativeOnlineGame_Activate(void);          // 1 when joined (from the title, between loads)
void NativeOnlineGame_Deactivate(void);
void NativeOnlineGame_SyncStats(void);        // StatsUpgrade around the room's race
int NativeOnlineGame_ExternalLobby(void);     // the lobby is outside the mod (web)
void NativeOnlineGame_SetMode(int bootOnline, int externalLobby);
void NativeOnlineGame_SetMyCharacter(int characterID); // a guest's pick, from the page
void NativeOnlineGame_EndMyRace(void);        // the room's end-of-race timeout : P1 finishes now
// The lobby state the page reads next to octr (web/online/library.js) : the
// room flag, the lobby phase (enum OnlineLobbyPhase) and the menus' character
// per slot at the track lock, int[8].
void NativeOnlineGame_LobbyPointers(int **active, int **phase, int **characters);

// Session 23 : the host's bots (docs/ONLINECTR_PORT.md, D11)
int NativeOnlineGame_LobbyBots(void);              // the track lock came from ONLINE > ARCADE
int NativeOnlineGame_LobbyCharacter(int player);   // the menus' character of P1-P4 at the lock, -1 none
void NativeOnlineGame_CharacterName(int characterID, char *out, int cap); // its short name, cut to cap - 1
int *NativeOnlineGame_HostBots(void);              // the slots the host's AI drives (bit per slot)
int NativeOnlineGame_KartFinished(int slot);       // its finish flag
int NativeOnlineGame_RaceClock(void);              // gGT->elapsedEventTime
int NativeOnlineGame_TakeBotShot(int slot, int *weapon, int *juiced, int *flags); // 1 once per shot
int NativeOnlineGame_TakeOverKart(int slot);       // a leaver's kart to the AI ; 1 when converted
void NativeOnlineGame_EndBotRace(int slot);        // the room's end-of-race timeout, for a bot

// Session 32 : a guest whose host left mid-race finishes it alone
int NativeOnlineGame_PrepareAI(void);              // the AI's difficulty for this race ; 0 : no AI here (Battle)
int *NativeOnlineGame_RoomInfo(int **len);         // what the host tells its guests beside the wire (D12), *len its ints

#endif
