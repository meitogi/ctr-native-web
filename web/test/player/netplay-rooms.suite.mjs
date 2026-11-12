// Player suite : Netplay rooms from the game (session 28). NETPLAY opens its menu with no room ;
// VS, BATTLE or ARCADE hosts one by itself ; VS and BATTLE open alone and wait for a second
// player at the character lock ; INVITE (pad Select) shows the room's code — a few of the game's
// characters ; JOIN takes one on its dials, the host says yes to a guest who came by code, a room
// link goes straight in ; a code nobody holds, a refusal, a silent or full relay and a missing key
// are said in the game. Every screen's way back is pressed.
//
// RUN
//   Build : web/dev.sh build debug
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Relay : (cd relay && RELAY_KEY=<key> PORT=8788 node relay.js) ; for JOIN-ERRORS' full room a
//           second one that takes a single peer : RELAY_KEY=<key> RELAY_ROOM_MAX=1 PORT=8790 ;
//           nothing reachable on 8787 (the silent relay)
//   Play  : bash plans/ctr-native-web/tools/play.sh netplay-rooms <session> 8093 -- \
//             --set relay=ws://localhost:8788 --set rk=<key> [--set full=ws://localhost:8790] [--only A,B]
//           The guest runs in the second agent browser when play.sh has one (--set guestCdp=<host:port>),
//           else in a second tab of the first (one localStorage for both : the Settings checks are skipped).
// Not a node --test file.

import { ST, boot, game, guestShot, online, openGuestPage, shot, until, untilGame } from './online.suite.mjs'
import { menuTo, say } from './ctr.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: { gamepad: false, pressFrames: 8 } }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CROSS = 'c'
const TRIANGLE = 'z'
const START = 'Enter'
const SELECT = ' '
const SILENT = 'ws://localhost:8787'
/** web/online/page.js NP */
const NP = { noKey: 10, offline: 12, noRoom: 13, full: 14, refused: 15 }
const TOASTS = `(() => {
	globalThis.__toasts = []
	const seen = new WeakSet()
	new MutationObserver(() => {
		for (const t of document.querySelectorAll('.toast')) if (!seen.has(t)) { seen.add(t); __toasts.push(t.innerText.replace(/\\s+/g, ' ').trim()) }
	}).observe(document, { childList: true, subtree: true })
})()`

export const tabOf = ctx => ({ name: 'host', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: url => ctx.conn.send('Page.navigate', { url }, ctx.sid) })
export const needRelay = ctx => { if (!ctx.args.relay || !ctx.args.rk) ctx.skip('no keyed relay : --set relay=ws://localhost:8788 --set rk=<key>') }
const panelOpen = tab => tab.js("return !!(document.getElementById('online')?.checkVisibility?.() || document.getElementById('ctr-settings')?.checkVisibility?.())")

/** The page booted to its main menu with this relay and key in Settings (as typed once, kept by the browser). */
export async function bootWith(tab, origin, { relay, rk, name, path = 'auto' }) {
	await boot(tab, `${origin}/index.html`)
	await tab.js(`localStorage.setItem('ctr-online.relay', ${JSON.stringify(relay)}); localStorage.setItem('ctr-online.rk', ${JSON.stringify(rk)})
		localStorage.setItem('ctr-online.points', 'relay'); localStorage.setItem('ctr-online.name', ${JSON.stringify(name)})
		localStorage.setItem('ctr-online.path', ${JSON.stringify(path)}); return true`)
	await boot(tab, `${origin}/index.html`)
}

/** A press that must change something : pressed again while `done` is not seen (a press landing as a menu opens is lost). */
export async function pressUntil(tab, key, label, done, tries = 6) {
	for (let i = 0; i < tries; i++) {
		await tab.press(key)
		for (let w = 0; w < 8; w++) {
			await sleep(150)
			const s = await game(tab)
			if (s && done(s)) return s
		}
	}
	const s = await game(tab)
	throw new Error(`${tab.name} : ${label} — still ${s?.sub?.title ?? s?.menu?.label}/${s?.sub?.label ?? ''}, netplay ${JSON.stringify(s?.netplay)}`)
}

