// The browser transport in wasm : online_test.c's room script (A3 / A5), ported to JS,
// on three wasm clients (tests/online/web_client.c) — A hosts sv_core.c, reached over
// loopback, B and C are guests whose links go through web/online/net.js and a JS room.
// Each client runs like the game : a frame, then emscripten_sleep() (ASYNCIFY), while the
// network delivers into the JS queue.
//
//   CTR_WEB_CLIENT=build-online-web/online_web_client.js [CTR_WEB_TRACE_DIR=dir] \
//     [CTR_ONLINE_TEST=build-online/online_test CTR_ONLINE_TRACES=build-online/traces/upstream] \
//     node --test web/online/test/wasm-room.test.mjs
//
// Built by tests/online/CMakeLists.txt under Emscripten (ctest : online_web_room). Two runs :
// over an in-memory room (fake-room.mjs ; with CTR_ONLINE_TEST, its traces are compared with
// the native run by `online_test --compare`), and over the real web/net/ room through a local
// ctr-relay (relay/, `npm ci` there first) — node has no WebRTC, so that is the WebSocket path,
// sealed with the room key, one guest forced (`mode: 'ws'`), one falling back from 'auto'.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createOnlineNet } from '../net.js';
import { formatRoomLink, newRoom } from '../../net/link.js';
import { openRoom } from '../../net/room.js';
import { fakeNetwork } from './fake-room.mjs';

const clientJs = process.env.CTR_WEB_CLIENT;
const traceDir = process.env.CTR_WEB_TRACE_DIR;
const createWebClient = clientJs ? createRequire(import.meta.url)(resolve(clientJs)) : null;

