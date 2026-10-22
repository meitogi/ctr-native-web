// Player suite : a fake Online guest, « Bot », for testing a race alone. You host in your own
// browser ; this suite's tab (the agent browser) opens your room link, joins the room that
// already has a player (yours), waits for your track and laps, locks a character, then drives
// ONE race : the racing line (pure pursuit, online.suite.mjs's drive()) with its items fired
// every 1.5 s on a debug build, Cross held and Circle mashed on a release build (no __ctr).
//
// RUN : web/online/bot.sh '<room link>' (it brings the agent browser up and calls e2e.mjs).
//   The page and the relay must be on ports the agent browser's proxy opens
//   (AGENT_BROWSER_ORIGINS) : web/online/dev.sh debug 8092 8787.
//   Start it once you are in your room, before you confirm the track.
// Not a node --test file.

import { PLAYER, say } from './ctr.mjs'
import { ST, boot, drive, online, until } from './online.suite.mjs'

export const meta = {
	url: 'http://localhost:8092/index.html',
	login: false,
	player: PLAYER,
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const CROSS = 'c'
const FIRE = 'v'
const WAIT_MS = 600_000
const RACE_MS = 360_000

export async function bot(ctx) {
	const link = ctx.args.link
	if (!link) throw new Error("no room link : --set link='<the link from your Online panel>'")
	const tab = { name: 'bot', js: ctx.js, press: ctx.press, navigate: url => ctx.conn.send('Page.navigate', { url }, ctx.sid) }

	// One origin, one localStorage : the name is read when the room connects. A small
	// same-origin file first : a fresh tab has no storage of its own yet.
	await tab.navigate(new URL('/preload-flag.js', link).href)
	for (let i = 0; i < 20 && !(await ctx.js('return location.origin').catch(() => '')).startsWith('http'); i++) await sleep(250)
	await ctx.js(`localStorage.setItem('ctr-online.name', 'Bot'); return true`)
	say('booting the game (the disc goes into this browser once)')
	await boot(tab, link)
	say('in the room list : waiting for a room with a player in it')

	const rooms = await until(tab, 'a room with a player in it (enter yours)', s => s.octr.CurrState === ST.PICK_ROOM && s.octr.clientCount.some(c => c > 0), WAIT_MS, 500)
	const room = rooms.octr.clientCount.findIndex(c => c > 0)
	say(`joining room ${room}`)
	for (let i = 0; i < room; i++) {
		await ctx.press('ArrowDown')
		await ctx.frames(8)
	}
	await ctx.press(CROSS)
	await until(tab, `room ${room} joined`, s => s.octr.CurrState === ST.GUEST_TRACK_WAIT, 15_000)
	if ((await online(tab)).octr.serverRoom !== room) throw new Error(`joined room ${(await online(tab)).octr.serverRoom}, not ${room}`)

	say('in your room : waiting for your track and laps')
	await until(tab, 'the character pick (pick the track and laps)', s => s.octr.CurrState === ST.CHARACTER_PICK, WAIT_MS, 500)
	// A press landing while the menu opens is lost : press again until locked.
	for (let i = 0; i < 6 && (await online(tab)).octr.CurrState === ST.CHARACTER_PICK; i++) {
		await ctx.press(CROSS)
		await sleep(1500)
	}
	say('character locked : waiting for the race')
	await until(tab, 'the race (SG_STARTRACE)', s => s.octr.CurrState === ST.START_RACE, WAIT_MS, 500)

	say('racing')
	const deadline = Date.now() + RACE_MS
	if (await ctx.js('return !!window.__ctr?.track')) {
		const r = await drive({ hold: ctx.hold, release: ctx.release, press: ctx.press }, ctx.js, deadline)
		await ctx.shot('race-end')
		return `racing line · ${r.finished ? `finished, rank ${r.rank + 1}` : 'did not finish in time'} · fired ${r.fired}×`
	}
	// Release build : no kart position to steer by.
	let fired = 0
	await ctx.hold(CROSS)
	try {
		while (Date.now() < deadline) {
			const o = (await online(tab)).octr
			if (o.numDriversEnded >= o.NumDrivers) break
			await ctx.press(FIRE)
			fired++
			await sleep(1500)
		}
	} finally {
		await ctx.release(CROSS)
	}
	await ctx.shot('race-end')
	return `blind (release build, no __ctr) · Cross held, fired ${fired}×`
}

export default async ctx => {
	await ctx.scenario('ONLINE-BOT', () => bot(ctx))
}
