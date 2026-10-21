// Backend 2, MQTT, against a real broker : MQTT_URL (web/net/test/mqtt/run.sh starts one).
// Without MQTT_URL the tests are skipped.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createRelay } from '../../../relay/relay.js';
import { roomKeys } from '../crypto.js';
import { newRoom } from '../link.js';
import { openRoom } from '../room.js';
import { mqttConnect, mqttSignaling, mqttTopic } from '../signaling-mqtt.js';

const URL_ = process.env.MQTT_URL;
const DEAD = process.env.MQTT_DEAD_URL ?? 'ws://127.0.0.1:9';
const skip = !URL_ && 'MQTT_URL not set (web/net/test/mqtt/run.sh)';
const MARKER = 'plaintext-marker-mqtt-51c2';
const next = (emitter, type, ms = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error(`no ${type} within ${ms} ms`)); }, ms);
  const off = emitter.on(type, (v) => { clearTimeout(timer); off(); resolve(v); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function backend(link, kind, brokers = [URL_]) {
  const keys = await roomKeys(link.key, link.room);
  const sig = mqttSignaling({ brokers, room: link.room, aead: keys.aead, auth: keys.auth, kind, name: kind });
  await sig.join();
  return sig;
}

test('host and guest find each other on the topic and exchange signals ; the broker sees only ciphertext', { skip }, async (t) => {
  const link = newRoom();
  // Everything the broker carries on this room's topic (public brokers refuse `#`).
  const topic = await mqttTopic((await roomKeys(link.key, link.room)).auth);
  assert.match(topic, /^ctr-net\/v1\/[A-Za-z0-9_-]{22}$/);
  assert.ok(!topic.includes(link.room) && !topic.includes(link.key.slice(0, 8)), 'the topic says nothing of the room id or the secret');
  const seen = [];
  const spy = mqttConnect(URL_, topic, { onMessage: (bytes) => seen.push(new TextDecoder().decode(bytes)), onClose: () => {} });
  t.after(() => spy.close());
  await spy.ready;

  const host = await backend(link, 'host');
  const guest = await backend(link, 'guest');
  if (!guest.peers.some((p) => p.kind === 'host')) await next(guest, 'peers');
  await sleep(200);
  assert.deepEqual(guest.peers.map((p) => p.kind).sort(), ['guest', 'host']);
  assert.deepEqual(host.peers.map((p) => p.kind).sort(), ['guest', 'host']);

  const atHost = next(host, 'signal');
  await guest.signal(host.selfId, { t: 'offer', sdp: `${MARKER} offer` });
  assert.deepEqual(await atHost, { from: guest.selfId, payload: { t: 'offer', sdp: `${MARKER} offer` } });
  const atGuest = next(guest, 'signal');
  await host.signal(guest.selfId, { t: 'answer', sdp: `${MARKER} answer` });
  assert.deepEqual((await atGuest).payload, { t: 'answer', sdp: `${MARKER} answer` });

  const left = next(host, 'peers');
  guest.leave();
  assert.deepEqual((await left).map((p) => p.kind), ['host'], 'bye removes the guest');
  host.leave();
  await sleep(200);
  assert.ok(seen.length >= 5, `the spy saw ${seen.length} messages (2 hellos, offer, answer, bye)`);
  for (const raw of seen) {
    assert.ok(!raw.includes(MARKER) && !raw.includes('offer') && !raw.includes('hello'), raw);
  }
});

test('rooms do not hear each other', { skip }, async () => {
  const a = await backend(newRoom(), 'host');
  const b = await backend(newRoom(), 'guest');
  await sleep(500);
  assert.equal(a.peers.length, 1);
  assert.equal(b.peers.length, 1);
  a.leave(); b.leave();
});

test('two brokers carrying the same messages : each signal is delivered once', { skip }, async () => {
  const link = newRoom();
  const host = await backend(link, 'host', [URL_, URL_]);
  const guest = await backend(link, 'guest', [URL_, URL_]);
  await sleep(300);
  let count = 0;
  host.on('signal', () => count++);
  for (let i = 0; i < 5; i++) await guest.signal(host.selfId, { i });
  await sleep(500);
  assert.equal(count, 5);
  host.leave(); guest.leave();
});

test('a dead broker in the list is skipped ; all dead rejects with code mqtt', { skip }, async () => {
  const link = newRoom();
  const sig = await backend(link, 'host', [DEAD, URL_]);
  sig.leave();
  await assert.rejects(backend(link, 'host', [DEAD]), (e) => e.code === 'mqtt');
});

test('openRoom over mqtt, then relay : no direct path in Node, so the guest ends on the relay WebSocket', { skip }, async () => {
  const relay = await createRelay({ port: 0, host: '127.0.0.1', log: () => {} });
  const link = newRoom({ relay: `ws://127.0.0.1:${relay.port}`, signaling: ['mqtt', 'relay'], mqtt: [URL_] });
  const host = await openRoom({ link, role: 'host' });
  assert.deepEqual(host.backends.map((b) => b.state), ['joined', 'joined']);
  const guest = await openRoom({ link, role: 'guest' });
  assert.equal(guest.backend, 'mqtt');
  const warnings = [];
  guest.on('warning', (w) => warnings.push(`${w.backend}:${w.code}`));
  const l = await guest.connect();
  assert.deepEqual(warnings, ['mqtt:no-webrtc']);
  assert.equal(l.signaling, 'relay');
  host.close(); guest.close();
  await relay.close();
});
