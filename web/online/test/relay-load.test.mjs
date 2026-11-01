// Load on the relay's WebSocket path : N wasm clients (tests/online/web_client.c) at the game's
// 30 fps through a local ctr-relay, every guest on the relay — the host's page fans every kart
// state out to every guest. Measures, per guest, the kart states received per second and the
// reliable weapon messages lost (each client fires once a second ; the server echoes kart states
// and weapons to their sender too, as upstream), and the host socket's
// messages per second to the relay.
//
//   CTR_WEB_CLIENT=build-online-web/online_web_client.js node --test web/online/test/relay-load.test.mjs
//   (CTR_LOAD_PLAYERS=4 CTR_LOAD_SECONDS=20 CTR_LOAD_RATE=120 to change the run)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import WebSocket from '../../../relay/node_modules/ws/index.js';
import { ONLINE_TAG, createOnlineNet } from '../net.js';
import { formatRoomLink, newRoom } from '../../net/link.js';
import { openRoom } from '../../net/room.js';

const clientJs = process.env.CTR_WEB_CLIENT;
const createWebClient = clientJs ? createRequire(import.meta.url)(resolve(clientJs)) : null;
const relayDeps = existsSync(new URL('../../../relay/node_modules/ws', import.meta.url));

const OP = { PICK_SERVER: 1, JOIN_ROOM: 2, PICK_TRACK: 3, CHARACTER: 4, KART: 5, KART_ITEMS: 6, HOLD: 7, FIRE: 8 };
const ST = { PICK_ROOM: 2, HOST_TRACK_PICK: 5, GUEST_TRACK_WAIT: 6, CHARACTER_PICK: 7, WAIT_FOR_LOADING: 8, WAIT_FOR_RACE: 10, START_RACE: 11 };
const SG_RACEDATA = 7;
const SG_WEAPON = 8;
const TEST_ROOM = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLAYERS = Number(process.env.CTR_LOAD_PLAYERS ?? 4);
const SECONDS = Number(process.env.CTR_LOAD_SECONDS ?? 20);
const RATE = process.env.CTR_LOAD_RATE ? Number(process.env.CTR_LOAD_RATE) : undefined;

/** A WebSocket that counts what this page sends to the relay ; `mute` : it sends nothing more. */
function countingWs(counter) {
  return class extends WebSocket {
    send(data, ...rest) {
      if (counter.mute) return undefined;
      counter.sent++;
      return super.send(data, ...rest);
    }
  };
}

async function startClient(i, room) {
  const net = createOnlineNet({ name: `P${i}` });
  if (i === 0) net.host(room);
  else net.guest(room);
  const c = { i, net, waiters: [], got: { race: 0, weapon: 0 } };
  // what reached this client's game, by type (the queue the wasm drains)
  const push = net.queue.push.bind(net.queue);
  net.queue.push = (e) => {
    if (e.bytes?.length && i !== 0) {
      const type = e.bytes[0] & 0xf;
      if (type === SG_RACEDATA) c.got.race++;
      if (type === SG_WEAPON) c.got.weapon++;
    }
    return push(e);
  };
  c.mod = await createWebClient({
    ctrOnlineNet: net, frameMs: 33, cmds: [], trace: [], print: () => {}, printErr: () => {},
    onFrame() { const w = c.waiters; c.waiters = []; for (const fn of w) fn(); },
  });
  return c;
}
const nextFrame = (c) => new Promise((r) => c.waiters.push(r));
async function send(c, op, a = 0, b = 0, d = 0, e = 0) {
  c.mod.cmds.push(Int32Array.of(op, a, b, d, e));
  await nextFrame(c);
}
async function waitFor(what, clients, pred, timeoutMs) {
  const start = Date.now();
  while (!clients.every((c) => pred(c.mod.snapshot, c))) {
    if (Date.now() - start > timeoutMs) assert.fail(`timeout waiting for ${what} : ${clients.map((c) => `P${c.i} ${c.mod.snapshot.CurrState}/${c.mod.snapshot.NumDrivers}`).join(', ')}`);
    await sleep(5);
  }
}

