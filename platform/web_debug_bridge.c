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
//   sub          the deepest open submenu under `menu` (ptrNextBox_InHierarchy while
//                DRAW_NEXT_MENU_IN_HIERARCHY is set : Arcade › Single / Cup, VS ›
//                2P / 3P / 4P…), same fields as `menu`, null when none
//   players      gGT->numPlyrCurrGame, the screens of the split screen
//   karts        gGT->drivers[0 .. players-1], each with the same fields as `kart`
//                (karts[1] = P2 : Share's bot steers it), null entries for missing
//                drivers
//                wumpa numWumpas · item heldItemID (DriverHeldItem, 0xf none) · roll itemRollTimer
//                (> 0 while the ? roulette runs) · crates numTimesHitWeaponBox — the item
//                path, for the online tests (RB_Crate.c, VehPickupItem.c)
//                invisible invisibleTimer · invincible invincibleTimer · drawn bit v set when
//                the kart's instance was drawn in view v this frame (DRAW_SUCCESSFUL) · lods
//                byte v = the LOD index (idpp[v].lodIndex) it was queued with in view v ·
//                impostor bit v set when view v shows it as the split-screen impostor sprite
//                (HIDE_MODEL in its idpp[v], set by DecalMP_02)
//   pools        { thread, small } : free entries of gGT->JitPools.thread / .smallStack, -1 while a level loads (a
//                crate's thread is born on first contact, RB_CrateAny_LInC_Birth ; an empty
//                pool leaves it intact)
//   charSelect   while the character select is the active menu (D230.menuCharacterSelect) :
//                { locked } = sdata->characterSelectFlags, bit n set once player n
//                locked a character (MM_Characters.c) ; null otherwise
//   net          ON builds, in an online race : the remote karts as this screen draws them
//                (per-present position, SG_RACEDATA applied, corrections) — the block above
//                WebDebugBridge_Publish, `__ctr.net.summary()` / `.reset()`
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

