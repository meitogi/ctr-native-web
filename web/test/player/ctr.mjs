// Shared helpers for the CTR player suites (*.suite.mjs beside this file).
// No top-level side effects : a bare `node --test` imports this harmlessly.
//
// Game state comes from window.__ctr (platform/web_debug_bridge.c, debug web
// builds only), never from pixels.

import { MAIN_MENU, onMainMenu, menuTo as autoMenuTo } from '../../ui/src/lib/autopilot.js'

// The suites' page options. pressFrames : a press must outlast one game frame
// (30 fps) on any display — 8 rAF = 67 ms at 120 Hz, 133 ms at 60 Hz.
export const PLAYER = { gamepad: true, pressFrames: 8 }

// MAIN_MENU (the main menu's rows) and onMainMenu : web/ui/src/lib/autopilot.js's, shared with the page
export { MAIN_MENU, onMainMenu }

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** How often a long wait says where it is. */
export const HEARTBEAT_MS = 10_000

/** A progress line between the harness's PASS / FAIL lines, so a long wait never looks hung. */
export const say = (...a) => console.log(`    · ${new Date().toTimeString().slice(0, 8)}`, ...a)

/** window.__ctr without its track, or null before the first published frame. */
export const state = ctx => ctx.js('if (!window.__ctr) return null; const { track, ...s } = window.__ctr; return s')

/** window.__ctr.track : { levelID, path: [{x, y, z}] }, the level's racing line. */
export const track = ctx => ctx.js('return window.__ctr?.track ?? null')

/** Waits until `pred(__ctr)` holds ; returns that state. */
export async function until(ctx, label, pred, { timeout = 30_000, every = 200 } = {}) {
	const start = Date.now()
	const deadline = start + timeout
	let beat = start + HEARTBEAT_MS
	let s = null
	while (Date.now() < deadline) {
		s = await state(ctx)
		if (s && pred(s)) return s
		if (Date.now() >= beat) {
			say(`still waiting for ${label} (${Math.round((Date.now() - start) / 1000)} s of ${Math.round(timeout / 1000)}) : ${brief(s)}`)
			beat += HEARTBEAT_MS
		}
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


/**
 * Boots to the main menu. The intro (copyright, crate, trophy) would play into
 * the menu by itself, ~45 s after boot with the preload build ; Cross skips it.
 */
export async function bootToMenu(ctx) {
	// The 605 MB preload crosses VS Code's port forwarding, which sometimes
	// drops it (`TypeError: network error` in #log) or stalls it with nothing
	// logged at all : reload, up to 3 tries. A game that runs (`vblank=` lines)
	// with no __ctr is a release build : no point reloading.
	const log = () => ctx.js("return document.getElementById('log')?.textContent ?? ''")
	for (let attempt = 1; ; attempt++) {
		if (!(await state(ctx))) say(`waiting for the game to boot (window.__ctr)${attempt > 1 ? `, attempt ${attempt}` : ''}`)
		const deadline = Date.now() + 120_000
		// a build without the preloaded disc, the disc stored : the boot screen waits for a press
		while (Date.now() < deadline && !(await state(ctx)) && !/network error/.test(await log())) {
			if (await ctx.js("return !!document.getElementById('press-start')").catch(() => false)) {
				say('disc ready in this browser : pressing Enter')
				await ctx.press('Enter')
			}
			await sleep(1000)
		}
		if (await state(ctx)) break
		const text = await log()
		if (attempt === 3 || /vblank=/.test(text)) {
			throw new Error(`no window.__ctr after attempt ${attempt} — is this a debug build ? page log : ${text.trim().split('\n').slice(-3).join(' | ')}`)
		}
		say('no game after 2 min (the data stream over the forwarded port can stall) : reloading')
		await ctx.reload()
	}
	// Skip the intro : Cross while the menu takes no input yet, re-read before
	// every press. A press landing as the menu wakes opens Adventure : Triangle
	// backs out of it.
	// Such a press sets ADVENTURE_MODE while the main menu still reads as the main menu for a
	// moment (the title on its way out, every input ignored) : not idle until it is gone, and
	// still so 1 s after the last press (session 32b, MENU-KEYBOARD / MENU-PAD stuck on row 0).
	const idle = s => onMainMenu(s) && !s.mode?.includes('ADVENTURE_MODE')
	const deadline = Date.now() + 180_000
	let s = await state(ctx)
	if (!idle(s)) say(`game running (${s.screen}) : skipping the intro to the main menu`)
	for (;;) {
		while (!idle(s) && Date.now() < deadline) {
			if (s.menu?.input) await ctx.press('z') // keyboard Z = Triangle
			else await ctx.press('c')
			await sleep(250)
			s = await state(ctx)
		}
		await sleep(1000)
		s = await state(ctx)
		if (idle(s) || Date.now() >= deadline) break
	}
	s = await until(ctx, 'the main menu', idle, { timeout: 5000, every: 250 })
	// Keys go to the focused element ; session 2's suite focused the canvas too.
	await ctx.js("document.getElementById('canvas')?.focus(); return true")
	return s
}

/**
 * Moves the main-menu cursor to `label` with `step(dir)` ('up' / 'down'),
 * asserting each step lands on the next row. Returns the rows visited.
 */
export async function menuTo(ctx, label, step) {
	// The menu acts on a newly pressed button : the next press must come after the game has
	// sampled this one released (one 30 fps frame or more) — 8 rAF.
	return autoMenuTo({
		read: () => state(ctx),
		out: { press: key => step(key === 'ArrowDown' ? 'down' : 'up') },
		label,
		rows: MAIN_MENU,
		settle: () => ctx.frames(8),
	})
}

/**
 * Plays `fn` under ctx.record. index.html routes everything to the speakers through a
 * gain node (`ctrMute`), at zero under the player harness ; the harness taps what reaches the
 * destination, i.e. after that node, so the video is silent. The test browser plays on the
 * host's speakers (the user's Mac) : the sound is lifted only on request, `--set sound=1`
 * (user, session 12 : « désactive ce son quand tu testes »).
 */
export async function recordWithSound(ctx, label, fn) {
	if (ctx.args?.sound !== '1') return ctx.record(label, fn)
	const gain = v => ctx.js(`const m = globalThis.ctrAudio?.context?.ctrMute; if (m) m.gain.value = ${v}; return !!m`)
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
