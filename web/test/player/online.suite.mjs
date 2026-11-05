// Player suite : Online 2-tab. The suite's tab hosts a room (sv_core runs in its wasm, the
// lobby is its own game's menus, shared to the guest as Share does), a second tab opens the
// room link as the guest ; the host plays ONLINE → VS → characters (the room's 2) → track with
// the keyboard, the guest locks its character with its own keys (they reach the host as P2's
// pad), each game loads its own race, both hold Cross, and each side must see the other's kart
// move. Once over WebRTC (P2P), once with the guest forced onto the relay's WebSocket path
// (openRoom mode: ws ; the guest then plays the lobby without the host's picture). Then a whole
// race : both karts follow the racing line and fire their items, both screens filmed with their
// sound and put side by side. The guest runs in a second agent browser when the run has one
// (instance b, its own Chromium and CDP connection), else in a second tab.
//
// RUN
//   Build : web/build-web.sh debug -DCTR_ONLINE=ON -DCTR_WEB_PRELOAD_DISC=OFF
//           (one build, session 14 : it boots the normal game ; the disc is stored in OPFS
//           once per origin by the test hook, then each tab reloads from it)
//   Serve : ln -sf "$PWD/assets/ctr-u.bin" build-web-debug/ctr-u.bin
//           python3 web/test/player/serve.py build-web-debug 8092
//   Relay : (cd relay && npm ci && RELAY_KEY=<key> PORT=8787 node relay.js)
//   Play  : bash plans/ctr-native-web/tools/play.sh online <session> 8092 -- \
//             --set relay=ws://localhost:8787 --set rk=<key>
//           (play.sh adds --set proofs=<its proofs root> — the item race files the guest's
//           screen there — and, when agent browser b answers, --set guestCdp=<its endpoint>)
//   Both ports in AGENT_BROWSER_ORIGINS and forwarded. Browsers : the agent browser (host)
//   and its instance b (guest ; `agent-browser -i b`, host:9224 in the firewall).
// Not a node --test file : `node --test web/test/*.test.js` never loads it.
//
// State : window.__ctrOnline.state() (web/online/page.js : octr, links, per-slot kart samples
// taken by the bridge after the game's pad polling) and window.__ctr (debug builds).
// Also answers OnlineCTR's live checks (docs/ONLINECTR_PORT.md « Session 9 findings ») :
// R6 — bridge calls per second in every client state, from octr.windowsClientSync ;
// R7 — the guest's held Cross, sampled on the host after its own pad polling.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { capture, connect, fetchBrowserWsUrl } from '/opt/devcontainer/base/skills/visual-loop/scripts/cdp.mjs'
import { makePlayer, pageScript } from '/opt/devcontainer/base/skills/visual-loop/lib/player.mjs'
import { HEARTBEAT_MS, PLAYER, menuTo, onMainMenu, recordWithSound, say } from './ctr.mjs'
import * as autopilot from '../../ui/src/lib/autopilot.js'