// Runs right after WebDebugBridge_PushJS, on the object it just wrote.
EM_JS(void, WebDebugBridge_PushMoreJS,
      (int hasSub, const char *subTitle, int subRow, const char *subLabel, int subState, int players, const s32 *karts, int charSelect,
       int poolThread, int poolSmall),
{
	const c = globalThis.__ctr;
	if (!c) return;
	c.pools = { thread: poolThread, small: poolSmall };
	const str = p => (p ? UTF8ToString(p) : null);
	c.sub = hasSub ? { title: str(subTitle), row: subRow, label: str(subLabel), state: subState >>> 0, input: !(subState & 0x20) } : null;
	c.players = players;
	c.charSelect = charSelect < 0 ? null : { locked: charSelect };
	c.karts = [];
	for (let i = 0; i < players; i++) {
		const k = HEAP32.subarray((karts >> 2) + i * 22, (karts >> 2) + (i + 1) * 22);
		c.karts.push(k[0] ? {
			lap: k[1], speed: k[2], rank: k[3], finished: !!k[4],
			pos: { x: k[5], y: k[6], z: k[7] }, angle: k[8],
			checkpoint: k[9], target: k[9] < 0 ? null : { x: k[10], z: k[11] }, toFinish: k[12] >>> 0,
			wumpa: k[13], item: k[14], roll: k[15], crates: k[16],
			invisible: k[17], invincible: k[18], drawn: k[19], lods: k[20], impostor: k[21],
		} : null);
	}
	// The kart counter (session 22), with the flicker counter on : per present, for each view
	// and each other kart, was it drawn there (DRAW_SUCCESSFUL of its instance in that view) ?
	// Hidden by the game's own rules = its invisibleTimer runs (the Invisibility item, hidden
	// in the other views, RB_Player_ToggleInvisible) or the odd-frame flicker of invincibleTimer
	// > 0x2a0 (RB_Player_ToggleFlicker). `ahead` : the kart within `near` world units and 35°
	// of the view's own kart heading, where the camera looks. lod[n] : drawn at LOD n ; impostor :
	// drawn as the split-screen impostor sprite (its 3D model hidden in that view, DecalMP_02).
	const f = globalThis.__ctrFlicker;
	if (f && players >= 2) {
		const k = f.karts = f.karts ?? { frames: 0, ahead: 0, seen: 0, ruled: 0, hidden: 0, lod: [0, 0, 0, 0], impostor: 0, log: [] };
		const near = f.near ?? 2000;
		k.frames++;
		for (let v = 0; v < players; v++) {
			for (let j = 0; j < players; j++) {
				const a = c.karts[v];
				const b = c.karts[j];
				if (j === v || !a || !b) continue;
				const drawn = (b.drawn >> v) & 1;
				const ruled = b.invisible > 0 || b.invincible > 0x2a0;
				const dx = b.pos.x - a.pos.x;
				const dz = b.pos.z - a.pos.z;
				const dist = Math.hypot(dx, dz);
				const t = (a.angle * 2 * Math.PI) / 4096;
				const ahead = dist > 0 && dist < near && (dx * Math.sin(t) + dz * Math.cos(t)) / dist > Math.cos(Math.PI * 35 / 180);
				if (!ahead) continue;
				k.ahead++;
				if (drawn) {
					k.seen++;
					// the LOD the kart was queued with in that view
					const lod = (b.lods >> (v * 8)) & 3;
					k.lod[lod]++;
					if ((b.impostor >> v) & 1) k.impostor++;
					// kept : 2 per LOD, the kart within 10° of the heading and 300–1500 units away (not
					// behind the view's own kart)
					const centred = (dx * Math.sin(t) + dz * Math.cos(t)) / dist > Math.cos(Math.PI / 18) && dist > 300 && dist < 1500;
					const shot = k.shot ?? (k.shot = [0, 0, 0, 0]);
					if (f.keepLods && centred && shot[lod] < 2 && k.frames - (k.lastShot ?? -99) > 30) { shot[lod]++; k.lastShot = k.frames; f.grab = `lod${lod}-view${v}-kart${j}-d${Math.round(dist)}`; }
				}
				else if (ruled) k.ruled++;
				else {
					k.hidden++;
					if (k.log.length < 200) k.log.push({ frame: c.frame, view: v, kart: j, dist: Math.round(dist) });
				}
			}
		}
	}
	if (c.kart && c.karts[0]) Object.assign(c.kart, { wumpa: c.karts[0].wumpa, item: c.karts[0].item, roll: c.karts[0].roll, crates: c.karts[0].crates });
});

// prim  { used, guard, cap } : gGT->backBuffer->primMem for the frame just presented —
//       cursor - start, guardEnd - start, end - start, in bytes. The game's allocators refuse
//       a primitive that would cross guardEnd, so used close to guard = something not drawn.
EM_JS(void, WebDebugBridge_PushPrimJS, (int used, int guard, int cap),
{
	const c = globalThis.__ctr;
	if (c) {
		c.prim = { used, guard, cap };
	}
});

// The flicker counter (session 22), off until a page sets globalThis.__ctrFlicker = {} (a
// suite) : then, per present, the displayed VRAM rectangle cut in 32 × 16 tiles, one hash per
// tile ; a tile whose hash goes A B A over three presents blinked (the middle frame). Counts
// accumulate on the object : frames, bad (frames with a blink), events (tiles × blinks),
// tiles[] (blinks per tile, row-major, cols × rows), log (the first 400 bad frames), primMax /
// primGuard (the highest `prim.used` of the counted frames, the guard). With
// keep: n, the first n blinked frames are kept as RGBA (kept[], { frame, w, h, rgba }).
EM_JS(int, WebDebugBridge_FlickerOnJS, (void), { return globalThis.__ctrFlicker ? 1 : 0; });

