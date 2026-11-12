// Player suite : a relay with no key (session 27). A room opens with no key typed anywhere — from
// NETPLAY, from Select on a character select (Couch), from the page's own Share ; the door and a
// link's pass hold there as on a keyed relay ; and what an open relay's limits make it say is said
// in the game and on the page, each with its way back : RELAY FULL (no room left), ROOM CLOSED —
// NO ONE CAME (a room nobody joined).
//
// RUN
//   Build : web/dev.sh build debug
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Relays, both with no key :
//     the small one  (cd relay && RELAY_MAX_ROOMS=2 RELAY_STATS=1 PORT=8790 node relay.js)
//     the impatient  (cd relay && RELAY_ALONE_S=12 RELAY_STATS=1 PORT=9001 node relay.js)
//   Play  : bash plans/ctr-native-web/tools/play.sh relay-public <session> 8093 -- \
//             --set open=ws://localhost:8790 --set alone=ws://localhost:9001 [--only A,B]
//           The guests need the second agent browser (play.sh passes --set guestCdp=<host:port>).
// Not a node --test file.

import { newRoom } from '../../net/link.js'
import { openRoom } from '../../net/room.js'
import { menuTo, say } from './ctr.mjs'
import { home, joinFromHome, page, said } from './home-code.suite.mjs'
import { bootWith, joinCode, joinLink, pressUntil, row, tabOf, toNetplay } from './netplay-rooms.suite.mjs'
import { game, online, shot, until, untilGame } from './online.suite.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: { gamepad: true, pressFrames: 8 } }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CROSS = 'c'
const TRIANGLE = 'z'
const START = 'Enter'
const SELECT = ' '
const NP = { room: 3, relayFull: 18, roomClosed: 19 }
const ROOMS = 2 // the small relay's RELAY_MAX_ROOMS
const click = (tab, id) => tab.js(`document.getElementById(${JSON.stringify(id)}).click(); return true`)
const shareState = ctx => ctx.js('return window.__ctrShare.state()')
const to = (tab, label) => menuTo(tab, label, dir => tab.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
const needOpen = ctx => { if (!ctx.args.open) ctx.skip('no keyless relay : --set open=ws://localhost:8790 (RELAY_MAX_ROOMS=2)') }
const needAlone = ctx => { if (!ctx.args.alone) ctx.skip('no impatient relay : --set alone=ws://localhost:9001 (RELAY_ALONE_S=12)') }

/** Every room of the small relay taken, from here : the next one asked for is one too many. */
async function fill(relay) {
	const rooms = []
	for (let i = 0; i < ROOMS; i++) rooms.push(await openRoom({ link: newRoom({ relay }), role: 'host', name: 'filler' }))
	return () => { for (const r of rooms.splice(0)) r.close() }
}

/** Back on the main menu's own rows, whatever is open. */
async function toMain(tab) {
	for (let i = 0; i < 10; i++) {
		const s = await game(tab)
		if (s?.netplay?.screen === 'none' && !s.sub && !s.charSelect && s.menu) return s
		await tab.press(TRIANGLE)
		await sleep(1200)
	}
	const s = await game(tab)
	throw new Error(`${tab.name} : the main menu never came back (${s?.sub?.title}, select ${JSON.stringify(s?.charSelect)}, netplay ${s?.netplay?.screen})`)
}

/** Main menu → VS > SINGLE → the local character select, where Select is Couch. */
async function vsSelect(tab) {
	await toMain(tab)
	await to(tab, 'VS.')
	await pressUntil(tab, CROSS, 'VS\'s race type', s => s.sub?.title === 'RACE TYPE')
	await pressUntil(tab, CROSS, 'the character select', s => !!s.charSelect)
	await sleep(1500)
}

/** The page booted on `relay` with no key in its Settings. */
async function bootOn(ctx, relay) {
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	await bootWith(host, origin, { relay, rk: '', name: 'Host' })
	await ctx.js("localStorage.removeItem('ctr-share.relay'); localStorage.removeItem('ctr-share.rk'); return true")
	return { origin, host }
}

/** A room with no key : NETPLAY's mode, Couch's Select, the page's own Share — and the words of Settings. */
async function noKey(ctx) {
	needOpen(ctx)
	const { host } = await bootOn(ctx, ctx.args.open)
	const steps = []
	// NETPLAY > VS : the room, its link without a key
	await toNetplay(host)
	await row(host, 'VS.')
	await host.press(CROSS)
	let o = await until(host, 'the NETPLAY room with no key', s => s.role === 'host' && s.lobby.active && !!s.code, 30_000)
	if (/[#&]rk=/.test(o.link)) throw new Error(`a keyless room's link carries a key : ${o.link}`)
	await untilGame(host, 'VS\'s first screen', s => s.sub?.title === 'RACE TYPE', 20_000)
	await shot(ctx, 'netplay-no-key')
	steps.push(`NETPLAY > VS with no key : room ${o.code}, its link has no rk=`)
	const words = await ctx.js("return [document.getElementById('online-relay-word')?.textContent, document.getElementById('online-relay-public')?.hidden]")
	if (words[0] !== 'yours' || words[1] !== false) throw new Error(`Settings › Netplay says ${JSON.stringify(words)} of a relay that is not the page's own`)
	await ctx.js('window.__ctrOnline.leave(); return true')
	// Select on a local character select : Couch
	await vsSelect(host)
	await host.press(SELECT)
	const s = await untilGame(host, 'INVITE, by itself', g => g.netplay.screen === 'invite' && g.netplay.share, 30_000)
	let share = await shareState(ctx)
	if (!share.sharing || /[#&]rk=/.test(share.link)) throw new Error(`Couch with no key : ${JSON.stringify({ sharing: share.sharing, link: share.link })}`)
	await shot(ctx, 'couch-no-key')
	steps.push(`Select with no key : Couch on, INVITE (${s.netplay.screen}), code ${share.code}`)
	await toMain(host)
	if ((await shareState(ctx)).sharing) throw new Error('the main menu did not close Couch')
	// the page's own Share (the bare edition's only way) : no field filled. Off the main menu,
	// which closes a Couch room in the Netplay build
	await vsSelect(host)
	const started = await ctx.js('return window.ctrShareApi.start()')
	share = await shareState(ctx)
	if (!started.ok || !share.sharing || !share.link.includes('share/guest.html#') || /[#&]rk=/.test(share.link)) throw new Error(`the page's Share with no key : ${JSON.stringify(started)} ${share.link}`)
	steps.push('the page\'s own Share with no key : on, a guest link with no rk=')
	await ctx.js('window.ctrShareApi.stopOn(); return true')
	// the page's own relay is « public », and the button is gone
	const mine = await ctx.js(`const m = await import('./net/relay-default.js'); const e = document.getElementById('online-relay'); e.value = m.DEFAULT_RELAY; e.dispatchEvent(new Event('input'))
		return [document.getElementById('online-relay-word').textContent, document.getElementById('online-relay-public').hidden]`)
	if (mine[0] !== 'public' || mine[1] !== true) throw new Error(`Settings › Netplay says ${JSON.stringify(mine)} of the page's own relay`)
	steps.push('Settings › Netplay : « yours » for another address, « public » for the page\'s own')
	return steps.join(' · ')
}

/** RELAY FULL in the game : NETPLAY's box, JOIN's line, Couch's box — each with its way back, and TRY AGAIN once there is room. */
async function fullInGame(ctx) {
	needOpen(ctx)
	const { host } = await bootOn(ctx, ctx.args.open)
	const steps = []
	let free = await fill(ctx.args.open)
	try {
		// a mode
		await toNetplay(host)
		await row(host, 'VS.')
		await host.press(CROSS)
		let g = await untilGame(host, 'the RELAY FULL box', s => s.sub?.title === 'RELAY FULL', 30_000)
		await shot(ctx, 'netplay-relay-full')
		if (g.sub.label !== 'TRY AGAIN') throw new Error(`the box's first row is ${g.sub.label}`)
		const told = (await online(host)).error
		if (!/relay is full/i.test(told)) throw new Error(`the page says « ${told} »`)
		await pressUntil(host, TRIANGLE, 'the box\'s way back', s => s.sub?.title === 'NETPLAY')
		steps.push('NETPLAY > VS, no room left : the RELAY FULL box, TRY AGAIN first ; Triangle → the NETPLAY menu')
		// JOIN
		await row(host, 'JOIN')
		await pressUntil(host, CROSS, 'the JOIN screen', s => s.netplay?.screen === 'join')
		await host.press(START)
		g = await untilGame(host, 'RELAY FULL on the dials', s => s.netplay?.screen === 'join' && s.netplay.said === NP.relayFull, 30_000)
		await shot(ctx, 'join-relay-full')
		await pressUntil(host, TRIANGLE, 'JOIN\'s way back', s => s.netplay?.screen === 'none' && s.sub?.title === 'NETPLAY')
		steps.push('JOIN : RELAY FULL under the dials ; Triangle → the NETPLAY menu')
		// TRY AGAIN, a room free again
		await row(host, 'VS.')
		await host.press(CROSS)
		await untilGame(host, 'the box again', s => s.sub?.title === 'RELAY FULL', 30_000)
		free()
		await sleep(500)
		await pressUntil(host, CROSS, 'TRY AGAIN', s => s.sub?.title !== 'RELAY FULL')
		const o = await until(host, 'the room after TRY AGAIN', s => s.role === 'host' && s.lobby.active, 30_000)
		steps.push(`a room freed, TRY AGAIN : room ${o.code}`)
		await ctx.js('window.__ctrOnline.leave(); return true')
		// Couch
		free = await fill(ctx.args.open)
		await vsSelect(host)
		await host.press(SELECT)
		g = await untilGame(host, 'Couch\'s RELAY FULL box', s => s.netplay.screen === 'couch-no', 30_000)
		if (g.netplay.error !== NP.relayFull) throw new Error(`Couch's box says ${g.netplay.error}`)
		await shot(ctx, 'couch-relay-full')
		g = await pressUntil(host, TRIANGLE, 'Triangle : back on the select', s => s.netplay.screen === 'none')
		if (!g.charSelect) throw new Error('Triangle on the box left the select')
		await host.press(SELECT)
		await untilGame(host, 'the box again', s => s.netplay.screen === 'couch-no', 30_000)
		free()
		await sleep(500)
		await pressUntil(host, CROSS, 'TRY AGAIN', s => s.netplay.screen !== 'couch-no')
		await untilGame(host, 'INVITE after TRY AGAIN', s => s.netplay.screen === 'invite' && s.netplay.share, 30_000)
		steps.push('Select, no room left : RELAY FULL ; Triangle → the select ; a room freed, TRY AGAIN → INVITE')
		await toMain(host)
		return steps.join(' · ')
	} finally {
		free()
		await ctx.js('window.__ctrOnline?.leave(); window.ctrShareApi?.stopOn(); return true').catch(() => {})
	}
}

/** RELAY FULL on the page : the home page's dials with what to do and Back ; the page's own Share in words. */
async function fullOnPage(ctx) {
	needOpen(ctx)
	const origin = new URL(ctx.args.url).origin
	const tab = tabOf(ctx)
	const steps = []
	const free = await fill(ctx.args.open)
	try {
		await home(tab, origin, { relay: ctx.args.open, rk: '' })
		await joinFromHome(tab, [0, 1, 2])
		await said(tab, 'RELAY FULL')
		const help = await tab.js("return document.getElementById('join-said-help')?.textContent ?? ''")
		if (!/your own relay/.test(help)) throw new Error(`under RELAY FULL : « ${help} »`)
		if (await tab.js("return !!document.getElementById('join-nokey')")) throw new Error('a key card on a relay with no key')
		await shot(ctx, 'home-relay-full')
		await click(tab, 'join-back')
		await page(tab, 'the home page back', "!!document.getElementById('or-join') && !document.getElementById('join-code')", 5000)
		steps.push(`the home page's dials : RELAY FULL, « ${help} » ; Back → the home page`)
		// the page's own Share, on a running game
		await bootWith(tab, origin, { relay: ctx.args.open, rk: '', name: 'Host' })
		await vsSelect(tab)
		const refused = await ctx.js('return window.ctrShareApi.start()')
		const line = await ctx.js("return document.getElementById('share-error').textContent")
		if (refused.ok || refused.code !== 'relay-full' || !/^The relay is full\./.test(line)) throw new Error(`the page's Share on a full relay : ${JSON.stringify(refused)} « ${line} »`)
		free()
		await sleep(500)
		const again = await ctx.js('return window.ctrShareApi.start()')
		if (!again.ok || (await ctx.js("return document.getElementById('share-error').textContent"))) throw new Error(`Share again, a room free : ${JSON.stringify(again)}`)
		steps.push(`the page's own Share : « ${line} » ; again with a room free : on, the line gone`)
		return steps.join(' · ')
	} finally {
		free()
		await ctx.js('window.ctrShareApi?.stopOn(); return true').catch(() => {})
	}
}

/** A room nobody joined : the relay closes it, the page and the game say so, and another is one press away. */
async function noOneCame(ctx) {
	needAlone(ctx)
	const { host } = await bootOn(ctx, ctx.args.alone)
	const steps = []
	// the page's own Share (off the main menu, which closes a Couch room in the Netplay build)
	await vsSelect(host)
	const started = await ctx.js('return window.ctrShareApi.start()')
	if (!started.ok) throw new Error(`Share on the impatient relay : ${JSON.stringify(started)}`)
	const t0 = Date.now()
	let line = ''
	for (; Date.now() - t0 < 40_000; await sleep(500)) {
		const st = await shareState(ctx)
		if (!st.sharing) { line = st.error; break }
		if ((Date.now() - t0) % 10_000 < 500) say(`host : Share still on after ${Math.round((Date.now() - t0) / 1000)} s`)
	}
	if (!/no one came/.test(line)) throw new Error(`the page's Share after the relay's close : « ${line} »`)
	steps.push(`the page's own Share, alone : closed after ${((Date.now() - t0) / 1000).toFixed(0)} s, « ${line} »`)
	// Couch from the game : the box, OPEN AGAIN
	await host.press(SELECT)
	await untilGame(host, 'INVITE', g => g.netplay.screen === 'invite' && g.netplay.share, 30_000)
	await pressUntil(host, TRIANGLE, 'INVITE closed', g => g.netplay.screen === 'none')
	let g = await untilGame(host, 'Couch\'s ROOM CLOSED box', s => s.netplay.screen === 'couch-no', 40_000)
	if (g.netplay.error !== NP.roomClosed || g.netplay.share) throw new Error(`the box says ${g.netplay.error}, Couch ${g.netplay.share ? 'still on' : 'off'}`)
	await shot(ctx, 'couch-room-closed')
	g = await pressUntil(host, TRIANGLE, 'Triangle : back on the select', s => s.netplay.screen === 'none')
	if (!g.charSelect) throw new Error('Triangle on the box left the select')
	await sleep(1500)
	if ((await game(host)).netplay.screen !== 'none') throw new Error('the box came back by itself')
	steps.push('Select, then nobody : the ROOM CLOSED box (NO ONE CAME) on the select ; Triangle → the select, and it stays closed')
	await host.press(SELECT)
	await untilGame(host, 'INVITE again', s => s.netplay.screen === 'invite' && s.netplay.share, 30_000)
	await pressUntil(host, TRIANGLE, 'INVITE closed', s => s.netplay.screen === 'none')
	await untilGame(host, 'the box, the second time', s => s.netplay.screen === 'couch-no', 40_000)
	await pressUntil(host, CROSS, 'OPEN AGAIN', s => s.netplay.screen !== 'couch-no')
	await untilGame(host, 'INVITE after OPEN AGAIN', s => s.netplay.screen === 'invite' && s.netplay.share, 30_000)
	steps.push('a second time : OPEN AGAIN → INVITE')
	await toMain(host)
	// NETPLAY's own room
	await toNetplay(host)
	await row(host, 'VS.')
	await host.press(CROSS)
	const o = await until(host, 'the NETPLAY room', s => s.role === 'host' && s.lobby.active && !!s.code, 30_000)
	g = await untilGame(host, 'NETPLAY\'s ROOM CLOSED box', s => s.netplay.screen === 'couch-no', 40_000)
	const after = await online(host)
	if (g.netplay.error !== NP.roomClosed || after.role === 'host' || !/No one came/.test(after.error)) throw new Error(`room ${o.code} closed : the box ${g.netplay.error}, the page ${after.role} « ${after.error} »`)
	await shot(ctx, 'netplay-room-closed')
	const toasts = await ctx.js("return [...document.querySelectorAll('.toast')].map(t => t.innerText.replace(/\\s+/g, ' ').trim())")
	steps.push(`NETPLAY > VS, then nobody : room ${o.code} closed, the box on ${g.sub?.title ?? g.menu?.label ?? 'the menus'} ; the page : « ${after.error} » ${JSON.stringify(toasts.at(-1) ?? '')}`)
	g = await pressUntil(host, TRIANGLE, 'the box\'s way back', s => s.netplay.screen === 'none')
	steps.push(`Triangle → ${g.sub?.title ?? g.menu?.label ?? (g.charSelect ? 'the select' : '?')}`)
	// said once : the box does not come back by itself ; a new room, closed in turn, is said again
	await sleep(1500)
	if ((await game(host)).netplay.screen !== 'none') throw new Error('the box came back by itself')
	await toMain(host)
	await toNetplay(host)
	await row(host, 'VS.')
	await host.press(CROSS)
	await until(host, 'a second NETPLAY room', s => s.role === 'host' && s.lobby.active && !!s.code, 30_000)
	await untilGame(host, 'the box, the second time', s => s.netplay.screen === 'couch-no', 40_000)
	await pressUntil(host, CROSS, 'OPEN AGAIN', s => s.netplay.screen !== 'couch-no')
	const again = await until(host, 'the room after OPEN AGAIN', s => s.role === 'host' && s.lobby.active && !!s.code, 30_000)
	g = await untilGame(host, 'VS\'s first screen again', s => s.netplay.screen === 'none' && s.sub?.title === 'RACE TYPE', 20_000)
	steps.push(`a second room, closed : OPEN AGAIN → room ${again.code}, ${g.sub.title}`)
	await ctx.js('window.__ctrOnline.leave(); return true')
	return steps.join(' · ')
}

/** The same context on the keyless relay, for the room suite's own scenarios. */
const keyless = ctx => {
	const c = Object.create(ctx)
	c.args = { ...ctx.args, relay: ctx.args.open, rk: '' }
	return c
}

export default async ctx => {
	await ctx.scenario('NO-KEY', () => noKey(ctx))
	await ctx.scenario('FULL-IN-GAME', () => fullInGame(ctx))
	await ctx.scenario('FULL-ON-PAGE', () => fullOnPage(ctx))
	await ctx.scenario('NO-ONE-CAME', () => noOneCame(ctx))
	// the door and the pass on a relay anyone may use : a code's guest still knocks, a link's goes straight in
	await ctx.scenario('KEYLESS-CODE-KNOCKS', () => { needOpen(ctx); return joinCode(keyless(ctx), 'auto') })
	await ctx.scenario('KEYLESS-LINK-STRAIGHT-IN', () => { needOpen(ctx); return joinLink(keyless(ctx), 'auto') })
}
