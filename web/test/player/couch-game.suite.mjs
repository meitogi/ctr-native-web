// Player suite : Couch switched on and off from the game, and the players who are in (session 29).
// On the web a local mode has no players menu : VS, BATTLE and ARCADE go to the character select
// with whoever is in — P1, who navigates, then each device that pressed Start there and each Couch
// guest. On that select the pad's Select opens a Couch room (Share : the host's screen streamed to
// guests with no disc) on the relay and key of Settings › Netplay ; INVITE comes by itself, says
// the delay, and carries STOP COUCH ; the main menu closes the room too.
//
// RUN
//   Build : web/dev.sh build debug
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Relay : (cd relay && RELAY_KEY=<key> PORT=8788 node relay.js) ; nothing reachable on 8787 (the
//           silent relay)
//   Play  : bash plans/ctr-native-web/tools/play.sh couch-game <session> 8093 -- \
//             --set relay=ws://localhost:8788 --set rk=<key> [--only A,B]
//           The guests need the second agent browser (play.sh passes --set guestCdp=<host:port>).
// Not a node --test file.

import { menuTo, say } from './ctr.mjs'
import { guestState, home, joinFromHome, onGuestPage, said, secondBrowser } from './home-code.suite.mjs'
import { bootWith, codeOf, needRelay, pressUntil, tabOf } from './netplay-rooms.suite.mjs'
import { game, guestShot, shot, untilGame } from './online.suite.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: { gamepad: true, pressFrames: 8 } }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CROSS = 'c'
const TRIANGLE = 'z'
const START = 'Enter'
const SELECT = ' '
// nothing listens there ; CTR_SILENT_RELAY names another dead port when a dev relay holds 8787
const SILENT = process.env.CTR_SILENT_RELAY ?? 'ws://localhost:8787'
const NP = { noKey: 10, keyRefused: 11, offline: 12 }
const shareState = ctx => ctx.js('return window.__ctrShare.state()')
const to = (tab, label) => menuTo(tab, label, dir => tab.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))

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

/** Main menu → VS > SINGLE → the character select. Fails if a players menu shows on the way. */
async function vsSelect(tab) {
	await toMain(tab)
	await to(tab, 'VS.')
	await pressUntil(tab, CROSS, 'VS\'s race type', s => s.sub?.title === 'RACE TYPE')
	const s = await pressUntil(tab, CROSS, 'the character select, with no players menu', s => !!s.charSelect || s.sub?.title === 'PLAYERS')
	if (!s.charSelect) throw new Error(`VS > SINGLE opened ${s.sub?.title} : the players menu is still there`)
	await sleep(1500)
	return game(tab)
}

/** The host booted with these Netplay settings, on VS's character select. */
async function hostOnSelect(ctx, { relay = ctx.args.relay, rk = ctx.args.rk } = {}) {
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	await bootWith(host, origin, { relay, rk, name: 'Host' })
	// what an older build's Share panel kept : Couch must not write there
	await ctx.js("localStorage.removeItem('ctr-share.relay'); localStorage.removeItem('ctr-share.rk'); return true")
	await vsSelect(host)
	return { origin, host }
}

/** Select on the select : the room is asked for at once (OPENING ROOM, or a box saying why not). */
const couchAsk = host => host.press(SELECT)

/** Select : OPENING ROOM, then INVITE by itself. */
async function couchOn(ctx, host) {
	await couchAsk(host)
	const s = await untilGame(host, 'INVITE, by itself', g => g.netplay.screen === 'invite' && g.netplay.share, 30_000)
	const share = await shareState(ctx)
	if (!share.sharing || !/^[0-9a-e]{3,5}$/.test(share.code)) throw new Error(`Couch is on in the game, the page says ${JSON.stringify({ sharing: share.sharing, code: share.code })}`)
	return { s, share, code: codeOf(share) }
}