EM_JS(void, WebDebugBridge_FlickerJS,
      (int w, int h, int cols, int rows, const u8 *blink, int count, const u16 *pixels, int vblank, int used, int guard, int tile0, int tile1, int fruitPx),
{
	const f = globalThis.__ctrFlicker;
	const c = globalThis.__ctr;
	if (!f) return;
	const frame = c ? c.frame : 0;
	if (f.cols !== cols || f.rows !== rows) Object.assign(f, { cols, rows, tiles: new Array(cols * rows).fill(0) });
	f.w = w;
	f.h = h;
	f.frames = (f.frames ?? 0) + 1;
	f.primMax = Math.max(f.primMax ?? 0, used);
	// split screen : a kart shown as an impostor in view v (DecalMP, its 3D model hidden there)
	// samples atlas tile v, the HUD fruit samples its own VRAM area — empty = nothing on screen
	if (tile0 >= 0) {
		const imp = f.impostor = f.impostor ?? { frames: 0, empty: 0, fruitFrames: 0, fruitEmpty: 0 };
		[tile0, tile1].forEach((lit, v) => {
			if (!(c?.karts ?? []).some(k => k && ((k.impostor >> v) & 1))) return;
			imp.frames++;
			if (lit === 0) imp.empty++;
		});
		if (fruitPx >= 0) {
			imp.fruitFrames++;
			if (fruitPx === 0) imp.fruitEmpty++;
		}
	}
	f.primGuard = guard;
	f.bad = f.bad ?? 0;
	f.events = f.events ?? 0;
	f.log = f.log ?? [];
	f.kept = f.kept ?? [];
	const rgba = p => {
		const out = new Uint8ClampedArray(w * h * 4);
		const px = HEAPU16.subarray(p >> 1, (p >> 1) + w * h);
		for (let i = 0; i < w * h; i++) {
			const v = px[i];
			out[i * 4] = (v & 31) << 3;
			out[i * 4 + 1] = ((v >> 5) & 31) << 3;
			out[i * 4 + 2] = ((v >> 10) & 31) << 3;
			out[i * 4 + 3] = 255;
		}
		return out;
	};
	if (count > 0) {
		const at = [];
		for (let t = 0; t < cols * rows; t++) if (HEAPU8[blink + t]) { f.tiles[t]++; at.push(t); }
		f.bad++;
		f.events += count;
		if (f.log.length < 400) f.log.push({ frame: frame - 1, vblank, tiles: at, used, guard });
		// the blinked frame is the previous one : kept from the last call
		if (f.kept.length < (f.keep ?? 0) && f.prev) f.kept.push({ frame: frame - 1, w, h, rgba: f.prev, next: rgba(pixels) });
	}
	f.prev = (f.keep ?? 0) > f.kept.length ? rgba(pixels) : null;
	if (f.grab) { f.kept.push({ frame, w, h, rgba: rgba(pixels), tag: f.grab }); f.grab = null; }
});

// With vram: n on the flicker object, the whole 1024 × 512 VRAM is kept n times (kept[],
// tag « vram »), a second apart, from vramAfter counted presents : the off-screen areas (the 2P
// impostor atlas, the HUD fruit).
EM_JS(int, WebDebugBridge_VramWantedJS, (void),
{
	const f = globalThis.__ctrFlicker;
	if (!f || !f.vram || (f.frames ?? 0) < (f.vramAfter ?? 0)) return 0;
	const now = performance.now();
	if (f.vramAt && now - f.vramAt < 1000) return 0;
	return 1;
});

EM_JS(void, WebDebugBridge_VramJS, (const u16 *pixels, int w, int h),
{
	const f = globalThis.__ctrFlicker;
	if (!f) return;
	const out = new Uint8ClampedArray(w * h * 4);
	const px = HEAPU16.subarray(pixels >> 1, (pixels >> 1) + w * h);
	for (let i = 0; i < w * h; i++) {
		const v = px[i];
		out[i * 4] = (v & 31) << 3;
		out[i * 4 + 1] = ((v >> 5) & 31) << 3;
		out[i * 4 + 2] = ((v >> 10) & 31) << 3;
		out[i * 4 + 3] = 255;
	}
	f.kept = f.kept ?? [];
	f.kept.push({ frame: globalThis.__ctr ? globalThis.__ctr.frame : 0, w, h, rgba: out, tag: 'vram' });
	f.vram--;
	f.vramAt = performance.now();
});

#define WEB_FLICKER_TILE_W 32
#define WEB_FLICKER_TILE_H 16
#define WEB_FLICKER_TILES ((VRAM_WIDTH / WEB_FLICKER_TILE_W) * (VRAM_HEIGHT / WEB_FLICKER_TILE_H))

