// Player suite : Share's bot, « Bot », a scripted guest for testing a Share race alone. Two modes :
//   --set link='<guest link>'  THE BOT (what web/share/bot.sh runs) : this tab opens the guest page
//     in bot mode (?bot), joins as the next free player (P2), and plays until the host stops
//     sharing : at each character select it browses the grid for a few seconds (random d-pad
//     moves) and locks wherever it stops — a random character (user, 2026-10-22) —, in each
//     race it follows the racing line and fires its item every 1.5 s (online.suite.mjs's drive()).
//     It steers by its own kart as the host's game sees it : a debug host sends it (KART / TRACK,
//     web/share/protocol.js) ; its keys go back as the guest's pad over the Share link, like a
//     player's. A release host sends nothing : Cross held (accelerates, locks the character), no
//     steering, until the host leaves.
//   no link  SHARE-BOT-RACE (the DoD) : this tab hosts — main menu, Share — and starts the bot with
//     web/share/bot.sh on agent browser b (BOT_INSTANCE, --set botInstance=), then VS. → 2 players,
//     P1 locks, the bot locks P2, the first track ; P1 drives too (drive() on kart 0). Passes when
//     P2 (drivers[1] on this host) went round every lap and crossed the line, and the bot left on
//     its own once the host stopped sharing. The host's canvas is filmed for the whole race.
//   SHARE-BOT-BLIND : the same host with window.__ctr hidden from the Share panel, as on a release
//     build : the bot gets no kart state, says so, holds Cross — P2's pad on the host reads Cross
//     held — and leaves when the host stops sharing.
//
// RUN (the DoD)
//   Build : web/build-web.sh debug -DCTR_ONLINE=OFF -DCTR_WEB_PRELOAD_DISC=OFF (the disc in agent
//           browser a's OPFS for this origin ; a preloaded 605 MB disc stalls reloads)
//   Serve : python3 web/test/player/serve.py build-web-debug 8091
//   Relay : (cd relay && npm ci && RELAY_KEY=<key> PORT=8788 node relay.js)
//   Play  : bash plans/ctr-native-web/tools/play.sh share-bot <session> 8091 -- \
//             --set relay=ws://localhost:8788 --set rk=<key>
//   Both ports in AGENT_BROWSER_ORIGINS ; agent browser b installed (`wtf agent-browser install b`).
// Not a node --test file.

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HEARTBEAT_MS, PLAYER, bootToMenu, menuTo, recordWithSound, say, state, until } from './ctr.mjs'
import { drive } from './online.suite.mjs'
import { share } from './share.suite.mjs'

