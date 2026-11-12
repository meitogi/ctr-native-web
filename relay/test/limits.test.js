// An open relay's limits : sockets, rooms, sockets per address, the kicks (idle, alone, a room's
// life), each refusal's close code and its counter in /stats. All off by default.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CLOSE, createRelay } from '../relay.js';
import { connect, join, quiet } from './helpers.js';

const start = (options) => createRelay({ port: 0, host: '127.0.0.1', log: quiet, stats: true, ...options });
const urlOf = (relay) => `ws://127.0.0.1:${relay.port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Resolves with the close code, or 'open' when the socket is still open after `ms`. */
const closedWithin = (c, ms) => Promise.race([c.closed, sleep(ms).then(() => 'open')]);

describe('caps', () => {
  test('maxSockets : one more socket is closed 4503 just after the handshake, and a place freed is a place again', async () => {
    const relay = await start({ maxSockets: 2 });
    const url = urlOf(relay);
    const a = await join(url, { id: 'a', room: 'r' });
    const b = await join(url, { id: 'b', room: 'r' });
    const c = connect(url);
    await c.opened; // the upgrade itself succeeds : the reason travels in the close code
    assert.equal(await c.closed, CLOSE.full);
    assert.equal(CLOSE.full, 4503);
    assert.equal(relay.stats().refused.sockets, 1);
    assert.equal(relay.stats().peakSockets, 2);
    b.close();
    await b.closed;
    const d = await join(url, { id: 'd', room: 'r' });
    assert.deepEqual(d.welcome.peers.map((p) => p.id).sort(), ['a', 'd']);
    a.close();
    d.close();
    await relay.close();
  });

  test('maxRooms : a hello that would open one more room is closed 4503 ; joining an open room still works', async () => {
    const relay = await start({ maxRooms: 2 });
    const url = urlOf(relay);
    const a = await join(url, { id: 'a', room: 'one' });
    const b = await join(url, { id: 'b', room: 'two' });
    const c = connect(url);
    await c.opened;
    c.send({ type: 'hello', id: 'c', room: 'three' });
    assert.equal(await c.closed, CLOSE.full);
    assert.equal(relay.stats().refused.rooms, 1);
    assert.equal(relay.stats().rooms, 2);
    const guest = await join(url, { id: 'g', room: 'one' });
    assert.equal(guest.welcome.peers.length, 2);
    b.close();
    await b.closed;
    await sleep(20);
    const e = await join(url, { id: 'e', room: 'three' });
    assert.equal(relay.stats().peakRooms, 2);
    for (const x of [a, guest, e]) x.close();
    await relay.close();
  });

  test('a refused hello leaves no room behind (a full relay cannot be filled with refusals)', async () => {
    const relay = await start({ maxRooms: 1 });
    const url = urlOf(relay);
    for (let i = 0; i < 3; i++) {
      const bad = connect(url);
      await bad.opened;
      bad.send({ type: 'hello', id: 'x'.repeat(65), room: `ghost${i}` }); // id too long : 4400
      assert.equal(await bad.closed, CLOSE.badHello);
    }
    assert.equal(relay.stats().rooms, 0);
    const a = await join(url, { id: 'a', room: 'real' });
    assert.equal(a.welcome.type, 'welcome');
    a.close();
    await relay.close();
  });

  test('ipMax : one more socket from the same address is closed 4430', async () => {
    const relay = await start({ ipMax: 2 });
    const url = urlOf(relay);
    const a = await join(url, { id: 'a', room: 'r' });
    const b = connect(url);
    await b.opened; // not joined yet : it counts all the same
    const c = connect(url);
    await c.opened;
    assert.equal(await c.closed, CLOSE.address);
    assert.equal(CLOSE.address, 4430);
    assert.equal(relay.stats().refused.address, 1);
    b.close();
    await b.closed;
    await sleep(20);
    const d = await join(url, { id: 'd', room: 'r' });
    assert.equal(d.welcome.peers.length, 2);
    a.close();
    d.close();
    await relay.close();
  });
});

describe('the client address behind a proxy', () => {
  const from = (xff) => ({ headers: { 'x-forwarded-for': xff } });

  test('trustProxy 0 : X-Forwarded-For is not believed — every header value is the same (socket) address', async () => {
    const relay = await start({ ipMax: 2 });
    const url = urlOf(relay);
    const a = connect(url, from('1.1.1.1'));
    const b = connect(url, from('2.2.2.2'));
    await Promise.all([a.opened, b.opened]);
    const c = connect(url, from('3.3.3.3'));
    await c.opened;
    assert.equal(await c.closed, CLOSE.address);
    a.close();
    b.close();
    await relay.close();
  });

  test('trustProxy 1 : the address is the last entry, the one our proxy wrote ; what the client put before it is ignored', async () => {
    const relay = await start({ ipMax: 1, trustProxy: 1 });
    const url = urlOf(relay);
    const a = connect(url, from('9.9.9.9'));
    await a.opened;
    // another address : in
    const b = connect(url, from('8.8.8.8'));
    await b.opened;
    assert.equal(await closedWithin(b, 150), 'open');
    // the same address, pretending to be someone else on the left of the list : out
    const liar = connect(url, from('7.7.7.7, 9.9.9.9'));
    await liar.opened;
    assert.equal(await liar.closed, CLOSE.address);
    // no header at all (a client that reached the relay directly) : the socket's address
    const direct = connect(url);
    await direct.opened;
    assert.equal(await closedWithin(direct, 150), 'open');
    for (const x of [a, b, direct]) x.close();
    await relay.close();
  });

  test('trustProxy 2 : the second entry from the right', async () => {
    const relay = await start({ ipMax: 1, trustProxy: 2 });
    const url = urlOf(relay);
    const a = connect(url, from('5.5.5.5, 10.0.0.1'));
    await a.opened;
    const same = connect(url, from('6.6.6.6, 5.5.5.5, 10.0.0.2'));
    await same.opened;
    assert.equal(await same.closed, CLOSE.address);
    a.close();
    await relay.close();
  });
});

describe('kicks', () => {
  test('aloneMs : a room nobody joined is closed 4410 ; one that got a guest in time is not', async () => {
    const relay = await start({ aloneMs: 200 });
    const url = urlOf(relay);
    const lonely = await join(url, { id: 'l', room: 'empty' });
    const host = await join(url, { id: 'h', room: 'busy' });
    const guest = await join(url, { id: 'g', room: 'busy' });
    assert.equal(await lonely.closed, CLOSE.alone);
    assert.equal(CLOSE.alone, 4410);
    assert.equal(await closedWithin(host, 300), 'open');
    assert.deepEqual(relay.stats().kicked, { idle: 0, alone: 1, life: 0 });
    // the guest leaves : the count starts again from there
    const left = Date.now();
    guest.close();
    assert.equal(await host.closed, CLOSE.alone);
    assert.ok(Date.now() - left >= 180, `closed ${Date.now() - left} ms after the guest left`);
    await relay.close();
  });

  test('roomLifeMs : a room is closed 4411 at its age, whoever is in and whatever they send', async () => {
    const relay = await start({ roomLifeMs: 300 });
    const url = urlOf(relay);
    const a = await join(url, { id: 'a', room: 'r' });
    const b = await join(url, { id: 'b', room: 'r' });
    const chatter = setInterval(() => a.send({ type: 'data', to: 'b', data: 'x' }), 20);
    assert.equal(await a.closed, CLOSE.life);
    assert.equal(await b.closed, CLOSE.life);
    clearInterval(chatter);
    assert.equal(CLOSE.life, 4411);
    assert.equal(relay.stats().kicked.life, 2);
    await sleep(20);
    assert.equal(relay.stats().rooms, 0);
    // the name is free again : a new room, with a new life
    const again = await join(url, { id: 'a', room: 'r' });
    assert.equal(await closedWithin(again, 150), 'open');
    again.close();
    await relay.close();
  });

  test('idleMs : pings do not keep a socket ; a message sent or received does', async () => {
    const relay = await start({ idleMs: 250 });
    const url = urlOf(relay);
    const quietOne = await join(url, { id: 'q', room: 'r' });
    const talker = await join(url, { id: 't', room: 'r' });
    const listener = await join(url, { id: 'l', room: 'r' });
    const pings = setInterval(() => quietOne.send({ type: 'ping', ts: 1 }), 40);
    const talk = setInterval(() => talker.send({ type: 'data', to: 'l', data: 'x' }), 40);
    assert.equal(await quietOne.closed, CLOSE.idle);
    assert.equal(CLOSE.idle, 4408);
    clearInterval(pings);
    assert.equal(await closedWithin(talker, 300), 'open');
    assert.equal(await closedWithin(listener, 10), 'open');
    clearInterval(talk);
    assert.equal(relay.stats().kicked.idle, 1);
    talker.close();
    listener.close();
    await relay.close();
  });

  test('no limit set : nothing is refused, nobody is kicked, the counters stay at zero', async () => {
    const relay = await start({});
    const url = urlOf(relay);
    const all = [];
    for (let i = 0; i < 12; i++) all.push(await join(url, { id: `p${i}`, room: `room${i}` }));
    await sleep(300);
    const s = relay.stats();
    assert.deepEqual(s.refused, { sockets: 0, rooms: 0, address: 0 });
    assert.deepEqual(s.kicked, { idle: 0, alone: 0, life: 0 });
    assert.equal(s.sockets, 12);
    assert.equal(s.rooms, 12);
    for (const c of all) c.close();
    await relay.close();
  });
});

describe('a stranger in a room', () => {
  test('a third peer sees the names, and nothing two others send each other', async () => {
    const relay = await start({});
    const url = urlOf(relay);
    const host = await join(url, { id: 'h', room: 'r', name: 'Host' });
    const guest = await join(url, { id: 'g', room: 'r', name: 'Guest' });
    const stranger = await join(url, { id: 's', room: 'r' });
    assert.deepEqual(stranger.welcome.peers.map((p) => p.name).sort(), ['Guest', 'Host', 's']);
    host.send({ type: 'data', to: 'g', data: 'sealed-for-the-guest' });
    host.send({ type: 'signal', to: 'g', kind: 'offer', payload: 'sealed' });
    assert.equal((await guest.next('data')).data, 'sealed-for-the-guest');
    await guest.next('signal');
    assert.ok(await stranger.silent('data'));
    assert.ok(await stranger.silent('signal', 50));
    // and it cannot take a peer's place to be sent its messages
    const twin = connect(url);
    await twin.opened;
    twin.send({ type: 'hello', id: 'g', room: 'r' });
    assert.equal(await twin.closed, CLOSE.idTaken);
    for (const c of [host, guest, stranger]) c.close();
    await relay.close();
  });
});