internal void WebDebugBridge_Flicker(struct GameTracker *gGT)
{
	local_persist u32 s_hash[3][WEB_FLICKER_TILES];
	local_persist RECT16 s_rect;
	local_persist int s_filled = 0;
	local_persist int s_slot = 0;
	u8 blink[WEB_FLICKER_TILES];
	const RECT16 r = { activeDispEnv.disp.x, activeDispEnv.disp.y, activeDispEnv.disp.w, activeDispEnv.disp.h };
	const int cols = (r.w + WEB_FLICKER_TILE_W - 1) / WEB_FLICKER_TILE_W;
	const int rows = (r.h + WEB_FLICKER_TILE_H - 1) / WEB_FLICKER_TILE_H;
	const u16 *px;
	struct PrimMem *pm = &gGT->backBuffer->primMem;
	int count = 0;

	if (!WebDebugBridge_FlickerOnJS())
	{
		s_filled = 0;
		return;
	}
	if (WebDebugBridge_VramWantedJS())
	{
		WebDebugBridge_VramJS(NativeRenderer_DebugReadDisplay(0, 0, VRAM_WIDTH, VRAM_HEIGHT), VRAM_WIDTH, VRAM_HEIGHT);
	}
	px = NativeRenderer_DebugReadDisplay(r.x, r.y, r.w, r.h);
	if (px == NULL)
	{
		return;
	}
	// the double buffer moves the rectangle between two VRAM halves every present : only a new
	// size restarts the history
	if ((s_rect.w != r.w) || (s_rect.h != r.h))
	{
		s_rect = r;
		s_filled = 0;
	}
	s_slot = (s_slot + 1) % 3;
	for (int t = 0; t < cols * rows; t++)
	{
		const int tx = (t % cols) * WEB_FLICKER_TILE_W;
		const int ty = (t / cols) * WEB_FLICKER_TILE_H;
		u32 h = 2166136261u;

		for (int y = ty; (y < ty + WEB_FLICKER_TILE_H) && (y < r.h); y++)
		{
			for (int x = tx; (x < tx + WEB_FLICKER_TILE_W) && (x < r.w); x++)
			{
				h = (h ^ (px[y * r.w + x] & 0x7fff)) * 16777619u;
			}
		}
		s_hash[s_slot][t] = h;
	}
	if (s_filled < 2)
	{
		s_filled++;
		return;
	}
	for (int t = 0; t < cols * rows; t++)
	{
		const u32 a = s_hash[(s_slot + 1) % 3][t];
		const u32 b = s_hash[(s_slot + 2) % 3][t];
		const u32 n = s_hash[s_slot][t];

		blink[t] = (u8)((a == n) && (a != b));
		count += blink[t];
	}
	{
		// 2P : the impostor atlas right of the framebuffers — DecalMP_01 fills its entries view by
		// view, DecalMP_03 gives them the 0x60 × 0x40 tiles at x 0x200 (view 0) and 0x260 (view 1),
		// y 0x180 : the lit pixels of each ; the HUD fruit's area (UI_RenderFrame_Wumpa3D_2P3P4P),
		// while the race HUD is on. -1 when not measured.
		int tile[2] = { -1, -1 };
		int fruitPx = -1;

		if (gGT->numPlyrCurrGame == 2)
		{
			const RECT16 fr = { GAME_WUMPA_HUD_VIEWPORTS[0].x, GAME_WUMPA_HUD_VIEWPORTS[0].y, GAME_WUMPA_HUD_VIEWPORTS[0].w, GAME_WUMPA_HUD_VIEWPORTS[0].h };
			const u16 *a = NativeRenderer_DebugReadDisplay(0x200, 0x180, 0xc0, 0x40);

			tile[0] = 0;
			tile[1] = 0;
			for (int i = 0; (a != NULL) && (i < 0xc0 * 0x40); i++)
			{
				tile[(i % 0xc0) >= 0x60] += (a[i] & 0x7fff) != 0;
			}
			if ((gGT->hudFlags & HUD_FLAG_RACE_HUD) != 0)
			{
				a = NativeRenderer_DebugReadDisplay(fr.x, fr.y, fr.w, fr.h);
				fruitPx = 0;
				for (int i = 0; (a != NULL) && (i < fr.w * fr.h); i++)
				{
					fruitPx += (a[i] & 0x7fff) != 0;
				}
			}
			// the read-backs reused the display buffer : read the display again for the RGBA copies
			px = NativeRenderer_DebugReadDisplay(r.x, r.y, r.w, r.h);
		}
		WebDebugBridge_FlickerJS(r.w, r.h, cols, rows, blink, count, px, VSync(-1), (int)((u8 *)pm->cursor - (u8 *)pm->start),
		                         (int)((u8 *)pm->guardEnd - (u8 *)pm->start), tile[0], tile[1], fruitPx);
	}
}

