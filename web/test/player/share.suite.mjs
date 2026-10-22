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
//
// RUN
//   Build : web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=ON
//   Serve : python3 web/test/player/serve.py build-web-debug 8091
//   Relay : (cd relay && npm ci && RELAY_KEY=<key> PORT=8788 node relay.js)
//   Play  : bash plans/ctr-native-web/tools/play.sh share <session> 8091 -- \
//             --set relay=ws://localhost:8788 --set rk=<key> [--set out=<dir for the guest's proofs>]
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

/** Starts sharing from the panel, as a player would ; returns the guest link. */
export async function share(ctx) {
	const { relay, rk = '' } = ctx.args
	if (!relay) ctx.skip('no relay : --set relay=ws://localhost:8788 --set rk=<key> (a local ctr-relay, see RUN)')
	// guests start on « Who plays : Auto » (their key, one storage with this page : a run cut short
	// can leave another choice behind)
	await ctx.js("localStorage.removeItem('ctr-share.guest-device'); return true")
	const s = await ctx.js('return window.__ctrShare?.state()')
	if (s?.sharing) return s.link
	await ctx.js(`const set = (id, v) => { document.getElementById(id).value = v }
		set('share-relay', ${JSON.stringify(relay)}); set('share-rk', ${JSON.stringify(rk)})
		document.getElementById('share-start').click(); return true`)
	const link = await waitIn(ctx.js, 'the share link', "window.__ctrShare.state().link || null", 15_000)
	if (/[?&](key|rk)=/.test(link.split('#')[0])) throw new Error('a secret left the # part of the link')
	return link
}

/** A guest window (a background tab stops painting), with the player harness for its own pad. */
async function guestWindow(ctx, url) {
	const origin = new URL(ctx.args.url).origin
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
	await ctx.conn.send('Page.navigate', { url }, sid)
	await waitIn(js, 'the guest page', 'typeof window.__ctrShareGuest === "object"', 20_000)
	return { targetId, sid, js, player, close: () => ctx.conn.send('Target.closeTarget', { targetId }).catch(() => {}) }
}

/** Cells of two 32 × 24 grey thumbnails that differ by more than 24 levels. */
const changed = (a, b) => a.grey.reduce((n, v, i) => n + (Math.abs(v - b.grey[i]) > 24 ? 1 : 0), 0)

export default async ctx => {
	await ctx.scenario('SHARE-RELAY-REFUSED', async () => {
		await bootToMenu(ctx)
		const link = await share(ctx)
		const g = await guestWindow(ctx, link.replace('guest.html#', 'guest.html?mode=ws#'))
		try {
			const s = await waitIn(g.js, 'the refusal', "(() => { const s = window.__ctrShareGuest.state(); return s.state === 'refused' || s.state === 'closed' ? s : null })()", 30_000)
			if (s.state !== 'refused' || s.code !== 'online-mode' || !/Online mode/.test(s.message)) throw new Error(`guest : ${JSON.stringify(s)}`)
			await sleep(1000)
			const h = await ctx.js('return window.__ctrShare.state()')
			if (!h.refusals.some(r => r.code === 'online-mode' && r.path === 'relay')) throw new Error(`host refusals ${JSON.stringify(h.refusals)}`)
			if (h.guests.length) throw new Error(`host gave a slot : ${JSON.stringify(h.guests)}`)
			if (/remote pad slot=1 connected/.test(await hostLog(ctx))) throw new Error('P2 got plugged in for a relay guest')
			return `guest : « ${s.message} » · host refusals ${JSON.stringify(h.refusals)}`
		} finally {
			await g.close()
		}
	})

	await ctx.scenario('SHARE-2TAB', async () => {
		const out = ctx.args.out ? join(ctx.args.out, `share-${new Date().toISOString().replace(/[:.]/g, '-')}`) : null
		if (out) mkdirSync(out, { recursive: true })
		await until(ctx, 'the main menu', s => s.menu?.input, { timeout: 10_000 })
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
			await waitIn(ctx.js, 'P2 plugged in on the pad bus', "/remote pad slot=1 connected/.test(document.getElementById('log').textContent)", 10_000)
			// a real click : unmuted playback needs a user gesture
			const r = await g.js("const b = document.getElementById('overlay').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }")
			for (const type of ['mousePressed', 'mouseReleased']) await ctx.conn.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, g.sid)
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
			if (!(b.audioEnergy > a.audioEnergy)) throw new Error(`no sound energy on the guest (${a.audioEnergy} → ${b.audioEnergy})`)

			// P2's pad : the VS. menu offers 2 players only with pad 2 plugged in
			const path = await menuTo(ctx, 'VS.', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
			// VS. → race type (single race) → player count (2 players) : child boxes of the main
			// menu (__ctr.menu stays the main menu) ; the 2-player row is locked unless pad 2 is
			// plugged in (MM_ToggleRows_PlayerCount)
			for (let i = 0; i < 3; i++) {
				await ctx.press('c')
				await ctx.frames(15)
			}
			const select = await until(ctx, 'the character select (the 2-player row taken)', s => s.menu?.label !== 'VS.', { timeout: 8000 })
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
				await capture(ctx.conn, ctx.sid, { out: join(out, 'host.png') })
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
			await ctx.shot('host-character-select')
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
			const r = await g.js("const b = document.getElementById('overlay').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }")
			for (const type of ['mousePressed', 'mouseReleased']) await ctx.conn.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, g.sid)
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
		// one origin, one storage : the guest window reads the name written here, not the host's own
		await ctx.js("localStorage.setItem('ctr-online.name', 'Mad Coco'); return true")
		const toasts = () => ctx.js("return [...document.querySelectorAll('.toast')].map(t => t.innerText.replace(/\\s+/g, ' ')).join(' | ')")
		const g = await guestWindow(ctx, link)
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
}
