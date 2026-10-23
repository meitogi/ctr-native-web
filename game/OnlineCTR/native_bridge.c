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

// Upstream's online item odds (zGlobal_DATA.c under USE_ONLINE) ; struct Data
// keeps the retail tables, these are picked at runtime for the room's race
// (VehPhysGeneral_SetHeldItem). Must match DuckStation players' odds.
const unsigned char onlineItemSetRace2[0x34] =
{
	// 11/52 potion, 9/52 tnt, 5/52 bomb, 4/52 bomb x3, 7/52 turbo, 2/52 shield,
	// 3/52 missile, 2/52 missile x3, 1/52 warpball, 7/52 mask, 1/52 n tropy clock
	4,  4,  4,  4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3, 3,  3,  3, 3, 3, 1, 1, 1, 1, 1, 10,
	10, 10, 10, 0, 0, 0, 0, 0, 0, 0, 6, 6, 2, 2, 2, 11, 11, 9, 7, 7, 7, 7, 7, 7, 7, 8,
};
const unsigned char onlineItemSetRace3[0x14] =
{
	// 1/20 potion, 1/20 tnt, 1/20 bomb x1, 3/20 bomb x3, 2/20 turbo, 1/20 shield,
	// 3/20 missile x1, 1/20 missile x3, 1/20 warpball, 5/20 mask, 1/20 clock
	4, 3, 1, 10, 10, 10, 0, 0, 6, 2, 2, 2, 11, 9, 7, 7, 7, 7, 7, 8,
};
const unsigned char onlineItemSetRace4[0x14] =
{
	// 2/20 turbo, 1/20 shield, 2/20 missile x1, 3/20 missile x3, 1/20 bomb x3,
	// 2/20 warpball, 8/20 mask, 1/20 clock
	0, 0, 6, 2, 2, 11, 11, 11, 10, 9, 9, 7, 7, 7, 7, 7, 7, 7, 7, 8,
};

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

// === One build : the mod turned on at runtime (docs/ONLINECTR_PORT.md, D8, D9) ===

int octrActive;
int octrBootOnline = 1;
int octrExternalLobby;
int octrOnlineMenuPath;
int octrLobbyPhase;
int octrLobbyCharacters[8];

int octrThreadAlive;
static int octrStatsUpgraded;
static int octrSavedMetaPhys[4][NUM_CLASSES];
static int octrRewardsUnlocked;
static u32 octrSavedRewards[6];
static u32 octrSavedUnlocks[GAME_PROGRESS_UNLOCK_WORD_COUNT];
static int octrJoinRetryFrames;

// octr_entryHook() at runtime : what upstream did at boot, minus the
// permanent parts (StatsUpgrade is applied around the room's race, the
// cutscene models stay : the 8 MB arena holds them and a leave must keep
// the cutscenes). Rewards are unlocked for the room (every character and
// track pickable in the game's own menus) and restored on leave.
void OnlineRuntime_Activate(void)
{
	void octr_ThreadFunc(struct Thread *t);

	if (octrActive)
		return;

	memset(octr, 0, sizeof(struct OnlineCTR));
	octr->IsBootedPS1 = 1;
	octr->ver_psx = VERSION;
	octr->autoRetryJoinRoomIndex = -1;
	octrActive = 1;
	octrJoinRetryFrames = 0;
	octrOnlineMenuPath = 0;
	octrLobbyPhase = ONLINE_LOBBY_MENUS;
	memset(octrLobbyCharacters, 0, sizeof(octrLobbyCharacters));

	// the hub's rewards (upstream) and the save's unlocks : the retail menus
	// test GAME_PROGRESS.unlocks (MM_Characters.c, MM_TrackSelect.c)
	if (!octrRewardsUnlocked)
	{
		memcpy(octrSavedRewards, sdata->advProgress.rewards, sizeof(octrSavedRewards));
		memcpy(octrSavedUnlocks, GAME_PROGRESS.unlocks, sizeof(octrSavedUnlocks));
		for (int i = 0; i < 6; i++)
			sdata->advProgress.rewards[i] = 0xffffffff;
		for (int i = 0; i < GAME_PROGRESS_UNLOCK_WORD_COUNT; i++)
			GAME_PROGRESS.unlocks[i] = 0xffffffff;
		octrRewardsUnlocked = 1;
	}

	// the mod thread of the current level (octr_initHook births it for the
	// next ones ; it kills itself once the room is left)
	if (sdata->Loading.stage == LOAD_IDLE && !octrThreadAlive)
	{
		PROC_BirthWithObject(0x30f, octr_ThreadFunc, 0, 0);
		octrThreadAlive = 1;
	}
}

