#ifndef ONLINE_NATIVE_COMPAT_H
#define ONLINE_NATIVE_COMPAT_H

// Names the OnlineCTR mod (CTR-ModSDK text) uses that ctr-native renamed or
// dropped, so the mod files stay upstream text. docs/ONLINECTR_PORT.md, D2.

// ctr-native dropped the DECOMP_ prefix
#define DECOMP_CAM_StartOfRace CAM_StartOfRace
#define DECOMP_DecalFont_DrawLine DecalFont_DrawLine
#define DECOMP_DecalFont_DrawLineStrlen DecalFont_DrawLineStrlen
#define DECOMP_LOAD_IsOpen_RacingOrBattle LOAD_IsOpen_RacingOrBattle
#define DECOMP_MainFreeze_ConfigDrawArrows MainFreeze_ConfigDrawArrows
#define DECOMP_MainRaceTrack_RequestLoad MainRaceTrack_RequestLoad
#define DECOMP_OtherFX_Play OtherFX_Play
#define DECOMP_PROC_CollidePointWithSelf PROC_CollidePointWithSelf
#define DECOMP_RB_MinePool_Init RB_MinePool_Init
#define DECOMP_RECTMENU_DrawInnerRect RECTMENU_DrawInnerRect
#define DECOMP_RECTMENU_DrawSelf RECTMENU_DrawSelf
#define DECOMP_RECTMENU_GetWidth RECTMENU_GetWidth
#define DECOMP_UI_DrawDriverIcon UI_DrawDriverIcon
#define DECOMP_VehBirth_Player VehBirth_Player
#define DECOMP_VehBirth_TeleportSelf VehBirth_TeleportSelf
#define DECOMP_VehPickupItem_ShootNow VehPickupItem_ShootNow

// ctr-native runs at 30 fps only and removed the USE_60FPS macros
#define FPS_DOUBLE(x) (x)

typedef unsigned int u_int;

// Upstream online builds also define USE_DRIVERLOD: high-LOD models of all
// 8 drivers, written past data.driverModelExtras[3]. ctr-native pins the
// layout of struct Data, so they get their own array.
#define ONLINE_DRIVER_MODEL_COUNT 8
extern DriverModelExtraSlot onlineDriverModelExtras[ONLINE_DRIVER_MODEL_COUNT];

// One build : OnlineCTR is turned on at runtime (docs/ONLINECTR_PORT.md, D8).
// Every game-side USE_ONLINE block tests one of these instead of the flag
// alone ; with no room joined the ON build plays the OFF game.
extern int octrActive;        // a room is joined
extern int octrBootOnline;    // boot into the mod's own flow (native default ; the web sets 0)
extern int octrExternalLobby; // the lobby is the game's own menus + the page (web) : the mod draws no lobby
extern int octrOnlineMenuPath; // the main menu's ONLINE row was taken : the track lock starts the room's race
extern int octrLobbyPhase;    // enum OnlineLobbyPhase, read by the page
extern int octrLobbyCharacters[8]; // the menus' character per slot at the track lock, read by the page
extern int octrThreadAlive;   // the mod thread runs on this level
extern const unsigned char onlineItemSetRace2[0x34], onlineItemSetRace3[0x14], onlineItemSetRace4[0x14];
#define ONLINE_LNG_ROW 0x9a // a language-table slot no code reads ; the mod's menus use 0x9a-0xa1 the same way

enum OnlineLobbyPhase
{
	ONLINE_LOBBY_NONE,     // no room
	ONLINE_LOBBY_MENUS,    // in a room, the host is in the game's menus
	ONLINE_LOBBY_STARTING, // the host locked the track : characters go out, the race loads
	ONLINE_LOBBY_RACE,     // this level is the room's race
};

#define ONLINE_ROOM (octrActive)
// The room's race : from the first load stage of its level (LOAD_TenStages
// clears MAIN_MENU there) to the load away from it. The menu level that waits
// for SG_STARTLOADING, and keeps rendering under the flag, stays retail.
#define ONLINE_RACE (octrActive && (octr->CurrState >= LOBBY_START_LOADING) && ((sdata->gGT->gameMode1 & MAIN_MENU) == 0))

void OnlineRuntime_Activate(void);
void OnlineRuntime_Deactivate(void);
void OnlineRuntime_SyncStats(void);
void OnlineRuntime_LeaveRace(void);
void OnlineExternal_State(void);
int OnlineLobby_RequestRace(void);
void OnlineLobby_SetMyCharacter(int characterID);

#endif
