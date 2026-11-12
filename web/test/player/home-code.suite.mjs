// Player suite : a room's code on the home page, before the game starts (session 28b). Under
// either card of the index page a small « or join a room » turns the page into the room code's
// dials — the game's JOIN, in the page, with the page's own pictures. The page finds the room
// and its kind : a Share room needs no disc (the guest lands on the host's screen once the host
// said yes, in its game) ; a Netplay room asks for the disc when none is stored, then joins as
// the game's JOIN does. What fails comes back to the dials, in the game's words. A Share host
// reads its code in the game : the room's tag, Select = INVITE, « ... WANTS IN » — a box on the
// menus, one line in a race.
//
// RUN
//   Build : web/dev.sh build debug
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Relay : (cd relay && RELAY_KEY=<key> PORT=8788 node relay.js) ; for ROOM FULL a second one
//           that takes a single peer : RELAY_KEY=<key> RELAY_ROOM_MAX=1 PORT=8790 ; nothing
//           reachable on 8787 (the silent relay)
//   Play  : bash plans/ctr-native-web/tools/play.sh home-code <session> 8093 -- \
//             --set relay=ws://localhost:8788 --set rk=<key> [--set full=ws://localhost:8790] [--only A,B]
//           The guest needs the second agent browser (play.sh passes --set guestCdp=<host:port>) : its
//           own storage, emptied of the disc for the no-disc scenarios ; without it they are skipped.
// Not a node --test file.

import { ROOM_KIND, codeRoom } from '../../net/code.js'
import { openRoom } from '../../net/room.js'
import { menuTo, say } from './ctr.mjs'
import { bootWith, codeOf, needRelay, pressUntil, tabOf, toNetplay, vsSelect } from './netplay-rooms.suite.mjs'
import { ST, boot, game, guestShot, online, openGuestPage, shot, until, untilGame } from './online.suite.mjs'
import { share } from './share.suite.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: { gamepad: true, pressFrames: 8 } }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CROSS = 'c'
const TRIANGLE = 'z'
const START = 'Enter'
const SELECT = ' '
const SILENT = 'ws://localhost:8787'
const NAMES = ['Crash', 'Cortex', 'Tiny', 'Coco', 'N. Gin', 'Dingodile', 'Polar', 'Pura', 'Pinstripe', 'Papu Papu', 'Ripper Roo', 'Komodo Joe', 'N. Tropy', 'Penta', 'Fake Crash']
const TOASTS = `(() => {
	globalThis.__toasts = []
	const seen = new WeakSet()
	new MutationObserver(() => {
		for (const t of document.querySelectorAll('.toast')) if (!seen.has(t)) { seen.add(t); __toasts.push(t.innerText.replace(/\\s+/g, ' ').trim()) }
	}).observe(document, { childList: true, subtree: true })
})()`

/** Waits for `expr` (page JS, truthy) on a page ; the last value seen in the failure. */
export async function page(tab, label, expr, timeout = 30_000) {
	const deadline = Date.now() + timeout
	let beat = Date.now() + 10_000
	let last = null
	while (Date.now() < deadline) {
		last = await tab.js(`return (${expr})`).catch(e => `(${e.message})`)
		if (last && !(typeof last === 'string' && last.startsWith('('))) return last
		if (Date.now() >= beat) { say(`${tab.name} : still waiting for ${label}`); beat += 10_000 }
		await sleep(250)
	}
	const where = await tab.js("return location.pathname + location.hash.slice(0, 40) + ' · ' + (document.getElementById('ctr-ui')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 200)").catch(e => e.message)
	throw new Error(`${tab.name} : timed out after ${Math.round(timeout / 1000)} s waiting for ${label} (${where})`)
}
const click = (tab, id) => tab.js(`const e = document.getElementById(${JSON.stringify(id)}); if (!e) throw new Error('no #${id}'); e.click(); return true`)
/** The home page's dials : { code: number[], at, said } or null when they are not up. */
export const dials = tab => tab.js(`const e = document.getElementById('join-code'); return e ? { code: e.dataset.code.split(',').map(Number), at: Number(e.dataset.at), said: document.getElementById('join-said').textContent.trim(), names: [...e.querySelectorAll('.name')].map(n => n.textContent) } : null`)

