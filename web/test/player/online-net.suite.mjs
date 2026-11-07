// Player suite : the Online room's network, measured (session 11). Two browsers (agent browser a
// hosts, b is the guest — LOG T4), the room and its race as online.suite.mjs plays them, with the
// test-only impairment shim (web/net/test/impair.js) in both pages and the debug build's remote-kart
// counter (window.__ctr.net, platform/web_debug_bridge.c). Each window below drives both karts
// along the racing line and reads, on each side, how the other's kart arrived and moved.
//
// RUN : as online.suite.mjs (debug ON build served on 8091–8093, a keyed relay on 8788) :
//   bash plans/ctr-native-web/tools/play.sh online-net <session> 8092 -- --set relay=ws://localhost:8788 --set rk=<key>
//   --only NET-P2P,NET-WS,NET-HOST-LEAVES-P2P,NET-HOST-LEAVES-WS
// 4 players on the relay need four games : node's web/online/test/relay-load.test.mjs runs them
// (wasm clients, the real sv_core and relay).
// Session 11b : NET-P2P / NET-WS also check the remote-kart smoothing (jitter `jerk` p95 against
// the clean window's) ; NET-REJOIN-P2P / -WS (a guest cut off re-links by itself and joins the
// next lobby) ; NET-END-TIMEOUT (the host's end-of-race timeout ends a guest that stands still).
// Session 32 : NET-HOST-LEAVES-P2P / -WS — the host closes its tab mid-race : the guest is told,
// finishes the race alone (its own AI drives the host's kart), gets the full results, then the
// title with the room closed ; the guest's screen is filmed. The guest is agent browser b when
// play.sh has it (--set guestCdp=<host:port>), else a second tab.
// Not a node --test file.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { capture } from '/opt/devcontainer/base/skills/visual-loop/scripts/cdp.mjs'
import { makePlayer } from '/opt/devcontainer/base/skills/visual-loop/lib/player.mjs'
import { PLAYER, say } from './ctr.mjs'
import { ST, drive, online, roomToRace, shot, until } from './online.suite.mjs'

