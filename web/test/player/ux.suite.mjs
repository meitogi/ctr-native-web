// Player suite : the page's interface (session 12, web/ui) — a zipped disc dropped on the boot
// screen booting to the menu, « Skip intro » by mashing a key, the whole-window drop overlay, the
// Settings panel holding the keys while it has the focus, a remapped key and a remapped pad
// button moving the menu cursor, the « gamepad connected » toast, the speaker, and in the
// CTR_ONLINE build the one player name shared with the Online tab. Asserts on window.__ctr and
// on the page's own state, not on pixels.
//
// RUN
//   Builds (debug : __ctr) :
//     zip + everything : a build WITHOUT the preloaded disc —
//       emcmake cmake -S . -B build-web-debug-nopre -DCMAKE_BUILD_TYPE=Debug -DCTR_WEB_PRELOAD_DISC=OFF
//       and the fixture, never committed (build dirs are gitignored) :
//       python3 -c "import zipfile; zipfile.ZipFile('build-web-debug-nopre/fixtures/ctr-u.zip','w',zipfile.ZIP_DEFLATED).write('assets/ctr-u.bin','CTR (USA)/ctr-u.bin')"
//     the online name : a CTR_ONLINE=ON debug build (preload on is fine).
//   Serve : python3 web/test/player/serve.py <build> <port>
//   Play  : bash plans/ctr-native-web/tools/play.sh ux <session> <port>
//   A build with the preloaded disc skips UX-ZIP-BOOT (nothing to drop) and boots by itself.
// Not a node --test file : `node --test web/test/*.test.js` never loads it.

import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAIN_MENU, PLAYER, bootToMenu, brief, menuTo, onMainMenu, state, until } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
// Progress lines between the PASS / FAIL ones (play.sh's output, proofs/<session>/live.log when
// run that way) : a long step says what it waits for, so it never looks hung.
const say = (...a) => console.log(`    · ${new Date().toTimeString().slice(0, 8)}`, ...a)
const SCANCODE_S = 22 // SDL_SCANCODE_S
const SDL_NORTH = 3 // SDL_GAMEPAD_BUTTON_NORTH

/** The page's UI state, read through the DOM and localStorage. */
const page = ctx => ctx.js(`return {
	ui: !!document.getElementById('boot'),
	boot: !!document.getElementById('boot') && !document.getElementById('boot').classList.contains('hidden'),
	settings: !!document.getElementById('ctr-settings'),
	overlay: !!document.getElementById('ctr-drop-overlay'),
	toasts: [...document.querySelectorAll('.toast')].map(t => ({ family: t.dataset.family, text: t.innerText.split(String.fromCharCode(10)).map(x => x.trim()).filter(Boolean).join(' — ') })),
	blocked: !!window.Module?.ctrInput?.blocked(),
	focusInPanel: !!document.activeElement?.closest?.('#ctr-settings'),
	keyboard: localStorage.getItem('ctr-ui.keyboard'),
	gamepad: localStorage.getItem('ctr-ui.gamepad'),
	error: document.getElementById('drop-error')?.textContent ?? '',
	preload: !!window.__CTR_WEB_PRELOAD,
}`)

// ctx.shot's capture (fromSurface: false) comes back flat grey on the headless agent browser
// (LOG ## T3) ; the same file is rewritten from the compositor's surface, which is right there.
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

const click = (ctx, selector) => ctx.js(`const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error('no ${selector.replace(/'/g, '')}'); e.click(); return true`)

/** Dispatches a drag event carrying a small non-disc file at `target`. */
const drag = (ctx, type, target = 'body') => ctx.js(`
	const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(64)], 'not-a-disc.zip'))
	const t = document.querySelector(${JSON.stringify(target)}) ?? document.body
	t.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))
	return !!document.getElementById('ctr-drop-overlay')`)

