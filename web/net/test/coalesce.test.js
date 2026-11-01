// The WebSocket link's coalescing, its lossy flag and the keepalive (web/net/transport.js),
// over a real ctr-relay : what a host sends in one task leaves as one relay message to a guest
// that announced batches, and comes out as the same payloads, in order.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { createRelay } from '../../../relay/relay.js';
import { formatRoomLink, newRoom } from '../link.js';
import { openRoom } from '../room.js';
import { KEEPALIVE_MS } from '../transport.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let relay;
let url;
const relayMessages = [];

/** A WebSocket that records the relay frames this page sends. */
class Tap extends WebSocket {
  send(data) {
    try { const m = JSON.parse(data); if (m.type === 'data') relayMessages.push(m); } catch { /* not ours */ }
    return super.send(data);
  }
}

before(async () => {
  relay = await createRelay({ port: 0, host: '127.0.0.1', log: () => {}, stats: true });
  url = `ws://127.0.0.1:${relay.port}`;
});
after(() => relay.close());

test('one task of sends = one relay message ; split again, in order ; lossy only when all are unreliable', async () => {
  const link = formatRoomLink('https://game.example/', newRoom({ relay: url }));
  const host = await openRoom({ link, role: 'host', name: 'host', WebSocketImpl: Tap });
  const guest = await openRoom({ link, role: 'guest', mode: 'ws', name: 'g' });
  const toHost = await guest.connect();
  await sleep(200);
  const toGuest = host.links[guest.selfId];
  assert.equal(toGuest.batching, true, 'the guest announced it reads batches');
  const got = [];
  toHost.on('message', (b) => got.push([...b]));

  relayMessages.length = 0;
  for (let i = 0; i < 5; i++) toGuest.send(Uint8Array.of(0x20, 7, i));
  await sleep(100);
  assert.equal(relayMessages.length, 1, 'five sends, one relay message');
  assert.equal(relayMessages[0].lossy, true);
  assert.deepEqual(got, [0, 1, 2, 3, 4].map((i) => [0x20, 7, i]));

  relayMessages.length = 0;
  got.length = 0;
  toGuest.send(Uint8Array.of(1));
  toGuest.send(Uint8Array.of(2), { reliable: true });
  toGuest.send(Uint8Array.of(3));
  await sleep(100);
  assert.equal(relayMessages.length, 1);
  assert.equal(relayMessages[0].lossy, undefined, 'a reliable payload inside : never lossy');
  assert.deepEqual(got, [[1], [2], [3]]);
  host.close();
  guest.close();
});

test('a quiet link keeps sending keepalives ; lastSeen follows them on the other side', async () => {
  const link = formatRoomLink('https://game.example/', newRoom({ relay: url }));
  const host = await openRoom({ link, role: 'host', name: 'host' });
  const guest = await openRoom({ link, role: 'guest', mode: 'ws', name: 'g' });
  const toHost = await guest.connect();
  await sleep(200);
  const toGuest = host.links[guest.selfId];
  const messages = [];
  toHost.on('message', (b) => messages.push(b));
  await sleep(KEEPALIVE_MS * 4);
  assert.ok(performance.now() - toGuest.lastSeen < KEEPALIVE_MS * 2, `host last heard the guest ${Math.round(performance.now() - toGuest.lastSeen)} ms ago`);
  assert.ok(performance.now() - toHost.lastSeen < KEEPALIVE_MS * 2);
  assert.equal(messages.length, 0, 'keepalives are not messages');
  host.close();
  guest.close();
});
