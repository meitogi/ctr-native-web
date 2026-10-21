// Backend selection : the order of the link's list, falling back, and the error codes when
// nothing works. Node has no RTCPeerConnection : every WebRTC attempt counts as failed, which
// is exactly the « no direct path » case.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { createRelay } from '../../../relay/relay.js';
import { newRoom } from '../link.js';
import { openRoom } from '../room.js';

const RK = 'relay-key-for-tests';
let relay;
let relayUrl;
before(async () => {
  relay = await createRelay({ port: 0, host: '127.0.0.1', key: RK, log: () => {} });
  relayUrl = `ws://127.0.0.1:${relay.port}`;
});
after(() => relay.close());

const DEAD = 'ws://127.0.0.1:9'; // nothing listens on the discard port
const codes = (r) => { const list = []; r.on('warning', (w) => list.push(`${w.backend}:${w.code}`)); return list; };

test('a link with only relay= behaves as before : relay, then its WebSocket path', async () => {
  const link = newRoom({ relay: relayUrl, rk: RK });
  assert.deepEqual(link.signaling, ['relay']);
  const host = await openRoom({ link, role: 'host' });
  const guest = await openRoom({ link, role: 'guest' });
  const l = await guest.connect();
  assert.equal(guest.backend, 'relay');
  assert.equal(l.signaling, 'relay');
  assert.equal(l.path, 'relay');
  host.close(); guest.close();
});

test('the host opens every backend ; one that fails is a warning, not the end', async () => {
  const link = newRoom({ relay: DEAD, signaling: ['relay', 'paste'] });
  const host = await openRoom({ link, role: 'host' });
  assert.deepEqual(host.backends.map((b) => `${b.name}:${b.state}`), ['relay:failed', 'paste:joined']);
  assert.equal(host.backends[0].error, 'relay');
  assert.equal(host.backend, 'paste');
  host.close();
  await assert.rejects(openRoom({ link: { ...link, signaling: ['relay'] }, role: 'host' }), (e) => e.code === 'relay', 'nothing joined : the first error');
});

test('a guest skips a relay it cannot join (wrong key) and moves down the list', async () => {
  const link = newRoom({ relay: relayUrl, rk: 'wrong', signaling: ['relay', 'paste'] });
  const guest = await openRoom({ link, role: 'guest' });
  assert.equal(guest.backend, 'paste');
  assert.equal(guest.backends[0].error, 'relay-key');
  guest.close();
});

test('paste first, relay second : no direct path over paste, so the guest moves to the relay and its WebSocket path', async () => {
  const link = newRoom({ relay: relayUrl, rk: RK, signaling: ['paste', 'relay'] });
  const host = await openRoom({ link, role: 'host' });
  const guest = await openRoom({ link, role: 'guest' });
  const warnings = codes(guest);
  const moved = [];
  guest.on('backend', (b) => moved.push(b));
  assert.equal(guest.backend, 'paste');
  const hostLink = new Promise((resolve) => host.on('link', resolve));
  const l = await guest.connect();
  assert.deepEqual(warnings, ['paste:no-webrtc']);
  assert.deepEqual(moved, ['relay']);
  assert.equal(guest.backend, 'relay');
  assert.equal(guest.backends[0].state, 'left');
  assert.equal(l.signaling, 'relay');
  assert.equal(l.path, 'relay');
  assert.equal((await hostLink).signaling, 'relay');
  host.close(); guest.close();
});

test('no direct path and no relay in the list : connect() rejects with no-direct-path', async () => {
  const link = newRoom({ signaling: ['paste'] });
  const guest = await openRoom({ link, role: 'guest' });
  let closed = false;
  guest.on('close', () => { closed = true; });
  await assert.rejects(guest.connect(), (e) => e.code === 'no-direct-path' && /relay/.test(e.message));
  assert.equal(closed, false, 'reported by connect(), the room is still open');
  guest.close();
  assert.equal(closed, true);
});

test('forced WebSocket without a relay backend rejects with no-relay', async () => {
  const guest = await openRoom({ link: newRoom({ signaling: ['paste'] }), role: 'guest', mode: 'ws' });
  await assert.rejects(guest.connect(), (e) => e.code === 'no-relay');
  guest.close();
});

test('the host is absent from the first backend : the guest tries the next one', async () => {
  // The host only opened paste ; the guest's list starts with the relay, where nobody hosts.
  const link = newRoom({ relay: relayUrl, rk: RK, signaling: ['relay', 'paste'] });
  const guest = await openRoom({ link, role: 'guest', rtcTimeoutMs: 300 });
  const warnings = codes(guest);
  await assert.rejects(guest.connect(), (e) => e.code === 'no-direct-path');
  assert.deepEqual(warnings, ['relay:absent', 'paste:no-webrtc']);
  guest.close();
});