/** The index page loaded with these Netplay settings ; `disc: false` empties the browser's stored disc first. */
export async function home(tab, origin, { relay, rk, disc = true, hash = '' }) {
	await tab.navigate(`${origin}/preload-flag.js`)
	await sleep(800)
	await tab.js(`localStorage.setItem('ctr-online.relay', ${JSON.stringify(relay)}); localStorage.setItem('ctr-online.rk', ${JSON.stringify(rk)})
		localStorage.setItem('ctr-online.points', 'relay'); localStorage.removeItem('ctr-ui.joinCode')
		${disc ? '' : "const root = await navigator.storage.getDirectory(); for await (const name of root.keys()) await root.removeEntry(name, { recursive: true })"}
		return true`)
	// a load started while the page before it was still pulling the wasm can stall (online.suite.mjs boot) : another load
	for (let attempt = 1; ; attempt++) {
		await tab.navigate(`${origin}/index.html${hash}`)
		try {
			return await page(tab, 'the home page', "document.getElementById('or-join') ? (document.getElementById('press-start') ? 'ready' : 'drop') : document.getElementById('join-code') ? 'dials' : ''", 20_000)
		} catch (e) {
			if (attempt === 3) throw e
			say(`${tab.name} : the home page did not come, loading it again`)
			await tab.navigate(`${origin}/preload-flag.js`)
			await sleep(1500)
		}
	}
}

/** The dials set to `code` with the keyboard, as the game's JOIN is driven. */
async function dial(tab, code) {
	let d = await page(tab, 'the dials', "document.getElementById('join-code') ? 1 : 0").then(() => dials(tab))
	for (let i = 0; i < code.length; i++) {
		for (let n = 0; n < 8 && (d = await dials(tab)).at !== i; n++) await tab.press(d.at < i ? 'ArrowRight' : 'ArrowLeft')
		for (let n = 0; n < 16 && (d = await dials(tab)).code[i] !== code[i]; n++) await tab.press((code[i] - d.code[i] + 15) % 15 <= 7 ? 'ArrowDown' : 'ArrowUp')
	}
	for (let n = 0; n < 3 && (d = await dials(tab)).code.length > code.length; n++) await tab.press('x')
	d = await dials(tab)
	if (d.code.join() !== code.join()) throw new Error(`${tab.name} : the dials show ${d.code} for ${code}`)
	if (d.names.join() !== code.map(id => NAMES[id]).join()) throw new Error(`${tab.name} : the names under the dials are ${d.names}`)
	return d
}
/** « or join a room », the dials on `code`, Enter. */
export async function joinFromHome(tab, code) {
	if (!(await dials(tab))) await click(tab, 'or-join')
	await dial(tab, code)
	await tab.press(START)
}
/**
 * The red line on the dials. A page that comes back from a running game (the host's no) loads
 * again, and a load over the port forward can stall with nothing on screen : the same address
 * again — it still carries the dials and the reason.
 */
export async function said(tab, text) {
	const shown = `document.getElementById('join-said')?.textContent.trim() === ${JSON.stringify(text)}`
	for (let attempt = 1; ; attempt++) {
		try {
			await page(tab, `« ${text} » on the dials`, shown, attempt === 3 ? 40_000 : 20_000)
			return dials(tab)
		} catch (e) {
			const at = await tab.js("return document.getElementById('ctr-ui')?.childElementCount ? '' : location.href").catch(() => '')
			if (attempt === 3 || !at.includes('#join=')) throw e
			say(`${tab.name} : the page did not come back (${at.slice(at.indexOf('#'))}), loading it again`)
			await tab.navigate(new URL('/preload-flag.js', at).href)
			await sleep(1500)
			await tab.navigate(at)
		}
	}
}
export const onGuestPage = (tab, label, expr, timeout = 40_000) => page(tab, label, `location.pathname.endsWith('/share/guest.html') && window.__ctrShareGuest && (${expr})`, timeout)
export const guestState = tab => tab.js('return window.__ctrShareGuest.state()')

/** The second browser's page, or a skip : the no-disc scenarios empty its storage. */
export async function secondBrowser(ctx, origin, o = {}) {
	const opened = await openGuestPage(ctx, origin, { name: 'Bee', ...o })
	if (!opened.guest.own) {
		await opened.guestBrowser.close()
		ctx.skip('no second browser (--set guestCdp) : the guest would share this page\'s storage and its disc')
	}
	await opened.guest.gconn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS })
	return opened
}

