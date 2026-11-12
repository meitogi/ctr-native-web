// Player suite : Share 2-tab. The suite's tab runs the game and shares it (web/share/panel.js) ;
// a second window opens the guest link (web/share/guest.html : a <video>, no disc, no game).
//   SHARE-RELAY-REFUSED : a guest forced onto the relay's WebSocket path (?mode=ws) is refused
//     with the Online-mode message, and takes no player slot (Share is P2P only).
//   SHARE-2TAB : a direct WebRTC guest sees and hears the game (~30 fps, at the PS1 width) and
//     its keyboard and virtual gamepad drive P2 : the VS. menu's 2-player row opens, the host's
//     pad bus logs slot 1's buttons, the guest's stream shows P2's cursor move. Latency measured.
//   SHARE-GUEST-HUD : the guest page has the site's interface — the speaker drives the <video>'s
//     volume, the gear opens Settings with Players / Controls / System, the name field holds ours.
//   SHARE-NAMES : the guest's name reaches the host (its state, Settings › Multiplayer's list, a
//     toast on join and on leave), the host's name and the list reach the guest.
//   SHARE-ONE-MACHINE : one controller seen by both windows drives one player once the host is on
//     « Keyboard » and the guest on « Gamepad » (the user's « ça boucle », 2026-10-22).
//   SHARE-RELOAD : the guest reloads its page : the slot it gets back (recorded), the stream again,
//     no slot left behind on the host.
//   SHARE-FULL : three guests are P2, P3, P4 (the game pulls slots 1–3) ; a fourth is refused `full`
//     and given no slot.
//
// Release builds (as published : no window.__ctr) : the game is waited for on its `vblank=` log
// lines, the scenarios assert what the Share pages report — the VS. menu walk of SHARE-2TAB and
// SHARE-ONE-MACHINE (debug log lines) are the debug run's.
// --set guestOrigin=https://ctr.suuuper.app : the guests open the guest page of that site (the
// published one), the same link after `#` ; the host stays on this build (the agent browser cannot
// drop a disc into another origin's storage).
//
// RUN
//   Build : web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=ON
//   Serve : python3 web/test/player/serve.py build-web-debug 8091
//   Relay : (cd relay && npm ci && RELAY_KEY=<key> PORT=8788 node relay.js)
//   Play  : bash plans/ctr-native-web/tools/play.sh share <session> 8091 -- \
//             --set relay=ws://localhost:8788 --set rk=<key> [--set out=<dir for the guest's proofs>]
//   Release, as published : web/build-web.sh release (OFF, then ON) → web/pages/assemble.sh … site,
//     python3 web/test/player/serve.py site 8091 (the disc in the agent browser's OPFS for :8091).
//   Published guests : … --set relay=wss://ctr-relay.suuuper.app --set rk=<key> \
//     --set guestOrigin=https://ctr.suuuper.app (that origin in AGENT_BROWSER_ORIGINS, the relay and
//     stun.l.google.com in AGENT_BROWSER_REACH).
//   Both ports in AGENT_BROWSER_ORIGINS and forwarded ; P2P between two windows of the agent
//   browser needs AGENT_BROWSER_REACH=*.local (WebRTC's mDNS host candidates), else SHARE-2TAB skips.
// Not a node --test file : `node --test web/test/*.test.js` never loads it.
//
// State : window.__ctrShare.state() / .stats() (host, web/share/panel.js),
// window.__ctrShareGuest.state() / .stats() / .grab() / rec*() (guest, web/share/guest-page.js),
// window.__ctr (game, debug builds).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { capture } from '/opt/devcontainer/base/skills/visual-loop/scripts/cdp.mjs'
import { makePlayer, pageScript } from '/opt/devcontainer/base/skills/visual-loop/lib/player.mjs'
import { PLAYER, bootToMenu, menuTo, state, until } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8091/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const RIGHT = 0xffdf // the PSX pad word with Right held (active low)

/** Polls `expr` in a tab until it returns something truthy. */
async function waitIn(js, label, expr, timeout = 30_000, every = 250) {
	const deadline = Date.now() + timeout
	let last
	while (Date.now() < deadline) {
		last = await js(`return ${expr}`).catch(e => ({ error: e.message }))
		if (last && !last.error) return last
		await sleep(every)
	}
	throw new Error(`timed out after ${Math.round(timeout / 1000)}s waiting for ${label} (last ${JSON.stringify(last)})`)
}

const hostLog = ctx => ctx.js("return document.getElementById('log')?.textContent ?? ''")

/** True once boot() found a release build (no window.__ctr) ; null before. */
let release = null

/**
 * Boots the game : a debug build to the main menu (bootToMenu) ; a release build (no window.__ctr :
 * its ctr_native.js carries no debug bridge) until its game clock runs (`vblank=` lines) — Share
 * streams whatever is on screen. The build is read from the page's own script, not guessed from
 * timing : __ctr only appears once the game has its globals, seconds after the clock starts.
 */
