// Player suite : the page around Netplay (session 32e). The Netplay panel in each of its states
// (shots), a relay that never answers (the toast, NETPLAY usable again), the relay / key check,
// Copy's feedback, Join from the panel on several screens (no black screen), and Settings ›
// Controls keeping the tab the player picked with a pad plugged.
//
// RUN
//   Build : web/dev.sh build debug (or web/build-web.sh debug -DCTR_ONLINE=ON -DCTR_WEB_PRELOAD_DISC=OFF)
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Relay : (cd relay && RELAY_KEY=<key> PORT=8788 node relay.js) ; nothing reachable on 8787 (the agent
//           browser's proxy takes a connection to a closed port and never answers : the silent relay)
//   Play  : bash plans/ctr-native-web/tools/play.sh netplay-page <session> 8093 -- \
//             --set relay=ws://localhost:8788 --set rk=<key> [--set tag=before]
// Not a node --test file.

import { ST, boot, drive, game, guestShot, online, openGuestPage, shot, until, untilGame } from './online.suite.mjs'
import { quitRace } from './online-arcade.suite.mjs'
import { menuTo, say } from './ctr.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: { gamepad: true, pressFrames: 8 } }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const SILENT = 'ws://localhost:8787'
// every toast shown, in order (Toasts.svelte's .toast nodes come and go)
const TOASTS = `(() => {
	globalThis.__toasts = []
	const seen = new WeakSet()
	new MutationObserver(() => {
		for (const t of document.querySelectorAll('.toast')) if (!seen.has(t)) { seen.add(t); __toasts.push(t.innerText.replace(/\\s+/g, ' ').trim()) }
	}).observe(document, { childList: true, subtree: true })
})()`

const tabOf = ctx => ({ name: 'host', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: url => ctx.conn.send('Page.navigate', { url }, ctx.sid) })
const toasts = ctx => ctx.js('return globalThis.__toasts ?? []')

/**
 * The mean brightness (0–255) of what a page shows, from its compositor's screenshot decoded in
 * the page itself (no image library here) : a black screen is under 8.
 */
async function brightness(tab, send) {
	const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 40, fromSurface: true })
	return tab.js(`const img = new Image(); img.src = 'data:image/jpeg;base64,${data}'; await img.decode()
		const c = new OffscreenCanvas(160, 100), g = c.getContext('2d'); g.drawImage(img, 0, 0, 160, 100)
		const px = g.getImageData(0, 0, 160, 100).data ; let sum = 0
		for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
		return Math.round(sum / (px.length / 4))`)
}

/** The guest's panel Join, as a player does it : Settings › Netplay, paste, click Join, close Settings. */
async function joinFromPanel(guest, link) {
	await guest.js(`Module.ctrInput.openMultiplayer(); const i = document.getElementById('online-join-link'); i.value = ${JSON.stringify(link)}; return true`)
	const at = await guest.js(`const e = document.getElementById('online-join'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
	for (const type of ['mousePressed', 'mouseReleased']) await guest.gconn.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
	await sleep(500)
	await guest.press('Escape')
}

/**
 * Join from the panel while the guest's game is on `where` : the guest reaches the host's room
 * and its screen is not black 5 s after (the host's picture over its canvas, or its own game).
 */
async function joinFrom(ctx, where) {
	const { relay, rk } = ctx.args
	const origin = new URL(ctx.args.url).origin
	const host = tabOf(ctx)
	await boot(host, `${origin}/index.html`)
	await ctx.js(`localStorage.setItem('ctr-online.points', 'relay')
		const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
		set('online-relay', ${JSON.stringify(relay)}); set('online-rk', ${JSON.stringify(rk)})
		await window.__ctrOnline.host(); return true`)
	let a = await online(host)
	if (a.role !== 'host') throw new Error(`host : no room (${a.error})`)
	const { guestBrowser, guest } = await openGuestPage(ctx, origin)
	try {
		await boot(guest, `${origin}/index.html`)
		if (where === 'race') {
			await menuTo(guest, 'TIME TRIAL', dir => guest.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
			for (let i = 0; i < 10 && (await game(guest))?.screen === 'menu'; i++) {
				await guest.press('c')
				await sleep(1200)
			}
			await untilGame(guest, 'the solo race', g => g.screen === 'race' || g.screen === 'countdown' || (g.kart != null && g.screen !== 'menu' && g.screen !== 'loading'), 90_000, 500)
		}
		if (where === 'again') {
			// a room joined and left first : the page has been a guest once already
			await joinFromPanel(guest, a.link)
			await until(guest, 'the guest in the first room', s => s.role === 'guest' && s.lobby.active && s.share?.state === 'connected', 120_000)
			await sleep(3000)
			await guest.js('window.__ctrOnline.leave(); return true')
			await ctx.js('window.__ctrOnline.leave(); return true')
			await sleep(2000)
			await ctx.js('await window.__ctrOnline.host(); return true')
			a = await online(host)
			if (a.role !== 'host') throw new Error(`host : no second room (${a.error})`)
		}
		const before = await game(guest)
		await joinFromPanel(guest, a.link)
		const t0 = Date.now()
		// racing alone : the page joins, the game enters once back on its title (D12.8)
		const inLobby = s => s.role === 'guest' && s.room === a.room && s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected'
		let g
		try {
			g = await until(guest, 'the guest in the host\'s room', where === 'race' ? s => s.role === 'guest' && s.room === a.room && !!s.links.length : inLobby, 60_000)
		} catch (e) {
			const lum = await brightness(guest, (m, p) => guest.gconn.send(m, p))
			const gs = await online(guest)
			const hs = await online(host)
			await guestShot(ctx, guest, `join-from-${where}-stuck`)
			throw new Error(`${e.message} || brightness ${lum} ; guest DriverID ${gs.octr?.DriverID} state ${gs.octr?.CurrState} lobby ${JSON.stringify(gs.lobby)} ; host DriverID ${hs.octr?.DriverID} state ${hs.octr?.CurrState}`)
		}
		const joinedMs = Date.now() - t0
		await sleep(5000)
		const lum = await brightness(guest, (m, p) => guest.gconn.send(m, p))
		const shown = await guest.js("const v = document.getElementById('online-lobby'); return { video: !v.classList.contains('hidden'), size: [v.videoWidth, v.videoHeight], tracks: v.srcObject?.getTracks().map(t => t.readyState) ?? [], boot: !document.getElementById('boot').classList.contains('hidden'), settings: !!document.querySelector('aside:not(#online)'), canvas: getComputedStyle(document.getElementById('canvas')).visibility }")
		await guestShot(ctx, guest, `join-from-${where}`)
		await gjsLeave(guest, ctx)
		say(`${where} : joined in ${joinedMs} ms, brightness ${lum}, ${JSON.stringify(shown)}`)
		if (lum < 8) throw new Error(`black screen after Join from ${where} (brightness ${lum}, ${JSON.stringify(shown)})`)
		return `from ${before?.screen} (${before?.menu?.label ?? before?.levelID}) : in room ${g.room} after ${joinedMs} ms, slot ${g.share?.slot} ; 5 s later brightness ${lum}, ${JSON.stringify(shown)}`
	} finally {
		await guestBrowser.close()
	}
}

async function gjsLeave(guest, ctx) {
	await guest.js('window.__ctrOnline.leave(); return true').catch(() => {})
	await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
}

/** A real mouse click (a user activation, which the clipboard asks for) at an element's centre. */
async function click(ctx, selector) {
	const at = await ctx.js(`const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
	for (const type of ['mousePressed', 'mouseReleased']) await ctx.conn.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 }, ctx.sid)
}

