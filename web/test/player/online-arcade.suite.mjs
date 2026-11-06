// Player suite : Online Arcade with the host's bots (session 23, docs/ONLINECTR_PORT.md D11).
// Two browsers (agent browser a hosts, b is the guest — LOG T4) ; the host plays ONLINE → ARCADE
// → single race → the difficulty's default → characters → track, as online.suite.mjs plays
// VS. The host's bots fill the race up to 8 karts ; the guest's game sees them as remote karts.
//
// ONLINE-ARCADE        8 karts on both screens, the bots named after their character, the bots'
//                      karts moving on the guest's screen by session 11's counter (window.__ctr.net,
//                      against the host's own kart there), the whole race driven and filmed on both
//                      screens, the results with all 8 on both.
//                      Session 32 : then the host back on its character select (the guest behind
//                      its picture), both pick again, a second race with 8 karts (the bots join again).
// ONLINE-ARCADE-LEAVE  the guest leaves mid-race : the host's AI drives its kart on (the same slot,
//                      the player's name, never an empty SG_NAME), the host is told, the kart finishes.
//                      Session 32 : then the host alone on the character select ; its way back,
//                      Triangle out of it, then Triangle up to the main menu : the room left (32e).
// ONLINE-ARCADE-CUP    session 32 : a whole Arcade Cup, the 4 races chained, the standings on both.
//                      Session 32d : the host's Cross skips the standings after races 1-3 and the
//                      final standings (D12.10), each wait timed.
// NETPLAY-PAUSE        session 32d (D12.9) : the host's Start mid-race opens the pause menu, the
//                      race clock runs on under it ; Triangle, Start and RESUME close it ; PAUSE FOR
//                      EVERYONE freezes both games (their clocks still for 3 s, then 30 s with the
//                      link alive, « PAUSED BY THE HOST »), the guest's Start opens RESUME / QUIT
//                      and unfreezes nothing, the host's RESUME FOR EVERYONE runs both again.
// NETPLAY-FINISH-HERE  session 32d : the host finishes, the guest (the last human) picks FINISH THE
//                      RACE : the full results on both in < 2 s, its time the bots' estimate ;
//                      the camera of the finished host on the guest's kart (a shot) ; then the
//                      host's Cross on the results : its character select in < 2 s, the guest's
//                      Cross on its results doing nothing.
//
// RUN : as online.suite.mjs (debug ON build served on 8091–8093, a keyed relay on 8788) :
//   bash plans/ctr-native-web/tools/play.sh online-arcade <session> 8092 -- --set relay=ws://localhost:8788 --set rk=<key>
//   (play.sh passes --set guestCdp=<agent browser b> : the guest in a browser of its own)
// Not a node --test file.

import { say } from './ctr.mjs'
import { ST, charactersToRace, cupOn, drive, game, guestShot, itemRaceOn, online, roomToRace, shot, until, untilGame } from './online.suite.mjs'
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
// Session 32d : when both humans (slots 0, 1) had finished, and when the table was full
const RESULTS = `setInterval(() => {
	const s = window.__ctrOnline?.state()
	if (s?.octr && s.lobby.phase === 3 && s.octr.raceStats.length >= (window.__results?.octr.raceStats.length ?? 0)) window.__results = s
	const stats = window.__results?.octr.raceStats ?? []
	if (!window.__humansAt && [0, 1].every(slot => stats.some(x => x.slot === slot))) window.__humansAt = Date.now()
	if (!window.__fullAt && stats.length === 8) window.__fullAt = Date.now()
}, 50)`
const toastsOf = tab => tab.js('return globalThis.__toasts ?? []')
const netOf = tab => tab.js('return window.__ctr?.net?.summary() ?? null')
const resetNet = tab => tab.js('window.__ctr?.net?.reset(); return true')
const karts = s => s?.karts?.slots?.filter(k => k.exists).length ?? 0
// the base characters' short names (MetaDataCharacters name_LNG_short, cut to NAME_LEN 9)
const NAMED = /^[A-Z][A-Za-z. ]{1,8}$/
const TAKEOVER = /left : a bot finishes|est parti : un bot finit/i

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