export const meta = {
	url: 'http://localhost:8091/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CROSS = 'c' // keyboard C = Cross (the guest page's default keys, native_input.c's)
const RACE_MS = 420_000
const BOT_STATE = 'window.__ctrShareGuest.bot()'
const tree = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** The guest page in one object : the link's state and the bot's view of the host's game. */
const look = js => js(`const g = window.__ctrShareGuest
	if (!g) return { state: 'no page' }
	const s = g.state(); const b = g.bot()
	return { state: s.state, slot: s.slot, path: s.path, message: s.message, host: s.host,
		game: b && !b.gone ? { screen: b.screen, levelID: b.levelID, players: b.players, charSelect: b.charSelect, kart: b.kart,
			line: b.track ? { levelID: b.track.levelID, n: b.track.path.length } : null } : null }`)

/** The bot : joins the guest link in this tab and plays until the host leaves. */
export async function bot(ctx, link) {
	const url = new URL(link)
	url.searchParams.set('bot', '1')
	await ctx.conn.send('Page.navigate', { url: url.href }, ctx.sid)
	say('Bot is joining')

	// The link : connected with a slot (the host's WELCOME), or refused / closed — a dead end.
	const start = Date.now()
	let beat = start + HEARTBEAT_MS
	let g
	for (;;) {
		g = await look(ctx.js).catch(() => ({ state: 'no page' }))
		if (g.state === 'connected' && g.slot > 0) break
		if (g.state === 'refused' || g.state === 'closed') throw new Error(`the host did not take Bot : ${g.message || g.state}`)
		if (Date.now() - start > 60_000) throw new Error(`no slot from the host after 60 s (guest ${g.state}) — is the host sharing, and is this its guest link ?`)
		if (Date.now() >= beat) { say(`still connecting (${Math.round((Date.now() - start) / 1000)} s of 60) : ${g.state}`); beat += HEARTBEAT_MS }
		await sleep(250)
	}
	const slot = g.slot
	const P = `P${slot + 1}`
	say(`joined ${g.host ?? 'the host'}'s game as ${P} (${g.path})`)

	// A debug host answers BOT with KART at its next present ; a release one never does.
	for (const end = Date.now() + 10_000; Date.now() < end && !(g = await look(ctx.js)).game && g.state === 'connected';) await sleep(250)
	if (!g.game) {
		if (g.state !== 'connected') return `the host left before the game (${g.message || g.state})`
		say("the host sends no kart state (a release build, or a page before session 19) : Cross held — it accelerates and locks the character, no steering — until the host leaves")
		await ctx.hold(CROSS)
		try {
			for (beat = Date.now() + HEARTBEAT_MS; (g = await look(ctx.js)).state === 'connected'; await sleep(500)) {
				if (Date.now() >= beat) { say(`blind, Cross held : still in ${g.host ?? 'the host'}'s game`); beat += HEARTBEAT_MS }
			}
		} finally {
			await ctx.release(CROSS)
		}
		return `blind (no kart state from the host) · Cross held until the host left`
	}

	const races = []
	let lastPress = 0
	let locking = false
	let tries = 0
	const DIRS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']
	/** A few random moves on the character grid, ~0.4 s apart : the browse, then the pick. */
	const browse = async (moves) => {
		for (let i = 0; i < moves; i++) {
			await ctx.press(DIRS[Math.floor(Math.random() * DIRS.length)])
			await sleep(400)
		}
	}
	beat = Date.now() + HEARTBEAT_MS
	for (;;) {
		g = await look(ctx.js)
		if (g.state !== 'connected') break
		const s = g.game
		const lockedMine = s?.charSelect && (s.charSelect.locked >> slot) & 1
		if (s?.charSelect && !lockedMine) {
			// the character select : browse, then Cross until ours is locked (a press landing as it
			// opens is lost ; a character the other player holds may refuse it : move on after 3)
			if (!locking) {
				say(`character select : ${P} browses the characters`)
				await sleep(800)
				await browse(4 + Math.floor(Math.random() * 7))
				tries = 0
			} else if (tries >= 3) {
				await browse(1 + Math.floor(Math.random() * 3))
				tries = 0
			}
			locking = true
			if (Date.now() - lastPress > 1500) { await ctx.press(CROSS); lastPress = Date.now(); tries++ }
		} else if (s?.kart && !s.kart.finished && (s.screen === 'countdown' || s.screen === 'race') && s.line?.levelID === s.levelID && s.line.n >= 10) {
			say(`racing on level ${s.levelID} (${s.line.n} line points)`)
			const r = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, Date.now() + RACE_MS, BOT_STATE)
			races.push(r)
			say(`race ${races.length} : ${r.finished ? `finished, rank ${r.rank + 1}` : 'did not finish'}, fired ${r.fired}×`)
			beat = Date.now() + HEARTBEAT_MS
			continue
		} else {
			if (locking && lockedMine) say(`${P}'s character locked : waiting for the race`)
			locking = false
		}
		if (Date.now() >= beat) {
			const where = s ? `${s.screen}${s.charSelect ? ', character select' : ''}` : 'no state'
			say(`in ${g.host ?? 'the host'}'s game as ${P} : host on ${where} — ${races.length} race(s) so far`)
			beat += HEARTBEAT_MS
		}
		await sleep(250)
	}
	const done = races.map((r, i) => `race ${i + 1} ${r.finished ? `finished, rank ${r.rank + 1}` : 'unfinished'}, fired ${r.fired}×`)
	return `the host left (${g.message || g.state}) · ${races.length} race(s)${done.length ? ` : ${done.join(' ; ')}` : ''}`
}