/** Item : no players menu — the three modes reach the select with P1 alone ; VS and BATTLE wait at the lock. */
async function noPlayersMenu(ctx) {
	const { host } = await hostOnSelect(ctx)
	const steps = []
	let s = await game(host)
	if (s.charSelect.players !== 1) throw new Error(`VS alone opened a select of ${s.charSelect.players}`)
	await pressUntil(host, CROSS, 'P1 locked, the select waiting', g => g.netplay.waiting)
	await shot(ctx, 'vs-alone-waiting')
	steps.push('VS > SINGLE → the select, 1 player, locked alone : WAITING FOR PLAYER 2')
	await toMain(host)
	await to(host, 'ARCADE')
	await pressUntil(host, CROSS, 'ARCADE\'s race type', g => g.sub?.title === 'RACE TYPE')
	s = await pressUntil(host, CROSS, 'the difficulty, with no players menu', g => g.sub?.title === 'DIFFICULTY' || g.sub?.title === 'PLAYERS')
	if (s.sub.title !== 'DIFFICULTY') throw new Error(`ARCADE > SINGLE opened ${s.sub.title}`)
	s = await pressUntil(host, CROSS, 'ARCADE\'s select', g => !!g.charSelect)
	if (s.charSelect.players !== 1) throw new Error(`ARCADE alone opened a select of ${s.charSelect.players}`)
	steps.push('ARCADE > SINGLE → DIFFICULTY → the select, 1 player')
	await toMain(host)
	await to(host, 'BATTLE')
	s = await pressUntil(host, CROSS, 'BATTLE\'s select, with no players menu', g => !!g.charSelect || g.sub?.title === 'PLAYERS')
	if (!s.charSelect) throw new Error(`BATTLE opened ${s.sub?.title}`)
	steps.push('BATTLE → the select')
	await toMain(host)
	return steps.join(' · ')
}

/** Item : who is in — a pad's Start joins, its held Select leaves ; what navigates is P1 ; the panel. */
async function localJoin(ctx) {
	const { host } = await hostOnSelect(ctx)
	const pad = ctx.pad(0)
	const steps = []
	try {
		let s = await game(host)
		if (s.netplay.seats.join() !== 'keys') throw new Error(`alone on the keyboard, the players are ${s.netplay.seats}`)
		await pad.connect()
		s = await untilGame(host, 'the pad offered a seat', g => g.netplay.joinable & 1, 10_000)
		if (s.charSelect.players !== 1) throw new Error(`a pad plugged in is a player at once : ${s.charSelect.players}`)
		await shot(ctx, 'join-offered')
		await pad.press('start')
		s = await untilGame(host, 'the pad in as P2', g => g.charSelect?.players === 2 && g.netplay.seats.join() === 'keys,pad', 10_000)
		steps.push(`a pad plugged : 1 player, START - JOIN ; its Start → ${s.charSelect.players} players (${s.netplay.seats.join(', ')})`)
		// each drives its own cursor
		const before = s.charSelect.characters
		await pad.press('right')
		s = await untilGame(host, 'P2\'s cursor moved by the pad', g => g.charSelect.characters[1] !== before[1], 5000)
		if (s.charSelect.characters[0] !== before[0]) throw new Error('the pad moved P1\'s cursor too')
		// the panel, while L1 + R1 are held
		await ctx.hold('ShiftLeft')
		await ctx.hold('ShiftRight')
		await untilGame(host, 'the players\' panel', g => g.netplay.panel, 5000)
		await sleep(300)
		await shot(ctx, 'players-panel')
		await ctx.release('ShiftLeft')
		await ctx.release('ShiftRight')
		await untilGame(host, 'the panel gone with the release', g => !g.netplay.panel, 5000)
		steps.push('L1 + R1 held : the panel ; released : gone')
		// Select held a second : out
		await pad.hold('select')
		s = await untilGame(host, 'the pad out', g => g.charSelect?.players === 1 && g.netplay.seats.join() === 'keys', 10_000)
		await pad.release('select')
		if (s.netplay.screen !== 'none') throw new Error(`the leaver's Select opened ${s.netplay.screen}`)
		steps.push('its Select held → 1 player')
		// what navigates is P1 : the pad now moves P1, and the keyboard's Start takes a seat
		await sleep(500)
		const mine = (await game(host)).charSelect.characters[0]
		await pad.press('right')
		await untilGame(host, 'P1\'s cursor moved by the pad', g => g.charSelect.characters[0] !== mine, 5000)
		await host.press(START)
		s = await untilGame(host, 'the keyboard in as P2', g => g.charSelect?.players === 2 && g.netplay.seats.join() === 'pad,keys', 10_000)
		await ctx.hold(SELECT)
		await sleep(1500)
		await ctx.release(SELECT)
		await untilGame(host, 'the keyboard out', g => g.charSelect?.players === 1, 10_000)
		steps.push('the pad navigates : it is P1, the keyboard\'s Enter joins as P2, its Select held leaves')
		return steps.join(' · ')
	} finally {
		await pad.disconnect().catch(() => {})
		await toMain(host).catch(() => {})
	}
}