export const meta = {
	url: 'http://localhost:8092/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// game/OnlineCTR/global.h
export const ST = { PICK_SERVER: 1, PICK_ROOM: 2, HOST_TRACK_PICK: 5, GUEST_TRACK_WAIT: 6, CHARACTER_PICK: 7, START_RACE: 11, END_RACE: 12 }
// game/OnlineCTR/native_compat.h OnlineLobbyPhase (window.__ctrOnline.state().lobby.phase)
export const PHASE = { none: 0, menus: 1, starting: 2, race: 3 }
const CROSS = 'c' // keyboard C = Cross (platform/native_input.c)
const BTN_CROSS = 0x10 // Cross in the pad word the bridge writes for a remote driver
const RACE_MS = 10_000
const CG_WEAPON = 6 // global.h ClientGiveMessageType
const SG_WEAPON = 8 // global.h ServerGiveMessageType

// Bridge calls per octr state : windowsClientSync is a char the bridge bumps once per call.
const R6_PROBE = `if (!window.__r6) {
	const R = window.__r6 = { byState: {}, last: null, at: performance.now() }
	setInterval(() => {
		const o = window.__ctrOnline?.state().octr
		if (!o) return
		const now = performance.now()
		if (R.last) {
			const s = R.byState[R.last.state] ??= { frames: 0, ms: 0 }
			s.frames += (o.windowsClientSync - R.last.sync + 256) % 256
			s.ms += now - R.at
		}
		R.last = { state: o.CurrState, sync: o.windowsClientSync }
		R.at = now
	}, 50)
}
return true`

/** The page's online state, or null before the panel is up. */
export const online = tab => tab.js('return window.__ctrOnline ? window.__ctrOnline.state() : null')

/** The page in one line, for progress and failure messages. */
const pageLog = tab => tab.js(`return [location.href, document.visibilityState, document.getElementById('boot-status')?.textContent,
	document.getElementById('drop-error')?.textContent, 'game script ' + !!document.querySelector('script[src="ctr_native.js"]'),
	'focus ' + (document.activeElement?.tagName + '#' + (document.activeElement?.id || '') + (document.activeElement?.closest?.('#ctr-settings') ? ' in settings' : '')) + ', settings ' + (document.getElementById('ctr-settings')?.checkVisibility?.() ? 'open' : 'closed') + ', focused ' + document.hasFocus(),
	(document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-4).join(' | '),
	'online log ' + (document.getElementById('log')?.textContent ?? '').split('\\n').filter(l => l.includes('[OnlineCTR]') && !/\\] frame \\d+: state/.test(l)).slice(-12).join(' | '),
	'last error at ' + (window.__ctrLastError?.at ?? '?') + ' ' + (window.__ctrLastError?.stack ?? 'none').split('\\n').slice(0, 14).join(' < ')].join(' ; ')`).catch(e => e.message)

export async function until(tab, label, pred, timeout = 30_000, every = 250) {
	const start = Date.now()
	const deadline = start + timeout
	let beat = start + HEARTBEAT_MS
	let s = null
	while (Date.now() < deadline) {
		s = await online(tab).catch(() => null)
		if (s && pred(s)) return s
		if (Date.now() >= beat) {
			// a refused disc never recovers : stop now rather than at the timeout
			const refused = await tab.js("return document.getElementById('drop-error')?.textContent ?? ''").catch(() => '')
			if (refused) throw new Error(`${tab.name} : disc refused while waiting for ${label} : ${refused}`)
			say(`${tab.name} : still waiting for ${label} (${Math.round((Date.now() - start) / 1000)} s of ${Math.round(timeout / 1000)}) : state ${s?.octr?.CurrState ?? 'no game yet'}${s?.error ? `, ${s.error}` : ''}`)
			beat += HEARTBEAT_MS
		}
		await sleep(every)
	}
	throw new Error(`${tab.name} : timed out after ${Math.round(timeout / 1000)}s waiting for ${label} (last state ${s?.octr?.CurrState}, ${s?.error || s?.lastError?.message || 'no error'} ; page log : ${await pageLog(tab)})`)
}

/** The game's own state (window.__ctr, debug builds), without the racing line. */
export const game = tab => tab.js('if (!window.__ctr) return null; const { track, ...s } = window.__ctr; return s')

/**
 * The game's main menu, with its input on : the intro skipped with Cross while the menu takes
 * no input yet (ctr.mjs bootToMenu), re-read before every press.
 */
export async function toMainMenu(tab) {
	// the page's log keeps an error's message only : keep the last error's stack for pageLog (debug builds name the wasm frames)
	await tab.js(`if (!window.__ctrLastError) {
		window.__ctrLastError = {}
		const at = () => { try { const c = window.__ctr, o = window.__ctrOnline?.state(); return JSON.stringify({ screen: c?.screen, menu: c?.menu?.label, level: c?.level, octr: o?.octr?.CurrState, lobby: o?.lobby }) } catch (e) { return String(e) } }
		window.addEventListener('error', e => { window.__ctrLastError.stack = String(e.error?.stack || e.message); window.__ctrLastError.at = at() })
		window.addEventListener('unhandledrejection', e => { window.__ctrLastError.stack = String(e.reason?.stack || e.reason); window.__ctrLastError.at = at() })
	} return true`)
	const deadline = Date.now() + 180_000
	let beat = Date.now() + HEARTBEAT_MS
	// a Cross landing as the menu wakes picks ADVENTURE : the title leaves, still reading as the
	// main menu for a moment, every input ignored (ctr.mjs bootToMenu, session 32b)
	const idle = s => s && onMainMenu(s) && !s.mode?.includes('ADVENTURE_MODE')
	let s = await game(tab)
	for (;;) {
		while (!idle(s) && Date.now() < deadline) {
			if (s?.menu?.input) await tab.press('z') // keyboard Z = Triangle : out of a menu a press opened
			else await tab.press(CROSS)
			await sleep(250)
			s = await game(tab)
			if (Date.now() >= beat) { say(`${tab.name} : still skipping the intro (${s?.screen ?? 'no __ctr yet'})`); beat += HEARTBEAT_MS }
		}
		await sleep(1000)
		s = await game(tab)
		if (idle(s) || Date.now() >= deadline) break
	}
	if (!idle(s)) throw new Error(`${tab.name} : never reached the main menu (${s?.screen}, ${JSON.stringify(s?.menu)})`)
	await tab.js("document.getElementById('canvas')?.focus(); return true")
	return s
}

/** Loads `url` in `tab` and boots the game to its main menu ; stores the disc in OPFS once. */
export async function boot(tab, url) {
	// A load that starts while the previous page of this tab is still pulling the 13 MB debug
	// wasm through the port forward can stall with no wasm request at all : leave the page
	// first, and retry a boot that logs nothing (as ctr.mjs's bootToMenu does for the preload).
	for (let attempt = 1; ; attempt++) {
		await tab.navigate(new URL('/preload-flag.js', url).href)
		await sleep(1000)
		await tab.navigate(url)
		const deadline = Date.now() + 30_000
		let loaded = true
		while (!(await tab.js('return document.readyState === "complete" && typeof window.__ctrTestHandleFileFromUrl === "function"').catch(() => false))) {
			if (Date.now() > deadline) { loaded = false; break }
			await sleep(250)
		}
		// The same stall can hit the page itself (its load never completes) : another load.
		if (!loaded) {
			if (attempt === 3) throw new Error(`${tab.name} : the page never loaded after ${attempt} loads (${await tab.js('return location.href').catch(e => e.message)})`)
			continue
		}
		// the stored disc found : the boot screen waits for the player's press (#press-start)
		const screen = Date.now() + 30_000
		let shown
		while (!(shown = await tab.js('return document.getElementById("press-start") ? "ready" : document.getElementById("drop-zone") && !document.getElementById("boot-status").textContent ? "drop" : document.getElementById("boot").classList.contains("hidden") ? "running" : ""').catch(() => ''))) {
			if (Date.now() > screen) throw new Error(`${tab.name} : no boot screen after 30 s (${await pageLog(tab)})`)
			await sleep(250)
		}
		if (shown === 'ready') {
			say(`${tab.name} : disc ready in this browser, pressing Enter`)
			await tab.press('Enter')
		} else if (shown === 'drop') {
			// 605 MB over the port forward the first time : start it, watch the drop zone go away
			await tab.js(`void window.__ctrTestHandleFileFromUrl(location.origin + '/ctr-u.bin'); return true`)
			say(`${tab.name} : storing the disc in this browser (605 MB, once per origin)`)
			const stored = Date.now() + 900_000
			let beat = Date.now() + HEARTBEAT_MS
			for (;;) {
				const s = await tab.js('return { hidden: document.getElementById("boot").classList.contains("hidden"), error: document.getElementById("drop-error").textContent }')
				if (s.error) throw new Error(`${tab.name} : disc refused : ${s.error}`)
				if (s.hidden) break
				if (Date.now() > stored) throw new Error(`${tab.name} : the disc never reached OPFS`)
				if (Date.now() >= beat) {
					say(`${tab.name} : still storing the disc : ${await tab.js("return document.getElementById('boot-status')?.textContent ?? ''").catch(() => '')}`)
					beat += HEARTBEAT_MS
				}
				await sleep(2000)
			}
		}
		// The game prints its first lines within seconds of the wasm arriving.
		const started = Date.now() + 60_000
		while (Date.now() < started && !(await tab.js("return /\\[OnlineCTR\\]|vblank=/.test(document.getElementById('log')?.textContent ?? '')").catch(() => false))) await sleep(500)
		if (await tab.js("return /\\[OnlineCTR\\]|vblank=/.test(document.getElementById('log')?.textContent ?? '')").catch(() => false)) break
		if (attempt === 3) throw new Error(`${tab.name} : the game never started after ${attempt} loads (${await pageLog(tab)})`)
		say(`${tab.name} : no game output 60 s after load ${attempt}, reloading (${await pageLog(tab)})`)
	}
	// one build : the normal game boots ; the room is joined from the title
	await until(tab, 'the Online panel', s => !!s, 180_000)
	await toMainMenu(tab)
	await tab.js(R6_PROBE)
}

/** As until(), on the game's own state (window.__ctr). */
export async function untilGame(tab, label, pred, timeout = 30_000, every = 250) {
	const start = Date.now()
	let beat = start + HEARTBEAT_MS
	let s = null
	while (Date.now() - start < timeout) {
		s = await game(tab).catch(() => null)
		if (s && pred(s)) return s
		if (Date.now() >= beat) { say(`${tab.name} : still waiting for ${label} (${Math.round((Date.now() - start) / 1000)} s) : ${s?.screen}, ${s?.menu?.label ?? ''}`); beat += HEARTBEAT_MS }
		await sleep(every)
	}
	throw new Error(`${tab.name} : timed out waiting for ${label} (${s?.screen}, menu ${JSON.stringify(s?.menu)}, charSelect ${JSON.stringify(s?.charSelect)})`)
}

/** Distance a slot's kart covered over the samples. */
function moved(samples, slot) {
	const xs = samples.filter(k => k?.slots[slot].exists).map(k => k.slots[slot])
	return xs.length > 1 ? Math.round(Math.hypot(xs.at(-1).posX - xs[0].posX, xs.at(-1).posZ - xs[0].posZ)) : 0
}

const rates = r6 => {
	const out = {}
	for (const s in r6) out[s] = r6[s].ms > 500 ? Math.round(((r6[s].frames * 1000) / r6[s].ms) * 10) / 10 : null
	return out
}

/**
 * From the host's character select to the room's race : the host locks P1, the guest's Cross
 * reaches the host as P2's pad, the host's Cross on the first track locks it ; both in the race.
 */
export async function charactersToRace(host, guest) {
	await sleep(1000)
	// the host locks P1 ; the guest's Cross reaches the host as P2's pad (presses landing as the
	// menu opens are lost : again until locked)
	for (let i = 0; i < 6 && !((await game(host))?.charSelect?.locked & 1); i++) {
		await host.press(CROSS)
		await sleep(800)
	}
	for (let i = 0; i < 8 && !((await game(host))?.charSelect?.locked & 2); i++) {
		await guest.press(CROSS)
		await sleep(800)
	}
	await untilGame(host, 'both characters locked', s => !s.charSelect || (s.charSelect.locked & 3) === 3, 15_000)
	say('both characters locked : the first track (the lock starts the room\'s race)')
	for (let i = 0; i < 16 && (await online(host)).octr.CurrState === ST.HOST_TRACK_PICK; i++) {
		if (!(await game(host))?.charSelect) await host.press(CROSS)
		await sleep(700)
	}
	await until(host, 'the track sent (OnlineCTR character pick)', s => s.octr.CurrState >= ST.CHARACTER_PICK, 15_000)
	await until(guest, 'the character from the host', s => s.octr.CurrState >= ST.CHARACTER_PICK && s.lobby.phase >= PHASE.starting, 15_000)
	for (const tab of [host, guest]) await until(tab, 'the race (SG_STARTRACE)', s => s.octr.CurrState === ST.START_RACE, 180_000, 500)
	for (const tab of [host, guest]) if ((await online(tab)).lobby.phase !== PHASE.race) throw new Error(`${tab.name} : lobby phase ${(await online(tab)).lobby.phase} in the race`)
}

/**
 * A room and its first race : `host` is the suite's own tab (ctx) ; the guest gets a tab of its
 * own (or the second browser), driven with the same player harness. `inject` : page scripts
 * both pages get before they load (web/net/test/impair.js). Resolves at SG_STARTRACE on both
 * sides with { host, guest, gp, gjs, gl, hl, leave, close } — `close()` lets the guest's browser go.
 * `arcade` : ONLINE → ARCADE → single race → the difficulty's default (session 23, the
 * host's bots fill the race up to 8 karts) instead of ONLINE → VS → single race. No players
 * menu (session 32b) : the room's two humans play.
 * `cup` : the race type's CUP instead (session 32, D12), then the first cup of the cup select.
 */
export async function roomToRace(ctx, mode, { inject = [], arcade = false, cup = false } = {}) {
	const relay = ctx.args.relay
	const rk = ctx.args.rk ?? ''
	if (!relay) ctx.skip('no relay : --set relay=ws://localhost:8787 --set rk=<key> (a local ctr-relay, see RUN)')
	const origin = new URL(ctx.args.url).origin
	const navigate = sid => url => ctx.conn.send('Page.navigate', { url }, sid)
	const host = { name: 'host', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: navigate(ctx.sid) }

	for (const source of inject) await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source }, ctx.sid)
	await boot(host, `${origin}/index.html`)
	await ctx.js(`localStorage.setItem('ctr-online.path', ${JSON.stringify(mode === 'ws' ? 'relay' : 'auto')})
		localStorage.setItem('ctr-online.points', 'relay')
		const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
		set('online-name', 'Host'); set('online-relay', ${JSON.stringify(relay)}); set('online-rk', ${JSON.stringify(rk)})
		await window.__ctrOnline.host()
		return true`)
	const hs = await online(host)
	if (hs.role !== 'host' || hs.backend !== 'relay') throw new Error(`host : no room on the relay (${hs.error})`)
	if (/[?&](key|rk)=/.test(hs.link.split('#')[0])) throw new Error('host : a secret left the # part of the link')

	const { guestBrowser, guest, gp, gjs } = await openGuestPage(ctx, origin, { inject, mode })
	try {
		await boot(guest, hs.link)
		const vis = [await ctx.js('return document.visibilityState'), await gjs('return document.visibilityState')]
		if (vis.join() !== 'visible,visible') throw new Error(`a tab is not painting : visibility ${vis.join(' / ')}`)

		// The host's game joined its own room (the lobby states draw nothing : it stays on its
		// title) ; the guest's game joined the host's and sits behind the host's picture.
		await until(host, 'the host in its room', s => s.lobby.active && s.octr.CurrState === ST.HOST_TRACK_PICK, 30_000)
		await until(guest, 'the guest in the room', s => s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected' && s.share.slot === 1, 60_000)
		const gl = (await online(guest)).links[0]
		const hl = (await online(host)).links[0]
		if (mode !== 'ws' && gl?.backend === 'ws') {
			// An agent browser older than the sandbox's WebRtcHideLocalIpsWithMdns flag resolves
			// only its origins (--host-resolver-rules) : WebRTC's mDNS host candidates (….local)
			// never resolve, ICE fails, the guest falls back to the relay. Not this build's fault.
			const why = (await online(guest)).error || 'WebRTC attempt failed'
			ctx.skip(`no WebRTC path in this browser (${why}) : the guest fell back to the relay`)
		}
		if (mode === 'ws' && gl?.backend !== 'ws') throw new Error(`guest path ${gl?.backend}/${gl?.path}, wanted the forced WebSocket path`)
		if (hl?.peer !== 0) throw new Error(`host : guest peer id ${hl?.peer}`)
		await until(host, 'two drivers', s => s.octr.NumDrivers === 2 && s.octr.names[1] === 'Guest', 15_000)
		await until(guest, 'two drivers', s => s.octr.NumDrivers === 2 && s.octr.names[1] === 'Host', 15_000)
		if ((await online(guest)).lobby.phase !== PHASE.menus) throw new Error(`guest : lobby phase ${(await online(guest)).lobby.phase}, wanted the host's menus`)
		await shot(ctx, `${mode}-room`)

		// The lobby is the host's own menus : ONLINE → VS → the race type → the character select,
		// with the room's 2 humans (the guest's pad is plugged as P2 by the Share host)
		await menuTo(host, 'NETPLAY', dir => host.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		const raceType = cup ? ['ArrowDown', CROSS] : [CROSS]
		const presses = arcade ? [CROSS, 'ArrowDown', 'ArrowDown', CROSS, ...raceType, CROSS] : [CROSS, CROSS, ...raceType]
		for (const key of presses) {
			await host.press(key)
			await host.frames(15)
		}
		await untilGame(host, 'the character select', s => s.charSelect != null, 15_000)
		await charactersToRace(host, guest)
		// leave(): the guest's page goes away (navigates off the game : its links close as a closed tab's do)
		const leave = () => guest.navigate(`${origin}/preload-flag.js`)
		return { host, guest, gp, gjs, gl, hl, leave, close: () => guestBrowser.close() }
	} catch (e) {
		await guestBrowser.close()
		throw e
	}
}

/**
 * The guest's page, not loaded yet : `{ guestBrowser, guest, gp, gjs }`, its name and path stored
 * before it loads (roomToRace, LINK-CHANGE).
 */
async function openGuestPage(ctx, origin, { inject = [], mode = 'auto' } = {}) {
	// The guest : a second browser when the run has one (--set guestCdp=<host:port>, play.sh
	// passes `agent-browser -i b env`), its own Chromium, CDP connection and recorder ; else a
	// second tab of this browser, in a window of its own (a background tab would stop
	// painting). Either way its page opens on a small same-origin file (the agent browser's
	// proxy refuses about:blank), so the player's page script is in place before the game loads.
	const guestBrowser = await openGuest(ctx, `${origin}/preload-flag.js`)
	const { targetId, conn: gc } = guestBrowser
	// The guest's session, re-attached when the agent browser's proxy stops knowing it (it
	// refuses « session is not one of this page » mid-run, with no detach event) ; every guest
	// command goes through gconn, so the player harness follows the new session.
	const gs = { sid: null, reattached: 0 }
	const attachGuest = async () => {
		gs.sid = (await gc.send('Target.attachToTarget', { targetId, flatten: true })).sessionId
		await gc.send('Page.enable', {}, gs.sid)
		await gc.send('Runtime.enable', {}, gs.sid)
		await gc.send('Inspector.enable', {}, gs.sid).catch(() => {})
	}
	// What happens to the guest's target, for the failure message.
	gs.events = []
	const at = () => new Date().toISOString().slice(11, 23)
	gc.on('Inspector.targetCrashed', (p, sid) => { if (sid === gs.sid) gs.events.push(`crashed at ${at()}`) })
	gc.on('Inspector.detached', (p, sid) => { if (sid === gs.sid) gs.events.push(`inspector detached : ${p.reason} at ${at()}`) })
	gc.on('Page.frameNavigated', (p, sid) => { if (sid === gs.sid && !p.frame.parentId) gs.events.push(`navigated ${p.frame.url.slice(0, 60)} at ${at()}`) })
	const gconn = {
		on: (...a) => gc.on(...a),
		send: async (method, params) => {
			try {
				return await gc.send(method, params, gs.sid)
			} catch (e) {
				if (!/session is not one of this page|No session with given id/.test(e.message) || gs.reattached >= 5) throw e
				gs.reattached++
				await attachGuest()
				return gc.send(method, params, gs.sid)
			}
		},
	}
	await attachGuest()
	try {
		await gconn.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript(PLAYER) })
		for (const source of inject) await gconn.send('Page.addScriptToEvaluateOnNewDocument', { source })
		const gjs = expression => ctx.evaluate(gconn, gs.sid, `(async () => { ${expression} })()`)
		const guestOwnBrowser = gc !== ctx.conn
		const gp = makePlayer({ conn: gconn, sid: null, js: gjs, capture, dir: '', current: () => ({ id: 'guest', proofs: [] }), pressFrames: PLAYER.pressFrames })
		const guest = { name: 'guest', gs, gconn, own: guestOwnBrowser, js: gjs, press: gp.press, frames: gp.frames, navigate: url => gconn.send('Page.navigate', { url }) }
		// The guest's name and path before its page loads : it connects as soon as its room opens.
		// One browser = one localStorage for both (the host's name is already taken by then) ; the
		// second browser has its own, written from the guest's same-origin first page — the forced
		// path too, or a guest in its own browser stays on auto and pairs over WebRTC.
		await (guestOwnBrowser ? gjs : ctx.js)(`localStorage.setItem('ctr-online.name', 'Guest')
			localStorage.setItem('ctr-online.path', ${JSON.stringify(mode === 'ws' ? 'relay' : 'auto')}); return true`)
		return { guestBrowser, guest, gp, gjs }
	} catch (e) {
		await guestBrowser.close()
		throw e
	}
}