async function boot(ctx) {
	release = !(await ctx.js("const r = await fetch('ctr_native.js', { cache: 'no-store' }); return (await r.text()).includes('globalThis.__ctr = ')"))
	if (!release) return bootToMenu(ctx)
	const vblank = () => ctx.js("const m = [...(document.getElementById('log')?.textContent ?? '').matchAll(/vblank=(\\d+)/g)].pop(); return m ? Number(m[1]) : 0")
	// the wasm over the forwarded port sometimes stalls with nothing logged (LOG ## T3) : reload, 3 tries
	for (let attempt = 1; attempt <= 3; attempt++) {
		const deadline = Date.now() + 120_000
		while (Date.now() < deadline) {
			if (await ctx.js("return !!document.getElementById('press-start')").catch(() => false)) await ctx.press('Enter')
			else if ((await vblank()) >= 300) return null
			await sleep(1000)
		}
		if (attempt < 3) await ctx.reload()
	}
	throw new Error(`no game after 3 × 2 min : ${(await hostLog(ctx)).trim().split('\n').slice(-3).join(' | ')}`)
}

/** The guest link as the guests open it : on --set guestOrigin's site when given. */
function guestLink(ctx, link) {
	const at = ctx.args.guestOrigin
	if (!at) return link
	const u = new URL(link)
	return `${at.replace(/\/$/, '')}/share/guest.html${u.search}${u.hash}`
}

/** Waits for a guest window's link : connected with both tracks, or refused / closed. */
const settled = js => waitIn(js, 'the guest connected or refused', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'refused' || s.state === 'closed' || (s.state === 'connected' && s.tracks.length === 2) ? s : null })()", 40_000)

/**
 * Starts Couch as a player does ; returns the guest link. In the Netplay build that is the game's
 * own menus (session 29) : VS > SINGLE > the character select, the pad's Select, INVITE closed —
 * the host is left on that select. A build without Netplay has the panel's button.
 */
export async function share(ctx) {
	const { relay, rk = '' } = ctx.args
	if (!relay) ctx.skip('no relay : --set relay=ws://localhost:8788 --set rk=<key> (a local ctr-relay, see RUN)')
	// guests start on « Who plays : Auto » (their key, one storage with this page : a run cut short
	// can leave another choice behind)
	await ctx.js("localStorage.removeItem('ctr-share.guest-device'); return true")
	const s = await ctx.js('return window.__ctrShare?.state()')
	if (s?.sharing) return s.link
	const game = () => ctx.js('if (!window.__ctr) return null; const { track, ...g } = window.__ctr; return g')
	const until = async (label, done, timeout = 30_000) => {
		for (const end = Date.now() + timeout; Date.now() < end; await new Promise(r => setTimeout(r, 200))) {
			const g = await game()
			if (g && done(g)) return g
		}
		const g = await game()
		throw new Error(`Couch from the game : ${label} never came (${g?.screen}, ${g?.menu?.label}, ${g?.sub?.title}/${g?.sub?.label}, netplay ${JSON.stringify(g?.netplay)})`)
	}
	const press = async (key, label, done) => {
		for (let i = 0; i < 6; i++) {
			await ctx.press(key)
			const g = await until(label, done, 1500).catch(() => null)
			if (g) return g
		}
		return until(label, done, 100)
	}
	if (!(await game())?.netplay) {
		await ctx.js(`const set = (id, v) => { document.getElementById(id).value = v }
			set('share-relay', ${JSON.stringify(relay)}); set('share-rk', ${JSON.stringify(rk)})
			document.getElementById('share-start').click(); return true`)
	} else {
		// one relay, one key : the Netplay settings'
		await ctx.js(`for (const [id, v] of [['online-relay', ${JSON.stringify(relay)}], ['online-rk', ${JSON.stringify(rk)}]]) {
			const e = document.getElementById(id); if (e && e.value !== v) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })) } } return true`)
		if (!(await game()).charSelect) {
			await menuTo(ctx, 'VS.', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
			await press('c', 'VS\'s race type', g => g.sub?.title === 'RACE TYPE')
			await press('c', 'the character select', g => !!g.charSelect)
			await new Promise(r => setTimeout(r, 1500))
		}
		// Select opens the room ; INVITE comes by itself
		await ctx.press(' ')
		await until('INVITE, by itself', g => g.netplay.screen === 'invite' && g.netplay.share)
		await press('c', 'INVITE closed by BACK', g => g.netplay.screen === 'none')
	}
	const link = await waitIn(ctx.js, 'the share link', "window.__ctrShare.state().link || null", 15_000)
	if (/[?&](key|rk)=/.test(link.split('#')[0])) throw new Error('a secret left the # part of the link')
	return link
}

/** A guest window (a background tab stops painting), with the player harness for its own pad. */
/** `before` : a script run on the guest's origin before the guest page loads (its storage). */
async function guestWindow(ctx, url, { before } = {}) {
	url = guestLink(ctx, url)
	const origin = new URL(url).origin
	// a small same-origin file first : the agent browser's proxy refuses about:blank
	const { targetId } = await ctx.conn.send('Target.createTarget', { url: `${origin}/preload-flag.js`, newWindow: true })
	await sleep(500)
	await ctx.conn.send('Target.getTargets') // the proxy learns the new target from a listing
	const { sessionId: sid } = await ctx.conn.send('Target.attachToTarget', { targetId, flatten: true })
	await ctx.conn.send('Page.enable', {}, sid)
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript(PLAYER) }, sid)
	// what went wrong in the page, for a failure message (a module that did not load, a throw)
	await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: "window.__guestErrors = []; addEventListener('error', e => __guestErrors.push(e.message || `load ${e.target?.src || e.target?.href}`), true); addEventListener('unhandledrejection', e => __guestErrors.push(String(e.reason)))" }, sid)
	const js = expression => ctx.evaluate(ctx.conn, sid, `(async () => { ${expression} })()`)
	const player = makePlayer({ conn: ctx.conn, sid, js, capture, dir: '', current: () => ({ id: 'guest', proofs: [] }), pressFrames: PLAYER.pressFrames })
	if (before) await js(before)
	await ctx.conn.send('Page.navigate', { url }, sid)
	await waitIn(js, 'the guest page', 'typeof window.__ctrShareGuest === "object"', 20_000)
	return { targetId, sid, js, player, url, close: () => ctx.conn.send('Target.closeTarget', { targetId }).catch(() => {}) }
}

