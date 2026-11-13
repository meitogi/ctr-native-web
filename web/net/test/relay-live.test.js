// A relay's public counters (../relay-live.js) : its /live address, and nothing but a well-formed
// answer reaches the page.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createRelay } from '../../../relay/relay.js';
import { fetchLive, liveOf, liveUrlOf } from '../relay-live.js';

test('the /live address of a relay', () => {
  assert.equal(liveUrlOf('wss://ctr.public.suuuper.app'), 'https://ctr.public.suuuper.app/live');
  assert.equal(liveUrlOf(' wss://ctr.public.suuuper.app/ '), 'https://ctr.public.suuuper.app/live');
  assert.equal(liveUrlOf('ws://localhost:8788'), 'http://localhost:8788/live');
  for (const bad of ['', 'https://x.org', 'wss://x.org/room', 'wss://', 'javascript:alert(1)', undefined, null, 42]) assert.equal(liveUrlOf(bad), null, String(bad));
});

test('only an answer with the four counters, whole and not negative, is kept ; nothing else of it', () => {
  const good = { players: 3, rooms: 1, peakPlayers: 9, peakRooms: 4, since: 'x', kicked: { idle: 2 } };
  assert.deepEqual(liveOf(good), { players: 3, rooms: 1, peakPlayers: 9, peakRooms: 4 });
  for (const bad of [null, 'ok', [], { players: 3, rooms: 1, peakPlayers: 9 }, { ...good, rooms: -1 }, { ...good, players: 1.5 }, { ...good, players: '3' }]) {
    assert.equal(liveOf(bad), null, JSON.stringify(bad));
  }
});

test('fetchLive : a relay with /live, one without, one down', async () => {
  const on = await createRelay({ port: 0, host: '127.0.0.1', log: () => {}, live: true });
  assert.deepEqual(await fetchLive(`ws://127.0.0.1:${on.port}`), { players: 0, rooms: 0, peakPlayers: 0, peakRooms: 0 });
  const port = on.port;
  await on.close();
  const off = await createRelay({ port: 0, host: '127.0.0.1', log: () => {} });
  assert.equal(await fetchLive(`ws://127.0.0.1:${off.port}`), null);
  await off.close();
  assert.equal(await fetchLive(`ws://127.0.0.1:${port}`), null);
  const slow = () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 50));
  assert.equal(await fetchLive('wss://x.org', { fetch: slow }), null);
});
