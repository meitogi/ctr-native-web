// Player suite : Settings › Dev's « Second window » (session 17) — a race alone, one click. On the
// page served by `wtf ctr dev` (Vite, the page's sources, the debug game), with the disc in this
// browser, from the main menu :
//   SECOND-VS    « Second window » → Online VS : a real second window opens (one
//                browser, two windows : session 20's SHARE-ONE-MACHINE), joins the room by itself
//                as « Bot » with its Bot switch on ; the button stops there (« ready ») and the
//                suite has this window walk its own menus to the race (ctrDev.walk)
//                (ONLINE → VS → character → track) ; then this window's Bot switch too,
//                and the whole race is driven by both, filmed side by side ; afterwards the
//                player's own name and « Who plays » are untouched (the bot's settings live in memory)
//   SECOND-SHARE the same with Share : the second window is Share's guest page, P2 on this game's
//                own VS. → 2 players ; the race finished by both karts of this game
//   SECOND-BATTLE Online Battle : to the arena's start (the countdown), both games in it
//   SECOND-ARCADE Netplay Arcade : to the countdown, both games in it (the host's bots on the grid)
//
// RUN (the DoD)
//   Serve : web/dev.sh dev                                  (8090, the page's sources)
//   Relay : (cd relay && RELAY_KEY=<key> PORT=8788 node relay.js)
//   Play  : bash plans/ctr-native-web/tools/play.sh second-window <session> 8090 -- \
//             --set relay=ws://localhost:8788 --set rk=<key>
// Not a node --test file.

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { capture } from '/opt/devcontainer/base/skills/visual-loop/scripts/cdp.mjs'
import { makePlayer, pageScript } from '/opt/devcontainer/base/skills/visual-loop/lib/player.mjs'
import { HEARTBEAT_MS, PLAYER, bootToMenu, recordWithSound, say } from './ctr.mjs'
import { runDirOf, shot } from './online.suite.mjs'
import { D } from '../../ui/src/dev/strings.js'

export const meta = {
	url: 'http://localhost:8090/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const RACE_MS = 420_000

/** Polls `fn` (async) until it returns something ; a heartbeat every 10 s ; `dead()` ends early. */
async function waitFor(label, fn, timeout, dead = () => null) {
	const start = Date.now()
	let beat = start + HEARTBEAT_MS
	for (;;) {
		const v = await fn().catch(() => null)
		if (v) return v
		const why = await dead()
		if (why) throw new Error(`${label} : ${why}`)
		if (Date.now() - start > timeout) throw new Error(`no ${label} after ${Math.round(timeout / 1000)} s`)
		if (Date.now() >= beat) { say(`still waiting for ${label} (${Math.round((Date.now() - start) / 1000)} s)`); beat += HEARTBEAT_MS }
		await sleep(500)
	}
}

const pageUrl = ctx => {
	const u = new URL(ctx.args.url ?? meta.url) // play.sh's port : the dev page may run on another
	if (ctx.args.relay) u.searchParams.set('relay', ctx.args.relay)
	if (ctx.args.rk) u.searchParams.set('rk', ctx.args.rk)
	return u.href
}

/** This window's game on its main menu (the disc stored once per origin), Settings › Dev open. */
async function mainMenu(ctx) {
	const url = pageUrl(ctx)
	await ctx.conn.send('Page.navigate', { url }, ctx.sid)
	const screen = () => ctx.js('return document.getElementById("press-start") ? "ready" : document.getElementById("drop-zone") && !document.getElementById("boot-status").textContent ? "drop" : ""')
	const s = await waitFor('the boot screen', screen, 60_000)
	if (s === 'drop') {
		say('storing the disc in this browser (605 MB, once per origin)')
		await ctx.js(`void window.__ctrTestHandleFileFromUrl(location.origin + '/ctr-u.bin'); return true`)
	}
	await bootToMenu(ctx)
	await ctx.js('document.getElementById("ctr-gear").click(); return true')
	await waitFor('Settings', () => ctx.js('const t = document.querySelector(\'#ctr-settings [data-tab="dev"]\'); t?.click(); return !!t'), 10_000)
	await waitFor('the second window buttons (a debug page)', () => ctx.js('return !!document.querySelector("#ctr-second [data-second]")'), 10_000)
}

/** A real click (a user gesture : window.open is allowed) on the element `selector`. */
async function click(ctx, selector) {
	// in view first : the boot screen scrolls when the window is short
	const r = await ctx.js(`const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); await new Promise(r => requestAnimationFrame(r)); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }`)
	for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
		await ctx.conn.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, ctx.sid)
	}
}