/** Item 1 : the small link under either card, the dials driven by the keyboard, the mouse and a pad, Back. */
async function homeField(ctx) {
	const origin = new URL(ctx.args.url).origin
	const tab = tabOf(ctx)
	const steps = []
	// a disc in this browser : boot once stores it
	await boot(tab, `${origin}/index.html`)
	const first = await home(tab, origin, { relay: ctx.args.relay ?? SILENT, rk: ctx.args.rk ?? 'k' })
	if (first !== 'ready') throw new Error(`a stored disc, but the home page shows ${first}`)
	await shot(ctx, 'home-ready-or-join')
	if ((await tab.js("return document.getElementById('or-join').textContent.trim()")) !== 'or join a room') throw new Error('the link does not say « or join a room »')
	await click(tab, 'or-join')
	let d = await dial(tab, [0, 0, 0])
	if (await tab.js("return !!document.getElementById('press-start')")) throw new Error('the Game ready card is still there under the dials')
	// the keyboard : Up / Down turn and wrap, Right moves, Right past the last adds a dial, Square (x) removes it
	await tab.press('ArrowLeft')
	await tab.press('ArrowLeft')
	await tab.press('ArrowUp')
	await tab.press('ArrowRight')
	await tab.press('ArrowDown')
	await tab.press('ArrowRight')
	await tab.press('ArrowRight')
	d = await dials(tab)
	if (d.code.join() !== '14,1,0,0' || d.at !== 3) throw new Error(`keyboard : the dials are ${d.code} at ${d.at}, not 14,1,0,0 at 3`)
	await tab.press('x')
	d = await dials(tab)
	if (d.code.length !== 3 || d.at !== 2) throw new Error(`Square left ${d.code} at ${d.at}`)
	steps.push(`keyboard : ${d.names.join(' · ')}, a 4th dial added and taken away`)
	// the mouse : the arrows of a dial, the dial itself, the « + »
	await tab.js("const dial = document.querySelectorAll('#join-code .dial')[0]; dial.querySelectorAll('.turn')[1].click(); return true")
	await click(tab, 'join-more')
	d = await dials(tab)
	if (d.code.join() !== '0,1,0,0' || d.at !== 3) throw new Error(`mouse : the dials are ${d.code} at ${d.at}, not 0,1,0,0 at 3`)
	await click(tab, 'join-less')
	steps.push('mouse : a dial\'s arrow, « + », « one less »')
	// a pad : the d-pad turns and moves, Triangle is Back, Square opens the dials from the home page
	await ctx.pad(0).connect()
	await sleep(500)
	await ctx.pad(0).press('down')
	await ctx.pad(0).press('left')
	await ctx.pad(0).press('up')
	d = await dials(tab)
	if (d.code.join() !== '0,0,1' || d.at !== 1) throw new Error(`pad : the dials are ${d.code} at ${d.at}, not 0,0,1 at 1`)
	await shot(ctx, 'home-dials')
	await ctx.pad(0).press('triangle')
	await page(tab, 'the home page back (pad Triangle)', "!document.getElementById('join-code') && !!document.getElementById('press-start')", 5000)
	await ctx.pad(0).press('square')
	d = await page(tab, 'the dials again (pad Square)', "document.getElementById('join-code') ? 1 : 0", 5000).then(() => dials(tab))
	if (d.code.join() !== '0,0,1') throw new Error(`the dials were not kept : ${d.code}`)
	steps.push('pad : d-pad, Triangle back, Square opens them again with the code kept')
	// Escape is Back too ; the home page plays as before
	await tab.press('Escape')
	await page(tab, 'the home page back (Escape)', "!document.getElementById('join-code') && !!document.getElementById('press-start')", 5000)
	await ctx.pad(0).disconnect?.()
	steps.push('Escape back to Game ready')
	return steps.join(' · ')
}

