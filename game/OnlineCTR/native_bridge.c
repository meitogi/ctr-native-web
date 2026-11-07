// Native side of OnlineCTR: what the PS1 build kept at fixed addresses,
// and the game fields the in-process client (platform/native_online.c)
// reads and writes by name instead of through DuckStation's RAM.
// docs/ONLINECTR_PORT.md, D2 and D3.

#include <stdarg.h>
#include <stdio.h>

#include "../../platform/native_online_game.h"
#include <platform/native_web_ui.h>

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
int octrSlotGone;
int octrFreshMenu;
int octrLobbyPhase;
int octrLobbyCharacters[8];

int octrThreadAlive;
int octrOnlineArcade;
int octrLobbyArcade;
int octrLobbyPlayers;
int octrHostBots;
int octrRoomInfo[ONLINE_ROOM_INFO_LEN];
int octrCupInterlude;
// the Cup (D12) : its room has bots ; the host's frames before the next track's lock ; races
// counted when this race loaded (its standings show once one more is in) ; the totals then ; the
// names and bots of the last results, by clientID (the room's reset clears nameBuffer)
static int octrCupArcade;
static int octrCupHold;
static int octrCupRacesAtStart;
static int octrCupBefore[8];
static char octrCupNames[8][NAME_LEN + 1];
static int octrCupBots;
// the host's Cross on the rankings (D12.10) : the server's reset now, then no wait in a Cup
static int octrSkipReset;
static int octrSkipCupHold;
// frames the table has been complete : the hint and the Cross wait 1 s (Cross is the gas : a
// host still pressing it at its finish must not skip the results)
static int octrSkipFrames;
// the humans still in the room at this race's end (a leaver's name emptied, or its kart the AI's)
static int octrRaceHumans;
struct OnlineBotShoot octrBotShoot[8];
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
	octrOnlineArcade = 0;
	octrLobbyArcade = 0;
	octrLobbyPlayers = 0;
	octrHostBots = 0;
	memset(octrRoomInfo, 0, sizeof(octrRoomInfo));
	octrCupInterlude = 0;
	octrRaceHumans = 0;
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
	octrSlotGone = 0;
	octrOnlineArcade = 0;
	octrLobbyArcade = 0;
	octrLobbyPlayers = 0;
	octrHostBots = 0;
	memset(octrRoomInfo, 0, sizeof(octrRoomInfo));
	octrCupInterlude = 0;
	octrRaceHumans = 0;
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
	octrRoomInfo[ONLINE_ROOM_PAUSED] = 0;
}

// StatePS1_Lobby_StartLoading() without its text : the level load with the
// mod's game mode, keeping the menu's battle limits.
static int octrBotEndTime[8];

