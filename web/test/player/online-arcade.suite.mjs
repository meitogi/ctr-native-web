// Player suite : Online Arcade with the host's bots (session 23, docs/ONLINECTR_PORT.md D11).
// Two browsers (agent browser a hosts, b is the guest — LOG T4) ; the host plays ONLINE → ARCADE
// → single race → 2P → the difficulty's default → characters → track, as online.suite.mjs plays
// VS. The host's bots fill the race up to 8 karts ; the guest's game sees them as remote karts.
//
// ONLINE-ARCADE        8 karts on both screens, the bots named after their character, the bots'
//                      karts moving on the guest's screen by session 11's counter (window.__ctr.net,
//                      against the host's own kart there), the whole race driven and filmed on both
//                      screens, the results with all 8 on both.
// ONLINE-ARCADE-LEAVE  the guest leaves mid-race : the host's AI drives its kart on (the same slot,
//                      the player's name, never an empty SG_NAME), the host is told, the kart finishes.
//
// RUN : as online.suite.mjs (debug ON build served on 8091–8093, a keyed relay on 8788) :
//   bash plans/ctr-native-web/tools/play.sh online-arcade <session> 8092 -- --set relay=ws://localhost:8788 --set rk=<key>
//   (play.sh passes --set guestCdp=<agent browser b> : the guest in a browser of its own)
// Not a node --test file.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { say } from './ctr.mjs'
import { drive, itemRaceOn, online, roomToRace, runDirOf, shot, until } from './online.suite.mjs'
import { JERK_FLOOR } from './online-net.suite.mjs'

export const meta = {
	url: 'http://localhost:8092/index.html',
	login: false,
	player: { gamepad: true, pressFrames: 8 },
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const TOASTS = `(() => {
	globalThis.__toasts = []
	const seen = new WeakSet()
	new MutationObserver(() => {
		for (const t of document.querySelectorAll('.toast')) if (!seen.has(t)) { seen.add(t); __toasts.push(t.innerText.replace(/\\s+/g, ' ').trim()) }
	}).observe(document, { childList: true, subtree: true })
})()`
// The fullest results table of the race, kept by the page itself (a read from outside can stall
// beside the filmed race, and the room's reset clears the table 6 s after the last finisher)
const RESULTS = `setInterval(() => {
	const s = window.__ctrOnline?.state()
	if (s?.octr && s.lobby.phase === 3 && s.octr.raceStats.length >= (window.__results?.octr.raceStats.length ?? 0)) window.__results = s
}, 250)`
const toastsOf = tab => tab.js('return globalThis.__toasts ?? []')
const netOf = tab => tab.js('return window.__ctr?.net?.summary() ?? null')
const resetNet = tab => tab.js('window.__ctr?.net?.reset(); return true')
const karts = s => s?.karts?.slots?.filter(k => k.exists).length ?? 0
// the base characters' short names (MetaDataCharacters name_LNG_short, cut to NAME_LEN 9)
const NAMED = /^[A-Z][A-Za-z. ]{1,8}$/
const TAKEOVER = /left : a bot finishes|est parti : un bot finit/i

/** The guest's screen from the compositor's surface, next to the host's shots. */
async function guestShot(ctx, guest, label) {
	const proof = await shot(ctx, `${label}-host`)
	const dir = proof?.file ? runDirOf(ctx.args.proofs, proof.file) : null
	const r = await guest.gconn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }).catch(() => null)
	if (dir && r?.data) writeFileSync(join(dir, proof.file.replace(/-host\.png$/, '-guest.png')), Buffer.from(r.data, 'base64'))
}

/** No more than 8 at the start : the room, the names, the host's bot mask. */
async function eightKarts(host, guest) {
	const hs = await until(host, '8 karts on the host', s => karts(s) === 8, 30_000)
	const gs = await until(guest, '8 karts on the guest', s => karts(s) === 8, 30_000)
	if (hs.lobby.hostBots !== 0xfc) throw new Error(`host : bots in slots ${hs.lobby.hostBots.toString(2)}, wanted 2–7`)
	if (gs.octr.NumDrivers !== 8 || hs.octr.NumDrivers !== 8) throw new Error(`NumDrivers host ${hs.octr.NumDrivers}, guest ${gs.octr.NumDrivers}`)
	// on the guest (DriverID 1) the bots' clientIDs 2–7 are its slots 2–7, as on the host
	const names = gs.octr.names.slice(2)
	if (!names.every(n => NAMED.test(n))) throw new Error(`the guest's names for the bots : ${JSON.stringify(names)}`)
	if (JSON.stringify(names) !== JSON.stringify(hs.octr.names.slice(2))) throw new Error(`names differ : host ${JSON.stringify(hs.octr.names)}, guest ${JSON.stringify(gs.octr.names)}`)
	return names
}