test(`${PLAYERS} players, every guest on the relay, ${SECONDS} s of race`, { skip: (!createWebClient && 'CTR_WEB_CLIENT not set') || (!relayDeps && 'npm ci in relay/') }, async () => {
  const { createRelay } = await import('../../../relay/relay.js');
  const rk = 'load-key';
  const relay = await createRelay({ port: 0, host: '127.0.0.1', key: rk, log: () => {}, ...(RATE ? { rate: RATE, burst: RATE * 2 } : {}) });
  const link = formatRoomLink('http://localhost/', newRoom({ relay: `ws://127.0.0.1:${relay.port}`, rk }));
  const hostCount = { sent: 0 };
  const closes = [];
  const rooms = [];
  const clients = [];
  try {
    rooms.push(await openRoom({ link, role: 'host', name: 'P0', WebSocketImpl: countingWs(hostCount) }));
    const lastGuest = { sent: 0, mute: false };
    for (let i = 1; i < PLAYERS; i++) rooms.push(await openRoom({ link, role: 'guest', mode: 'ws', name: `P${i}`, WebSocketImpl: i === PLAYERS - 1 ? countingWs(lastGuest) : WebSocket }));
    for (const r of rooms) r.on('close', (info) => closes.push(info));
    for (let i = 0; i < PLAYERS; i++) clients.push(await startClient(i, rooms[i]));
    const [A] = clients;
    for (const c of clients) await send(c, OP.PICK_SERVER, 7);
    await waitFor('room list', clients, (s) => s.CurrState === ST.PICK_ROOM && s.numRooms === 16, 10000);
    await send(A, OP.JOIN_ROOM, TEST_ROOM);
    await waitFor('host in', [A], (s) => s.CurrState === ST.HOST_TRACK_PICK, 3000);
    for (const c of clients.slice(1)) {
      await send(c, OP.JOIN_ROOM, TEST_ROOM);
      await waitFor('guest in', [c], (s) => s.CurrState === ST.GUEST_TRACK_WAIT, 3000);
    }
    await waitFor('all names', clients, (s) => s.NumDrivers === PLAYERS, 5000);
    await send(A, OP.PICK_TRACK, 3, 1);
    await waitFor('character pick', clients, (s) => s.CurrState === ST.CHARACTER_PICK, 3000);
    for (const c of clients) await send(c, OP.CHARACTER, 10 + c.i, 1);
    await waitFor('race', clients, (s) => s.CurrState === ST.START_RACE, 10000);
    for (const c of clients) {
      await send(c, OP.KART, (1000 + c.i) * 256, 0, 300 * 256, 0x100);
      await send(c, OP.HOLD, 0x10);
    }
    for (const c of clients) c.got = { race: 0, weapon: 0 };
    hostCount.sent = 0;
    const t0 = Date.now();
    let fires = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      // one weapon per client per second, reliable : every other client must get each one
      for (const c of clients) c.mod.cmds.push(Int32Array.of(OP.FIRE, 3, 0, 0, 0));
      fires++;
      await sleep(1000);
    }
    await sleep(1500); // the last weapons in flight
    const secs = (Date.now() - t0) / 1000;
    const out = {
      players: PLAYERS,
      relayRate: RATE ?? 300,
      hostToRelayPerSec: Math.round(hostCount.sent / secs),
      guests: clients.slice(1).map((c) => ({ guest: c.i, racePerSec: Math.round(c.got.race / secs), raceExpectedPerSec: PLAYERS * 30, weaponsGot: c.got.weapon, weaponsExpected: fires * PLAYERS })),
      closes,
    };
    console.log(`RELAY-LOAD ${JSON.stringify(out)}`);
    const lost = out.guests.reduce((n, g) => n + (g.weaponsExpected - g.weaponsGot), 0);
    assert.equal(closes.length, 0, `a relay socket closed : ${JSON.stringify(closes)}`);
    assert.equal(lost, 0, `reliable weapon messages lost on the relay : ${lost}`);

    // The last guest's page goes silent (its socket stays open : a frozen tab, a dead Wi-Fi the
    // relay has not noticed) : the host drops it within the core's 5 s room timeout, the others
    // see its empty name and race on.
    lastGuest.mute = true;
    const muted = Date.now();
    const gone = PLAYERS - 1;
    await waitFor('the silent guest dropped', clients.slice(0, -1), (s) => s.names[gone] === '', 10000);
    const noticedMs = Date.now() - muted;
    console.log(`RELAY-SILENT-GUEST ${JSON.stringify({ noticedMs, timedOut: A.net.timedOut })}`);
    assert.ok(noticedMs <= 6000, `noticed after ${noticedMs} ms`);
    for (const c of clients.slice(0, -1)) assert.equal(c.mod.snapshot.CurrState, ST.START_RACE, `P${c.i} races on`);
  } finally {
    for (const c of clients) c.mod.running = false;
    for (const r of rooms) r.close();
    await relay.close();
  }
});