static void OnlineExternal_StartLoading(void)
{
	struct GameTracker *gGT = sdata->gGT;

	initRace = true;
	endRace = true;
	memset(octrBotEndTime, 0, sizeof(octrBotEndTime));
	// the host's pause and skip belong to the race before (D12.9, D12.10)
	octrRoomInfo[ONLINE_ROOM_PAUSED] = 0;
	octrSkipReset = 0;
	octrSkipCupHold = 0;
	octrSkipFrames = 0;
	// a shot fired after a kart's finish (the AI drives on, its shot never sent) must not go
	// out at the next race's lights (session 32c : a warp orb before a Cup's start)
	memset(octrBotShoot, 0, sizeof(octrBotShoot));
	for (int i = 0; i < 8; i++)
		octr->Shoot[i].boolNow = 0;

	octr->CountPressX++;
	if (octr->CountPressX < FPS_DOUBLE(15)) return;

	// a Cup's next race (D12.1) : the standings stop, this race's points count from here
	octrCupInterlude = 0;
	octrCupRacesAtStart = octrRoomInfo[ONLINE_ROOM_CUP_RACES];
	memcpy(octrCupBefore, &octrRoomInfo[ONLINE_ROOM_POINTS], sizeof(octrCupBefore));

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

// ---- The Netplay Cup (docs/ONLINECTR_PORT.md, D12) ----

static int ClientOfSlot(int slot)
{
	int me = octr->DriverID;

	if (slot == 0)
		return me;
	return (slot <= me) ? slot - 1 : slot;
}

// A bot's kart : the host's AI (its own bots, a takeover, or every other kart of a race
// finished alone), else the host's word for the guests (D12.3)
int OnlineSlot_IsBot(int slot)
{
	if (!octrActive || (slot < 0) || (slot >= 8))
		return 0;
	if ((octrHostBots >> slot) & 1)
		return 1;
	return (octr->DriverID != 0) && ((octrRoomInfo[ONLINE_ROOM_BOTS] >> ClientOfSlot(slot)) & 1);
}

// The host, at the room's reset between two races : the cup's next track, locked as the
// menus' track lock would (OnlineLobby_RequestRace), the same laps and characters
static void OnlineCup_LockNextTrack(void)
{
	struct GameTracker *gGT = sdata->gGT;
	int race = octrRoomInfo[ONLINE_ROOM_CUP_RACES];

	gGT->cup.trackIndex = race;
	gGT->currLEV = data.ArcadeCups[octrRoomInfo[ONLINE_ROOM_CUP_ID]].CupTrack[race].trackID;
	octr->levelID = (unsigned char)gGT->currLEV;
	octr->lapID = (gGT->numLaps >= 1 && gGT->numLaps <= 7) ? (unsigned char)((gGT->numLaps - 1) / 2) : 1;
	octr->boolLockedInLevel = 1;
	octr->boolLockedInLap = 1;
	octr->boolLockedInCharacters[0] = 1;
	octrLobbyArcade = octrCupArcade;
	octrLobbyPhase = ONLINE_LOBBY_STARTING;
	NativeOnlineGame_Log("[OnlineCTR] Cup race %d of 4 : track %d\n", race + 1, octr->levelID);
}

int OnlineCup_Showing(void)
{
	return octrActive && octrRoomInfo[ONLINE_ROOM_CUP] && (octrRoomInfo[ONLINE_ROOM_CUP_RACES] > octrCupRacesAtStart);
}

static void OnlineCup_Count(void)
{
	int named = 0;

	for (int i = 0; i < octr->NumDrivers; i++)
		if (octr->nameBuffer[i][0] != 0)
			named++;
	for (int k = 0; k < octr->numDriversEnded; k++)
	{
		int slot = octr->raceStats[k].slot;
		int points = octrCupArcade ? data.cupPointsPerPosition[k] : (named - (k + 1));

		if ((slot < 0) || (slot >= 8) || (points <= 0))
			continue;
		octrRoomInfo[ONLINE_ROOM_POINTS + slot] += points;
		sdata->gGT->cup.points[slot] += points;
	}
	octrRoomInfo[ONLINE_ROOM_CUP_RACES]++;
	NativeOnlineGame_Log("[OnlineCTR] Cup : race %d counted\n", octrRoomInfo[ONLINE_ROOM_CUP_RACES]);
}

static void OnlineCup_Draw(void)
{
	char line[48];
	int order[8], n = 0;
	int races = octrRoomInfo[ONLINE_ROOM_CUP_RACES];

	for (int c = 0; c < 8; c++)
		if (octrCupNames[c][0] != 0)
			order[n++] = c;
	// best first (a stable insertion sort over at most 8)
	for (int i = 1; i < n; i++)
		for (int j = i; (j > 0) && (octrRoomInfo[ONLINE_ROOM_POINTS + order[j]] > octrRoomInfo[ONLINE_ROOM_POINTS + order[j - 1]]); j--)
		{
			int t = order[j];
			order[j] = order[j - 1];
			order[j - 1] = t;
		}

	if (races >= 4)
		snprintf(line, sizeof(line), "FINAL STANDINGS");
	else
		snprintf(line, sizeof(line), "CUP STANDINGS - RACE %d / 4", races);
	DecalFont_DrawLine(line, 256, 40, FONT_BIG, JUSTIFY_CENTER | ORANGE);
	for (int i = 0; i < n; i++)
	{
		int c = order[i];
		int total = octrRoomInfo[ONLINE_ROOM_POINTS + c];
		int color = (c == octr->DriverID) ? BLUE : ((octrCupBots >> c) & 1) ? SILVER : ORANGE;

		snprintf(line, sizeof(line), "%d", i + 1);
		DecalFont_DrawLine(line, 150, 70 + i * 14, FONT_SMALL, RED);
		DecalFont_DrawLineStrlen(octrCupNames[c], NAME_LEN, 170, 70 + i * 14, FONT_SMALL, color);
		snprintf(line, sizeof(line), "%d", total);
		DecalFont_DrawLine(line, 320, 70 + i * 14, FONT_SMALL, JUSTIFY_RIGHT | WHITE);
		if (total > octrCupBefore[c])
		{
			snprintf(line, sizeof(line), "+%d", total - octrCupBefore[c]);
			DecalFont_DrawLine(line, 330, 70 + i * 14, FONT_SMALL, TINY_GREEN);
		}
	}
	OnlineRoom_HostSkip(70 + n * 14 + 8);
}

bool HasRaceEnded();

// Every frame of this game's end of race (OnlineEndOfRace) : the humans still here (the next
// character select's players) ; in a Cup, with the full results, the names and bots kept by
// clientID and, on the host, this race counted once ; then the standings
void OnlineRoom_EndOfRace(void)
{
	if (!octrCupInterlude)
	{
		octrRaceHumans = 0;
		for (int slot = 0; slot < octr->NumDrivers && slot < 8; slot++)
			if ((octr->nameBuffer[slot][0] != 0) && !((octrHostBots >> slot) & 1))
				octrRaceHumans++;
	}
	if (!octrRoomInfo[ONLINE_ROOM_CUP])
		return;
	if (!octrCupInterlude && HasRaceEnded())
	{
		octrCupBots = 0;
		memset(octrCupNames, 0, sizeof(octrCupNames));
		for (int slot = 0; slot < octr->NumDrivers && slot < 8; slot++)
		{
			int c = ClientOfSlot(slot);

			if ((c < 0) || (c >= 8) || (octr->nameBuffer[slot][0] == 0))
				continue;
			memcpy(octrCupNames[c], octr->nameBuffer[slot], NAME_LEN + 1);
			if (OnlineSlot_IsBot(slot))
				octrCupBots |= 1 << c;
		}
		if ((octr->DriverID == 0) && (octrRoomInfo[ONLINE_ROOM_CUP_RACES] == octrCupRacesAtStart))
			OnlineCup_Count();
	}
	if (OnlineCup_Showing())
		OnlineCup_Draw();
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
			// a room reset after a race lands here on the race level : the
			// room stays ; the host back to the character select with the same
			// players and mode (session 32, as retail's CHANGE CHARACTER : the
			// guests pick theirs on its screen as in the lobby), a guest to
			// its title behind the host's picture
			octrLobbyPhase = ONLINE_LOBBY_MENUS;
			octrOnlineMenuPath = 0;
			octrSkipReset = 0; // the reset came (D12.10)
			if (octrRoomInfo[ONLINE_ROOM_CUP] && (octrRoomInfo[ONLINE_ROOM_CUP_RACES] >= 4))
				octrRoomInfo[ONLINE_ROOM_CUP] = 0; // the Cup is over : its final standings have shown
			// a race the Cup counted : a reset before its count is the host's QUIT (32e), and a
			// guest's copy of the room info may not say the Cup is over yet
			if (OnlineCup_Showing() && ((sdata->gGT->gameMode1 & MAIN_MENU) == 0) && (sdata->Loading.stage == LOAD_IDLE))
			{
				// a Cup goes on (D12.1) : this level and its standings stay, the host
				// locks the next track after a few seconds of them
				octrCupInterlude = 1;
				octrLobbyPhase = ONLINE_LOBBY_RACE;
				octrCupHold = octrSkipCupHold ? 0 : FPS_DOUBLE(90);
			}
			else if (((sdata->gGT->gameMode1 & MAIN_MENU) == 0) && (sdata->Loading.stage == LOAD_IDLE))
			{
				struct GameTracker *gGT = sdata->gGT;

				if ((octr->DriverID == 0) && (octrLobbyPlayers > 0))
				{
					// a guest gone since the lock : one player less (OnlineRoom_EndOfRace)
					gGT->numPlyrNextGame = (octrRaceHumans > 0) && (octrRaceHumans < octrLobbyPlayers) ? octrRaceHumans : octrLobbyPlayers;
					octrOnlineMenuPath = 1;
					octrOnlineArcade = octrLobbyArcade;
					// the race ran in ARCADE_MODE (OnlineExternal_StartLoading) : VS is not
					if (!octrLobbyArcade && ((gGT->gameMode1 & BATTLE_MODE) == 0))
						gGT->gameMode1 &= ~ARCADE_MODE;
					GAME_MAIN_MENU_STATE = MAIN_MENU_CHARACTERS;
					sdata->Loading.OnBegin.AddBitsConfig0 |= MAIN_MENU;
				}
				else
				{
					gGT->numPlyrNextGame = 1;
					GAME_MAIN_MENU_STATE = MAIN_MENU_TITLE;
				}
				MainRaceTrack_RequestLoad(MAIN_MENU_LEVEL);
			}
			octrLobbyArcade = 0;
			if (octr->DriverID == 0)
				octr->CurrState = LOBBY_HOST_TRACK_PICK;
			else if (octr->DriverID > 0)
				octr->CurrState = LOBBY_GUEST_TRACK_WAIT;
			break;

		case LOBBY_HOST_TRACK_PICK:
			if (octrCupInterlude && !octr->boolLockedInLevel && (octrCupHold-- <= 0))
				OnlineCup_LockNextTrack();
			break;

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
	octrLobbyArcade = octrOnlineArcade;
	octrOnlineArcade = 0;

	if (octr->CurrState != LOBBY_HOST_TRACK_PICK)
	{
		NativeOnlineGame_Log("[OnlineCTR] Track locked in state %d: not the host's lobby, ignored\n", octr->CurrState);
		return 1;
	}

	for (int i = 0; i < 8; i++)
		octrLobbyCharacters[i] = (i < gGT->numPlyrNextGame) ? data.characterIDs[i] : -1;
	octrLobbyPlayers = gGT->numPlyrNextGame;

	// a Cup from the menus starts here (D12.2) : the cup select set gGT->cup
	memset(octrRoomInfo, 0, ONLINE_ROOM_BOTS * sizeof(octrRoomInfo[0]));
	if ((gGT->gameMode2 & CUP_ANY_KIND) != 0)
	{
		octrRoomInfo[ONLINE_ROOM_CUP] = 1;
		octrRoomInfo[ONLINE_ROOM_CUP_ID] = gGT->cup.cupID;
		octrCupArcade = octrLobbyArcade;
		NativeOnlineGame_Log("[OnlineCTR] Cup %d started (%s)\n", gGT->cup.cupID, octrCupArcade ? "Arcade" : "VS");
	}

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

// === the host's bots (docs/ONLINECTR_PORT.md, D11) ===

int NativeOnlineGame_LobbyBots(void)
{
	return octrLobbyArcade;
}

int NativeOnlineGame_LobbyCharacter(int player)
{
	return (player >= 0 && player < 8) ? octrLobbyCharacters[player] : -1;
}

void NativeOnlineGame_CharacterName(int characterID, char *out, int cap)
{
	const char *s = GAME_LANGUAGE_STRINGS[GAME_CHARACTER_METADATA[characterID].name_LNG_short];
	int n = 0;

	while (s && s[n] && n < cap - 1)
	{
		out[n] = s[n];
		n++;
	}
	out[n] = 0;
}

int *NativeOnlineGame_HostBots(void)
{
	return &octrHostBots;
}

int NativeOnlineGame_KartFinished(int slot)
{
	struct Driver *d = sdata->gGT->drivers[slot];

	return (d != NULL) && ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0);
}

// The race clock for the bots' finish times : elapsedEventTime stops at this
// game's END_OF_RACE (the host's own finish, MainFrame.c), the bots race on.
int NativeOnlineGame_RaceClock(void)
{
	static int clock;
	static int lastFrame;
	struct GameTracker *gGT = sdata->gGT;

	if ((gGT->gameMode1 & END_OF_RACE) == 0)
		clock = gGT->elapsedEventTime;
	else if (gGT->timer != lastFrame)
		clock += gGT->elapsedTimeMS;
	lastFrame = gGT->timer;
	return clock;
}

int NativeOnlineGame_TakeBotShot(int slot, int *weapon, int *juiced, int *flags)
{
	struct OnlineBotShoot *shot = &octrBotShoot[slot];

	if (!shot->boolNow)
		return 0;
	shot->boolNow = 0;
	*weapon = shot->Weapon;
	*juiced = shot->boolJuiced;
	*flags = shot->flags;
	return 1;
}

// A leaver's kart driven on by the AI from where it is (D11.6) : the retail
// conversion of a finish line, then the nav frame nearest the kart instead of
// the path's first, and the AI's own position from the kart's.
int NativeOnlineGame_TakeOverKart(int slot)
{
	struct Driver *d = sdata->gGT->drivers[slot];
	struct NavFrame *frame, *last, *nearest;
	int best = 0x7fffffff;

	if (!ONLINE_RACE || (d == NULL) || ((d->actionsFlagSet & (ACTION_RACE_FINISHED | ACTION_BOT)) != 0))
		return 0;

	octrHostBots |= 1 << slot;
	octrBotShoot[slot].boolNow = 0;
	// a guest's takeover : its host left (D11.6) ; a pause of that host's ends with it (D12.9)
	if (octr->DriverID != 0)
		octrRoomInfo[ONLINE_ROOM_PAUSED] = 0;
	d->bestLapTime = HOURS(10);
	BOTS_Driver_Convert(d);
	if ((d->actionsFlagSet & ACTION_BOT) == 0)
	{
		octrHostBots &= ~(1 << slot);
		return 0;
	}

	frame = sdata->NavPath_ptrNavFrameArray[d->botData.botPath];
	last = sdata->NavPath_ptrHeader[d->botData.botPath]->last;
	nearest = frame;
	for (; frame < last; frame++)
	{
		int dx = (d->posCurr.x >> 8) - frame->pos.x;
		int dy = (d->posCurr.y >> 8) - frame->pos.y;
		int dz = (d->posCurr.z >> 8) - frame->pos.z;
		int dist = dx * dx + dy * dy + dz * dz;

		if (dist < best)
		{
			best = dist;
			nearest = frame;
		}
	}
	d->botData.botNavFrame = nearest;
	d->botData.positionBackup.x = d->posCurr.x;
	d->botData.positionBackup.y = d->posCurr.y;
	d->botData.positionBackup.z = d->posCurr.z;
	BOTS_SetRotation(d, 0);
	return 1;
}

int *NativeOnlineGame_RoomInfo(int **len)
{
	static int count = ONLINE_ROOM_INFO_LEN;

	*len = &count;
	return octrRoomInfo;
}

// A guest whose host left mid-race (session 32) : its own AI drives the other
// karts, with the difficulty MainInit_Drivers would have set (the race was
// born without bots : OnlineInit_Drivers skipped it). Battle has no AI.
int NativeOnlineGame_PrepareAI(void)
{
	if (!ONLINE_RACE || ((sdata->gGT->gameMode1 & BATTLE_MODE) != 0))
		return 0;

	BOTS_Adv_AdjustDifficulty();
	return 1;
}

void NativeOnlineGame_EndBotRace(int slot)
{
	struct Driver *d = sdata->gGT->drivers[slot];

	if (!ONLINE_RACE || !ONLINE_HOST_BOT(slot) || (d == NULL) || ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0))
		return;

	d->actionsFlagSet |= ACTION_RACE_FINISHED;
	d->heldItemID = HELD_ITEM_NONE;
}