/** One 2-tab run : the room, its race, then 10 s holding Cross or the whole item race. */
async function twoTabs(ctx, mode, { itemRace = false } = {}) {
	const { host, guest, gp, gjs, gl, close } = await roomToRace(ctx, mode)
	try {
		// `return await` : a bare `return <promise>` would run the finally below — closing the
		// guest's tab — as soon as the race starts (« Render process gone », LOG T4).
		if (itemRace) return await itemRaceOn(ctx, { host, guest, gp, gjs })

		// Race : both hold Cross ; the host's tab is filmed, its sound unmuted for the video
		const samples = { host: [], guest: [] }
		await recordWithSound(ctx, `${mode}-race`, async () => {
			await ctx.hold(CROSS)
			await gp.hold(CROSS)
			const end = Date.now() + RACE_MS
			while (Date.now() < end) {
				samples.host.push((await online(host)).karts)
				samples.guest.push((await online(guest)).karts)
				await sleep(400)
			}
			await ctx.release(CROSS)
			await gp.release(CROSS)
		})
		const m = { hostOwn: moved(samples.host, 0), hostSeesGuest: moved(samples.host, 1), guestOwn: moved(samples.guest, 0), guestSeesHost: moved(samples.guest, 1) }
		for (const k in m) if (m[k] < 2000) throw new Error(`a kart did not move : ${JSON.stringify(m)}`)

		// R7 : the guest's Cross, sampled on the host after the host's own pad polling
		const r7 = samples.host.filter(k => k?.slots[1].exists).map(k => k.slots[1].held)
		const crossHeld = r7.filter(h => h & BTN_CROSS).length
		if (r7.length < 5 || crossHeld < r7.length - 2) throw new Error(`R7 : the guest's Cross held in ${crossHeld} / ${r7.length} host samples`)

		const r6 = { host: rates(await ctx.js('return window.__r6.byState')), guest: rates(await gjs('return window.__r6.byState')) }
		const ctr = await ctx.js('return window.__ctr ? { screen: window.__ctr.screen, fps: window.__ctr.fps } : null')
		return `${gl.backend}/${gl.path} · moved ${JSON.stringify(m)} · R7 ${crossHeld}/${r7.length} · R6 bridge calls/s by state ${JSON.stringify(r6)} · __ctr ${JSON.stringify(ctr)}`
	} finally {
		await close()
	}
}

