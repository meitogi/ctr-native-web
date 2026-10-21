// The WebSocket transport end to end : real ctr-relay, host + guests, Node's own WebSocket
// and WebCrypto. WebRTC needs a browser : the demo page covers it.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { createRelay } from '../../../relay/relay.js';
import { formatRoomLink, newRoom } from '../link.js';
import { openRoom } from '../room.js';

const RK = 'relay-key-for-tests';
const MARKER = 'plaintext-marker-7f3a';
const bytes = (s) => new TextEncoder().encode(s);
const str = (b) => new TextDecoder().decode(b);
const relayLog = [];
let relay;
let relayUrl;

const nextEvent = (emitter, type, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error(`no ${type} within ${ms} ms`)); }, ms);
  const off = emitter.on(type, (value) => { clearTimeout(timer); off(); resolve(value); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  relay = await createRelay({ port: 0, host: '127.0.0.1', key: RK, logData: true, log: (line) => relayLog.push(line) });
  relayUrl = `ws://127.0.0.1:${relay.port}`;
});
after(() => relay.close());

test('forced WebSocket : host + 2 guests, star, messages both ways, path relay', async () => {
  const link = formatRoomLink('https://game.example/', newRoom({ relay: relayUrl, rk: RK }));
  const host = await openRoom({ link, role: 'host', name: 'host' });
  const g1 = await openRoom({ link, role: 'guest', mode: 'ws', name: 'g1' });
  const g2 = await openRoom({ link, role: 'guest', mode: 'ws', name: 'g2' });

  const hostLinks = [];
  host.on('link', (l) => hostLinks.push(l));
  const l1 = await g1.connect();
  const l2 = await g2.connect();
  assert.equal(l1.path, 'relay');
  assert.equal(l1.backend, 'ws');
  await sleep(200);
  assert.deepEqual(hostLinks.map((l) => l.peerId).sort(), [g1.selfId, g2.selfId].sort());
  assert.ok(hostLinks.every((l) => l.path === 'relay'));

  const atHost = [];
  for (const l of hostLinks) l.on('message', (b) => atHost.push(`${l.peerId === g1.selfId ? 'g1' : 'g2'}:${str(b)}`));
  const at1 = [];
  const at2 = [];
  l1.on('message', (b) => at1.push(str(b)));
  l2.on('message', (b) => at2.push(str(b)));

  for (let i = 0; i < 20; i++) l1.send(bytes(`${MARKER} g1 #${i}`));
  l2.send(bytes(`${MARKER} g2 #0`));
  host.links[g1.selfId].send(bytes('to g1'));
  host.links[g2.selfId].send(bytes('to g2'));
  await sleep(300);

  assert.equal(atHost.filter((m) => m.startsWith('g1:')).length, 20, 'all 20 in order, none rejected as replay');
  assert.deepEqual(atHost.filter((m) => m.startsWith('g1:')), [...Array(20).keys()].map((i) => `g1:${MARKER} g1 #${i}`));
  assert.ok(atHost.includes(`g2:${MARKER} g2 #0`));
  assert.deepEqual(at1, ['to g1']);
  assert.deepEqual(at2, ['to g2'], 'a guest only gets what the host sent it');

  const closed = nextEvent(host, 'linkclose');
  l2.close();
  assert.equal((await closed).peerId, g2.selfId);

  const gone = nextEvent(host, 'linkclose');
  g1.close();
  assert.equal((await gone).peerId, g1.selfId, 'a guest leaving the relay closes its link');
  host.close();
  g2.close();
});

test('the relay only ever sees ciphertext', () => {
  const dataLines = relayLog.filter((l) => l.includes(' data '));
  assert.ok(dataLines.length >= 20, `relay logged ${dataLines.length} data lines`);
  const markerB64 = [0, 1, 2].map((shift) => btoa('xxx'.slice(0, shift) + MARKER).slice(4, 16));
  for (const line of relayLog) {
    assert.ok(!line.includes(MARKER), line);
    for (const fragment of markerB64) assert.ok(!line.includes(fragment), line);
  }
});

test('auto mode without WebRTC falls back to the relay, with a warning', async () => {
  const link = newRoom({ relay: relayUrl, rk: RK });
  const host = await openRoom({ link, role: 'host' });
  const guest = await openRoom({ link, role: 'guest' });
  const warning = nextEvent(guest, 'warning');
  const l = await guest.connect();
  assert.equal((await warning).code, 'no-webrtc');
  assert.equal(l.path, 'relay');
  const got = nextEvent(host, 'link');
  const hostLink = await got;
  const msg = nextEvent(hostLink, 'message');
  l.send(bytes('hello'));
  assert.equal(str(await msg), 'hello');
  host.close(); guest.close();
});

test('a guest that opens before the host waits for it', async () => {
  const link = newRoom({ relay: relayUrl, rk: RK });
  const guest = await openRoom({ link, role: 'guest', mode: 'ws' });
  const pending = guest.connect();
  await sleep(200);
  const host = await openRoom({ link, role: 'host' });
  const hostLink = nextEvent(host, 'link');
  const l = await pending;
  assert.equal((await hostLink).peerId, guest.selfId);
  assert.equal(l.peerId, host.selfId);
  host.close(); guest.close();
});

test('a peer without the room secret gets nowhere', async () => {
  const good = newRoom({ relay: relayUrl, rk: RK });
  const intruder = { ...good, key: newRoom().key }; // same room id and relay key, other secret
  const host = await openRoom({ link: good, role: 'host' });
  let links = 0;
  host.on('link', () => links++);
  const bad = await openRoom({ link: intruder, role: 'guest', mode: 'ws' });
  const badLink = await bad.connect();
  badLink.send(bytes('let me in'));
  let heard = false;
  badLink.on('message', () => { heard = true; });
  await sleep(300);
  assert.equal(links, 0, 'the host never opened a link for it');
  assert.equal(heard, false);
  host.close(); bad.close();
});

test('a wrong relay key is refused with code relay-key', async () => {
  const link = newRoom({ relay: relayUrl, rk: 'wrong' });
  await assert.rejects(openRoom({ link, role: 'host' }), (e) => e.code === 'relay-key');
  await assert.rejects(openRoom({ link: { ...link, rk: '' }, role: 'host' }), (e) => e.code === 'relay-key');
});
