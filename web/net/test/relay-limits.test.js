// A relay with no key and its limits (relay/README.md « An open relay »), as a page meets them :
// a room with no key, each refusal by its own code, a room the relay closes said to its host.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createRelay } from '../../../relay/relay.js';
import { newRoom } from '../link.js';
import { openRoom } from '../room.js';
import { lookRoom, probeRelay } from '../signaling.js';

const open = async (limits) => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', log: () => {}, ...limits });
  return { relay, url: `ws://127.0.0.1:${relay.port}` };
};
const nextEvent = (emitter, type, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error(`no ${type} within ${ms} ms`)); }, ms);
  const off = emitter.on(type, (value) => { clearTimeout(timer); off(); resolve(value); });
});

test('no key anywhere : a host and a guest meet, forced on the relay, and talk', async () => {
  const { relay, url } = await open({});
  const link = newRoom({ relay: url });
  assert.equal(link.rk, '');
  const host = await openRoom({ link, role: 'host' });
  const guest = await openRoom({ link, role: 'guest', mode: 'ws' });
  const atHost = nextEvent(host, 'link');
  const toHost = await guest.connect();
  const toGuest = await atHost;
  const heard = nextEvent(toGuest, 'message');
  toHost.send(new TextEncoder().encode('hello'));
  assert.equal(new TextDecoder().decode(await heard), 'hello');
  assert.equal(await probeRelay(url, ''), 'ok');
  host.close(); guest.close();
  await relay.close();
});

test('the relay at its limit : relay-full for a room, a look and a probe', async () => {
  const { relay, url } = await open({ maxSockets: 1 });
  const first = await openRoom({ link: newRoom({ relay: url }), role: 'host' });
  await assert.rejects(openRoom({ link: newRoom({ relay: url }), role: 'host' }), (e) => e.code === 'relay-full');
  await assert.rejects(lookRoom(url, '', 'any'), (e) => e.code === 'relay-full');
  assert.equal(await probeRelay(url, ''), 'full');
  first.close();
  await relay.close();
});

test('no room left : relay-full at the hello, while a guest still joins an open room', async () => {
  const { relay, url } = await open({ maxRooms: 1 });
  const link = newRoom({ relay: url });
  const host = await openRoom({ link, role: 'host' });
  await assert.rejects(openRoom({ link: newRoom({ relay: url }), role: 'host' }), (e) => e.code === 'relay-full');
  const guest = await openRoom({ link, role: 'guest', mode: 'ws' });
  host.close(); guest.close();
  await relay.close();
});

test('too many sockets from this address : relay-address', async () => {
  const { relay, url } = await open({ ipMax: 1 });
  const first = await openRoom({ link: newRoom({ relay: url }), role: 'host' });
  await assert.rejects(openRoom({ link: newRoom({ relay: url }), role: 'host' }), (e) => e.code === 'relay-address');
  assert.equal(await probeRelay(url, ''), 'address');
  first.close();
  await relay.close();
});

test('a room nobody joined : the host\'s room closes with room-alone ; a room past its life with room-life', async () => {
  const alone = await open({ aloneMs: 150 });
  const host = await openRoom({ link: newRoom({ relay: alone.url }), role: 'host' });
  assert.equal((await nextEvent(host, 'close')).code, 'room-alone');
  await alone.relay.close();

  const life = await open({ roomLifeMs: 200 });
  const link = newRoom({ relay: life.url });
  const h = await openRoom({ link, role: 'host' });
  const g = await openRoom({ link, role: 'guest', mode: 'ws' });
  const [atHost, atGuest] = await Promise.all([nextEvent(h, 'close'), nextEvent(g, 'close')]);
  assert.deepEqual([atHost.code, atGuest.code], ['room-life', 'room-life']);
  await life.relay.close();
});