/**
 * The guest's page target : in the second browser (`--set guestCdp=<host:port>`) the page
 * `agent-browser -i b up` opened, navigated to `url`, over a CDP connection of its own ; else
 * a new window of this browser. Returns { conn, targetId, close }.
 */
async function openGuest(ctx, url) {
	if (!ctx.args.guestCdp) {
		const { targetId } = await ctx.conn.send('Target.createTarget', { url, newWindow: true })
		return { conn: ctx.conn, targetId, close: () => ctx.conn.send('Target.closeTarget', { targetId }).catch(() => {}) }
	}
	const [host, port] = ctx.args.guestCdp.split(':')
	const release = lockBrowser(host, port)
	const ip = isIP(host) ? host : (await lookup(host, { family: 4 })).address
	const conn = await connect(await fetchBrowserWsUrl({ ip, port: Number(port), httpBase: `http://${ip}:${port}` }))
	// The agent browser's proxy attaches only a page whose URL is on an allowed origin, as it
	// last listed them (every second) : a page of the test's origin first, and a refusal retried
	// while a navigation settles (ONLINE-VS-CUP / ITEM-RACE « not a target on an allowed origin »)
	const origin = new URL(url).origin
	let pages = []
	let sessionId = null
	let page = null
	for (let i = 0; i < 10 && !sessionId; i++) {
		if (i) await sleep(500)
		pages = (await conn.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page')
		page = pages.find(t => t.url.startsWith(origin)) ?? pages.find(t => /^https?:/.test(t.url)) ?? pages[0]
		if (!page) throw new Error(`guest browser ${ctx.args.guestCdp} : no page (agent-browser -i b up <url> first)`)
		try {
			sessionId = (await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId
		} catch (e) {
			if (!/not a target on an allowed origin/.test(e.message) || i === 9) throw new Error(`${e.message} (guest browser pages : ${pages.map(t => t.url).join(' , ')})`)
		}
	}
	await conn.send('Page.navigate', { url }, sessionId)
	await conn.send('Target.detachFromTarget', { sessionId })
	return { conn, targetId: page.targetId, close: () => { conn.close(); release() } }
}

/**
 * Claims the guest's browser in cdp.mjs's lock format (/tmp/cdp/.cdp-lock-<host>-<port>.json,
 * `expires` refreshed every 10 s), so another session's play.sh waits instead of restarting it
 * under this run. e2e.mjs only locks the browser it drives. Returns the release.
 */
function lockBrowser(host, port) {
	const file = `${process.env.CDP_LOCK_DIR || '/tmp/cdp'}/.cdp-lock-${host}-${port}.json`
	const claim = () => JSON.stringify({ pid: process.pid, host: hostname(), owner: 'online.suite.mjs guest', at: new Date().toISOString(), expires: Date.now() + 30_000 })
	mkdirSync(dirname(file), { recursive: true })
	try {
		writeFileSync(file, claim(), { flag: 'wx' })
	} catch {
		const held = JSON.parse(readFileSync(file, 'utf8'))
		if (held.expires > Date.now() && held.pid !== process.pid) throw new Error(`guest browser ${host}:${port} is held by another session (${held.owner}, ${file}) — wait and re-run`)
		writeFileSync(file, claim())
	}
	const beat = setInterval(() => writeFileSync(file, claim()), 10_000)
	beat.unref()
	return () => { clearInterval(beat); rmSync(file, { force: true }) }
}

/**
 * Drives one tab's kart along the level's racing line until its race ends (pure pursuit on
 * window.__ctr, as time-trial.suite.mjs does), firing whatever item it holds every 1.5 s.
 * `p` : that tab's player (hold / release / press), `js` : its evaluate, `state` : the page
 * expression shaped like window.__ctr ({screen, kart, track}) — Share's bot steers by its guest
 * page's copy of the host's (web/share/guest-page.js `bot()`). The driving itself is
 * web/ui/src/lib/autopilot.js's, shared with the page's « Bot » switch.
 */
export async function drive(p, js, deadline, state = 'window.__ctr') {
	return autopilot.drive({
		out: p,
		read: () => js(`const c = ${state}; if (!c) return null; const { track, ...s } = c; return s`),
		track: () => js(`return (${state})?.track ?? null`),
		deadline,
	})
}

/** The run's proof folder : the newest one under --set proofs=<root> holding `file`. */
export function runDirOf(root, file) {
	if (!root) return null
	const dirs = readdirSync(root).map(d => join(root, d)).filter(d => existsSync(join(d, file)))
	return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
}

/**
 * A screenshot of the host's page. ctx.shot's capture (fromSurface: false) comes back flat grey
 * on the headless agent browser (LOG ## T3) : the same file is rewritten from the compositor's
 * surface, which shows the game (ux.suite.mjs, share.suite.mjs do the same).
 */
export async function shot(ctx, label) {
	const proof = await ctx.shot(label)
	const dir = proof?.file ? runDirOf(ctx.args.proofs, proof.file) : null
	const r = await ctx.conn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, ctx.sid)
	if (dir && r?.data) writeFileSync(join(dir, proof.file), Buffer.from(r.data, 'base64'))
	return proof
}

/**
 * The item race : both drive the whole race and fire, both screens are filmed with their
 * sound, then put side by side in one MP4 (H.264 + MP3, what VS Code's preview plays).
 */
export async function itemRaceOn(ctx, { host, guest, gp, gjs }) {
	const start = await shot(ctx, 'item-race-start')
	const dir = runDirOf(ctx.args.proofs, start.file)
	const guestCur = { id: 'ONLINE-ITEM-RACE', proofs: [] }
	const gRec = dir ? makePlayer({ conn: guest.gconn, sid: null, js: gjs, capture, dir, current: () => guestCur, pressFrames: PLAYER.pressFrames }) : null
	const deadline = Date.now() + 240_000
	// The item path on both games every 2 s (debug bridge : crates hit, wumpa, item held, free
	// pool entries) : the proof that crates break and items are picked, not just that fire was pressed.
	const items = { host: [], guest: [] }
	const ITEM_PROBE = 'const c = window.__ctr; return c?.kart ? { crates: c.kart.crates, wumpa: c.kart.wumpa, item: c.kart.item, roll: c.kart.roll, pools: c.pools, lights: c.lights, t: Date.now() } : null'
	let sampling = true
	const sample = async () => {
		while (sampling) {
			for (const [who, tab] of [['host', host], ['guest', guest]]) {
				const v = await tab.js(ITEM_PROBE).catch(() => null)
				if (v) items[who].push(v)
			}
			await sleep(2000)
		}
	}
	const race = () => Promise.all([
		drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, deadline),
		drive(gp, gjs, deadline),
		sample(),
	].map((p, i) => i === 2 ? p : p.finally(() => { sampling = false })))
	let results
	// Which session went away, if one does : a detach or a renderer crash, host or guest.
	const gone = []
	const offs = [
		ctx.conn.on('Target.detachedFromTarget', p => gone.push(`detached ${p.sessionId === guest.gs.sid ? 'guest' : p.sessionId === ctx.sid ? 'host' : p.sessionId}`)),
		ctx.conn.on('Inspector.targetCrashed', (p, sid) => gone.push(`crashed ${sid === guest.gs.sid ? 'guest' : sid === ctx.sid ? 'host' : sid}`)),
	]
	let hostVideo
	const send = ctx.conn.send
	ctx.conn.send = (method, params, sid, ...rest) => send(method, params, sid, ...rest).catch(e => {
		const who = sid === guest.gs.sid ? 'guest' : sid === ctx.sid ? 'host' : `session ${sid}`
		throw new Error(`${e.message} [${method} on ${who}]`)
	})
	// Both screens with their sound, each tab's own in-page recorder (its own browser's when
	// the guest has one). The guest's starts first and stops last ; `lag` is how much later
	// the host's started, cut from the guest's video so the two line up side by side.
	let lag = 0
	try {
		if (!gRec) hostVideo = await recordWithSound(ctx, 'host-screen', async () => { results = await race() })
		else {
			const guestRec = { js: gjs, record: gRec.record, args: ctx.args }
			let t0 = 0
			guestCur.video = await recordWithSound(guestRec, 'guest-screen', async () => {
				t0 = Date.now()
				hostVideo = await recordWithSound(ctx, 'host-screen', async () => {
					lag = (Date.now() - t0) / 1000
					results = await race()
				})
			})
		}
	} catch (e) {
		throw new Error(`${e.message}${gone.length ? ` (${gone.join(', ')})` : ' (no session detached or crashed)'} · guest events : ${guest.gs.events.join(' | ') || 'none'}`)
	} finally {
		for (const off of offs) off()
		ctx.conn.send = send
	}
	const [h, g] = results
	const hs = await online(host)
	const gs = await online(guest)
	const itemsOf = who => {
		const xs = items[who]
		const last = xs.at(-1)
		return { crates: last?.crates ?? null, wumpaMax: Math.max(-1, ...xs.map(x => x.wumpa)), items: [...new Set(xs.filter(x => x.item !== 0xf).map(x => x.item))], poolsMin: xs.length ? { thread: Math.min(...xs.map(x => x.pools?.thread ?? 1e9)), small: Math.min(...xs.map(x => x.pools?.small ?? 1e9)) } : null, samples: xs.length }
	}
	const picked = { host: itemsOf('host'), guest: itemsOf('guest') }
	say(`item path : ${JSON.stringify(picked)}`)
	const fired = { hostSent: hs.stats.received[CG_WEAPON] ?? 0, toGuest: hs.stats.sent[SG_WEAPON] ?? 0, guestGot: gs.stats.received[SG_WEAPON] ?? 0, guestSent: gs.stats.sent[CG_WEAPON] ?? 0 }
	let both = 'no proofs root (--set proofs=<root>) : guest screen not filmed'
	if (dir && guestCur.video) {
		const out = join(dir, '99-online-item-race-both-screens.mp4')
		// Host left, guest right ; both sounds mixed (each side hears its own kart and items).
		const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, hostVideo.file), '-ss', String(lag), '-i', join(dir, guestCur.video.file),
			'-filter_complex', '[0:v]scale=640:480,setsar=1[a];[1:v]scale=640:480,setsar=1[b];[a][b]hstack=inputs=2,fps=30[v];[0:a][1:a]amix=inputs=2:duration=shortest:normalize=0[s]',
			'-map', '[v]', '-map', '[s]', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-b:a', '192k', '-movflags', '+faststart', out])
		both = r.status === 0 ? `both screens : ${out} (host ${hostVideo.file}, guest ${guestCur.video.file}, guest cut by ${lag} s)` : `side-by-side failed : ${r.stderr}`
	}
	if (!(h.fired > 0 && g.fired > 0)) throw new Error('nobody pressed fire')
	if (!(picked.host.crates > 0 && picked.guest.crates > 0)) throw new Error(`a kart broke no crate : ${JSON.stringify(picked)}`)
	// Each side's items reached the other : the host's server got the guest's, the guest got the host's.
	if (!(fired.hostSent > 0 && fired.guestGot > 0)) throw new Error(`no weapon crossed between the players : ${JSON.stringify(fired)}`)
	if (!(h.finished && g.finished)) throw new Error(`the race did not end for both : host ${JSON.stringify(h)}, guest ${JSON.stringify(g)}`)
	if (dir && !/^both screens/.test(both)) throw new Error(both)
	return `${guest.own ? 'two browsers' : 'two tabs'} · guest session re-attached ${guest.gs.reattached}× · host ${h.finished ? `finished, rank ${h.rank}` : 'did not finish'} · guest ${g.finished ? `finished, rank ${g.rank}` : 'did not finish'} · weapon messages ${JSON.stringify(fired)} · items ${JSON.stringify(picked)} · ${both}`
}