/** Item 7 : each failure in the game's words, on the dials kept ; no key is typed on the page. */
async function homeErrors(ctx) {
	needRelay(ctx)
	const origin = new URL(ctx.args.url).origin
	const tab = tabOf(ctx)
	const { relay, rk, full } = ctx.args
	const steps = []
	const code = [3, 9, 12]
	await boot(tab, `${origin}/index.html`)
	await home(tab, origin, { relay, rk })
	await joinFromHome(tab, code)
	let d = await said(tab, 'NO SUCH ROOM')
	if (d.code.join() !== code.join()) throw new Error(`NO SUCH ROOM lost the dials : ${d.code}`)
	await shot(ctx, 'home-no-such-room')
	// turning a dial clears the line
	await tab.press('ArrowDown')
	await tab.press('ArrowUp')
	if ((await dials(tab)).said) throw new Error('the red line stayed after a dial was turned')
	steps.push('NO SUCH ROOM (dials kept, cleared by a turn)')

	if (full) {
		// a relay that takes one peer per room : a host (held from here) fills it
		const room = await openRoom({ link: await codeRoom(code, { relay: full, rk }), role: 'host', name: ROOM_KIND.netplay })
		try {
			await home(tab, origin, { relay: full, rk })
			await joinFromHome(tab, code)
			await said(tab, 'ROOM FULL')
			steps.push('ROOM FULL')
		} finally { room.close() }
	} else steps.push('ROOM FULL not driven (--set full=…)')

	await home(tab, origin, { relay: SILENT, rk })
	await joinFromHome(tab, code)
	await page(tab, 'the looking card', "!!document.getElementById('join-looking') || document.getElementById('join-said')?.textContent", 5000)
	await said(tab, 'RELAY OFFLINE')
	steps.push('RELAY OFFLINE')

	// no key in this browser : said on the page, typed there once
	await home(tab, origin, { relay, rk: '' })
	await joinFromHome(tab, code)
	await page(tab, 'the NO RELAY KEY card', "document.getElementById('join-nokey')?.innerText.includes('NO RELAY KEY')", 10_000)
	await shot(ctx, 'home-no-relay-key')
	await click(tab, 'join-back')
	if ((await page(tab, 'the dials back', "document.getElementById('join-code') ? 1 : 0", 5000)) && (await dials(tab)).code.join() !== code.join()) throw new Error('Back from NO RELAY KEY lost the dials')
	await tab.press(START)
	await page(tab, 'the NO RELAY KEY card again', "!!document.getElementById('join-nokey')", 10_000)
	const type = (id, value) => tab.js(`const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true`)
	await type('join-rk', 'not-the-key')
	await click(tab, 'join-save')
	await page(tab, 'KEY REFUSED', "document.getElementById('join-nokey')?.innerText.includes('KEY REFUSED')", 15_000)
	await type('join-rk', rk)
	await click(tab, 'join-save')
	await said(tab, 'NO SUCH ROOM')
	const kept = await tab.js("return localStorage.getItem('ctr-online.rk')")
	if (kept !== rk) throw new Error(`the key typed on the page was not kept : ${kept}`)
	steps.push('NO RELAY KEY (Back to the dials), KEY REFUSED, the right key typed there and kept')
	return steps.join(' · ')
}

/**
 * The Share host : the game booted, Couch on from the game (session 29 : Select on a character
 * select — VS's, or with `arcade` ARCADE's, which can race alone). The host is left on that select.
 */
async function shareHost(ctx, { arcade = false } = {}) {
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS }, ctx.sid)
	await bootWith(host, origin, { relay: ctx.args.relay, rk: ctx.args.rk, name: 'Host' })
	if (arcade) {
		await menuTo(host, 'ARCADE', dir => host.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		await pressUntil(host, CROSS, 'ARCADE\'s race type', s => s.sub?.title === 'RACE TYPE')
		await pressUntil(host, CROSS, 'the difficulty', s => s.sub?.title === 'DIFFICULTY')
		await pressUntil(host, CROSS, 'ARCADE\'s character select', s => !!s.charSelect)
		await sleep(1500)
	}
	const link = await share(ctx)
	const s = await ctx.js('return window.__ctrShare.state()')
	if (!/^[0-9a-e]{3,5}$/.test(s.code)) throw new Error(`the Share room has no code : ${JSON.stringify(s.code)}`)
	return { origin, host, link, code: codeOf(s) }
}