// Session 32c : the time a kart still racing would reach the line at its average pace so far
// (BOTS.c's lap-and-distance progress), strictly later than `last` (the kart ahead's). The
// results are kept in time order (native_online.c AddResult), so these times place each kart.
static int EstimateEnd(struct Driver *d, int clock, int last)
{
	struct GameTracker *gGT = sdata->gGT;
	int trackLength = 0;
	int estimate = last + 1000;

	if ((gGT->level1 != NULL) && (gGT->level1->ptr_restart_points != NULL))
		trackLength = (s32)gGT->level1->ptr_restart_points[0].distToFinish << 3; // VehLap.c VEH_LAP_TRACK_DISTANCE_SCALE_SHIFT
	if (trackLength > 0)
	{
		int lap = d->lapIndex - (((d->actionsFlagSet & ACTION_BEHIND_START_LINE) != 0) ? 1 : 0);
		long long progress = (long long)lap * trackLength + (trackLength - (int)d->distanceToFinish_curr);
		long long total = (long long)gGT->numLaps * trackLength;

		// a kart not yet past the start (session 32d : FINISH THE RACE at the start) goes behind
		// the others : as if it had covered 1/64th of the race
		if (progress < total / 64)
			progress = total / 64;
		if ((progress > 0) && (progress < total))
			estimate = (int)((long long)clock * total / progress);
	}
	if (estimate <= last)
		estimate = last + 1;
	return estimate;
}

