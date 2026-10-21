// Player suite : couch mode (session 12b) — several players on one machine.
//   SKIP-INTRO-PAD  from a fresh load, mashing a pad's A / Cross goes through every intro screen
//                   to the main menu (« Skip intro », on by default)
//   COUCH-PLAYERS   the game's slot report (Settings › Players) : the keyboard on P1, the second
//                   keyboard half on P2 with « two players on the keyboard », a held key lights
//                   its player, a swap moves the keyboards, pads arriving push the keyboards down
//   COUCH-PLAYERS-UI the Players tab as the player sees it
//   COUCH-VS        two virtual pads : VS. › 2 players, both pick a driver, the race in split
//                   screen with both karts driven (Cross held, P2 steering with its stick)
// Asserts on window.__ctr (players, karts, sub) and ctrUI.players, the video shows the split screen.
//
// RUN : as menu.suite.mjs — bash plans/ctr-native-web/tools/play.sh couch <session> <port>
// (debug build with the preloaded disc). Not a node --test file.

import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAIN_MENU, PLAYER, brief, menuTo, onMainMenu, recordWithSound, say, state, until } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ctx.shot is grey on the headless agent browser (LOG ## T3) : rewritten from the surface (ux.suite.mjs)
async function shot(ctx, label) {
	const proof = await ctx.shot(label)
	const root = ctx.args.proofs
	if (!root || !proof?.file) return proof
	const runs = readdirSync(root).map(d => join(root, d)).filter(d => statSync(d).isDirectory())
	const dir = runs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).find(d => readdirSync(d).includes(proof.file))
	const r = await ctx.conn.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, ctx.sid)
	if (dir && r?.data) writeFileSync(join(dir, proof.file), Buffer.from(r.data, 'base64'))
	return proof
}

/** P1–P4 as the page holds them : 'pad:<family>', 'kb', 'kb2', joined by '+' ; '-' for nobody. */
const slots = ctx => ctx.js(`return (globalThis.ctrUI?.players?.slots ?? []).map(s => [s.pad ? 'pad:' + s.pad.family + (s.pad.analog ? '' : ':dig') : '', s.keyboard ? 'kb' : '', s.keyboard2 ? 'kb2' : ''].filter(Boolean).join('+') || '-')`)
const lit = ctx => ctx.js(`return (globalThis.ctrUI?.players?.slots ?? []).map(s => s.pressed)`)
const settingsPatch = (ctx, p) => ctx.js(`globalThis.ctrUI.settings.patch(${JSON.stringify(p)}); return true`)
const swap = (ctx, a, b) => ctx.js(`globalThis.ctrUI.players.swap(${a}, ${b}); return true`)

async function untilSlots(ctx, want, label) {
	const deadline = Date.now() + 5000
	let got
	while (Date.now() < deadline) {
		got = await slots(ctx)
		if (got.join(' ') === want.join(' ')) return got
		await sleep(150)
	}
	throw new Error(`${label} : players ${got?.join(' ')} — expected ${want.join(' ')}`)
}

