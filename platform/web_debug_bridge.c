// window.__ctr : game state for the browser test suites (web/test/player/).
//
// Debug web builds only (__EMSCRIPTEN__ && !NDEBUG, the gate of the
// `[CTR Web] pad0` log lines) ; release builds compile none of it.
//
// C pushes, JS never calls in (ASYNCIFY) : WebDebugBridge_Publish() runs once
// per presented frame, at the end of Platform_EndScene, after that frame's
// game logic, and one EM_JS call rewrites window.__ctr as a plain object.
//
// Fields and their sources :
//   frame        presents since boot (counted here)
//   vblank       VSync(-1) = s_nativeVBlankCount, the 59.82 Hz game clock
//   fps          presents per second over the last second (performance.now)
//   gameMode1    gGT->gameMode1 (namespace_Main.h flags) ; `mode` = its set
//                flag names, `screen` = derived from it (see below)
//   gameMode2    gGT->gameMode2
//   levelID      gGT->levelID (enum LevelID, namespace_Level.h :
//                MAIN_MENU_LEVEL = 39, CRASH_COVE = 3 …)
//   numLaps      gGT->numLaps
//   lights       gGT->trafficLightsTimer : > 0 while the countdown runs,
//                decremented by elapsedTimeMS in MainMain.c, floored at -960
//   raceTime     gGT->elapsedEventTime (ms)
//   menu         sdata->ptrActiveMenu (RECTMENU_Show, NULL when none) :
//                title = lngStrings[stringIndexTitle], row = rowSelected,
//                label = lngStrings[rows[rowSelected].stringIndex & 0x7fff]
//                (bit 0x8000 = MENU_ROW_LOCKED), state = the menu's flags,
//                input = !(state & DISABLE_INPUT_ALLOW_FUNCPTRS) : the main
//                menu is active during the title intro with input disabled,
//                MM_Title.c clears the flag at TITLE_INTRO_MENU_READY_FRAME
//   kart         gGT->drivers[0] (player 1), null when no driver :
//                lap      lapIndex, 0 on the first lap, ++ in PlayLevel.c
//                speed    speedApprox, signed, > 0 forward (VehFrame.c :
//                         < 1 = stationary animation)
//                rank     driverRank, 0 = first place (PlayLevel.c)
//                finished actionsFlagSet & ACTION_RACE_FINISHED
//                pos      posCurr >> 8, world units (VehLap.c's shift)
//                angle    angle, the kart's yaw, 0..4095 = one turn
//                         (written in VehPhysGeneral.c / VehPhysProc.c) ;
//                         the kart moves along (sin, cos)(angle) in (x, z),
//                         Right lowers it (measured on Crash Cove)
//                checkpoint checkpoint.currentIndex (VehLap.c)
//                target   level1->ptr_restart_points, two nodes ahead of
//                         `checkpoint` along nextIndex_forward : a point on
//                         the track to steer toward
//                toFinish distanceToFinish_curr
//   track        level1->LevNavTable[0], the racing line the AI drives
//                (BOTS.c ; magic 0xECFD, NAVHEADER_GETFRAME) : { levelID,
//                path: [{x, y, z}] } in world units, published once per level

#include <emscripten.h>

EM_JS(void, WebDebugBridge_PushJS,
      (int vblank, int gameMode1, int gameMode2, int levelID, int numLaps, int lights, int raceTime,
       int hasMenu, const char *menuTitle, int menuRow, const char *menuLabel, int menuState,
       int hasKart, int lap, int speed, int rank, int finished, int posX, int posY, int posZ, int angle,
       int checkpoint, int targetX, int targetZ, int toFinish),
{
	const prev = globalThis.__ctr;
	const now = performance.now();
	const frame = prev ? prev.frame + 1 : 1;
	let fpsFrom = prev ? prev.fpsFrom : now;
	let fpsFrame = prev ? prev.fpsFrame : frame;
	let fps = prev ? prev.fps : 0;
	if (now - fpsFrom >= 1000) {
		fps = Math.round(((frame - fpsFrame) * 10000) / (now - fpsFrom)) / 10;
		fpsFrom = now;
		fpsFrame = frame;
	}
	// Game strings are 8-bit, not UTF-8 : read them byte by byte.
	const str = p => {
		let s = "";
		if (!p) return s;
		for (let b = HEAPU8[p]; b !== 0; b = HEAPU8[++p]) s += String.fromCharCode(b);
		return s;
	};
	const FLAGS1 = [
		[0x1, "PAUSE_1"], [0x2, "PAUSE_2"], [0x4, "PAUSE_3"], [0x8, "PAUSE_4"],
		[0x10, "DEBUG_MENU"], [0x20, "BATTLE_MODE"], [0x40, "START_OF_RACE"],
		[0x1000, "WARPBALL_HELD"], [0x2000, "MAIN_MENU"], [0x4000, "POINT_LIMIT"],
		[0x8000, "LIFE_LIMIT"], [0x10000, "TIME_LIMIT"], [0x20000, "TIME_TRIAL"],
		[0x80000, "ADVENTURE_MODE"], [0x100000, "ADVENTURE_ARENA"], [0x200000, "END_OF_RACE"],
		[0x400000, "ARCADE_MODE"], [0x4000000, "RELIC_RACE"], [0x8000000, "CRYSTAL_CHALLENGE"],
		[0x10000000, "ADVENTURE_CUP"], [0x20000000, "GAME_CUTSCENE"], [0x40000000, "LOADING"],
		[0x80000000, "ADVENTURE_BOSS"],
	];
	const m1 = gameMode1 >>> 0;
	const mode = [];
	for (const [bit, name] of FLAGS1) if ((m1 & bit) >>> 0) mode.push(name);
	let screen = "race";
	if (m1 & 0x40000000) screen = "loading";
	else if (m1 & 0x2000) screen = "menu";
	else if (m1 & 0x20000000) screen = "cutscene";
	else if (m1 & 0x200000) screen = "finished";
	else if (m1 & 0xf) screen = "paused";
	else if (m1 & 0x40) screen = "intro";
	else if (lights > 0) screen = "countdown";
	globalThis.__ctr = {
		frame, vblank, fps, fpsFrom, fpsFrame,
		screen, mode, gameMode1: m1, gameMode2: gameMode2 >>> 0,
		levelID, numLaps, lights, raceTime,
		track: globalThis.__ctrTrack ?? null,
		menu: hasMenu ? { title: str(menuTitle), row: menuRow, label: str(menuLabel), state: menuState >>> 0, input: !(menuState & 0x20) } : null,
		kart: hasKart ? {
			lap, speed, rank, finished: !!finished,
			pos: { x: posX, y: posY, z: posZ }, angle,
			checkpoint, target: checkpoint < 0 ? null : { x: targetX, z: targetZ }, toFinish: toFinish >>> 0,
		} : null,
	};
});