// Session 32c : once every human has finished, the AI's karts end at once where they stand, as
// retail's PlayLevel ends its AIs, each at its EstimateEnd, in race order, each later than the one
// ahead : the results come at once, in the order the race had. octrBotEndTime by slot, 0 : none
// (a real finish).
int NativeOnlineGame_EndBots(void)
{
	struct GameTracker *gGT = sdata->gGT;
	const int clock = NativeOnlineGame_RaceClock();
	int last = clock;
	int ended = 0;

	if (!ONLINE_RACE || ((gGT->gameMode1 & BATTLE_MODE) != 0))
		return 0;

	// rank by rank : driverRank 0 is the race's leader
	for (int rank = 0; rank < 8; rank++)
	{
		for (int slot = 0; slot < 8; slot++)
		{
			struct Driver *d = gGT->drivers[slot];

			if (!ONLINE_HOST_BOT(slot) || (d == NULL) || (d->driverRank != rank) || ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0))
				continue;
			last = EstimateEnd(d, clock, last);
			octrBotEndTime[slot] = last;
			d->actionsFlagSet |= ACTION_RACE_FINISHED;
			d->heldItemID = HELD_ITEM_NONE;
			ended++;
		}
	}
	return ended;
}

int NativeOnlineGame_BotEndTime(int slot)
{
	return ((slot >= 0) && (slot < 8)) ? octrBotEndTime[slot] : 0;
}

