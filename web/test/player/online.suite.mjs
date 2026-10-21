// Player suite : Online 2-tab. The suite's tab hosts a room (sv_core runs in its wasm), a
// second tab opens the room link as the guest ; both play OnlineCTR's own menus with the
// keyboard (Private Room, room 0, track, laps, character) into a race, both hold Cross, and
// each side must see the other's kart move. Once over WebRTC (P2P), once with the guest
// forced onto the relay's WebSocket path (openRoom mode: ws).
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
//   Both ports in AGENT_BROWSER_ORIGINS and forwarded. Browser : the agent browser.
// Not a node --test file : `node --test web/test/*.test.js` never loads it.
//
// State : window.__ctrOnline.state() (web/online/page.js : octr, links, per-slot kart samples
// taken by the bridge after the game's pad polling) and window.__ctr (debug builds).
// Also answers OnlineCTR's live checks (docs/ONLINECTR_PORT.md « Session 9 findings ») :
// R6 — bridge calls per second in every client state, from octr.windowsClientSync ;
// R7 — the guest's held Cross, sampled on the host after its own pad polling.

import { capture } from '/opt/devcontainer/base/skills/visual-loop/scripts/cdp.mjs'
import { makePlayer, pageScript } from '/opt/devcontainer/base/skills/visual-loop/lib/player.mjs'
import { PLAYER, recordWithSound } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8092/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// game/OnlineCTR/global.h
const ST = { PICK_SERVER: 1, PICK_ROOM: 2, HOST_TRACK_PICK: 5, GUEST_TRACK_WAIT: 6, CHARACTER_PICK: 7, START_RACE: 11 }
const PRIVATE_ROOM = 7
const CROSS = 'c' // keyboard C = Cross (platform/native_input.c)
const BTN_CROSS = 0x10 // Cross in the pad word the bridge writes for a remote driver
const RACE_MS = 10_000

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
const online = tab => tab.js('return window.__ctrOnline ? window.__ctrOnline.state() : null')

async function until(tab, label, pred, timeout = 30_000, every = 250) {
	const deadline = Date.now() + timeout
	let s = null
	while (Date.now() < deadline) {
		s = await online(tab).catch(() => null)
		if (s && pred(s)) return s
		await sleep(every)
	}
	const log = await tab.js(`return [location.href, document.visibilityState, document.getElementById('boot-status')?.textContent,
		document.getElementById('drop-error')?.textContent, 'game script ' + !!document.querySelector('script[src="ctr_native.js"]'),
		(document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-4).join(' | ')].join(' ; ')`).catch(e => e.message)
	throw new Error(`${tab.name} : timed out after ${Math.round(timeout / 1000)}s waiting for ${label} (last state ${s?.octr?.CurrState}, ${s?.error || s?.lastError?.message || 'no error'} ; page log : ${log})`)
}

/** Loads `url` in `tab` and boots the game to OnlineCTR's server menu ; stores the disc in OPFS once. */
async function boot(tab, url) {
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
		if (await tab.js('return !document.getElementById("boot").classList.contains("hidden")')) {
			// 605 MB over the port forward the first time : start it, watch the drop zone go away
			await tab.js(`void window.__ctrTestHandleFileFromUrl(location.origin + '/ctr-u.bin'); return true`)
			const stored = Date.now() + 900_000
			for (;;) {
				const s = await tab.js('return { hidden: document.getElementById("boot").classList.contains("hidden"), error: document.getElementById("drop-error").textContent }')
				if (s.error) throw new Error(`${tab.name} : disc refused : ${s.error}`)
				if (s.hidden) break
				if (Date.now() > stored) throw new Error(`${tab.name} : the disc never reached OPFS`)
				await sleep(2000)
			}
		}
		// The game prints its first lines within seconds of the wasm arriving.
		const started = Date.now() + 60_000
		while (Date.now() < started && !(await tab.js("return /\\[OnlineCTR\\]|vblank=/.test(document.getElementById('log')?.textContent ?? '')").catch(() => false))) await sleep(500)
		if (await tab.js("return /\\[OnlineCTR\\]|vblank=/.test(document.getElementById('log')?.textContent ?? '')").catch(() => false)) break
		if (attempt === 3) throw new Error(`${tab.name} : the game never started after ${attempt} loads`)
	}
	await until(tab, 'the server menu', s => s.octr?.CurrState === ST.PICK_SERVER, 180_000)
	await tab.js(R6_PROBE)
}

