// Player suite : the left stick of a virtual pad moves the menus' cursor (the retail game maps an
// analog stick past 0x20 / 0xe0 to the D-pad bits, GAMEPAD_ProcessTapRelease), and an analog
// pad toggled to digital (Select + Start, the PS1's Analog button) ignores its stick.
//
// RUN : as menu.suite.mjs — bash plans/ctr-native-web/tools/play.sh stick <session> <port>
// Not a node --test file.

import { MAIN_MENU, PLAYER, bootToMenu, menuTo, recordWithSound, state, until } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** One stick flick : full deflection for 8 frames, then back to centre. */
const flick = (ctx, dir) => ctx.pad(0).stick('left', 0, dir === 'down' ? 1 : -1, { frames: 8 })

export default async ctx => {
	await ctx.scenario('STICK-MAIN-MENU', async () => {
		await bootToMenu(ctx)
		await ctx.pad(0).connect()
		let path = []
		await recordWithSound(ctx, 'stick-main-menu', async () => {
			path = path.concat(await menuTo(ctx, 'BATTLE', dir => flick(ctx, dir)))
			await ctx.shot('stick-battle')
			path = path.concat(await menuTo(ctx, 'ADVENTURE', dir => flick(ctx, dir)))
		})
		const s = await state(ctx)
		if (s.menu.label !== 'ADVENTURE') throw new Error(`cursor on ${s.menu.label}`)
		return path.join(' → ')
	})

	await ctx.scenario('STICK-SUBMENU', async () => {
		// Arcade → its submenu (Single race / Cup) : the stick moves that cursor too (__ctr.sub).
		await menuTo(ctx, 'ARCADE', dir => flick(ctx, dir))
		await ctx.pad(0).press('cross')
		const sub = await until(ctx, 'the Arcade submenu', n => n.sub != null && n.sub.input, { timeout: 8000 })
		await ctx.frames(8)
		const row = sub.sub.row
		await recordWithSound(ctx, 'stick-submenu', async () => {
			await flick(ctx, 'down')
			await until(ctx, 'the submenu cursor to move', n => n.sub != null && n.sub.row !== row, { timeout: 3000 })
		})
		const moved = await state(ctx)
		await ctx.frames(8)
		await ctx.pad(0).press('triangle')
		await until(ctx, 'back on the main menu', n => n.sub == null && n.menu?.input && MAIN_MENU.includes(n.menu.label), { timeout: 8000 })
		return `${JSON.stringify(sub.sub.title)} : ${JSON.stringify(sub.sub.label)} → ${JSON.stringify(moved.sub.label)}`
	})

	await ctx.scenario('STICK-DIGITAL-TOGGLE', async () => {
		// Select + Start together : analog → digital (pad id 0x41) ; the stick then does nothing.
		await ctx.pad(0).hold('select')
		await ctx.pad(0).press('start')
		await ctx.pad(0).release('select')
		await ctx.frames(8)
		const dig = await ctx.js(`return { pad: globalThis.ctrUI?.players?.slots?.[0]?.pad ?? null, toast: [...document.querySelectorAll('.toast')].map(t => t.innerText.replace(/\\s+/g, ' ')).join(' | ') }`)
		if (!dig.pad || dig.pad.analog) throw new Error(`Players does not show P1 digital : ${JSON.stringify(dig)}`)
		const before = await state(ctx)
		await flick(ctx, 'down')
		await sleep(400)
		const after = await state(ctx)
		// back to analog for whoever comes next
		await ctx.pad(0).hold('select')
		await ctx.pad(0).press('start')
		await ctx.pad(0).release('select')
		await ctx.frames(8)
		if (after.menu.row !== before.menu.row) throw new Error(`digital pad's stick moved the cursor ${before.menu.row} → ${after.menu.row}`)
		// analog again : the stick moves it (so the toggle, not a dead pad, made the difference)
		await flick(ctx, before.menu.row > 0 ? 'up' : 'down')
		const again = await until(ctx, 'the analog stick to move the cursor again', n => n.menu != null && n.menu.row !== before.menu.row, { timeout: 3000 })
		await ctx.pad(0).disconnect()
		return `digital : stick ignored (row ${before.menu.row}), toast « ${dig.toast} » ; analog again : row ${again.menu.row}`
	})
}