/**
 * The window Settings › Dev opened (named ctr-second) once it is on the room link, attached. The agent
 * browser's proxy forgets a session mid-run (« session is not one of this page », LOG 14) : every
 * command goes through `conn`, which attaches again (online.suite.mjs's guest does the same).
 */
async function secondWindow(ctx, mode) {
	const target = await waitFor(`the second window on its room link (dev=${mode})`, async () => {
		const { targetInfos } = await ctx.conn.send('Target.getTargets')
		return targetInfos.find(t => t.type === 'page' && t.url.includes(`dev=${mode}`))
	}, 120_000, () => failed(ctx))
	const s = { sid: null, reattached: 0 }
	const attach = () => waitFor('the second window attached', async () => {
		s.sid = (await ctx.conn.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId
		await ctx.conn.send('Page.enable', {}, s.sid)
		await ctx.conn.send('Runtime.enable', {}, s.sid)
		return true
	}, 20_000)
	await attach()
	const conn = {
		on: (...a) => ctx.conn.on(...a),
		send: async (method, params) => {
			try {
				return await ctx.conn.send(method, params, s.sid)
			} catch (e) {
				if (!/session is not one of this page|No session with given id/.test(e.message) || s.reattached >= 10) throw e
				s.reattached++
				await attach()
				return ctx.conn.send(method, params, s.sid)
			}
		},
	}
	const js = expression => ctx.evaluate(conn, null, `(async () => { ${expression} })()`)
	// the player harness's in-page recorder, for the film (the page is already loaded)
	await js(`${pageScript(PLAYER)}; return true`).catch(() => {})
	return { targetId: target.targetId, conn, js, s, close: () => ctx.conn.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {}) }
}

/** Closes the windows a previous scenario left (window.open by name would reuse one). */
async function closeOthers(ctx) {
	const { targetInfos } = await ctx.conn.send('Target.getTargets')
	const mine = (await ctx.conn.send('Target.getTargetInfo', {}, ctx.sid).catch(() => null))?.targetInfo?.targetId
	for (const t of targetInfos) if (t.type === 'page' && t.targetId !== mine && t.url.includes('dev=')) await ctx.conn.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {})
}

const progress = ctx => ctx.js('return window.ctrDev?.status() ?? null').catch(() => null)
const failed = async ctx => { const p = await progress(ctx); return p?.error ? p.text : null }
const racing = s => s && (s.screen === 'countdown' || s.screen === 'race')
const kart = (js, i = null) => js(`const c = window.__ctr; if (!c) return null; const k = ${i === null ? 'c.kart' : `c.karts?.[${i}]`}; return { screen: c.screen, levelID: c.levelID, lap: k?.lap, finished: !!k?.finished, rank: k?.rank, numLaps: c.numLaps }`)