/** The panel's relay fields set as a player types them, then left (focus out). */
async function setRelay(ctx, url, key) {
	await ctx.js(`const r = document.getElementById('online-relay'), k = document.getElementById('online-rk')
		r.value = ${JSON.stringify(url)}; k.value = ${JSON.stringify(key)}
		k.focus(); k.blur(); return true`)
}

const openPanel = ctx => ctx.js('Module.ctrInput.openMultiplayer(); return true')
const closePanel = ctx => ctx.js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true")

async function bootWith(ctx, relay, rk, hash = '') {
	const origin = new URL(ctx.args.url).origin
	const tab = tabOf(ctx)
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS }, ctx.sid)
	await ctx.js(`localStorage.setItem('ctr-online.relay', ${JSON.stringify(relay)}); localStorage.setItem('ctr-online.rk', ${JSON.stringify(rk)}); localStorage.setItem('ctr-online.points', 'relay'); return true`).catch(() => {})
	await boot(tab, `${origin}/index.html${hash}`)
	return tab
}

export default async ctx => {
	const { relay, rk } = ctx.args
	const tag = ctx.args.tag ?? 'after'
	if (!relay || !rk) throw new Error('--set relay=… --set rk=… : a local ctr-relay')

	await ctx.scenario('PANEL-SHOTS', async () => {
		const tab = await bootWith(ctx, relay, rk)
		await openPanel(ctx)
		await sleep(500)
		await shot(ctx, `panel-${tag}-no-room`)
		await setRelay(ctx, relay, 'not-the-key')
		await click(ctx, '#online-host')
		await until(tab, 'the key error', s => !!s?.error, 15_000)
		await sleep(300)
		await shot(ctx, `panel-${tag}-error`)
		await setRelay(ctx, relay, rk)
		await click(ctx, '#online-host')
		await until(tab, 'a room', s => s?.role === 'host' && !!s.link, 15_000)
		await sleep(500)
		await shot(ctx, `panel-${tag}-host`)
		const link = (await online(tab)).link
		await ctx.js('window.__ctrOnline.leave(); return true')
		// a guest of a room nobody hosts : the guest's side of the panel
		await ctx.js(`location.hash = ${JSON.stringify(new URL(link).hash)}; return true`)
		await until(tab, 'the guest side', s => s?.role === 'guest' || !!s?.error || !!s?.lastError, 20_000)
		await sleep(1500)
		await shot(ctx, `panel-${tag}-guest`)
		return 'four states shot'
	})

	if (tag === 'before') return

	await ctx.scenario('RELAY-SILENT', async () => {
		const tab = await bootWith(ctx, SILENT, 'some-key')
		// a mode hosts the room (session 28) : NETPLAY's menu, then ARCADE ; the game's own box says
		// RELAY OFFLINE, Triangle leaves it for the next try
		await openOnlineMenu(ctx, tab, keyboard(ctx))
		if (!(await toRow(tab, keyboard(ctx), 'ARCADE'))) throw new Error('no ARCADE row on the NETPLAY menu')
		const times = []
		for (let press = 1; press <= 2; press++) {
			const before = (await toasts(ctx)).length
			const t0 = Date.now()
			for (let i = 0; i < 4 && (await game(tab))?.sub?.title === 'RELAY OFFLINE'; i++) { await ctx.press('z'); await sleep(600) }
			await ctx.press('c')
			let list
			while (((list = await toasts(ctx)).length <= before) && Date.now() - t0 < 12_000) await sleep(250)
			const got = list.slice(before).find(t => t.includes('does not answer'))
			if (!got) throw new Error(`press ${press} : no « does not answer » toast in 12 s (${JSON.stringify(list)})`)
			if (!got.includes(SILENT)) throw new Error(`the toast names no relay : ${got}`)
			times.push(Date.now() - t0)
			say(`press ${press} : « ${got} » after ${times.at(-1)} ms`)
			const g = await untilGame(tab, 'the RELAY OFFLINE box', s => s.sub?.title === 'RELAY OFFLINE', 5000)
			if (g?.menu?.label !== 'NETPLAY') say(`menu now ${g?.menu?.label}`)
			await sleep(4500) // the toast leaves
		}
		if (times.some(t => t > 10_000)) throw new Error(`toast after ${times} ms (over 10 s)`)
		// the panel's Create room : the same toast, the button usable again
		await openPanel(ctx)
		await setRelay(ctx, SILENT, 'some-key')
		const before = (await toasts(ctx)).length
		const t0 = Date.now()
		await click(ctx, '#online-host')
		await sleep(300)
		const busy = await ctx.js("return document.getElementById('online-host').disabled")
		let list
		while (((list = await toasts(ctx)).length <= before) && Date.now() - t0 < 12_000) await sleep(250)
		const enabled = await ctx.js("return !document.getElementById('online-host').disabled")
		if (!list.slice(before).some(t => t.includes('does not answer')) || !enabled) throw new Error(`Create room : ${JSON.stringify(list.slice(before))}, enabled after ${enabled}`)
		await closePanel(ctx)
		return `NETPLAY toasts after ${times.join(' / ')} ms ; Create room ${Date.now() - t0} ms (disabled while trying : ${busy})`
	})

	await ctx.scenario('RELAY-CHECK', async () => {
		// run alone (--only) : boot first
		if (!(await ctx.js('return !!Module?.ctrInput?.openMultiplayer').catch(() => false))) await bootWith(ctx, relay, rk)
		await openPanel(ctx)
		const check = async (url, key) => {
			await setRelay(ctx, url, key)
			const t0 = Date.now()
			let s
			while (!/[✓✗]/.test(s = await ctx.js("return document.getElementById('online-relay-check').textContent")) && Date.now() - t0 < 12_000) await sleep(200)
			const cls = await ctx.js("return document.getElementById('online-relay-check').className")
			say(`${url} key ${key.slice(0, 4)}… : ${s} (${cls}, ${Date.now() - t0} ms)`)
			return { s, cls }
		}
		const good = await check(relay, rk)
		await shot(ctx, 'check-ok')
		const wrong = await check(relay, 'not-the-key')
		await shot(ctx, 'check-key')
		const gone = await check(SILENT, rk)
		await shot(ctx, 'check-unreachable')
		await closePanel(ctx)
		if (!good.s.startsWith('✓') || !good.cls.includes('ok')) throw new Error(`good : ${good.s}`)
		if (!wrong.s.startsWith('✗') || !wrong.s.includes('refused')) throw new Error(`wrong key : ${wrong.s}`)
		if (!gone.s.startsWith('✗') || !gone.s.includes('does not answer')) throw new Error(`silent : ${gone.s}`)
		return `${good.s} | ${wrong.s} | ${gone.s}`
	})

	await ctx.scenario('COPY', async () => {
		const tab = tabOf(ctx)
		await openPanel(ctx)
		await setRelay(ctx, relay, rk)
		await click(ctx, '#online-host')
		await until(tab, 'a room', s => s?.role === 'host' && !!s.link, 15_000)
		const origin = new URL(ctx.args.url).origin
		await ctx.conn.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(e => say(`grant : ${e.message}`))
		await click(ctx, '#online-copy')
		await sleep(300)
		const label = await ctx.js("return document.getElementById('online-copy').textContent")
		await shot(ctx, 'copied')
		await sleep(2200)
		const after = await ctx.js("return document.getElementById('online-copy').textContent")
		const toastList = await toasts(ctx)
		const selected = await ctx.js("const b = document.getElementById('online-link'); return document.activeElement === b && b.selectionEnd - b.selectionStart === b.value.length")
		if (!(label === 'Copied' && after === 'Copy')) {
			// this browser refused the clipboard : its fallback must have shown
			if (!(toastList.some(t => t.includes('Select the link')) && selected)) throw new Error(`label ${label} → ${after}, toasts ${JSON.stringify(toastList.slice(-2))}, selected ${selected}`)
			return `clipboard refused here : the toast and the link selected (${label})`
		}
		// a clipboard that refuses (Safari without a gesture, a denied permission) : the fallback
		await ctx.js("navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); return true")
		const before = (await toasts(ctx)).length
		await click(ctx, '#online-copy')
		await sleep(300)
		const refused = (await toasts(ctx)).slice(before)
		const picked = await ctx.js("const b = document.getElementById('online-link'); return document.activeElement === b && b.selectionEnd - b.selectionStart === b.value.length")
		await shot(ctx, 'copy-refused')
		await ctx.js('window.__ctrOnline.leave(); return true')
		await closePanel(ctx)
		if (!refused.some(t => t.includes('Select the link')) || !picked) throw new Error(`refused clipboard : toasts ${JSON.stringify(refused)}, link selected ${picked}`)
		return `« Copied » for 2 s, back to « ${after} » ; refused : « ${refused.at(-1)} », the link selected`
	})

	await ctx.scenario('JOIN-FROM-MENU', () => joinFrom(ctx, 'menu'))
	await ctx.scenario('JOIN-FROM-RACE', () => joinFrom(ctx, 'race'))
	await ctx.scenario('JOIN-AGAIN', () => joinFrom(ctx, 'again'))

	await ctx.scenario('CONTROLS-TAB', async () => {
		const tab = await bootWith(ctx, relay, rk)
		await ctx.pad(0).press('down') // the virtual pad becomes visible to the page
		await sleep(500)
		const openControls = async () => {
			await openPanel(ctx)
			await sleep(300)
			await ctx.js("document.querySelector('[data-tab=controls]').click(); return true")
			await sleep(300)
			return ctx.js("return document.querySelector('.controls [role=tab][aria-selected=true]')?.textContent.trim()")
		}
		const first = await openControls()
		await click(ctx, '.controls [role=tab]:first-child')
		await sleep(200)
		const picked = await ctx.js("return document.querySelector('.controls [role=tab][aria-selected=true]').textContent.trim()")
		await closePanel(ctx)
		await sleep(300)
		const again = await openControls()
		await closePanel(ctx)
		await boot(tab, `${new URL(ctx.args.url).origin}/index.html`)
		await ctx.pad(0).press('down')
		await sleep(500)
		const reloaded = await openControls()
		await shot(ctx, 'controls-tab-kept')
		await closePanel(ctx)
		await ctx.js("localStorage.removeItem('ctr-ui.controls-tab'); return true")
		if (!/Keyboard/.test(picked) || !/Keyboard/.test(again) || !/Keyboard/.test(reloaded)) throw new Error(`first ${first}, picked ${picked}, reopened ${again}, after a reload ${reloaded}`)
		return `a pad plugged : opened on ${first} ; Keyboard picked, reopened on ${again}, after a reload on ${reloaded}`
	})

	// the version : the boot screen, Settings › System and the title's corner, the build's git describe (--set version=…)
	await ctx.scenario('VERSION', async () => {
		const tab = tabOf(ctx)
		await tab.navigate(`${new URL(ctx.args.url).origin}/index.html`)
		let home = null
		for (let i = 0; i < 60 && !home; i++) { home = await ctx.js("return document.getElementById('boot-version')?.textContent.trim()").catch(() => null); if (!home) await sleep(250) }
		await shot(ctx, 'boot-version')
		await bootWith(ctx, relay, rk)
		await sleep(1500)
		await shot(ctx, 'title-version')
		await openPanel(ctx)
		await sleep(300)
		await ctx.js("document.querySelector('[data-tab=system]').click(); return true")
		await sleep(300)
		const text = await ctx.js("return document.getElementById('ctr-version')?.textContent.trim()")
		await shot(ctx, 'settings-version')
		await closePanel(ctx)
		if (!home || home !== text) throw new Error(`the boot screen shows « ${home} », Settings « ${text} »`)
		if (ctx.args.version && text !== `Version ${ctx.args.version}`) throw new Error(`Settings shows « ${text} », git describe ${ctx.args.version}`)
		return `the boot screen and Settings › System « ${text} » ; the title's corner : see the shot`
	})

	// a room link opened with the disc stored : no press, no intro, no title, the host's picture
	await ctx.scenario('LINK-SKIP', () => linkSkip(ctx))
	// a link to a room nobody hosts : the reason on the joining screen, Back to the player's own title
	await ctx.scenario('LINK-FAIL', () => linkFail(ctx))
	// the character select grows and shrinks with the room (a, b and a third browser : x with
	// --set guest2Cdp=<host:port>, else a window of a)
	await ctx.scenario('SELECT-GROW', () => selectGrow(ctx))
	// Arcade, a guest comes and goes, Back to the main menu : NETPLAY opens the ONLINE menu again
	await ctx.scenario('ARCADE-GUEST-BACK', () => arcadeGuestBack(ctx))
	// NETPLAY, a guest in the lobby (it stays, or it leaves), Back : the main menu, NETPLAY again
	await ctx.scenario('NETPLAY-GUEST-BACK', () => netplayGuestBack(ctx))
	// the Arcade select with a guest still in it, Back, Back, NETPLAY : a fresh select again
	await ctx.scenario('SELECT-GUEST-BACK', () => selectGuestBack(ctx))
	// alone : the Arcade select, Back, ARCADE again : its race type, then a select unlocked (32e)
	await ctx.scenario('ARCADE-BACK-AGAIN', () => arcadeBackAgain(ctx))
	// VS left with one human : the select stays and waits for a second (session 28)
	await ctx.scenario('SELECT-ALONE', () => selectAlone(ctx))
	// the host alone with a pad plugged : the pad is this machine's, not a guest (32e follow-up)
	await ctx.scenario('ROOM-PAD-ALONE', () => roomPadAlone(ctx))
	// BATTLE, back to the ONLINE menu, then ARCADE : no battle left in the Arcade cup
	await ctx.scenario('BATTLE-THEN-ARCADE', () => battleThenArcade(ctx))
	// NETPLAY's « Room open » toast is a button : a click copies the link (32e follow-up)
	await ctx.scenario('TOAST-COPY', () => toastCopy(ctx))
	// 32f : a guest's QUIT moves nobody else
	await ctx.scenario('QUIT-OTHERS', () => quitOthers(ctx))
	await ctx.scenario('QUIT-LEAVE-OTHERS', () => quitOthers(ctx, { leave: true }))
}