// The room's end-of-race timeout (session 11b, the page's choice) : this
// player's race ends where it stands, as a finish line crossed does
// (PlayLevel.c : the flag, no item, the AI drives on). PlayLevel then runs
// MainGameEnd_Initialize, OnlineEndOfRace moves to GAME_END_RACE and the
// bridge sends an ordinary CG_ENDRACE with the time reached.
void NativeOnlineGame_EndMyRace(void)
{
	struct Driver *d = sdata->gGT->drivers[0];

	if (!ONLINE_RACE || (d == NULL) || ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0))
		return;

	d->actionsFlagSet |= ACTION_RACE_FINISHED;
	d->heldItemID = HELD_ITEM_NONE;
	d->noItemTimer = 0;
	BOTS_Driver_Convert(d);
}

// ---- The Netplay pause (docs/ONLINECTR_PORT.md, D12.9) ----
// Start in a room's race opens this menu without retail's freeze : the karts, the clock and the
// wire run on, this kart coasts (no drive input while it is open). RESUME, FINISH THE RACE (the
// last human still racing), PAUSE FOR EVERYONE (the host), QUIT (retail's, the room left). The
// host's pause for everyone goes to the guests in the room info (ONLINE_ROOM_PAUSED) : every game
// of the room freezes the retail way (PAUSE_1) until the host resumes it.

#define ONLINE_LNG_FINISH 0x9e
#define ONLINE_LNG_EVERYONE 0x9f