/** « Private Room » : Down d times then Cross. A public entry is refused at once and the menu comes back. */
async function pickPrivateRoom(tab) {
	let downs = PRIVATE_ROOM
	for (let attempt = 0; attempt < 5; attempt++) {
		for (let i = 0; i < downs; i++) {
			await tab.press('ArrowDown')
			await tab.frames(8)
		}
		await tab.press(CROSS)
		await sleep(800)
		const o = (await online(tab)).octr
		if (o.serverCountry === PRIVATE_ROOM) return attempt
		await until(tab, 'the server menu again', s => s.octr.CurrState === ST.PICK_SERVER && s.octr.boolClientBusy === 0, 15_000)
		downs = Math.max(0, downs + (PRIVATE_ROOM - o.serverCountry))
	}
	throw new Error(`${tab.name} : could not reach Private Room`)
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
async function twoTabs(ctx, mode) {
	const relay = ctx.args.relay
	const rk = ctx.args.rk ?? ''
	if (!relay) ctx.skip('no relay : --set relay=ws://localhost:8787 --set rk=<key> (a local ctr-relay, see RUN)')
	const origin = new URL(ctx.args.url).origin
	const navigate = sid => url => ctx.conn.send('Page.navigate', { url }, sid)
	const host = { name: 'host', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: navigate(ctx.sid) }

	await boot(host, `${origin}/index.html`)
	await ctx.js(`localStorage.setItem('ctr-online.forceWs', ${JSON.stringify(mode === 'ws' ? '1' : '')})
		const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
		set('online-name', 'Host'); set('online-relay', ${JSON.stringify(relay)}); set('online-rk', ${JSON.stringify(rk)})
		await window.__ctrOnline.host()
		return true`)
	const hs = await online(host)
	if (hs.role !== 'host' || hs.backend !== 'relay') throw new Error(`host : no room on the relay (${hs.error})`)
	if (/[?&](key|rk)=/.test(hs.link.split('#')[0])) throw new Error('host : a secret left the # part of the link')

	// The guest's own tab, in a window of its own : a background tab would stop painting. It
	// opens on a small same-origin file (the agent browser's proxy refuses about:blank), so the
	// player's page script is in place before the game page loads.
	const { targetId } = await ctx.conn.send('Target.createTarget', { url: `${origin}/preload-flag.js`, newWindow: true })
	const { sessionId: gsid } = await ctx.conn.send('Target.attachToTarget', { targetId, flatten: true })
	try {
		await ctx.conn.send('Page.enable', {}, gsid)
		await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript(PLAYER) }, gsid)
		const gjs = expression => ctx.evaluate(ctx.conn, gsid, `(async () => { ${expression} })()`)
		const gp = makePlayer({ conn: ctx.conn, sid: gsid, js: gjs, capture, dir: '', current: () => ({ id: 'guest', proofs: [] }), pressFrames: PLAYER.pressFrames })
		const guest = { name: 'guest', js: gjs, press: gp.press, frames: gp.frames, navigate: navigate(gsid) }
		await boot(guest, hs.link)
		await gjs(`const e = document.getElementById('online-name'); e.value = 'Guest'; e.dispatchEvent(new Event('input')); return true`)
		const vis = [await ctx.js('return document.visibilityState'), await gjs('return document.visibilityState')]
		if (vis.join() !== 'visible,visible') throw new Error(`a tab is not painting : visibility ${vis.join(' / ')}`)

		// Server menu → room list, both through Private Room
		await pickPrivateRoom(host)
		await pickPrivateRoom(guest)
		for (const tab of [host, guest]) await until(tab, 'the room list', s => s.octr.CurrState === ST.PICK_ROOM && s.octr.numRooms === 16, 30_000)
		const gl = (await online(guest)).links[0]
		const hl = (await online(host)).links[0]
		if (mode !== 'ws' && gl?.backend === 'ws') {
			// The agent browser resolves only its origins (--host-resolver-rules) : WebRTC's
			// mDNS host candidates (….local) never resolve, ICE fails, the guest falls back to
			// the relay. Not this build's fault ; the sandbox's Chromium flags need
			// --disable-features=WebRtcHideLocalIpsWithMdns, as ctr-browser.sh has.
			const why = (await online(guest)).error || 'WebRTC attempt failed'
			ctx.skip(`no WebRTC path in this browser (${why}) : the guest fell back to the relay`)
		}
		if (mode === 'ws' && gl?.backend !== 'ws') throw new Error(`guest path ${gl?.backend}/${gl?.path}, wanted the forced WebSocket path`)
		if (hl?.peer !== 0) throw new Error(`host : guest peer id ${hl?.peer}`)
		await ctx.shot(`${mode}-room-list`)

		// Room 0 : the host first (DriverID 0 picks the track)
		await host.press(CROSS)
		await until(host, 'the track pick', s => s.octr.CurrState === ST.HOST_TRACK_PICK, 15_000)
		await guest.press(CROSS)
		await until(guest, 'the track wait', s => s.octr.CurrState === ST.GUEST_TRACK_WAIT, 15_000)
		await until(host, 'two drivers', s => s.octr.NumDrivers === 2 && s.octr.names[1] === 'Guest', 15_000)
		await until(guest, 'two drivers', s => s.octr.NumDrivers === 2 && s.octr.names[1] === 'Host', 15_000)
		await host.press(CROSS) // track
		await sleep(600)
		await host.press(CROSS) // laps
		for (const tab of [host, guest]) await until(tab, 'the character pick', s => s.octr.CurrState === ST.CHARACTER_PICK, 15_000)
		await host.press(CROSS)
		await guest.press(CROSS)
		for (const tab of [host, guest]) await until(tab, 'the race (SG_STARTRACE)', s => s.octr.CurrState === ST.START_RACE, 180_000, 500)

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
		await ctx.conn.send('Target.closeTarget', { targetId }).catch(() => {})
	}
}

export default async ctx => {
	await ctx.scenario('ONLINE-2TAB-P2P', () => twoTabs(ctx, 'auto'))
	await ctx.scenario('ONLINE-2TAB-WS', () => twoTabs(ctx, 'ws'))
}