/** Main menu → NETPLAY's own menu. */
export async function toNetplay(tab) {
	await menuTo(tab, 'NETPLAY', dir => tab.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
	// its help page first (session 29), then Cross : the menu
	const s = await pressUntil(tab, CROSS, 'the NETPLAY menu, or its help page', s => s.sub?.title === 'NETPLAY')
	return s.netplay?.screen === 'help' ? pressUntil(tab, CROSS, 'the NETPLAY menu past its help page', s => s.sub?.title === 'NETPLAY' && s.netplay.screen === 'none') : s
}

/** The NETPLAY menu's cursor on `label` (VS. / BATTLE / ARCADE / JOIN). */
async function row(tab, label) {
	const order = ['VS.', 'BATTLE', 'ARCADE', 'JOIN']
	for (let i = 0; i < 8; i++) {
		const s = await game(tab)
		if (s?.sub?.title !== 'NETPLAY') throw new Error(`${tab.name} : not on the NETPLAY menu (${s?.sub?.title})`)
		if (s.sub.label === label) return s
		const at = order.indexOf(s.sub.label)
		if (at < 0) throw new Error(`${tab.name} : the NETPLAY menu has no row ${label} : on ${s.sub.label}`)
		await tab.press(order.indexOf(label) > at ? 'ArrowDown' : 'ArrowUp')
		await tab.frames(10)
	}
	throw new Error(`${tab.name} : the NETPLAY menu has no row ${label}`)
}

/** NETPLAY > `mode` picked with no room : this player hosts it. Resolves on the mode's first screen. */
export async function hostBy(tab, mode) {
	await row(tab, mode)
	await tab.press(CROSS)
	const o = await until(tab, `the room ${mode} opened`, s => s.role === 'host' && s.lobby.active && !!s.code, 30_000)
	const next = mode === 'BATTLE' ? s => !!s.charSelect : s => s.sub?.title === 'RACE TYPE'
	const g = await untilGame(tab, `${mode}'s first screen`, next, 20_000)
	return { o, g }
}

/** VS alone to its character select : the retail race type's SINGLE RACE. */
export async function vsSelect(tab) {
	const { o } = await hostBy(tab, 'VS.')
	await pressUntil(tab, CROSS, 'the character select', s => !!s.charSelect)
	await sleep(1500)
	return o
}

/** JOIN's dials set to `code` (character ids) from wherever they stand, the cursor left on the last one. */
async function dial(tab, code) {
	let s = await game(tab)
	if (s?.netplay?.screen !== 'join') throw new Error(`${tab.name} : not on the JOIN screen (${JSON.stringify(s?.netplay)})`)
	for (let i = 0; i < code.length; i++) {
		// on dial i (Right past the last one adds a dial)
		for (let n = 0; n < 6 && (s = await game(tab)).netplay.at !== i; n++) {
			await tab.press(s.netplay.at < i ? 'ArrowRight' : 'ArrowLeft')
			await tab.frames(6)
		}
		for (let n = 0; n < 16 && (s = await game(tab)).netplay.dials[i] !== code[i]; n++) {
			const d = (code[i] - s.netplay.dials[i] + 15) % 15
			await tab.press(d <= 7 ? 'ArrowDown' : 'ArrowUp')
			await tab.frames(6)
		}
	}
	// a longer code left from a run before : its extra dials off
	for (let n = 0; n < 3 && (s = await game(tab)).netplay.dials.length > code.length; n++) {
		await tab.press('x')
		await tab.frames(6)
	}
	s = await game(tab)
	if (s.netplay.dials.join() !== code.join()) throw new Error(`${tab.name} : the dials show ${s.netplay.dials} for ${code}`)
	return s
}

export const codeOf = o => [...o.code].map(d => Number.parseInt(d, 16))

/** NETPLAY > JOIN, the dials on `code`, Start. */
async function joinBy(tab, code) {
	await toNetplay(tab)
	await row(tab, 'JOIN')
	await pressUntil(tab, CROSS, 'the JOIN screen', s => s.netplay?.screen === 'join')
	await dial(tab, code)
	await tab.press(START)
}

/** Item 1 : NETPLAY opens no room ; a mode hosts one ; Triangle keeps it ; the main menu closes it. */
async function hostOnMode(ctx) {
	needRelay(ctx)
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	const steps = []
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS }, ctx.sid)
	await bootWith(host, origin, { relay: ctx.args.relay, rk: ctx.args.rk, name: 'Host' })
	await toNetplay(host)
	await sleep(3000)
	let o = await online(host)
	if (o.role === 'host' || o.room) throw new Error(`NETPLAY alone opened a room (${o.room}) : it must wait for a mode`)
	const rows = []
	for (const label of ['VS.', 'BATTLE', 'ARCADE', 'JOIN']) rows.push((await row(host, label)).sub.label)
	steps.push(`NETPLAY : its menu, no room ; rows ${rows.join(' / ')}`)
	await shot(ctx, 'netplay-menu-no-room')

	const arcade = await hostBy(host, 'ARCADE')
	const code = arcade.o.code
	if (!/^[0-9a-e]{3}$/.test(code)) throw new Error(`the room's code is ${JSON.stringify(code)} : 3 characters expected`)
	if (!arcade.o.link.includes(`c=${code}`) || !/[&#]t=/.test(arcade.o.link) || !arcade.o.link.includes('rk=')) throw new Error(`the link lacks the code, the pass or the key : ${arcade.o.link}`)
	const toasts = await ctx.js('return globalThis.__toasts ?? []')
	if (!toasts.some(t => /Room open/.test(t) && /Code : /.test(t))) throw new Error(`no « Room open » toast with the code's names : ${JSON.stringify(toasts)}`)
	steps.push(`ARCADE : hosts room ${code} → ${arcade.g.sub.title} ; toast ${JSON.stringify(toasts.at(-1))}`)
	await shot(ctx, 'arcade-hosted')

	// Triangle : the NETPLAY menu, the room kept ; VS then uses the same room
	await pressUntil(host, TRIANGLE, 'back on the NETPLAY menu', s => s.sub?.title === 'NETPLAY')
	o = await online(host)
	if (o.role !== 'host' || o.code !== code) throw new Error(`Triangle from ARCADE lost the room (${o.role}, ${o.code})`)
	const vs = await hostBy(host, 'VS.')
	if (vs.o.code !== code) throw new Error(`VS opened another room (${vs.o.code}, was ${code})`)
	steps.push(`Triangle : NETPLAY, room kept ; VS : the same room → ${vs.g.sub.title}`)

	// back to the main menu : the room closed
	for (let i = 0; i < 6 && (await game(host))?.sub; i++) {
		await host.press(TRIANGLE)
		await host.frames(20)
	}
	await untilGame(host, 'the main menu', s => !s.sub && s.menu?.label === 'NETPLAY', 10_000)
	o = await until(host, 'the room closed on the main menu', s => !s.role || s.role === 'none', 10_000)
	steps.push('Triangle ×2 : the main menu, the room closed')
	return steps.join(' · ')
}

/** Item 2 : VS and BATTLE open alone ; the lock alone waits ; a guest by link, both locked : the tracks. */
async function modesAlone(ctx) {
	needRelay(ctx)
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	const steps = []
	await bootWith(host, origin, { relay: ctx.args.relay, rk: ctx.args.rk, name: 'Host' })
	await toNetplay(host)

	// BATTLE alone : its character select
	const battle = await hostBy(host, 'BATTLE')
	if (battle.g.charSelect.players !== 1) throw new Error(`BATTLE alone : ${battle.g.charSelect.players} players on the select`)
	await sleep(1500)
	await pressUntil(host, CROSS, 'BATTLE alone : P1 locked', s => s.charSelect?.locked & 1)
	await sleep(2500)
	let g = await game(host)
	if (!g.charSelect || !g.netplay?.waiting) throw new Error(`BATTLE alone left its select after the lock (${g.screen}, ${JSON.stringify(g.netplay)})`)
	steps.push('BATTLE alone : select, locked, waits')
	// Triangle unlocks, Triangle again goes back to the NETPLAY menu
	await pressUntil(host, TRIANGLE, 'the lock off', s => s.charSelect && !(s.charSelect.locked & 1))
	await pressUntil(host, TRIANGLE, 'back on the NETPLAY menu', s => s.sub?.title === 'NETPLAY' && !s.charSelect, 8)

	const o = await vsSelect(host)
	g = await game(host)
	if (g.charSelect.players !== 1) throw new Error(`VS alone : ${g.charSelect.players} players on the select`)
	await pressUntil(host, CROSS, 'VS alone : P1 locked', s => s.charSelect?.locked & 1)
	await sleep(2500)
	g = await game(host)
	if (!g.charSelect || !g.netplay?.waiting) throw new Error(`VS alone left its select after the lock (${g.screen}, ${JSON.stringify(g.netplay)})`)
	await shot(ctx, 'vs-alone-waiting')
	steps.push('VS alone : select, locked, WAITING FOR PLAYER 2')

	const { guestBrowser, guest } = await openGuestPage(ctx, origin, { cdp: ctx.args.guestCdp })
	try {
		await boot(guest, o.link)
		g = await untilGame(host, 'the select grown to 2 players', s => s.charSelect?.players === 2, 120_000)
		if (!(g.charSelect.locked & 1)) throw new Error('the host lost its lock when the guest joined')
		if ((await online(host)).asking) throw new Error('a guest by link was asked for at the door')
		await sleep(1500)
		g = await game(host)
		if (!g.charSelect) throw new Error('the select left before the guest locked')
		await until(guest, 'the guest in the host\'s menus', s => s.lobby.active && s.share?.state === 'connected' && s.octr.CurrState === ST.GUEST_TRACK_WAIT, 60_000).catch(async e => {
			const gs = await online(guest), hs = await online(host)
			throw new Error(`${e.message.slice(0, 80)} || guest np ${gs.np} lobby ${JSON.stringify(gs.lobby)} share ${JSON.stringify(gs.share)} links ${JSON.stringify(gs.links)} error ${gs.error} ; host share ${JSON.stringify(hs.share)} links ${JSON.stringify(hs.links)}`)
		})
		await sleep(1000)
		await guestShot(ctx, guest, 'vs-guest-joined')
		for (let i = 0; i < 8 && ((await game(host))?.charSelect?.locked & 2) === 0 && (await game(host))?.charSelect; i++) {
			await guest.press(CROSS)
			await sleep(800)
		}
		g = await untilGame(host, 'the track select', s => !s.charSelect && s.screen === 'menu', 15_000)
		steps.push(`a guest by link : 2 players, the host's lock kept, both locked → ${g.menu?.label ?? g.sub?.title ?? 'tracks'}`)
		await shot(ctx, 'vs-two-to-tracks')
	} finally {
		await guest.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await guestBrowser.close()
	}
	return steps.join(' · ')
}

/** Item 3 : INVITE on the room's menu screens — Select, the code, the link, Triangle back. */
async function invite(ctx) {
	needRelay(ctx)
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	const steps = []
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS }, ctx.sid)
	await bootWith(host, origin, { relay: ctx.args.relay, rk: ctx.args.rk, name: 'Host' })
	await toNetplay(host)
	// with no room, Select shows nothing
	await host.press(SELECT)
	await host.frames(20)
	if ((await game(host)).netplay?.screen === 'invite') throw new Error('INVITE opened with no room')
	const { o } = await hostBy(host, 'ARCADE')
	await pressUntil(host, SELECT, 'INVITE on the race type', s => s.netplay?.screen === 'invite')
	await shot(ctx, 'invite-race-type')
	// its presses are its own : Cross closes it and does not pick the race type under it
	await pressUntil(host, CROSS, 'INVITE closed by Cross', s => s.netplay?.screen === 'none')
	await host.frames(20)
	let g = await game(host)
	if (g.sub?.title !== 'RACE TYPE') throw new Error(`INVITE's Cross reached the menu under it : ${g.sub?.title}`)
	steps.push(`race type : Select → INVITE (room ${o.code}), Cross closes it, the menu under it untouched`)

	await pressUntil(host, CROSS, 'the difficulty', s => s.sub?.title !== 'RACE TYPE')
	await pressUntil(host, CROSS, 'the character select', s => !!s.charSelect)
	await sleep(1500)
	await pressUntil(host, SELECT, 'INVITE on the character select', s => s.netplay?.screen === 'invite')
	await shot(ctx, 'invite-select')
	await pressUntil(host, TRIANGLE, 'INVITE closed by Triangle', s => s.netplay?.screen === 'none')
	await host.frames(20)
	g = await game(host)
	if (!g.charSelect) throw new Error(`INVITE's Triangle left the character select (${g.sub?.title ?? g.menu?.label})`)
	const toasts = await ctx.js('return globalThis.__toasts ?? []')
	if (!toasts.some(t => /Invite link copied|Click here to copy the link/.test(t))) throw new Error(`INVITE said nothing of the link : ${JSON.stringify(toasts)}`)
	steps.push(`character select : INVITE, Triangle back to it ; the page : ${JSON.stringify(toasts.at(-1))}`)
	await ctx.js('window.__ctrOnline.leave(); return true')
	return steps.join(' · ')
}