static void OnlinePause_MenuProc(struct RectMenu *menu);
void NativeOnlineGame_FinishHere(void);
static struct MenuRow onlinePauseRows[5];
static struct RectMenu onlinePauseMenu =
{
	.stringIndexTitle = LNG_PAUSED,
	.posX_curr = 0x100,
	.posY_curr = 0x6c,
	.state = ALL_PLAYERS_USE_MENU | RECTMENU_STATE_SMALL_EXEC_CENTERED | BIG_TEXT_IN_TITLE,
	.rows = &onlinePauseRows[0],
	.funcPtr = OnlinePause_MenuProc,
	.drawStyle = 4,
};
// this game frozen by the room's pause ; the pad kept while the karts update without it
static int octrPausedHere;
static struct GamepadBuffer octrMaskedPad;

struct RectMenu *OnlinePause_Menu(void)
{
	return &onlinePauseMenu;
}

// FINISH THE RACE : this kart still racing, every other human's finish in the results
static int OnlinePause_LastHuman(void)
{
	struct Driver *d = sdata->gGT->drivers[0];

	if ((d == NULL) || ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0) || ((sdata->gGT->gameMode1 & BATTLE_MODE) != 0))
		return 0;
	// a race under way : not in the fly-in or the lights
	if ((octr->CurrState != GAME_START_RACE) || (sdata->gGT->trafficLightsTimer > 0) || (sdata->gGT->elapsedEventTime <= 0))
		return 0;
	for (int slot = 1; slot < octr->NumDrivers && slot < 8; slot++)
	{
		int ended = 0;

		if ((octr->nameBuffer[slot][0] == 0) || OnlineSlot_IsBot(slot))
			continue;
		for (int k = 0; k < octr->numDriversEnded; k++)
			if (octr->raceStats[k].slot == slot)
				ended = 1;
		if (!ended)
			return 0;
	}
	return 1;
}

// the rows of this frame : RESUME, FINISH THE RACE (the last human, not frozen), PAUSE / RESUME
// FOR EVERYONE (the host), QUIT ; the cursor stays on its row's label
static void OnlinePause_Rows(void)
{
	int ids[4], n = 0;
	int frozen = octrRoomInfo[ONLINE_ROOM_PAUSED];
	int host = (octr->DriverID == 0);
	int selected = onlinePauseRows[onlinePauseMenu.rowSelected & 3].stringIndex;

	GAME_LANGUAGE_STRINGS[ONLINE_LNG_FINISH] = "FINISH THE RACE";
	GAME_LANGUAGE_STRINGS[ONLINE_LNG_EVERYONE] = frozen ? "RESUME FOR EVERYONE" : "PAUSE FOR EVERYONE";
	if (!(host && frozen))
		ids[n++] = LNG_RESUME;
	if (!frozen && OnlinePause_LastHuman())
		ids[n++] = ONLINE_LNG_FINISH;
	if (host)
		ids[n++] = ONLINE_LNG_EVERYONE;
	ids[n++] = LNG_QUIT;
	for (int i = 0; i < n; i++)
	{
		onlinePauseRows[i].stringIndex = ids[i];
		onlinePauseRows[i].rowOnPressUp = (i > 0) ? i - 1 : 0;
		onlinePauseRows[i].rowOnPressDown = (i < n - 1) ? i + 1 : i;
		onlinePauseRows[i].rowOnPressLeft = i;
		onlinePauseRows[i].rowOnPressRight = i;
	}
	onlinePauseRows[n].stringIndex = RECTMENU_STRING_NONE;
	if ((onlinePauseMenu.rowSelected < 0) || (onlinePauseMenu.rowSelected >= n) || (onlinePauseRows[onlinePauseMenu.rowSelected].stringIndex != selected))
	{
		int keep = 0;

		for (int i = 0; i < n; i++)
			if (ids[i] == selected)
				keep = i;
		onlinePauseMenu.rowSelected = keep;
	}
}

static void OnlinePause_Close(void)
{
	RECTMENU_Hide(sdata->ptrActiveMenu);
	sdata->gGT->cooldownFromUnpauseUntilPause = 5;
}

// the host : the room's race frozen for everyone, or running again ; each game applies the edge in
// OnlinePause_Frame (the guests once their page copied the room info in)
static void OnlinePause_Everyone(int paused)
{
	octrRoomInfo[ONLINE_ROOM_PAUSED] = paused;
	NativeOnlineGame_Log("[OnlineCTR] The host %s the race for everyone\n", paused ? "paused" : "resumed");
}

void OnlinePause_Open(void)
{
	OnlinePause_Rows();
	onlinePauseMenu.rowSelected = 0;
	RECTMENU_Show(&onlinePauseMenu);
	OtherFX_Play(1, 1);
}