/** The guest's view of every remote kart over a whole race : bots and the host, by __ctr.net. */
async function arcade(ctx) {
	const r = await roomToRace(ctx, 'auto', { inject: [TOASTS, RESULTS], arcade: true })
	const { host, guest } = r
	try {
		const names = await eightKarts(host, guest)
		say(`8 karts : the bots ${names.join(', ')}`)
		await guestShot(ctx, guest, 'arcade-start')
		// the bots get 120 s after the first finisher (the host's end-of-race timeout, 11b)
		await ctx.js("const e = document.getElementById('online-end-after'); e.value = '120'; e.dispatchEvent(new Event('change')); return true")
		await resetNet(guest)
		// halfway through the race, the guest's counter over the last frames
		let mid = null
		const midway = (async () => { await sleep(45_000); mid = await netOf(guest).catch(() => null) })()
		const race = await itemRaceOn(ctx, r)
		await midway
		if (!mid) throw new Error('no __ctr.net on the guest (a debug build ?)')
		const hostView = mid['1']
		const bots = [2, 3, 4, 5, 6, 7].map(s => ({ slot: s, ...mid[String(s)] }))
		say(`guest's counter : host ${JSON.stringify(hostView)} · bots ${JSON.stringify(bots)}`)
		for (const b of bots) {
			if (!(b.packetsPerSec >= 20)) throw new Error(`bot slot ${b.slot} : ${b.packetsPerSec} kart states / s on the guest`)
			if (!(b.step?.p50 > 0)) throw new Error(`bot slot ${b.slot} : not moving on the guest (step ${JSON.stringify(b.step)})`)
			if (!(b.jerk.p95 <= Math.max(2 * hostView.jerk.p95, JERK_FLOOR))) throw new Error(`bot slot ${b.slot} : jerk p95 ${b.jerk.p95}, the host's kart ${hostView.jerk.p95}`)
		}
		// the results : the bots finish after the humans (or at the host's end-of-race timeout) ; the
		// room resets 6 s after the last one, so each page kept the fullest table it saw (RESULTS)
		const full = tab => tab.js('return window.__results ?? null').catch(() => null)
		for (let i = 0; i < 150 && !((await full(host))?.octr.raceStats.length === 8 && (await full(guest))?.octr.raceStats.length === 8); i++) await sleep(1000)
		const hs = await full(host)
		const gs = await full(guest)
		if (hs?.octr.raceStats.length !== 8 || gs?.octr.raceStats.length !== 8) {
			const log = await host.js("return (document.getElementById('log')?.textContent ?? '').split('\\n').filter(l => /Bot|timeout|finished/.test(l)).slice(-16).join(' | ')").catch(e => e.message)
			throw new Error(`results : host ${JSON.stringify(hs?.octr.raceStats.map(x => x.slot))}, guest ${JSON.stringify(gs?.octr.raceStats.map(x => x.slot))} · host log ${log}`)
		}
		await guestShot(ctx, guest, 'arcade-results')
		const order = s => s.octr.raceStats.map(x => `${s.octr.names[x.slot] || '?'} ${(x.finalTime / 960).toFixed(1)}s`)
		for (const s of [hs, gs]) if (new Set(s.octr.raceStats.map(x => x.slot)).size !== 8) throw new Error(`results : ${JSON.stringify(s.octr.raceStats)}`)
		return `${race} · host results ${order(hs).join(' / ')} · guest results ${order(gs).join(' / ')} · bots on the guest ${bots.map(b => `${b.slot}:${b.packetsPerSec}/s jerk ${b.jerk.p95}`).join(' ')} (host's kart jerk ${hostView.jerk.p95})`
	} finally {
		await r.close()
	}
}

/** The guest leaves mid-race : its kart drives on, on the host's AI. */
async function leave(ctx) {
	const r = await roomToRace(ctx, 'auto', { inject: [TOASTS], arcade: true })
	const { host, guest, gp, gjs } = r
	try {
		await eightKarts(host, guest)
		const deadline = Date.now() + 240_000
		const hostDrive = drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, deadline)
		await Promise.race([drive(gp, gjs, Date.now() + 25_000), sleep(25_000)])
		await shot(ctx, 'leave-before')
		await r.leave()
		const t0 = Date.now()
		const taken = await until(host, 'the takeover (slot 1 to the host\'s AI)', s => (s.lobby.hostBots & 2) !== 0, 10_000)
		const ms = Date.now() - t0
		if (taken.octr.names[1] !== 'Guest') throw new Error(`the kart's name became ${JSON.stringify(taken.octr.names[1])}`)
		const p0 = taken.karts.slots[1]
		await sleep(8000)
		const later = await online(host)
		const p1 = later.karts.slots[1]
		const moved = Math.hypot(p1.posX - p0.posX, p1.posZ - p0.posZ) / 256
		if (!p1.exists || moved < 30) throw new Error(`the taken-over kart moved ${moved.toFixed(0)} units in 8 s`)
		await shot(ctx, 'leave-taken-over')
		const toasts = await toastsOf(host)
		if (!toasts.some(t => TAKEOVER.test(t))) throw new Error(`no takeover toast on the host : ${JSON.stringify(toasts)}`)
		const h = await hostDrive
		const end = await until(host, 'the taken-over kart finishes', s => s.octr.raceStats.some(x => x.slot === 1), 180_000, 1000)
		await shot(ctx, 'leave-results')
		const stat = end.octr.raceStats.find(x => x.slot === 1)
		return `left after 25 s · taken over in ${ms} ms, still « ${taken.octr.names[1]} » · moved ${moved.toFixed(0)} units in 8 s · host ${h.finished ? `finished, rank ${h.rank}` : 'did not finish'} · the kart finished ${(stat.finalTime / 960).toFixed(1)} s, ${end.octr.raceStats.length} finishers · host toasts ${JSON.stringify(toasts)}`
	} finally {
		await r.close()
	}
}

export default async ctx => {
	await ctx.scenario('ONLINE-ARCADE', () => arcade(ctx))
	await ctx.scenario('ONLINE-ARCADE-LEAVE', () => leave(ctx))
}
