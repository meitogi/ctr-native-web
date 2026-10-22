// Player suite : « Who plays » on this page (Settings › Players) — Auto, Keyboard or Gamepad.
//   DEVICE-DRIFT : a stick resting slightly off centre does not move a menu. The retail game reads
//     the stick as a direction only past 0x20 / 0xe0 (GAMEPAD_ProcessTapRelease, ~75 % of its
//     travel) : a 0.05 or 0.3 rest leaves the cursor alone ; what a stuck 0.8 does is recorded.
//   DEVICE-KEYBOARD-ONLY : the page ignores its gamepads — the pad moves nothing, the keyboard
//     drives P1.
//   DEVICE-GAMEPAD-ONLY : the page ignores the keyboard — it plugs no player (Settings › Players
//     shows none), the keys move nothing, the pad drives P1.
//
// RUN : as menu.suite.mjs — bash plans/ctr-native-web/tools/play.sh device <session> <port>
// (debug build : window.__ctr). Not a node --test file.

import { MAIN_MENU, PLAYER, bootToMenu, menuTo, state, until } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const flick = (ctx, dir) => ctx.pad(0).stick('left', 0, dir === 'down' ? 1 : -1, { frames: 8 })
const setDevice = (ctx, mode) => ctx.js(`globalThis.ctrUI.settings.patch({ device: { mode: ${JSON.stringify(mode)}, pad: null } }); return true`)
const row = async ctx => (await state(ctx)).menu?.row

/** The cursor's row after `fn`, given time to move ; throws when it moved and should not have. */
async function stays(ctx, what, fn) {
	const before = await row(ctx)
	await fn()
	await sleep(600)
	const after = await row(ctx)
	if (after !== before) throw new Error(`${what} moved the cursor ${before} → ${after}`)
	return before
}

export default async ctx => {
	await ctx.scenario('DEVICE-DRIFT', async () => {
		await bootToMenu(ctx)
		await menuTo(ctx, 'ARCADE', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		await ctx.pad(0).connect()
		await sleep(500)
		const seen = []
		for (const v of [0.05, 0.3]) {
			await stays(ctx, `a stick resting at ${v}`, async () => {
				await ctx.pad(0).stick('left', v, v)
				await sleep(2500)
			})
			seen.push(`${v} : still`)
		}
		// a stuck axis (a device that is not a pad, a broken stick) : measured, not asserted
		const before = await row(ctx)
		await ctx.pad(0).stick('left', 0, 0)
		await sleep(300)
		await ctx.pad(0).stick('left', 0, 0.8)
		await sleep(3000)
		const after = await row(ctx)
		await ctx.pad(0).stick('left', 0, 0)
		seen.push(`0.8 for 3 s : row ${before} → ${after}`)
		// back where it was, with the pad (the keyboard stays on P2 after a pad leaves : 12b's rule)
		if (after !== before) await flick(ctx, after > before ? 'up' : 'down')
		await ctx.pad(0).disconnect()
		return seen.join(' · ')
	})

	await ctx.scenario('DEVICE-KEYBOARD-ONLY', async () => {
		await until(ctx, 'the main menu', s => s.menu?.input && MAIN_MENU.includes(s.menu.label), { timeout: 10_000 })
		await ctx.pad(0).connect()
		await setDevice(ctx, 'keyboard')
		try {
			await sleep(500)
			const r = await stays(ctx, 'the gamepad on « keyboard only »', async () => {
				await flick(ctx, 'down')
				await ctx.pad(0).press('down')
			})
			await ctx.press('ArrowDown')
			await until(ctx, 'the keyboard to move the cursor', s => s.menu?.row !== r, { timeout: 3000 })
			await ctx.press('ArrowUp')
			return `pad ignored on row ${r}, the keyboard moves it`
		} finally {
			await setDevice(ctx, 'auto')
			await ctx.pad(0).disconnect()
		}
	})

	await ctx.scenario('DEVICE-GAMEPAD-ONLY', async () => {
		await until(ctx, 'the main menu', s => s.menu?.input && MAIN_MENU.includes(s.menu.label), { timeout: 10_000 })
		await ctx.pad(0).connect()
		await setDevice(ctx, 'gamepad')
		try {
			await sleep(500)
			const keyboards = await ctx.js('return (globalThis.ctrUI.players.slots ?? []).filter(s => s.keyboard || s.keyboard2).length')
			if (keyboards) throw new Error(`the keyboard still drives ${keyboards} player(s)`)
			const r = await stays(ctx, 'the keyboard on « gamepad only »', () => ctx.press('ArrowDown'))
			await flick(ctx, 'down')
			await until(ctx, 'the gamepad to move the cursor', s => s.menu?.row !== r, { timeout: 3000 })
			await flick(ctx, 'up')
			return `keyboard ignored on row ${r}, the gamepad moves it`
		} finally {
			await setDevice(ctx, 'auto')
			await ctx.pad(0).disconnect()
		}
	})
}