static void OnlinePause_MenuProc(struct RectMenu *menu)
{
	int stringID;

	if (menu->funcState != RECTMENU_FUNC_STATE_INPUT)
	{
		OnlinePause_Rows();
		return;
	}
	// Triangle : the menu closes (the host's frozen race keeps its menu : RESUME FOR EVERYONE or Start)
	if (menu->rowSelected < 0)
	{
		if (!((octr->DriverID == 0) && octrRoomInfo[ONLINE_ROOM_PAUSED]))
			OnlinePause_Close();
		return;
	}
	stringID = onlinePauseRows[menu->rowSelected].stringIndex;
	switch (stringID)
	{
		case LNG_RESUME:
			OnlinePause_Close();
			break;
		case ONLINE_LNG_FINISH:
			OnlinePause_Close();
			NativeOnlineGame_FinishHere();
			break;
		case ONLINE_LNG_EVERYONE:
			if (octrRoomInfo[ONLINE_ROOM_PAUSED])
				OnlinePause_Close();
			OnlinePause_Everyone(!octrRoomInfo[ONLINE_ROOM_PAUSED]);
			break;
		case LNG_QUIT:
			// retail's YES / NO ; its NO comes back here (MainFreeze_GetMenuPtr)
			data.menuQuit.rowSelected = 1;
			GAME_DESIRED_MENU = &data.menuQuit;
			break;
		default:
			break;
	}
}

static int OnlinePause_MenuOpen(void)
{
	struct RectMenu *m = sdata->ptrActiveMenu;

	return ((m == &onlinePauseMenu) || (m == &data.menuQuit)) && ((m->state & NEEDS_TO_CLOSE) == 0);
}

// FINISH THE RACE : this kart ends where it stands, at the time the bots' estimate gives it, then
// as the room's timeout ends a race (NativeOnlineGame_EndMyRace) ; with every human done the host
// ends its bots at once (EndBotsWhenHumansDone), so the results come at once
void NativeOnlineGame_FinishHere(void)
{
	struct Driver *d = sdata->gGT->drivers[0];
	const int clock = NativeOnlineGame_RaceClock();

	if (!ONLINE_RACE || (d == NULL) || ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0))
		return;
	d->timeElapsedInRace = EstimateEnd(d, clock, clock);
	d->actionsFlagSet |= ACTION_RACE_TIMER_FROZEN;
	NativeOnlineGame_Log("[OnlineCTR] Finished here : %d ms (clock %d)\n", d->timeElapsedInRace, clock);
	NativeOnlineGame_EndMyRace();
}

int OnlinePause_Frame(void)
{
	struct GameTracker *gGT = sdata->gGT;
	int tap = sdata->gGamepads->gamepad[0].buttonsTapped;
	int paused;

	if (!ONLINE_RACE)
	{
		// the room left (QUIT, a leave) : retail's load clears the freeze
		octrPausedHere = 0;
		return 0;
	}
	octrFreshMenu = 1;
	paused = octrRoomInfo[ONLINE_ROOM_PAUSED] && (sdata->Loading.stage == LOAD_IDLE);
	if (paused && !octrPausedHere)
	{
		octrPausedHere = 1;
		gGT->gameMode1 |= PAUSE_1;
		MainFrame_TogglePauseAudio(1);
		OtherFX_Play(1, 1);
		// the host keeps its menu (RESUME FOR EVERYONE), a guest's closes : Start opens it again
		if ((octr->DriverID != 0) && OnlinePause_MenuOpen())
			RECTMENU_Hide(sdata->ptrActiveMenu);
	}
	else if (!paused && octrPausedHere)
	{
		octrPausedHere = 0;
		gGT->gameMode1 &= ~PAUSE_1;
		MainFrame_TogglePauseAudio(0);
		OtherFX_Play(1, 1);
		if (OnlinePause_MenuOpen())
			RECTMENU_Hide(sdata->ptrActiveMenu);
		gGT->cooldownFromUnpauseUntilPause = 5;
	}

	if (octrPausedHere)
	{
		DecalFont_DrawLine("PAUSED BY THE HOST", 256, 40, FONT_BIG, JUSTIFY_CENTER | ORANGE);
		if ((tap & BTN_START) != 0)
		{
			RECTMENU_ClearInput();
			if (octr->DriverID == 0)
				OnlinePause_Everyone(0);
			else if (OnlinePause_MenuOpen())
				RECTMENU_Hide(sdata->ptrActiveMenu);
			else if (sdata->ptrActiveMenu == NULL)
				OnlinePause_Open();
		}
		return 1;
	}
	// this kart's race ended under the menu : retail's end of race takes over
	if (((gGT->gameMode1 & END_OF_RACE) != 0) && OnlinePause_MenuOpen())
	{
		RECTMENU_Hide(sdata->ptrActiveMenu);
		return 0;
	}
	if (OnlinePause_MenuOpen())
	{
		// retail's cooldown counts down only while paused (MainFrame) : ours never is
		gGT->cooldownfromPauseUntilUnpause = 0;
		if ((tap & BTN_START) != 0)
		{
			RECTMENU_ClearInput();
			OtherFX_Play(1, 1);
			OnlinePause_Close();
		}
		return 1;
	}
	return 0;
}

