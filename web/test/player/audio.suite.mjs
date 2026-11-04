// Player suite : the audio output under load (session 21). Reads window.__ctr.audio
// (platform/web_debug_bridge.c) : output path, sample rate, block, latencies, the longest gap
// between two filled blocks (ScriptProcessor) or worklet ticks, late command batches (worklet),
// the mixer's time, the SPU traffic the game generates per second ; and meters the output
// signal itself (audio-meter.mjs) : dropouts, short stretches of exact silence amid the sound,
// what a late ScriptProcessor block plays. On SDL's ScriptProcessor (before session 21) the
// bridge also counts underruns from the node's playback times.
//
// The agent browser opens a 16 kHz context by default (no output device, 128 ms blocks) :
// the suite makes 48 kHz the default before the page loads, as on the user's Mac — the host
// agent browser then runs a real 48 kHz output (8 ms device ticks), so an underrun here is one
// a desktop Chrome would play. Sound stays muted (gain 0) : the counters need no speakers.
//
//   AUDIO-NO-GESTURE  first, before any key : a pad-only player (a Gamepad press is no user
//                 gesture, the AudioContext stays suspended) must still get past the boot
//                 (session 32 : the SCEA voice's end came from the worklet only). The browser may
//                 start the context anyway (Chrome's media engagement) : then a shim keeps it
//                 suspended and the boot is run again
//   AUDIO-OUTPUT  what the page opened
//   AUDIO-MENU    10 s of the main menu (music) : underruns, mixer ms/s, SPU traffic
//   AUDIO-RACE    a Time Trial race, 30 s with Cross held : the same
//   AUDIO-STALL   in the race, main-thread busy loops of 60 / 100 / 200 ms (__ctrStall, debug
//                 only), 3 each, 2 s apart : the underruns each one caused
//   AUDIO-SAVESTATE  F5, 3 s of race, F8 : the worklet takes the restored SPU state, mixes on
// The worklet path (`path: 'worklet'`) must meter no dropout ; the ScriptProcessor path is reported.
//
// RUN
//   Build : web/build-web.sh debug (disc in OPFS, stored once per origin) or -DCTR_WEB_PRELOAD_DISC=ON
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//   Play  : bash plans/ctr-native-web/tools/play.sh audio <session> 8093 [-- --set stalls=60,100,200]
// Not a node --test file.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installMeter, readMeter, resetMeter } from './audio-meter.mjs'
import { PLAYER, bootToMenu, brief, menuTo, say, state, until } from './ctr.mjs'
import { runDirOf, shot } from './online.suite.mjs'

export const meta = { url: 'http://localhost:8093/index.html', login: false, player: PLAYER }

const sleep = ms => new Promise(r => setTimeout(r, ms))
// ctr.mjs's until() reads __ctr and tests it synchronously : this one awaits `fn`
async function waitFor(label, fn, timeout) {
	for (const end = Date.now() + timeout; Date.now() < end; await sleep(500)) {
		const v = await fn()
		if (v) return v
	}
	throw new Error(`timed out after ${timeout / 1000} s waiting for ${label}`)
}
const ACCEL = 'c'

// Before any page script : contexts open at 48 kHz unless the page asks for a rate.
const RATE_48K = `(() => {
	const AC = globalThis.AudioContext
	if (!AC || AC.__ctr48) return
	const C = class extends AC { constructor(o) { super({ sampleRate: 48000, ...(o || {}) }) } }
	C.__ctr48 = true
	globalThis.AudioContext = C
})()`

// Before any page script : every context stays suspended, as with no gesture, whatever the
// browser's autoplay policy (removed after AUDIO-NO-GESTURE)
const NO_GESTURE = `(() => {
	const AC = globalThis.AudioContext
	if (!AC || AC.__ctrNoGesture) return
	const C = class extends AC {
		constructor(o) { super(o); super.suspend() }
		resume() { return Promise.reject(new DOMException('no gesture (test shim)', 'NotAllowedError')) }
	}
	C.__ctrNoGesture = true
	globalThis.AudioContext = C
})()`

const audio = ctx => ctx.js('const A = globalThis.__ctrAudio; if (!A) return null; const { node, reset, spuHistory, times, glitches, late, ...a } = A; return JSON.parse(JSON.stringify(a))')
const reset = ctx => Promise.all([ctx.js('globalThis.__ctrAudio?.reset?.(); return true'), resetMeter(ctx)])
const fmt = a =>
	`${a.path} ${a.sampleRate} Hz, block ${a.block} · ${a.blocks} blocks · meter ${a.meter?.dropouts} dropouts (${a.meter?.droppedMs} ms), ${a.meter?.repeats} repeats` +
	(a.underruns != null ? `, node ${a.underruns} underruns (${a.missedMs} ms missed)` : '') +
	`, longest gap ${a.longestGapMs} ms` +
	(a.lateBatches != null ? `, ${a.lateBatches} late batches (worst ${a.worstLateMs} ms)` : '') +
	` · main-thread mixer ${a.mixerMsPerSec ?? '?'} ms/s` +
	(a.workletMixerMsPerSec != null ? `, worklet mixer ${a.workletMixerMsPerSec} ms/s` : '')

