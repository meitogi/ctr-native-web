// Host and guest of Share over in-memory links : the media renegotiation round trip, the pad
// into its slot, a guest leaving, and the relay-path refusal.
//   node --test web/share/test/*.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareGuest } from '../guest.js';
import { BITRATE, createShareHost } from '../host.js';
import { BTN, ONLINE_MODE, PAD_ID, TAG, decodeControl, padFromKeys } from '../protocol.js';
import { fakeStream, guestRoom, hostRoom, pair, tick } from './fake.mjs';

const controls = (log, from) => log.filter((m) => m.from === from && m.bytes[0] !== TAG.pad).map((m) => ({ ...decodeControl(m.bytes), reliable: m.reliable }));

async function joined(room, id, { tracks = [] } = {}) {
  const p = pair(id);
  const guest = createShareGuest(guestRoom({ link: p.guest }), { onTrack: (e) => tracks.push(e.track.kind) });
  room.add(p.host); // the host's end of a link is up before the guest's (web/net/transport.js)
  await guest.connect();
  await tick(20);
  return { p, guest };
}

test('a direct guest : welcome with slot 1, the host offers its tracks, the guest answers, encoder tuned', async () => {
  const room = hostRoom();
  const host = createShareHost({ room, stream: fakeStream(), maxBitrate: 2_000_000, scale: 1.5625 });
  const tracks = [];
  const { p, guest } = await joined(room, 'g1', { tracks });

  assert.equal(guest.state, 'connected');
  assert.equal(guest.slot, 1);
  assert.equal(guest.path, 'direct-lan');

  const fromHost = controls(p.log, 'host');
  assert.deepEqual(fromHost.map((m) => [m.tag, m.reliable]), [[TAG.welcome, true], [TAG.players, true], [TAG.offer, true]]);
  assert.deepEqual(fromHost[0].body, { slot: 1 });
  assert.deepEqual(fromHost[1].body, { players: 2 });
  assert.equal(guest.players, 2);
  assert.equal(fromHost[2].body.sdp, p.host.pc.localDescription.sdp, 'the offer is the host pc\'s own');
  assert.match(fromHost[2].body.sdp, /m=video\r\nm=audio/);

  const fromGuest = controls(p.log, 'guest');
  assert.deepEqual(fromGuest.map((m) => [m.tag, m.reliable]), [[TAG.answer, true]]);
  assert.equal(p.guest.pc.remoteDescription.sdp, fromHost[2].body.sdp, 'guest applied the offer');
  assert.equal(p.host.pc.remoteDescription.sdp, fromGuest[0].body.sdp, 'host applied the answer');
  assert.match(fromGuest[0].body.sdp, /stereo=1;sprop-stereo=1/);
  assert.deepEqual(tracks, ['video', 'audio']);

  const tx = p.host.pc.transceivers;
  assert.deepEqual(tx.map((t) => [t.track.kind, t.init.direction]), [['video', 'sendonly'], ['audio', 'sendonly']]);
  const video = tx[0].sender.params;
  assert.deepEqual(video.encodings[0], { maxBitrate: 2_000_000, maxFramerate: 30, scaleResolutionDownBy: 1.5625 });
  assert.equal(video.degradationPreference, 'maintain-framerate');
  assert.equal(host.guests.g1.state, 'streaming');
  assert.equal(host.guests.g1.slot, 1);
});

test('nothing goes on ctl before the guest\'s first pad (its handlers are not attached yet)', async () => {
  const room = hostRoom();
  createShareHost({ room, stream: fakeStream() });
  const p = pair('g1');
  room.add(p.host);
  await tick(20);
  assert.deepEqual(p.log, []);
  assert.deepEqual(p.host.pc.transceivers, []);
});

