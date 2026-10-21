// The pad bytes a guest sends, and the control messages.
//   node --test web/share/test/*.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BTN, NEUTRAL, PAD_BYTES, PAD_ID, TAG, axisByte, decodeControl, decodePad, encodeControl, encodePad,
  isNewer, mergePads, padFromGamepad, padFromKeys, viewOf,
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