const room = tab => online(tab).then(s => s?.roomInfo ?? null)

// Every toast the page shows, kept (they fade)
const TOASTS = `(() => {
	globalThis.__toasts = []
	const seen = new WeakSet()
	new MutationObserver(() => {
		for (const t of document.querySelectorAll('.toast')) if (!seen.has(t)) { seen.add(t); __toasts.push(t.innerText.replace(/\\s+/g, ' ').trim()) }
	}).observe(document, { childList: true, subtree: true })
})()`

/**
 * Session 32 : the main menu's NETPLAY row with no room. With no relay key saved, the game's
 * box says so : Triangle back to the main menu, OPEN brings the page's Netplay panel (Escape
 * closes it). With the relay and its key saved, a room at once : its link in a toast, the
 * ONLINE menu opened by itself.
 */
async function netplayRow(ctx) {
	const relay = ctx.args.relay
	const rk = ctx.args.rk ?? ''
	if (!relay || !rk) ctx.skip('no keyed relay : --set relay=ws://localhost:8788 --set rk=<key>')
	const origin = new URL(ctx.args.url).origin
	const host = { name: 'host', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: url => ctx.conn.send('Page.navigate', { url }, ctx.sid) }
	const steps = []
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS }, ctx.sid)
	const bootWith = async key => {
		await boot(host, `${origin}/index.html`)
		await ctx.js(`localStorage.setItem('ctr-online.relay', ${JSON.stringify(relay)}); localStorage.setItem('ctr-online.rk', ${JSON.stringify(key)})
			localStorage.setItem('ctr-online.points', 'relay'); localStorage.setItem('ctr-online.name', 'Host'); return true`)
		await boot(host, `${origin}/index.html`)
		await menuTo(ctx, 'NETPLAY', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
	}
	const panelOpen = () => ctx.js("return !!(document.getElementById('online')?.checkVisibility?.() || document.getElementById('ctr-settings')?.checkVisibility?.())")

	await bootWith('')
	await ctx.press(CROSS)
	await untilGame(host, 'the NO RELAY KEY box', s => s.sub?.title === 'NO RELAY KEY', 10_000)
	await shot(ctx, 'netplay-no-key')
	await ctx.press('z')
	const back = await untilGame(host, 'the main menu again', s => !s.sub && s.menu?.label === 'NETPLAY', 10_000)
	steps.push(`no key : the box, Triangle back to ${back.menu.label}`)
	if ((await online(host)).role === 'host') throw new Error('a room opened with no relay key')
	await ctx.press(CROSS)
	await untilGame(host, 'the box again', s => s.sub?.title === 'NO RELAY KEY', 10_000)
	// OPEN : the first row (a press landing as the box opens is lost : again until the panel shows)
	await ctx.press('ArrowUp')
	for (let i = 0; i < 4 && !(await panelOpen()); i++) {
		await sleep(800)
		const s = await game(host)
		if (s?.sub?.title === 'NO RELAY KEY' && s.sub.label === 'OPEN NETPLAY SETTINGS') await ctx.press(CROSS)
		else if (s?.sub?.title === 'NO RELAY KEY') await ctx.press('ArrowUp')
	}
	for (let i = 0; i < 20 && !(await panelOpen()); i++) await sleep(250)
	if (!(await panelOpen())) throw new Error('OPEN did not bring the Netplay panel')
	await shot(ctx, 'netplay-no-key-panel')
	await ctx.press('Escape')
	for (let i = 0; i < 20 && (await panelOpen()); i++) await sleep(250)
	steps.push(`OPEN : the panel, Escape ${(await panelOpen()) ? 'did not close it' : 'closed it'}`)

	await bootWith(rk)
	await ctx.press(CROSS)
	const s = await until(host, 'the room NETPLAY opened', s => s.role === 'host' && !!s.link && s.lobby.active, 30_000)
	const g = await untilGame(host, 'the ONLINE menu by itself', s => s.sub?.title === 'NETPLAY', 20_000)
	await shot(ctx, 'netplay-auto-host')
	const toasts = await ctx.js('return globalThis.__toasts ?? []')
	if (!toasts.some(t => /Room open/.test(t))) throw new Error(`no « Room open » toast : ${JSON.stringify(toasts)}`)
	steps.push(`key saved : a room on ${s.backend}, the ONLINE menu (${g.sub.label}) by itself, toasts ${JSON.stringify(toasts)}`)
	// Alone in the room (session 32b) : VS and BATTLE grey, Cross on VS stays ; ARCADE's race
	// type and its way back ; Triangle to the main menu, the room kept
	await untilGame(host, 'the cursor on VS', s => s.sub?.label === 'VS.', 5_000)
	await ctx.press(CROSS)
	await ctx.frames(30)
	const vs = await game(host)
	if (vs?.sub?.title !== 'NETPLAY') throw new Error(`alone, Cross on VS left the ONLINE menu : ${vs?.sub?.title}/${vs?.sub?.label}`)
	for (let i = 0; i < 6 && (await game(host))?.sub?.label !== 'ARCADE'; i++) {
		await ctx.press('ArrowDown')
		await ctx.frames(10)
	}
	await untilGame(host, 'the cursor on ARCADE', s => s.sub?.label === 'ARCADE', 5_000)
	await ctx.press(CROSS)
	const rt = await untilGame(host, 'ARCADE\'s race type', s => s.sub?.title === 'RACE TYPE', 10_000)
	await ctx.press('z')
	await untilGame(host, 'the ONLINE menu again', s => s.sub?.title === 'NETPLAY', 10_000)
	// a press landing as a menu opens is lost (as the box's above) : again until it leaves
	for (let i = 0; i < 4 && (await game(host))?.sub; i++) {
		await ctx.press('z')
		await ctx.frames(20)
	}
	const main = await untilGame(host, 'the main menu', s => !s.sub && s.menu?.label === 'NETPLAY', 10_000)
	const kept = (await online(host)).role === 'host'
	steps.push(`alone : VS stays grey, ARCADE → ${rt.sub.title}, Triangle ×2 → ${main.menu.label}, room ${kept ? 'kept' : 'lost'}`)
	if (!kept) throw new Error(steps.join(' · '))
	// The game leaves its room by itself, as the pause menu's QUIT does mid-race (the page's
	// room still open) : NETPLAY again opens a new room, its menu by itself (session 32c)
	const before = (await online(host)).room
	await ctx.js('Module.ctrOnlineControl(2); return true') // CTL.leave, the game only
	await until(host, 'the game out of its room', s => !s.lobby.active, 10_000)
	await ctx.press(CROSS)
	const again = await until(host, 'a new room from NETPLAY', s => s.role === 'host' && s.lobby.active && s.room !== before, 30_000)
	await untilGame(host, 'the ONLINE menu by itself again', s => s.sub?.title === 'NETPLAY', 20_000)
	await ctx.js('window.__ctrOnline.leave(); return true')
	steps.push(`the game out of its room : NETPLAY opened room ${again.room} (was ${before}) and its menu`)
	if (/did not close/.test(steps[1])) throw new Error(steps.join(' · '))
	return steps.join(' · ')
}