/** After the room's reset : the host on its character select, the guest in the lobby behind it. */
async function afterRace(host, guest) {
	const t0 = Date.now()
	const h = await untilGame(host, 'the host on its character select after the race', s => s.charSelect != null, 60_000)
	await until(host, 'the host in the next lobby', s => s.octr.CurrState === ST.HOST_TRACK_PICK, 15_000)
	const g = await until(guest, 'the guest in the next lobby', s => s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected', 30_000)
	return `after the race : the host's character select in ${((Date.now() - t0) / 1000).toFixed(1)} s (mode ${h.mode.join('|')}), the guest in the lobby (${g.octr.names.slice(0, 2).join(', ')})`
}

/** The host alone at the character select : one player, then Triangle back out of it twice. */
async function backFromCharacters(ctx, host) {
	await untilGame(host, 'the host on its character select after the race', s => s.charSelect != null, 60_000)
	await shot(ctx, 'leave-after-race-characters')
	await sleep(1000)
	const steps = []
	for (let i = 0; i < 6 && (await game(host))?.charSelect; i++) {
		await host.press('z') // keyboard Z = Triangle
		await sleep(1200)
	}
	const g1 = await untilGame(host, 'a menu after Triangle', s => !s.charSelect && s.menu != null && s.menu.input, 10_000)
	steps.push(`${g1.menu.title || '(main)'} > ${g1.sub?.title ?? '-'} / ${g1.sub?.label ?? g1.menu.label}`)
	await shot(ctx, 'leave-back-1')
	let g = g1
	for (let i = 0; i < 4 && g.sub != null; i++) {
		await host.press('z')
		await sleep(1000)
		g = await game(host)
		steps.push(`${g.menu?.title || '(main)'} > ${g.sub?.title ?? '-'} / ${g.sub?.label ?? g.menu?.label}`)
	}
	await shot(ctx, 'leave-back-main')
	const o = await online(host)
	if (g.sub != null || g.menu?.label !== 'NETPLAY') throw new Error(`Triangle did not lead back to the main menu : ${steps.join(' → ')}`)
	if (o.role && o.role !== 'none') throw new Error(`still in the room on the main menu (${o.role})`)
	return `character select → Triangle : ${steps.join(' → ')} (the room left)`
}

/** The guest's view of every remote kart over a whole race : bots and the host, by __ctr.net. */
async function arcade(ctx) {
	const r = await roomToRace(ctx, 'auto', { inject: [TOASTS, RESULTS], arcade: true })
	const { host, guest } = r
	try {
		const names = await eightKarts(host, guest)
		say(`8 karts : the bots ${names.join(', ')}`)
		// session 32 : the guest knows the bots (the host's word, our LOBBY message) : their names in silver
		const told = await until(guest, 'the bots told to the guest', s => s.roomInfo?.bots === 0xfc, 15_000)
		say(`the guest's bots by clientID : ${told.roomInfo.bots.toString(2)}`)
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
		// session 32d : the bots end at once once both humans are in (32c) : the full table < 2 s after
		const humansToFull = await host.js('return window.__fullAt - window.__humansAt')
		if (!(humansToFull >= 0 && humansToFull < 2000)) throw new Error(`the last human's finish to the full results : ${humansToFull} ms`)
		const order = s => s.octr.raceStats.map(x => `${s.octr.names[x.slot] || '?'} ${(x.finalTime / 960).toFixed(1)}s`)
		for (const s of [hs, gs]) if (new Set(s.octr.raceStats.map(x => x.slot)).size !== 8) throw new Error(`results : ${JSON.stringify(s.octr.raceStats)}`)
		// session 32 : after the room's reset, the character select again, then a second race
		const back = await afterRace(host, guest)
		await shot(ctx, 'arcade-after-race-host')
		await guestShot(ctx, guest, 'arcade-after-race-guest')
		await charactersToRace(host, guest)
		const names2 = await eightKarts(host, guest)
		say(`second race : 8 karts, the bots ${names2.join(', ')}`)
		await shot(ctx, 'arcade-second-race')
		return `the last human's finish to the full results ${humansToFull} ms · ${back} · second race with 8 karts (${names2.join(', ')}) · ${race} · host results ${order(hs).join(' / ')} · guest results ${order(gs).join(' / ')} · bots on the guest ${bots.map(b => `${b.slot}:${b.packetsPerSec}/s jerk ${b.jerk.p95}`).join(' ')} (host's kart jerk ${hostView.jerk.p95})`
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
		// session 32 : the host alone at the character select, then its way back
		const back = await backFromCharacters(ctx, host)
		return `${back} · left after 25 s · taken over in ${ms} ms, still « ${taken.octr.names[1]} » · moved ${moved.toFixed(0)} units in 8 s · host ${h.finished ? `finished, rank ${h.rank}` : 'did not finish'} · the kart finished ${(stat.finalTime / 960).toFixed(1)} s, ${end.octr.raceStats.length} finishers · host toasts ${JSON.stringify(toasts)}`
	} finally {
		await r.close()
	}
}

// ---- Session 32d : the Netplay pause, FINISH THE RACE, the host's skip ----
const START = 'Enter' // native_input.c : kc_start
const raceTime = async tab => (await game(tab))?.raceTime ?? -1
const PAUSE_TITLE = /PAUSE/

/** The menu's cursor down to the row `label` (the row under the cursor is `menu.label`). */
async function toRow(tab, label) {
	for (let i = 0; i < 6; i++) {
		const g = await game(tab)
		if (g?.menu?.label === label) return
		await tab.press('ArrowDown')
		await sleep(400)
	}
	throw new Error(`no row « ${label} » : on « ${(await game(tab))?.menu?.label} »`)
}

/** Start until the pause menu shows (a press can land in a cooldown) ; never the retail freeze. */
async function openPause(tab, label) {
	for (let i = 0; i < 4; i++) {
		if (PAUSE_TITLE.test((await game(tab))?.menu?.title ?? '')) break
		await tab.press(START)
		await sleep(600)
	}
	return untilGame(tab, `${label} : the pause menu`, s => PAUSE_TITLE.test(s.menu?.title ?? ''), 5000)
}
const menuClosed = (tab, label) => untilGame(tab, label, s => !s.menu, 5000)

/** The race clock over `ms` : how far it moved. */
async function clockOver(tab, ms) {
	const t0 = await raceTime(tab)
	await sleep(ms)
	return (await raceTime(tab)) - t0
}

async function netplayPause(ctx) {
	const r = await roomToRace(ctx, 'auto', { inject: [TOASTS], arcade: true })
	const { host, guest } = r
	const out = []
	try {
		await eightKarts(host, guest)
		await untilGame(host, 'the lights over (host)', s => s.raceTime > 3000, 30_000)
		await untilGame(guest, 'the lights over (guest)', s => s.raceTime > 3000, 30_000)
		// 1. the menu over a running race : Triangle, Start, RESUME close it
		for (const how of ['Triangle', 'Start', 'RESUME']) {
			// the first time at full gas : the gas held through the open menu, the kart must coast
			let gas = null
			if (how === 'Triangle') {
				await ctx.hold('c')
				await sleep(4000)
				gas = { before: (await game(host)).kart.speed }
			}
			const g = await openPause(host, `host (${how})`)
			if (g.screen === 'paused') throw new Error(`the pause menu froze the host's game (${how})`)
			const ran = await clockOver(host, 2500)
			if (ran < 2000) throw new Error(`the race clock moved ${ran} ms in 2.5 s with the menu open`)
			if (gas) {
				gas.after = (await game(host)).kart.speed
				await ctx.release('c')
				if (!(gas.before > 0 && gas.after < gas.before * 0.8)) throw new Error(`the kart did not coast under the menu : speed ${gas.before} → ${gas.after} with the gas held`)
				out.push(`gas held under the menu : speed ${gas.before} → ${gas.after}`)
			}
			if (how === 'Triangle') {
				await guestShot(ctx, guest, 'pause-menu-running')
				const rows = []
				for (let i = 0; i < 4; i++) {
					rows.push((await game(host)).menu.label)
					await host.press('ArrowDown')
					await sleep(300)
				}
				out.push(`host rows ${[...new Set(rows)].join(' / ')}`)
				await host.press('z')
			} else if (how === 'Start') await host.press(START)
			else {
				await toRow(host, 'RESUME')
				await host.press('c')
			}
			await menuClosed(host, `the menu closed by ${how}`)
			out.push(`${how} : clock +${ran} ms in 2.5 s, closed`)
			await sleep(800) // retail's 5-frame cooldown before Start pauses again
		}
		// 2. PAUSE FOR EVERYONE : both frozen
		await openPause(host, 'host')
		await toRow(host, 'PAUSE FOR EVERYONE')
		await host.press('c')
		const t0 = Date.now()
		await untilGame(host, 'the host frozen', s => s.screen === 'paused', 5000)
		await untilGame(guest, 'the guest frozen', s => s.screen === 'paused', 5000)
		out.push(`everyone frozen : the guest in ${Date.now() - t0} ms`)
		const still = await Promise.all([clockOver(host, 3000), clockOver(guest, 3000)])
		if (still.some(d => d !== 0)) throw new Error(`clocks moved while frozen : host ${still[0]}, guest ${still[1]} ms`)
		await guestShot(ctx, guest, 'pause-everyone')
		const hm = await game(host)
		if (hm.menu?.label !== 'RESUME FOR EVERYONE') throw new Error(`the host's frozen menu row : ${hm.menu?.label}`)
		// the guest : Start opens RESUME / QUIT, Triangle and Start unfreeze nothing
		await guest.press(START)
		const gm = await untilGame(guest, 'the guest\'s menu while frozen', s => PAUSE_TITLE.test(s.menu?.title ?? ''), 5000)
		await guestShot(ctx, guest, 'pause-everyone-guest-menu')
		const grows = []
		for (let i = 0; i < 3; i++) {
			grows.push((await game(guest)).menu.label)
			await guest.press('ArrowDown')
			await sleep(300)
		}
		if ([...new Set(grows)].join('/') !== 'RESUME/QUIT') throw new Error(`the frozen guest's rows ${JSON.stringify(grows)}`)
		await guest.press('z')
		await menuClosed(guest, 'the guest\'s menu closed by Triangle')
		await guest.press(START)
		await sleep(600)
		await guest.press(START)
		await sleep(600)
		if ((await game(guest)).screen !== 'paused') throw new Error('the guest unfroze itself')
		out.push(`guest rows ${gm.menu.label}… ${[...new Set(grows)].join(' / ')}, still frozen after its Triangle and Start`)
		// 30 s more : the link holds
		const long = await Promise.all([clockOver(host, 30_000), clockOver(guest, 0)])
		const gs = await online(guest)
		if (long[0] !== 0 || gs.share?.state !== 'connected' || gs.octr.CurrState !== ST.START_RACE) throw new Error(`after 30 s frozen : host clock +${long[0]}, guest share ${gs.share?.state}, state ${gs.octr.CurrState}`)
		// 3. RESUME FOR EVERYONE
		await host.press('c')
		const t1 = Date.now()
		await untilGame(host, 'the host running again', s => s.screen !== 'paused' && !s.menu, 5000)
		await untilGame(guest, 'the guest running again', s => s.screen !== 'paused', 5000)
		out.push(`resumed for everyone : the guest in ${Date.now() - t1} ms`)
		const ran = await Promise.all([clockOver(host, 2000), clockOver(guest, 2000)])
		if (ran.some(d => d < 1500)) throw new Error(`clocks after the resume : host +${ran[0]}, guest +${ran[1]} ms in 2 s`)
		out.push(`30 s frozen, the link held · clocks +${ran.join(' / +')} ms in 2 s after`)
		// 4. the host quits while everyone is frozen : the guest runs on (the review of 32d)
		await sleep(800)
		await openPause(host, 'host')
		await toRow(host, 'PAUSE FOR EVERYONE')
		await host.press('c')
		await untilGame(guest, 'the guest frozen again', s => s.screen === 'paused', 5000)
		await toRow(host, 'QUIT')
		await host.press('c')
		await untilGame(host, 'the quit box', s => s.menu?.label === 'NO' || s.menu?.label === 'YES', 5000)
		await host.press('ArrowUp')
		await sleep(400)
		if ((await game(host)).menu?.label !== 'YES') throw new Error(`the quit box's row : ${(await game(host)).menu?.label}`)
		await host.press('c')
		const t2 = Date.now()
		await untilGame(guest, 'the guest running after the host quit', s => s.screen !== 'paused', 10_000)
		out.push(`the host quit while frozen : the guest ran on after ${Date.now() - t2} ms`)
		// its main menu : out of the room, fresh menus (32e)
		const left = await untilGame(host, 'the host on its main menu', s => !s.charSelect && !s.sub && s.menu?.input && !s.menu?.title, 20_000)
		await sleep(1000)
		const ho = await online(host)
		if ((ho.role && ho.role !== 'none') || left.mode.join('|') !== 'MAIN_MENU') throw new Error(`the host after its QUIT : room ${ho.role}, mode ${left.mode.join('|')}`)
		out.push(`then its main menu : the room left, mode ${left.mode.join('|')}`)
		return out.join(' · ')
	} finally {
		await r.close()
	}
}

// the user, 2026-11-06 : Arcade with a guest, the race, the guest's QUIT, Back, Back, NETPLAY again
// on the guest's own game : the main menu as a fresh boot, nothing of the room kept
async function quitBack(ctx) {
	const r = await roomToRace(ctx, 'auto', { inject: [TOASTS], arcade: true })
	const { guest } = r
	const steps = []
	const where = g => g?.charSelect ? `select ${g.charSelect.players}P locked ${g.charSelect.locked}` : `${g?.menu?.title || '(main)'} > ${g?.sub?.label ?? g?.menu?.label ?? '-'}`
	const note = async label => {
		const g = await game(guest)
		const o = await online(guest).catch(() => ({}))
		steps.push(`${label} : ${where(g)} [${g?.mode?.join('|')}] screen ${g?.screen} room ${o.role ?? '-'}`)
		say(steps.at(-1))
		await guestShot(ctx, guest, `quit-back-${label.replace(/\W+/g, '-')}`)
		return g
	}
	try {
		await untilGame(guest, 'the lights over', s => s.raceTime > 5000, 60_000)
		await openPause(guest, 'guest')
		await toRow(guest, 'QUIT')
		await guest.press('c')
		await untilGame(guest, 'the quit box', s => s.menu?.label === 'NO' || s.menu?.label === 'YES', 5000)
		await guest.press('ArrowUp')
		await sleep(400)
		await guest.press('c')
		await sleep(6000)
		let g = await note('quit')
		for (let i = 0; i < 4; i++) {
			if (!g?.charSelect && !g?.sub && g?.menu?.input && g?.menu?.label) break
			await guest.press('z')
			await sleep(1500)
			g = await note(`back ${i + 1}`)
		}
		await sleep(1000)
		const out = await online(guest)
		g = await game(guest)
		if ((out.role && out.role !== 'none') || g.mode.join('|') !== 'MAIN_MENU') throw new Error(`on the main menu : room ${out.role}, mode ${g.mode.join('|')} || ${steps.join(' | ')}`)
		for (let i = 0; i < 6 && (await game(guest))?.menu?.label !== 'NETPLAY'; i++) { await guest.press('ArrowDown'); await sleep(400) }
		await guest.press('c')
		g = await untilGame(guest, 'the ONLINE menu of a new room', s => !s.charSelect && /VS|BATTLE|ARCADE/.test(s.sub?.label ?? ''), 20_000)
		await sleep(800)
		g = await note('NETPLAY again')
		if (g.sub.label !== 'VS.') throw new Error(`the ONLINE menu's cursor on ${g.sub.label}, not its first row`)
		const row = async label => {
			for (let i = 0; i < 6 && (await game(guest))?.sub?.label !== label; i++) { await guest.press('ArrowDown'); await sleep(400) }
			await guest.press('c')
			await sleep(800)
		}
		await row('ARCADE')
		g = await note('race type')
		if (g.sub?.label !== 'SINGLE') throw new Error(`the race type's cursor on ${g.sub?.label}, not its first row`)
		await row('CUP')
		await row('MEDIUM')
		const c = (await untilGame(guest, 'the Arcade select', s => !!s.charSelect, 20_000)).charSelect
		await sleep(800)
		await note('the select')
		if (c.players !== 1 || c.locked) throw new Error(`the select : ${JSON.stringify(c)} || ${steps.join(' | ')}`)
		await guest.press('z')
		await sleep(1500)
		const back = await note('Triangle')
		if (back.charSelect) throw new Error(`Triangle did not leave the select || ${steps.join(' | ')}`)
		return steps.join(' | ')
	} finally {
		await r.close()
	}
}

async function finishHere(ctx) {
	const r = await roomToRace(ctx, 'auto', { inject: [TOASTS, RESULTS], arcade: true })
	const { host, guest } = r
	try {
		await eightKarts(host, guest)
		await ctx.js("const e = document.getElementById('online-end-after'); e.value = '120'; e.dispatchEvent(new Event('change')); return true")
		// the host races alone ; the guest's kart sits at the start
		const h = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, Date.now() + 300_000)
		if (!h.finished) throw new Error('the host did not finish')
		await until(guest, 'the host\'s finish on the guest', s => s.octr.raceStats.some(x => x.slot === 1), 15_000)
		await sleep(2500)
		await shot(ctx, 'finish-here-host-camera') // the host's camera on the guest's kart (32c)
		const before = (await online(host)).octr.raceStats.length
		await openPause(guest, 'guest')
		await toRow(guest, 'FINISH THE RACE')
		await guestShot(ctx, guest, 'finish-here-menu')
		await guest.press('c')
		const t0 = Date.now()
		const full = tab => tab.js('return window.__results ?? null').catch(() => null)
		let hs = null, gs = null
		while (Date.now() - t0 < 10_000) {
			hs = await full(host)
			gs = await full(guest)
			if (hs?.octr.raceStats.length === 8 && gs?.octr.raceStats.length === 8) break
			await sleep(100)
		}
		const ms = Date.now() - t0
		if (hs?.octr.raceStats.length !== 8 || gs?.octr.raceStats.length !== 8) throw new Error(`results after FINISH THE RACE : host ${hs?.octr.raceStats.length}, guest ${gs?.octr.raceStats.length}`)
		if (ms > 2000) throw new Error(`the full results took ${ms} ms`)
		await guestShot(ctx, guest, 'finish-here-results')
		const time = s => slot => s.octr.raceStats.find(x => x.slot === slot)?.finalTime
		const hostTime = time(hs)(0), guestTime = time(hs)(1)
		if (!(guestTime > hostTime)) throw new Error(`the guest's estimated time ${guestTime} is not after the host's ${hostTime}`)
		// the host's Cross on the results ; the guest's first, doing nothing
		await guest.press('c')
		await sleep(1500)
		if ((await online(guest)).octr.CurrState !== ST.END_RACE) throw new Error('the guest\'s Cross moved the room on')
		await guestShot(ctx, guest, 'finish-here-skip-hint') // « CROSS : CONTINUE » on the host only
		await host.press('c')
		const t1 = Date.now()
		// the room's reset (the server's SG_NEWCLIENT : the lobby again), then the menu level's load
		await until(host, 'the room reset after the host\'s Cross', s => s.octr.CurrState !== ST.END_RACE, 10_000, 100)
		const skip = Date.now() - t1
		if (skip > 2000) throw new Error(`the host's skip took ${skip} ms`)
		await untilGame(host, 'the host\'s character select after its Cross', s => s.charSelect != null, 15_000)
		const select = Date.now() - t1
		await until(guest, 'the guest in the next lobby', s => s.octr.CurrState === ST.GUEST_TRACK_WAIT, 10_000)
		const order = s => s.octr.raceStats.map(x => `${s.octr.names[x.slot] || '?'} ${(x.finalTime / 960).toFixed(1)}s`)
		return `${before} finishers before FINISH THE RACE · 8 on both ${ms} ms after · the guest at ${(guestTime / 960).toFixed(1)} s (host ${(hostTime / 960).toFixed(1)} s) · the guest's Cross ignored · the host's Cross : the room reset in ${skip} ms, its character select loaded in ${select} ms · results ${order(hs).join(' / ')}`
	} finally {
		await r.close()
	}
}

export default async ctx => {
	await ctx.scenario('ONLINE-ARCADE', () => arcade(ctx))
	await ctx.scenario('ONLINE-ARCADE-LEAVE', () => leave(ctx))
	// Session 32 : a whole Arcade Cup with the host's bots (D12)
	await ctx.scenario('ONLINE-ARCADE-CUP', () => cupOn(ctx, { arcade: true, skip: true }))
	// Session 32d : the Netplay pause, FINISH THE RACE, the host's skip (D12.9, D12.10)
	await ctx.scenario('NETPLAY-PAUSE', () => netplayPause(ctx))
	await ctx.scenario('NETPLAY-FINISH-HERE', () => finishHere(ctx))
	// the user, 2026-11-06 : the guest's QUIT mid-race, Back to its main menu, NETPLAY : the ONLINE menu, nothing kept
	await ctx.scenario('NETPLAY-QUIT-BACK', () => quitBack(ctx))
}
