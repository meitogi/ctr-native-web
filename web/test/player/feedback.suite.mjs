// Player suite : what session 36 put on the page. The default relay, read where a player meets
// it — the home page's room code (the ui bundle), Settings › Multiplayer's Netplay and Couch
// fields (web/online/page.js, web/share/panel.js) — on a browser with nothing typed : today's
// address with no key, or the build's own (CTR_RELAY_URL / CTR_RELAY_KEY, preload-flag.js). And
// Settings › System's « Report a problem » : the bug form's link, filled from the page.
//
// RUN
//   Build : web/build-web.sh release -DCTR_WEB_PRELOAD_DISC=OFF -DCTR_ONLINE=ON (or debug), the
//           site assembled (web/pages/assemble.sh) ; for the fork's case with
//           CTR_RELAY_URL=ws://localhost:8788 CTR_RELAY_KEY=<key> in the environment
//   Serve : python3 web/test/player/serve.py <site or build dir> 8093
//   Relay : (cd relay && RELAY_KEY=<key> PORT=8788 node relay.js) — the fork's case looks a code up there
//   Play  : bash plans/ctr-native-web/tools/play.sh feedback <session> 8093 -- \
//             [--set relay=ws://localhost:8788 --set rk=<key>]   (the build's values ; none : today's)
// Not a node --test file.

import { joinFromHome, page, said } from './home-code.suite.mjs'
import { say } from './ctr.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: { gamepad: true, pressFrames: 8 } }

const BUILT_IN = 'wss://ctr.public.suuuper.app'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const tabOf = ctx => ({ name: 'page', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: url => ctx.conn.send('Page.navigate', { url }, ctx.sid) })

/**
 * The index page on this origin with nothing typed : no relay, no key, no code in progress (the
 * disc stays). A load can stall with nothing on screen (home-code.suite.mjs home) : another load.
 */
async function blank(tab, origin, ready) {
	for (let attempt = 1; ; attempt++) {
		await tab.navigate(`${origin}/preload-flag.js`)
		await sleep(attempt === 1 ? 800 : 1500)
		await tab.js(`for (const k of ['ctr-online.relay', 'ctr-online.rk', 'ctr-share.relay', 'ctr-share.rk', 'ctr-ui.joinCode']) localStorage.removeItem(k)
			localStorage.setItem('ctr-online.points', 'relay'); return true`)
		await tab.navigate(`${origin}/index.html`)
		try {
			return await page(tab, 'the home page', ready, 20_000)
		} catch (e) {
			if (attempt === 3) throw e
			say('the home page did not come, loading it again')
		}
	}
}

async function homeDefault(ctx, want) {
	const tab = tabOf(ctx)
	const origin = new URL(ctx.args.url).origin
	await blank(tab, origin, "!!document.getElementById('or-join')")
	const mod = await tab.js("const m = await import('./net/relay-default.js'); return { relay: m.DEFAULT_RELAY, rk: m.DEFAULT_RELAY_KEY, built: [window.__CTR_RELAY ?? null, window.__CTR_RELAY_KEY ?? null] }")
	if (mod.relay !== want.relay || mod.rk !== want.rk) throw new Error(`net/relay-default.js in this page : ${JSON.stringify(mod)}, expected ${JSON.stringify(want)}`)
	await joinFromHome(tab, [0, 1, 2])
	if (!want.rk) {
		// no key anywhere : none is asked for — the public relay answers the look itself (no such
		// room, or offline from a network that cannot reach it), on the dials, with no key card
		const line = await page(tab, 'the dials\' answer', "document.getElementById('join-nokey') ? 'card' : document.getElementById('join-said')?.textContent.trim()", 20_000)
		if (line === 'card') throw new Error('the public relay asked for a key')
		return `preload-flag.js names ${JSON.stringify(mod.built)} ; DEFAULT_RELAY ${mod.relay}, no key ; the home page looked the code up there with none : ${line}`
	}
	// the build's relay and key : the code is looked up there with no question asked
	await said(tab, 'NO SUCH ROOM')
	return `preload-flag.js names ${JSON.stringify(mod.built)} ; the home page looked the code up on ${want.relay} with the built-in key : NO SUCH ROOM`
}