int OnlinePause_MaskPad(int on)
{
	struct GamepadBuffer *pad = &sdata->gGamepads->gamepad[0];

	if (!on)
	{
		*pad = octrMaskedPad;
		return 0;
	}
	if (!ONLINE_RACE || octrPausedHere || !OnlinePause_MenuOpen())
		return 0;
	octrMaskedPad = *pad;
	pad->buttonsHeldCurrFrame = 0;
	pad->buttonsTapped = 0;
	pad->buttonsReleased = 0;
	pad->stickLX = 0x80;
	pad->stickLY = 0x80;
	pad->stickRX = 0x80;
	pad->stickRY = 0x80;
	return 1;
}

// ---- The host skips the rankings (docs/ONLINECTR_PORT.md, D12.10) ----
// The results, the Cup standings and the final standings wait for the server's reset (6 s after
// the last finish, ROOM_RESET_MS), then a Cup's next track 3 s more : the host's Cross ends that
// wait for everyone. The server runs in the host's page (WebHost_Service) : no wire change, the
// guests follow its SG_NEWCLIENT / SG_TRACK as they would 6 s later. `y` : under the table.
void OnlineRoom_HostSkip(int y)
{
	// a Cross on the pause menu's rows is the menu's
	int cross = (sdata->gGamepads->gamepad[0].buttonsTapped & BTN_CROSS) && !OnlinePause_MenuOpen();

	if (!octrActive || (octr->DriverID != 0))
		return;
	if (octrCupInterlude && (octr->CurrState == LOBBY_HOST_TRACK_PICK) && !octr->boolLockedInLevel)
	{
		// between two Cup races, after the reset : the next track now
		if (cross)
			octrCupHold = 0;
	}
	else if (!((octr->CurrState == GAME_END_RACE) && HasRaceEnded()))
	{
		octrSkipFrames = 0;
		return;
	}
	else if (octrSkipFrames < FPS_DOUBLE(30))
	{
		octrSkipFrames++;
		return;
	}
	else if (cross)
	{
		octrSkipReset = 1;
		octrSkipCupHold = 1;
	}
	DecalFont_DrawLine("CROSS : CONTINUE", 256, y, FONT_SMALL, JUSTIFY_CENTER | WHITE);
}

// The page's lobby moved its guests down a slot after one left (session 32e) : the character
// select moves their state with them (game/230/MM_Characters.c OnlineCharacters_Follow)
void NativeOnlineGame_SlotGone(int slot)
{
	octrSlotGone = slot;
}

// ---- The host's QUIT (the user, 32e) ----
// A host who quits ends the room's race for everyone : the server resets the room now (as 6 s
// after a race), every game goes back as after one, the host to its character select with the
// same players, mode and characters, its guests behind it ; a Cup starts again from its cup
// select. A host who drops out is not this : its guests race on (D11.6).
static int octrQuitReset;

int OnlineRoom_HostQuit(void)
{
	if (!ONLINE_RACE || (octr->DriverID != 0))
		return 0;
	memset(octrRoomInfo, 0, ONLINE_ROOM_BOTS * sizeof(octrRoomInfo[0])); // the Cup is over
	octrRoomInfo[ONLINE_ROOM_PAUSED] = 0;
	if (octrPausedHere)
	{
		// frozen for everyone : running again until the reset's load
		octrPausedHere = 0;
		sdata->gGT->gameMode1 &= ~PAUSE_1;
		MainFrame_TogglePauseAudio(0);
	}
	OnlinePause_Close();
	octrQuitReset = 1;
	NativeOnlineGame_Log("[OnlineCTR] The host quit : the room's race ends for everyone\n");
	return 1;
}

// The page's room, top right on the menus (the user, 32f) : its tag in the font and grey of the
// title's version (MM_MenuFlow.c), never in a race (the HUD's clock is there)
void OnlineRoom_DrawTag(void)
{
	char tag[8], line[16];

	if (!NativeWeb_RoomTag(tag, sizeof(tag)))
		return;
	snprintf(line, sizeof(line), "ROOM %s", tag);
	DecalFont_DrawLine(line, 0x1f6, 0x0c, FONT_SMALL, JUSTIFY_RIGHT | GRAY);
}

// ---- A guest's QUIT (the user, 32f) ----
// It leaves the race, not the room : retail's quit runs (this game to its title, the host's AI on
// its kart in Arcade), and the page keeps the room, shows the host's race and lets the game in again
// at the next lobby (D12.12)
void OnlineRoom_GuestQuit(void)
{
	if (!ONLINE_RACE || (octr->DriverID <= 0))
		return;
	NativeOnlineGame_Log("[OnlineCTR] A guest's QUIT : out of the race, the room kept\n");
	NativeWeb_RoomQuit();
}

int NativeOnlineGame_TakeQuitReset(void)
{
	int quit = octrQuitReset;

	octrQuitReset = 0;
	return quit;
}

// Asked each frame until the reset comes (LOBBY_ASSIGN_ROLE) : the server may not have seen the
// last end yet when the host's table is complete
int NativeOnlineGame_TakeSkipReset(void)
{
	return octrSkipReset;
}