/** web/share/bot.sh on agent browser `instance`, its output prefixed ; resolves with its exit code and output. */
function startBot(link, instance) {
	const child = spawn('bash', [join(tree, 'web/share/bot.sh'), link], { env: { ...process.env, BOT_INSTANCE: instance } })
	const out = []
	for (const s of [child.stdout, child.stderr]) {
		let rest = ''
		s.on('data', d => {
			const lines = (rest + d).split('\n')
			rest = lines.pop()
			for (const l of lines) { out.push(l); console.log(`      bot | ${l}`) }
		})
	}
	const exited = new Promise(r => child.on('close', code => r({ code, out: out.join('\n') })))
	return { child, exited }
}

/** Waits on `fn` (a truthy result) with a heartbeat ; `dead()` says why to stop early. */
async function waitFor(label, fn, timeout, dead = () => null) {
	const start = Date.now()
	let beat = start + HEARTBEAT_MS
	let last
	while (Date.now() - start < timeout) {
		const why = dead()
		if (why) throw new Error(`${why} while waiting for ${label}`)
		if ((last = await fn())) return last
		if (Date.now() >= beat) { say(`still waiting for ${label} (${Math.round((Date.now() - start) / 1000)} s of ${Math.round(timeout / 1000)})`); beat += HEARTBEAT_MS }
		await sleep(300)
	}
	throw new Error(`timed out after ${Math.round(timeout / 1000)} s waiting for ${label}`)
}

async function hostRace(ctx) {
	await bootToMenu(ctx)
	const link = await share(ctx)
	const instance = ctx.args.botInstance ?? 'b'
	say(`starting the bot on agent browser ${instance} : web/share/bot.sh '<guest link>'`)
	const b = startBot(link, instance)
	let exit = null
	b.exited.then(e => { exit = e })
	const dead = () => (exit ? `the bot exited (${exit.code})` : null)
	try {
		const guest = await waitFor('Bot to stream as P2', async () => (await ctx.js('return window.__ctrShare.state().guests')).find(x => x.state === 'streaming' && x.name === 'Bot'), 180_000, dead)
		if (guest.slot !== 1) throw new Error(`Bot took slot ${guest.slot}, not P2`)

		// VS. → single race → 2 players (open since P2's pad is plugged) → the character select
		await menuTo(ctx, 'VS.', dir => ctx.press(dir === 'down' ? 'ArrowDown' : 'ArrowUp'))
		for (let i = 0; i < 3; i++) {
			await ctx.press(CROSS)
			await ctx.frames(15)
		}
		await until(ctx, 'the character select', s => s.charSelect != null, { timeout: 10_000 }) // `players` is the last race's until the next one loads
		await sleep(1000)
		for (let i = 0; i < 6 && !((await state(ctx)).charSelect?.locked & 1); i++) {
			await ctx.press(CROSS)
			await sleep(800)
		}
		await waitFor("the bot to lock P2's character", async () => { const s = await state(ctx); return !s.charSelect || s.charSelect.locked & 2 }, 30_000, dead)
		say('both characters locked : the first track')
		let s = await state(ctx)
		for (let i = 0; i < 16 && s.screen === 'menu'; i++) {
			if (!s.charSelect) await ctx.press(CROSS)
			await sleep(700)
			s = await state(ctx)
		}
		s = await until(ctx, 'the race to load', n => n.screen !== 'menu' && n.screen !== 'loading' && n.karts?.length >= 2, { timeout: 90_000, every: 500 })
		const laps = s.numLaps
		say(`race on level ${s.levelID}, ${laps} laps : P1 drives here, Bot drives P2 from browser ${instance}`)

		let p2 = { lap: 0, finished: false }
		let p1 = null
		let maxLap = 0
		await recordWithSound(ctx, 'share-bot-race', async () => {
			const deadline = Date.now() + RACE_MS
			const watch = (async () => {
				let beat = Date.now() + HEARTBEAT_MS
				while (Date.now() < deadline && !dead()) {
					const k = (await state(ctx))?.karts?.[1]
					if (k) {
						p2 = k
						if (k.lap > maxLap) { maxLap = k.lap; say(`P2 (Bot) on lap ${k.lap + 1} of ${laps}`) }
						if (k.finished) return
					}
					if (Date.now() >= beat) { say(`P2 : lap ${(k?.lap ?? 0) + 1}, speed ${k?.speed}, rank ${(k?.rank ?? 0) + 1}`); beat += HEARTBEAT_MS }
					await sleep(500)
				}
			})()
			p1 = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, deadline)
			await watch
		})
		await ctx.shot('race-end')
		if (!p2.finished) throw new Error(`P2 did not finish : lap ${p2.lap + 1} of ${laps}${dead() ? `, ${dead()}` : ''}`)
		if (maxLap < laps - 1) throw new Error(`P2 finished without its laps counted (${maxLap + 1} of ${laps})`)

		// the host stops sharing : the bot sees it leave and stops on its own
		await ctx.js("document.getElementById('share-stop').click(); return true")
		const e = await Promise.race([b.exited, sleep(60_000).then(() => null)])
		if (!e) throw new Error('the bot did not leave within 60 s of the host stopping')
		if (e.code !== 0) throw new Error(`the bot exited ${e.code}`)
		if (!/race 1 : finished/.test(e.out)) throw new Error('the bot did not report its race finished')
		return `Bot as P2 over ${guest.path} · ${laps} laps : P2 crossed the line, rank ${p2.rank + 1} · P1 ${p1.finished ? `finished, rank ${p1.rank + 1}` : 'did not finish'} · the bot left with the host`
	} finally {
		if (!exit) b.child.kill('SIGINT')
	}
}

