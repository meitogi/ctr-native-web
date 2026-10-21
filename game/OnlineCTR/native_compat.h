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

#endif
