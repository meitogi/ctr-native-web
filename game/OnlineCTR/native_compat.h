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
extern int octrOnlineArcade;  // the ONLINE row's ARCADE was taken (D11.8)
extern int octrLobbyArcade;   // the host's track lock came from ONLINE > ARCADE : bots fill the room
extern int octrLobbyPlayers;  // the menus' players at the host's last track lock : the character select after the race
extern int octrSlotGone;      // host only : the lobby slot (1-3) a guest just left, the ones above moved down (session 32e)
extern int octrHostBots;      // host only : bit per slot driven by the host's AI (D11.2), read by the page
// a host bot's shot, as octr->Shoot[0] for the host's own kart (D11.4)
extern struct OnlineBotShoot { unsigned char boolNow, Weapon, boolJuiced, flags; } octrBotShoot[8];
#define ONLINE_HOST_BOT(slot) (octrActive && ((octrHostBots >> (slot)) & 1))

// Session 32 : what the host tells its guests beside the wire (docs/ONLINECTR_PORT.md, D12), in our
// LOBBY message ; the host writes it, each guest's page copies it in. By clientID.
enum OnlineRoomInfo
{
	ONLINE_ROOM_CUP,       // a Cup is on
	ONLINE_ROOM_CUP_ID,    // its cup (data.ArcadeCups)
	ONLINE_ROOM_CUP_RACES, // races counted so far (1-4)
	ONLINE_ROOM_POINTS,    // 8 totals, by clientID
	ONLINE_ROOM_BOTS = ONLINE_ROOM_POINTS + 8, // the clientIDs the host's AI drives (bit per clientID)
	ONLINE_ROOM_PAUSED,    // session 32d : the host paused the room's race for everyone
	ONLINE_ROOM_INFO_LEN,
};
extern int octrRoomInfo[ONLINE_ROOM_INFO_LEN];
extern int octrCupInterlude; // between two races of a Cup : the race level stays, its standings drawn
int OnlineSlot_IsBot(int slot);   // a bot's kart, or one the AI took over : its name in the bots' colour
void OnlineRoom_EndOfRace(void);  // every frame of the end of race : the humans left ; a Cup counted (host), its standings
int OnlineCup_Showing(void);      // the standings replace the results
// Session 32d, the Netplay pause (D12.9) and the host's skip (D12.10)
struct RectMenu *OnlinePause_Menu(void); // the pause menu of a room's race (MainFreeze_GetMenuPtr)
void OnlinePause_Open(void);      // Start in a room's race : the menu, the race running on
int OnlinePause_Frame(void);      // every frame (MainFrame) : 1 when it owns Start and the pause this frame
int OnlinePause_MaskPad(int on);  // around the karts' update : no drive input while the menu is open
void OnlineRoom_HostSkip(int y);  // the host's « Cross : continue » under a table, and its Cross
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
// Between two races of a Cup the room's lobby states run on the race level (D12.1) : still its race.
#define ONLINE_RACE (octrActive && ((octr->CurrState >= LOBBY_START_LOADING) || octrCupInterlude) && ((sdata->gGT->gameMode1 & MAIN_MENU) == 0))

void OnlineRuntime_Activate(void);
void OnlineRuntime_Deactivate(void);
void OnlineRuntime_SyncStats(void);
void OnlineRuntime_LeaveRace(void);
void OnlineExternal_State(void);
int OnlineLobby_RequestRace(void);
void OnlineLobby_SetMyCharacter(int characterID);

#endif