/**
 * Session 32b, a changed link : the guest's page hosts its own room B, then its address bar gets
 * the host's room A link. Its page leaves B and joins A in place (no reload) : a toast, then A's
 * lobby on both games (the guest behind the host's picture, its pad as P2). The same link again
 * changes nothing.
 */
async function linkChange(ctx) {
	const relay = ctx.args.relay
	const rk = ctx.args.rk ?? ''
	if (!relay) ctx.skip('no relay : --set relay=ws://localhost:8787 --set rk=<key> (a local ctr-relay, see RUN)')
	const origin = new URL(ctx.args.url).origin
	const host = { name: 'host', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: url => ctx.conn.send('Page.navigate', { url }, ctx.sid) }
	const hostRoom = js => js(`localStorage.setItem('ctr-online.points', 'relay')
		const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
		set('online-relay', ${JSON.stringify(relay)}); set('online-rk', ${JSON.stringify(rk)})
		await window.__ctrOnline.host()
		return true`)
	await boot(host, `${origin}/index.html`)
	await ctx.js(`localStorage.setItem('ctr-online.path', 'auto'); return true`)
	await hostRoom(ctx.js)
	const a = await online(host)
	if (a.role !== 'host') throw new Error(`host : no room A (${a.error})`)

	const { guestBrowser, guest, gjs } = await openGuestPage(ctx, origin)
	try {
		await guest.gconn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS })
		await boot(guest, `${origin}/index.html`)
		await hostRoom(gjs)
		const b = await until(guest, 'room B on the guest\'s page', s => s.role === 'host' && s.lobby.active, 30_000)
		if (b.room === a.room) throw new Error('room B is room A')

		await gjs(`location.hash = new URL(${JSON.stringify(a.link)}).hash; return true`)
		const g = await until(guest, 'the guest in room A', s => s.role === 'guest' && s.room === a.room && s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected' && s.share.slot === 1, 60_000)
		await until(host, 'two drivers in room A', s => s.octr.NumDrivers === 2, 15_000)
		const loads = await gjs('return performance.getEntriesByType(\'navigation\').length + \':\' + location.hash.includes(\'room=\')')
		const toasts = await gjs('return globalThis.__toasts ?? []')
		if (!toasts.some(t => /Joining the new room/.test(t))) throw new Error(`no « Joining » toast : ${JSON.stringify(toasts)}`)
		await guestShot(ctx, guest, 'link-change-in-a')

		// the same link again : nothing happens
		const selfId = g.selfId
		await gjs(`window.dispatchEvent(new HashChangeEvent('hashchange')); return true`)
		await sleep(2000)
		const same = await online(guest)
		if (same.role !== 'guest' || same.room !== a.room || same.selfId !== selfId) throw new Error(`the same link moved the guest : ${same.role} ${same.room} ${same.selfId} (was ${selfId})`)
		await gjs('window.__ctrOnline.leave(); return true')
		await ctx.js('window.__ctrOnline.leave(); return true')
		return `room B ${b.room} → room A ${a.room} in place (navigations ${loads}), the guest P2 in A's lobby on ${g.links[0]?.backend}/${g.links[0]?.path}, toasts ${JSON.stringify(toasts)} ; the same link again : unchanged`
	} finally {
		await guestBrowser.close()
	}
}