/** The host on its VS character select, the guest's page booted with the relay and key in its Settings. */
async function hostAndGuest(ctx, mode, { guestRelay = ctx.args.relay, guestKey = ctx.args.rk } = {}) {
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	await bootWith(host, origin, { relay: ctx.args.relay, rk: ctx.args.rk, name: 'Host' })
	await toNetplay(host)
	const o = await vsSelect(host)
	const opened = await openGuestPage(ctx, origin, { mode, name: 'Bee', cdp: ctx.args.guestCdp })
	const guest = opened.guest
	const setGuest = `localStorage.setItem('ctr-online.relay', ${JSON.stringify(guestRelay)}); localStorage.setItem('ctr-online.rk', ${JSON.stringify(guestKey)}); return true`
	// one browser, one localStorage : the guest's relay would be the host's, already read by its page
	await (guest.own ? guest.js : ctx.js)(setGuest)
	return { origin, host, o, guest, guestBrowser: opened.guestBrowser }
}

const pathOk = (mode, path) => (mode === 'ws' ? path === 'relay' : true)

/** Item 4 : JOIN by code. The guest dials the host's characters ; the host says yes ; the guest is in the host's room and mode. */
async function joinCode(ctx, mode) {
	needRelay(ctx)
	const { origin, host, o, guest, guestBrowser } = await hostAndGuest(ctx, mode)
	try {
		await boot(guest, `${origin}/index.html`)
		const code = codeOf(o)
		await joinBy(guest, code)
		// the host is asked ; nothing of the room reached the guest yet
		const ask = await untilGame(host, 'the host asked (BEE WANTS IN)', s => s.netplay?.screen === 'ask', 60_000)
		const waiting = await untilGame(guest, 'the guest waiting for the host', s => s.netplay?.screen === 'joining', 10_000)
		const before = await online(guest)
		if (before.lobby.active || before.share) throw new Error(`the guest was in before the host's yes : ${JSON.stringify(before.share)}`)
		const asked = (await online(host)).asking
		await guestShot(ctx, guest, `join-code-${mode}-asked`)
		if ((await game(host)).charSelect?.players !== 1) throw new Error('the select grew before the host said yes')
		await pressUntil(host, CROSS, 'ACCEPT', s => s.netplay?.screen === 'none')
		const g = await until(guest, 'the guest in the host\'s room', s => s.role === 'guest' && s.room === o.room && s.lobby.active && s.share?.state === 'connected' && s.octr.CurrState === ST.GUEST_TRACK_WAIT, 120_000)
		const h = await untilGame(host, 'the host\'s select with 2 players', s => s.charSelect?.players === 2, 30_000)
		const shown = await untilGame(guest, 'the guest\'s JOIN screen gone', s => s.netplay?.screen === 'none', 10_000)
		await sleep(2000)
		await guestShot(ctx, guest, `join-code-${mode}-in`)
		const path = g.links[0]?.path
		if (!pathOk(mode, path)) throw new Error(`forced relay, but the link is ${path}`)
		return `dials ${code.join(' ')} → host asked (${asked?.name}, ${ask.netplay.screen}), guest ${waiting.netplay.screen} ; ACCEPT → in room ${g.room} as slot ${g.share.slot} over ${path}, the host's VS select ${h.charSelect.players}P ; guest screen ${shown.netplay.screen}`
	} finally {
		await guest.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

/** Item 4 : JOIN by link — a click is enough, the host is not asked. */
async function joinLink(ctx, mode) {
	needRelay(ctx)
	// the guest's Settings hold no key : the link brings the relay and its key
	const { host, o, guest, guestBrowser } = await hostAndGuest(ctx, mode, { guestRelay: '', guestKey: '' })
	try {
		let asked = false
		const watch = setInterval(() => { online(host).then(s => { asked ||= !!s?.asking }).catch(() => {}) }, 300)
		await boot(guest, o.link)
		const g = await until(guest, 'the guest in the host\'s room', s => s.role === 'guest' && s.room === o.room && s.lobby.active && s.share?.state === 'connected', 120_000)
		const h = await untilGame(host, 'the host\'s select with 2 players', s => s.charSelect?.players === 2, 30_000)
		clearInterval(watch)
		if (asked) throw new Error('a guest by link was asked for at the door')
		await guestShot(ctx, guest, `join-link-${mode}`)
		const path = g.links[0]?.path
		if (!pathOk(mode, path)) throw new Error(`forced relay, but the link is ${path}`)
		// item 5 : the link's relay and key kept, Settings had none
		const kept = guest.own ? await guest.js("return [localStorage.getItem('ctr-online.relay'), localStorage.getItem('ctr-online.rk')]") : null
		if (kept && (kept[0] !== ctx.args.relay || kept[1] !== ctx.args.rk)) throw new Error(`the link's relay and key were not kept : ${JSON.stringify(kept)}`)
		return `the link → in room ${g.room} (code ${g.code}) as slot ${g.share.slot} over ${path}, never asked ; the host's select ${h.charSelect.players}P ; Settings now ${kept ? `${kept[0]} + its key` : '(one browser : not read)'}`
	} finally {
		await guest.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

/** Item 4 : what a failed JOIN says, each with its way back. */
async function joinErrors(ctx) {
	needRelay(ctx)
	const { origin, host, o, guest, guestBrowser } = await hostAndGuest(ctx, 'auto')
	const steps = []
	const said = (label, n, timeout = 20_000) => untilGame(guest, label, s => s.netplay?.screen === 'join' && s.netplay.said === n, timeout)
	try {
		await boot(guest, `${origin}/index.html`)
		const code = codeOf(o)
		// a code nobody hosts : one character off
		const wrong = [(code[0] + 1) % 15, ...code.slice(1)]
		await joinBy(guest, wrong)
		let g = await said('NO SUCH ROOM', NP.noRoom)
		if (g.netplay.dials.join() !== wrong.join()) throw new Error(`the dials were not kept : ${g.netplay.dials}`)
		await guestShot(ctx, guest, 'join-no-such-room')
		steps.push('a code nobody hosts : NO SUCH ROOM, the dials kept')

		// the right code, the host refuses
		await dial(guest, code)
		await guest.press(START)
		await untilGame(host, 'the host asked', s => s.netplay?.screen === 'ask', 60_000)
		await host.press('ArrowDown')
		await host.frames(10)
		await pressUntil(host, CROSS, 'REFUSE', s => s.netplay?.screen === 'none')
		await said('THE HOST SAID NO', NP.refused)
		await guestShot(ctx, guest, 'join-refused')
		if ((await game(host)).charSelect?.players !== 1) throw new Error('a refused guest reached the select')
		steps.push('the host refuses : THE HOST SAID NO, nobody on the select')

		// asked again, the guest gives up : Triangle, the host's box goes
		await guest.press(START)
		await untilGame(host, 'the host asked again', s => s.netplay?.screen === 'ask', 60_000)
		await pressUntil(guest, TRIANGLE, 'the guest gives up', s => s.netplay?.screen === 'join')
		await untilGame(host, 'the host\'s box gone', s => s.netplay?.screen === 'none', 15_000)
		steps.push('the guest\'s Triangle while waiting : back on its dials, the host\'s box gone')

		// Triangle on the dials : the NETPLAY menu
		await pressUntil(guest, TRIANGLE, 'JOIN\'s way back', s => s.netplay?.screen === 'none' && s.sub?.title === 'NETPLAY')
		steps.push('Triangle on the dials : the NETPLAY menu')

		// a relay that takes one peer : the room is full
		if (ctx.args.full) {
			await guest.js(`const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
				set('online-relay', ${JSON.stringify(ctx.args.full)}); return true`)
			// someone already in the room this code names on that relay
			await ctx.js(`const { roomFromCode } = await import('./net/code.js')
				const r = await roomFromCode(${JSON.stringify(code)})
				globalThis.__full = new WebSocket(${JSON.stringify(ctx.args.full)})
				await new Promise(ok => { __full.onopen = ok })
				__full.send(JSON.stringify({ type: 'hello', id: 'squatter', name: 'x', kind: 'host', room: r.room, key: ${JSON.stringify(ctx.args.rk)} }))
				return true`)
			await sleep(500)
			await pressUntil(guest, CROSS, 'the JOIN screen', s => s.netplay?.screen === 'join')
			await guest.press(START)
			await said('ROOM FULL', NP.full)
			await guestShot(ctx, guest, 'join-room-full')
			await ctx.js('globalThis.__full?.close(); return true')
			steps.push('a relay room with no place left : ROOM FULL')
			await pressUntil(guest, TRIANGLE, 'back', s => s.netplay?.screen === 'none')
		} else steps.push('ROOM FULL not run (--set full=ws://localhost:8790, a relay with RELAY_ROOM_MAX=1)')

		// a relay that never answers
		await guest.js(`const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
			set('online-relay', ${JSON.stringify(SILENT)}); return true`)
		await pressUntil(guest, CROSS, 'the JOIN screen', s => s.netplay?.screen === 'join')
		const t0 = Date.now()
		await guest.press(START)
		await said('RELAY OFFLINE', NP.offline, 30_000)
		await guestShot(ctx, guest, 'join-relay-offline')
		steps.push(`a silent relay : RELAY OFFLINE after ${((Date.now() - t0) / 1000).toFixed(1)} s`)
		await pressUntil(guest, TRIANGLE, 'back', s => s.netplay?.screen === 'none')

		// no key : the box, pointing to Settings
		await guest.js(`const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
			set('online-relay', ${JSON.stringify(ctx.args.relay)}); set('online-rk', ''); return true`)
		await pressUntil(guest, CROSS, 'the JOIN screen', s => s.netplay?.screen === 'join')
		await guest.press(START)
		g = await untilGame(guest, 'the NO RELAY KEY box', s => s.sub?.title === 'NO RELAY KEY', 10_000)
		await guestShot(ctx, guest, 'join-no-key')
		if (g.sub.label !== 'OPEN SETTINGS') throw new Error(`the box's first row is ${g.sub.label}`)
		for (let i = 0; i < 4 && !(await panelOpen(guest)); i++) {
			await guest.press(CROSS)
			await sleep(800)
		}
		if (!(await panelOpen(guest))) throw new Error('OPEN SETTINGS did not bring the Netplay panel')
		await guest.press('Escape')
		await sleep(800)
		steps.push('no key : the NO RELAY KEY box, OPEN SETTINGS brings the panel')
		// a mode with no key says the same, and BACK leaves the box
		await untilGame(guest, 'the NETPLAY menu under the box', s => s.sub?.title === 'NETPLAY', 10_000)
		await row(guest, 'ARCADE')
		await pressUntil(guest, CROSS, 'the box on a mode', s => s.sub?.title === 'NO RELAY KEY')
		await pressUntil(guest, TRIANGLE, 'the box\'s way back', s => s.sub?.title === 'NETPLAY')
		if ((await online(guest)).role === 'host') throw new Error('a room opened with no key')
		steps.push('ARCADE with no key : the same box, Triangle back')
		return steps.join(' · ')
	} finally {
		await guest.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

/** Item 5 : a mode on a silent relay — OPENING ROOM, then the RELAY OFFLINE box, TRY AGAIN, BACK ; a key typed is kept. */
async function relayAndKey(ctx) {
	needRelay(ctx)
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	const steps = []
	await bootWith(host, origin, { relay: SILENT, rk: ctx.args.rk, name: 'Host' })
	await toNetplay(host)
	await row(host, 'ARCADE')
	await host.press(CROSS)
	await untilGame(host, 'OPENING ROOM', s => s.netplay?.screen === 'opening', 5_000)
	await shot(ctx, 'opening-room')
	let g = await untilGame(host, 'the RELAY OFFLINE box', s => s.sub?.title === 'RELAY OFFLINE', 30_000)
	await shot(ctx, 'relay-offline-box')
	if (g.sub.label !== 'TRY AGAIN') throw new Error(`the box's first row is ${g.sub.label}`)
	steps.push('ARCADE on a silent relay : OPENING ROOM..., then the RELAY OFFLINE box')
	// the key and relay typed in Settings are kept as typed, no Create room needed
	await ctx.js(`const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
		set('online-relay', ${JSON.stringify(ctx.args.relay)}); return true`)
	const stored = await ctx.js("return localStorage.getItem('ctr-online.relay')")
	if (stored !== ctx.args.relay) throw new Error(`the relay typed in Settings was not kept (${stored})`)
	// TRY AGAIN, the relay now the right one : the room
	await pressUntil(host, CROSS, 'TRY AGAIN', s => s.sub?.title !== 'RELAY OFFLINE')
	const o = await until(host, 'the room after TRY AGAIN', s => s.role === 'host' && s.lobby.active, 30_000)
	g = await untilGame(host, 'ARCADE\'s race type', s => s.sub?.title === 'RACE TYPE', 20_000)
	steps.push(`the relay fixed in Settings (kept as typed), TRY AGAIN : room ${o.code} → ${g.sub.title}`)
	// OPENING's own way back : Triangle while the room is on its way
	await ctx.js('window.__ctrOnline.leave(); return true')
	await bootWith(host, origin, { relay: SILENT, rk: ctx.args.rk, name: 'Host' })
	await toNetplay(host)
	await row(host, 'VS.')
	await host.press(CROSS)
	await untilGame(host, 'OPENING ROOM', s => s.netplay?.screen === 'opening', 5_000)
	await pressUntil(host, TRIANGLE, 'OPENING\'s way back', s => s.netplay?.screen === 'none' && s.sub?.title === 'NETPLAY')
	await sleep(9000)
	g = await game(host)
	if (g.sub?.title !== 'NETPLAY') throw new Error(`after Triangle on OPENING, the late answer moved the menu : ${g.sub?.title}`)
	steps.push('Triangle on OPENING ROOM : the NETPLAY menu, and it stays')
	return steps.join(' · ')
}

export default async ctx => {
	await ctx.scenario('HOST-ON-MODE', () => hostOnMode(ctx))
	await ctx.scenario('MODES-ALONE', () => modesAlone(ctx))
	await ctx.scenario('INVITE', () => invite(ctx))
	await ctx.scenario('JOIN-CODE-P2P', () => joinCode(ctx, 'auto'))
	await ctx.scenario('JOIN-CODE-WS', () => joinCode(ctx, 'ws'))
	await ctx.scenario('JOIN-LINK-P2P', () => joinLink(ctx, 'auto'))
	await ctx.scenario('JOIN-LINK-WS', () => joinLink(ctx, 'ws'))
	await ctx.scenario('JOIN-ERRORS', () => joinErrors(ctx))
	await ctx.scenario('RELAY-AND-KEY', () => relayAndKey(ctx))
}
