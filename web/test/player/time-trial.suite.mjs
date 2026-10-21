// Player suite : a Time Trial lap driven by script. Main menu → Time Trial →
// the default character and the first track (Cross through each screen),
// then accelerate held and steering from window.__ctr feedback until lap 1
// becomes lap 2. Asserts lap 0 → 1, speed > 0, VBlank advancing.
//
// RUN
//   Build : web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=ON
//   Serve : python3 web/test/player/serve.py build-web-debug 8093
//           (no-store : the agent browser caches across runs ; port forwarded)
//   Play  : bash plans/ctr-native-web/tools/play.sh time-trial <session> 8093
//   Browser : the agent browser (`agent-browser up`), else ctr-browser.sh on the Mac.
// Not a node --test file : `node --test web/test/*.test.js` never loads it.
//
// DRIVING : the track is read, not guessed. __ctr.track.path is the level's
// racing line (LevNavTable[0], the points the AI karts follow). Pure pursuit :
// find the nearest point of the line, aim at the point a lookahead distance
// further along it, hold Left / Right while the kart's heading and that bearing
// differ. Heading = kart.angle : the kart moves along (sin, cos)(angle) in
// (x, z), Right lowers the angle, Left raises it (measured on Crash Cove with
// known inputs, see LOG T3). Stuck on a wall (no progress) : reverse
// (Square = X) with the wheel the other way, then go on.
// The lap is lap index 0 → 1 ; the run goes on to the end of the race.

import { PLAYER, bootToMenu, brief, menuTo, recordWithSound, state, track, until, vblankAdvances } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a))
const ACCEL = 'c' // keyboard C = Cross (platform/native_input.c)
const REVERSE = 'x' // keyboard X = Square, brake / reverse
const yaw = k => (k.angle * 2 * Math.PI) / 4096