/** One mode of the second window, from the click to the race's end (`finish`) or its start. */
async function oneClick(ctx, mode, { finish }) {
	const settingsBefore = await ctx.js(`return { name: localStorage.getItem('ctr-online.name'), device: localStorage.getItem('ctr-ui.device') }`)
	await closeOthers(ctx)
	await mainMenu(ctx)
	say(`clicking « Second window » → ${mode}`)
	await click(ctx, `#ctr-second [data-second="${mode}"]`)
	const win = await secondWindow(ctx, mode)
	try {
		say(`second window : ${(await win.js('return location.href')).replace(/#.*/, '#…')}`)
		// Bot in the room, then this window's menus walked to the race (ctrDev.walk : the button
		// leaves them to the player)
		await waitFor('Bot in the room', async () => (await progress(ctx))?.text === D.secondSteps.ready, 180_000, () => failed(ctx))
		await ctx.js(`void window.ctrDev.walk(${JSON.stringify(mode)}); return true`)
		const race = await waitFor('the race (this window\'s menus walked by the page)', async () => {
			const s = await kart(ctx.js)
			return racing(s) ? s : null
		}, 300_000, () => failed(ctx))
		say(`race on level ${race.levelID} (${race.screen}) — progress line : ${(await progress(ctx))?.text}`)
		if (!finish) {
			const g = mode === 'share' ? null : await waitFor('the second window\'s game in the race', async () => { const s = await kart(win.js); return racing(s) ? s : null }, 120_000)
			return `${mode} : both games at ${race.screen}${g ? ` (second window : ${g.screen}, level ${g.levelID})` : ''}`
		}
		// the player's turn : this window's Bot switch too, so both karts drive themselves
		await ctx.js('window.ctrDev.bot(true); return true')
		const first = await shot(ctx, `${mode}-race-start`)
		const dir = runDirOf(ctx.args.proofs, first.file)
		const cur = { id: `SECOND-${mode.toUpperCase()}`, proofs: [] }
		const filmGuest = dir && mode !== 'share' // Share's guest page shows a <video> : the host's screen is the whole picture
		const gRec = filmGuest ? makePlayer({ conn: win.conn, sid: null, js: win.js, capture, dir, current: () => cur, pressFrames: PLAYER.pressFrames }) : null
		let result
		const theRace = async () => {
			result = await waitFor('both karts over the line', async () => {
				const h = await kart(ctx.js)
				const g = mode === 'share' ? await kart(ctx.js, 1) : await kart(win.js)
				return h?.finished && g?.finished ? { h, g } : null
			}, RACE_MS)
		}
		let hostVideo
		let lag = 0
		if (gRec) {
			let t0 = 0
			cur.video = await gRec.record('second-window', async () => {
				t0 = Date.now()
				hostVideo = await recordWithSound(ctx, 'first-window', async () => { lag = (Date.now() - t0) / 1000; await theRace() })
			})
		} else hostVideo = await recordWithSound(ctx, 'first-window', theRace)
		await shot(ctx, `${mode}-race-end`)
		let both = ''
		if (gRec && cur.video && hostVideo) {
			const out = join(dir, `99-second-${mode}-both-windows.mp4`)
			const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, hostVideo.file), '-ss', String(lag), '-i', join(dir, cur.video.file),
				'-filter_complex', '[0:v]scale=640:480,setsar=1[a];[1:v]scale=640:480,setsar=1[b];[a][b]hstack=inputs=2,fps=30[v]',
				'-map', '[v]', '-map', '0:a?', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-b:a', '192k', '-movflags', '+faststart', out])
			both = r.status === 0 ? ` · both windows : ${out}` : ` · side by side failed : ${r.stderr}`
			if (r.status !== 0) throw new Error(both)
		}
		const after = await ctx.js(`return { name: localStorage.getItem('ctr-online.name'), device: localStorage.getItem('ctr-ui.device') }`)
		if (JSON.stringify(after) !== JSON.stringify(settingsBefore)) throw new Error(`the bot window wrote the player's settings : ${JSON.stringify(settingsBefore)} → ${JSON.stringify(after)}`)
		return `${mode} : first window ${result.h.finished ? `finished, rank ${result.h.rank + 1}` : 'unfinished'} · second ${result.g.finished ? `finished, rank ${result.g.rank + 1}` : 'unfinished'} · the player's name / device untouched${both}`
	} catch (e) {
		const seen = await win.js(`const o = window.__ctrOnline?.state?.(); const g = window.__ctrShareGuest?.state?.()
			return { boot: document.getElementById('boot')?.className, status: document.getElementById('boot-status')?.textContent, game: window.__ctr?.screen ?? null,
				online: o && { role: o.role, share: o.share?.state, slot: o.share?.slot, error: o.error ?? o.lastError }, share: g && { state: g.state, slot: g.slot },
				log: (document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-6) }`).catch(err => `unreadable : ${err.message}`)
		throw new Error(`${e.message} · second window : ${JSON.stringify(seen)}`)
	} finally {
		await ctx.js('window.ctrDev?.bot(false); return true').catch(() => {})
		await win.close()
	}
}

export default async ctx => {
	await ctx.scenario('SECOND-VS', () => oneClick(ctx, 'vs', { finish: true }))
	await ctx.scenario('SECOND-SHARE', () => oneClick(ctx, 'share', { finish: true }))
	await ctx.scenario('SECOND-BATTLE', () => oneClick(ctx, 'battle', { finish: false }))
	await ctx.scenario('SECOND-ARCADE', () => oneClick(ctx, 'arcade', { finish: false }))
}
