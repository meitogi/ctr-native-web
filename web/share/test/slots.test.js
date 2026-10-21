// Which guest drives which player, and the bytes the game reads for slots 1–3.
//   node --test web/share/test/*.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAD_ID, encodePad } from '../protocol.js';
import { PACKET_BYTES, createSlots } from '../slots.js';

const clock = () => {
  let t = 0;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
};

test('guests take slots 1, 2, 3 in order of arrival ; a fourth gets 0 ; a known guest keeps its slot', () => {
  const s = createSlots();
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => s.take(id)), [1, 2, 3, 0]);
  assert.equal(s.take('b'), 2);
  assert.equal(s.slotOf('d'), 0);
});

test('a guest leaving frees its slot, the next guest takes the lowest free one', () => {
  const s = createSlots();
  s.take('a');
  s.take('b');
  s.take('c');
  assert.equal(s.release('b'), 2);
  assert.equal(s.release('b'), 0, 'twice is a no-op');
  assert.equal(s.take('d'), 2);
  assert.equal(s.release('a'), 1);
  assert.equal(s.take('e'), 1);
});

test('read : the PSX packet of each held slot at dst + (slot − 1) × 8, mask bit n = slot n', () => {
  const now = clock();
  const s = createSlots({ now });
  s.take('a');
  s.take('b');
  assert.equal(s.receive('b', encodePad(7, { id: PAD_ID.analog, buttons: 0xbfef, analog: [10, 20, 30, 40] })), true);
  const heap = new Uint8Array(64).fill(0xee);
  const mask = s.read(heap, 16);
  assert.equal(mask, 0b0110);
  assert.deepEqual([...heap.subarray(16, 16 + PACKET_BYTES)], [0, 0x41, 0xff, 0xff, 0x80, 0x80, 0x80, 0x80], 'slot 1 : no pad yet = neutral');
  assert.deepEqual([...heap.subarray(24, 24 + PACKET_BYTES)], [0, 0x73, 0xef, 0xbf, 10, 20, 30, 40], 'slot 2 : b\'s pad');
  assert.deepEqual([...heap.subarray(32, 40)], new Array(8).fill(0xee), 'slot 3 untouched');
  assert.deepEqual([...heap.subarray(0, 16)], new Array(16).fill(0xee));
});

test('latest wins : an older or repeated seq is dropped, a pad from a guest without a slot too', () => {
  const s = createSlots({ now: clock() });
  s.take('a');
  assert.equal(s.receive('a', encodePad(10, { id: PAD_ID.digital, buttons: 0xbfff, analog: [128, 128, 128, 128] })), true);
  assert.equal(s.receive('a', encodePad(9, { id: PAD_ID.digital, buttons: 0xffff, analog: [128, 128, 128, 128] })), false);
  assert.equal(s.receive('a', encodePad(10, { id: PAD_ID.digital, buttons: 0xffff, analog: [128, 128, 128, 128] })), false);
  assert.equal(s.get(1).pad.buttons, 0xbfff);
  assert.equal(s.receive('z', encodePad(1, { id: PAD_ID.digital, buttons: 0, analog: [0, 0, 0, 0] })), false);
  assert.equal(s.receive('a', Uint8Array.of(1, 2, 3)), false);
});

test('a silent guest reads as nothing held after staleMs (a lost release must not hold a button), still connected', () => {
  const now = clock();
  const s = createSlots({ now, staleMs: 500 });
  s.take('a');
  s.receive('a', encodePad(1, { id: PAD_ID.digital, buttons: 0xbfff, analog: [128, 128, 128, 128] }));
  const heap = new Uint8Array(24);
  now.advance(500);
  s.read(heap, 0);
  assert.equal(heap[3] << 8 | heap[2], 0xbfff, 'fresh');
  now.advance(1);
  assert.equal(s.read(heap, 0), 0b10);
  assert.equal(heap[3] << 8 | heap[2], 0xffff, 'stale');
});

test('a released slot disappears from the mask', () => {
  const s = createSlots();
  s.take('a');
  s.release('a');
  assert.equal(s.read(new Uint8Array(24), 0), 0);
});