// the clipboard stubbed : every write kept in __clip, accepted or refused
const clipStub = ok => `globalThis.__clip = []
	navigator.clipboard.writeText = t => (__clip.push(t), ${ok} ? Promise.resolve() : Promise.reject(new DOMException('denied', 'NotAllowedError'))); return true`

async function toastCopy(ctx) {
	const tab = await bootWith(ctx, ctx.args.relay, ctx.args.rk)
	const press = keyboard(ctx)
	const actionToast = async label => {
		const t0 = Date.now()
		let text
		while (!(text = await ctx.js("return document.querySelector('.toast.action')?.innerText.replace(/\\s+/g, ' ').trim() ?? null")) && Date.now() - t0 < 15_000) await sleep(250)
		if (!text) throw new Error(`${label} : no clickable toast in 15 s (${JSON.stringify(await toasts(ctx))})`)
		return text
	}
	const netplay = async () => {
		// back to the main menu first : a submenu left open (the ONLINE menu after a leave) is not it
		for (let i = 0; i < 4 && (await game(tab))?.sub; i++) { await press('triangle'); await sleep(600) }
		// a mode hosts the room (session 28)
		await openOnlineMenu(ctx, tab, press)
		await pick(tab, press, 'ARCADE')
		return until(tab, 'a room', s => s?.role === 'host' && !!s.link, 15_000)
	}
	try {
		// 1. the clipboard refuses NETPLAY's copy : « Click here to copy » ; refused again on the click :
		//    Settings › Netplay opens with the link selected
		await ctx.js(clipStub(false))
		const a = await netplay()
		const refusedText = await actionToast('refused')
		await shot(ctx, 'toast-copy-refused')
		await click(ctx, '.toast.action')
		await sleep(800)
		const selected = await ctx.js("const b = document.getElementById('online-link'); return document.activeElement === b && b.value.length > 0 && b.selectionEnd - b.selectionStart === b.value.length")
		await shot(ctx, 'toast-copy-refused-click')
		await closePanel(ctx)
		if (!/Click here to copy the link/.test(refusedText) || !selected) throw new Error(`refused : « ${refusedText} », the link selected after the click ${selected}`)
		await ctx.js('window.__ctrOnline.leave(); return true')
		await sleep(2000)

		// 2. the clipboard accepts : « the link is copied », and the click copies it again
		await ctx.js(clipStub(true))
		const b = await netplay()
		const copiedText = await actionToast('accepted')
		const before = (await ctx.js('return __clip')).length
		await click(ctx, '.toast.action')
		await sleep(500)
		const clip = await ctx.js('return __clip')
		const list = await toasts(ctx)
		await shot(ctx, 'toast-copy-clicked')
		if (!/the link is copied/.test(copiedText) || clip.length !== before + 1 || clip.at(-1) !== b.link || list.at(-1) !== 'Copied') throw new Error(`accepted : « ${copiedText} », clipboard ${JSON.stringify(clip)}, toasts ${JSON.stringify(list.slice(-2))}`)
		return `refused : « ${refusedText} », its click opened Settings with the link selected (room ${a.room}) ; accepted : « ${copiedText} », its click copied ${b.link.slice(0, 40)}… and toasted « Copied »`
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
	}
}