internal const char *WebDebugBridge_String(s16 stringIndex)
{
	if ((sdata->lngStrings == NULL) || (stringIndex == RECTMENU_STRING_NONE))
	{
		return NULL;
	}

	return sdata->lngStrings[(u16)stringIndex & ~MENU_ROW_LOCKED];
}

// Entries of a pool's free list, -1 while a level loads (the lists point into memory the
// load pops and reuses until JitPool_Init). Bounded by the pool's size.
internal int WebDebugBridge_PoolFree(const struct JitPool *pool)
{
	int n = 0;

	if (sdata->Loading.stage != LOAD_IDLE)
	{
		return -1;
	}
	for (const struct Item *it = pool->free.first; (it != NULL) && (n <= pool->maxItems); it = it->next)
	{
		n++;
	}
	return n;
}

// A point on the track ahead of driver `d` : the restart point two nodes past its checkpoint.
// Returns the checkpoint index, -1 (and no point) when the level has none.
internal int WebDebugBridge_Target(struct GameTracker *gGT, struct Driver *d, int *x, int *z)
{
	struct Level *level = gGT->level1;
	struct CheckpointNode *nodes;
	int next;

	if ((level == NULL) || (level->ptr_restart_points == NULL) || (d->checkpoint.currentIndex >= level->cnt_restart_points))
	{
		return -1;
	}
	nodes = level->ptr_restart_points;
	next = nodes[d->checkpoint.currentIndex].nextIndex_forward;
	if (next < level->cnt_restart_points)
	{
		next = nodes[next].nextIndex_forward;
	}
	if (next >= level->cnt_restart_points)
	{
		return -1;
	}
	*x = nodes[next].pos.x;
	*z = nodes[next].pos.z;
	return d->checkpoint.currentIndex;
}

#ifdef USE_ONLINE
// ---- window.__ctr.net (session 11) : the remote karts as this screen draws them ----
//
// Per present and per remote driver slot (gGT->drivers[1..7]) : its position (posCurr >> 8), the
// SG_RACEDATA applied to it since the last present (the bridge drains the network once per frame,
// after the driver stages), and the largest correction one of them made — the received pose minus
// where the kart's own local physics had taken it (remote karts drive themselves with the received
// pad between packets, game/OnlineCTR/vehThread.c). Kept in globalThis.__ctrNet (window.__ctr is
// rewritten every present) ; `__ctr.net.summary()` reduces the last frames to rates and
// percentiles, `__ctr.net.reset()` starts a new window. Read by web/test/player/online-net.suite.mjs.
#include <math.h>

#include "native_online.h"

#define WEB_NET_SLOTS 8
static int s_netPackets[WEB_NET_SLOTS];
static int s_netJump[WEB_NET_SLOTS];

static void WebDebugBridge_NetRaceData(int slot, int posX, int posY, int posZ)
{
	struct Driver *d;
	int dx, dy, dz, jump;

	if ((slot <= 0) || (slot >= WEB_NET_SLOTS) || (sdata->gGT == NULL) || ((d = sdata->gGT->drivers[slot]) == NULL))
	{
		return;
	}
	dx = (posX - d->posCurr.x) >> 8;
	dy = (posY - d->posCurr.y) >> 8;
	dz = (posZ - d->posCurr.z) >> 8;
	jump = (int)sqrtf((float)(dx * dx + dy * dy + dz * dz));
	s_netPackets[slot]++;
	if (jump > s_netJump[slot])
	{
		s_netJump[slot] = jump;
	}
}