/** Item : Couch on and off from the select — the Netplay settings' relay, INVITE, STOP COUCH, the main menu. */
async function couchOnOff(ctx) {
	needRelay(ctx)
	const { host } = await hostOnSelect(ctx)
	const steps = []
	try {
		let s = await game(host)
		if (s.netplay.share || (await shareState(ctx)).sharing) throw new Error('Couch is on before Select')
		await shot(ctx, 'select-couch-hint')
		const { share } = await couchOn(ctx, host)
		const link = new URLSearchParams(share.link.split('#')[1])
		if (link.get('relay') !== ctx.args.relay || link.get('rk') !== ctx.args.rk) throw new Error(`the room is on ${link.get('relay')}, not on the Netplay settings' relay`)
		if (await ctx.js("return localStorage.getItem('ctr-share.relay') || localStorage.getItem('ctr-share.rk')")) throw new Error('the Share panel\'s own relay or key was written')
		await shot(ctx, 'invite-by-itself')
		steps.push(`Select → INVITE by itself, the room on ${link.get('relay')} (Settings › Netplay), code ${share.code}`)
		// MORE INFO : the help page, and back on the code with the room untouched
		await pressUntil(host, 'ArrowDown', 'the cursor on MORE INFO', g => g.netplay.row === 1)
		s = await pressUntil(host, CROSS, 'MORE INFO', g => g.netplay.screen === 'help')
		if (s.netplay.help !== 'couch') throw new Error(`MORE INFO opened the help page of ${s.netplay.help}`)
		await shot(ctx, 'couch-help')
		s = await pressUntil(host, TRIANGLE, 'back on the code', g => g.netplay.screen === 'invite')
		if (!s.netplay.share) throw new Error('the help page closed Couch')
		await pressUntil(host, 'ArrowUp', 'the cursor on BACK', g => g.netplay.row === 0)
		steps.push('MORE INFO → the help page ; Triangle → the code again, Couch still on')
		// BACK : the box closed, Couch still on ; Select opens it again
		s = await pressUntil(host, CROSS, 'BACK', g => g.netplay.screen === 'none')
		if (!s.netplay.share || !s.charSelect) throw new Error('BACK closed Couch, or left the select')
		await shot(ctx, 'select-couch-on')
		await pressUntil(host, SELECT, 'INVITE again', g => g.netplay.screen === 'invite')
		await pressUntil(host, SELECT, 'Select closes it', g => g.netplay.screen === 'none')
		if (!(await game(host)).netplay.share) throw new Error('Select twice closed Couch')
		steps.push('BACK, then Select twice : the box only, Couch still on')
		// STOP COUCH : Down, Cross — where the host stands
		await pressUntil(host, SELECT, 'INVITE', g => g.netplay.screen === 'invite')
		await pressUntil(host, 'ArrowDown', 'the cursor on STOP COUCH', g => g.netplay.row === 2)
		await shot(ctx, 'invite-stop-couch')
		s = await pressUntil(host, CROSS, 'STOP COUCH', g => g.netplay.screen === 'none' && !g.netplay.share)
		if (!s.charSelect) throw new Error('STOP COUCH left the select')
		if ((await shareState(ctx)).sharing) throw new Error('the page still shares after STOP COUCH')
		steps.push('Select, Down, Down, Cross → stopped, still on the select')
		// on again, then the main menu closes it
		await couchOn(ctx, host)
		await pressUntil(host, CROSS, 'BACK', g => g.netplay.screen === 'none')
		await toMain(host)
		await untilGame(host, 'Couch closed by the main menu', g => !g.netplay.share, 10_000)
		if ((await shareState(ctx)).sharing) throw new Error('the page still shares on the main menu')
		steps.push('on again, Triangle up to the main menu → closed')
		return steps.join(' · ')
	} finally {
		await ctx.js('window.ctrShareApi?.stopOn(); return true').catch(() => {})
	}
}