// A command's trip to the output, the device's own outputLatency aside : the ScriptProcessor
// waits for the next block (half a block on average) then plays it one block later ; the worklet
// applies it bufferMs after its stamp, inside a 128-frame quantum, behind baseLatency.
const latencyMs = a =>
	a.path === 'worklet'
		? a.bufferMs + ((a.block / a.sampleRate) * 1000) / 2 + a.baseLatency * 1000
		: ((a.block / a.sampleRate) * 1000) * 1.5 + a.baseLatency * 1000

async function window(ctx, label, ms) {
	await reset(ctx)
	await sleep(ms)
	const a = await audio(ctx)
	if (a) a.meter = await readMeter(ctx)
	if (!a?.path) throw new Error(`${label} : no __ctr.audio output path (${JSON.stringify(a)})`)
	say(`${label} : ${fmt(a)} · SPU last second ${JSON.stringify(a.spu)}`)
	return a
}

export default async ctx => {
	let inRace = false
	let out = null
	const results = { windows: {} }

	await ctx.scenario('AUDIO-NO-GESTURE', async () => {
		await ctx.conn.send('Page.enable', {}, ctx.sid)
		const contextState = () => ctx.js('return globalThis.ctrAudio?.context?.state ?? null')
		// a reload is a new document : no sticky activation from the runs before
		const boot = async label => {
			await ctx.reload()
			const start = Date.now()
			await ctx.pad(0).connect()
			const s = await waitFor(`${label} : the game past its boot with no key nor click (window.__ctr)`, async () => {
				// a stored disc : the boot screen waits, the pad's Start starts the game
				if (await ctx.js("return !!document.getElementById('press-start')").catch(() => false)) await ctx.pad(0).press('start')
				return state(ctx)
			}, 60_000).catch(async e => {
				const log = await ctx.js("return document.getElementById('log')?.textContent ?? ''")
				throw new Error(`${e.message} · context ${await contextState()} · log ${log.trim().split('\n').slice(-2).join(' | ')}`)
			})
			return { s, ms: Date.now() - start, context: await contextState() }
		}
		let run = await boot('as the browser opens it')
		let how = `the browser's own context (${run.context})`
		if (run.context === 'running') {
			const { identifier } = await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: NO_GESTURE }, ctx.sid)
			run = await boot('the context held suspended')
			await ctx.conn.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, ctx.sid)
			how = `the browser started the context by itself : held suspended by the shim (${run.context})`
		}
		await ctx.pad(0).disconnect()
		await shot(ctx, 'no-gesture-past-boot')
		if (run.context !== 'suspended') throw new Error(`the context is ${run.context}, not suspended : nothing measured`)
		return `${how} · __ctr after ${(run.ms / 1000).toFixed(1)} s · ${brief(run.s)}`
	})

	await ctx.scenario('AUDIO-OUTPUT', async () => {
		await ctx.conn.send('Page.addScriptToEvaluateOnNewDocument', { source: RATE_48K }, ctx.sid)
		await ctx.reload()
		await bootToMenu(ctx)
		await waitFor('an audio output', () => audio(ctx).then(a => a?.path && a.blocks > 4), 20_000)
		out = await audio(ctx)
		await waitFor('the output meter', () => installMeter(ctx), 10_000)
		results.output = out
		results.latencyMs = Math.round(latencyMs(out) * 10) / 10
		return `${out.path} · ${out.sampleRate} Hz · block ${out.block} frames (${((out.block / out.sampleRate) * 1000).toFixed(1)} ms) · base ${(out.baseLatency * 1000).toFixed(1)} ms · output ${(out.outputLatency * 1000).toFixed(1)} ms${out.bufferMs != null ? ` · command buffer ${out.bufferMs} ms` : ''} · command → output ≈ ${results.latencyMs} ms + output`
	})

	await ctx.scenario('AUDIO-MENU', async () => {
		if (!out) ctx.skip('no audio output')
		const a = await window(ctx, 'menu', 10_000)
		results.windows.menu = a
		if (a.path === 'worklet' && (a.meter.dropouts || a.meter.repeats)) throw new Error(`menu : ${fmt(a)} : ${a.meter.list.join(' ')} ms`)
		return fmt(a)
	})

	await ctx.scenario('AUDIO-RACE', async () => {
		if (!out) ctx.skip('no audio output')
		const toTimeTrial = () => menuTo(ctx, 'TIME TRIAL', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		await toTimeTrial().catch(async e => {
			// bootToMenu's intro-skipping Cross can land as the menu wakes and open Adventure
			// (mode ADVENTURE_MODE) : Triangle backs out (ctr.mjs, bootToMenu)
			say(`${e.message} : ${brief(await state(ctx))} — Triangle, once more`)
			await ctx.js("document.getElementById('canvas')?.focus(); return true")
			for (let i = 0; i < 3 && (await state(ctx)).mode.includes('ADVENTURE_MODE'); i++) {
				await ctx.press('z')
				await sleep(1000)
			}
			await toTimeTrial()
		})
		for (let i = 0; i < 10; i++) {
			const s = await state(ctx)
			if (s.screen !== 'menu') break
			await ctx.press(ACCEL)
			await sleep(1200)
		}
		await until(ctx, 'the race', n => n.screen === 'race' && n.kart != null, { timeout: 120_000, every: 500 })
		inRace = true
		await ctx.hold(ACCEL)
		const a = await window(ctx, 'race', 30_000)
		results.windows.race = a
		results.shot = await shot(ctx, 'race')
		if (a.path === 'worklet' && (a.meter.dropouts || a.meter.repeats)) throw new Error(`race : ${fmt(a)} : ${a.meter.list.join(' ')} ms`)
		return `${fmt(a)} · ${brief(await state(ctx))}`
	})

	await ctx.scenario('AUDIO-STALL', async () => {
		if (!inRace) ctx.skip('no race')
		const stalls = (ctx.args?.stalls ?? '60,100,200').split(',').map(Number)
		const rows = []
		for (const ms of stalls) {
			await reset(ctx)
			for (let i = 0; i < 3; i++) {
				await ctx.js(`globalThis.__ctrStall = { ms: ${ms}, every: 0 }; return true`)
				await sleep(2000)
			}
			await ctx.js('globalThis.__ctrStall = null; return true')
			const a = await audio(ctx)
			a.meter = await readMeter(ctx)
			rows.push({ ms, ...a })
			say(`stall ${ms} ms ×3 : ${fmt(a)}`)
		}
		await ctx.release(ACCEL)
		results.stalls = rows
		const bad = rows.filter(r => r.path === 'worklet' && (r.meter.dropouts || r.meter.repeats))
		if (bad.length) throw new Error(bad.map(r => `${r.ms} ms : ${fmt(r)} : ${r.meter.list.join(' ')} ms`).join(' ; '))
		return rows
			.map(r => `${r.ms} ms ×3 → meter ${r.meter.dropouts} dropouts (${r.meter.droppedMs} ms), ${r.meter.repeats} repeats${r.underruns != null ? `, node ${r.underruns} underruns (${r.missedMs} ms)` : ''}, gap ${r.longestGapMs} ms${r.lateBatches != null ? `, ${r.lateBatches} late batches (worst ${r.worstLateMs} ms)` : ''}`)
			.join(' · ')
	})

	await ctx.scenario('AUDIO-SAVESTATE', async () => {
		if (!inRace) ctx.skip('no race')
		// F5 saves, F8 loads (platform/native_platform.c, CTR_INTERNAL) : the worklet's copy must
		// take the restored SPU state (NATIVE_AUDIO_OP_RESTORE) and go on mixing
		const log = () => ctx.js("return document.getElementById('log')?.textContent ?? ''")
		await ctx.press('F5')
		await waitFor('the saved state', async () => /saved quick state/.test(await log()), 10_000)
		await ctx.hold(ACCEL)
		await sleep(3000)
		await ctx.release(ACCEL)
		await reset(ctx)
		await ctx.press('F8')
		await waitFor('the loaded state', async () => /loaded quick state/.test(await log()), 10_000)
		await sleep(3000)
		const a = await audio(ctx)
		const restores = (await ctx.js('return globalThis.__ctrAudio?.spuTotal?.calls?.restore ?? 0')) + (a.spu?.calls?.restore ?? 0)
		if (!restores) throw new Error('no RESTORE command reached the worklet')
		if (!(a.blocks > 800)) throw new Error(`the worklet stopped after the load : ${fmt(a)}`)
		return `F5 / F8 : RESTORE posted, ${a.blocks} quanta mixed in the 3 s after · ${brief(await state(ctx))}`
	})

	await ctx.scenario('AUDIO-REPORT', async () => {
		results.spuTotal = await ctx.js('return globalThis.__ctrAudio?.spuTotal ?? null')
		results.spuHistory = await ctx.js('return globalThis.__ctrAudio?.spuHistory ?? null')
		const proof = await ctx.shot('end')
		const dir = proof?.file ? runDirOf(ctx.args?.proofs, proof.file) : null
		if (dir) writeFileSync(join(dir, 'audio.json'), `${JSON.stringify(results, null, 1)}\n`)
		const h = results.spuHistory ?? []
		const peak = h.reduce((m, x) => Math.max(m, x.bytes), 0)
		return `SPU since boot ${JSON.stringify(results.spuTotal)} · busiest second ${peak} B${dir ? ` · ${dir}/audio.json` : ''}`
	})
}