EM_JS(void, WebDebugBridge_PushPathJS, (int levelID, const s16 *frames, int count, int stride),
{
	const path = [];
	for (let i = 0; i < count; i++) {
		const at = (frames >> 1) + i * (stride >> 1);
		path.push({ x: HEAP16[at], y: HEAP16[at + 1], z: HEAP16[at + 2] });
	}
	globalThis.__ctrTrack = { levelID, path };
});

internal const char *WebDebugBridge_String(s16 stringIndex)
{
	if ((sdata->lngStrings == NULL) || (stringIndex == RECTMENU_STRING_NONE))
	{
		return NULL;
	}

	return sdata->lngStrings[(u16)stringIndex & ~MENU_ROW_LOCKED];
}

internal void WebDebugBridge_Publish(void)
{
	struct GameTracker *gGT = sdata->gGT;
	struct RectMenu *menu = sdata->ptrActiveMenu;
	struct Driver *d;
	const char *menuTitle = NULL;
	const char *menuLabel = NULL;
	int menuRow = -1;
	int menuState = 0;
	int checkpoint = -1;
	int targetX = 0;
	int targetZ = 0;

	if (gGT == NULL)
	{
		return;
	}

	{
		static struct NavHeader *s_publishedPath = NULL;
		struct NavHeader *nh = NULL;

		if ((gGT->level1 != NULL) && (gGT->level1->LevNavTable != NULL))
		{
			nh = gGT->level1->LevNavTable[0];
		}
		if ((nh != NULL) && ((u16)nh->magicNumber != 0xECFD))
		{
			nh = NULL;
		}
		if (nh != s_publishedPath)
		{
			s_publishedPath = nh;
			WebDebugBridge_PushPathJS(gGT->levelID, nh ? (const s16 *)NAVHEADER_GETFRAME(nh) : NULL, nh ? nh->numPoints : 0,
			                          sizeof(struct NavFrame));
		}
	}

	if (menu != NULL)
	{
		menuTitle = WebDebugBridge_String(menu->stringIndexTitle);
		menuRow = menu->rowSelected;
		menuState = menu->state;
		if ((menu->rows != NULL) && (menuRow >= 0))
		{
			menuLabel = WebDebugBridge_String(menu->rows[menuRow].stringIndex);
		}
	}

	d = gGT->drivers[0];
	if (d != NULL)
	{
		struct Level *level = gGT->level1;

		if ((level != NULL) && (level->ptr_restart_points != NULL) && (d->checkpoint.currentIndex < level->cnt_restart_points))
		{
			struct CheckpointNode *nodes = level->ptr_restart_points;
			int next = nodes[d->checkpoint.currentIndex].nextIndex_forward;

			if (next < level->cnt_restart_points)
			{
				next = nodes[next].nextIndex_forward;
			}
			if (next < level->cnt_restart_points)
			{
				checkpoint = d->checkpoint.currentIndex;
				targetX = nodes[next].pos.x;
				targetZ = nodes[next].pos.z;
			}
		}
	}

	WebDebugBridge_PushJS(VSync(-1), gGT->gameMode1, gGT->gameMode2, gGT->levelID, gGT->numLaps, gGT->trafficLightsTimer,
	                      gGT->elapsedEventTime, menu != NULL, menuTitle, menuRow, menuLabel, menuState, d != NULL, d ? d->lapIndex : 0,
	                      d ? d->speedApprox : 0, d ? d->driverRank : 0, d ? ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0) : 0,
	                      d ? (d->posCurr.x >> 8) : 0, d ? (d->posCurr.y >> 8) : 0, d ? (d->posCurr.z >> 8) : 0, d ? (d->angle & 0xfff) : 0, checkpoint, targetX,
	                      targetZ, d ? (int)d->distanceToFinish_curr : 0);
}
