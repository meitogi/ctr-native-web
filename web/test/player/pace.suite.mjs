// Player suite : the game's pacing, measured (session 18). Two scenarios on a
// DEBUG build (window.__ctr), disc from OPFS or preloaded :
//
// PACE-LOAD   boot → main menu → Time Trial → the first race, with a rAF-gap
//             probe : every main-thread stall over 100 ms, the screen it
//             happened on and the VBlank. The worst one is the first level load.
//             --set profile=1 : a CDP CPU profile (1 ms samples) of the same span,
//             saved as pace-load.cpuprofile under the proofs root (DevTools ›
//             Performance › Load profile), and the self time of the longest busy
//             stretch summed per function (wasm names from the -g2 name section).
// PACE-HIDDEN on the race's start line (music playing), the game clock with the
//             page visible, then hidden behind a new tab for 60 s, then visible
//             again : VBlanks/s per window (0–5, 5–10, 10–15, 15–60 s) and the
//             longest wall-clock gap between two game clock moves, sampled on
//             the audio clock (SDL's ScriptProcessorNode, which keeps running
//             hidden). A long gap is what the ear hears : the music sequencer
//             advances on VBlanks, so a 100 ms gap is a 100 ms lurch.
//
// RUN
//   Build : web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=OFF (disc stored in OPFS
//           by the ready suite) or =ON
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Play  : bash plans/ctr-native-web/tools/play.sh pace <session> 8093
//   Browser : the agent browser. It runs with --disable-background-timer-throttling
//   and --disable-backgrounding-occluded-windows : a hidden tab there pauses rAF but
//   keeps 4 ms timers, where a normal Chrome clamps them to 1 s (and 1 per minute
//   after 5 min) unless the page is audible. Say so beside the numbers.
// Not a node --test file : `node --test web/test/*.test.js` never loads it.

import { writeFileSync } from 'node:fs'
import { PLAYER, bootToMenu, brief, menuTo, say, state, until } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Main-thread stalls : gaps between rAF ticks over 100 ms, with the screen
// before and after (rAF pauses on a hidden page : only run it visible).
const GAP_PROBE = `
	if (!globalThis.__ctrGaps) {
		const G = (globalThis.__ctrGaps = { list: [], last: performance.now(), screen: null })
		const tick = t => {
			const screen = globalThis.__ctr?.screen ?? null
			const v = globalThis.__ctr?.vblank ?? 0
			if (t - G.last > 100) G.list.push({ ms: Math.round(t - G.last), from: G.screen, to: screen, vblank: v, at: Math.round(t) })
			G.last = t
			G.screen = screen
			requestAnimationFrame(tick)
		}
		requestAnimationFrame(tick)
	}
	return true`

// The game clock sampled on the audio clock : the longest wall time between
// two moves of __ctr.vblank. reset() starts a new window.
const CLOCK_PROBE = `
	const node = globalThis.Module?.SDL3?.audio_playback?.scriptProcessorNode
	if (!node) return false
	if (!globalThis.__ctrClock) {
		const C = (globalThis.__ctrClock = { v: -1, at: 0, maxGap: 0, events: 0 })
		C.reset = () => { C.maxGap = 0; C.events = 0; C.at = performance.now() }
		node.addEventListener('audioprocess', () => {
			const now = performance.now()
			const v = globalThis.__ctr?.vblank ?? -1
			C.events++
			if (v !== C.v) {
				if (C.v >= 0) C.maxGap = Math.max(C.maxGap, now - C.at)
				C.v = v
				C.at = now
			}
		})
	}
	return true`

const clock = async ctx => ctx.js('const C = globalThis.__ctrClock; return { vblank: globalThis.__ctr?.vblank ?? 0, maxGap: Math.round(C?.maxGap ?? -1), events: C?.events ?? 0, hidden: document.hidden, t: performance.now() }')
const resetClock = ctx => ctx.js('globalThis.__ctrClock?.reset(); return true')

/** VBlanks/s and the longest gap over the next `ms`. */
async function window_(ctx, ms) {
	await resetClock(ctx)
	const a = await clock(ctx)
	await sleep(ms)
	const b = await clock(ctx)
	const s = (b.t - a.t) / 1000
	return { rate: Math.round(((b.vblank - a.vblank) / s) * 10) / 10, maxGap: b.maxGap, audioEvents: Math.round(b.events / s), hidden: b.hidden }
}

/**
 * The longest stretch of consecutive busy samples (anything but « (idle) »,
 * native work included) and its self time per function, top `n`.
 */