EM_JS(void, WebDebugBridge_PushNetJS, (const s32 *slots, int count), {
	// no nullish assignment here : its two question marks and = are a C trigraph
	const N = globalThis.__ctrNet || (globalThis.__ctrNet = (() => {
		const KEEP = 1800; // frames per slot : one minute at 30 fps
		const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
		const net = {
			slots: {},
			reset() { net.slots = {}; },
			// per slot, over the frames kept since the last reset : packets per second ; frames with
			// no packet / with several ; time between frames that got one (ms, frame-quantised) and the
			// gaps over 100 ms ; the kart's step per frame (world units) and its change from one frame to
			// the next (a snap is a spike) ; the corrections the packets made
			summary() {
				const out = {};
				for (const slot in net.slots) {
					const f = net.slots[slot];
					const n = f.t.length;
					if (n < 2) continue;
					const secs = (f.t[n - 1] - f.t[0]) / 1000;
					const steps = [], jerks = [], gaps = [], jumps = [];
					let none = 0, multi = 0, packets = 0, lastPacket = -1;
					for (let i = 0; i < n; i++) {
						packets += f.p[i];
						if (f.p[i] === 0) none++;
						if (f.p[i] > 1) multi++;
						if (f.p[i] > 0) {
							jumps.push(f.j[i]);
							if (lastPacket >= 0) gaps.push(f.t[i] - f.t[lastPacket]);
							lastPacket = i;
						}
						if (i > 0) {
							const step = Math.hypot(f.x[i] - f.x[i - 1], f.z[i] - f.z[i - 1]);
							if (steps.length) jerks.push(Math.abs(step - steps[steps.length - 1]));
							steps.push(step);
						}
					}
					const r = (v) => (v == null ? null : Math.round(v * 10) / 10);
					out[slot] = {
						frames: n, secs: r(secs), packetsPerSec: r(packets / secs),
						noPacketPct: r((100 * none) / n), multiPct: r((100 * multi) / n),
						interArrival: { p50: r(pct(gaps, 50)), p95: r(pct(gaps, 95)), max: r(Math.max(0, ...gaps)) }, gapsOver100: gaps.filter((g) => g > 100).length,
						step: { p50: r(pct(steps, 50)), p95: r(pct(steps, 95)), max: r(Math.max(0, ...steps)) },
						jerk: { p50: r(pct(jerks, 50)), p95: r(pct(jerks, 95)), max: r(Math.max(0, ...jerks)) },
						jump: { p50: r(pct(jumps, 50)), p95: r(pct(jumps, 95)), max: r(Math.max(0, ...jumps)) },
					};
				}
				return out;
			},
			push(slot, t, x, z, p, j) {
				const f = net.slots[slot] || (net.slots[slot] = { t: [], x: [], z: [], p: [], j: [] });
				f.t.push(t); f.x.push(x); f.z.push(z); f.p.push(p); f.j.push(j);
				if (f.t.length > KEEP) for (const k in f) f[k].shift();
			},
		};
		return net;
	})());
	const now = performance.now();
	for (let i = 0; i < count; i++) {
		const [slot, x, z, p, j] = HEAP32.subarray((slots >> 2) + i * 5, (slots >> 2) + (i + 1) * 5);
		N.push(slot, now, x, z, p, j);
	}
	if (globalThis.__ctr) globalThis.__ctr.net = N;
});

internal void WebDebugBridge_PublishNet(struct GameTracker *gGT)
{
	s32 out[WEB_NET_SLOTS * 5];
	int count = 0;

	NativeOnline_DebugRaceData = WebDebugBridge_NetRaceData;
	if (!ONLINE_RACE)
	{
		memset(s_netPackets, 0, sizeof(s_netPackets));
		memset(s_netJump, 0, sizeof(s_netJump));
		return;
	}
	for (int slot = 1; slot < WEB_NET_SLOTS; slot++)
	{
		struct Driver *d = gGT->drivers[slot];
		s32 *o = &out[count * 5];

		if (d == NULL)
		{
			continue;
		}
		o[0] = slot;
		o[1] = d->posCurr.x >> 8;
		o[2] = d->posCurr.z >> 8;
		o[3] = s_netPackets[slot];
		o[4] = s_netJump[slot];
		s_netPackets[slot] = 0;
		s_netJump[slot] = 0;
		count++;
	}
	if (count > 0)
	{
		WebDebugBridge_PushNetJS(out, count);
	}
}
#endif

