// Shared helpers for the CTR player suites (*.suite.mjs beside this file).
// No top-level side effects : a bare `node --test` imports this harmlessly.
//
// Game state comes from window.__ctr (platform/web_debug_bridge.c, debug web
// builds only), never from pixels.

// The suites' page options. pressFrames : a press must outlast one game frame
// (30 fps) on any display — 8 rAF = 67 ms at 120 Hz, 133 ms at 60 Hz.
export const PLAYER = { gamepad: true, pressFrames: 8 }

// Main menu rows (D230.rowsMainMenuBasic, game/230/D230.c), as the game spells them.
export const MAIN_MENU = ['ADVENTURE', 'TIME TRIAL', 'ARCADE', 'VS.', 'BATTLE', 'HIGH SCORE', 'SCRAPBOOK']

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** window.__ctr without its track, or null before the first published frame. */
export const state = ctx => ctx.js('if (!window.__ctr) return null; const { track, ...s } = window.__ctr; return s')

/** window.__ctr.track : { levelID, path: [{x, y, z}] }, the level's racing line. */
export const track = ctx => ctx.js('return window.__ctr?.track ?? null')

/** Waits until `pred(__ctr)` holds ; returns that state. */
export async function until(ctx, label, pred, { timeout = 30_000, every = 200 } = {}) {
	const deadline = Date.now() + timeout
	let s = null
	while (Date.now() < deadline) {
		s = await state(ctx)
		if (s && pred(s)) return s
		await sleep(every)
	}
	throw new Error(`timed out after ${Math.round(timeout / 1000)}s waiting for ${label} (last: ${brief(s)})`)
}

/** One line of __ctr for messages. */
export function brief(s) {
	if (!s) return 'no window.__ctr — is this a debug build?'
	const menu = s.menu ? ` menu=${JSON.stringify(s.menu.title)}/${s.menu.row}:${JSON.stringify(s.menu.label)}${s.menu.input ? '' : '(no input)'}` : ''
	const k = s.kart
	const kart = k && s.screen !== 'menu' ? ` lap=${k.lap}/${s.numLaps} speed=${k.speed} rank=${k.rank} cp=${k.checkpoint}` : ''
	return `screen=${s.screen} level=${s.levelID} mode=${s.mode.join('|')}${menu}${kart} vblank=${s.vblank} fps=${s.fps}`
}

/** True on the main menu taking input (any row selected). */
export const onMainMenu = s => s.screen === 'menu' && s.menu != null && s.menu.input && MAIN_MENU.includes(s.menu.label)

/**
 * Boots to the main menu. The intro (copyright, crate, trophy) would play into
 * the menu by itself, ~45 s after boot with the preload build ; Cross skips it.
 */
export async function bootToMenu(ctx) {
	// The 605 MB preload crosses VS Code's port forwarding, which sometimes
	// drops it (`TypeError: network error` in #log, blank canvas) : reload,
	// up to 3 tries, as session 2's suite does.
	const dropped = "return /network error/.test(document.getElementById('log')?.textContent ?? '')"
	for (let attempt = 1; ; attempt++) {
		const deadline = Date.now() + 180_000
		while (Date.now() < deadline && !(await state(ctx)) && !(await ctx.js(dropped))) await sleep(1000)
		if (await state(ctx)) break
		if (attempt === 3 || !(await ctx.js(dropped))) {
			const log = await ctx.js("return (document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-3).join(' | ')")
			throw new Error(`no window.__ctr after attempt ${attempt} — is this a debug build ? page log : ${log}`)
		}
		await ctx.reload()
	}
	// Skip the intro : Cross while the menu takes no input yet, re-read before
	// every press. A press landing as the menu wakes opens Adventure : Triangle
	// backs out of it.
	const deadline = Date.now() + 180_000
	let s = await state(ctx)
	while (!onMainMenu(s) && Date.now() < deadline) {
		if (s.menu?.input) await ctx.press('z') // keyboard Z = Triangle
		else await ctx.press('c')
		await sleep(250)
		s = await state(ctx)
	}
	s = await until(ctx, 'the main menu', onMainMenu, { timeout: 5000, every: 250 })
	// Keys go to the focused element ; session 2's suite focused the canvas too.
	await ctx.js("document.getElementById('canvas')?.focus(); return true")
	return s
}

/**
 * Moves the main-menu cursor to `label` with `step(dir)` ('up' / 'down'),
 * asserting each step lands on the next row. Returns the rows visited.
 */
export async function menuTo(ctx, label, step) {
	const visited = []
	for (let i = 0; i < MAIN_MENU.length; i++) {
		const s = await state(ctx)
		visited.push(s.menu.label)
		if (s.menu.label === label) return visited
		const target = MAIN_MENU.indexOf(label)
		const dir = MAIN_MENU.indexOf(s.menu.label) < target ? 'down' : 'up'
		const row = s.menu.row
		await step(dir)
		await until(ctx, `the cursor to leave row ${row}`, n => n.menu != null && n.menu.row !== row, { timeout: 3000 })
		// The menu acts on a newly pressed button : the next press must come
		// after the game has sampled this one released (one 30 fps frame or more).
		await ctx.frames(8)
	}
	throw new Error(`never reached ${label} (visited ${visited.join(' → ')})`)
}

/**
 * Plays `fn` under ctx.record with the page's mute lifted. index.html routes
 * everything to the speakers through a zero-gain `ctrMute` node unless
 * `?sound` ; the harness taps what reaches the destination, i.e. after that
 * node. Lifting it for the recording puts sound in the video — and on the
 * test browser's speakers for that long.
 */
export async function recordWithSound(ctx, label, fn) {
	const gain = v => ctx.js(`const m = globalThis.Module?.SDL3?.audioContext?.ctrMute; if (m) m.gain.value = ${v}; return !!m`)
	await gain(1)
	try {
		return await ctx.record(label, fn)
	} finally {
		await gain(0)
	}
}

/** Asserts the VBlank clock advances over `ms` ; returns the VBlanks counted. */
export async function vblankAdvances(ctx, ms = 2000) {
	const a = await state(ctx)
	await sleep(ms)
	const b = await state(ctx)
	const n = b.vblank - a.vblank
	// 59.82 Hz : allow a wide band, the point is « advancing at game speed ».
	if (n < (ms / 1000) * 40) throw new Error(`VBlank advanced ${n} in ${ms} ms (from ${a.vblank} to ${b.vblank})`)
	return n
}
