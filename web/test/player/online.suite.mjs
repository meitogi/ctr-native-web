// Player suite : Online 2-tab : two pages race over P2P, then over the forced WebSocket path (openRoom mode: ws).
//
// Placeholder until its session lands : every scenario SKIPS with the reason
// below. The session that delivers the mode replaces the skip with the real
// scenario, on its page and debug getters as they are on web/main, and keeps
// window.__ctr (web/test/player/ctr.mjs) for the game state of each tab.
//
// RUN
//   Play  : bash plans/ctr-native-web/tools/play.sh online <session> 8093
// Not a node --test file : `node --test web/test/*.test.js` never loads it.

import { PLAYER } from './ctr.mjs'

export const meta = {
	url: 'http://localhost:8093/index.html',
	login: false,
	player: PLAYER,
}

const REASON = 'session 9 (onlinectr-web) has not landed on web/main : no Online page or debug getters to drive yet'

export default async ctx => {
	for (const id of ['ONLINE-2TAB-P2P', 'ONLINE-2TAB-WS']) await ctx.scenario(id, async () => ctx.skip(REASON))
}
