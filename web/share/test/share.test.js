// Host and guest of Share over in-memory links : the media renegotiation round trip, the pad
// into its slot, a guest leaving, and the relay-path refusal.
//   node --test web/share/test/*.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShareGuest } from '../guest.js';
import { BITRATE, createShareHost } from '../host.js';
import { BTN, ONLINE_MODE, PAD_ID, TAG, decodeControl, encodeControl, padFromKeys } from '../protocol.js';
import { fakeStream, guestRoom, hostRoom, pair, tick } from './fake.mjs';

const controls = (log, from) => log.filter((m) => m.from === from && m.bytes[0] !== TAG.pad).map((m) => ({ ...decodeControl(m.bytes), reliable: m.reliable }));

async function joined(room, id, { tracks = [], name, bot } = {}) {
  const p = pair(id);
  const guest = createShareGuest(guestRoom({ link: p.guest }), { onTrack: (e) => tracks.push(e.track.kind), name, bot });
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
  assert.deepEqual(fromHost[0].body, { slot: 1, host: 'P1' });
  assert.deepEqual(fromHost[1].body, { players: 2, list: [{ slot: 0, name: 'P1' }, { slot: 1, name: 'P2' }] });
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
  await tick(20); // close → the host's linkclose → PLAYERS to a : three timer hops
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

test('names : the guest\'s HELLO reaches the host, the host\'s name rides in WELCOME, PLAYERS says who is who', async () => {
  const room = hostRoom();
  const host = createShareHost({ room, stream: fakeStream(), hostName: 'Turbo Roo' });
  const events = [];
  host.on('join', (g) => events.push(['join', g.slot, g.name]));
  host.on('leave', (g) => events.push(['leave', g.slot, g.name]));
  const a = await joined(room, 'g1', { name: 'Mad Coco\u00e9!!' });
  const b = await joined(room, 'g2');

  assert.equal(host.guests.g1.name, 'Mad Coco!', 'cleaned : printable ASCII, 9 at most');
  assert.equal(host.guests.g2.name, null, 'a guest that sends no name (a page before names)');
  assert.deepEqual(host.players(), [{ slot: 0, name: 'Turbo Roo' }, { slot: 1, name: 'Mad Coco!' }, { slot: 2, name: 'P3' }]);
  assert.equal(a.guest.host, 'Turbo Roo');
  assert.deepEqual(b.guest.list, host.players(), 'every guest has the list');
  assert.equal(b.guest.slot, 2);
  // the name went end to end on the link's reliable channel, nowhere else
  const hello = controls(a.p.log, 'guest').filter((m) => m.tag === TAG.hello);
  assert.ok(hello.length >= 1 && hello.every((m) => m.reliable && m.body.name === 'Mad Coco!'));
  assert.deepEqual(events, [['join', 1, 'Mad Coco!'], ['join', 2, null]]);

  // a rename travels at once, the other guest's list follows
  a.guest.setName('Sly Tiny');
  await tick(10);
  assert.equal(host.guests.g1.name, 'Sly Tiny');
  assert.deepEqual(b.guest.list.map((p) => p.name), ['Turbo Roo', 'Sly Tiny', 'P3']);
  host.setHostName('Ace Joe');
  await tick(10);
  assert.equal(a.guest.list[0].name, 'Ace Joe');

  a.p.guest.close();
  await tick(10);
  assert.deepEqual(events.at(-1), ['leave', 1, 'Sly Tiny']);
  assert.deepEqual(b.guest.list.map((p) => [p.slot, p.name]), [[0, 'Ace Joe'], [2, 'P3']]);
  assert.equal(b.guest.players, 2);
});

test('an old host (WELCOME {slot}, PLAYERS {players}) : the new guest still gets its slot and count', async () => {
  const p = pair('g1');
  const guest = createShareGuest(guestRoom({ link: p.guest }), { name: 'Wild Roo' });
  await guest.connect();
  p.host.send(encodeControl(TAG.welcome, { slot: 1 }), { reliable: true });
  p.host.send(encodeControl(TAG.players, { players: 2 }), { reliable: true });
  await tick(10);
  assert.equal(guest.slot, 1);
  assert.equal(guest.players, 2);
  assert.equal(guest.host, null);
  assert.deepEqual(guest.list, []);
});

// ---- session 19 : the bot's own kart ----

/** A debug host's window.__ctr : P1 and P2 in a race on Crash Cove. */
const debugGame = (lap = 0) => ({
  screen: 'race', levelID: 3, players: 2, charSelect: null, menu: null,
  kart: { lap: 2, pos: { x: 1, y: 2, z: 3 } },
  karts: [{ lap: 2, pos: { x: 1, y: 2, z: 3 } }, { lap, speed: 900, rank: 1, finished: false, pos: { x: 10, y: 0, z: -40 }, angle: 1024, checkpoint: 4, target: { x: 12, z: -60 }, toFinish: 5000 }],
  track: { levelID: 3, path: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 5 }] },
});