function busiest(profile, n = 15) {
	const byId = {}
	for (const node of profile.nodes) byId[node.id] = node.callFrame.functionName || `(anonymous ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber})`
	const idle = id => byId[id] === '(idle)'
	let best = { from: 0, to: 0, ms: 0 }
	let from = -1
	let ms = 0
	for (let i = 0; i < profile.samples.length; i++) {
		const dt = (profile.timeDeltas[i + 1] ?? 0) / 1000
		if (idle(profile.samples[i])) {
			if (from >= 0 && ms > best.ms) best = { from, to: i, ms }
			from = -1
			ms = 0
		} else {
			if (from < 0) from = i
			ms += dt
		}
	}
	if (from >= 0 && ms > best.ms) best = { from, to: profile.samples.length, ms }
	const self = {}
	for (let i = best.from; i < best.to; i++) {
		const f = byId[profile.samples[i]]
		self[f] = (self[f] ?? 0) + (profile.timeDeltas[i + 1] ?? 0) / 1000
	}
	const top = []
	for (const f in self) top.push([f, Math.round(self[f])])
	top.sort((a, b) => b[1] - a[1])
	return { ms: Math.round(best.ms), top: top.slice(0, n) }
}

const show = w => `${w.rate} VBl/s, gap ≤ ${w.maxGap} ms, ${w.audioEvents} audio ev/s${w.hidden ? ' (hidden)' : ''}`

export default async ctx => {
	let onLine = false
	await ctx.scenario('PACE-LOAD', async () => {
		await ctx.js(GAP_PROBE)
		await bootToMenu(ctx)
		await menuTo(ctx, 'TIME TRIAL', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		await ctx.js('globalThis.__ctrGaps.list.length = 0; return true')
		const profile = ctx.args?.profile === '1'
		if (profile) {
			await ctx.conn.send('Profiler.enable', {}, ctx.sid)
			await ctx.conn.send('Profiler.setSamplingInterval', { interval: 1000 }, ctx.sid)
			await ctx.conn.send('Profiler.start', {}, ctx.sid)
		}
		for (let i = 0; i < 10; i++) {
			const s = await state(ctx)
			if (s.screen !== 'menu') break
			await ctx.press('c')
			await sleep(1200)
		}
		const s = await until(ctx, 'the countdown to end', n => n.screen === 'race' && n.kart != null, { timeout: 120_000, every: 250 })
		if (!s.mode.includes('TIME_TRIAL')) throw new Error(`not a Time Trial : ${brief(s)}`)
		onLine = true
		if (profile) {
			const { profile: p } = await ctx.conn.send('Profiler.stop', {}, ctx.sid)
			if (ctx.args.proofs) writeFileSync(`${ctx.args.proofs}/pace-load.cpuprofile`, JSON.stringify(p))
			const b = busiest(p)
			say(`longest busy stretch ${b.ms} ms, self time : ${b.top.map(([f, ms]) => `${f} ${ms}`).join(', ')}`)
		}
		const gaps = await ctx.js('return globalThis.__ctrGaps.list')
		const worst = gaps.reduce((w, g) => (g.ms > (w?.ms ?? 0) ? g : w), null)
		say(`stalls > 100 ms from the Time Trial row to the race : ${gaps.map(g => `${g.ms} ms (${g.from}→${g.to} @${g.vblank})`).join(', ') || 'none'}`)
		return `${gaps.length} stalls > 100 ms, worst ${worst ? `${worst.ms} ms (${worst.from}→${worst.to})` : '—'}`
	})

	await ctx.scenario('PACE-HIDDEN', async () => {
		if (!onLine) ctx.skip('PACE-LOAD did not reach the race')
		if (!(await ctx.js(CLOCK_PROBE))) ctx.skip('no SDL ScriptProcessorNode : no audio clock to sample on')
		const before = await window_(ctx, 5000)
		say(`visible : ${show(before)}`)
		// a tab in front on the same origin (the agent browser's proxy refuses about:blank)
		const origin = await ctx.js('return location.origin')
		const { targetId } = await ctx.conn.send('Target.createTarget', { url: `${origin}/preload-flag.js` })
		const rows = []
		try {
			await sleep(500)
			if (!(await ctx.js('return document.hidden'))) ctx.skip('a new tab in front did not hide the game tab in this browser')
			for (const ms of [5000, 5000, 5000, 45_000]) {
				const w = await window_(ctx, ms)
				rows.push(w)
				say(`hidden window ${rows.length} : ${show(w)}`)
			}
		} finally {
			await ctx.conn.send('Target.closeTarget', { targetId }).catch(() => {})
		}
		await sleep(2000)
		const after = await window_(ctx, 5000)
		say(`visible again : ${show(after)} · ${brief(await state(ctx))}`)
		if (after.hidden) throw new Error('the game tab is still hidden after closing the front tab')
		if (!(after.rate >= 50)) throw new Error(`visible again : ${after.rate} VBlanks/s`)
		return `visible ${before.rate} · hidden 0–5 / 5–10 / 10–15 / 15–60 s : ${rows.map(r => r.rate).join(' / ')} VBl/s, longest gap ${Math.max(...rows.map(r => r.maxGap))} ms · visible again ${after.rate}`
	})
}