/** Item : no key, and a silent relay, said in the game ; each way back. */
async function couchNo(ctx) {
	const steps = []
	// no key, on a relay that has one : the relay refuses, the box points to Settings
	let { host } = await hostOnSelect(ctx, { relay: ctx.args.relay ?? 'ws://localhost:8788', rk: '' })
	await couchAsk(host)
	let s = await untilGame(host, 'KEY REFUSED', g => g.netplay.screen === 'couch-no', 20_000)
	if (s.netplay.error !== NP.keyRefused) throw new Error(`no key on a keyed relay : the box says ${s.netplay.error}`)
	await shot(ctx, 'couch-no-relay-key')
	s = await pressUntil(host, TRIANGLE, 'Triangle : back on the select', g => g.netplay.screen === 'none')
	if (!s.charSelect || s.netplay.share) throw new Error('Triangle on the box left the select')
	await couchAsk(host)
	await untilGame(host, 'the box again', g => g.netplay.screen === 'couch-no', 10_000)
	await pressUntil(host, CROSS, 'OPEN SETTINGS', g => g.netplay.screen === 'none')
	const open = await ctx.js("return !!(document.getElementById('online')?.checkVisibility?.() || document.getElementById('ctr-settings')?.checkVisibility?.())")
	if (!open) throw new Error('OPEN SETTINGS opened nothing')
	await ctx.press('Escape')
	steps.push('no key on a keyed relay → KEY REFUSED ; Triangle → the select ; OPEN SETTINGS → the page\'s settings')
	// a silent relay
	;({ host } = await hostOnSelect(ctx, { relay: SILENT, rk: 'nokey' }))
	await couchAsk(host)
	await untilGame(host, 'OPENING ROOM', g => g.netplay.screen === 'opening' && g.netplay.couch, 10_000)
	await shot(ctx, 'couch-opening')
	s = await untilGame(host, 'RELAY OFFLINE', g => g.netplay.screen === 'couch-no', 90_000)
	if (s.netplay.error !== NP.offline) throw new Error(`a silent relay : the box says ${s.netplay.error}`)
	await shot(ctx, 'couch-relay-offline')
	// TRY AGAIN opens again ; Triangle on OPENING cancels
	await pressUntil(host, CROSS, 'TRY AGAIN', g => g.netplay.screen === 'opening')
	s = await pressUntil(host, TRIANGLE, 'Triangle on OPENING ROOM', g => g.netplay.screen === 'none')
	if (!s.charSelect || (await shareState(ctx)).sharing) throw new Error('Triangle on OPENING ROOM left something open')
	steps.push('a silent relay → OPENING ROOM → RELAY OFFLINE ; TRY AGAIN → opening ; Triangle → the select, nothing open')
	await toMain(host)
	return steps.join(' · ')
}