/**
 * The host's page as a PNG. The harness's default capture of this WebGL page is flat grey on the
 * headless agent browser (LOG ## T3, ## 6) ; `fromSurface` reads the compositor's surface.
 */
async function hostShot(ctx, file) {
	const { data } = await ctx.conn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, ctx.sid)
	writeFileSync(file, Buffer.from(data, 'base64'))
}

/**
 * SHARE-2TAB's end on a release build : no menu walk (no window.__ctr), the guest's keyboard and
 * virtual pad read by the game as P2's word (readPads, `__ctrShare.state().pads`), the latency pair,
 * what the guest receives recorded with --set out.
 */
async function releaseTwoTab(ctx, g, gs, b, fps) {
	await g.player.hold('ArrowRight')
	await waitIn(ctx.js, "P2's Right on the host", `window.__ctrShare.state().pads[1]?.buttons === ${RIGHT}`, 3000, 20)
	const sent = await g.js('return window.__ctrShareGuest.state().lastChange')
	const got = (await ctx.js('return window.__ctrShare.state().pads'))[1]
	await g.player.release('ArrowRight')
	await waitIn(ctx.js, "P2's Right released", 'window.__ctrShare.state().pads[1]?.buttons === 0xffff', 3000, 50)
	await g.player.pad(0).connect()
	await g.player.pad(0).hold('right')
	await waitIn(ctx.js, "P2's Right from the guest's gamepad", `window.__ctrShare.state().pads[1]?.buttons === ${RIGHT}`, 3000, 20)
	await g.player.pad(0).release('right')
	await waitIn(ctx.js, "P2's pad released", 'window.__ctrShare.state().pads[1]?.buttons === 0xffff', 3000, 50)
	await g.player.pad(0).disconnect()
	const hs = (await ctx.js('return await window.__ctrShare.stats()'))[0]
	const lat = { inputMs: Math.round(got.at - sent.at), rttMs: b.rttMs, jitterBufferMs: b.jitterBufferMs && Math.round(b.jitterBufferMs),
		decodeMs: b.decodeMsPerFrame && Math.round(b.decodeMsPerFrame * 10) / 10, encodeMs: hs?.encodeMsPerFrame && Math.round(hs.encodeMsPerFrame * 10) / 10 }
	let recorded = null
	if (ctx.args.out) {
		const out = join(ctx.args.out, `share-release-${new Date().toISOString().replace(/[:.]/g, '-')}`)
		mkdirSync(out, { recursive: true })
		const f = await g.js('return await window.__ctrShareGuest.grab()')
		if (f) writeFileSync(join(out, 'guest-frame.png'), Buffer.from(f.png, 'base64'))
		await hostShot(ctx, join(out, 'host.png'))
		await g.js('window.__ctrShareGuest.recStart(); return true')
		await sleep(6000)
		const webm = Buffer.from(await g.js('return await window.__ctrShareGuest.recStop()'), 'base64')
		writeFileSync(join(out, 'guest-stream.webm'), webm)
		writeFileSync(join(out, 'latency.json'), `${JSON.stringify({ lat, guest: b, host: hs, guestPage: new URL(g.url).origin }, null, 2)}\n`)
		recorded = webm.length
	}
	return `release host · guest page ${new URL(g.url).origin} · ${gs.path} · P${gs.slot + 1} · video ${b.frameWidth}×${b.frameHeight} ${fps} fps (${hs?.codec} ${hs?.encoder} → ${b.decoder}) · sound energy ${b.audioEnergy.toFixed(3)} · P2's word from the keyboard and the pad read by the game · latency ${JSON.stringify(lat)}${recorded ? ` · guest video ${recorded} B` : ''}`
}

/**
 * The click that starts the sound, a real one (a JS click is no user gesture) : on the interface's
 * overlay, or — the page without its interface (ui/guest.js not loaded yet, or not at all) — on the
 * page itself, which then listens to any click.
 */
async function clickForSound(ctx, g) {
	const at = await waitIn(g.js, 'somewhere to click for sound', "(() => { const o = document.getElementById('overlay'); const b = (o?.classList.contains('clickable') ? o : document.querySelector('video') ?? document.body).getBoundingClientRect(); return o?.classList.contains('clickable') || window.__ctrShareGuest.state().ui === false ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null })()", 5000).catch(() => null)
	if (!at) throw new Error(`no « click for sound » on the guest : ${JSON.stringify(await g.js("return { ui: window.__ctrShareGuest.state().ui, overlay: document.getElementById('overlay')?.className ?? null, text: document.getElementById('overlay-text')?.textContent ?? null, errors: window.__guestErrors }"))}`)
	for (const type of ['mousePressed', 'mouseReleased']) await ctx.conn.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 }, g.sid)
}