/**
 * A whole Netplay Cup (session 32, docs/ONLINECTR_PORT.md D12) : the 4 races of the first cup
 * with no menu between them, both driving every race ; after each, the standings on both games
 * (the guest's table is the host's, by clientID) ; after the last, the host's character select.
 * The host's screen is filmed through the whole Cup. `arcade` : with the host's bots (8 karts).
 */
export async function cupOn(ctx, { arcade = false } = {}) {
	const r = await roomToRace(ctx, 'auto', { arcade, cup: true })
	const { host, guest, gp, gjs } = r
	const rows = []
	try {
		await recordWithSound(ctx, arcade ? 'arcade-cup' : 'vs-cup', async () => {
			for (let race = 1; race <= 4; race++) {
				const h0 = await online(host)
				const track = (await game(host))?.levelID
				if (race > 1 && h0.octr.CurrState < ST.START_RACE) throw new Error(`race ${race} : the host is not racing (state ${h0.octr.CurrState})`)
				const deadline = Date.now() + 300_000
				await Promise.all([drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, deadline), drive(gp, gjs, deadline)])
				// the standings : counted on the host, copied to the guest
				let hr = null, gr = null
				for (let i = 0; i < 240; i++) {
					hr = await room(host)
					gr = await room(guest)
					if (hr?.races === race && gr?.races === race) break
					await sleep(1000)
				}
				if (hr?.races !== race || gr?.races !== race) throw new Error(`race ${race} : standings host ${JSON.stringify(hr)}, guest ${JSON.stringify(gr)}`)
				if (JSON.stringify(hr.points) !== JSON.stringify(gr.points)) throw new Error(`race ${race} : the guest's table ${JSON.stringify(gr.points)} is not the host's ${JSON.stringify(hr.points)}`)
				rows.push({ race, track, points: hr.points })
				say(`cup race ${race} (track ${track}) : points by clientID ${JSON.stringify(hr.points)}`)
				await sleep(2000)
				await guestShot(ctx, guest, `cup-standings-${race}`)
				if (race < 4) {
					// the next track by itself : no menu between the races, the same room
					for (const tab of [host, guest]) await until(tab, `cup race ${race + 1}`, s => s.octr.CurrState === ST.START_RACE && s.lobby.active, 240_000, 500)
					if ((await game(host))?.screen === 'menu') throw new Error(`race ${race + 1} : the host went through the menus`)
				}
			}
			await untilGame(host, 'the character select after the Cup', s => s.charSelect != null, 90_000)
			await shot(ctx, 'cup-after-characters')
		})
		const tracks = rows.map(x => x.track)
		if (new Set(tracks).size !== 4) throw new Error(`the Cup's tracks ${JSON.stringify(tracks)}`)
		const last = rows[3].points
		if (!(last[0] > 0 || last[1] > 0)) throw new Error(`no points for the humans : ${JSON.stringify(last)}`)
		return `4 races on tracks ${tracks.join(', ')} · final points by clientID ${JSON.stringify(last)} · the guest's table equal after every race · then the character select`
	} finally {
		await r.close()
	}
}

