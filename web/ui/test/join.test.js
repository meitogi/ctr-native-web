// The home page's room code (src/lib/join.js) : the dials' rules — the game's own JOIN — and the
// look for the room on a real ctr-relay, which says its kind before any disc is asked for.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRelay } from '../../../relay/relay.js'
import { ROOM_KIND, codeRoom, roomKind } from '../../net/code.js'
import { openRoom } from '../../net/room.js'
import { SAID, findRoom, press } from '../src/lib/join.js'
import { PICTOS } from '../src/lib/pictos.js'

const RK = 'relay-key-for-tests'
let relay
let full
let where
before(async () => {
  relay = await createRelay({ port: 0, host: '127.0.0.1', key: RK, log: () => {} })
  full = await createRelay({ port: 0, host: '127.0.0.1', key: RK, roomMax: 1, log: () => {} })
  where = { relay: `ws://127.0.0.1:${relay.port}`, rk: RK }
})
after(() => Promise.all([relay.close(), full.close()]))

test('the dials : Up / Down turn and wrap, Left / Right change dial, Right past the last adds one, Square takes it away', () => {
  let d = { ids: [0, 0, 0], at: 0 }
  d = press(d, 'up')
  assert.deepEqual([d.ids, d.at, d.changed], [[14, 0, 0], 0, true])
  d = press(d, 'down')
  d = press(d, 'down')
  assert.deepEqual(d.ids, [1, 0, 0])
  assert.equal(press(d, 'left').at, 0) // already on the first
  d = press(press(d, 'right'), 'right')
  assert.deepEqual([d.at, d.changed], [2, false])
  d = press(d, 'right')
  assert.deepEqual([d.ids, d.at, d.changed], [[1, 0, 0, 0], 3, true])
  d = press(press(d, 'right'), 'right')
  assert.deepEqual([d.ids.length, d.at], [5, 4]) // five at most
  d = press(d, 'square')
  assert.deepEqual([d.ids.length, d.at], [4, 3])
  d = press(press(d, 'square'), 'square')
  assert.deepEqual([d.ids, d.at], [[1, 0, 0], 2]) // three at least
})

test('the dials : Start joins from any dial, Cross only on the last one (it steps right before)', () => {
  const d = { ids: [3, 2, 1], at: 0 }
  assert.equal(press(d, 'start').join, true)
  const stepped = press(d, 'cross')
  assert.deepEqual([stepped.at, stepped.join], [1, false])
  assert.equal(press({ ...d, at: 2 }, 'cross').join, true)
  assert.equal(press({ ...d, at: 2 }, 'cross').ids.length, 3) // Cross never adds a dial
})

test('a picture per character, each its own', () => {
  assert.equal(PICTOS.length, 15)
  assert.equal(new Set(PICTOS).size, 15)
  for (const svg of PICTOS) assert.doesNotMatch(svg, /<script|href=/)
})

test('findRoom : a Share room and a Netplay room are told apart by the host\'s name on the relay, before anything is joined', async () => {
  for (const [kind, ids] of [['share', [0, 3, 2]], ['netplay', [1, 1, 4, 7]]]) {
    const link = await codeRoom(ids, where)
    const host = await openRoom({ link, role: 'host', name: ROOM_KIND[kind] })
    const found = await findRoom(ids, where)
    assert.equal(found.kind, kind)
    // the room as a link carries it, without the host's pass : this guest will knock
    assert.deepEqual([found.link.room, found.link.key, found.link.code, found.link.pass], [link.room, link.key, link.code, ''])
    host.close()
  }
})

test('roomKind : a host from before the kinds (its name is its player\'s) is a Netplay room ; nobody hosting is no room', () => {
  assert.equal(roomKind([{ id: 'a', kind: 'host', name: 'Bee' }, { id: 'b', kind: 'guest', name: ROOM_KIND.share }]), 'netplay')
  assert.equal(roomKind([{ id: 'b', kind: 'guest', name: '' }]), null)
  assert.equal(roomKind([]), null)
  assert.ok(ROOM_KIND.share.length > 9 && ROOM_KIND.netplay.length > 9) // longer than a player's name
})

test('findRoom : what fails, in the game\'s own numbers', async () => {
  const saidOf = (p) => p.then(() => 'found', (e) => e.said)
  assert.equal(await saidOf(findRoom([0, 0, 0], where)), SAID.noRoom)
  assert.equal(await saidOf(findRoom([0, 0, 0], { relay: where.relay, rk: '' })), SAID.noKey)
  assert.equal(await saidOf(findRoom([0, 0, 0], { relay: where.relay, rk: 'wrong' })), SAID.keyRefused)
  assert.equal(await saidOf(findRoom([0, 0, 0], { relay: 'ws://127.0.0.1:1', rk: RK })), SAID.offline)
  // a relay that takes one peer per room : the host fills it, the look is refused
  const there = { relay: `ws://127.0.0.1:${full.port}`, rk: RK }
  const host = await openRoom({ link: await codeRoom([5, 5, 5], there), role: 'host', name: ROOM_KIND.netplay })
  assert.equal(await saidOf(findRoom([5, 5, 5], there)), SAID.full)
  host.close()
})