// tests/online/online_test.c
const OP = { PICK_SERVER: 1, JOIN_ROOM: 2, PICK_TRACK: 3, CHARACTER: 4, KART: 5, KART_ITEMS: 6, HOLD: 7, FIRE: 8, FINISH: 9, SLEEP: 11 };
// game/OnlineCTR/global.h
const ST = { PICK_SERVER: 1, PICK_ROOM: 2, HOST_TRACK_PICK: 5, GUEST_TRACK_WAIT: 6, CHARACTER_PICK: 7, WAIT_FOR_LOADING: 8, WAIT_FOR_RACE: 10, START_RACE: 11 };
const SG_RACEDATA = 7;
const CG_RACEDATA = 5;
const VERSION = 1021;
const TEST_ROOM = 5;
const NAMES = ['A', 'B', 'C'];
const PLAYERS = ['Alpha', 'Bravo', 'Charlie'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One wasm client : its module, its JS transport, and the frames it published. */
async function startClient(i, room, frameMs) {
  const net = createOnlineNet({ name: PLAYERS[i] });
  if (i === 0) net.host(room);
  else net.guest(room);
  const c = { name: NAMES[i], net, waiters: [], frames: 0, queueAfterFrame: [], sleepingQueue: [] };
  c.mod = await createWebClient({
    ctrOnlineNet: net,
    frameMs,
    cmds: [],
    trace: [],
    print: () => {},
    printErr: (t) => process.stderr.write(`[${NAMES[i]}] ${t}\n`),
    onFrame() {
      c.frames++;
      // D6 : the frame drained everything that arrived while it slept
      if (c.mod?.snapshot.CurrState >= ST.PICK_ROOM) c.queueAfterFrame.push(net.queue.length);
      const w = c.waiters;
      c.waiters = [];
      for (const fn of w) fn();
    },
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
  for (;;) {
    if (clients.every((c) => pred(c.mod.snapshot, c))) return Date.now() - start;
    if (Date.now() - start > timeoutMs) {
      const state = clients.map((c) => `${c.name}: CurrState ${c.mod.snapshot.CurrState} DriverID ${c.mod.snapshot.DriverID} NumDrivers ${c.mod.snapshot.NumDrivers} frames ${c.mod.snapshot.frames}`);
      assert.fail(`timeout waiting for: ${what}\n${state.join('\n')}`);
    }
    await sleep(5);
  }
}

/** A guest's trace has no channel (the link does not say) : take it from the deliveries, matching bytes. */
function withChannels(trace, deliveries = []) {
  let d = 0;
  return trace.map((t, k) => {
    while (d < deliveries.length && !sameBytes(deliveries[d].bytes.subarray(0, 16), t.bytes)) d++;
    assert.ok(d < deliveries.length, `traced message ${k} (type ${t.bytes[0] & 0xf}) was never delivered`);
    return { reliable: deliveries[d++].reliable, bytes: t.bytes };
  });
}

const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const dump = (trace) => trace.map((t) => `${t.reliable} ${t.bytes.length}${[...t.bytes].map((x) => ` ${x.toString(16).padStart(2, '0')}`).join('')}\n`).join('');

/**
 * online_test.c's RunScript on three wasm clients.
 * @param {object} network - rooms : [host, guest B, guest C] ; frameMs : each frame's sleep ; sends : [{from, to, reliable, bytes}] ;
 *   connects() : room.connect() calls so far ; deliveries(name) : what reached that guest, in order
 */
async function runScript(t, network, traceOut) {
  const clients = [];
  for (let i = 0; i < 3; i++) clients.push(await startClient(i, network.rooms[i], network.frameMs));
  const [A, B, C] = clients;
  const all = clients, ab = [A, B];
  const state = (s) => (snap) => snap.CurrState === s;
  try {
    await waitFor('boot -> LAUNCH_PICK_SERVER', all, state(ST.PICK_SERVER), 3000);

    await t.test('entry 0 (public server) is refused and the game is back on the server menu', async () => {
      const before = network.connects();
      await send(B, OP.PICK_SERVER, 0);
      await waitFor('back to the server menu', [B], (s) => s.CurrState === ST.PICK_SERVER && s.serverLockIn1 === 0 && s.boolClientBusy === 0, 3000);
      assert.equal(network.connects(), before, 'no room.connect() for a public server');
    });

    for (const c of all) await send(c, OP.PICK_SERVER, 7); // Private Room = the room link
    await waitFor('connected, room list received', all, (s) => s.CurrState === ST.PICK_ROOM && s.numRooms === 16, 10000);
    assert.equal(B.mod.snapshot.numRooms, 16);
    assert.equal(B.mod.snapshot.ver_server, VERSION);

    await send(A, OP.JOIN_ROOM, TEST_ROOM);
    await waitFor('A joins as host', [A], state(ST.HOST_TRACK_PICK), 3000);
    await waitFor('room list shows 1 player', [B, C], (s) => s.clientCount[TEST_ROOM] === 1, 3000);
    await send(B, OP.JOIN_ROOM, TEST_ROOM);
    await waitFor('B joins as guest', [B], state(ST.GUEST_TRACK_WAIT), 3000);
    const names = (n) => (s) => s.NumDrivers === n && s.names.slice(0, n).every((x) => x !== '');
    await waitFor('A and B see 2 names', ab, names(2), 3000);
    await send(C, OP.JOIN_ROOM, TEST_ROOM);
    await waitFor('C joins as guest', [C], state(ST.GUEST_TRACK_WAIT), 3000);
    await waitFor('everyone sees 3 names', all, names(3), 3000);
    all.forEach((c, i) => assert.equal(c.mod.snapshot.DriverID, i, `${c.name} DriverID`));
    assert.deepEqual(A.mod.snapshot.names.slice(0, 3), ['Alpha', 'Bravo', 'Charlie']);
    assert.deepEqual(B.mod.snapshot.names.slice(1, 3), ['Alpha', 'Charlie']);
    for (const c of all) assert.equal(c.mod.snapshot.gameMode2 & 0x100000, 0, 'item room, no retro turbo pads');

    await send(A, OP.PICK_TRACK, 3, 1);
    await waitFor('track picked -> LOBBY_CHARACTER_PICK', all, state(ST.CHARACTER_PICK), 3000);
    for (const c of all) assert.deepEqual([c.mod.snapshot.levelID, c.mod.snapshot.numLaps], [3, 3]);

    for (let i = 0; i < 3; i++) {
      await send(clients[i], OP.CHARACTER, 10 + i, 1);
      await waitFor('character locked', [clients[i]], (s) => s.CurrState >= (i < 2 ? ST.WAIT_FOR_LOADING : ST.WAIT_FOR_RACE), 5000);
      await sleep(50);
    }
    await waitFor('everyone loaded', all, (s) => s.CurrState >= ST.WAIT_FOR_RACE, 5000);
    assert.deepEqual(A.mod.snapshot.characterIDs.slice(1, 3), [11, 12]);
    assert.deepEqual(C.mod.snapshot.characterIDs.slice(1, 3), [10, 11]);

    await waitFor('fly-in done -> SG_STARTRACE', all, state(ST.START_RACE), 5000);
    for (let i = 0; i < 3; i++) {
      await send(clients[i], OP.KART, (1000 + i) * 256 + 0x7f, -(2 + i) * 256, (300 + i) * 256, 0xabc + i);
      await send(clients[i], OP.KART_ITEMS, 7, 300);
      await send(clients[i], OP.HOLD, 0x10 | 0x400);
    }
    const remoteKarts = (alive) => (s, c) => {
      const me = clients.indexOf(c);
      for (let other = 0; other < alive; other++) {
        if (other === me) continue;
        const slot = other < me ? other + 1 : other;
        const k = s.karts[slot];
        if (k.posX !== (1000 + other) * 256 || k.posY !== -(2 + other) * 256 || k.posZ !== (300 + other) * 256) return false;
        if (k.angle !== 0xabc + other || s.pads[slot].held !== 0x410) return false;
      }
      return true;
    };
    await waitFor('remote kart pose, angle and pad bits on every side', all, remoteKarts(3), 5000);
    assert.equal(A.mod.snapshot.karts[1].reserves, 200, 'reserves > 200 sent as 200');
    assert.equal(A.mod.snapshot.karts[1].numWumpas, 7);

    await t.test('ASYNCIFY : what lands while a guest sleeps waits in the JS queue, drained by its next frame', async () => {
      const framesBefore = B.frames;
      const queued = [];
      const sampler = setInterval(() => queued.push(B.net.queue.length), 5);
      B.mod.cmds.push(Int32Array.of(OP.SLEEP, 200));
      await sleep(150);
      clearInterval(sampler);
      assert.equal(B.frames, framesBefore, 'B is still inside the frame that sleeps');
      assert.ok(Math.max(...queued) >= 3, `kart states queued during the sleep (max ${Math.max(...queued)})`);
      const pending = B.net.queue.length;
      await nextFrame(B);
      assert.equal(B.net.queue.length, 0, `the next frame drained all ${pending} queued events`);
    });

    await send(A, OP.FIRE, 3, 1, 2);
    await waitFor('A fires : B and C get Shoot[1]', [B, C], (s) => s.shoot[1].boolNow === 1, 3000);
    assert.deepEqual([B.mod.snapshot.shoot[1].Weapon, B.mod.snapshot.shoot[1].boolJuiced, B.mod.snapshot.shoot[1].flags], [3, 1, 2]);

    await send(C, OP.HOLD, 0x2000); // SELECT
    await waitFor('C leaves : A and B see an empty name, slot holds SQUARE', ab, (s) => s.names[2] === '' && s.pads[2].held === 0x20, 5000);
    assert.equal(B.mod.snapshot.CurrState, ST.START_RACE, 'race goes on');

    await send(A, OP.FINISH, 1000, 300);
    await waitFor('A ends : B gets SG_ENDRACE', [B], (s) => s.numDriversEnded === 1, 3000);
    assert.deepEqual(B.mod.snapshot.raceStats0, { slot: 1, finalTime: 1000, bestLap: 300 });
    await send(B, OP.FINISH, 1100, 310);
    await waitFor('both ended', ab, (s) => s.numDriversEnded === 2, 3000);
    await waitFor('room reset -> back to track pick', ab, (s, c) => s.CurrState === (c === A ? ST.HOST_TRACK_PICK : ST.GUEST_TRACK_WAIT) && s.numDriversEnded === 0, 60000);
    // the names everyone re-sends after the reset are still in flight (native : the DUMP round trips)
    await sleep(500);

    await t.test('D6 : every frame ended with the JS queue empty', () => {
      for (const c of all) assert.ok(c.queueAfterFrame.length > 20 && c.queueAfterFrame.every((n) => n === 0), `${c.name} : ${c.queueAfterFrame.filter((n) => n).length} frames ended with events left`);
    });

    await t.test('D7 : CG_RACEDATA / SG_RACEDATA ride `game`, everything else `ctl`', () => {
      assert.ok(network.sends.length > 100);
      for (const s of network.sends) {
        const type = s.bytes[0] & 0xf;
        const race = s.to === 'A' ? type === CG_RACEDATA : type === SG_RACEDATA;
        assert.equal(s.reliable, !race, `${s.from} → ${s.to} type ${type}`);
      }
    });

    await t.test('traces : every received message was delivered byte for byte ; same as the native run', () => {
      const traces = {
        A: A.mod.trace,
        B: withChannels(B.mod.trace, network.deliveries('B')),
        C: withChannels(C.mod.trace, network.deliveries('C')),
      };
      for (const n of NAMES) assert.ok(traces[n].length > 50, `${n} traced ${traces[n].length} messages`);
      if (!traceOut) return;
      mkdirSync(traceOut, { recursive: true });
      for (const n of NAMES) writeFileSync(join(traceOut, `trace-${n}.txt`), dump(traces[n]));
      const bin = process.env.CTR_ONLINE_TEST;
      const native = process.env.CTR_ONLINE_TRACES;
      if (!bin || !native) return;
      const out = execFileSync(bin, ['--compare', native, traceOut], { encoding: 'utf8' });
      process.stdout.write(out);
      assert.match(out, /PASSED: traces equal/);
    });
  } finally {
    for (const c of all) c.mod.running = false;
  }
}

const skip = !createWebClient && 'CTR_WEB_CLIENT not set';
const relayDeps = existsSync(new URL('../../../relay/node_modules/ws', import.meta.url));

test('room script over an in-memory room : host sv_core in wasm, two guests over the web transport', { skip }, async (t) => {
  const fake = fakeNetwork();
  await runScript(t, {
    rooms: [fake.hostRoom('A'), fake.guestRoom('B'), fake.guestRoom('C')],
    sends: fake.sends,
    connects: () => fake.connects,
    deliveries: (name) => fake.deliveries[name],
  }, traceDir);
});

/** Logs what a link sends (the WebSocket link has one channel : the flag is the sender's). */
function tap(link, from, to, sends) {
  const send = link.send;
  link.send = (bytes, opts) => {
    sends.push({ from, to, reliable: !!opts?.reliable, bytes: bytes.slice() });
    send(bytes, opts);
  };
  return link;
}

test('room script over web/net/ and a local ctr-relay (WebSocket path, sealed)', { skip: skip || (!relayDeps && 'relay/node_modules missing : npm ci in relay/') }, async (t) => {
  const { createRelay } = await import('../../../relay/relay.js');
  const rk = 'test-relay-key';
  // Frames at the game's 30 fps : the stub's default ~500 fps floods the WebSocket path
  // (thousands of kart states queued ahead of a weapon). At 30 fps, three players are 120
  // messages / s from the host's socket — the relay's default per-socket rate exactly.
  const relay = await createRelay({ port: 0, host: '127.0.0.1', key: rk, log: () => {} });
  const link = formatRoomLink('http://localhost/', newRoom({ relay: `ws://127.0.0.1:${relay.port}`, rk }));
  const sends = [];
  let connects = 0;
  const names = Object.create(null); // room peer id → test name
  try {
    const host = await openRoom({ link, role: 'host', name: 'Alpha' });
    host.on('link', (l) => tap(l, 'A', names[l.peerId] ?? l.peerId, sends));
    const guest = async (name, mode) => {
      const room = await openRoom({ link, role: 'guest', mode, name });
      names[room.selfId] = name;
      const connect = room.connect;
      room.connect = async () => {
        connects++;
        return tap(await connect(), name, 'A', sends);
      };
      return room;
    };
    const warnings = [];
    const B = await guest('B', 'auto');
    B.on('warning', (w) => warnings.push(w.code));
    const C = await guest('C', 'ws');
    await runScript(t, {
      rooms: [host, B, C],
      frameMs: 33,
      sends,
      connects: () => connects,
      deliveries: (name) => sends.filter((s) => s.to === name).map((s) => ({ reliable: s.reliable ? 1 : 0, bytes: s.bytes })),
    }, null);
    assert.ok(warnings.includes('no-webrtc'), 'B (auto) fell back to the relay : no WebRTC in node');
    for (const l of Object.values(host.links)) assert.equal(l.path, 'relay');
    host.close();
    B.close();
    C.close();
  } finally {
    await relay.close();
  }
});