export default async ctx => {
	let inRace = false
	await ctx.scenario('TT-MENU-PATH', async () => {
		await bootToMenu(ctx)
		await menuTo(ctx, 'TIME TRIAL', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		await ctx.shot('time-trial-row')
		// Cross through every screen (character, track…) until the level loads.
		const path = []
		for (let i = 0; i < 10; i++) {
			const s = await state(ctx)
			if (s.screen !== 'menu') break
			path.push(s.menu ? `${s.menu.title || '-'}:${s.menu.label}` : `levelID ${s.levelID}`)
			await ctx.press(ACCEL)
			await sleep(1200)
		}
		await ctx.shot('after-menus')
		const s = await until(ctx, 'the race to load', n => n.screen !== 'menu' && n.screen !== 'loading' && n.kart != null, { timeout: 90_000, every: 500 })
		if (!s.mode.includes('TIME_TRIAL')) throw new Error(`not a Time Trial : ${brief(s)}`)
		inRace = true
		return `${path.join(' → ')} · ${brief(s)}`
	})

	await ctx.scenario('TT-LAP', async () => {
		if (!inRace) ctx.skip('TT-MENU-PATH did not reach a Time Trial race')
		const s0 = await until(ctx, 'the countdown to end', s => s.screen === 'race', { timeout: 60_000, every: 250 })
		if (s0.kart.lap !== 0) throw new Error(`race starts on lap index ${s0.kart.lap}`)
		const line = await track(ctx)
		const path = line?.levelID === s0.levelID ? line.path : null
		if (!path || path.length < 10) throw new Error(`no racing line for level ${s0.levelID} (${path?.length ?? 0} points)`)
		const n = path.length
		const seg = path.map((p, i) => Math.hypot(path[(i + 1) % n].x - p.x, path[(i + 1) % n].z - p.z))
		const spacing = [...seg].sort((a, b) => a - b)[n >> 1]
		// Nearest line point, searched around the last one (the line can cross itself in height).
		let near = -1
		const nearest = k => {
			const span = near < 0 ? n : 40
			const from = near < 0 ? 0 : near - 10
			let best = Infinity
			let at = near
			for (let j = 0; j < span; j++) {
				const i = (((from + j) % n) + n) % n
				const d = (path[i].x - k.pos.x) ** 2 + (path[i].z - k.pos.z) ** 2 + 4 * (path[i].y - k.pos.y) ** 2
				if (d < best) {
					best = d
					at = i
				}
			}
			near = at
			return at
		}
		const aim = (k, look) => {
			let i = nearest(k)
			for (let d = 0; d < look; i = (i + 1) % n) d += seg[i]
			return path[i]
		}
		await ctx.shot('race-start')
		let topSpeed = 0
		let maxSpeed = 0
		let recoveries = 0
		let lapAt = 0
		const t0 = Date.now()
		let end = null
		await recordWithSound(ctx, 'race', async () => {
			let held = null
			const steer = async want => {
				if (want === held) return
				if (held) await ctx.release(held)
				if (want) await ctx.hold(want)
				held = want
			}
			await ctx.hold(ACCEL)
			try {
				let slowSince = 0
				let lastPos = null
				let shots = 0
				while (Date.now() - t0 < 300_000) {
					const s = await state(ctx)
					const k = s.kart
					if (k.lap >= 1 && !lapAt) {
						lapAt = Date.now()
						await ctx.shot('lap-2')
					}
					if (s.screen === 'finished' || k.finished) {
						end = s
						break
					}
					topSpeed = Math.max(topSpeed, k.speed)
					maxSpeed = Math.max(maxSpeed, k.speed)
					const t = aim(k, spacing * 2 + Math.max(0, k.speed) / 25)
					// > 0 : the target is toward a higher angle, i.e. Left.
					const err = wrap(Math.atan2(t.x - k.pos.x, t.z - k.pos.z) - yaw(k))
					// Stuck : under a fifth of top speed, or barely moving, for 1 s.
					const moved = lastPos ? Math.hypot(k.pos.x - lastPos.x, k.pos.z - lastPos.z) : Infinity
					lastPos = k.pos
					if ((maxSpeed > 0 && k.speed < maxSpeed / 5) || moved < 5) slowSince ||= Date.now()
					else slowSince = 0
					if (slowSince && Date.now() - slowSince > 1000) {
						recoveries++
						await ctx.release(ACCEL)
						// Backing up swings the nose the other way : wheel away from the target.
						await steer(err > 0 ? 'ArrowRight' : 'ArrowLeft')
						await ctx.hold(REVERSE)
						await sleep(1100)
						await ctx.release(REVERSE)
						await steer(null)
						await ctx.hold(ACCEL)
						slowSince = 0
						maxSpeed = topSpeed
						near = -1
						lastPos = null
						await sleep(500)
						continue
					}
					await steer(Math.abs(err) > 0.05 ? (err > 0 ? 'ArrowLeft' : 'ArrowRight') : null)
					if (shots < 3 && Date.now() - t0 > (shots + 1) * 15_000) await ctx.shot(`race-${++shots}`)
					await sleep(30)
				}
				end ??= await state(ctx)
			} finally {
				await steer(null)
				await ctx.release(ACCEL)
			}
		})
		await ctx.shot('end')
		if (!lapAt) throw new Error(`no lap completed in 300 s (${recoveries} recoveries) : ${brief(end)}`)
		if (!(topSpeed > 0)) throw new Error(`speed never above 0 (top ${topSpeed})`)
		const vb = await vblankAdvances(ctx)
		const lapS = Math.round((lapAt - t0) / 1000)
		const race = end.screen === 'finished' || end.kart.finished ? `race finished in ${Math.round((Date.now() - t0) / 1000)} s` : `race not finished (${brief(end)})`
		return `lap 0 → 1 in ${lapS} s · ${race} · line ${n} points, spacing ${Math.round(spacing)} · top speed ${topSpeed} · ${recoveries} wall recoveries · +${vb} VBlanks in 2 s`
	})
}