// the open menu : the deepest submenu the bridge reports, else the main menu
const cur = g => g?.sub ?? g?.menu ?? null
/** The open menu's cursor to the row `label` ; null when no row has it (a grey row is skipped). */
async function toRow(tab, press, label) {
	const seen = []
	for (let i = 0; i < 6; i++) {
		const l = cur(await game(tab))?.label
		if (l === label) return seen
		seen.push(l)
		await press('down')
		await sleep(400)
	}
	return null
}
async function pick(tab, press, label) {
	if (!(await toRow(tab, press, label))) throw new Error(`no row « ${label} » : on « ${cur(await game(tab))?.label} »`)
	await press('cross')
	await sleep(600)
}
const ONLINE_ROWS = g => !g?.charSelect && /VS|BATTLE|ARCADE/.test(cur(g)?.label ?? '')
/** NETPLAY on the main menu, then Cross : the ONLINE menu. */
async function openOnlineMenu(ctx, tab, press) {
	await menuTo(ctx, 'NETPLAY', press)
	await press('cross')
	return untilGame(tab, 'the ONLINE menu', ONLINE_ROWS, 8000)
}
/**
 * NETPLAY, then a mode : the mode hosts the room (session 28). ARCADE, then Triangle back to the
 * NETPLAY menu, the room kept — where NETPLAY alone left a host before.
 */
async function hostFromMenu(ctx, tab, press) {
	await openOnlineMenu(ctx, tab, press)
	await pick(tab, press, 'ARCADE')
	const a = await until(tab, 'the room ARCADE opened', s => s.role === 'host' && !!s.link && s.lobby.active, 30_000)
	await untilGame(tab, 'ARCADE\'s race type', g => /SINGLE|CUP/.test(cur(g)?.label ?? ''), 20_000)
	for (let i = 0; i < 4 && !ONLINE_ROWS(await game(tab)); i++) { await press('triangle'); await sleep(800) }
	await untilGame(tab, 'the NETPLAY menu again', ONLINE_ROWS, 8000)
	return a
}
const KEYS = { down: 'ArrowDown', up: 'ArrowUp', cross: 'c', triangle: 'z' }
const keyboard = ctx => b => ctx.press(KEYS[b])
const gamepad = ctx => b => ctx.pad(0).press(b)

async function roomPadAlone(ctx) {
	const { host } = await hostRoom(ctx)
	try {
		await ctx.pad(0).press('down') // the virtual pad becomes visible to the page : a second device here
		await sleep(800)
		const press = gamepad(ctx)
		await openOnlineMenu(ctx, host, press)
		// BATTLE opens alone (session 28), and its select has one player : the host's own pad is
		// no second human
		await pick(host, press, 'BATTLE')
		const battle = (await untilGame(host, 'the Battle select', g => !!g.charSelect, 30_000)).charSelect
		for (let i = 0; i < 6 && !ONLINE_ROWS(await game(host)); i++) { await press('triangle'); await sleep(800) }
		await shot(ctx, 'room-pad-alone-menu')
		await pick(host, press, 'ARCADE')
		await pick(host, press, 'CUP')
		await pick(host, press, 'MEDIUM')
		const c = (await untilGame(host, 'the Arcade select', g => !!g.charSelect, 30_000)).charSelect
		await sleep(500)
		await shot(ctx, 'room-pad-alone-select')
		if (battle.players !== 1) throw new Error(`the Battle select has ${battle.players} players, alone with a pad`)
		if (c.players !== 1) throw new Error(`the Arcade select has ${c.players} players, alone with a pad`)
		return `alone with a pad : the Battle select ${battle.players}P ; Arcade › Cup › Medium : ${c.players}P`
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
	}
}

