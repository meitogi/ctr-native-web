// Player suite : frame rate on a RELEASE build, where window.__ctr does not
// exist (asserted). Two numbers per scene : the harness's fps() (rAF, the
// display) and the game's presents per second (draws into the default
// framebuffer, counted by a WebGL probe installed after load — session 2's
// method). Scenes : the main menu, then a Time Trial race reached blind with
// the same key path TT-MENU-PATH walks on a debug build (time-trial.suite.mjs).
//
// RUN
//   Build : web/build-web.sh release -DCTR_WEB_PRELOAD_DISC=ON
//   Serve : web/serve.sh release 8093  (port forwarded to the host)
//   Play  : bash plans/ctr-native-web/tools/play.sh fps <session> 8093
//   Host browser : plans/ctr-native-web/tools/ctr-browser.sh on the Mac (real
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

async function measure(ctx, label, ms = 10_000) {
	const a = await ctx.js('return { ...globalThis.__ctrPresents, t: performance.now() }')
	const raf = await ctx.fps({ ms, label: `${label} (rAF)` })
	const b = await ctx.js('return { ...globalThis.__ctrPresents, t: performance.now() }')
	const s = (b.t - a.t) / 1000
	const presents = Math.round(((b.presents - a.presents) / s) * 10) / 10
	return { raf, presents }
}

export default async ctx => {
	await ctx.scenario('FPS-RELEASE-MENU', async () => {
		if (await ctx.js('return globalThis.__ctr !== undefined')) throw new Error('window.__ctr exists : not a release build')
		await ctx.js(PROBE)
		// No __ctr here : the intro plays into the main menu ~45 s after boot.
		await sleep(70_000)
		if (await ctx.js('return globalThis.__ctr !== undefined')) throw new Error('window.__ctr appeared in a release build')
		await ctx.shot('menu')
		const m = await measure(ctx, 'menu')
		if (!(m.presents >= 25)) throw new Error(`menu presents ${m.presents}/s`)
		return `menu : ${m.presents} presents/s · rAF avg ${m.raf.avg} min ${m.raf.min} p95 ${m.raf.p95}`
	})

	await ctx.scenario('FPS-RELEASE-RACE', async () => {
		// Blind path : Down (Time Trial), then Cross through the screens.
		await ctx.press('ArrowDown')
		for (let i = 0; i < 4; i++) {
			await sleep(1200)
			await ctx.press('c')
		}
		await sleep(30_000)
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
		return `race : ${m.presents} presents/s · rAF avg ${m.raf.avg} min ${m.raf.min} p95 ${m.raf.p95}`
	})
}