export const meta = {
	url: 'http://localhost:8092/index.html',
	login: false,
	player: { gamepad: true, pressFrames: 8 },
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const IMPAIR = readFileSync(new URL('../../net/test/impair.js', import.meta.url), 'utf8')
// what the jitter windows set on both sides : a bad Wi-Fi / a congested uplink
export const JITTER = { delay: 20, jitter: 60, loss: 0.05, reorder: 0.1 }

const netOf = tab => tab.js('return window.__ctr?.net?.summary() ?? null')
const resetNet = tab => tab.js('window.__ctr?.net?.reset(); return true')
const impair = (tab, cfg) => tab.js(`return window.__ctrImpair.set(${JSON.stringify(cfg)})`)
const syncOf = tab => tab.js('return window.__ctrOnline?.state().octr?.windowsClientSync ?? null')
// Every toast a page shows, kept (they fade) : injected with the shim
const TOASTS = `(() => {
	globalThis.__toasts = []
	const seen = new WeakSet()
	new MutationObserver(() => {
		for (const t of document.querySelectorAll('.toast')) if (!seen.has(t)) { seen.add(t); __toasts.push(t.innerText.replace(/\\s+/g, ' ').trim()) }
	}).observe(document, { childList: true, subtree: true })
})()`
const toastsOf = tab => tab.js('return globalThis.__toasts ?? []')
/** 11b : the smoothing target — under jitter, the remote kart's `jerk` p95 at most twice the clean window's (a floor for a near-zero clean one). */
export const JERK_FLOOR = 8
const smoothOk = (clean, jitter) => clean && jitter && jitter.jerk.p95 <= Math.max(2 * clean.jerk.p95, JERK_FLOOR)

/** Both karts driven for `ms`, the net counters reset at the start ; each side's view of the other. */
async function window_(r, label, ms, { drivers = ['host', 'guest'] } = {}) {
	await Promise.all([resetNet(r.host), resetNet(r.guest)])
	const deadline = Date.now() + ms
	const runs = []
	if (drivers.includes('host')) runs.push(drive({ hold: r.ctx.hold, release: r.ctx.release, press: r.ctx.press }, r.ctx.js, deadline).catch(e => ({ error: e.message })))
	if (drivers.includes('guest')) runs.push(drive(r.gp, r.gjs, deadline).catch(e => ({ error: e.message })))
	await Promise.all([...runs, sleep(ms)])
	const out = { label, host: (await netOf(r.host))?.['1'] ?? null, guest: (await netOf(r.guest))?.['1'] ?? null }
	say(`${label} : host sees the guest ${JSON.stringify(out.host)} · guest sees the host ${JSON.stringify(out.guest)}`)
	return out
}

/** Polls `pred` on `tab`'s online state every 250 ms ; ms until true, or null after `cap` ms. */
async function timeUntil(tab, pred, cap) {
	const t0 = Date.now()
	while (Date.now() - t0 < cap) {
		const s = await online(tab).catch(() => null)
		if (s && pred(s)) return Date.now() - t0
		await sleep(250)
	}
	return null
}

const guestGone = s => s.links.length === 0 || s.octr?.names?.[1] === ''

const echoesOf = async tab => (await online(tab))?.stats?.received?.[7] ?? 0 // SG_RACEDATA, the guest's own echo included
const HOST_LEFT = /host left|hôte a quitté/i
const FINISH_ALONE = /finish this race alone|finis cette course seul/i
const ROOM_CLOSED = /room is closed|partie est fermée/i
const HOST_LOST = /connection to the host lost|connexion à l'hôte perdue/i

/**
 * One race, measured and checked (session 11) : clean and jittered windows (the remote-kart
 * counter), the host paused (its server keeps serving : the guest still gets kart states), its tab
 * hidden, then the guest's page goes silent : the host drops it within the core's 5 s room
 * timeout, and the guest — whose link the host closed — is told and back to solo.
 */
async function measure(ctx, mode) {
	const r = { ctx, ...(await roomToRace(ctx, mode, { inject: [IMPAIR] })) }
	const res = { mode, path: `${r.gl.backend}/${r.gl.path}` }
	try {
		res.clean = await window_(r, 'clean', 12_000)
		await Promise.all([impair(r.host, JITTER), impair(r.guest, JITTER)])
		res.jitter = await window_(r, `jitter ${JSON.stringify(JITTER)}`, 12_000)
		await Promise.all([impair(r.host, { delay: 0, jitter: 0, loss: 0, reorder: 0 }), impair(r.guest, { delay: 0, jitter: 0, loss: 0, reorder: 0 })])

		// the host pauses (Start) : its server still serves the room
		const s0 = await syncOf(r.host)
		await r.host.press('Enter')
		await sleep(500)
		const e0 = await echoesOf(r.guest)
		res.hostPaused = await window_(r, 'host paused', 6_000, { drivers: ['guest'] })
		res.hostPaused.hostBridgeFrames = ((await syncOf(r.host)) - s0 + 256) % 256
		res.hostPaused.guestKartStatesPerSec = Math.round(((await echoesOf(r.guest)) - e0) / 6)
		say(`host paused : its bridge ran ${res.hostPaused.hostBridgeFrames} frames, the guest got ${res.hostPaused.guestKartStatesPerSec} kart states / s`)
		await r.host.press('Enter')
		await sleep(1000)

		// the host's tab hidden behind another tab of its browser
		const { targetId } = await ctx.conn.send('Target.createTarget', { url: new URL('/preload-flag.js', ctx.args.url).href })
		await sleep(500)
		const vis = await ctx.js('return document.visibilityState')
		res.hostHidden = await window_(r, `host hidden (${vis})`, 6_000, { drivers: ['guest'] })
		res.hostHidden.visibility = vis
		await ctx.conn.send('Target.closeTarget', { targetId })
		await sleep(1000)
		res.hostHidden.visibilityAfter = await ctx.js('return document.visibilityState')

		// the guest goes silent (every send of its page cut, ICE / WebSocket pings untouched)
		await impair(r.guest, { cut: true })
		const cutAt = Date.now()
		res.guestCutNoticedMs = await timeUntil(r.host, guestGone, 45_000)
		say(`guest cut : the host noticed after ${res.guestCutNoticedMs ?? '> 45000'} ms`)
		res.guestToldMs = await timeUntil(r.guest, s => !s.lobby.active && HOST_LOST.test(s.error), 15_000)
		res.guestToldMs = res.guestToldMs == null ? null : Date.now() - cutAt
		res.guestError = (await online(r.guest))?.error
		res.hostAfter = (await online(r.host))?.octr
		say(`the guest was told after ${res.guestToldMs} ms : ${res.guestError}`)
	} finally {
		await r.close()
	}
	res.smoothing = {
		hostSeesGuest: { clean: res.clean.host?.jerk, jitter: res.jitter.host?.jerk, ok: smoothOk(res.clean.host, res.jitter.host) },
		guestSeesHost: { clean: res.clean.guest?.jerk, jitter: res.jitter.guest?.jerk, ok: smoothOk(res.clean.guest, res.jitter.guest) },
	}
	say(`smoothing : ${JSON.stringify(res.smoothing)}`)
	file(ctx, `net-${mode}.json`, res)
	if (!(res.hostPaused.guestKartStatesPerSec >= 20)) throw new Error(`host paused : the room froze (${res.hostPaused.guestKartStatesPerSec} kart states / s at the guest)`)
	if (!(res.guestCutNoticedMs <= 6500)) throw new Error(`a silent guest noticed after ${res.guestCutNoticedMs} ms`)
	if (res.guestToldMs == null) throw new Error(`the dropped guest was not told : ${res.guestError}`)
	if (!(res.smoothing.hostSeesGuest.ok && res.smoothing.guestSeesHost.ok)) throw new Error(`remote karts jerk under jitter : ${JSON.stringify(res.smoothing)}`)
	return JSON.stringify(res)
}

/**
 * 11b : a guest cut off mid-race (every send of its page held) is dropped by the host, sees the
 * host still on the meeting point and re-links by itself on a fresh link (a new room id) once the
 * network is back ; the room still races, so its game waits on its title, refused by the locked
 * room ; the host finishes, the room resets, and the guest is in the next lobby — same name,
 * same slots.
 */
async function rejoin(ctx, mode) {
	const r = { ctx, ...(await roomToRace(ctx, mode, { inject: [IMPAIR, TOASTS] })) }
	const res = { mode, path: `${r.gl.backend}/${r.gl.path}` }
	try {
		const before = (await online(r.guest)).selfId // the guest's own relay id : a fresh link has a new one
		await sleep(2000)
		await impair(r.guest, { cut: true })
		const cutAt = Date.now()
		res.toldMs = await timeUntil(r.guest, s => HOST_LOST.test(s.error) || s.rejoin > 0, 20_000)
		res.toldMs = res.toldMs == null ? null : Date.now() - cutAt
		say(`guest cut : told after ${res.toldMs} ms`)
		await impair(r.guest, { cut: false })
		res.relinkMs = await timeUntil(r.guest, s => s.links.length === 1 && s.selfId !== before, 90_000)
		res.relinkMs = res.relinkMs == null ? null : Date.now() - cutAt
		const g1 = await online(r.guest)
		res.after = { path: g1.links[0] ? `${g1.links[0].backend}/${g1.links[0].path}` : null, selfId: g1.selfId, before }
		say(`re-linked after ${res.relinkMs} ms : ${JSON.stringify(res.after)}`)
		if (res.relinkMs == null) throw new Error(`the guest did not re-link : ${JSON.stringify({ error: g1.error, rejoin: g1.rejoin, lastError: g1.lastError })}`)
		// 32f : the guest waits watching the host's race, its band up, its game refused by the locked room
		const w = await until(r.guest, 'the guest watches, waiting for the race (the room refuses it)', s => !!s.watch?.band && s.octr?.CurrState === ST.PICK_ROOM, 60_000)
		res.waiting = { band: w.watch.band, shown: w.watch.shown }
		res.guestScreen = await r.gjs('return window.__ctr?.screen ?? null')
		say(`the guest waits : ${JSON.stringify(res.waiting)} (screen ${res.guestScreen})`)
		// the host alone in the race : to the finish line
		res.host = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, Date.now() + 300_000)
		say(`host race : ${JSON.stringify(res.host)}`)
		await until(r.guest, 'the guest in the next lobby', s => s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.octr.NumDrivers === 2 && s.octr.names[1] === 'Host' && s.share?.state === 'connected', 90_000)
		await until(r.host, 'the host sees the guest back', s => s.octr.CurrState === ST.HOST_TRACK_PICK && s.octr.names[1] === 'Guest', 30_000)
		const g2 = await online(r.guest)
		res.lobby = { guestSlot: g2.share.slot, driverID: g2.octr.DriverID, names: g2.octr.names.slice(0, 2), media: g2.share.media }
		res.toasts = await toastsOf(r.guest)
		await shot(ctx, `rejoin-${mode}-lobby`)
	} finally {
		await r.close()
	}
	file(ctx, `net-rejoin-${mode}.json`, res)
	say(JSON.stringify(res))
	if (res.lobby.guestSlot !== 1 || res.lobby.driverID !== 1) throw new Error(`the guest came back in another slot : ${JSON.stringify(res.lobby)}`)
	if (!res.waiting?.band || res.waiting.band.cup) throw new Error(`the waiting guest's band : ${JSON.stringify(res.waiting)}`)
	return JSON.stringify(res)
}