/** Items 3 and 6 : a Share host's code — one toast, then the game : the tag, Select = INVITE. */
async function shareHostCode(ctx) {
	needRelay(ctx)
	const { host, link, code } = await shareHost(ctx)
	try {
		const names = code.map(id => NAMES[id]).join(' · ')
		const toasts = await ctx.js('return globalThis.__toasts ?? []')
		if (!toasts.some(t => /Couch on — the link is copied|Click here to copy the link/.test(t) && t.includes(names))) throw new Error(`no toast naming ${names} : ${JSON.stringify(toasts)}`)
		if (!/[#&]c=[0-9a-e]{3,5}/.test(link) || !/[#&]t=/.test(link)) throw new Error(`the link carries no code or no pass : ${link.replace(/key=[^&]+/, 'key=…')}`)
		const g = await untilGame(host, 'the game showing the Share room', s => s.netplay?.share, 10_000)
		await shot(ctx, 'share-host-tag')
		await pressUntil(host, SELECT, 'INVITE on the main menu', s => s.netplay?.screen === 'invite')
		await shot(ctx, 'share-host-invite')
		await pressUntil(host, TRIANGLE, 'INVITE closed', s => s.netplay?.screen === 'none')
		// stopped : nothing of it left in the game
		await ctx.js("document.getElementById('share-stop').click(); return true")
		await untilGame(host, 'the tag gone with Share', s => !s.netplay?.share, 10_000)
		await host.press(SELECT)
		await host.frames(20)
		if ((await game(host)).netplay?.screen === 'invite') throw new Error('INVITE opened with Share off')
		return `the toast « ${toasts.find(t => t.includes(names))} » ; in the game : share ${g.netplay.share}, Select → INVITE, Triangle back ; Share stopped : no tag, no INVITE`
	} finally {
		await ctx.js("window.ctrShareApi?.stopOn(); return true").catch(() => {})
	}
}

/** Items 3 and 5 : a guest with no disc types the Share code ; the host answers in its game. */
async function shareCode(ctx) {
	needRelay(ctx)
	const { origin, host, link, code } = await shareHost(ctx)
	const { guest, guestBrowser } = await secondBrowser(ctx, origin)
	const steps = []
	try {
		const first = await home(guest, origin, { relay: ctx.args.relay, rk: ctx.args.rk, disc: false })
		if (first !== 'drop') throw new Error(`no disc in the guest's browser, but its home page shows ${first}`)
		await guestShot(ctx, guest, 'share-home-no-disc')
		await joinFromHome(guest, code)
		await onGuestPage(guest, 'the guest waiting at the door', "document.getElementById('overlay-text')?.textContent.includes('Waiting for the host')")
		const ask = await untilGame(host, 'the host asked in its game', s => s.netplay?.screen === 'ask', 30_000)
		const asking = (await ctx.js('return window.__ctrShare.state()')).asking
		const before = await guestState(guest)
		if (before.tracks.length || before.state === 'connected') throw new Error(`the guest got the room before the host's yes : ${before.state}, ${before.tracks}`)
		await guestShot(ctx, guest, 'share-door-asked')
		// REFUSE : the dials again, kept, the game's words
		await host.press('ArrowDown')
		await pressUntil(host, CROSS, 'REFUSE', s => s.netplay?.screen === 'none').catch(async e => {
			await guestShot(ctx, guest, 'share-refuse-stuck')
			throw new Error(`${e.message} ; share ${JSON.stringify(await ctx.js('const s = window.__ctrShare.state(); return { asking: s.asking, guests: s.guests, refusals: s.refusals, error: s.error }'))} ; guest ${JSON.stringify(await guest.js("return location.pathname + ' ' + (document.getElementById('overlay-text')?.textContent ?? document.getElementById('join-said')?.textContent ?? '')").catch(x => x.message))}`)
		})
		let d = await said(guest, 'THE HOST SAID NO')
		if (d.code.join() !== code.join()) throw new Error(`the refusal lost the dials : ${d.code}`)
		await guestShot(ctx, guest, 'share-refused')
		steps.push(`no disc → dials ${d.names.join(' · ')} → the host's box (${asking}, ${ask.netplay.screen}) → REFUSE → THE HOST SAID NO on the dials`)
		// the guest's own Back while it waits : the dials, and the host's box goes
		await guest.press(START)
		await onGuestPage(guest, 'waiting again', "document.getElementById('overlay-text')?.textContent.includes('Waiting for the host')")
		await untilGame(host, 'the host asked again', s => s.netplay?.screen === 'ask', 30_000)
		await guest.press('Escape')
		d = await page(guest, 'the dials after Back', "document.getElementById('join-code') ? 1 : 0").then(() => dials(guest))
		if (d.said || d.code.join() !== code.join()) throw new Error(`Back from the wait : ${JSON.stringify(d)}`)
		await untilGame(host, 'the host\'s box gone', s => s.netplay?.screen === 'none', 15_000)
		steps.push('Back while waiting → the dials, the host\'s box gone')
		// ACCEPT : the host's screen, no disc
		await guest.press(START)
		await untilGame(host, 'the host asked a third time', s => s.netplay?.screen === 'ask', 30_000)
		await pressUntil(host, CROSS, 'ACCEPT', s => s.netplay?.screen === 'none')
		const g = await onGuestPage(guest, 'the guest on the host\'s screen', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'connected' && s.tracks.length === 2 && s.video[0] > 0 ? s : null })()", 60_000)
		await sleep(1500)
		await guestShot(ctx, guest, 'share-in')
		steps.push(`ACCEPT → P${g.slot + 1} on the host's screen (${g.video.join('×')}, ${g.path})`)
		// the link : straight in, the host never asked
		let asked = false
		const watch = setInterval(() => { ctx.js('return window.__ctrShare.state().asking').then(a => { asked ||= !!a }).catch(() => {}) }, 300)
		await guest.navigate(`${origin}/preload-flag.js`)
		await sleep(1500)
		await guest.navigate(link)
		const l = await onGuestPage(guest, 'the link\'s guest on the host\'s screen', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'connected' && s.tracks.length === 2 ? s : null })()", 60_000)
		clearInterval(watch)
		if (asked) throw new Error('a guest by link was asked for at the door')
		steps.push(`the link → P${l.slot + 1}, never asked`)
		return steps.join(' · ')
	} finally {
		await ctx.js("window.ctrShareApi?.stopOn(); return true").catch(() => {})
		await guestBrowser.close()
	}
}