// ---- window.__ctr.audio (session 21) : the audio output, seen from the page ----
//
// Kept in globalThis.__ctrAudio (window.__ctr is rewritten every present), from window.ctrAudio
// (web/audio/audio.js) and native_audio.c's own push :
//   path          'worklet' : the SPU mixes in an AudioWorklet (spu.wasm), off the main thread
//   sampleRate, block (frames per render quantum), baseLatency / outputLatency (s), state,
//   bufferMs (the command buffer), ready (the worklet runs)
//   blocks        render quanta the worklet mixed
//   underruns     null : the worklet mixes on the audio thread, which the page cannot watch ;
//                 audio.suite.mjs meters the output signal itself (its dropout meter)
//   batches, lateBatches, worstLateMs  the game's command batches, and those that reached the
//                 worklet after their stamp + bufferMs (heard late, never as a gap)
//   longestGapMs  the longest wall-clock gap between two worklet ticks seen by the page (the
//                 hidden page's wake clock)
//   workletMixerMsPerSec  the worklet's mixing time (Date.now(), 1 ms steps) ; mixerMsPerSec the
//                 main thread's (0 : it no longer mixes)
//   times         performance.now() of each tick since boot (20 000 at most)
//   late          { at: stamp, ms } of the late batches since boot
//   spu / spuTotal / spuHistory  pushed by native_audio.c once per 60 VBlanks : the game's SPU
//                 calls and bytes, and how late each VBlank came against its due time
//   reset()       starts a new window (counters only)
// __ctrStall = { ms, every } : a debug busy loop of `ms` in one frame every `every` ms (or once
// when `every` is 0) — the late frame the audio must survive.
EM_JS(void, WebDebugBridge_AudioJS, (void), {
	const A = (globalThis.__ctrAudio = globalThis.__ctrAudio || {});
	const audio = globalThis.ctrAudio;
	if (!A.reset) A.reset = () => audio && audio.resetStats && audio.resetStats();
	if (audio && audio.context) {
		const ctx = audio.context;
		const s = audio.stats;
		const secs = (performance.now() - s.since) / 1000;
		Object.assign(A, {
			path: 'worklet', sampleRate: ctx.sampleRate, block: 128, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency, state: ctx.state,
			bufferMs: audio.bufferMs, ready: !!audio.node, blocks: s.quanta, underruns: null, missedMs: null, batches: s.batches,
			lateBatches: s.lateBatches, worstLateMs: s.worstLateMs, longestGapMs: s.longestGapMs,
			workletMixerMsPerSec: secs > 0 ? Math.round((s.workletMixMs / secs) * 10) / 10 : 0, mixerMsPerSec: 0,
			times: audio.times, late: audio.late, glitches: [],
		});
	}
	if (globalThis.__ctr) globalThis.__ctr.audio = A;
});

EM_JS(int, WebDebugBridge_StallJS, (void), {
	const S = globalThis.__ctrStall;
	if (!S || !S.ms) return 0;
	const now = performance.now();
	if (S.at && now - S.at < (S.every || 0)) return 0;
	if (S.at && !S.every) return 0;
	S.at = now;
	S.count = (S.count || 0) + 1;
	return S.ms | 0;
});

