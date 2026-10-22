// Player suite : the ready screen. With a disc already stored in this browser, the boot screen
// stays up (#press-start) and shows the button that starts the game — the keyboard's Start key,
// and a connected pad's Cross in its family's look ; the game loads only on that press (a key,
// a pad button, or the Play button). Asserts on the page's DOM and the game's log, not on pixels.
//
// RUN
//   Build : a build WITHOUT the preloaded disc (a preloaded build has nothing stored, it boots
//           by itself) — web/build-web.sh debug -DCTR_WEB_PRELOAD_DISC=OFF
//   The disc, once per origin, fetched by the page's test hook from the server : link it into the
//   build dir (build dirs are gitignored, never committed) — ln -s ../assets/ctr-u.bin build-web-debug/
//   Serve : python3 web/test/player/serve.py build-web-debug <port>
//   Play  : bash plans/ctr-native-web/tools/play.sh ready <session> <port>
// Not a node --test file : `node --test web/test/*.test.js` never loads it.

import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAYER } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const say = (...a) => console.log(`    · ${new Date().toTimeString().slice(0, 8)}`, ...a)

const page = ctx => ctx.js(`return {
	ready: !!document.getElementById('press-start'),
	drop: !!document.getElementById('drop-zone'),
	boot: !document.getElementById('boot').classList.contains('hidden'),
	status: document.getElementById('boot-status')?.textContent ?? '',
	error: document.getElementById('drop-error')?.textContent ?? '',
	game: !!document.querySelector('script[src="ctr_native.js"]'),
	vblank: /vblank=/.test(document.getElementById('log')?.textContent ?? ''),
	press: document.querySelector('#press-start .press')?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
	glyphs: [...document.querySelectorAll('#press-start .press .key, #press-start .press svg')].map(g => g.classList.contains('key') ? 'key:' + g.textContent : 'pad:' + g.getAttribute('aria-label')),
	preload: !!window.__CTR_WEB_PRELOAD,
}`)

async function until(ctx, label, pred, timeout = 30_000) {
	const end = Date.now() + timeout
	let beat = Date.now() + 15_000
	for (;;) {
		const p = await page(ctx).catch(() => null)
		if (p && pred(p)) return p
		if (p?.error) throw new Error(`${label} : the page says « ${p.error} »`)
		if (Date.now() > end) throw new Error(`${label} : not after ${timeout / 1000} s (${JSON.stringify(p)})`)
		if (Date.now() >= beat) { say(`waiting for ${label} : ${p?.status || JSON.stringify(p)}`); beat += 15_000 }
		await sleep(250)
	}
}

// the compositor's surface : ctx.shot's own capture is flat grey on the headless agent browser (LOG ## T3)
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

/** Reloads to the ready screen and checks that nothing of the game has loaded. */
async function toReady(ctx) {
	await ctx.reload()
	const p = await until(ctx, 'the ready screen', p => p.ready)
	await sleep(1500)
	const q = await page(ctx)
	if (!q.ready || !q.boot || q.game) throw new Error(`the game did not wait for the press : ${JSON.stringify(q)}`)
	return q
}

const started = ctx => until(ctx, 'the game running', p => p.game && !p.boot && p.vblank, 90_000)

export default async ctx => {
	const first = await page(ctx)
	if (first.preload) ctx.skip('preloaded-disc build : nothing stored, it boots by itself (use -DCTR_WEB_PRELOAD_DISC=OFF)')

	await ctx.scenario('READY-STORE', async () => {
		const p = await until(ctx, 'the boot screen', p => p.ready || (p.drop && !p.status))
		if (p.ready) return 'a disc is already stored in this browser'
		say('storing the disc in this browser (605 MB, once per origin)')
		await ctx.js(`void window.__ctrTestHandleFileFromUrl(location.origin + '/ctr-u.bin'); return true`)
		await until(ctx, 'the disc stored and the game started', p => p.game && !p.boot, 900_000)
		return 'dropped disc stored, the game started at once (no press asked after a drop)'
	})

	await ctx.scenario('READY-KEYBOARD', async () => {
		const p = await toReady(ctx)
		await shot(ctx, 'ready-keyboard')
		if (!p.glyphs.some(g => g === 'key:Enter' || g === 'key:Entrée')) throw new Error(`no Enter key cap : ${p.glyphs}`)
		await ctx.press('Enter')
		await started(ctx)
		return `« ${p.press} » · Enter → the game runs`
	})

	await ctx.scenario('READY-PAD', async () => {
		await toReady(ctx)
		await ctx.pad(0).connect()
		const p = await until(ctx, 'the pad glyph', p => p.glyphs.some(g => g.startsWith('pad:')), 10_000)
		await shot(ctx, 'ready-pad')
		await ctx.pad(0).press('cross')
		await started(ctx)
		return `« ${p.press} » (${p.glyphs.join(', ')}) · Cross → the game runs`
	})

	await ctx.scenario('READY-OTHER-KEY', async () => {
		// a key that is neither Enter / Space nor bound to Cross / Start leaves the screen up
		await toReady(ctx)
		await ctx.press('q')
		await sleep(2000)
		const p = await page(ctx)
		if (!p.ready || p.game) throw new Error(`Q started the game : ${JSON.stringify(p)}`)
		await ctx.js(`document.getElementById('start-game').click(); return true`)
		await started(ctx)
		return 'Q ignored · the Play button → the game runs'
	})
}