export default async ctx => {
	let booted = null
	// The CTR_ONLINE build ships web/online/ and boots into OnlineCTR's server menu, not the main
	// menu : there the suite checks the shared name (and the page parts that need no menu).
	const onlineBuild = await ctx.js(`return (await fetch('online/page.js', { method: 'HEAD' })).ok`)
	const needsMainMenu = () => { if (onlineBuild) ctx.skip('CTR_ONLINE build : it boots into OnlineCTR\'s server menu, not the main menu — run on the single-player build') }

	await ctx.scenario('UX-ZIP-BOOT', async () => {
		for (let i = 0; i < 60 && !(await page(ctx).catch(() => null))?.ui; i++) await sleep(500) // the page's UI mounted
		const p = await page(ctx)
		if (p.preload) ctx.skip('preloaded-disc build : nothing to drop (use a build with -DCTR_WEB_PRELOAD_DISC=OFF)')
		const fixture = new URL('fixtures/ctr-u.zip', ctx.args.url).href
		const head = await ctx.js(`const r = await fetch(${JSON.stringify(fixture)}, { method: 'HEAD' }); return r.ok ? Number(r.headers.get('content-length')) : 0`)
		if (!head) ctx.skip(`no fixture at ${fixture} (see RUN)`)
		// a fresh boot screen : no stored disc
		say('forgetting the stored disc, reloading to the boot screen')
		await ctx.js(`const root = await navigator.storage.getDirectory(); await root.removeEntry('ctr-u.bin').catch(() => {}); return true`)
		await ctx.reload()
		const deadline = Date.now() + 20_000
		while (Date.now() < deadline && !(await page(ctx).catch(() => null))?.boot) await sleep(250)
		if (!(await page(ctx)).boot) throw new Error('no boot screen after forgetting the disc')
		await shot(ctx, 'boot-screen')
		// the whole window lights up as the drag enters, wherever it enters
		await drag(ctx, 'dragenter', '#pick-disc')
		await ctx.frames(3)
		const lit = (await page(ctx)).overlay
		if (!lit) throw new Error('no overlay when a drag carrying a file enters the boot screen')
		await shot(ctx, 'boot-drag-overlay')
		// the drop itself : the fixture fetched into a File, dropped on a child element
		say(`downloading the zipped disc into the page (${Math.round(head / 1048576)} MB) and dropping it`)
		// 355 MB through the forwarded port : it sometimes drops (LOG ## 2, Gotchas) — up to 3 tries
		await ctx.js(`let blob = null
			for (let i = 0; i < 3 && !blob; i++) blob = await fetch(${JSON.stringify(fixture)}).then(r => r.blob()).catch(() => null)
			if (!blob) throw new Error('the fixture did not come through the forwarded port in 3 tries')
			const dt = new DataTransfer(); dt.items.add(new File([blob], 'CTR (USA).zip', { type: 'application/zip' }))
			document.querySelector('.needs').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
			return true`)
		let progress = null
		const t0 = Date.now()
		let told = -1
		while (Date.now() - t0 < 240_000) {
			progress = await ctx.js(`const p = document.getElementById('drop-progress'); return p ? Number(p.value) : null`)
			if (progress != null && Math.floor(progress / 5) !== told) { told = Math.floor(progress / 5); say(`unzipping into the browser's storage : ${Math.round(progress)} %`) }
			if (progress != null && progress > 20) break
			if (await state(ctx)) break
			await sleep(300)
		}
		await shot(ctx, 'zip-progress')
		// done once the page has stored the disc and injected the game (the boot screen goes) ;
		// UX-SKIP-INTRO mashes from there, through SCEA and the copyright page
		const t1 = Date.now()
		let last = 0
		while (Date.now() - t1 < 300_000 && (await page(ctx)).boot) {
			const p = await ctx.js(`const p = document.getElementById('drop-progress'); return p ? Number(p.value) : null`)
			if (p != null && Math.floor(p / 10) !== last) { last = Math.floor(p / 10); say(`unzipping into the browser's storage : ${Math.round(p)} %`) }
			await sleep(300)
		}
		say('disc stored and checked, the game is booting')
		booted = { gameInjectedAfter: Math.round((Date.now() - t0) / 1000) }
		const stored = await ctx.js(`const f = await (await (await navigator.storage.getDirectory()).getFileHandle('ctr-u.bin')).getFile(); return f.size`)
		if (stored !== 605698800) throw new Error(`OPFS ctr-u.bin is ${stored} bytes, not the disc's 605698800`)
		return `fixture ${head} B · overlay on dragenter ${lit} · progress seen ${Math.round(progress)} % · unzipped, stored and the game started after ${booted.gameInjectedAfter} s · OPFS ${stored} B`
	})

	await ctx.scenario('UX-SKIP-INTRO', async () => {
		needsMainMenu()
		// From a fresh page load, mash Enter (Start) — not a face button, so only « Skip intro »
		// ends SCEA, the copyright page and the crate — until the main menu takes input ; Triangle
		// backs out of a press that opened a row. __ctr only appears once the game renders scenes
		// (after SCEA / copyright) : the VBlank count at the menu is the game time since boot.
		// Right after UX-ZIP-BOOT the game has just started ; else (a preloaded build, booted
		// before the suite) the page is reloaded.
		// The 605 MB preload over the forwarded port can break on a reload (« network error »,
		// the data file still pending) : no game after 2 min = reload again, 3 tries (12b).
		let t0 = Date.now()
		const seen = []
		let s = null
		for (let attempt = 1; attempt <= 3 && !(s && onMainMenu(s)); attempt++) {
			if (!booted || attempt > 1) await ctx.reload()
			t0 = Date.now()
			s = null
			say(`mashing Enter through the intro (SCEA, copyright, crate, title) until the main menu${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
			while (!(s && onMainMenu(s)) && Date.now() - t0 < (s ? 180_000 : 120_000)) {
				if (s && !seen.includes(s.screen)) { seen.push(s.screen); say(`game screen : ${s.screen}${s.menu ? ` (menu ${s.menu.label || '…'})` : ''}`) }
				if (s?.menu?.input) await ctx.press('z')
				else await ctx.press('Enter').catch(() => {})
				await sleep(150)
				s = await state(ctx).catch(() => null)
			}
		}
		s = await until(ctx, 'the main menu', onMainMenu, { timeout: 5000 })
		await shot(ctx, 'menu-after-skip')
		// Enter is the page's : its default is prevented, so macOS plays no « unhandled key » sound
		const prevented = await ctx.js(`const e = new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented`)
		if (!prevented) throw new Error('Enter on the game keeps its default action (macOS « toc » on every press)')
		const seconds = s.vblank / 59.82
		// the original intro plays ~45 s of VBlanks before the menu (LOG ## 2) ; the disc loads stay
		if (seconds > 25) throw new Error(`${seconds.toFixed(1)} s of game time to the menu — the intro was not skipped`)
		return `main menu after ${seconds.toFixed(1)} s of game time from boot (${s.vblank} VBlanks ; ${Math.round((Date.now() - t0) / 1000)} s wall clock with the page load), screens ${seen.join(' → ')}`
	})

	await ctx.scenario('UX-SETTINGS-HOLDS-KEYS', async () => {
		needsMainMenu()
		await until(ctx, 'the main menu', onMainMenu, { timeout: 60_000 })
		// the CTR_ONLINE build opens Settings on its Online tab at boot (the panel's saved state)
		if ((await page(ctx)).settings) await click(ctx, '#ctr-settings header button')
		await ctx.frames(4)
		const row = (await state(ctx)).menu.row
		say('Esc : Settings opens, then ↓ ↓ must not reach the game')
		await ctx.press('Escape')
		await ctx.frames(10)
		const open = await page(ctx)
		if (!open.settings || !open.focusInPanel || !open.blocked) throw new Error(`Esc : ${JSON.stringify(open)}`)
		await shot(ctx, 'settings-open')
		await ctx.press('ArrowDown')
		await ctx.press('ArrowDown')
		await ctx.frames(10)
		const still = (await state(ctx)).menu.row
		if (still !== row) throw new Error(`the game saw the keys while Settings had the focus : row ${row} → ${still}`)
		await ctx.press('Escape')
		await ctx.frames(10)
		const closed = await page(ctx)
		if (closed.settings || closed.blocked) throw new Error(`Esc again : ${JSON.stringify(closed)}`)
		await ctx.press('ArrowDown')
		await until(ctx, 'the cursor to move once Settings is closed', n => n.menu.row !== row, { timeout: 3000 })
		await ctx.press('ArrowUp')
		await until(ctx, 'the cursor back', n => n.menu.row === row, { timeout: 3000 })
		return `Esc opens (focus in the panel, game input held), 2 × ↓ left the cursor on row ${row}, Esc closes and ↓ moves it again`
	})

	await ctx.scenario('UX-REMAP-KEY', async () => {
		needsMainMenu()
		await until(ctx, 'the main menu', onMainMenu, { timeout: 30_000 })
		await menuTo(ctx, 'ADVENTURE', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		await ctx.press('Escape')
		await click(ctx, '[data-tab=controls]')
		await ctx.frames(4)
		await ctx.js(`[...document.querySelectorAll('.seg button')][0].click(); return true`) // Keyboard
		await click(ctx, '.cell[data-button=down]')
		await ctx.frames(4)
		say('Controls › Keyboard : binding Down to S')
		await shot(ctx, 'remap-listening')
		await ctx.press('s')
		await ctx.frames(4)
		const p = await page(ctx)
		const kb = JSON.parse(p.keyboard ?? 'null')
		if (!kb || kb[15] !== SCANCODE_S) throw new Error(`Down not bound to S : ${p.keyboard}`)
		await shot(ctx, 'remap-key-done')
		await ctx.press('Escape')
		await ctx.frames(6)
		// the game reads the new key at its next input update ; ArrowDown is Down no more
		const row = (await state(ctx)).menu.row
		await ctx.press('ArrowDown')
		await ctx.frames(12)
		if ((await state(ctx)).menu.row !== row) throw new Error('ArrowDown still moves the cursor after the remap')
		const path = await menuTo(ctx, 'TIME TRIAL', dir => ctx.press(dir === 'down' ? 's' : 'ArrowUp'))
		const s = await state(ctx)
		if (s.menu.label !== 'TIME TRIAL') throw new Error(`cursor on ${s.menu.label}`)
		await shot(ctx, 'remap-key-moved')
		// back to the defaults through the panel's own button
		await ctx.press('Escape')
		await click(ctx, '[data-tab=controls]')
		await ctx.frames(4)
		await ctx.js(`[...document.querySelectorAll('.seg button')][0].click(); [...document.querySelectorAll('.foot .btn')][0].click(); return true`)
		const reset = await page(ctx)
		await ctx.press('Escape')
		if (reset.keyboard !== null) throw new Error(`reset left ${reset.keyboard}`)
		await menuTo(ctx, 'ADVENTURE', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		return `Down = S (scancode ${kb[15]}) : ArrowDown ignored, S moved ${path.join(' → ')} ; reset restored ArrowDown`
	})

	await ctx.scenario('UX-PAD-TOAST-REMAP', async () => {
		needsMainMenu()
		await until(ctx, 'the main menu', onMainMenu, { timeout: 30_000 })
		say('plugging the virtual pad, waiting for its toast')
		await ctx.pad(0).connect()
		let toast = null
		for (let i = 0; i < 20 && !toast; i++) {
			toast = (await page(ctx)).toasts.find(x => x.family) ?? null
			if (!toast) await sleep(150)
		}
		if (!toast || !/virtual pad/.test(toast.text)) throw new Error(`toast : ${JSON.stringify(toast)}`)
		await shot(ctx, 'pad-toast')
		// Home opens Settings ; Controls shows the pad ; Down ← the pad's top button
		await ctx.pad(0).press('home')
		await ctx.frames(6)
		if (!(await page(ctx)).settings) throw new Error('Home did not open Settings')
		await click(ctx, '[data-tab=controls]')
		await ctx.frames(4)
		say('Home opened Settings ; Controls › Gamepad : binding Down to the top button')
		await ctx.js(`[...document.querySelectorAll('.seg button')][1].click(); return true`) // Gamepad
		await click(ctx, '.cell[data-button=down]')
		await ctx.frames(4)
		await ctx.pad(0).press('y')
		await ctx.frames(6)
		const gp = JSON.parse((await page(ctx)).gamepad ?? 'null')
		if (!gp || gp[15] !== SDL_NORTH) throw new Error(`Down not bound to the top button : ${JSON.stringify(gp)}`)
		await shot(ctx, 'pad-remap-done')
		await ctx.press('Escape')
		await ctx.frames(6)
		const path = await menuTo(ctx, 'ARCADE', dir => ctx.pad(0).press(dir === 'down' ? 'y' : 'up'))
		await shot(ctx, 'pad-remap-moved')
		await ctx.pad(0).press('home')
		await ctx.frames(4)
		await click(ctx, '[data-tab=controls]')
		await ctx.frames(4)
		await ctx.js(`[...document.querySelectorAll('.seg button')][1].click(); [...document.querySelectorAll('.foot .btn')][0].click(); return true`)
		await ctx.press('Escape')
		await menuTo(ctx, 'ADVENTURE', dir => ctx.pad(0).press(dir))
		await ctx.pad(0).disconnect()
		await sleep(400)
		const gone = (await page(ctx)).toasts.map(t => t.text).join(' | ')
		return `toast « ${toast.text} » (${toast.family}) · Down = top button (SDL ${gp[15]}) moved ${path.join(' → ')} · reset · disconnect toast « ${gone} »`
	})

	await ctx.scenario('UX-DROP-OVERLAY', async () => {
		if (!(await state(ctx))) say('waiting for the game to run (the debug build streams its data first)')
		await until(ctx, 'the game to run', s => s.vblank > 0, { timeout: 240_000, every: 500 })
		say('dragging a file across the page, then dropping a file that is not a disc')
		// enter on one element, then move across children : each child fires enter then the
		// parent leave — the overlay must stay up the whole time
		const flips = await ctx.js(`
			let flips = 0; let was = !!document.getElementById('ctr-drop-overlay')
			const mo = new MutationObserver(() => { const now = !!document.getElementById('ctr-drop-overlay'); if (now !== was) { flips++; was = now } })
			mo.observe(document.body, { childList: true, subtree: true })
			window.__uxDrop = { mo, get flips() { return flips } }
			return flips`)
		const seq = [['dragenter', '#canvas'], ['dragenter', '#ctr-ui'], ['dragleave', '#canvas'], ['dragenter', 'body'], ['dragleave', '#ctr-ui'], ['dragover', 'body']]
		for (const [type, target] of seq) { await drag(ctx, type, target); await ctx.frames(2) }
		const up = await page(ctx)
		await shot(ctx, 'drop-overlay-over-game')
		const during = await ctx.js('return window.__uxDrop.flips')
		await drag(ctx, 'dragleave', 'body')
		await ctx.frames(3)
		const down = await page(ctx)
		// a file that is not a disc, dropped on the running game : refused in a toast, game untouched
		await ctx.js(`const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(64)], 'not-a-disc.zip'))
			document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true`)
		await sleep(600)
		const after = await page(ctx)
		await shot(ctx, 'drop-refused-toast')
		await ctx.js('window.__uxDrop.mo.disconnect(); return true')
		if (!up.overlay || during !== 1 || down.overlay) throw new Error(`overlay up ${up.overlay}, ${during} flips while dragging (want 1), down ${!down.overlay}`)
		const refusal = after.toasts.map(t => t.text).join(' | ')
		if (!refusal) throw new Error('no refusal toast for a non-disc drop')
		const s = await state(ctx)
		return `overlay up after ${seq.length} events across children (${during} flip), gone on the last leave (start ${flips}) · non-disc drop : « ${refusal} » · game still ${s.screen}`
	})

	await ctx.scenario('UX-SOUND', async () => {
		// The test browser plays on the host's speakers : every level here is inaudible (0.001).
		const level = () => ctx.js('return window.ctrAudio?.level ?? null')
		const before = await level()
		const stored = await ctx.js(`return [localStorage.getItem('ctr-ui.muted'), localStorage.getItem('ctr-ui.volume')]`)
		say(`sound at start : level ${before}, stored muted ${stored[0]}, volume ${stored[1]}`)
		if (before !== 0) throw new Error(`the harness page should start muted, level ${before}`)
		// touching the volume lifts the harness's forced mute ; the speaker then mutes / unmutes
		await ctx.js(`window.ctrUI.settings.patch({ volume: 0.001, muted: false }); return true`)
		const touched = await level()
		await ctx.js(`document.getElementById('ctr-sound').click(); return true`)
		const off = await level()
		const muted = await ctx.js(`return localStorage.getItem('ctr-ui.muted')`)
		await ctx.js(`document.getElementById('ctr-sound').click(); return true`)
		const on = await level()
		await ctx.js(`window.ctrUI.settings.patch({ muted: true }); localStorage.removeItem('ctr-ui.muted'); localStorage.removeItem('ctr-ui.volume'); return true`)
		if (touched !== 0.001 || off !== 0 || muted !== '1' || on !== 0.001) throw new Error(`levels ${before} → ${touched} → ${off} → ${on}, stored muted ${muted}`)
		return `starts muted under the harness · volume set → ${touched} · speaker → ${off} (stored « muted ») · speaker → ${on} · muted again, storage cleared`
	})

	await ctx.scenario('UX-ONLINE-NAME', async () => {
		if (!onlineBuild) ctx.skip('not a CTR_ONLINE build')
		const t0 = Date.now()
		if (!(await ctx.js('return !!window.Module?.ctrOnlineNet'))) say('waiting for the game and its Online panel (the debug build streams its data first)')
		while (Date.now() - t0 < 240_000 && !(await ctx.js('return !!window.Module?.ctrOnlineNet'))) await sleep(1000)
		if (!(await ctx.js('return !!window.Module?.ctrOnlineNet'))) throw new Error('the Online panel never attached (game not started ?)')
		if (!(await page(ctx)).settings) await ctx.press('Escape')
		await ctx.frames(4)
		const tab = await ctx.js(`return !!document.querySelector('[data-tab=online]')`)
		await click(ctx, '[data-tab=player]')
		await ctx.frames(2)
		await ctx.js(`const n = document.getElementById('ctr-name'); n.value = 'Coco Band'; n.dispatchEvent(new Event('input', { bubbles: true })); return true`)
		await ctx.frames(2)
		const fromSettings = await ctx.js('return [Module.ctrOnlineNet.name, document.getElementById("online-name").value, localStorage.getItem("ctr-online.name")]')
		await shot(ctx, 'online-name-settings')
		await click(ctx, '[data-tab=online]')
		await ctx.frames(4)
		await shot(ctx, 'online-tab')
		// the other way : a script writing the Online panel's own field (the online suite does)
		await ctx.js(`const n = document.getElementById('online-name'); n.value = 'Host'; n.dispatchEvent(new Event('input')); return true`)
		const fromPanel = await ctx.js('return [Module.ctrOnlineNet.name, document.getElementById("ctr-name")?.value ?? null, localStorage.getItem("ctr-online.name"), document.getElementById("online-name").closest("label").offsetParent === null]')
		await ctx.press('Escape')
		if (!tab) throw new Error('no Online tab in Settings')
		if (fromSettings.join() !== 'Coco Band,Coco Band,Coco Band') throw new Error(`Settings → Online : ${fromSettings}`)
		if (fromPanel[0] !== 'Host' || fromPanel[2] !== 'Host') throw new Error(`Online field → Settings : ${fromPanel}`)
		if (!fromPanel[3]) throw new Error('the Online tab still shows its own name field (Settings › Player owns the name)')
		return `Settings name « Coco Band » read by the Online panel (net.name, its field, ctr-online.name) ; the panel's field → « ${fromPanel[0]} » in both`
	})

	await ctx.scenario('UX-MENU-STILL-BOOTS', async () => {
		needsMainMenu()
		// the regular boot helper on top of the new page (what every other suite does)
		const s = await bootToMenu(ctx)
		if (!MAIN_MENU.includes(s.menu.label)) throw new Error(brief(s))
		return brief(s)
	})
}
