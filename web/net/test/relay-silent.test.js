// A relay that never answers, and the relay / key check (session 32e) : a real ctr-relay, a TCP
// port that accepts and stays silent, and a closed one.
import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import { createRelay } from '../../../relay/relay.js';
import { roomKeys } from '../crypto.js';
import { newRoom } from '../link.js';
import { probeRelay, relaySignaling } from '../signaling.js';

const RK = 'relay-key-for-tests';
let relay;
let relayUrl;
let silent;
let silentUrl;
let closedUrl;

before(async () => {
  relay = await createRelay({ port: 0, host: '127.0.0.1', key: RK, log: () => {} });
  relayUrl = `ws://127.0.0.1:${relay.port}`;
  silent = createServer(() => {}); // takes the connection, never answers the upgrade
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  silentUrl = `ws://127.0.0.1:${silent.address().port}`;
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  closedUrl = `ws://127.0.0.1:${probe.address().port}`;
  await new Promise((r) => probe.close(r));
});
after(() => {
  relay.close();
  silent.close();
});

test('join() gives up on a silent relay with relay-silent and its url', async () => {
  const { room, key } = newRoom({ relay: silentUrl, rk: RK });
  const { aead } = await roomKeys(key, room);
  const sig = relaySignaling({ url: silentUrl, rk: RK, room, aead, connectTimeoutMs: 300 });
  const t0 = Date.now();
  await assert.rejects(sig.join(), (e) => e.code === 'relay-silent' && e.url === silentUrl);
  assert.ok(Date.now() - t0 < 1000);
});

test('join() still joins a relay that answers', async () => {
  const { room, key } = newRoom({ relay: relayUrl, rk: RK });
  const { aead } = await roomKeys(key, room);
  const sig = relaySignaling({ url: relayUrl, rk: RK, room, aead, connectTimeoutMs: 300 });
  await sig.join();
  sig.leave();
});

test('probeRelay : ok, a refused key, a silent port, a closed port', async () => {
  assert.equal(await probeRelay(relayUrl, RK), 'ok');
  assert.equal(await probeRelay(relayUrl, 'not-the-key'), 'key');
  assert.equal(await probeRelay(silentUrl, RK, { timeoutMs: 300 }), 'unreachable');
  assert.equal(await probeRelay(closedUrl, RK), 'unreachable');
});