export default async ctx => {
	let onMenu = false

	await ctx.scenario('SKIP-INTRO-PAD', async () => {
		// a fresh load, « Skip intro » at its default (on) ; the 605 MB preload over the forwarded
		// port sometimes stalls (ctr.mjs bootToMenu) : no game after 2 min = reload, 3 tries
		await ctx.js(`localStorage.removeItem('ctr-ui.skip-intro'); localStorage.removeItem('ctr-ui.duo'); return true`)
		const seen = []
		let s = null
		let t0 = 0
		for (let attempt = 1; attempt <= 3 && !(s && onMainMenu(s)); attempt++) {
			await ctx.reload()
			await ctx.pad(0).connect()
			t0 = Date.now()
			s = null
			say(`mashing the pad's A / Cross through the intro until the main menu${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
			while (!(s && onMainMenu(s)) && Date.now() - t0 < (s ? 180_000 : 120_000)) {
				if (s && !seen.includes(s.screen)) { seen.push(s.screen); say(`game screen : ${s.screen}`) }
				// on the menu, a Cross that lands as it wakes opens a row : Triangle backs out
				await ctx.pad(0).press(s?.menu?.input ? 'triangle' : 'cross').catch(() => {})
				await sleep(150)
				s = await state(ctx).catch(() => null)
			}
		}
		s = await until(ctx, 'the main menu', onMainMenu, { timeout: 5000 })
		await ctx.pad(0).disconnect()
		onMenu = true
		const seconds = s.vblank / 59.82
		// ~45 s of game time for the full intro (LOG ## 2) ; the disc loads between screens stay
		if (seconds > 25) throw new Error(`${seconds.toFixed(1)} s of game time to the menu — the intro was not skipped`)
		return `main menu after ${seconds.toFixed(1)} s of game time (${s.vblank} VBlanks, ${Math.round((Date.now() - t0) / 1000)} s wall clock with the load), screens ${seen.join(' → ')}`
	})

	await ctx.scenario('COUCH-PLAYERS', async () => {
		if (!onMenu) throw new Error('no main menu (SKIP-INTRO-PAD failed)')
		await ctx.js("document.getElementById('canvas')?.focus(); return true")
		const steps = []
		// the pad of SKIP-INTRO-PAD opened on P1 and pushed the keyboard to P2 ; it stays there once
		// the pad is gone (native_input.c's rule) — the Players part brings it back
		let after = await slots(ctx)
		for (let i = 0; i < 20 && after.some(x => x.startsWith('pad')); i++) { await sleep(150); after = await slots(ctx) }
		const k = after.indexOf('kb')
		steps.push(`after the pad left : ${after.join(' ')}`)
		if (k > 0) await swap(ctx, k, 0)
		steps.push(`keyboard alone : ${(await untilSlots(ctx, ['kb', '-', '-', '-'], 'keyboard alone')).join(' ')}`)
		await settingsPatch(ctx, { duo: true })
		steps.push(`duo : ${(await untilSlots(ctx, ['kb', 'kb2', '-', '-'], 'two on the keyboard')).join(' ')}`)
		// L = the right half's Cross : P2's row lights, not P1's
		await ctx.hold('l')
		await ctx.frames(6)
		const l = await lit(ctx)
		await ctx.release('l')
		if (!(l[1] && !l[0])) throw new Error(`holding L lit ${JSON.stringify(l)} — expected P2 only`)
		await ctx.hold('g')
		await ctx.frames(6)
		const g = await lit(ctx)
		await ctx.release('g')
		if (!(g[0] && !g[1])) throw new Error(`holding G lit ${JSON.stringify(g)} — expected P1 only`)
		steps.push('L lights P2, G lights P1')
		await swap(ctx, 0, 1)
		steps.push(`swap P1 ⇄ P2 : ${(await untilSlots(ctx, ['kb2', 'kb', '-', '-'], 'after the swap')).join(' ')}`)
		await swap(ctx, 0, 1)
		await untilSlots(ctx, ['kb', 'kb2', '-', '-'], 'swapped back')
		// pads arriving take the first slots ; the keyboards make room
		await ctx.pad(0).connect()
		await ctx.pad(1).connect()
		const four = await untilSlots(ctx, ['pad:other', 'pad:other', 'kb', 'kb2'], 'two pads plugged in')
		steps.push(`2 pads : ${four.join(' ')}`)
		await settingsPatch(ctx, { duo: false })
		steps.push(`duo off : ${(await untilSlots(ctx, ['pad:other', 'pad:other', 'kb', '-'], 'duo off')).join(' ')}`)
		return steps.join(' · ')
	})

	await ctx.scenario('COUCH-PLAYERS-UI', async () => {
		await ctx.js(`document.getElementById('ctr-gear').click(); return true`)
		await sleep(300)
		await ctx.js(`document.querySelector('#ctr-settings [data-tab=players]').click(); return true`)
		await sleep(300)
		await settingsPatch(ctx, { duo: true })
		await sleep(400)
		// Square : in the panel, Cross clicks the focused control, Circle closes, L1 / R1 change tabs
		await ctx.pad(1).hold('square')
		await sleep(300)
		const rows = await ctx.js(`return [...document.querySelectorAll('#ctr-settings .row')].map(r => (r.classList.contains('lit') ? '*' : '') + r.innerText.replace(/\\s+/g, ' ').trim())`)
		await shot(ctx, 'players-tab')
		await ctx.pad(1).release('square')
		await settingsPatch(ctx, { duo: false })
		await ctx.js(`document.getElementById('ctr-gear').click(); return true`)
		await sleep(300)
		await ctx.js("document.getElementById('canvas')?.focus(); return true")
		if (rows.length !== 4 || !rows[1].startsWith('*')) throw new Error(`rows ${JSON.stringify(rows)} — expected 4 with P2 lit`)
		return rows.join(' | ')
	})

	await ctx.scenario('COUCH-VS', async () => {
		if (!onMenu) throw new Error('no main menu')
		const p1 = ctx.pad(0)
		const p2 = ctx.pad(1)
		// COUCH-PLAYERS's G (the left half's Cross) opened the row under the cursor : back out
		for (let i = 0; i < 6 && (await state(ctx)).sub != null; i++) {
			await p1.press('triangle')
			await sleep(600)
		}
		await until(ctx, 'the main menu', n => onMainMenu(n) && n.sub == null, { timeout: 5000 })
		await menuTo(ctx, 'VS.', dir => p1.press(dir))
		await p1.press('cross')
		const sub = await until(ctx, 'the VS. players submenu', n => n.sub != null && n.sub.input, { timeout: 8000 })
		say(`submenu ${JSON.stringify(sub.sub.title)} row ${sub.sub.row} ${JSON.stringify(sub.sub.label)}`)
		const path = [`${sub.sub.title || '-'}:${sub.sub.label}`]
		let s = sub
		// Cross from both pads through every screen (players, drivers, track…) until the race loads
		for (let i = 0; i < 24 && s.screen === 'menu'; i++) {
			await p1.press('cross')
			await sleep(500)
			await p2.press('cross')
			await sleep(700)
			s = await state(ctx)
			const where = s.sub ? `${s.sub.title || '-'}:${s.sub.label}` : s.menu ? `${s.menu.title || '-'}:${s.menu.label}` : `level ${s.levelID}`
			if (path[path.length - 1] !== where) path.push(where)
		}
		s = await until(ctx, 'the race to load', n => n.screen !== 'menu' && n.screen !== 'loading' && n.karts?.length >= 2, { timeout: 90_000, every: 500 })
		if (s.players !== 2) throw new Error(`${s.players} players in the race — expected 2 : ${brief(s)}`)
		const start = await until(ctx, 'the countdown to end', n => n.screen === 'race', { timeout: 60_000, every: 250 })
		const a0 = start.karts[1].angle
		let end
		const top = [0, 0]
		const sample = async () => {
			const n = await state(ctx)
			n.karts.forEach((k, i) => { if (k && i < 2) top[i] = Math.max(top[i], k.speed) })
			return n
		}
		await recordWithSound(ctx, 'vs-split-screen', async () => {
			await p1.hold('cross')
			await p2.hold('cross')
			for (let i = 0; i < 10; i++) { await sleep(250); await sample() }
			// P2 steers with its stick, P1 goes straight ; the kart may end against a wall (speed < 0)
			await p2.stick('left', -1, 0, { ms: 1200 })
			for (let i = 0; i < 6; i++) { await sleep(250); end = await sample() }
			await p1.release('cross')
			await p2.release('cross')
		})
		await shot(ctx, 'vs-race')
		if (!(top[0] > 1000 && top[1] > 1000)) throw new Error(`karts not both driving : top speeds ${top.join(' / ')}`)
		const k2 = end.karts[1]
		const turned = ((k2.angle - a0 + 2048 + 4096) % 4096) - 2048
		if (Math.abs(turned) < 64) throw new Error(`P2's stick did not steer : angle ${a0} → ${k2.angle}`)
		await p1.disconnect()
		await p2.disconnect()
		return `${path.join(' → ')} · race ${end.players} players in split screen, top speeds ${top.join(' / ')}, P2 turned ${turned} (of 4096) with its stick`
	})
}
