// A room's code typed on the home page, before the game starts (session 28b) : the dials' rules
// — the game's own JOIN, game/230/MM_MenuFlow.c NetplayJoin_Frame — and the look for the room,
// which says its kind before any disc is asked for. Free of the DOM : node tests it
// (test/join.test.js) ; main.js and Join.svelte wire it.
import { CODE_MAX, CODE_MIN, CODE_NAMES, codeText, roomFromCode, roomKind } from '../../../net/code.js'
import { lookRoom } from '../../../net/signaling.js'

/**
 * Why a code did not join : the numbers of the game's NETPLAY screens (web/online/page.js NP), Share's
 * two, then a public relay's (NP again) — at its limit, too many sockets from this address.
 */
export const SAID = { noKey: 10, keyRefused: 11, offline: 12, noRoom: 13, full: 14, refused: 15, hostLeft: 16, noDirect: 17, relayFull: 18, tooMany: 20 }
const SAID_OF = { 'relay-key': SAID.keyRefused, 'room-full': SAID.full, 'relay-full': SAID.relayFull, 'relay-address': SAID.tooMany }

/** The relay (and its key) the Netplay settings use when none was typed (web/net/relay-default.js, the one source). */
export { DEFAULT_RELAY, DEFAULT_RELAY_KEY, keptRelay } from '../../../net/relay-default.js'

/**
 * One press on the dials. `key` : 'up' | 'down' | 'left' | 'right' | 'cross' | 'square' | 'start'.
 * Up / Down turn the dial in hand, Left / Right change dial, Right past the last one adds a dial
 * (five at most), Square takes the last one away, Start — or Cross on the last dial — joins.
 * @param {{ids: number[], at: number}} d
 * @returns {{ids: number[], at: number, join: boolean, changed: boolean}} `changed` : the code itself moved
 */
export function press(d, key) {
  const ids = d.ids.slice()
  const count = ids.length
  const last = count - 1
  let at = d.at
  let join = false
  let changed = false
  if (key === 'up' || key === 'down') {
    ids[at] = (ids[at] + CODE_NAMES.length + (key === 'up' ? -1 : 1)) % CODE_NAMES.length
    changed = true
  } else if (key === 'left') {
    if (at > 0) at--
  } else if (key === 'start' || (key === 'cross' && at === last)) {
    join = true
  } else if (key === 'right' || key === 'cross') {
    if (at < last) at++
    else if (key === 'right' && count < CODE_MAX) {
      ids.push(0)
      at++
      changed = true
    }
  } else if (key === 'square' && count > CODE_MIN) {
    ids.pop()
    if (at > last - 1) at = last - 1
    changed = true
  }
  return { ids, at, join, changed }
}

const said = (status) => Object.assign(new Error(`room code : ${status}`), { said: status })

/**
 * The room a code names, and its kind, asked of the relay without joining it.
 * @param {number[]} ids
 * @param {{relay: string, rk: string}} where - the relay (Settings › Netplay's) and its key, '' when it has none
 * @param {object} [o] - lookRoom's options (tests)
 * @returns {Promise<{kind: 'share' | 'netplay', link: object}>} `link` : the room as a room link
 *   carries it, without a pass — its guest knocks ; rejects with `said` (SAID)
 */
export async function findRoom(ids, { relay, rk }, o) {
  if (!relay) throw said(SAID.noKey)
  const target = await roomFromCode(ids)
  let peers
  try {
    peers = await lookRoom(relay, rk, target.room, o)
  } catch (e) {
    throw said(SAID_OF[e.code] ?? SAID.offline)
  }
  const kind = roomKind(peers)
  if (!kind) throw said(SAID.noRoom)
  return { kind, link: { ...target, relay, rk, signaling: ['relay'], mqtt: [], code: codeText(ids), pass: '' } }
}