/** A host with no window.__ctr (a release build's Share panel) : the bot falls back to Cross held. */
async function hostBlind(ctx) {
	if (!(await state(ctx))) await bootToMenu(ctx)
	// what panel.js reads : the bridge's writes are dropped while this runs
	await ctx.js("Object.defineProperty(globalThis, '__ctr', { get() {}, set() {}, configurable: true }); return true")
	const b = { child: null }
	let exit = null
	try {
		const link = await share(ctx)
		Object.assign(b, startBot(link, ctx.args.botInstance ?? 'b'))
		b.exited.then(e => { exit = e })
		const dead = () => (exit ? `the bot exited (${exit.code})` : null)
		const CROSS_BIT = 0x4000 // active low in the pad word
		const pad = await waitFor("P2's Cross held on the host", async () => {
			const p = (await ctx.js('return window.__ctrShare.state().pads'))[1]
			return p && !(p.buttons & CROSS_BIT) ? p : null
		}, 120_000, dead)
		await ctx.js("document.getElementById('share-stop').click(); return true")
		const e = await Promise.race([b.exited, sleep(60_000).then(() => null)])
		if (!e) throw new Error('the bot did not leave within 60 s of the host stopping')
		if (e.code !== 0) throw new Error(`the bot exited ${e.code}`)
		if (!/no kart state/.test(e.out) || !/blind/.test(e.out)) throw new Error('the bot did not say it went blind')
		return `no kart state from the host : P2's pad word 0x${pad.buttons.toString(16)} (Cross held) · the bot left with the host`
	} finally {
		if (b.child && !exit) b.child.kill('SIGINT')
		await ctx.js('delete globalThis.__ctr; return true')
	}
}

export default async ctx => {
	if (ctx.args.link) await ctx.scenario('SHARE-BOT', () => bot(ctx, ctx.args.link))
	else {
		await ctx.scenario('SHARE-BOT-RACE', () => hostRace(ctx))
		await ctx.scenario('SHARE-BOT-BLIND', () => hostBlind(ctx))
	}
}