test('BOT : a debug host sends the bot its own kart (KART, game channel) and the racing line once (TRACK, ctl)', async () => {
  const room = hostRoom();
  let game = debugGame(0);
  const host = createShareHost({ room, stream: fakeStream(), game: () => game });
  const a = await joined(room, 'g1', { bot: true });
  assert.ok(host.guests.g1.bot, 'the host knows its bot');
  const bot = controls(a.p.log, 'guest').filter((m) => m.tag === TAG.bot);
  assert.equal(bot.length, 1);
  assert.equal(bot[0].reliable, true);

  host.frame();
  game = debugGame(1);
  host.frame();
  await tick(10);
  const fromHost = controls(a.p.log, 'host');
  const tracks = fromHost.filter((m) => m.tag === TAG.track);
  const karts = fromHost.filter((m) => m.tag === TAG.kart);
  assert.equal(tracks.length, 1, 'the line once per level');
  assert.deepEqual(tracks[0], { tag: TAG.track, body: game.track, reliable: true });
  assert.equal(karts.length, 2);
  assert.ok(karts.every((m) => !m.reliable), 'kart states on the unreliable channel');
  assert.deepEqual(karts[1].body, { screen: 'race', levelID: 3, players: 2, charSelect: null, kart: game.karts[1] }, 'P2 = drivers[1], not P1');
  assert.deepEqual(a.guest.game, karts[1].body);
  assert.deepEqual(a.guest.track, game.track);

  // a new level : the new line, then its karts
  game = { ...debugGame(0), levelID: 7, track: { levelID: 7, path: [{ x: 9, y: 9, z: 9 }] } };
  host.frame();
  await tick(10);
  assert.deepEqual(controls(a.p.log, 'host').filter((m) => m.tag === TAG.track).map((m) => m.body.levelID), [3, 7]);
});

test('no BOT, no kart : an ordinary guest gets no KART / TRACK, and a release host (no __ctr) sends none', async () => {
  const room = hostRoom();
  const host = createShareHost({ room, stream: fakeStream(), game: () => debugGame() });
  const a = await joined(room, 'g1');
  host.frame();
  await tick(10);
  assert.equal(host.guests.g1.bot, undefined);
  assert.deepEqual(controls(a.p.log, 'host').filter((m) => m.tag >= TAG.bot).map((m) => m.tag), []);
  assert.equal(a.guest.game, null);

  const room2 = hostRoom();
  const release = createShareHost({ room: room2, stream: fakeStream(), game: () => null });
  const b = await joined(room2, 'g2', { bot: true });
  release.frame();
  await tick(10);
  assert.ok(release.guests.g2.bot);
  assert.deepEqual(controls(b.p.log, 'host').filter((m) => m.tag >= TAG.bot).map((m) => m.tag), []);
  assert.equal(b.guest.game, null, 'the bot falls back to Cross held');
});