void OnlineRuntime_Deactivate(void)
{
	if (!octrActive)
		return;

	octrActive = 0;
	octrOnlineMenuPath = 0;
	octrLobbyPhase = ONLINE_LOBBY_NONE;
	OnlineRuntime_SyncStats();

	if (octrRewardsUnlocked)
	{
		memcpy(sdata->advProgress.rewards, octrSavedRewards, sizeof(octrSavedRewards));
		memcpy(GAME_PROGRESS.unlocks, octrSavedUnlocks, sizeof(octrSavedUnlocks));
		octrRewardsUnlocked = 0;
	}

	memset(octr, 0, sizeof(struct OnlineCTR));
	octr->autoRetryJoinRoomIndex = -1;

	// out of the room's race : back to the title
	if (((sdata->gGT->gameMode1 & MAIN_MENU) == 0) && (sdata->Loading.stage == LOAD_IDLE))
	{
		sdata->gGT->numPlyrNextGame = 1;
		GAME_MAIN_MENU_STATE = MAIN_MENU_TITLE;
		MainRaceTrack_RequestLoad(MAIN_MENU_LEVEL);
	}
}

// StatsUpgrade() around the room's race only : solo play beside an open
// room keeps the retail stats.
void OnlineRuntime_SyncStats(void)
{
	int want = ONLINE_RACE;

	if (want && !octrStatsUpgraded)
	{
		for (int i = 0; i < 4; i++)
			memcpy(octrSavedMetaPhys[i], data.metaPhys[9 + i].value, sizeof(octrSavedMetaPhys[i]));
		StatsUpgrade();
		octrStatsUpgraded = 1;
	}
	else if (!want && octrStatsUpgraded)
	{
		for (int i = 0; i < 4; i++)
			memcpy(data.metaPhys[9 + i].value, octrSavedMetaPhys[i], sizeof(octrSavedMetaPhys[i]));
		octrStatsUpgraded = 0;
	}
}

// A load requested while the room's race runs (pause menu : quit, retry)
// leaves the room ; the others see the empty SG_NAME of a disconnect.
void OnlineRuntime_LeaveRace(void)
{
	NativeOnlineGame_Log("[OnlineCTR] Left the race\n");
	octr->CurrState = -1;
}

// StatePS1_Lobby_StartLoading() without its text : the level load with the
// mod's game mode, keeping the menu's battle limits.
static void OnlineExternal_StartLoading(void)
{
	struct GameTracker *gGT = sdata->gGT;

	initRace = true;
	endRace = true;

	octr->CountPressX++;
	if (octr->CountPressX < FPS_DOUBLE(15)) return;

	Music_Stop();
	howl_StopAudio(1, 1, 0);
	sdata->audioState = 0;

	// MAIN_MENU stays, as at a retail track lock : the load's first stage
	// clears it, and until then this level is the menu, not the race
	if ((octr->levelID <= TURBO_TRACK) || (octr->levelID >= GEM_STONE_VALLEY))
		gGT->gameMode1 = (gGT->gameMode1 & MAIN_MENU) | LOADING | ARCADE_MODE;
	else
		gGT->gameMode1 = (gGT->gameMode1 & (MAIN_MENU | POINT_LIMIT | LIFE_LIMIT | TIME_LIMIT)) | LOADING | BATTLE_MODE;

	// a guest has no track lock to hide its menu (the host's is NULL already,
	// QueueLoadTrack_MenuProc) : the direct clear of upstream's guest state,
	// RECTMENU_Hide would wait for a ProcessState the load no longer runs
	sdata->ptrActiveMenu = 0;
	sdata->ptrDesiredMenu = 0;

	octrLobbyPhase = ONLINE_LOBBY_RACE;
	MainRaceTrack_RequestLoad(octr->levelID);
}

