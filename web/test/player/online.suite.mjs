// Player suite : Online 2-tab. The suite's tab hosts a room (sv_core runs in its wasm), a
// second tab opens the room link as the guest ; both play OnlineCTR's own menus with the
// keyboard (room, track, laps, character ; the page picks « Private Room » itself) into a race, both hold Cross, and
// each side must see the other's kart move. Once over WebRTC (P2P), once with the guest
// forced onto the relay's WebSocket path (openRoom mode: ws). Then a whole race in an item
// room : both karts follow the racing line and fire their items, both screens filmed with
// their sound and put side by side. The guest runs in a second agent browser when the run
// has one (instance b, its own Chromium and CDP connection), else in a second tab.
//
// RUN
//   Build : web/build-web.sh debug -DCTR_ONLINE=ON -DCTR_WEB_PRELOAD_DISC=OFF
//           (the online build boots straight into OnlineCTR ; the disc is stored in OPFS
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
import { HEARTBEAT_MS, PLAYER, recordWithSound, say } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8092/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// game/OnlineCTR/global.h
export const ST = { PICK_SERVER: 1, PICK_ROOM: 2, HOST_TRACK_PICK: 5, GUEST_TRACK_WAIT: 6, CHARACTER_PICK: 7, START_RACE: 11 }
const PRIVATE_ROOM = 7
const CROSS = 'c' // keyboard C = Cross (platform/native_input.c)
const BTN_CROSS = 0x10 // Cross in the pad word the bridge writes for a remote driver
const RACE_MS = 10_000
const ITEM_ROOM = 5 // rooms 5-9 have items (game/OnlineCTR/menu.c)
const FIRE = 'v' // keyboard V = Circle, use the held item
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
	(document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-4).join(' | ')].join(' ; ')`).catch(e => e.message)

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

/** Loads `url` in `tab` and boots the game to OnlineCTR's server menu ; stores the disc in OPFS once. */
export async function boot(tab, url) {
	// A load that starts while the previous page of this tab is still pulling the 13 MB debug
	// wasm through the port forward can stall with no wasm request at all : leave the page
	// first, and retry a boot that logs nothing (as ctr.mjs's bootToMenu does for the preload).
	for (let attempt = 1; ; attempt++) {
		await tab.navigate(new URL('/preload-flag.js', url).href)
		await sleep(1000)
		await tab.navigate(url)
		const deadline = Date.now() + 30_000
		while (!(await tab.js('return document.readyState === "complete" && typeof window.__ctrTestHandleFileFromUrl === "function"').catch(() => false))) {
			if (Date.now() > deadline) throw new Error(`${tab.name} : the page never loaded (${await tab.js('return location.href').catch(e => e.message)})`)
			await sleep(250)
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
	// the server menu, or already past it : the page picks Private Room as soon as it has a room
	await until(tab, 'the server menu', s => s.octr?.CurrState >= ST.PICK_SERVER, 180_000)
	await tab.js(R6_PROBE)
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
 * One 2-tab run. `host` is the suite's own tab (ctx) ; the guest gets a tab of its own,
 * driven with the same player harness.
 */
async function twoTabs(ctx, mode, { itemRace = false, itemRoom = itemRace } = {}) {
	const relay = ctx.args.relay
	const rk = ctx.args.rk ?? ''
	if (!relay) ctx.skip('no relay : --set relay=ws://localhost:8787 --set rk=<key> (a local ctr-relay, see RUN)')
	const origin = new URL(ctx.args.url).origin
	const navigate = sid => url => ctx.conn.send('Page.navigate', { url }, sid)
	const host = { name: 'host', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: navigate(ctx.sid) }

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
		const gjs = expression => ctx.evaluate(gconn, gs.sid, `(async () => { ${expression} })()`)
		const guestOwnBrowser = gc !== ctx.conn
		const gp = makePlayer({ conn: gconn, sid: null, js: gjs, capture, dir: '', current: () => ({ id: 'guest', proofs: [] }), pressFrames: PLAYER.pressFrames })
		const guest = { name: 'guest', gs, gconn, own: guestOwnBrowser, js: gjs, press: gp.press, frames: gp.frames, navigate: url => gconn.send('Page.navigate', { url }) }
		// The guest's name before its page loads : it connects as soon as its room opens. One
		// browser = one localStorage for both (the host's name is already taken by then) ; the
		// second browser has its own, written from the guest's same-origin first page.
		await (guestOwnBrowser ? gjs : ctx.js)(`localStorage.setItem('ctr-online.name', 'Guest'); return true`)
		await boot(guest, hs.link)
		const vis = [await ctx.js('return document.visibilityState'), await gjs('return document.visibilityState')]
		if (vis.join() !== 'visible,visible') throw new Error(`a tab is not painting : visibility ${vis.join(' / ')}`)

		// Server menu → room list : the page picks Private Room by itself once it has a room
		for (const tab of [host, guest]) await until(tab, 'the room list (Private Room picked by the page)', s => s.octr.CurrState === ST.PICK_ROOM && s.octr.numRooms === 16 && s.octr.serverCountry === PRIVATE_ROOM, 30_000)
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
		await ctx.shot(`${mode}-room-list`)

		// Room 0 (no items), or room 5 (the first item room) : the host first (DriverID 0 picks the track)
		const room = itemRoom ? ITEM_ROOM : 0
		for (const tab of [host, guest]) for (let i = 0; i < room; i++) {
			await tab.press('ArrowDown')
			await tab.frames(8)
		}
		await host.press(CROSS)
		await until(host, 'the track pick', s => s.octr.CurrState === ST.HOST_TRACK_PICK, 15_000)
		if ((await online(host)).octr.serverRoom !== room) throw new Error(`host joined room ${(await online(host)).octr.serverRoom}, not ${room}`)
		await guest.press(CROSS)
		await until(guest, 'the track wait', s => s.octr.CurrState === ST.GUEST_TRACK_WAIT, 15_000)
		await until(host, 'two drivers', s => s.octr.NumDrivers === 2 && s.octr.names[1] === 'Guest', 15_000)
		await until(guest, 'two drivers', s => s.octr.NumDrivers === 2 && s.octr.names[1] === 'Host', 15_000)
		await host.press(CROSS) // track
		await sleep(600)
		await host.press(CROSS) // laps
		for (const tab of [host, guest]) await until(tab, 'the character pick', s => s.octr.CurrState === ST.CHARACTER_PICK, 15_000)
		// Lock a character : a press landing while the menu opens is lost, press again until locked.
		for (const tab of [host, guest]) {
			for (let i = 0; i < 6 && (await online(tab)).octr.CurrState === ST.CHARACTER_PICK; i++) {
				await tab.press(CROSS)
				await sleep(1500)
			}
		}
		for (const tab of [host, guest]) await until(tab, 'the race (SG_STARTRACE)', s => s.octr.CurrState === ST.START_RACE, 180_000, 500)

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
		await guestBrowser.close()
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
	const { targetInfos } = await conn.send('Target.getTargets')
	const page = targetInfos.find(t => t.type === 'page')
	if (!page) throw new Error(`guest browser ${ctx.args.guestCdp} : no page (agent-browser -i b up <url> first)`)
	const { sessionId } = await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
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
 * `p` : that tab's player (hold / release / press), `js` : its evaluate.
 */
export async function drive(p, js, deadline) {
	const ACCEL = 'c'
	const REVERSE = 'x'
	const read = () => js('if (!window.__ctr) return null; const { track, ...s } = window.__ctr; return s')
	const line = await js('return window.__ctr?.track ?? null')
	const path = line?.path ?? []
	const n = path.length
	if (n < 10) throw new Error('no racing line in window.__ctr (debug build ?)')
	const seg = path.map((q, i) => Math.hypot(path[(i + 1) % n].x - q.x, path[(i + 1) % n].z - q.z))
	const spacing = [...seg].sort((a, b) => a - b)[n >> 1]
	const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
	let near = -1
	const nearest = k => {
		const span = near < 0 ? n : 40
		const from = near < 0 ? 0 : near - 10
		let best = Infinity
		let at = near
		for (let j = 0; j < span; j++) {
			const i = (((from + j) % n) + n) % n
			const d = (path[i].x - k.pos.x) ** 2 + (path[i].z - k.pos.z) ** 2 + 4 * (path[i].y - k.pos.y) ** 2
			if (d < best) { best = d; at = i }
		}
		near = at
		return at
	}
	let held = null
	const steer = async want => {
		if (want === held) return
		if (held) await p.release(held)
		if (want) await p.hold(want)
		held = want
	}
	let fired = 0
	let lastFire = Date.now()
	let slowSince = 0
	let maxSpeed = 0
	let lastPos = null
	let end = null
	await p.hold(ACCEL)
	try {
		while (Date.now() < deadline) {
			const s = await read()
			const k = s?.kart
			if (!k) { await sleep(100); continue }
			if (s.screen === 'finished' || k.finished) { end = s; break }
			maxSpeed = Math.max(maxSpeed, k.speed)
			let i = nearest(k)
			for (let d = 0; d < spacing * 2 + Math.max(0, k.speed) / 25; i = (i + 1) % n) d += seg[i]
			const t = path[i]
			const err = wrap(Math.atan2(t.x - k.pos.x, t.z - k.pos.z) - (k.angle * 2 * Math.PI) / 4096)
			const moved = lastPos ? Math.hypot(k.pos.x - lastPos.x, k.pos.z - lastPos.z) : Infinity
			lastPos = k.pos
			if ((maxSpeed > 0 && k.speed < maxSpeed / 5) || moved < 5) slowSince ||= Date.now()
			else slowSince = 0
			if (slowSince && Date.now() - slowSince > 1000) {
				await p.release(ACCEL)
				await steer(err > 0 ? 'ArrowRight' : 'ArrowLeft')
				await p.hold(REVERSE)
				await sleep(1100)
				await p.release(REVERSE)
				await steer(null)
				await p.hold(ACCEL)
				slowSince = 0
				near = -1
				lastPos = null
				continue
			}
			await steer(Math.abs(err) > 0.05 ? (err > 0 ? 'ArrowLeft' : 'ArrowRight') : null)
			if (Date.now() - lastFire > 1500) {
				await p.press(FIRE)
				fired++
				lastFire = Date.now()
			}
			await sleep(30)
		}
	} finally {
		await steer(null)
		await p.release(ACCEL)
	}
	return { finished: !!end, rank: end?.kart?.rank ?? null, fired }
}

/** The run's proof folder : the newest one under --set proofs=<root> holding `file`. */
function runDirOf(root, file) {
	if (!root) return null
	const dirs = readdirSync(root).map(d => join(root, d)).filter(d => existsSync(join(d, file)))
	return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
}

/**
 * The item race : both drive the whole race and fire, both screens are filmed with their
 * sound, then put side by side in one MP4 (H.264 + MP3, what VS Code's preview plays).
 */
async function itemRaceOn(ctx, { host, guest, gp, gjs }) {
	const shot = await ctx.shot('item-race-start')
	const dir = runDirOf(ctx.args.proofs, shot.file)
	const guestCur = { id: 'ONLINE-ITEM-RACE', proofs: [] }
	const gRec = dir ? makePlayer({ conn: guest.gconn, sid: null, js: gjs, capture, dir, current: () => guestCur, pressFrames: PLAYER.pressFrames }) : null
	const deadline = Date.now() + 240_000
	const race = () => Promise.all([
		drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, deadline),
		drive(gp, gjs, deadline),
	])
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
	// Each side's items reached the other : the host's server got the guest's, the guest got the host's.
	if (!(fired.hostSent > 0 && fired.guestGot > 0)) throw new Error(`no weapon crossed between the players : ${JSON.stringify(fired)}`)
	if (!(h.finished && g.finished)) throw new Error(`the race did not end for both : host ${JSON.stringify(h)}, guest ${JSON.stringify(g)}`)
	if (dir && !/^both screens/.test(both)) throw new Error(both)
	return `${guest.own ? 'two browsers' : 'two tabs'} · guest session re-attached ${guest.gs.reattached}× · host ${h.finished ? `finished, rank ${h.rank}` : 'did not finish'} · guest ${g.finished ? `finished, rank ${g.rank}` : 'did not finish'} · weapon messages ${JSON.stringify(fired)} · ${both}`
}

export default async ctx => {
	await ctx.scenario('ONLINE-2TAB-P2P', () => twoTabs(ctx, 'auto'))
	await ctx.scenario('ONLINE-2TAB-WS', () => twoTabs(ctx, 'ws'))
	// the hold race of ONLINE-2TAB-WS in an item room : runs on a release build too (no __ctr)
	await ctx.scenario('ONLINE-ITEM-ROOM', () => twoTabs(ctx, 'ws', { itemRoom: true }))
	// A whole race, both driving and firing, both screens filmed ; over WebRTC when it pairs.
	await ctx.scenario('ONLINE-ITEM-RACE', () => twoTabs(ctx, 'auto', { itemRace: true }))
}
