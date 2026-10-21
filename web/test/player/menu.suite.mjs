// Player suite : boot → main menu, then the cursor driven by the keyboard and
// by a virtual gamepad. Asserts on window.__ctr, not on pixels.
//
// RUN
//   Build : web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=ON  (debug : __ctr ;
//           preload : no drop zone to get past)
//   Serve : web/serve.sh debug 8093  (port forwarded to the host)
//   Play  : bash plans/ctr-native-web/tools/play.sh menu <session> 8093
//           (= node <visual-loop>/scripts/e2e.mjs --suite web/test/player/menu.suite.mjs
//              --url http://localhost:8093/index.html --proofs plans/ctr-native-web/proofs/<session>)
//   Host browser : plans/ctr-native-web/tools/ctr-browser.sh on the Mac.
// Not a node --test file : `node --test web/test/*.test.js` never loads it.

import { PLAYER, bootToMenu, brief, menuTo, recordWithSound, state, until, vblankAdvances } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

export default async ctx => {
	await ctx.scenario('BOOT-MENU', async () => {
		const s = await bootToMenu(ctx)
		await ctx.shot('main-menu')
		const vblanks = await vblankAdvances(ctx)
		const n = await state(ctx)
		if (!(n.fps >= 20)) throw new Error(`fps ${n.fps} on the main menu`)
		return `${brief(s)} · +${vblanks} VBlanks in 2 s · ${n.fps} fps`
	})

	await ctx.scenario('MENU-KEYBOARD', async () => {
		await until(ctx, 'the main menu', s => s.menu != null, { timeout: 5000 })
		let path = []
		await recordWithSound(ctx, 'keyboard', async () => {
			path = path.concat(await menuTo(ctx, 'TIME TRIAL', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp')))
			await ctx.shot('keyboard-time-trial')
			path = path.concat(await menuTo(ctx, 'ADVENTURE', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp')))
		})
		const s = await state(ctx)
		if (s.menu.label !== 'ADVENTURE') throw new Error(`cursor on ${s.menu.label}`)
		return path.join(' → ')
	})

	await ctx.scenario('MENU-PAD', async () => {
		await ctx.pad(0).connect()
		let path = []
		await recordWithSound(ctx, 'pad', async () => {
			path = path.concat(await menuTo(ctx, 'ARCADE', dir => ctx.pad(0).press(dir)))
			await ctx.shot('pad-arcade')
			path = path.concat(await menuTo(ctx, 'ADVENTURE', dir => ctx.pad(0).press(dir)))
		})
		await ctx.pad(0).disconnect()
		return path.join(' → ')
	})
}