// The lobby states when the lobby lives outside the mod (web) : no menu, no
// text, only the transitions the protocol needs. Race states stay upstream's.
void OnlineExternal_State(void)
{
	switch (octr->CurrState)
	{
		case LAUNCH_ENTER_PID:
		case LAUNCH_PICK_SERVER:
			// the page picks « Private Room » (serverCountry 7, serverLockIn1)
			break;

		case LAUNCH_PICK_ROOM:
			// the one room of the page's link : the items room 5 ; a refused
			// join (SG_ROOMS clears serverLockIn2) is retried every 2 s. No
			// ResetPsxGlobals() here : the mempack end is already the arena's
			// (MEMPACK_Init), SG_NEWCLIENT clears the locks, and the characters
			// belong to the game's menus (the host may be browsing them)
			if (!octr->serverLockIn2)
			{
				if (octrJoinRetryFrames > 0)
				{
					octrJoinRetryFrames--;
					break;
				}
				octr->serverRoom = 5;
				octr->serverLockIn2 = 1;
				octrJoinRetryFrames = FPS_DOUBLE(60);
			}
			break;

		case LAUNCH_ERROR:
			sdata->ptrActiveMenu = 0;
			break;

		case LOBBY_ASSIGN_ROLE:
			// a room reset after a race lands here on the race level : back to
			// the title, the room stays
			octrLobbyPhase = ONLINE_LOBBY_MENUS;
			octrOnlineMenuPath = 0;
			if (((sdata->gGT->gameMode1 & MAIN_MENU) == 0) && (sdata->Loading.stage == LOAD_IDLE))
			{
				sdata->gGT->numPlyrNextGame = 1;
				GAME_MAIN_MENU_STATE = MAIN_MENU_TITLE;
				MainRaceTrack_RequestLoad(MAIN_MENU_LEVEL);
			}
			if (octr->DriverID == 0)
				octr->CurrState = LOBBY_HOST_TRACK_PICK;
			else if (octr->DriverID > 0)
				octr->CurrState = LOBBY_GUEST_TRACK_WAIT;
			break;

		case LOBBY_HOST_TRACK_PICK:
		case LOBBY_GUEST_TRACK_WAIT:
		case LOBBY_CHARACTER_PICK:
		case LOBBY_WAIT_FOR_LOADING:
			// fed by OnlineLobby_RequestRace() / OnlineLobby_SetMyCharacter()
			break;

		case LOBBY_START_LOADING:
			OnlineExternal_StartLoading();
			break;

		default:
			break;
	}
}

// The game's track lock (QueueLoadTrack_MenuProc) on the host : the menus'
// choices go to the protocol instead of a local race. Returns 1 when the
// local load must not happen.
int OnlineLobby_RequestRace(void)
{
	struct GameTracker *gGT = sdata->gGT;

	if (!octrActive || !octrOnlineMenuPath)
		return 0;

	octrOnlineMenuPath = 0;

	if (octr->CurrState != LOBBY_HOST_TRACK_PICK)
	{
		NativeOnlineGame_Log("[OnlineCTR] Track locked in state %d: not the host's lobby, ignored\n", octr->CurrState);
		return 1;
	}

	for (int i = 0; i < 8; i++)
		octrLobbyCharacters[i] = (i < gGT->numPlyrNextGame) ? data.characterIDs[i] : -1;

	octr->levelID = (unsigned char)gGT->currLEV;
	octr->lapID = (gGT->numLaps >= 1 && gGT->numLaps <= 7) ? (unsigned char)((gGT->numLaps - 1) / 2) : 1;
	if (octr->levelID > TURBO_TRACK)
		octr->lapID = 0;
	octr->boolLockedInLevel = 1;
	octr->boolLockedInLap = 1;
	octr->boolLockedInCharacters[0] = 1;

	gGT->numPlyrNextGame = 1;
	gGT->numBotsNextGame = 0;
	octrLobbyPhase = ONLINE_LOBBY_STARTING;

	NativeOnlineGame_Log("[OnlineCTR] Track %d locked from the game's menus, %d laps\n", octr->levelID, gGT->numLaps);
	return 1;
}

// A guest's character, picked on the host's screen and sent by the page.
void OnlineLobby_SetMyCharacter(int characterID)
{
	if (!octrActive || octr->CurrState < LOBBY_ASSIGN_ROLE || octr->CurrState > LOBBY_CHARACTER_PICK)
		return;

	data.characterIDs[0] = (s16)characterID;
	octr->boolLockedInCharacters[octr->DriverID] = 1;
	octrLobbyPhase = ONLINE_LOBBY_STARTING;
}

// === accessors of native_online_game.h for the one-build switches ===

int NativeOnlineGame_Active(void)
{
	return octrActive;
}

int NativeOnlineGame_ExternalLobby(void)
{
	return octrExternalLobby;
}

void NativeOnlineGame_LobbyPointers(int **active, int **phase, int **characters)
{
	*active = &octrActive;
	*phase = &octrLobbyPhase;
	*characters = octrLobbyCharacters;
}

void NativeOnlineGame_SetMode(int bootOnline, int externalLobby)
{
	octrBootOnline = bootOnline;
	octrExternalLobby = externalLobby;
}

// Join : only from the title (the menus are the lobby), between loads.
int NativeOnlineGame_Activate(void)
{
	if (((sdata->gGT->gameMode1 & MAIN_MENU) == 0) || (sdata->Loading.stage != LOAD_IDLE))
		return 0;
	OnlineRuntime_Activate();
	return 1;
}

void NativeOnlineGame_Deactivate(void)
{
	OnlineRuntime_Deactivate();
}

void NativeOnlineGame_SyncStats(void)
{
	OnlineRuntime_SyncStats();
}

void NativeOnlineGame_SetMyCharacter(int characterID)
{
	OnlineLobby_SetMyCharacter(characterID);
}