/** The guest's screen from the compositor's surface, next to the host's shots. */
export async function guestShot(ctx, guest, label) {
	const proof = await shot(ctx, `${label}-host`)
	const dir = proof?.file ? runDirOf(ctx.args.proofs, proof.file) : null
	const r = await guest.gconn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).catch(() => null)
	if (dir && r?.data) writeFileSync(join(dir, proof.file.replace(/-host\.png$/, '-guest.png')), Buffer.from(r.data, 'base64'))
}

export default async ctx => {
	await ctx.scenario('ONLINE-2TAB-P2P', () => twoTabs(ctx, 'auto'))
	// the guest on the relay plays the lobby blind (its pad, no picture) and races as the others
	await ctx.scenario('ONLINE-2TAB-WS', () => twoTabs(ctx, 'ws'))
	// A whole race, both driving and firing, both screens filmed ; over WebRTC when it pairs.
	await ctx.scenario('ONLINE-ITEM-RACE', () => twoTabs(ctx, 'auto', { itemRace: true }))
	// Session 32 : NETPLAY with no room (the no-key box, a room at once) ; a whole VS Cup, humans only (D12)
	await ctx.scenario('NETPLAY-ROW', () => netplayRow(ctx))
	// Session 32b : another room's link opened in the page : leave this room, join that one in place
	await ctx.scenario('LINK-CHANGE', () => linkChange(ctx))
	await ctx.scenario('ONLINE-VS-CUP', () => cupOn(ctx))
}
