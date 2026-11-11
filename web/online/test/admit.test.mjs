import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Emitter } from '../../net/events.js';
import { ADMIT, gateGuest, gateHost } from '../admit.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

/** Two link ends that deliver to each other, as a room's links do. */
function pair(peerId) {
  const make = () => Object.assign(new Emitter(), { peerId, closed: false, sent: [] });
  const a = make();
  const b = make();
  const wire = (from, to) => {
    from.send = (bytes) => { from.sent.push(bytes[0]); if (!to.closed) queueMicrotask(() => to.emit('message', bytes)); };
    from.close = () => {
      if (from.closed) return;
      from.closed = true;
      from.emit('close');
      if (!to.closed) { to.closed = true; to.emit('close'); }
    };
  };
  wire(a, b);
  wire(b, a);
  return [a, b];
}

/** A host room and the way a guest reaches it. */
function rooms() {
  const host = new Emitter();
  let n = 0;
  const guestRoom = () => {
    const [hostEnd, guestEnd] = pair(`g${++n}`);
    hostEnd.on('close', () => host.emit('linkclose', hostEnd));
    return { connect: async () => { host.emit('link', hostEnd); return guestEnd; }, hostEnd };
  };
  return { host, guestRoom };
}

test('a guest with the link\'s pass comes straight in ; the host\'s modules see its link only then', async () => {
  const { host, guestRoom } = rooms();
  const gate = gateHost(host, { pass: 'PASS' });
  const seen = [];
  gate.on('link', (l) => seen.push(l.peerId));
  const link = await gateGuest(guestRoom(), { pass: 'PASS', me: 'bee', name: 'Bee' }).connect();
  assert.deepEqual(seen, ['g1']);
  assert.equal(gate.asking(), null);
  assert.equal(link.closed, false);
});

test('a guest by code waits for the host\'s yes : nothing reaches the host\'s modules before it', async () => {
  const { host, guestRoom } = rooms();
  let changes = 0;
  const gate = gateHost(host, { pass: 'PASS', onChange: () => changes++ });
  const seen = [];
  gate.on('link', (l) => seen.push(l.peerId));
  let waited = 0;
  let inside = false;
  const joining = gateGuest(guestRoom(), { me: 'bee', name: 'Bee' , onWait: () => waited++ }).connect().then(() => { inside = true; });
  await tick();
  assert.deepEqual(seen, []);
  assert.deepEqual(gate.asking(), { name: 'Bee' });
  assert.equal(waited, 1);
  assert.equal(changes, 1);
  assert.equal(inside, false);
  gate.answer(true);
  await joining;
  assert.deepEqual(seen, ['g1']);
  assert.equal(gate.asking(), null);
});

test('a wrong pass is a guest by code ; the host\'s no rejects with code refused and closes the link', async () => {
  const { host, guestRoom } = rooms();
  const gate = gateHost(host, { pass: 'PASS' });
  const seen = [];
  const closed = [];
  gate.on('link', (l) => seen.push(l.peerId));
  gate.on('linkclose', (l) => closed.push(l.peerId));
  const room = guestRoom();
  const joining = gateGuest(room, { pass: 'WRONG', me: 'ex', name: 'Ex' }).connect();
  await tick();
  assert.deepEqual(gate.asking(), { name: 'Ex' });
  gate.answer(false);
  await assert.rejects(joining, { code: 'refused' });
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(room.hostEnd.closed, true);
  assert.deepEqual(seen, []);
  assert.deepEqual(closed, [], 'a link never let in is not a guest leaving');
});

test('a guest accepted once comes back without being asked ; a refused one is asked again', async () => {
  const { host, guestRoom } = rooms();
  const gate = gateHost(host, { pass: 'PASS' });
  const seen = [];
  const closed = [];
  gate.on('link', (l) => seen.push(l.peerId));
  gate.on('linkclose', (l) => closed.push(l.peerId));
  const first = gateGuest(guestRoom(), { me: 'bee', name: 'Bee' }).connect();
  await tick();
  gate.answer(true);
  (await first).close();
  assert.deepEqual(closed, ['g1']);
  await gateGuest(guestRoom(), { me: 'bee', name: 'Bee' }).connect();
  assert.deepEqual(seen, ['g1', 'g2']);

  const no = gateGuest(guestRoom(), { me: 'ex', name: 'Ex' }).connect();
  await tick();
  gate.answer(false);
  await assert.rejects(no, { code: 'refused' });
  const again = gateGuest(guestRoom(), { me: 'ex', name: 'Ex' }).connect();
  again.catch(() => {});
  await tick();
  assert.deepEqual(gate.asking(), { name: 'Ex' });
});

test('two guests knock : asked in order ; one who gives up leaves the queue', async () => {
  const { host, guestRoom } = rooms();
  const gate = gateHost(host, { pass: 'PASS' });
  const roomA = guestRoom();
  const a = gateGuest(roomA, { me: 'a', name: 'Ann' }).connect();
  a.catch(() => {});
  const b = gateGuest(guestRoom(), { me: 'b', name: 'Bob' }).connect();
  await tick();
  assert.deepEqual(gate.asking(), { name: 'Ann' });
  roomA.hostEnd.close();
  await assert.rejects(a, { code: 'absent' });
  assert.deepEqual(gate.asking(), { name: 'Bob' });
  gate.answer(true);
  await b;
});

test('a yes lost on the way is sent again at the guest\'s next ask ; other events pass through the gate', async () => {
  const { host, guestRoom } = rooms();
  const gate = gateHost(host, { pass: 'PASS' });
  let warned = null;
  gate.on('warning', (w) => { warned = w; });
  host.emit('warning', 'w');
  assert.equal(warned, 'w');
  const room = guestRoom();
  await gateGuest(room, { pass: 'PASS', me: 'bee' }).connect();
  const before = room.hostEnd.sent.filter((t) => t === ADMIT.yes).length;
  room.hostEnd.emit('message', Uint8Array.of(ADMIT.ask));
  assert.equal(room.hostEnd.sent.filter((t) => t === ADMIT.yes).length, before + 1);
});
