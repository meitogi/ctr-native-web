// Player suite : frame rate on a RELEASE build, where window.__ctr does not
// exist (asserted). Two numbers per scene : the harness's fps() (rAF, the
// display) and the game's presents per second (draws into the default
// framebuffer, counted by a WebGL probe installed after load — session 2's
// method). Scenes : the main menu, then a Time Trial race reached blind with
// the same key path TT-MENU-PATH walks on a debug build (time-trial.suite.mjs).
// Without __ctr the waits use the game clock, the `[CTR Web] vblank=N` log
// lines ; the video shows which scene was measured.
//
// RUN
//   Build : web/build-web.sh release -DCTR_WEB_PRELOAD_DISC=ON
//   Serve : python3 web/test/player/serve.py build-web-release 8093
//           (no-store : the agent browser caches across runs ; port forwarded)
//   Play  : bash plans/ctr-native-web/tools/play.sh fps <session> 8093
//   Browser : the agent browser on the Mac (`agent-browser up`, headless, real
//   GPU ; never quote the Mesa sidecar's numbers).
// Not a node --test file : `node --test web/test/*.test.js` never loads it.

import { PLAYER, recordWithSound } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Counts rAF ticks in which the game drew to the default framebuffer.
const PROBE = `
	if (!globalThis.__ctrPresents) {
		const P = (globalThis.__ctrPresents = { drew: false, ticks: 0, presents: 0 })
		const G = WebGL2RenderingContext.prototype
		const bind = G.bindFramebuffer
		G.bindFramebuffer = function (target, fb) {
			if (target !== this.READ_FRAMEBUFFER) this.__ctrFb = fb
			return bind.call(this, target, fb)
		}
		for (const f of ['drawArrays', 'drawElements']) {
			const draw = G[f]
			G[f] = function (...a) {
				if (this.__ctrFb === null) P.drew = true
				return draw.apply(this, a)
			}
		}
		const tick = () => {
			P.ticks++
			if (P.drew) P.presents++
			P.drew = false
			requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	}
	return true`

// Main-thread stalls : gaps between rAF ticks over 100 ms (session 18's stall table).
const GAPS = `
	if (!globalThis.__ctrGaps) {
		const G = (globalThis.__ctrGaps = { list: [], last: performance.now() })
		const tick = t => {
			if (t - G.last > 100) G.list.push(Math.round(t - G.last))
			G.last = t
			requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	}
	return true`

// The game clock without __ctr : the last `[CTR Web] vblank=N` line (every
// 60 VBlanks, release builds too) in the page's #log.
const vblank = ctx =>
	ctx.js("const m = [...(document.getElementById('log')?.textContent ?? '').matchAll(/vblank=(\\d+)/g)].pop(); return m ? Number(m[1]) : 0")

async function waitVblank(ctx, n, timeout = 300_000) {
	const deadline = Date.now() + timeout
	let v = 0
	while ((v = await vblank(ctx)) < n) {
		if (Date.now() > deadline) {
			const log = await ctx.js("return (document.getElementById('log')?.textContent ?? '').trim().split('\\n').slice(-3).join(' | ')")
			throw new Error(`the game clock stayed at ${v} VBlanks (waiting for ${n}) ; page log : ${log}`)
		}
		await sleep(1000)
	}
	return v
}

// Main-thread busy time per second (the game's frame time at 30 fps : busy / 30),
// from a CDP CPU profile over the same window : every sample but « (idle) ».
async function busy(ctx, fn) {
	await ctx.conn.send('Profiler.enable', {}, ctx.sid)
	await ctx.conn.send('Profiler.setSamplingInterval', { interval: 1000 }, ctx.sid)
	await ctx.conn.send('Profiler.start', {}, ctx.sid)
	const r = await fn()
	const { profile } = await ctx.conn.send('Profiler.stop', {}, ctx.sid)
	let idle = 0
	for (const node of profile.nodes) if (node.callFrame.functionName === '(idle)') idle = node.id
	let total = 0
	let work = 0
	for (let i = 0; i < profile.samples.length; i++) {
		const dt = profile.timeDeltas[i + 1] ?? 0
		total += dt
		if (profile.samples[i] !== idle) work += dt
	}
	return { ...r, busy: Math.round((work / total) * 1000) }
}

async function measure(ctx, label, ms = 10_000) {
	return busy(ctx, async () => {
		const a = await ctx.js('return { ...globalThis.__ctrPresents, t: performance.now() }')
		const raf = await ctx.fps({ ms, label: `${label} (rAF)` })
		const b = await ctx.js('return { ...globalThis.__ctrPresents, t: performance.now() }')
		const s = (b.t - a.t) / 1000
		const presents = Math.round(((b.presents - a.presents) / s) * 10) / 10
		return { raf, presents }
	})
}

export default async ctx => {
	await ctx.scenario('FPS-RELEASE-MENU', async () => {
		if (await ctx.js('return globalThis.__ctr !== undefined')) throw new Error('window.__ctr exists : not a release build')
		await ctx.js(PROBE)
		await ctx.js(GAPS)
		// No __ctr here. The intro reaches the main menu at ~2360 VBlanks on
		// a debug build (menu.suite.mjs, no skipping) ; Triangle then skips
		// the trophy's tail and does nothing on the main menu itself.
		await waitVblank(ctx, 2600)
		for (let i = 0; i < 8; i++) {
			await ctx.press('z')
			await sleep(500)
		}
		if (await ctx.js('return globalThis.__ctr !== undefined')) throw new Error('window.__ctr appeared in a release build')
		await ctx.shot('menu')
		const m = await measure(ctx, 'menu')
		if (!(m.presents >= 25)) throw new Error(`menu presents ${m.presents}/s`)
		return `menu : ${m.presents} presents/s · main thread busy ${m.busy} ms/s · rAF avg ${m.raf.avg} min ${m.raf.min} p95 ${m.raf.p95}`
	})

	await ctx.scenario('FPS-RELEASE-RACE', async () => {
		// Blind path : Down (Time Trial), then Cross through the screens.
		await ctx.js('globalThis.__ctrGaps.list.length = 0; return true')
		await ctx.press('ArrowDown')
		for (let i = 0; i < 4; i++) {
			await sleep(1200)
			await ctx.press('c')
		}
		// Load, fly-over and countdown : ~25 s on a debug build (TT-MENU-PATH).
		const v = await vblank(ctx)
		await waitVblank(ctx, v + 35 * 60)
		const gaps = await ctx.js('return globalThis.__ctrGaps.list')
		await ctx.shot('race')
		let m
		await recordWithSound(ctx, 'race', async () => {
			await ctx.hold('c')
			try {
				m = await measure(ctx, 'race')
			} finally {
				await ctx.release('c')
			}
		})
		await ctx.shot('race-after')
		if (!(m.presents >= 25)) throw new Error(`race presents ${m.presents}/s`)
		return `race : ${m.presents} presents/s · main thread busy ${m.busy} ms/s · rAF avg ${m.raf.avg} min ${m.raf.min} p95 ${m.raf.p95} · load : ${gaps.length} stalls > 100 ms, worst ${Math.max(0, ...gaps)} ms`
	})
}
