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
// Not a node --test file.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { say } from './ctr.mjs'
import { drive, online, roomToRace, shot } from './online.suite.mjs'

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
	file(ctx, `net-${mode}.json`, res)
	if (!(res.hostPaused.guestKartStatesPerSec >= 20)) throw new Error(`host paused : the room froze (${res.hostPaused.guestKartStatesPerSec} kart states / s at the guest)`)
	if (!(res.guestCutNoticedMs <= 6500)) throw new Error(`a silent guest noticed after ${res.guestCutNoticedMs} ms`)
	if (res.guestToldMs == null) throw new Error(`the dropped guest was not told : ${res.guestError}`)
	return JSON.stringify(res)
}

/** The host leaves in the race : the guest is told and back to solo within 10 s. */
async function hostLeaves(ctx, mode) {
	const r = { ctx, ...(await roomToRace(ctx, mode, { inject: [IMPAIR] })) }
	const res = { mode, path: `${r.gl.backend}/${r.gl.path}`, samples: [] }
	try {
		await sleep(3000)
		await ctx.js(`location.href = '/preload-flag.js'; return true`).catch(() => {})
		const t0 = Date.now()
		while (Date.now() - t0 < 12_000) {
			const s = await online(r.guest).catch(e => ({ error: e.message }))
			const g = await r.gjs('return window.__ctr ? { screen: window.__ctr.screen, level: window.__ctr.levelID, speed: window.__ctr.kart?.speed } : null').catch(() => null)
			res.samples.push({ t: Date.now() - t0, links: s?.links?.length, state: s?.octr?.CurrState, names: s?.octr?.names?.slice(0, 2), lobby: s?.lobby, error: s?.error, lastError: s?.lastError?.code, game: g })
			await sleep(1000)
		}
		res.toldAt = res.samples.find(x => HOST_LEFT.test(x.error ?? '') && !x.lobby?.active)?.t ?? null
		res.guestToasts = await r.gjs("return [...document.querySelectorAll('[class*=toast], #online-error')].map(e => e.textContent.trim()).filter(Boolean)")
		const shotR = await r.guest.gconn.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
		const dir = runDir(ctx)
		if (dir && shotR?.data) writeFileSync(join(dir, `net-host-leaves-${mode}-guest.png`), Buffer.from(shotR.data, 'base64'))
	} finally {
		await r.close()
	}
	file(ctx, `net-host-leaves-${mode}.json`, res)
	say(JSON.stringify(res.samples.at(-1)))
	if (res.toldAt == null || res.toldAt > 10_000) throw new Error(`the guest was not told the host left : ${JSON.stringify(res.samples.at(-1))}`)
	return JSON.stringify({ toldAt: res.toldAt, last: res.samples.at(-1), toasts: res.guestToasts })
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
}

export { shot }