async function panelsDefault(ctx, want) {
	const tab = tabOf(ctx)
	const origin = new URL(ctx.args.url).origin
	// a debug or a release build alike (no window.__ctr) : the stored disc's press, or the test disc
	const screen = await blank(tab, origin, "document.getElementById('press-start') ? 'ready' : document.getElementById('drop-zone') && !document.getElementById('boot-status').textContent ? 'drop' : ''")
	if (screen === 'drop') await tab.js("void window.__ctrTestHandleFileFromUrl(location.origin + '/ctr-u.bin'); return true")
	else await tab.press('Enter')
	const fields = await page(tab, 'the Netplay and Couch panels', `(() => {
		const v = (id) => document.getElementById(id)?.value
		return v('online-relay') !== undefined && v('share-relay') !== undefined && { online: [v('online-relay'), v('online-rk')], share: [v('share-relay'), v('share-rk')] }
	})()`, 60_000)
	for (const k of ['online', 'share']) {
		if (fields[k][0] !== want.relay || fields[k][1] !== want.rk) throw new Error(`Settings › Multiplayer › ${k} : ${JSON.stringify(fields[k])}, expected ${JSON.stringify([want.relay, want.rk])}`)
	}
	return `Netplay ${fields.online[0]} key ${fields.online[1] ? 'set' : 'empty'} · Couch ${fields.share[0]} key ${fields.share[1] ? 'set' : 'empty'}`
}

async function reportLink(ctx) {
	const tab = tabOf(ctx)
	// the game running from panelsDefault : Settings › System
	for (let n = 0; n < 3 && !(await tab.js("return !!document.querySelector('aside .tabs')")); n++) {
		await tab.press('Escape')
		await sleep(1000)
	}
	await page(tab, 'Settings', "!!document.querySelector('aside .tabs')", 10_000)
	await tab.js("[...document.querySelectorAll('aside .tabs button')].find((b) => b.textContent.trim() === 'System').click(); return true")
	await page(tab, 'the report link', "!!document.getElementById('ctr-report')", 5000)
	const got = await tab.js(`const a = document.getElementById('ctr-report'); a.focus()
		const s = window.__ctrOnline?.state?.()
		return { href: a.href, text: a.textContent.trim(), target: a.target, version: window.__CTR_VERSION ?? 'dev', ua: navigator.userAgent, online: s ? { role: s.role, room: s.room } : null, sharing: window.__ctrShare?.state?.().sharing }`)
	const url = new URL(got.href)
	const q = Object.fromEntries(url.searchParams)
	const expect = { template: 'bug.yml', version: got.version, mode: 'Solo', lang: 'en' }
	for (const k in expect) if (q[k] !== expect[k]) throw new Error(`${k} = ${q[k]}, expected ${expect[k]} (${got.href})`)
	if (url.origin + url.pathname !== 'https://github.com/meitogi/ctr-native-web/issues/new') throw new Error(`the link goes to ${url.origin}${url.pathname}`)
	if (!/^Chrome \d+ · /.test(q.browser ?? '')) throw new Error(`browser = ${q.browser} (${got.ua})`)
	if ('state' in q) throw new Error('a state in the link : the page has none to give yet')
	if (got.target !== '_blank' || got.text !== 'Report a problem') throw new Error(`the link : ${got.text} → ${got.target}`)
	// the mode reads these two (Settings.svelte report()) : they must still be there, by these names
	if (!got.online || !('role' in got.online) || !('room' in got.online) || typeof got.sharing !== 'boolean') throw new Error(`__ctrOnline / __ctrShare state : ${JSON.stringify(got)}`)
	return `${got.href}`
}

export default async ctx => {
	const want = { relay: ctx.args.relay ?? BUILT_IN, rk: ctx.args.rk ?? '' }
	await ctx.scenario('HOME-DEFAULT', () => homeDefault(ctx, want))
	await ctx.scenario('PANELS-DEFAULT', () => panelsDefault(ctx, want))
	await ctx.scenario('REPORT-LINK', () => reportLink(ctx))
}