internal void WebDebugBridge_Stall(void)
{
	const int ms = WebDebugBridge_StallJS();

	if (ms > 0)
	{
		const double start = emscripten_get_now();

		while (emscripten_get_now() - start < ms)
		{
		}
	}
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
		checkpoint = WebDebugBridge_Target(gGT, d, &targetX, &targetZ);
	}

	WebDebugBridge_PushJS(VSync(-1), gGT->gameMode1, gGT->gameMode2, gGT->levelID, gGT->numLaps, gGT->trafficLightsTimer,
	                      gGT->elapsedEventTime, menu != NULL, menuTitle, menuRow, menuLabel, menuState, d != NULL, d ? d->lapIndex : 0,
	                      d ? d->speedApprox : 0, d ? d->driverRank : 0, d ? ((d->actionsFlagSet & ACTION_RACE_FINISHED) != 0) : 0,
	                      d ? (d->posCurr.x >> 8) : 0, d ? (d->posCurr.y >> 8) : 0, d ? (d->posCurr.z >> 8) : 0, d ? (d->angle & 0xfff) : 0, checkpoint, targetX,
	                      targetZ, d ? (int)d->distanceToFinish_curr : 0);

	{
		struct RectMenu *sub = NULL;
		const char *subTitle = NULL;
		const char *subLabel = NULL;
		s32 karts[4 * 22];
		int players = gGT->numPlyrCurrGame;

		for (struct RectMenu *m = menu; (m != NULL) && (m->state & DRAW_NEXT_MENU_IN_HIERARCHY) && (m->ptrNextBox_InHierarchy != NULL);
		     m = m->ptrNextBox_InHierarchy)
		{
			sub = m->ptrNextBox_InHierarchy;
		}
		if (sub != NULL)
		{
			subTitle = WebDebugBridge_String(sub->stringIndexTitle);
			if ((sub->rows != NULL) && (sub->rowSelected >= 0))
			{
				subLabel = WebDebugBridge_String(sub->rows[sub->rowSelected].stringIndex);
			}
		}
		if (players > 4)
		{
			players = 4;
		}
		for (int i = 0; i < players; i++)
		{
			struct Driver *k = gGT->drivers[i];
			s32 *o = &karts[i * 22];
			int tx = 0;
			int tz = 0;

			o[0] = k != NULL;
			if (k == NULL)
			{
				continue;
			}
			o[9] = WebDebugBridge_Target(gGT, k, &tx, &tz);
			o[1] = k->lapIndex;
			o[2] = k->speedApprox;
			o[3] = k->driverRank;
			o[4] = (k->actionsFlagSet & ACTION_RACE_FINISHED) != 0;
			o[5] = k->posCurr.x >> 8;
			o[6] = k->posCurr.y >> 8;
			o[7] = k->posCurr.z >> 8;
			o[8] = k->angle & 0xfff;
			o[10] = tx;
			o[11] = tz;
			o[12] = (s32)k->distanceToFinish_curr;
			o[13] = k->numWumpas;
			o[14] = (s32)k->heldItemID;
			o[15] = k->itemRollTimer;
			o[16] = k->numTimesHitWeaponBox;
			o[17] = k->invisibleTimer;
			o[18] = k->invincibleTimer;
			o[19] = 0;
			o[20] = 0;
			o[21] = 0;
			// drivers[] is stale in the menus and while a level loads (lap 40, rank 2397) : its
			// instSelf is a pointer to follow in a race only
			const int racing = (sdata->Loading.stage == LOAD_IDLE) && ((gGT->gameMode1 & (MAIN_MENU | LOADING)) == 0);

			for (int v = 0; racing && (k->instSelf != NULL) && (v < players); v++)
			{
				o[19] |= ((k->instSelf->idpp[v].instFlags & DRAW_SUCCESSFUL) != 0) << v;
				o[20] |= (k->instSelf->idpp[v].lodIndex & 0xff) << (v * 8);
				o[21] |= ((k->instSelf->idpp[v].instFlags & HIDE_MODEL) != 0) << v;
			}
		}
		WebDebugBridge_PushMoreJS(sub != NULL, subTitle, sub ? sub->rowSelected : -1, subLabel, sub ? (int)sub->state : 0, players, karts,
		                          menu == &D230.menuCharacterSelect ? (int)(sdata->characterSelectFlags & 0xf) : -1,
		                          WebDebugBridge_PoolFree(&gGT->JitPools.thread), WebDebugBridge_PoolFree(&gGT->JitPools.smallStack));
	}

	if (gGT->backBuffer != NULL)
	{
		struct PrimMem *pm = &gGT->backBuffer->primMem;

		WebDebugBridge_PushPrimJS((int)((u8 *)pm->cursor - (u8 *)pm->start), (int)((u8 *)pm->guardEnd - (u8 *)pm->start),
		                          (int)((u8 *)pm->end - (u8 *)pm->start));
		WebDebugBridge_Flicker(gGT);
	}
#ifdef USE_ONLINE
	WebDebugBridge_PublishNet(gGT);
#endif
	WebDebugBridge_AudioJS();
	WebDebugBridge_Stall();
}