test('the guest\'s pad reaches its slot as PSX bytes ; leaving unplugs the slot', async () => {
  const room = hostRoom();
  const host = createShareHost({ room, stream: fakeStream() });
  const a = await joined(room, 'a');
  const b = await joined(room, 'b');
  assert.equal(b.guest.slot, 2);

  b.guest.sendPad(padFromKeys({ KeyC: true, ArrowRight: true }));
  await tick();
  const heap = new Uint8Array(24);
  assert.equal(host.slots.read(heap, 0), 0b0110);
  assert.deepEqual([...heap.subarray(8, 16)], [0, PAD_ID.digital, 0xdf, 0xbf, 0x80, 0x80, 0x80, 0x80]);
  assert.equal((heap[11] << 8 | heap[10]), 0xffff & ~(BTN.cross | BTN.right));

  b.guest.close();
  await tick();
  assert.equal(host.slots.read(heap, 0), 0b0010, 'slot 2 unplugged, slot 1 still a\'s');
  assert.equal(host.guests.b, undefined);
  assert.equal(a.guest.players, 2, 'the others learn the new player count');
  const c = await joined(room, 'c');
  assert.equal(c.guest.slot, 2, 'the freed slot goes to the next guest');
  assert.equal(a.guest.slot, 1);
  assert.equal(a.guest.players, 3);
  assert.equal(c.guest.players, 3);
});

test('the host leaving closes the guest with a reason', async () => {
  const room = hostRoom();
  createShareHost({ room, stream: fakeStream() });
  const { p, guest } = await joined(room, 'a');
  p.host.close();
  await tick();
  assert.equal(guest.state, 'closed');
  assert.equal(guest.message, 'The host left.');
});

test('a fourth guest is refused as full, after its first pad', async () => {
  const room = hostRoom();
  const host = createShareHost({ room, stream: fakeStream() });
  for (const id of ['a', 'b', 'c']) await joined(room, id);
  const { p, guest } = await joined(room, 'd');
  assert.equal(guest.state, 'refused');
  assert.equal(guest.code, 'full');
  assert.equal(p.host.pc.transceivers.length, 0, 'no media for a refused guest');
  assert.equal(host.guests.d, undefined);
  assert.deepEqual(host.refusals, [{ peerId: 'd', code: 'full', path: 'direct-lan' }]);
});

test('relay path : the guest refuses on its own with the Online-mode message, no pad, no media', async () => {
  const p = pair('g1', 'ws');
  const room = guestRoom({ link: p.guest });
  const guest = createShareGuest(room);
  await guest.connect();
  assert.equal(guest.state, 'refused');
  assert.equal(guest.code, 'online-mode');
  assert.equal(guest.message, ONLINE_MODE);
  assert.equal(p.guest.closed, false, 'its join reaches the host first');
  await tick(1100);
  assert.equal(p.guest.closed, true);
  assert.equal(room.closed, true);
  guest.sendPad(padFromKeys({ KeyC: true }));
  assert.deepEqual(p.log, []);
});

test('relay path : the host takes no slot, sends the refusal on the link and closes it', async () => {
  const room = hostRoom();
  const host = createShareHost({ room, stream: fakeStream() });
  const p = pair('g1', 'ws');
  room.add(p.host);
  assert.equal(host.slots.slotOf('g1'), 0);
  assert.equal(p.host.closed, true);
  assert.deepEqual(controls(p.log, 'host').map((m) => [m.tag, m.body.code, m.reliable]), [[TAG.refuse, 'online-mode', true]]);
  assert.equal(host.guests.g1, undefined);
  assert.deepEqual(host.refusals, [{ peerId: 'g1', code: 'online-mode', path: 'relay' }]);
});

test('no direct path at all (connect rejects no-direct-path) : the Online-mode message too', async () => {
  const error = Object.assign(new Error('no direct WebRTC path'), { code: 'no-direct-path' });
  const guest = createShareGuest(guestRoom({ error }));
  await guest.connect();
  assert.equal(guest.state, 'refused');
  assert.equal(guest.code, 'online-mode');
});

test('setBitrate clamps to the range and retunes every guest\'s video sender', async () => {
  const room = hostRoom();
  const host = createShareHost({ room, stream: fakeStream() });
  const a = await joined(room, 'a');
  const b = await joined(room, 'b');
  await host.setBitrate(10_000_000);
  assert.equal(host.maxBitrate, BITRATE.max);
  for (const g of [a, b]) assert.equal(g.p.host.pc.transceivers[0].sender.params.encodings[0].maxBitrate, BITRATE.max);
  await host.setBitrate(1_000_000);
  assert.equal(a.p.host.pc.transceivers[0].sender.params.encodings[0].maxBitrate, 1_000_000);
  await host.setScale(2);
  assert.equal(b.p.host.pc.transceivers[0].sender.params.encodings[0].scaleResolutionDownBy, 2);
});