/**
 * 11b : the host's end-of-race timeout (15 s here) — the host drives to the finish, the guest
 * stands still on the grid ; 15 s after the host's finish the guest's page ends its race (its
 * game sends an ordinary CG_ENDRACE), the room resets and both are back in the lobby.
 */
async function endTimeout(ctx, mode) {
	const r = { ctx, ...(await roomToRace(ctx, mode, { inject: [TOASTS] })) }
	const res = { mode, path: `${r.gl.backend}/${r.gl.path}` }
	try {
		await ctx.js("const e = document.getElementById('online-end-after'); e.value = '15'; e.dispatchEvent(new Event('change')); return true")
		res.host = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, Date.now() + 300_000)
		const finishedAt = Date.now()
		say(`host race : ${JSON.stringify(res.host)}`)
		if (!res.host.finished) throw new Error(`the host did not finish : ${JSON.stringify(res.host)}`)
		res.guestEndedMs = await timeUntil(r.guest, s => s.octr.CurrState === ST.END_RACE, 40_000)
		res.guestEndedMs = res.guestEndedMs == null ? null : Date.now() - finishedAt
		res.hostEnded = (await online(r.host)).octr.numDriversEnded
		say(`the guest's race ended ${res.guestEndedMs} ms after the host's finish ; the host counts ${res.hostEnded} finishers`)
		await shot(ctx, `end-timeout-${mode}-results`)
		await until(r.guest, 'the guest back in the lobby', s => s.octr.CurrState === ST.GUEST_TRACK_WAIT, 60_000)
		await until(r.host, 'the host back in the lobby', s => s.octr.CurrState === ST.HOST_TRACK_PICK, 30_000)
		res.toasts = { host: await toastsOf(r.host), guest: await toastsOf(r.guest) }
	} finally {
		await r.close()
	}
	file(ctx, `net-end-timeout-${mode}.json`, res)
	say(JSON.stringify(res))
	if (res.guestEndedMs == null || res.guestEndedMs < 13_000 || res.guestEndedMs > 25_000) throw new Error(`the guest's race ended ${res.guestEndedMs} ms after the first finish, wanted ~15 s`)
	if (res.hostEnded !== 2) throw new Error(`the host counts ${res.hostEnded} finishers`)
	return JSON.stringify(res)
}