/** Item 5 : the host in a race — one line in the game, nothing on the page ; the box with the next menu. */
async function shareDoorRace(ctx) {
	needRelay(ctx)
	const { origin, host, code } = await shareHost(ctx, { arcade: true })
	const { guest, guestBrowser } = await secondBrowser(ctx, origin)
	try {
		// an Arcade race from the select Couch was started on (the main menu would close the room) :
		// Cross through every menu until the level runs
		for (let i = 0; i < 12 && (await game(host)).screen === 'menu'; i++) {
			await host.press(CROSS)
			await sleep(1200)
		}
		await untilGame(host, 'the race', s => s.screen === 'race', 120_000, 500)
		await ctx.js('globalThis.__toasts.length = 0; return true')
		await home(guest, origin, { relay: ctx.args.relay, rk: ctx.args.rk, disc: false })
		await joinFromHome(guest, code)
		await onGuestPage(guest, 'the guest waiting at the door', "document.getElementById('overlay-text')?.textContent.includes('Waiting for the host')")
		const line = await untilGame(host, 'the line in the race', s => s.netplay?.doorLine, 30_000)
		await sleep(500)
		await shot(ctx, 'share-door-race-line')
		if (line.netplay.screen !== 'none') throw new Error(`the box came up in the race : ${line.netplay.screen}`)
		const toasts = await ctx.js('return globalThis.__toasts')
		if (toasts.some(t => /wants/i.test(t))) throw new Error(`the page said it too : ${JSON.stringify(toasts)}`)
		// the pause menu's CHANGE CHARACTER : a menu again, and the box (QUIT would close the room)
		await host.press(START)
		for (let i = 0; i < 12; i++) {
			const s = await game(host)
			if (/CHARACTER/.test(s.menu?.label ?? '')) break
			await host.press(s.menu ? 'ArrowDown' : START)
			await host.frames(10)
		}
		await host.press(CROSS)
		const ask = await untilGame(host, 'the box on the next menu', s => s.netplay?.screen === 'ask', 90_000, 500)
		await shot(ctx, 'share-door-race-box')
		await pressUntil(host, CROSS, 'ACCEPT', s => s.netplay?.screen === 'none')
		const g = await onGuestPage(guest, 'the guest on the host\'s screen', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'connected' && s.tracks.length === 2 ? s : null })()", 60_000)
		return `in the race : the line (screen ${line.netplay.screen}), no toast ; CHANGE CHARACTER → the box (${ask.netplay.screen}) → ACCEPT → P${g.slot + 1}`
	} finally {
		await ctx.js("window.ctrShareApi?.stopOn(); return true").catch(() => {})
		await guestBrowser.close()
	}
}

/** The Netplay host on its VS select, the second browser for the guest. */
async function netplayHost(ctx, mode) {
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	await bootWith(host, origin, { relay: ctx.args.relay, rk: ctx.args.rk, name: 'Host' })
	await toNetplay(host)
	const o = await vsSelect(host)
	const opened = await secondBrowser(ctx, origin, { mode })
	return { origin, host, o, code: codeOf(o), ...opened }
}
const inRoom = (guest, o) => until(guest, 'the guest in the host\'s room', s => s.role === 'guest' && s.room === o.room && s.lobby.active && s.share?.state === 'connected' && s.octr.CurrState === ST.GUEST_TRACK_WAIT, 180_000)
const waitingCard = guest => page(guest, 'the card « Waiting for the host »', "document.getElementById('joining')?.dataset.state === 'waiting' && document.getElementById('joining').innerText.includes('Waiting for the host')", 180_000).catch(async e => {
	const o = await online(guest).catch(() => null)
	const log = await guest.js("return (document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-4).join(' | ')").catch(x => x.message)
	throw new Error(`${e.message} ; the guest's page : ${o ? `np ${o.np}, role ${o.role}, error ${o.error || '-'}, last ${o.lastError?.code ?? '-'}, links ${o.links.length}` : 'no Netplay module'} ; log : ${log.slice(0, 300)}`)
})