/** Item : a guest by code and one by link join it and get a cursor ; STOP COUCH tells them. */
async function couchGuests(ctx) {
	needRelay(ctx)
	const { origin, host } = await hostOnSelect(ctx)
	const { guest, guestBrowser } = await secondBrowser(ctx, origin)
	const steps = []
	try {
		const { share, code } = await couchOn(ctx, host)
		await pressUntil(host, CROSS, 'BACK', g => g.netplay.screen === 'none')
		// by code, no disc : the door, then a cursor on the host's select
		await home(guest, origin, { relay: ctx.args.relay, rk: ctx.args.rk, disc: false })
		await joinFromHome(guest, code)
		await untilGame(host, 'the host asked in its game', g => g.netplay.screen === 'ask', 40_000)
		await pressUntil(host, CROSS, 'ACCEPT', g => g.netplay.screen === 'none')
		let g = await onGuestPage(guest, 'the guest on the host\'s screen', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'connected' && s.tracks.length === 2 && s.video[0] > 0 ? s : null })()", 60_000)
		let s = await untilGame(host, 'the guest\'s cursor on the select', x => x.charSelect?.players === 2 && x.netplay.seats.join() === 'keys,guest', 15_000)
		await sleep(1000)
		await shot(ctx, 'select-with-guest')
		await guestShot(ctx, guest, 'guest-in')
		steps.push(`by code, no disc → WANTS IN → ACCEPT → P${g.slot + 1} (${g.path}), the select has ${s.charSelect.players} players (${s.netplay.seats.join(', ')})`)
		// its pad is P2's
		const before = s.charSelect.characters
		await guest.press('ArrowRight')
		await untilGame(host, 'P2\'s cursor moved by the guest', x => x.charSelect.characters[1] !== before[1], 10_000)
		steps.push('its keys move P2\'s cursor')
		// STOP COUCH : told
		await pressUntil(host, SELECT, 'INVITE', x => x.netplay.screen === 'invite')
		await pressUntil(host, 'ArrowDown', 'the cursor on STOP COUCH', x => x.netplay.row === 2)
		await pressUntil(host, CROSS, 'STOP COUCH', x => x.netplay.screen === 'none' && !x.netplay.share)
		s = await untilGame(host, 'the select back to one player', x => x.charSelect?.players === 1, 15_000)
		const d = await said(guest, 'THE HOST LEFT')
		await guestShot(ctx, guest, 'guest-told')
		steps.push(`STOP COUCH → the select has ${s.charSelect.players} player, the guest on its dials : ${d.said}`)
		// on again : a link's guest goes straight in ; the main menu closes the room, the guest is told
		const again = await couchOn(ctx, host)
		await pressUntil(host, CROSS, 'BACK', x => x.netplay.screen === 'none')
		if (again.share.code === share.code) say('the second room drew the same code')
		await guest.navigate(`${origin}/preload-flag.js`)
		await sleep(1500)
		await guest.navigate(again.share.link)
		g = await onGuestPage(guest, 'the link\'s guest on the host\'s screen', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'connected' && s.tracks.length === 2 ? s : null })()", 60_000)
		await untilGame(host, 'the link\'s guest on the select', x => x.charSelect?.players === 2, 15_000)
		if ((await game(host)).netplay.screen === 'ask') throw new Error('a guest by link was asked for at the door')
		await toMain(host)
		await untilGame(host, 'Couch closed by the main menu', x => !x.netplay.share, 10_000)
		const told = await onGuestPage(guest, 'the link\'s guest told', "(() => { const s = window.__ctrShareGuest.state(); return s.state !== 'connected' ? (document.getElementById('overlay-text')?.textContent || s.state) : null })()", 30_000)
		await guestShot(ctx, guest, 'link-guest-told')
		steps.push(`by link → P${g.slot + 1}, never asked ; the main menu closes the room, the guest reads « ${String(told).trim().slice(0, 60)} »`)
		return steps.join(' · ')
	} finally {
		await ctx.js('window.ctrShareApi?.stopOn(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

/** Item : a guest with no direct connection — one line in the host's game. */
async function noDirect(ctx) {
	needRelay(ctx)
	const { origin, host } = await hostOnSelect(ctx)
	const { guest, guestBrowser } = await secondBrowser(ctx, origin)
	try {
		const { share } = await couchOn(ctx, host)
		await pressUntil(host, CROSS, 'BACK', g => g.netplay.screen === 'none')
		// the guest page's test knob : the relay path, which Share refuses
		const link = new URL(share.link)
		link.searchParams.set('mode', 'ws')
		await guest.navigate(`${origin}/preload-flag.js`)
		await sleep(1500)
		await guest.navigate(link.href)
		await untilGame(host, 'the line in the host\'s game', g => g.netplay.couchSaid, 40_000, 100)
		await shot(ctx, 'no-direct-line')
		const line = await ctx.js('return window.ctrShareApi.said()')
		const s = await untilGame(host, 'the line gone', g => !g.netplay.couchSaid, 15_000)
		if (s.charSelect?.players !== 1) throw new Error(`a refused guest got a seat : ${s.charSelect?.players}`)
		const read = await guestState(guest).catch(() => null)
		return `« ${line} » for a few seconds on the host's select ; the guest : ${read?.state ?? 'back on the home page'}`
	} finally {
		await ctx.js('window.ctrShareApi?.stopOn(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

/** Item : the limits said before NETPLAY's menu, and the page's own words — the Help tab, the Couch tab. */
async function helpAndTab(ctx) {
	needRelay(ctx)
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	const steps = []
	const click = sel => ctx.js(`const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ${sel}'); e.click(); return true`)
	await bootWith(host, origin, { relay: ctx.args.relay, rk: ctx.args.rk, name: 'Host' })
	try {
		// NETPLAY : its menu at once ; its fifth row, MORE INFO, is the help page — any button back
		await toMain(host)
		await to(host, 'NETPLAY')
		let s = await pressUntil(host, CROSS, 'the NETPLAY menu, with no page before it', g => g.sub?.title === 'NETPLAY')
		if (s.netplay.screen !== 'none') throw new Error(`NETPLAY opened ${s.netplay.screen} before its menu`)
		// a press is read once it was seen released : a pause between two
		for (let i = 0; i < 10 && (await game(host)).sub?.label !== 'MORE INFO'; i++) { await host.press('ArrowDown'); await sleep(350) }
		if ((await game(host)).sub?.label !== 'MORE INFO') throw new Error(`the NETPLAY menu has no MORE INFO row : the cursor stops on ${(await game(host)).sub?.label}`)
		s = await pressUntil(host, CROSS, 'NETPLAY\'s help page', g => g.netplay.screen === 'help')
		if (s.netplay.help !== 'netplay') throw new Error(`MORE INFO opened the help page of ${s.netplay.help}`)
		await shot(ctx, 'netplay-help')
		s = await pressUntil(host, CROSS, 'back on the NETPLAY menu', g => g.netplay.screen === 'none')
		if (s.sub?.title !== 'NETPLAY' || s.sub.label !== 'MORE INFO') throw new Error(`the help page left ${s.sub?.title}/${s.sub?.label}`)
		steps.push('NETPLAY → its menu at once ; MORE INFO → the help page ; Cross → the menu again')
		// Settings › Help
		await ctx.press('Escape')
		await click('[data-tab=help]')
		const help = await ctx.js("return [...document.querySelectorAll('#ctr-settings .helplist')].map(l => l.innerText).join(' | ')")
		for (const word of ['One player per browser', 'one per guest browser', 'presses Start', 'Hold Select', 'L1 + R1', 'some delay'])
			if (!help.includes(word)) throw new Error(`Settings › Help does not say « ${word} » : ${help.slice(0, 300)}`)
		await sleep(400)
		await shot(ctx, 'settings-help')
		await ctx.press('Escape')
		steps.push('Settings › Help : how players join and leave, the limits of Couch and Netplay')
		// the Couch tab : the code read only, the relay the Netplay tab's, Stop
		await vsSelect(host)
		const { share } = await couchOn(ctx, host)
		await pressUntil(host, CROSS, 'BACK', g => g.netplay.screen === 'none')
		await ctx.press('Escape')
		await click('[data-tab=multi]')
		await click('[data-multi=share]')
		await sleep(1500)
		const tab = await ctx.js(`const v = id => document.getElementById(id); const shown = e => !!e && e.checkVisibility() && !e.disabled
			return { code: v('share-code')?.textContent.trim(), relay: v('share-relay')?.value, netplayRelay: v('online-relay')?.value, start: shown(v('share-start')), copy: shown(v('share-copy')), stop: shown(v('share-stop')), title: document.querySelector('[data-multi=share]')?.textContent.trim() }`)
		const names = codeOf(share).length
		if (tab.title !== 'Couch' || tab.start || tab.copy || !tab.stop) throw new Error(`the Couch tab : ${JSON.stringify(tab)}`)
		if (tab.relay !== ctx.args.relay || tab.relay !== tab.netplayRelay) throw new Error(`the Couch tab's relay is not the Netplay tab's : ${JSON.stringify(tab)}`)
		if ((tab.code?.split('·').length ?? 0) !== names) throw new Error(`the Couch tab's code : ${JSON.stringify(tab.code)}`)
		await shot(ctx, 'settings-couch-tab')
		await click('#share-stop')
		await ctx.press('Escape')
		s = await untilGame(host, 'Couch stopped from the tab', g => !g.netplay.share, 10_000)
		if (!s.charSelect) throw new Error('Stop on the tab left the select')
		steps.push(`Settings › Multiplayer › Couch : the code (${tab.code}), the Netplay tab's relay, no start button ; Stop → off in the game`)
		await toMain(host)
		return steps.join(' · ')
	} finally {
		await ctx.js('window.ctrShareApi?.stopOn(); return true').catch(() => {})
	}
}

export default async ctx => {
	await ctx.scenario('NO-PLAYERS-MENU', () => noPlayersMenu(ctx))
	await ctx.scenario('LOCAL-JOIN', () => localJoin(ctx))
	await ctx.scenario('COUCH-ON-OFF', () => couchOnOff(ctx))
	await ctx.scenario('COUCH-NO', () => couchNo(ctx))
	await ctx.scenario('COUCH-GUESTS', () => couchGuests(ctx))
	await ctx.scenario('NO-DIRECT', () => noDirect(ctx))
	await ctx.scenario('HELP-AND-TAB', () => helpAndTab(ctx))
}