/** The host leaves in the race : the guest is told and back to solo within 10 s. */
async function hostLeaves(ctx, mode) {
	const r = { ctx, ...(await roomToRace(ctx, mode, { inject: [IMPAIR, TOASTS] })) }
	const res = { mode, path: `${r.gl.backend}/${r.gl.path}` }
	const dir = runDir(ctx)
	const cur = { id: `NET-HOST-LEAVES-${mode}`, proofs: [] }
	const gRec = dir ? makePlayer({ conn: r.guest.gconn, sid: null, js: r.gjs, capture, dir, current: () => cur, pressFrames: PLAYER.pressFrames }) : null
	const body = async () => {
		await sleep(3000)
		await ctx.js(`location.href = '/preload-flag.js'; return true`).catch(() => {})
		const t0 = Date.now()
		// told, still racing : the guest's game kept the race, the host's kart (slot 1) is its AI's
		const told = await until(r.guest, 'the guest told it finishes alone', s => FINISH_ALONE.test(s.error ?? ''), 15_000)
		res.toldAt = Date.now() - t0
		res.atTold = { active: told.lobby.active, state: told.octr.CurrState, ai: told.lobby.hostBots }
		say(`told after ${res.toldAt} ms : ${JSON.stringify(res.atTold)}`)
		res.drive = await drive(r.gp, r.gjs, Date.now() + 300_000)
		const end = await until(r.guest, 'the full results (both karts)', s => s.octr.CurrState === ST.END_RACE && s.octr.raceStats.length === 2, 240_000)
		res.results = end.octr.raceStats
		say(`results : ${JSON.stringify(res.results)}`)
		await sleep(2000)
		const shotR = await r.guest.gconn.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
		if (dir && shotR?.data) writeFileSync(join(dir, `net-host-leaves-${mode}-guest-results.png`), Buffer.from(shotR.data, 'base64'))
		const closed = await until(r.guest, 'the title, the room closed', s => !s.lobby.active && ROOM_CLOSED.test(s.error ?? ''), 30_000)
		res.closedAt = Date.now() - t0
		res.closed = { state: closed.octr.CurrState, error: closed.error }
		await sleep(3000)
	}
	try {
		if (gRec) cur.video = await gRec.record(`host-leaves-${mode}-guest`, body)
		else await body()
		res.guestToasts = await toastsOf(r.guest)
		res.guestGame = await r.gjs('return window.__ctr ? { screen: window.__ctr.screen, level: window.__ctr.levelID, menu: window.__ctr.menu?.title ?? null } : null')
		const shotR = await r.guest.gconn.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
		if (dir && shotR?.data) writeFileSync(join(dir, `net-host-leaves-${mode}-guest.png`), Buffer.from(shotR.data, 'base64'))
	} finally {
		await r.close()
	}
	file(ctx, `net-host-leaves-${mode}.json`, { ...res, video: cur.video ?? null })
	if (!res.atTold.active || !(res.atTold.ai >> 1 & 1)) throw new Error(`the guest did not keep the race with the host's kart to its AI : ${JSON.stringify(res.atTold)}`)
	if (!res.results.some(x => x.slot === 1)) throw new Error(`the host's kart is not in the results : ${JSON.stringify(res.results)}`)
	// a whole race on the clock that counts on past this player's finish (no 0 nor a frame's time)
	if (res.results.some(x => !(x.finalTime > 20_000))) throw new Error(`a course time under 20 s : ${JSON.stringify(res.results)}`)
	if (!res.guestToasts.some(t => FINISH_ALONE.test(t)) || !res.guestToasts.some(t => ROOM_CLOSED.test(t))) throw new Error(`the guest's toasts : ${JSON.stringify(res.guestToasts)}`)
	if (res.guestGame?.screen !== 'menu') throw new Error(`the guest is not back on the title : ${JSON.stringify(res.guestGame)}`)
	return JSON.stringify({ toldAt: res.toldAt, closedAt: res.closedAt, results: res.results, toasts: res.guestToasts, game: res.guestGame })
}

