// Player suite : a fake Online guest, « Bot », for testing a race alone. You host in your own
// browser ; this suite's tab (the agent browser) opens your room link in bot mode (?bot), its
// game joins your room, and it plays until you leave : at each character select of your menus
// it browses the grid for a few seconds (random d-pad moves) and locks wherever it stops — its
// keys reach your game as P2's pad, as Share's bot does (web/test/player/share-bot.suite.mjs) —,
// then in each race it drives its own game along the racing line and fires its items every
// 1.5 s (online.suite.mjs's drive()). It steers by its own game (window.__ctr, debug builds) ;
// the character pick needs a debug host (it sends the bot its cursor state, KART / TRACK).
//
// RUN : web/online/bot.sh '<room link>' (it brings the agent browser up and calls e2e.mjs).
//   The page and the relay must be on ports the agent browser's proxy opens
//   (AGENT_BROWSER_ORIGINS) : web/dev.sh dev relay=local (8090 + 8787).
//   Start it once your room exists ; it joins, then follows your menus.
// Not a node --test file.

import { HEARTBEAT_MS, PLAYER, say } from './ctr.mjs'
import { PHASE, boot, drive, online, until } from './online.suite.mjs'
import { createPicker } from '../../ui/src/lib/autopilot.js'

export const meta = {
	url: 'http://localhost:8092/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const RACE_MS = 420_000

/** The page in one object : the room, the lobby phase and the bot's view of the host's menus. */
const look = js => js(`const o = window.__ctrOnline
	if (!o) return { state: 'no page' }
	const s = o.state(); const b = o.bot()
	return { state: s.share?.state ?? 'idle', slot: s.share?.slot ?? 0, media: !!s.share?.media, path: s.links[0]?.path ?? null,
		phase: s.lobby.phase, active: s.lobby.active, curr: s.octr?.CurrState ?? null, host: s.share?.list?.[0]?.name ?? null,
		game: b && !b.gone ? { screen: b.screen, charSelect: b.charSelect, kart: b.kart } : null, gone: !!b?.gone }`)

export async function bot(ctx) {
	const link = ctx.args.link
	if (!link) throw new Error("no room link : --set link='<the link from your Online panel>'")
	const tab = { name: 'bot', js: ctx.js, press: ctx.press, frames: ctx.frames, navigate: url => ctx.conn.send('Page.navigate', { url }, ctx.sid) }
	const url = new URL(link)
	url.searchParams.set('bot', '1')

	// One origin, one localStorage : the name is read when the room connects. A small
	// same-origin file first : a fresh tab has no storage of its own yet.
	await tab.navigate(new URL('/preload-flag.js', link).href)
	for (let i = 0; i < 20 && !(await ctx.js('return location.origin').catch(() => '')).startsWith('http'); i++) await sleep(250)
	await ctx.js(`localStorage.setItem('ctr-online.name', 'Bot'); return true`)
	say('booting the game (the disc goes into this browser once)')
	await boot(tab, url.href)

	say('joining your room')
	const start = Date.now()
	let beat = start + HEARTBEAT_MS
	let g
	for (;;) {
		g = await look(ctx.js).catch(() => ({ state: 'no page' }))
		if (g.state === 'connected' && g.slot > 0 && g.active) break
		if (g.state === 'refused' || g.state === 'closed') throw new Error(`the host did not take Bot : ${g.state}`)
		if (Date.now() - start > 120_000) throw new Error(`not in the room after 120 s (share ${g.state}, slot ${g.slot}, game ${g.curr}) — is the host's room open, and is this its link ?`)
		if (Date.now() >= beat) { say(`still joining (${Math.round((Date.now() - start) / 1000)} s of 120) : share ${g.state}, game state ${g.curr}`); beat += HEARTBEAT_MS }
		await sleep(250)
	}
	const P = `P${g.slot + 1}`
	say(`in ${g.host ?? 'the host'}'s room as ${P} (${g.path}${g.media ? '' : ', no picture'})`)

	const races = []
	const picker = createPicker({ out: { press: ctx.press } })
	beat = Date.now() + HEARTBEAT_MS
	for (;;) {
		g = await look(ctx.js)
		if (g.state !== 'connected' || g.gone || !g.active) break
		const s = g.game
		const slot = g.slot
		if (g.phase === PHASE.menus && s?.charSelect && !((s.charSelect.locked >> slot) & 1)) {
			if ((await picker.step(s.charSelect, slot)) === 'browse') say(`character select on the host : ${P} browses the characters`)
		} else if (g.phase === PHASE.race && (await ctx.js('return !!window.__ctr?.track && (window.__ctr.screen === "countdown" || window.__ctr.screen === "race")'))) {
			say(`racing on my own game (race ${races.length + 1})`)
			const r = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, Date.now() + RACE_MS)
			races.push(r)
			say(`race ${races.length} : ${r.finished ? `finished, rank ${r.rank + 1}` : 'did not finish'}, fired ${r.fired}×`)
			await ctx.shot(`race-${races.length}-end`)
			// the results, then everyone back to the lobby
			for (const end = Date.now() + 120_000; Date.now() < end && (await look(ctx.js)).phase === PHASE.race; await sleep(500));
			beat = Date.now() + HEARTBEAT_MS
			continue
		} else if ((await picker.step(g.phase === PHASE.menus ? s?.charSelect : null, slot)) === 'locked') say(`${P}'s character locked : waiting for the host's track`)
		if (Date.now() >= beat) {
			say(`in ${g.host ?? 'the host'}'s room as ${P} : phase ${g.phase}, game state ${g.curr}${s ? `, host on ${s.screen}${s.charSelect ? ' (character select)' : ''}` : ''} — ${races.length} race(s) so far`)
			beat += HEARTBEAT_MS
		}
		await sleep(250)
	}
	const done = races.map((r, i) => `race ${i + 1} ${r.finished ? `finished, rank ${r.rank + 1}` : 'unfinished'}, fired ${r.fired}×`)
	return `the host left (${g.state}) · ${races.length} race(s)${done.length ? ` : ${done.join(' ; ')}` : ''}`
}

export default async ctx => {
	await ctx.scenario('ONLINE-BOT', () => bot(ctx))
}
