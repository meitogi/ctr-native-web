// web/online/net.js without wasm : what the queue holds, in which order, and where sends go.
//   node --test web/online/test/net.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EVENT, LOOPBACK_PEER, addressKey, createOnlineNet } from '../net.js';
import { fakeNetwork } from './fake-room.mjs';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (...b) => Uint8Array.from(b);
const drain = (net) => {
  const out = [];
  for (let e; (e = net.poll());) out.push(e);
  return out;
};

test('guest : connect is queued as CONNECTED, messages as DATA in arrival order with their bytes', async () => {
  const fake = fakeNetwork();
  const hostNet = createOnlineNet();
  hostNet.host(fake.hostRoom('A'));
  const net = createOnlineNet({ name: 'Bravo' });
  net.guest(fake.guestRoom('B'));

  assert.equal(net.connect(), 0);
  assert.deepEqual(drain(net), [], 'nothing before the link opens');
  await tick();
  assert.deepEqual(drain(net), [{ peer: -1, event: EVENT.CONNECTED }]);

  const [hostEvent] = drain(hostNet);
  assert.equal(hostEvent.event, EVENT.CONNECTED);
  hostNet.send(hostEvent.peer, bytes(0x12, 0x34), 1);
  hostNet.send(hostEvent.peer, bytes(0x07, 1, 2, 3), 0);
  hostNet.send(hostEvent.peer, bytes(0x02, 0xff), 1);
  assert.deepEqual(drain(net), [], 'delivery is asynchronous');
  await tick();
  assert.deepEqual(drain(net), [
    { peer: -1, event: EVENT.DATA, bytes: bytes(0x12, 0x34) },
    { peer: -1, event: EVENT.DATA, bytes: bytes(0x07, 1, 2, 3) },
    { peer: -1, event: EVENT.DATA, bytes: bytes(0x02, 0xff) },
  ]);
  assert.deepEqual(fake.sends.map((s) => s.reliable), [true, false, true], 'reliable 1 → ctl, 0 → game');
});

test('guest : sends carry the reliable flag to the link, payload unchanged', async () => {
  const fake = fakeNetwork();
  createOnlineNet().host(fake.hostRoom('A'));
  const net = createOnlineNet();
  net.guest(fake.guestRoom('B'));
  net.connect();
  await tick();
  net.send(-1, bytes(5, 0xaa, 0xbb), 0);
  net.send(-1, bytes(1, 0x41, 0x42), 1);
  assert.deepEqual(fake.sends.map(({ reliable, bytes: b }) => [reliable, [...b]]),
    [[false, [5, 0xaa, 0xbb]], [true, [1, 0x41, 0x42]]]);
});

test('guest : no host → DISCONNECTED ; no room → connect refused', async () => {
  const fake = fakeNetwork();
  const net = createOnlineNet();
  assert.equal(net.connect(), -1, 'no room yet');
  net.guest(fake.guestRoom('B'));
  assert.equal(net.connect(), 0);
  await tick();
  assert.deepEqual(drain(net), [{ peer: -1, event: EVENT.DISCONNECTED }]);
  assert.equal(net.lastError.code, 'absent');
});

test('guest : a retry while the first connect is in flight waits for the same link', async () => {
  const fake = fakeNetwork();
  createOnlineNet().host(fake.hostRoom('A'));
  const net = createOnlineNet();
  net.guest(fake.guestRoom('B', { connectDelayMs: 30 }));
  net.connect();
  net.disconnect(); // the bridge's 3 s attempt timed out
  net.connect(); // and it tries again
  await tick(50);
  assert.equal(fake.connects, 1, 'one room.connect()');
  assert.deepEqual(drain(net), [{ peer: -1, event: EVENT.CONNECTED }]);
});

test('guest : SELECT closes the link ; the host side sees DISCONNECTED ; the host leaving → DISCONNECTED', async () => {
  const fake = fakeNetwork();
  const hostNet = createOnlineNet();
  hostNet.host(fake.hostRoom('A'));
  const net = createOnlineNet();
  net.guest(fake.guestRoom('B'));
  net.connect();
  await tick();
  const [{ peer }] = drain(hostNet);
  drain(net);
  net.disconnect();
  await tick();
  assert.deepEqual(drain(hostNet), [{ peer, event: EVENT.DISCONNECTED }]);
  assert.deepEqual(drain(net), [], 'the guest left : nothing more for it');

  net.connect();
  await tick();
  assert.deepEqual(drain(net), [{ peer: -1, event: EVENT.CONNECTED }]);
  const [{ peer: again }] = drain(hostNet);
  hostNet.links[again].close();
  await tick();
  assert.deepEqual(drain(net), [{ peer: -1, event: EVENT.DISCONNECTED }]);
});

test('host : one int peer id per link, lowest free, never the loopback id ; address keys from the room id', async () => {
  const fake = fakeNetwork();
  const hostNet = createOnlineNet();
  hostNet.host(fake.hostRoom('A'));
  const guests = ['B', 'C', 'D'].map((n) => {
    const g = createOnlineNet();
    g.guest(fake.guestRoom(n));
    g.connect();
    return g;
  });
  await tick();
  const connected = drain(hostNet);
  assert.deepEqual(connected.map((e) => [e.peer, e.event]), [[0, 2], [1, 2], [2, 2]]);
  assert.deepEqual(connected.map((e) => e.key), ['B', 'C', 'D'].map((n) => addressKey(`guest-${n}`)));
  assert.equal(new Set(connected.map((e) => e.key.join())).size, 3, 'distinct keys');
  assert.ok(connected.every((e) => e.peer !== LOOPBACK_PEER));

  guests[1].disconnect();
  await tick();
  assert.deepEqual(drain(hostNet), [{ peer: 1, event: EVENT.DISCONNECTED }]);
  guests[1].connect();
  await tick();
  assert.deepEqual(drain(hostNet).map((e) => [e.peer, e.event]), [[1, 2]], 'id 1 reused');
});

test('host : messages keep their link\'s peer id and order ; a kick closes the link without an event', async () => {
  const fake = fakeNetwork();
  const hostNet = createOnlineNet();
  hostNet.host(fake.hostRoom('A'));
  const b = createOnlineNet();
  b.guest(fake.guestRoom('B'));
  const c = createOnlineNet();
  c.guest(fake.guestRoom('C'));
  b.connect();
  c.connect();
  await tick();
  drain(hostNet);
  drain(b);
  c.send(-1, bytes(0, 5), 1);
  b.send(-1, bytes(5, 1), 0);
  c.send(-1, bytes(1, 0x43), 1);
  await tick();
  assert.deepEqual(drain(hostNet), [
    { peer: 1, event: EVENT.DATA, bytes: bytes(0, 5) },
    { peer: 0, event: EVENT.DATA, bytes: bytes(5, 1) },
    { peer: 1, event: EVENT.DATA, bytes: bytes(1, 0x43) },
  ]);
  hostNet.kick(0);
  await tick();
  assert.deepEqual(drain(hostNet), [], 'enet_peer_disconnect_now raises no event');
  assert.deepEqual(drain(b), [{ peer: -1, event: EVENT.DISCONNECTED }], 'the kicked guest is dropped');
});

test('addressKey : FNV-1a 64 split into unsigned halves', () => {
  // FNV-1a 64 of "a" = 0xaf63dc4c8601ec8c
  assert.deepEqual(addressKey('a'), [0x8601ec8c, 0xaf63dc4c]);
  assert.deepEqual(addressKey(''), [0x84222325, 0xcbf29ce4]);
});