/**
 * The dials on `code`, Enter, and the game booting behind the joining card. A boot that logs
 * nothing stalled on its wasm (the port forward, as online.suite.mjs boot knows) : the home page
 * again, the same code.
 */
async function joinAndBoot(guest, origin, code, where) {
	for (let attempt = 1; ; attempt++) {
		await joinFromHome(guest, code)
		const deadline = Date.now() + 60_000
		let runs = false
		while (!runs && Date.now() < deadline) {
			runs = await guest.js("return /\\[OnlineCTR\\]|vblank=/.test(document.getElementById('log')?.textContent ?? '')").catch(() => false)
			if (!runs) await sleep(500)
		}
		if (runs) return
		if (attempt === 3) throw new Error(`guest : the game never started behind the joining card after ${attempt} tries`)
		say(`guest : no game output 60 s after the dials (try ${attempt}), the home page again`)
		await home(guest, origin, where)
	}
}

/** Item 2 : a Netplay code with no disc stored — the drop zone saying why, then the room. */
async function netplayNoDisc(ctx) {
	needRelay(ctx)
	const { origin, host, o, code, guest, guestBrowser } = await netplayHost(ctx, 'auto')
	try {
		await home(guest, origin, { relay: ctx.args.relay, rk: ctx.args.rk, disc: false })
		await joinFromHome(guest, code)
		const why = await page(guest, 'the drop zone saying why', "document.getElementById('join-netplay') && document.getElementById('drop-zone') ? document.getElementById('join-netplay').innerText.replace(/\\s+/g, ' ') : ''")
		if (!/This room plays Netplay/.test(why) || !/own game/.test(why)) throw new Error(`the drop zone says « ${why} »`)
		await guestShot(ctx, guest, 'netplay-no-disc-why')
		if ((await online(host)).asking) throw new Error('the host was asked before the guest had a disc')
		// Back : the dials, kept ; Join : the drop zone again
		await click(guest, 'join-back')
		const d = await page(guest, 'the dials after Back', "document.getElementById('join-code') ? 1 : 0").then(() => dials(guest))
		if (d.code.join() !== code.join()) throw new Error(`Back lost the dials : ${d.code}`)
		await guest.press(START)
		await page(guest, 'the drop zone again', "!!document.getElementById('join-netplay')")
		// the disc : the game boots into the room, the host is asked
		say('guest : storing the disc (605 MB)')
		await guest.js("void window.__ctrTestHandleFileFromUrl(location.origin + '/ctr-u.bin'); return true")
		await waitingCard(guest)
		await guestShot(ctx, guest, 'netplay-no-disc-waiting')
		await untilGame(host, 'the host asked', s => s.netplay?.screen === 'ask', 60_000)
		await pressUntil(host, CROSS, 'ACCEPT', s => s.netplay?.screen === 'none')
		const g = await inRoom(guest, o)
		await page(guest, 'the joining card gone', "!document.getElementById('joining')", 60_000)
		const h = await untilGame(host, 'the host\'s select with 2 players', s => s.charSelect?.players === 2, 30_000)
		await sleep(1500)
		await guestShot(ctx, guest, 'netplay-no-disc-in')
		return `no disc → dials → « ${why} » (the host not asked yet) ; Back → the dials ; the disc dropped → Waiting for the host → ACCEPT → in room ${g.room} over ${g.links[0]?.path}, the host's select ${h.charSelect.players}P`
	} finally {
		await guest.js('window.__ctrOnline?.leave(); return true').catch(() => {})
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

/** Item 2 : a Netplay code with the disc stored — no extra step ; the host's no, Back, then its yes. */
async function netplayDisc(ctx, mode) {
	needRelay(ctx)
	const { origin, host, o, code, guest, guestBrowser } = await netplayHost(ctx, mode)
	const steps = []
	try {
		// the disc in the guest's browser (stored by a run before, or now)
		await boot(guest, `${origin}/index.html`)
		const first = await home(guest, origin, { relay: ctx.args.relay, rk: ctx.args.rk })
		if (first !== 'ready') throw new Error(`a stored disc, but the guest's home page shows ${first}`)
		const where = { relay: ctx.args.relay, rk: ctx.args.rk }
		await joinAndBoot(guest, origin, code, where)
		await waitingCard(guest)
		if (await guest.js("return !!document.getElementById('join-netplay') || !!document.getElementById('drop-zone')")) throw new Error('the disc was asked for again')
		await untilGame(host, 'the host asked', s => s.netplay?.screen === 'ask', 60_000)
		const before = await online(guest)
		if (before.lobby.active || before.share) throw new Error(`the guest was in before the host's yes : ${JSON.stringify(before.share)}`)
		await host.press('ArrowDown')
		await pressUntil(host, CROSS, 'REFUSE', s => s.netplay?.screen === 'none')
		let d = await said(guest, 'THE HOST SAID NO')
		if (d.code.join() !== code.join()) throw new Error(`the refusal lost the dials : ${d.code}`)
		await guestShot(ctx, guest, `netplay-disc-${mode}-refused`)
		steps.push('disc stored → dials → the game boots, Waiting for the host (no disc asked) → REFUSE → THE HOST SAID NO on the dials')
		// Back on the waiting card : the dials
		await joinAndBoot(guest, origin, code, where)
		await waitingCard(guest)
		await untilGame(host, 'the host asked again', s => s.netplay?.screen === 'ask', 60_000)
		await guest.press('Escape')
		d = await page(guest, 'the dials after Back', "document.getElementById('join-code') ? 1 : 0", 60_000).then(() => dials(guest))
		if (d.said || d.code.join() !== code.join()) throw new Error(`Back from the wait : ${JSON.stringify(d)}`)
		await untilGame(host, 'the host\'s box gone', s => s.netplay?.screen === 'none', 20_000)
		steps.push('Back while waiting → the dials')
		await joinAndBoot(guest, origin, code, where)
		await waitingCard(guest)
		await untilGame(host, 'the host asked a third time', s => s.netplay?.screen === 'ask', 60_000)
		await pressUntil(host, CROSS, 'ACCEPT', s => s.netplay?.screen === 'none')
		const g = await inRoom(guest, o)
		await page(guest, 'the joining card gone', "!document.getElementById('joining')", 60_000)
		const path = g.links[0]?.path
		if (mode === 'ws' && path !== 'relay') throw new Error(`forced relay, but the link is ${path}`)
		await sleep(1500)
		await guestShot(ctx, guest, `netplay-disc-${mode}-in`)
		steps.push(`ACCEPT → in room ${g.room} over ${path}`)
		return steps.join(' · ')
	} finally {
		await guest.js('window.__ctrOnline?.leave(); return true').catch(() => {})
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

/** An invite link still joins as before : no dials, no host's yes. */
async function linkStill(ctx) {
	needRelay(ctx)
	const { origin, host, o, guest, guestBrowser } = await netplayHost(ctx, 'auto')
	try {
		await boot(guest, `${origin}/index.html`)
		let asked = false
		const watch = setInterval(() => { online(host).then(s => { asked ||= !!s?.asking }).catch(() => {}) }, 300)
		await boot(guest, o.link)
		const g = await inRoom(guest, o)
		clearInterval(watch)
		if (asked) throw new Error('a guest by link was asked for at the door')
		if (await guest.js("return !!document.getElementById('join-code')")) throw new Error('the dials showed for a link')
		return `the link → in room ${g.room}, never asked, no dials`
	} finally {
		await guest.js('window.__ctrOnline?.leave(); return true').catch(() => {})
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await guestBrowser.close()
	}
}

export default async ctx => {
	await ctx.scenario('HOME-FIELD', () => homeField(ctx))
	await ctx.scenario('HOME-ERRORS', () => homeErrors(ctx))
	await ctx.scenario('SHARE-HOST-CODE', () => shareHostCode(ctx))
	await ctx.scenario('SHARE-CODE', () => shareCode(ctx))
	await ctx.scenario('SHARE-DOOR-RACE', () => shareDoorRace(ctx))
	await ctx.scenario('NETPLAY-CODE-NO-DISC', () => netplayNoDisc(ctx))
	await ctx.scenario('NETPLAY-CODE-P2P', () => netplayDisc(ctx, 'auto'))
	await ctx.scenario('NETPLAY-CODE-WS', () => netplayDisc(ctx, 'ws'))
	await ctx.scenario('LINK-STILL', () => linkStill(ctx))
}