/** Cells of two 32 × 24 grey thumbnails that differ by more than 24 levels. */
const changed = (a, b) => a.grey.reduce((n, v, i) => n + (Math.abs(v - b.grey[i]) > 24 ? 1 : 0), 0)

export default async ctx => {
	await ctx.scenario('SHARE-RELAY-REFUSED', async () => {
		await boot(ctx)
		const link = await share(ctx)
		const g = await guestWindow(ctx, link.replace('guest.html#', 'guest.html?mode=ws#'))
		try {
			const s = await waitIn(g.js, 'the refusal', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'refused' || s.state === 'closed' ? s : null })()", 30_000)
			if (s.state !== 'refused' || s.code !== 'online-mode' || !/Netplay/.test(s.message)) throw new Error(`guest : ${JSON.stringify(s)}`)
			await sleep(1000)
			const h = await ctx.js('return window.__ctrShare.state()')
			if (!h.refusals.some(r => r.code === 'online-mode' && r.path === 'relay')) throw new Error(`host refusals ${JSON.stringify(h.refusals)}`)
			if (h.guests.length) throw new Error(`host gave a slot : ${JSON.stringify(h.guests)}`)
			if (/remote pad slot=1 connected/.test(await hostLog(ctx))) throw new Error('P2 got plugged in for a relay guest')
			return `${release ? 'release' : 'debug'} host · guest page ${new URL(g.url).origin} · guest : « ${s.message} » · host refusals ${JSON.stringify(h.refusals)}`
		} finally {
			await g.close()
		}
	})

	await ctx.scenario('SHARE-2TAB', async () => {
		const out = ctx.args.out ? join(ctx.args.out, `share-${new Date().toISOString().replace(/[:.]/g, '-')}`) : null
		if (out && !release) mkdirSync(out, { recursive: true }) // a release run files its own (releaseTwoTab)
		// the main menu, or the character select an earlier scenario left Couch on (the Netplay build)
		if (!release) await until(ctx, 'the main menu, or the select Couch is on', s => s.menu?.input || s.charSelect, { timeout: 10_000 })
		const link = await share(ctx)
		const g = await guestWindow(ctx, link)
		try {
			const gs = await waitIn(g.js, 'the guest connected or refused', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'refused' || s.state === 'closed' || (s.state === 'connected' && s.tracks.length === 2) ? s : null })()", 40_000)
			if (gs.state !== 'connected') {
				if (gs.code === 'online-mode') ctx.skip(`no direct WebRTC path between the two windows (${gs.message}) — the agent browser needs AGENT_BROWSER_REACH=*.local`)
				throw new Error(`guest : ${JSON.stringify(gs)}`)
			}
			if (gs.slot !== 1 || !/^direct-/.test(gs.path)) throw new Error(`guest slot ${gs.slot} path ${gs.path}`)
			await waitIn(ctx.js, 'the stream to the guest', "window.__ctrShare.state().guests[0]?.state === 'streaming'", 15_000)
			// the game pulls slot 1 (readPads' mask) ; debug builds also log it on the pad bus
			await waitIn(ctx.js, 'P2 read by the game', 'window.__ctrShare.state().pads[1] != null', 10_000)
			if (!release) await waitIn(ctx.js, 'P2 plugged in on the pad bus', "/remote pad slot=1 connected/.test(document.getElementById('log').textContent)", 10_000)
			// a real click : unmuted playback needs a user gesture
			await clickForSound(ctx, g)
			const vis = [await ctx.js('return document.visibilityState'), await g.js('return document.visibilityState')]
			if (vis.join() !== 'visible,visible') throw new Error(`a window is not painting : ${vis.join(' / ')}`)

			// Video and sound on the guest. WebRTC's bandwidth estimate starts low : the encoder
			// scales down first, then up to the PS1 width within seconds.
			const hostCap = (await ctx.js('return window.__ctrShare.state()')).capture
			const wantW = Math.round(hostCap.canvas[0] / hostCap.scale)
			await waitIn(g.js, 'the full PS1 width', `(async () => { const s = await window.__ctrShareGuest.stats(); return s.frameWidth === ${wantW} ? s : null })()`, 20_000).catch(() => null)
			const a = await g.js('return await window.__ctrShareGuest.stats()')
			await sleep(3000)
			const b = await g.js('return await window.__ctrShareGuest.stats()')
			const fps = Math.round(((b.framesDecoded - a.framesDecoded) / 3) * 10) / 10
			const host = (await ctx.js('return window.__ctrShare.state()')).capture
			const want = [Math.round(host.canvas[0] / host.scale), Math.round(host.canvas[1] / host.scale)]
			if (b.frameWidth !== want[0] || b.frameHeight !== want[1]) throw new Error(`guest video ${b.frameWidth} × ${b.frameHeight}, wanted ${want.join(' × ')} (PS1 display ${host.display})`)
			if (fps < 25) throw new Error(`guest decodes ${fps} fps`)
			if (!(b.audioEnergy > a.audioEnergy)) {
				const hostAudio = await ctx.js("const a = globalThis.ctrAudio; return { state: a?.context?.state, node: !!a?.node, ticks: a?.stats?.ticks, capture: window.__ctrShare.state().capture?.audio, err: document.querySelector('#share-panel, .share')?.textContent?.slice(0, 200) ?? null }")
				throw new Error(`no sound energy on the guest (${a.audioEnergy} → ${b.audioEnergy}) · guest ${JSON.stringify({ bytes: b.audioBytes, level: b.audioLevel })} · host ${JSON.stringify(hostAudio)}`)
			}
			if (release) return await releaseTwoTab(ctx, g, gs, b, fps)

			// P2's pad : the VS. menu offers 2 players only with pad 2 plugged in
			// The Netplay build started Couch on VS's character select (share()) : the guest is a
			// player there at once. A build without Netplay : VS. → race type (single race) → player
			// count (2 players), child boxes of the main menu (__ctr.menu stays the main menu) ; the
			// 2-player row is locked unless pad 2 is plugged in (MM_ToggleRows_PlayerCount)
			let path = ['VS.']
			if (!(await state(ctx)).charSelect) {
				path = await menuTo(ctx, 'VS.', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
				for (let i = 0; i < 3; i++) {
					await ctx.press('c')
					await ctx.frames(15)
				}
			}
			const select = await until(ctx, 'the character select, the guest in it', s => s.charSelect ? s.charSelect.players === 2 : s.menu?.label !== 'VS.', { timeout: 8000 })
			await sleep(1500)

			// The guest moves P2's cursor : keyboard Right, then the virtual pad's d-pad
			const f0 = await g.js('return await window.__ctrShareGuest.grab()')
			await sleep(600)
			const f1 = await g.js('return await window.__ctrShareGuest.grab()')
			await g.player.hold('ArrowRight')
			await waitIn(ctx.js, "P2's Right on the host", `window.__ctrShare.state().pads[1]?.buttons === ${RIGHT}`, 3000, 20)
			const sent = await g.js('return window.__ctrShareGuest.state().lastChange')
			const gotRight = (await ctx.js('return window.__ctrShare.state().pads'))[1]
			if (sent.buttons !== RIGHT || gotRight.buttons !== RIGHT) throw new Error(`latency pair ${JSON.stringify({ sent, gotRight })}`)
			await sleep(300)
			await g.player.release('ArrowRight')
			await sleep(900)
			const f2 = await g.js('return await window.__ctrShareGuest.grab()')
			const log = await hostLog(ctx)
			if (!log.includes(`remote pad slot=1 buttons=0x${RIGHT.toString(16)}`)) throw new Error('no « remote pad slot=1 buttons=0xffdf » line on the host')
			const idle = changed(f0, f1)
			const moved = changed(f1, f2)
			await g.player.pad(0).connect()
			await g.player.pad(0).hold('right')
			await waitIn(ctx.js, "P2's Right from the guest's gamepad", `window.__ctrShare.state().pads[1]?.buttons === ${RIGHT}`, 3000, 20)
			await sleep(300)
			await g.player.pad(0).release('right')
			await waitIn(ctx.js, "P2's pad released", 'window.__ctrShare.state().pads[1]?.buttons === 0xffff', 3000, 50)
			await sleep(900)
			const f3 = await g.js('return await window.__ctrShareGuest.grab()')

			// Latency : input (guest sends → the game reads P2's new word, one clock : same machine)
			// and video (frame capture → display on the guest, rVFC captureTime), plus the parts.
			const input = Math.round(gotRight.at - sent.at)
			const hs = (await ctx.js('return await window.__ctrShare.stats()'))[0]
			const gst = await g.js('return window.__ctrShareGuest.state()')
			const lat = {
				inputMs: input,
				displayDelayMs: gst.displayDelayMs != null ? Math.round(gst.displayDelayMs) : null,
				rttMs: b.rttMs, jitterBufferMs: b.jitterBufferMs && Math.round(b.jitterBufferMs), decodeMs: b.decodeMsPerFrame && Math.round(b.decodeMsPerFrame * 10) / 10,
				encodeMs: hs?.encodeMsPerFrame && Math.round(hs.encodeMsPerFrame * 10) / 10,
			}

			let recorded = null
			if (out) {
				for (const [name, f] of [['guest-menu', f0], ['guest-p2-right', f2], ['guest-p2-pad', f3]]) writeFileSync(join(out, `${name}.png`), Buffer.from(f.png, 'base64'))
				await hostShot(ctx, join(out, 'host.png'))
				// what the guest receives, sound included, while P2 moves left and right
				await g.js('window.__ctrShareGuest.recStart(); return true')
				for (let i = 0; i < 4; i++) {
					await g.player.pad(0).press(i % 2 ? 'right' : 'left', { frames: 10 })
					await sleep(1500)
				}
				const webm = Buffer.from(await g.js('return await window.__ctrShareGuest.recStop()'), 'base64')
				writeFileSync(join(out, 'guest-stream.webm'), webm)
				writeFileSync(join(out, 'latency.json'), `${JSON.stringify({ lat, guest: b, host: hs, guestState: gst }, null, 2)}\n`)
				recorded = webm.length
			}
			// back to the main menu for the next run
			await g.player.pad(0).disconnect()
			return `${gs.path} · P${gs.slot + 1} · video ${b.frameWidth}×${b.frameHeight} ${fps} fps (${hs?.codec} ${hs?.encoder} → ${b.decoder}) · sound energy +${(b.audioEnergy - a.audioEnergy).toFixed(3)} · menu ${path.join(' → ')} → single race → 2 players → ${JSON.stringify(select.menu?.label ?? null)} (${select.screen}, ${select.mode.join('|')}) · P2 Right : ${moved} cells changed (idle ${idle}) · latency ${JSON.stringify(lat)}${recorded ? ` · guest video ${recorded} B` : ''}`
		} finally {
			await g.close()
		}
	})

	await ctx.scenario('SHARE-ONE-MACHINE', async () => {
		// Host and guest in two windows of one machine (the user's try-out, 2026-10-22 : « pour pas
		// que ça boucle ») : one physical pad reaches both pages, so it drove P1 on the host and P2
		// through the guest at once. Each page's « Who plays » (Settings › Players) splits them : the
		// host on the keyboard, the guest on the gamepad — one press, one player.
		if (release) ctx.skip('reads the debug pad-bus log (pad0 buttons=…) : the debug run covers it')
		const link = await share(ctx)
		const setDevice = mode => `globalThis.ctrUI?.settings?.patch?.({ device: { mode: ${JSON.stringify(mode)}, pad: null } }); return true`
		await ctx.js(setDevice('keyboard'))
		const g = await guestWindow(ctx, link)
		try {
			const gs = await waitIn(g.js, 'the guest connected or refused', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'refused' || s.state === 'closed' || s.state === 'connected' ? s : null })()", 40_000)
			if (gs.state !== 'connected') {
				if (gs.code === 'online-mode') ctx.skip(`no direct WebRTC path between the two windows (${gs.message})`)
				throw new Error(`guest : ${JSON.stringify(gs)}`)
			}
			await g.js(setDevice('gamepad'))
			await ctx.pad(0).connect()
			await g.player.pad(0).connect()
			await sleep(800)
			const from = (await hostLog(ctx)).length
			// the same pad on both pages, as the OS delivers one controller to every window
			await Promise.all([ctx.pad(0).hold('right'), g.player.pad(0).hold('right')])
			await waitIn(ctx.js, "P2's Right from the guest's gamepad", `window.__ctrShare.state().pads[1]?.buttons === ${RIGHT}`, 3000, 20)
			await sleep(400)
			const both = (await hostLog(ctx)).slice(from).includes(`pad0 buttons=0x${RIGHT.toString(16)}`)
			await Promise.all([ctx.pad(0).release('right'), g.player.pad(0).release('right')])
			await sleep(300)
			await ctx.pad(0).disconnect()
			await g.player.pad(0).disconnect()
			if (both) throw new Error('one pad press drove P1 on the host and P2 through the guest : the loop')
			return 'host « keyboard », guest « gamepad » : the pad press reached P2 only'
		} finally {
			// both pages back to Auto : one storage, and the guest's key outlives its window
			await ctx.js(setDevice('auto'))
			await g.js(setDevice('auto')).catch(() => {})
			await g.close()
		}
	})

	await ctx.scenario('SHARE-GUEST-HUD', async () => {
		const link = await share(ctx)
		const g = await guestWindow(ctx, link)
		try {
			const gs = await waitIn(g.js, 'the guest connected', "(() => { const s = window.__ctrShareGuest.state(); return s.state !== 'connecting' && s.state !== 'idle' && (s.state !== 'connected' || s.tracks.length === 2) ? s : null })()", 40_000)
			if (gs.state !== 'connected') {
				if (gs.code === 'online-mode') ctx.skip(`no direct WebRTC path between the two windows (${gs.message})`)
				throw new Error(`guest : ${JSON.stringify(gs)}`)
			}
			if (!gs.ui) {
				const why = await g.js("const u = new URL('../ui/guest.js', location.href); const r = await fetch(u).catch(e => ({ status: String(e) })); return { url: u.href, status: r.status, errors: window.__guestErrors ?? null }")
				throw new Error(`the guest page has no interface (ui/guest.js not loaded) : ${JSON.stringify(why)}`)
			}
			const hud = await g.js("return { sound: !!document.getElementById('ctr-sound'), gear: !!document.getElementById('ctr-gear'), overlay: document.getElementById('overlay-text')?.textContent ?? null, status: document.getElementById('ctr-guest-status')?.textContent ?? null }")
			if (!hud.sound || !hud.gear) throw new Error(`HUD ${JSON.stringify(hud)}`)
			// the click that starts the sound, a real one
			await clickForSound(ctx, g)
			await waitIn(g.js, 'the video unmuted', "!window.__ctrShareGuest.state().muted", 5000)
			// the volume of the site's speaker is the video's
			await g.js('globalThis.ctrUI.settings.patch({ volume: 0.25, muted: false }); return true')
			const vol = await waitIn(g.js, 'video.volume 0.25', 'Math.abs(window.__ctrShareGuest.state().volume - 0.25) < 0.01 ? window.__ctrShareGuest.state().volume : null', 3000)
			await g.js('globalThis.ctrUI.settings.patch({ muted: true }); return true')
			await waitIn(g.js, 'muted from the speaker', 'window.__ctrShareGuest.state().muted', 3000)
			await g.js('globalThis.ctrUI.settings.patch({ muted: false, volume: 0.001 }); return true') // silent agent browser
			const shoot = async name => {
				if (!ctx.args.out) return
				mkdirSync(ctx.args.out, { recursive: true })
				// fromSurface : the headless agent browser's default capture is flat grey (LOG ## 12)
				const { data } = await ctx.conn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, g.sid)
				writeFileSync(join(ctx.args.out, `${name}.png`), Buffer.from(data, 'base64'))
			}
			await g.js("window.dispatchEvent(new PointerEvent('pointermove')); return true") // the HUD wakes
			await shoot('guest-hud')
			// the gear : Settings with the guest's three tabs
			const gear = await g.js("const b = document.getElementById('ctr-gear').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }")
			for (const type of ['mousePressed', 'mouseReleased']) await ctx.conn.send('Input.dispatchMouseEvent', { type, x: gear.x, y: gear.y, button: 'left', clickCount: 1 }, g.sid)
			const panel = await waitIn(g.js, 'Settings open', "document.getElementById('ctr-settings') ? { tabs: [...document.querySelectorAll('#ctr-settings [data-tab]')].map(t => t.dataset.tab), name: document.getElementById('ctr-name')?.value, room: [...document.querySelectorAll('#ctr-room-players li')].map(l => l.innerText.replace(/\\s+/g, ' ')), who: !!document.getElementById('ctr-device-auto') } : null", 5000)
			if (panel.tabs.join() !== 'players,controls,system') throw new Error(`guest tabs ${panel.tabs.join()}`)
			if (!panel.name || !panel.who || panel.room.length < 2) throw new Error(`Players tab ${JSON.stringify(panel)}`)
			await sleep(600) // the sidebar's slide-in
			await shoot('guest-settings')
			await g.js("document.querySelector('#ctr-settings .x').click(); return true")
			return `HUD ${JSON.stringify(hud)} · volume ${vol} · Settings ${JSON.stringify(panel)}`
		} finally {
			await g.close()
		}
	})

	await ctx.scenario('SHARE-NAMES', async () => {
		const link = await share(ctx)
		await ctx.js("globalThis.ctrUI.settings.patch({ name: 'Turbo Roo' }); return true")
		const toasts = () => ctx.js("return [...document.querySelectorAll('.toast')].map(t => t.innerText.replace(/\\s+/g, ' ')).join(' | ')")
		// the guest's name in its own origin's storage (the host's too when both pages share one origin)
		const g = await guestWindow(ctx, link, { before: "localStorage.setItem('ctr-online.name', 'Mad Coco'); return true" })
		try {
			const gs = await waitIn(g.js, 'the guest connected', "(() => { const s = window.__ctrShareGuest.state(); return s.state !== 'connecting' && s.state !== 'idle' ? s : null })()", 40_000)
			if (gs.state !== 'connected') {
				if (gs.code === 'online-mode') ctx.skip(`no direct WebRTC path between the two windows (${gs.message})`)
				throw new Error(`guest : ${JSON.stringify(gs)}`)
			}
			const h = await waitIn(ctx.js, 'the guest\'s name on the host', "(() => { const s = window.__ctrShare.state(); return s.guests[0]?.name === 'Mad Coco' && s.guests[0].state === 'streaming' ? s : null })()", 10_000)
			if (h.hostName !== 'Turbo Roo') throw new Error(`host name ${h.hostName}`)
			const joined = await waitIn(ctx.js, 'the join toast', "[...document.querySelectorAll('.toast')].map(t => t.innerText).find(t => t.includes(globalThis.ctrUI.text.joined('Mad Coco', 2))) ?? null", 5000)
			const list = await ctx.js("return document.getElementById('share-status').textContent")
			if (!/P2 Mad Coco/.test(list)) throw new Error(`Share list : ${list}`)
			const gl = await waitIn(g.js, 'the list on the guest', "(() => { const s = window.__ctrShareGuest.state(); return s.host === 'Turbo Roo' && s.list.length === 2 ? s.list : null })()", 5000)
			if (gl[1].name !== 'Mad Coco') throw new Error(`guest list ${JSON.stringify(gl)}`)
			// a rename on the guest reaches the host at once
			await g.js("globalThis.ctrUI.settings.patch({ name: 'Sly Tiny' }); return true")
			await waitIn(ctx.js, 'the rename on the host', "window.__ctrShare.state().guests[0]?.name === 'Sly Tiny'", 5000)
			await g.close()
			const left = await waitIn(ctx.js, 'the leave toast', "[...document.querySelectorAll('.toast')].map(t => t.innerText).find(t => t.includes(globalThis.ctrUI.text.left('Sly Tiny', 2))) ?? null", 8000)
			return `host « Turbo Roo », guest « Mad Coco » → « Sly Tiny » · toasts « ${joined.replace(/\s+/g, ' ')} », « ${left.replace(/\s+/g, ' ')} » · guest list ${JSON.stringify(gl)} · ${await toasts()}`
		} finally {
			await g.close()
		}
	})

	await ctx.scenario('SHARE-RELOAD', async () => {
		// A guest reloads its page (a player pressing F5, a phone waking up) : a new link from the same
		// page. Recorded : the slot it gets back, how long until it streams again, what the host's
		// slots read in between ; asserted : streaming again, one guest on the host, no slot left over.
		const link = await share(ctx)
		const g = await guestWindow(ctx, link)
		try {
			const gs = await settled(g.js)
			if (gs.state !== 'connected') {
				if (gs.code === 'online-mode') ctx.skip(`no direct WebRTC path between the two windows (${gs.message})`)
				throw new Error(`guest : ${JSON.stringify(gs)}`)
			}
			await waitIn(ctx.js, 'the stream to the guest', "window.__ctrShare.state().guests[0]?.state === 'streaming'", 15_000)
			const before = gs.slot
			const t0 = Date.now()
			await ctx.conn.send('Page.reload', {}, g.sid)
			// the host's view, every 100 ms, until the reloaded page streams again
			const seen = []
			let after = null
			while (Date.now() - t0 < 30_000) {
				const h = await ctx.js('const s = window.__ctrShare.state(); return s.guests.map(x => `P${x.slot + 1}:${x.state}`).join(",") || "none"')
				if (seen[seen.length - 1]?.h !== h) seen.push({ ms: Date.now() - t0, h })
				after = await g.js("const s = window.__ctrShareGuest?.state(); return s && s.state === 'connected' && s.tracks.length === 2 ? s : null").catch(() => null)
				if (after && /streaming/.test(h) && !h.includes(',')) break
				await sleep(100)
			}
			if (!after) throw new Error(`the reloaded guest did not connect again in 30 s ; host ${JSON.stringify(seen)}`)
			const h = await waitIn(ctx.js, 'one guest streaming', "(() => { const s = window.__ctrShare.state(); return s.guests.length === 1 && s.guests[0].state === 'streaming' ? s : null })()", 10_000)
			const ms = Date.now() - t0
			const b = await waitIn(g.js, 'frames on the reloaded guest', '(async () => { const s = await window.__ctrShareGuest.stats(); return s?.framesDecoded > 30 ? s : null })()', 15_000)
			const game = release ? null : await state(ctx)
			return `P${before + 1} reloaded → back as P${after.slot + 1}${after.slot === before ? ' (its slot)' : ' (ANOTHER slot)'} · streaming again after ${ms} ms, ${b.frameWidth}×${b.frameHeight} · host slots over time ${seen.map(x => `${x.ms}ms ${x.h}`).join(' → ')} · host guests ${h.guests.length}${game ? ` · game ${game.screen}` : ''}`
		} finally {
			await g.close()
		}
	})

	await ctx.scenario('SHARE-FULL', async () => {
		// Three guests are P2, P3, P4 in order of arrival — the game pulls slots 1–3, so the multitap
		// bus is on — and a fourth is refused `full`, with no slot.
		const link = await share(ctx)
		const gs = []
		try {
			for (let i = 0; i < 3; i++) {
				const g = await guestWindow(ctx, link)
				gs.push(g)
				const s = await settled(g.js)
				if (s.state !== 'connected') {
					if (s.code === 'online-mode') ctx.skip(`no direct WebRTC path between the windows (${s.message})`)
					throw new Error(`guest ${i + 1} : ${JSON.stringify(s)}`)
				}
				if (s.slot !== i + 1) throw new Error(`guest ${i + 1} got slot ${s.slot}`)
			}
			const h = await waitIn(ctx.js, 'three guests streaming, slots 1–3 read by the game', "(() => { const s = window.__ctrShare.state(); return s.guests.length === 3 && s.guests.every(x => x.state === 'streaming') && s.pads[1] && s.pads[2] && s.pads[3] ? s : null })()", 20_000)
			const players = await waitIn(gs[2].js, 'PLAYERS 4 on the last guest', '(() => { const s = window.__ctrShareGuest.state(); return s.players === 4 ? s.players : null })()', 5000)
			const fourth = await guestWindow(ctx, link)
			gs.push(fourth)
			const r = await waitIn(fourth.js, 'the fourth guest refused', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'refused' || s.state === 'closed' || s.state === 'connected' ? s : null })()", 30_000)
			if (r.state !== 'refused' || r.code !== 'full') throw new Error(`fourth guest : ${JSON.stringify(r)}`)
			await sleep(1000)
			const h2 = await ctx.js('return window.__ctrShare.state()')
			if (h2.guests.length !== 3 || !h2.refusals.some(x => x.code === 'full')) throw new Error(`host after the fourth : ${JSON.stringify({ guests: h2.guests.map(x => x.slot), refusals: h2.refusals })}`)
			const fps = []
			for (const g of gs.slice(0, 3)) fps.push(Math.round((await g.js('return await window.__ctrShareGuest.stats()'))?.framesPerSecond ?? 0))
			return `slots ${h.guests.map(x => `P${x.slot + 1}`).sort().join(' ')} · the game pulls slots 1–3 · players ${players} on the guests · fourth : « ${r.message} » (${r.code}), host refusals ${JSON.stringify(h2.refusals.filter(x => x.code === 'full'))} · guests' fps ${fps.join(' / ')}`
		} finally {
			for (const g of gs) await g.close()
		}
	})
}