async function battleThenArcade(ctx) {
	const origin = new URL(ctx.args.url).origin
	const { host, a } = await hostRoom(ctx)
	const b = await openGuestPage(ctx, origin, { name: 'Bee' })
	try {
		await boot(b.guest, a.link)
		await until(b.guest, 'Bee in the room', s => s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected', 90_000)
		const press = keyboard(ctx)
		await openOnlineMenu(ctx, host, press)
		await pick(host, press, 'BATTLE')
		const battle = await untilGame(host, 'the Battle select', g => !!g.charSelect, 30_000)
		await sleep(800)
		await press('triangle') // back to the ONLINE menu
		await untilGame(host, 'the ONLINE menu again', ONLINE_ROWS, 15_000)
		await sleep(500)
		await pick(host, press, 'ARCADE')
		await pick(host, press, 'CUP')
		await pick(host, press, 'MEDIUM')
		let g
		try {
			g = await untilGame(host, 'the Arcade select', g => !!g.charSelect, 20_000)
		} catch (e) {
			g = await game(host)
			await shot(ctx, 'battle-then-arcade-stuck')
			throw new Error(`${e.message} || mode ${g?.mode} menu ${JSON.stringify(g?.menu)} sub ${JSON.stringify(g?.sub)} screen ${g?.screen}`)
		}
		await sleep(500)
		await shot(ctx, 'battle-then-arcade-select')
		if (g.mode.includes('BATTLE_MODE') || !g.mode.includes('ARCADE_MODE')) throw new Error(`the Arcade select in mode ${g.mode}`)
		return `Battle select (${battle.mode.join('|')}) → Triangle → ARCADE › CUP › MEDIUM : the select, ${g.charSelect.players}P, mode ${g.mode.join('|')}`
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await b.guestBrowser.close()
	}
}

// the user, 2026-11-06 : NETPLAY > ARCADE, a guest comes and goes, Back, Back, NETPLAY again
// as the user plays : the room opened by NETPLAY, driven by a plugged pad
async function arcadeGuestBack(ctx) {
	const origin = new URL(ctx.args.url).origin
	const host = await bootWith(ctx, ctx.args.relay, ctx.args.rk)
	const b = await openGuestPage(ctx, origin, { name: 'Bee' })
	const steps = []
	const note = async label => {
		const g = await game(host)
		steps.push(`${label} : ${g?.charSelect ? `select ${g.charSelect.players}P locked ${g.charSelect.locked}` : `menu ${cur(g)?.label}`} (${g?.mode?.join('|')})`)
		say(steps.at(-1))
		await shot(ctx, `arcade-guest-back-${label.replace(/\W+/g, '-')}`)
		return g
	}
	try {
		await ctx.pad(0).press('down') // the virtual pad becomes visible to the page
		await sleep(800)
		const press = gamepad(ctx)
		const a = await hostFromMenu(ctx, host, press)
		await pick(host, press, 'ARCADE')
		await pick(host, press, 'CUP')
		await pick(host, press, 'MEDIUM')
		await untilGame(host, 'the Arcade select', g => g.charSelect?.players === 1, 20_000)
		await note('alone')
		await boot(b.guest, a.link)
		await untilGame(host, 'the select grown to 2', g => g.charSelect?.players === 2, 90_000)
		await sleep(500)
		await note('Bee came')
		await b.guest.navigate(`${origin}/preload-flag.js`)
		await untilGame(host, 'the select back to 1', g => g.charSelect?.players === 1, 30_000)
		await sleep(500)
		await note('Bee left')
		await press('triangle')
		await untilGame(host, 'the ONLINE menu', ONLINE_ROWS, 15_000)
		await sleep(500)
		await note('back 1')
		await press('triangle')
		await untilGame(host, 'the main menu', g => !g.charSelect && !g.sub && g.menu?.input, 15_000)
		await sleep(500)
		await note('back 2')
		// up on the main menu : out of the room (the user, 32e), NETPLAY opens a new one
		const out = await online(host)
		if (out.role && out.role !== 'none') throw new Error(`still in the room on the main menu (${out.role}) || ${steps.join(' | ')}`)
		await menuTo(ctx, 'NETPLAY', press)
		await press('cross')
		const g = await untilGame(host, 'the NETPLAY menu again', ONLINE_ROWS, 20_000)
		await sleep(500)
		await note('NETPLAY again')
		const again = await online(host)
		// its menu with no room (session 28 : a mode hosts the next one)
		if (again.role && again.role !== 'none') throw new Error(`NETPLAY again : a room before any mode (${again.role}) || ${steps.join(' | ')}`)
		if (cur(g)?.label !== 'VS.') throw new Error(`the ONLINE menu's cursor on ${cur(g)?.label}, not its first row`)
		return steps.join(' | ')
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await b.guestBrowser.close()
	}
}

async function netplayGuestBack(ctx) {
	const origin = new URL(ctx.args.url).origin
	const host = await bootWith(ctx, ctx.args.relay, ctx.args.rk)
	const steps = []
	const note = async label => {
		const g = await game(host)
		const o = await online(host)
		steps.push(`${label} : ${g?.charSelect ? `select ${g.charSelect.players}P` : `menu ${cur(g)?.label}`} (${g?.mode?.join('|')}) room ${o.role}`)
		say(steps.at(-1))
		await shot(ctx, `netplay-guest-back-${label.replace(/\W+/g, '-')}`)
		return g
	}
	await ctx.pad(0).press('down') // the virtual pad becomes visible to the page
	await sleep(800)
	const press = gamepad(ctx)
	try {
		for (const stays of [false, true]) {
			const b = await openGuestPage(ctx, origin, { name: 'Bee' })
			try {
				const a = await hostFromMenu(ctx, host, press)
				await sleep(500)
				await boot(b.guest, a.link)
				await until(b.guest, 'Bee in the room', s => s.lobby.active && s.share?.state === 'connected', 90_000)
				await sleep(1000)
				await note(`Bee came (${stays ? 'stays' : 'leaves'})`)
				if (!stays) {
					await b.guest.navigate(`${origin}/preload-flag.js`)
					await sleep(3000)
					await note('Bee left')
				}
				await press('triangle')
				const g = await untilGame(host, 'the main menu after Back', g => !g.charSelect && !g.sub && g.menu?.input, 15_000)
					.catch(async e => { await note('Back stuck'); throw new Error(`${e.message} || ${steps.join(' | ')}`) })
				await sleep(1000)
				await note('Back')
				const out = await online(host)
				if (out.role && out.role !== 'none') throw new Error(`still in the room on the main menu || ${steps.join(' | ')}`)
				await press('cross')
				await untilGame(host, 'the ONLINE menu again', ONLINE_ROWS, 20_000)
					.catch(async e => { await note('NETPLAY stuck'); throw new Error(`${e.message} || ${steps.join(' | ')}`) })
				await sleep(500)
				await note('NETPLAY again')
				await press('triangle')
				await untilGame(host, 'the main menu', g => !g.charSelect && !g.sub && g.menu?.input, 15_000)
					.catch(async e => { await note('Back 2 stuck'); throw new Error(`${e.message} || ${steps.join(' | ')}`) })
				await sleep(1000)
			} finally {
				await b.guestBrowser.close()
			}
		}
		return steps.join(' | ')
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
	}
}

async function arcadeBackAgain(ctx) {
	const host = await bootWith(ctx, ctx.args.relay, ctx.args.rk)
	const steps = []
	const note = async label => {
		const g = await game(host)
		steps.push(`${label} : ${g?.charSelect ? `select ${g.charSelect.players}P locked ${g.charSelect.locked}` : `menu ${cur(g)?.label}`}`)
		say(steps.at(-1))
		await shot(ctx, `arcade-back-again-${label.replace(/\W+/g, '-')}`)
		return g
	}
	const wait = (label, test, ms) => untilGame(host, label, test, ms)
		.catch(async e => { await note(`${label} STUCK`); throw new Error(`${e.message} || ${steps.join(' | ')}`) })
	try {
		await ctx.pad(0).press('down') // the virtual pad becomes visible to the page
		await sleep(800)
		const press = gamepad(ctx)
		await hostFromMenu(ctx, host, press)
		for (const round of [1, 2, 3]) {
			await pick(host, press, 'ARCADE')
			await wait(`the race type ${round}`, g => /SINGLE|CUP/.test(cur(g)?.label ?? ''), 8000)
			await pick(host, press, 'CUP')
			await wait(`the difficulty ${round}`, g => /EASY|MEDIUM|HARD/.test(cur(g)?.label ?? ''), 8000)
			await pick(host, press, 'MEDIUM')
			const g = await wait(`the select ${round}`, g => !!g.charSelect, 20_000)
			await sleep(800)
			await note(`select ${round}`)
			if (g.charSelect.players !== 1 || g.charSelect.locked) throw new Error(`select ${round} : ${g.charSelect.players}P locked ${g.charSelect.locked} || ${steps.join(' | ')}`)
			await press('triangle')
			await wait(`the ONLINE menu ${round}`, ONLINE_ROWS, 15_000)
			await sleep(800)
			await note(`back ${round}`)
		}
		return steps.join(' | ')
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
	}
}

async function selectGuestBack(ctx) {
	const origin = new URL(ctx.args.url).origin
	const host = await bootWith(ctx, ctx.args.relay, ctx.args.rk)
	const b = await openGuestPage(ctx, origin, { name: 'Bee' })
	const steps = []
	const note = async label => {
		const g = await game(host)
		const o = await online(host)
		steps.push(`${label} : ${g?.charSelect ? `select ${g.charSelect.players}P locked ${g.charSelect.locked}` : `menu ${cur(g)?.label}`} (${g?.mode?.join('|')}) room ${o.role}`)
		say(steps.at(-1))
		await shot(ctx, `select-guest-back-${label.replace(/\W+/g, '-')}`)
		return g
	}
	const wait = (label, test, ms) => untilGame(host, label, test, ms)
		.catch(async e => { await note(`${label} STUCK`); throw new Error(`${e.message} || ${steps.join(' | ')}`) })
	try {
		await ctx.pad(0).press('down') // the virtual pad becomes visible to the page
		await sleep(800)
		const press = gamepad(ctx)
		const a = await hostFromMenu(ctx, host, press)
		await pick(host, press, 'ARCADE')
		await pick(host, press, 'CUP')
		await pick(host, press, 'MEDIUM')
		await wait('the Arcade select', g => g.charSelect?.players === 1, 20_000)
		await boot(b.guest, a.link)
		await wait('the select grown to 2', g => g.charSelect?.players === 2, 90_000)
		await sleep(1000)
		await note('Bee came')
		await press('triangle')
		await sleep(2000)
		await note('back 1')
		await press('triangle')
		await sleep(2000)
		await note('back 2')
		await press('triangle')
		await sleep(2000)
		await note('back 3')
		await wait('the main menu', g => !g.charSelect && !g.sub && g.menu?.input, 10_000)
		await menuTo(ctx, 'NETPLAY', press)
		await press('cross')
		await sleep(2000)
		const g = await note('NETPLAY again')
		if (g?.charSelect || cur(g)?.label !== 'VS.') throw new Error(`NETPLAY again not on a fresh ONLINE menu || ${steps.join(' | ')}`)
		await pick(host, press, 'ARCADE')
		// no room any more : ARCADE hosts a new one first (session 28), its race type comes after
		await wait('the race type of a new room', g => /SINGLE|CUP/.test(cur(g)?.label ?? ''), 30_000)
		await pick(host, press, 'CUP')
		await pick(host, press, 'MEDIUM')
		const s = await wait('the Arcade select again', g => !!g.charSelect, 20_000)
		await sleep(1000)
		await note('select again')
		if (s.charSelect.players !== 1 || s.charSelect.locked) throw new Error(`the select again ${s.charSelect.players}P locked ${s.charSelect.locked} || ${steps.join(' | ')}`)
		await press('triangle')
		await wait('out of the select', g => !g.charSelect, 10_000)
		return steps.join(' | ')
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await b.guestBrowser.close()
	}
}

async function selectAlone(ctx) {
	const origin = new URL(ctx.args.url).origin
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: TOASTS }, ctx.sid)
	const { host, a } = await hostRoom(ctx)
	const b = await openGuestPage(ctx, origin, { name: 'Bee' })
	try {
		await boot(b.guest, a.link)
		await until(b.guest, 'Bee in the room', s => s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected', 90_000)
		await menuTo(ctx, 'NETPLAY', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		for (const key of ['c', 'c', 'c']) { await ctx.press(key); await ctx.frames(15) }
		await untilGame(host, 'the VS select with 2', g => g.charSelect?.players === 2, 30_000)
		await b.guest.navigate(`${origin}/preload-flag.js`)
		// session 28 : the select stays, with one player ; its lock then waits for a second
		let g = await untilGame(host, 'the select shrunk to 1 player', g => g.charSelect?.players === 1, 30_000)
		await sleep(2000)
		for (let i = 0; i < 6 && !((await game(host))?.charSelect?.locked & 1); i++) { await ctx.press('c'); await sleep(800) }
		await sleep(2500)
		g = await game(host)
		await shot(ctx, 'select-alone')
		if (!g.charSelect || !(g.charSelect.locked & 1) || !g.netplay?.waiting) throw new Error(`alone on the VS select after the lock : ${JSON.stringify(g.charSelect)}, ${JSON.stringify(g.netplay)}`)
		return `Bee left the VS select : it stays, ${g.charSelect.players}P ; P1 locked : WAITING FOR PLAYER 2`
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await b.guestBrowser.close()
	}
}

const sel = async host => (await game(host))?.charSelect ?? null

// 32f, item 4 : Bee (P2) quits a 3-player VS race ; Ex (P3) races on undisturbed — its seat, its
// Share slot, no new WELCOME — and at the next select Ex is still P3 with its character, Bee P2
// with its own
// leave : Bee then leaves for good (its band's Back) — its slot a hole until the menus, then Ex
// moves down to P2 with its own character (the select shifts it before it takes input)
async function quitOthers(ctx, { leave = false } = {}) {
	const origin = new URL(ctx.args.url).origin
	const { host, a } = await hostRoom(ctx)
	const b = await openGuestPage(ctx, origin, { name: 'Bee' })
	let x = null
	const rows = []
	try {
		await boot(b.guest, a.link)
		await until(b.guest, 'Bee in the room', s => s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected', 90_000)
		x = await openGuestPage(ctx, origin, { name: 'Ex', cdp: ctx.args.guest2Cdp ?? null })
		await boot(x.guest, a.link)
		await until(x.guest, 'Ex in the room', s => s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected', 90_000)
		await ctx.js("const e = document.getElementById('online-end-after'); e.value = '15'; e.dispatchEvent(new Event('change')); return true")
		// NETPLAY > VS > SINGLE RACE : the select with the room's 3 ; P2 and P3 move off P1's character, all lock
		await menuTo(ctx, 'NETPLAY', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		for (const key of ['c', 'c', 'c']) { await ctx.press(key); await ctx.frames(15) }
		await untilGame(host, 'the select with 3', g => g.charSelect?.players === 3, 60_000)
		await b.guest.press('ArrowRight'); await x.guest.press('ArrowLeft'); await sleep(800)
		// the characters as the select last showed them : all locked, it moves on to the tracks
		let locked = await sel(host)
		for (let i = 0; i < 8 && locked && locked.locked !== 7; i++) {
			const l = locked.locked
			if (!(l & 2)) await b.guest.press('c')
			if (!(l & 4)) await x.guest.press('c')
			await sleep(800)
			const now = await sel(host)
			if (now && !(now.locked & 1) && (now.locked & 6) === 6) await ctx.press('c') // P1 last : the others' locks are in
			await sleep(800)
			const next = await sel(host)
			if (!next) break
			locked = next
		}
		if (!locked || locked.players !== 3) throw new Error(`the select before the race : ${JSON.stringify(locked)}`)
		// the track select (the bridge reads no RectMenu there) : its first track, Cross until it is sent
		await untilGame(host, 'the track select', g => !g.charSelect, 20_000)
		for (let i = 0; i < 16 && (await online(host)).octr.CurrState === ST.HOST_TRACK_PICK; i++) {
			if (!(await game(host))?.charSelect) await ctx.press('c')
			await sleep(700)
		}
		for (const t of [host, b.guest, x.guest]) await until(t, `${t.name} racing`, s => s.octr.CurrState === ST.START_RACE, 180_000, 500)
		await untilGame(b.guest, 'the lights over', g => g.raceTime > 5000, 60_000)
		const ex0 = await online(x.guest)
		const room = (await online(b.guest)).room
		rows.push(`racing : Ex DriverID ${ex0.octr.DriverID}, slot ${ex0.share.slot} ; characters ${JSON.stringify(locked.characters)}`)
		// Ex's view sampled through the race : its seat and its Share slot
		const exSeen = []
		let on = true
		const loop = (async () => { while (on) { const s = await online(x.guest).catch(() => null); if (s) exSeen.push({ d: s.octr?.DriverID, slot: s.share?.slot, st: s.octr?.CurrState }); await sleep(500) } })()
		await quitRace(b.guest)
		if (leave) {
			await until(b.guest, 'Bee watching', s => !!s.watch?.band, 20_000)
			// the band itself on screen (the page shows it at its next tick)
			for (let i = 0; i < 20 && !(await b.guest.js("return !!document.getElementById('ctr-waiting')")); i++) await sleep(250)
			await b.guest.press('Escape')
			await until(b.guest, 'Bee out of the room', s => s.role === 'none', 10_000)
		}
		const hostDrive = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, Date.now() + 300_000)
		if (!hostDrive.finished) throw new Error('the host did not finish')
		const want = leave ? 2 : 3
		const back = await untilGame(host, `the next select with ${want}`, g => g.charSelect?.players === want, 120_000)
			.catch(async e => { throw new Error(`${e.message} : ${JSON.stringify(await sel(host))} || ${rows.join(' | ')}`) })
		on = false
		await loop
		await sleep(1000)
		await shot(ctx, 'quit-others-select')
		// read again once on screen : the select's first frame moves the characters (the slot word)
		back.charSelect = (await game(host)).charSelect ?? back.charSelect
		const bee = await online(b.guest), ex = await online(x.guest)
		const moved = exSeen.filter(e => e.st >= ST.START_RACE && (e.d !== ex0.octr.DriverID || e.slot !== ex0.share.slot))
		rows.push(`next select : ${JSON.stringify(back.charSelect.characters)} ; Bee slot ${bee.share?.slot} room ${bee.room === room}, Ex slot ${ex.share?.slot}`)
		if (moved.length) throw new Error(`Ex moved mid-race : ${JSON.stringify(moved.slice(0, 3))} || ${rows.join(' | ')}`)
		if (leave) {
			// Ex now P2 with its own character
			if (ex.share?.slot !== 1 || back.charSelect.characters[1] !== locked.characters[2]) throw new Error(`the next select without Bee : ${rows.join(' | ')}`)
		} else if (ex.share?.slot !== 2 || bee.share?.slot !== 1 || back.charSelect.characters[1] !== locked.characters[1] || back.charSelect.characters[2] !== locked.characters[2]) throw new Error(`the next select : ${rows.join(' | ')}`)
		return rows.join(' | ')
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await b.guestBrowser.close()
		await x?.guestBrowser.close()
	}
}

async function selectGrow(ctx) {
	const origin = new URL(ctx.args.url).origin
	const { host, a } = await hostRoom(ctx)
	const b = await openGuestPage(ctx, origin, { name: 'Bee' })
	let x = null
	const rows = []
	const note = async label => {
		const c = await sel(host)
		rows.push(`${label} : ${c?.players}P ${JSON.stringify(c?.characters)} locked ${c?.locked}`)
		say(rows.at(-1))
		await shot(ctx, `select-${label.replace(/\W+/g, '-')}`)
		return c
	}
	const until3 = async (label, pred) => (await untilGame(host, label, g => !!g.charSelect && pred(g.charSelect), 30_000)).charSelect
	try {
		await boot(b.guest, a.link)
		await until(b.guest, 'Bee in the room', s => s.lobby.active && s.octr.CurrState === ST.GUEST_TRACK_WAIT && s.share?.state === 'connected', 90_000)
		// NETPLAY > VS > SINGLE RACE : the select opens with the room's 2
		await menuTo(ctx, 'NETPLAY', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		for (const key of ['c', 'c', 'c']) { await ctx.press(key); await ctx.frames(15) }
		await until3('the select with 2', c => c.players === 2)
		// P1 moves and locks, P2 moves and does not
		await ctx.press('ArrowRight'); await ctx.frames(10); await ctx.press('c'); await ctx.frames(10)
		await b.guest.press('ArrowLeft'); await sleep(600)
		const two = await note('2 players, P1 locked')
		if (!(two.locked & 1)) throw new Error('P1 did not lock')

		// a third arrives : 3 cursors, P1 and P2 unchanged
		x = await openGuestPage(ctx, origin, { name: 'Ex', cdp: ctx.args.guest2Cdp ?? null })
		await boot(x.guest, a.link)
		const three = await until3('the select grown to 3', c => c.players === 3)
		await sleep(500)
		await note('3 players')
		if (three.characters[0] !== two.characters[0] || three.characters[1] !== two.characters[1] || !(three.locked & 1) || three.locked & 4) throw new Error(`grown : ${JSON.stringify(three)} (was ${JSON.stringify(two)})`)
		await x.guest.press('ArrowRight'); await sleep(600)
		const xs = await until3('the select still at 3', c => c.players === 3)
		if (xs.characters[2] === three.characters[2]) say(`P3 did not move its cursor (its pad may not be through yet) : ${JSON.stringify(await game(host))}`)

		// P2 (Bee) leaves while P3 stays : P3 becomes P2 with its character
		await b.guest.navigate(`${origin}/preload-flag.js`)
		const shrunk = await until3('the select shrunk to 2', c => c.players === 2)
		await sleep(500)
		await note('Bee left, Ex is P2')
		if (shrunk.characters[0] !== xs.characters[0] || shrunk.characters[1] !== xs.characters[2] || !(shrunk.locked & 1)) throw new Error(`after Bee left : ${JSON.stringify(shrunk)} (was ${JSON.stringify(xs)})`)
		// Ex's pad now drives P2 : it locks, and everyone has : the track select
		for (let i = 0; i < 4 && (await sel(host))?.locked !== 3; i++) { await x.guest.press('c'); await sleep(800) }
		await untilGame(host, 'the track select after everyone locked', g => !g.charSelect, 15_000)
		await note('both locked, on to the tracks')
		return rows.join(' | ')
	} finally {
		await ctx.js('window.__ctrOnline.leave(); return true').catch(() => {})
		await b.guestBrowser.close()
		await x?.guestBrowser.close()
	}
}

/** The guest page's boot timeline, every 100 ms : which screen the player sees. */
const WATCH = `(() => {
	globalThis.__seen = []
	const at = performance.now()
	const tick = () => {
		const boot = document.getElementById('boot')
		const video = document.getElementById('online-lobby')
		const what = !boot ? 'none' : !boot.classList.contains('hidden') ? (document.getElementById('joining') ? 'joining' : document.getElementById('press-start') ? 'press' : 'boot') : video && !video.classList.contains('hidden') ? 'host' : 'game'
		if (__seen.at(-1)?.what !== what) __seen.push({ what, ms: Math.round(performance.now() - at) })
	}
	setInterval(tick, 100)
})()`

async function hostRoom(ctx) {
	const { relay, rk } = ctx.args
	const host = tabOf(ctx)
	await boot(host, `${new URL(ctx.args.url).origin}/index.html`)
	await ctx.js(`localStorage.setItem('ctr-online.points', 'relay')
		const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')) }
		set('online-relay', ${JSON.stringify(relay)}); set('online-rk', ${JSON.stringify(rk)})
		await window.__ctrOnline.host(); return true`)
	const a = await online(host)
	if (a.role !== 'host') throw new Error(`host : no room (${a.error})`)
	return { host, a }
}

/** The guest's page : its disc stored once (a full boot), then left on a same-origin file. */
async function guestReady(ctx, origin) {
	const page = await openGuestPage(ctx, origin)
	await boot(page.guest, `${origin}/index.html`)
	await page.guest.navigate(`${origin}/preload-flag.js`)
	await sleep(1000)
	await page.guest.gconn.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH })
	return page
}

async function linkSkip(ctx) {
	const origin = new URL(ctx.args.url).origin
	const { host, a } = await hostRoom(ctx)
	const { guestBrowser, guest } = await guestReady(ctx, origin)
	try {
		const t0 = Date.now()
		await guest.navigate(a.link)
		let joining = false
		let g
		for (;;) {
			g = await online(guest).catch(() => null)
			const seen = await guest.js('return globalThis.__seen ?? []').catch(() => [])
			joining ||= seen.some(x => x.what === 'joining')
			if (g?.lobby?.active && g.share?.state === 'connected' && seen.at(-1)?.what === 'host') break
			if (Date.now() - t0 > 120_000) throw new Error(`no host picture in 120 s : ${JSON.stringify(seen)} ; ${g?.octr?.CurrState}`)
			await sleep(250)
		}
		const ms = Date.now() - t0
		const seen = await guest.js('return globalThis.__seen')
		await guestShot(ctx, guest, 'link-skip-host-picture')
		const saw = seen.map(x => x.what)
		const lum = await brightness(guest, (m, p) => guest.gconn.send(m, p))
		await guest.js('window.__ctrOnline.leave(); return true')
		await ctx.js('window.__ctrOnline.leave(); return true')
		if (saw.includes('press')) throw new Error(`the press prompt showed : ${JSON.stringify(seen)}`)
		if (saw.includes('game')) throw new Error(`the guest's own game showed before the host's picture : ${JSON.stringify(seen)}`)
		if (!joining) throw new Error(`no « Joining the room… » : ${JSON.stringify(seen)}`)
		return `no press ; seen ${seen.map(x => `${x.what}@${x.ms}`).join(' → ')} ; the host's picture ${ms} ms after the link (brightness ${lum})`
	} finally {
		await guestBrowser.close()
	}
}

async function linkFail(ctx) {
	const origin = new URL(ctx.args.url).origin
	const { a } = await hostRoom(ctx)
	// the same link with another room id : the relay answers, nobody hosts it
	const link = a.link.replace(/room=[^&]+/, 'room=nobodyHere1')
	await ctx.js('window.__ctrOnline.leave(); return true')
	const { guestBrowser, guest } = await guestReady(ctx, origin)
	try {
		await guest.navigate(link)
		const t0 = Date.now()
		let state
		while ((state = await guest.js("return document.getElementById('joining')?.dataset.state ?? null").catch(() => null)) !== 'failed') {
			if (Date.now() - t0 > 90_000) throw new Error(`no failure on the joining screen in 90 s (state ${state})`)
			await sleep(500)
		}
		const reason = await guest.js("return document.getElementById('joining-reason')?.textContent")
		await guestShot(ctx, guest, 'link-fail')
		const at = await guest.js(`const e = document.getElementById('join-back'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }`)
		for (const type of ['mousePressed', 'mouseReleased']) await guest.gconn.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
		await sleep(1500)
		const after = await guest.js("return { boot: !document.getElementById('boot').classList.contains('hidden'), hash: location.hash, role: window.__ctrOnline?.state().role }")
		const g = await untilGame(guest, 'the guest\'s own title', s => s.screen === 'menu', 60_000)
		await guestShot(ctx, guest, 'link-fail-back')
		if (after.boot || after.hash || after.role !== 'none') throw new Error(`after Back : ${JSON.stringify(after)}`)
		return `failed after ${Date.now() - t0} ms : « ${reason} » ; Back : ${JSON.stringify(after)}, the game on ${g.menu?.label ?? g.screen}`
	} finally {
		await guestBrowser.close()
	}
}
