// The pad bytes a guest sends, and the control messages.
//   node --test web/share/test/*.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BTN, KEYS, NAME_LEN, NEUTRAL, PAD_BYTES, PAD_ID, STANDARD as STANDARD_MAP, TAG, axisByte, choosePad, cleanName, decodeControl,
  decodePad, encodeControl, encodePad, isNewer, mergePads, nameOf, padFromGamepad, padFromKeys, pickPad, viewOf,
} from '../protocol.js';
import { stereoOpus } from '../media.js';

test('a PAD message is 10 bytes : tag, seq LE, id, buttons LE (active low), analog right X/Y, left X/Y', () => {
  const bytes = encodePad(0x1234, { id: PAD_ID.analog, buttons: 0xbfef, analog: [1, 2, 3, 4] });
  assert.deepEqual([...bytes], [TAG.pad, 0x34, 0x12, 0x73, 0xef, 0xbf, 1, 2, 3, 4]);
  assert.equal(bytes.length, PAD_BYTES);
  assert.deepEqual(decodePad(bytes), { seq: 0x1234, id: 0x73, buttons: 0xbfef, analog: [1, 2, 3, 4] });
});

test('decodePad refuses anything that is not a PAD message', () => {
  assert.equal(decodePad(Uint8Array.of(TAG.pad, 1, 2)), null, 'short');
  assert.equal(decodePad(Uint8Array.of(TAG.offer, 0, 0, 0, 0, 0, 0, 0, 0, 0)), null, 'other tag');
});

test('isNewer : u16 sequence, wraps, a repeat or an older one is not newer', () => {
  assert.equal(isNewer(5, null), true);
  assert.equal(isNewer(6, 5), true);
  assert.equal(isNewer(5, 5), false);
  assert.equal(isNewer(4, 5), false);
  assert.equal(isNewer(0, 0xffff), true, 'wrap');
  assert.equal(isNewer(0xfffe, 1), false, 'older across the wrap');
});

test('control messages : tag byte then the JSON body ; unknown tags and bad JSON are null', () => {
  const bytes = encodeControl(TAG.welcome, { slot: 2 });
  assert.equal(bytes[0], 0x12);
  assert.equal(new TextDecoder().decode(bytes.subarray(1)), '{"slot":2}');
  assert.deepEqual(decodeControl(bytes), { tag: TAG.welcome, body: { slot: 2 } });
  assert.deepEqual(decodeControl(encodeControl(TAG.refuse, { code: 'online-mode', message: 'm' })).body, { code: 'online-mode', message: 'm' });
  assert.equal(decodeControl(Uint8Array.of(0x7f, 0x7b, 0x7d)), null);
  assert.equal(decodeControl(Uint8Array.of(TAG.offer, 0x7b)), null);
  assert.equal(decodeControl(encodePad(1, NEUTRAL)), null);
});

const gamepad = (pressed = [], axes = [0, 0, 0, 0]) => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
  axes,
});

test('standard gamepad → PSX : south Cross, east Circle, west Square, north Triangle, the d-pad, Start', () => {
  assert.equal(padFromGamepad(gamepad([0])).buttons, 0xffff & ~BTN.cross);
  assert.equal(padFromGamepad(gamepad([0])).buttons, 0xbfff);
  assert.equal(padFromGamepad(gamepad([1, 2, 3])).buttons, 0xffff & ~(BTN.circle | BTN.square | BTN.triangle));
  assert.equal(padFromGamepad(gamepad([12, 15, 9])).buttons, 0xffff & ~(BTN.up | BTN.right | BTN.start));
  assert.equal(padFromGamepad(gamepad([6, 7])).buttons, 0xfcff, 'L2 R2');
  assert.equal(padFromGamepad(gamepad()).id, PAD_ID.analog);
});

test('gamepad sticks → analog bytes in native order (right X, right Y, left X, left Y), dead zone at centre', () => {
  assert.deepEqual(padFromGamepad(gamepad([], [-1, 1, 1, -1])).analog, [255, 1, 1, 255]);
  assert.deepEqual(padFromGamepad(gamepad([], [0.01, -0.01, 0, 0])).analog, [128, 128, 128, 128]);
  assert.equal(axisByte(0.5), 191);
});

test('keyboard → PSX : the host keyboard mapping (arrows, C Cross, V Circle, X Square, Z Triangle, Enter Start)', () => {
  const pad = padFromKeys({ ArrowLeft: true, KeyC: true, Enter: true, KeyQ: true });
  assert.equal(pad.buttons, 0xffff & ~(BTN.left | BTN.cross | BTN.start));
  assert.equal(pad.id, PAD_ID.digital);
  assert.deepEqual(pad.analog, [128, 128, 128, 128]);
  assert.equal(padFromKeys({}).buttons, 0xffff);
});

test('mergePads : buttons from both, sticks from the gamepad', () => {
  const merged = mergePads(padFromKeys({ KeyC: true }), padFromGamepad(gamepad([1], [1, 0, 0, 0])));
  assert.equal(merged.buttons, 0xffff & ~(BTN.cross | BTN.circle));
  assert.equal(merged.id, PAD_ID.analog);
  assert.deepEqual(merged.analog, [128, 128, 255, 128]);
});

test('stereoOpus asks for stereo on the Opus fmtp line once', () => {
  const sdp = 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:63 red/48000/2\r\n';
  const out = stereoOpus(sdp);
  assert.match(out, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1\r\n/);
  assert.equal(stereoOpus(out), out);
  assert.equal(stereoOpus('m=video 9\r\n'), 'm=video 9\r\n');
});