/**
 * 32f : a guest that lost its link and could not see the host on the meeting point (the relay's
 * list missed it at that instant ; here the guest's copy of the list is emptied, then its links cut
 * until its 5 s timeout) races on alone ; at its results, the host still there : back in the same
 * room at the host's next lobby, never left in a closed room.
 */
async function lostSolo(ctx, mode) {
	const r = { ctx, ...(await roomToRace(ctx, mode, { inject: [IMPAIR, TOASTS] })) }
	const res = { mode }
	try {
		const room = (await online(r.guest)).room
		await sleep(3000)
		// the page's copy of the relay's list (web/net/signaling.js sig.peers), emptied in place
		if (!(await r.gjs('const p = globalThis.Module?.ctrOnlineNet?.room?.signaling?.peers; if (p) p.length = 0; return !!p'))) throw new Error('no relay list on the guest page')
		await impair(r.guest, { cut: true })
		const told = await until(r.guest, 'the guest finishes alone', s => FINISH_ALONE.test(s.error ?? ''), 30_000)
		res.solo = { active: told.lobby.active, ai: told.lobby.hostBots }
		await impair(r.guest, { cut: false })
		// both race to the finish : the guest alone in its game, the host with the guest's kart its AI's
		const deadline = Date.now() + 300_000
		const [h, g] = await Promise.all([drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, deadline), drive(r.gp, r.gjs, deadline)])
		res.finished = { host: h.finished, guest: g.finished }
		const back = await until(r.guest, 'the guest back in the room\'s next lobby', s => (s.octr?.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected') || ROOM_CLOSED.test(s.error ?? ''), 180_000)
		res.back = { role: back.role, room: back.room, state: back.octr?.CurrState, driverID: back.octr?.DriverID, slot: back.share?.slot, error: back.error }
		res.toasts = await toastsOf(r.guest)
		await shot(ctx, `lost-solo-${mode}-lobby`)
		if (ROOM_CLOSED.test(back.error ?? '') || back.room !== room || back.octr?.DriverID !== 1) throw new Error(`the guest after its solo race : ${JSON.stringify(res.back)} (room ${room})`)
	} finally {
		await r.close()
	}
	file(ctx, `net-lost-solo-${mode}.json`, res)
	return JSON.stringify(res)
}

/** The run's proof folder : the newest one under --set proofs=<root>. */
function runDir(ctx) {
	const root = ctx.args.proofs
	if (!root) return null
	const dirs = readdirSync(root).map(d => join(root, d)).filter(d => statSync(d).isDirectory())
	return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
}

/** A result next to the run's proofs (the newest run folder under --set proofs=). */
function file(ctx, name, value) {
	const dir = runDir(ctx)
	if (dir) writeFileSync(join(dir, name), JSON.stringify(value, null, 2))
}

export default async ctx => {
	await ctx.scenario('NET-P2P', () => measure(ctx, 'auto'))
	await ctx.scenario('NET-WS', () => measure(ctx, 'ws'))
	await ctx.scenario('NET-HOST-LEAVES-P2P', () => hostLeaves(ctx, 'auto'))
	await ctx.scenario('NET-HOST-LEAVES-WS', () => hostLeaves(ctx, 'ws'))
	await ctx.scenario('NET-REJOIN-P2P', () => rejoin(ctx, 'auto'))
	await ctx.scenario('NET-REJOIN-WS', () => rejoin(ctx, 'ws'))
	await ctx.scenario('NET-END-TIMEOUT', () => endTimeout(ctx, 'auto'))
	// 32f : a guest racing alone because it could not see the host comes back once the host is seen
	await ctx.scenario('NET-LOST-SOLO', () => lostSolo(ctx, 'auto'))
}

export { shot }