test('viewOf : a player\'s own view — 2 players top / bottom, 3–4 quadrants, else the full frame', () => {
  assert.deepEqual(viewOf(1, 2), { x: 0, y: 0.5, w: 1, h: 0.5 });
  assert.deepEqual(viewOf(1, 3), { x: 0.5, y: 0, w: 0.5, h: 0.5 });
  assert.deepEqual(viewOf(2, 4), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
  assert.deepEqual(viewOf(3, 4), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  assert.deepEqual(viewOf(1, 1), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(viewOf(3, 3), { x: 0, y: 0, w: 1, h: 1 }, 'no fourth quadrant in a 3-player race');
});

// ---- session 20 : names, HELLO, « Who plays » ----

test('HELLO is a control message ; above it nothing is', () => {
  assert.equal(TAG.hello, 0x15);
  assert.deepEqual(decodeControl(encodeControl(TAG.hello, { name: 'Mad Roo' })), { tag: TAG.hello, body: { name: 'Mad Roo' } });
  assert.equal(decodeControl(encodeControl(TAG.track + 1, {})), null);
});

test('cleanName is web/ui\'s (the same 9 printable ASCII) ; nameOf falls back to P<n>', async () => {
  const ui = await import('../../ui/src/lib/settings.js');
  for (const s of ['Crash Bandicoot', 'Coco 🦊é!', '', null, '   ', 'N.Gin\t\n', 'x'.repeat(30)]) assert.equal(cleanName(s), ui.cleanName(s), JSON.stringify(s));
  assert.equal(NAME_LEN, ui.NAME_LEN);
  assert.equal(nameOf(1, '  '), 'P2');
  assert.equal(nameOf(0, 'Turbo Roo'), 'Turbo Roo');
});

test('a stick resting at 0.05 is far from a direction : the game needs past 0x20 / 0xe0', () => {
  const pad = padFromGamepad({ buttons: [], axes: [0.05, 0.05, 0, 0] });
  assert.deepEqual(pad.analog.slice(2), [134, 134]);
  assert.ok(pad.analog[2] > 0x20 && pad.analog[2] < 0xe0); // GAMEPAD_ProcessTapRelease
  const stuck = padFromGamepad({ buttons: [], axes: [0, 0.8, 0, 0] });
  assert.ok(stuck.analog[3] > 0xe0, 'a stuck axis reads as Down');
});

const gp = (id, { mapping = 'standard', index = 0, pressed = [] } = {}) => ({
  id, index, mapping, connected: true, axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

test('choosePad : the chosen pad by id and rank, else the first standard one, else the first', () => {
  const odd = gp('3D mouse', { mapping: '', index: 0 });
  const a = gp('Xbox', { index: 1 });
  const b = gp('Xbox', { index: 2 });
  const list = [null, odd, a, b];
  assert.equal(choosePad(list, { id: 'Xbox', nth: 1 }), b);
  assert.equal(choosePad(list, { id: 'Xbox', nth: 0 }), a);
  assert.equal(choosePad(list, { id: 'gone', nth: 0 }), a);
  assert.equal(choosePad(list), a, 'a non-standard device is not taken first');
  assert.equal(choosePad([odd]), odd);
  assert.equal(choosePad([]), null);
});

test('pickPad : auto merges, keyboard ignores pads, gamepad ignores keys', () => {
  const held = { ArrowLeft: true };
  const pads = [gp('Xbox', { pressed: [0] })]; // Cross
  const auto = pickPad({ mode: 'auto' }, held, pads);
  assert.equal(auto.buttons, 0xffff & ~BTN.left & ~BTN.cross);
  assert.equal(pickPad({ mode: 'keyboard' }, held, pads).buttons, 0xffff & ~BTN.left);
  assert.equal(pickPad({ mode: 'keyboard' }, held, pads).id, PAD_ID.digital);
  assert.equal(pickPad({ mode: 'gamepad', pad: null }, held, pads).buttons, 0xffff & ~BTN.cross);
  assert.deepEqual(pickPad({ mode: 'gamepad', pad: null }, held, []), NEUTRAL);
  assert.equal(pickPad(undefined, held, []).buttons, 0xffff & ~BTN.left, 'no choice = auto');
});

test('the player\'s own mapping : web/ui guest-input.js tables drive the guest\'s pad', async () => {
  const { guestInput, PSX_BIT } = await import('../../ui/src/lib/guest-input.js');
  const { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, bind } = await import('../../ui/src/lib/mappings.js');
  for (const k in BTN) assert.equal(PSX_BIT[k], BTN[k], k);
  // the defaults are the native tables this file had hardcoded
  const def = guestInput({ keyboard: DEFAULT_KEYBOARD, gamepad: DEFAULT_GAMEPAD });
  assert.deepEqual(def.keys, KEYS);
  const sorted = (m) => m.slice().sort((x, y) => x[0] - y[0]);
  assert.deepEqual(sorted(def.buttons), sorted(STANDARD_MAP));
  // Cross on W (scancode 26) and on the pad's east button (SDL 1)
  const mine = guestInput({ keyboard: bind(DEFAULT_KEYBOARD, 'cross', 26), gamepad: bind(DEFAULT_GAMEPAD, 'cross', 1) });
  assert.equal(pickPad({ mode: 'keyboard' }, { KeyW: true }, [], mine).buttons, 0xffff & ~BTN.cross);
  assert.equal(pickPad({ mode: 'keyboard' }, { KeyC: true }, [], mine).buttons, 0xffff, 'C is no longer Cross');
  assert.equal(pickPad({ mode: 'gamepad' }, {}, [gp('Xbox', { pressed: [1] })], mine).buttons & BTN.cross, 0);
});
