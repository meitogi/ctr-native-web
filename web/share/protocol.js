// Share mode's messages over a room link (web/net/transport.js), and the PSX pad a guest sends.
//
// Every message starts with a tag byte : a link's `message` event does not say which channel
// it came in on.
//   PAD      game channel (unordered, maxRetransmits 0), ~60 per second : latest wins by `seq`
//            [0] TAG.pad  [1..2] seq u16 LE  [3] pad id  [4..5] buttons u16 LE, active low
//            [6..9] analog : right X, right Y, left X, left Y (0x80 = centre)
//   OFFER / ANSWER   ctl (reliable) : the media renegotiation of the link's own
//            RTCPeerConnection, host offers — [0] tag, then UTF-8 JSON {sdp}
//   WELCOME  ctl, host → guest : {slot, host} — slot 1–3 (the game's P2–P4), the host's player
//            name (absent from a host before session 20)
//   REFUSE   ctl, host → guest : {code, message} — 'online-mode' (no direct path : Share
//            never streams through the relay), 'full' (three guests already)
//   PLAYERS  ctl, host → guests : {players, list} — pads plugged in (host + guests) : the
//            split-screen layout a guest crops its own view from ; `list` [{slot, name}] who is
//            who (slot 0 = the host). Sent on every change of either.
//   HELLO    ctl, guest → host : {name} — the guest's player name, once connected and again on
//            every rename. A guest that never sends one (a page before session 20) is « P<n> ».
//            Names travel only here, end to end over the link's DTLS : the relay's own `hello`
//            (web/net/) carries the fixed signaling names 'host' / 'guest', in clear.
//   BOT      ctl, guest → host : {} — a scripted guest (web/share/bot.sh) asks for its own kart.
//            Sent on WELCOME. Only a debug host answers (it reads window.__ctr) ; a release host,
//            or one before session 19, ignores it and the bot falls back to Cross held.
//   KART     game channel, host → that guest, once per present : {screen, levelID, players,
//            charSelect, kart} — window.__ctr's fields, `kart` = karts[slot] : the guest's own
//            driver (P2 = drivers[1]), the position and racing-line target the bot steers by.
//   TRACK    ctl, host → that guest : {levelID, path} — window.__ctr.track, the level's racing
//            line, once per level (before the first KART on it).
//   Debug-only in effect : no ordinary guest sends BOT, so no ordinary guest gets KART / TRACK —
//   and a guest before session 19 drops them anyway (decodeControl's range).

export const TAG = { pad: 1, offer: 0x10, answer: 0x11, welcome: 0x12, refuse: 0x13, players: 0x14, hello: 0x15, bot: 0x16, kart: 0x17, track: 0x18 };
export const PAD_BYTES = 10;

/** PSX pad ids : digital pad, analog (DualShock) pad. */
export const PAD_ID = { digital: 0x41, analog: 0x73 };

/** PSX button bits (platform/native_input.c) ; the pad word holds them active low. */
export const BTN = {
  select: 0x1, l3: 0x2, r3: 0x4, start: 0x8,
  up: 0x10, right: 0x20, down: 0x40, left: 0x80,
  l2: 0x100, r2: 0x200, l1: 0x400, r1: 0x800,
  triangle: 0x1000, circle: 0x2000, cross: 0x4000, square: 0x8000,
};

/** A neutral pad : nothing held, sticks centred. */
export const NEUTRAL = Object.freeze({ id: PAD_ID.digital, buttons: 0xffff, analog: Object.freeze([0x80, 0x80, 0x80, 0x80]) });

export function encodePad(seq, { id, buttons, analog }) {
  const out = new Uint8Array(PAD_BYTES);
  out[0] = TAG.pad;
  out[1] = seq & 0xff;
  out[2] = (seq >> 8) & 0xff;
  out[3] = id;
  out[4] = buttons & 0xff;
  out[5] = (buttons >> 8) & 0xff;
  out.set(analog, 6);
  return out;
}

/** The pad in a PAD message, or null when `bytes` is not one. */
export function decodePad(bytes) {
  if (bytes.length !== PAD_BYTES || bytes[0] !== TAG.pad) return null;
  return {
    seq: bytes[1] | (bytes[2] << 8),
    id: bytes[3],
    buttons: bytes[4] | (bytes[5] << 8),
    analog: [bytes[6], bytes[7], bytes[8], bytes[9]],
  };
}

/** True when u16 `seq` comes after `last` (wraps ; null = nothing seen yet). */
export function isNewer(seq, last) {
  if (last === null) return true;
  const d = (seq - last) & 0xffff;
  return d !== 0 && d < 0x8000;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export function encodeControl(tag, body) {
  const json = utf8.encode(JSON.stringify(body));
  const out = new Uint8Array(1 + json.length);
  out[0] = tag;
  out.set(json, 1);
  return out;
}

/** {tag, body} of a control message, or null when `bytes` is not one. */
export function decodeControl(bytes) {
  const tag = bytes[0];
  if (tag < TAG.offer || tag > TAG.track) return null;
  try {
    return { tag, body: JSON.parse(fromUtf8.decode(bytes.subarray(1))) };
  } catch {
    return null;
  }
}

/**
 * The part of the stream that is player `slot`'s own view, as fractions of the frame
 * {x, y, w, h}, for `players` split-screen players : 2 = top / bottom halves, 3–4 = quadrants
 * (P1 top left, P2 top right, P3 bottom left, P4 bottom right). Full frame otherwise.
 */
export function viewOf(slot, players) {
  if (players === 2 && slot < 2) return { x: 0, y: slot * 0.5, w: 1, h: 0.5 };
  if (players >= 3 && players <= 4 && slot < players) return { x: (slot % 2) * 0.5, y: Math.floor(slot / 2) * 0.5, w: 0.5, h: 0.5 };
  return { x: 0, y: 0, w: 1, h: 1 };
}

/** A player name as the game takes it : printable ASCII, at most 9 (web/ui settings.js cleanName). */
export const NAME_LEN = 9;
export function cleanName(name) {
  return String(name ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, NAME_LEN);
}

/** A player's name for display : their own, else « P<slot + 1> ». */
export const nameOf = (slot, name) => cleanName(name).trim() || `P${slot + 1}`;

/** Why a guest on the relay is refused (ROLLOUT : Share is P2P only, no TURN). */
export const ONLINE_MODE = 'No direct connection to the host : Share streams video peer to peer only. Use Online mode (each player with their own disc) to play together over the relay.';

// ---- the guest's pad, from the Gamepad API or the keyboard ----

const AXIS_DEADZONE = 500 / 32767; // native_input.c NATIVE_INPUT_AXIS_DEADZONE

/** A Gamepad API axis (-1..1) as a PSX analog byte, like native_input.c's AxisToByte. */
export function axisByte(v) {
  const scaled = Math.trunc((Math.max(-1, Math.min(1, v)) * 32767) / 256) + 128;
  return Math.max(0, Math.min(0xff, scaled));
}

// W3C standard mapping → PSX, the same pairs as native_input.c's SDL gamepad mapping
// (south = Cross, east = Circle, west = Square, north = Triangle, back = Select).
export const STANDARD = [
  [0, BTN.cross], [1, BTN.circle], [2, BTN.square], [3, BTN.triangle],
  [4, BTN.l1], [5, BTN.r1], [6, BTN.l2], [7, BTN.r2],
  [8, BTN.select], [9, BTN.start], [10, BTN.l3], [11, BTN.r3],
  [12, BTN.up], [13, BTN.down], [14, BTN.left], [15, BTN.right],
];

/**
 * A standard-mapping Gamepad (or its shape) → {id: analog, buttons, analog}. `map` : [[standard
 * button index, PSX bits]] — the player's own (web/ui guest-input.js), else the native defaults.
 */
export function padFromGamepad(gp, map = STANDARD) {
  let buttons = 0xffff;
  for (const [index, bit] of map) {
    const b = gp.buttons[index];
    if (b && (b.pressed || b.value > 0.5)) buttons &= ~bit;
  }
  const axis = (i) => {
    const v = gp.axes[i] ?? 0;
    return Math.abs(v) > AXIS_DEADZONE ? v : 0;
  };
  return { id: PAD_ID.analog, buttons, analog: [axisByte(axis(2)), axisByte(axis(3)), axisByte(axis(0)), axisByte(axis(1))] };
}

/** KeyboardEvent.code → PSX button : native_input.c's keyboard mapping. */
export const KEYS = {
  ArrowUp: BTN.up, ArrowDown: BTN.down, ArrowLeft: BTN.left, ArrowRight: BTN.right,
  KeyC: BTN.cross, KeyV: BTN.circle, KeyX: BTN.square, KeyZ: BTN.triangle,
  ShiftLeft: BTN.l1, ControlLeft: BTN.l2, BracketLeft: BTN.l3,
  ShiftRight: BTN.r1, ControlRight: BTN.r2, BracketRight: BTN.r3,
  Space: BTN.select, Enter: BTN.start,
};

/** The held key codes → a digital pad. `keys` : code → PSX bits, the player's own or KEYS. */
export function padFromKeys(held, keys = KEYS) {
  let buttons = 0xffff;
  for (const code in held) if (held[code] && keys[code]) buttons &= ~keys[code];
  return { id: PAD_ID.digital, buttons, analog: [0x80, 0x80, 0x80, 0x80] };
}

/** Both sources at once : buttons held on either, the gamepad's sticks. */
export function mergePads(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { id: a.id === PAD_ID.analog || b.id === PAD_ID.analog ? PAD_ID.analog : PAD_ID.digital, buttons: a.buttons & b.buttons, analog: a.id === PAD_ID.analog ? a.analog : b.analog };
}

/**
 * The gamepad this page plays with, from navigator.getGamepads() : the chosen one ({id, nth} : the
 * nth connected pad with that id), else the first with the standard mapping, else the first.
 */
export function choosePad(gamepads, chosen = null) {
  const list = [];
  for (const gp of gamepads ?? []) if (gp?.connected) list.push(gp);
  if (chosen) {
    let n = 0;
    for (const gp of list) if (gp.id === chosen.id && n++ === chosen.nth) return gp;
  }
  return list.find((gp) => gp.mapping === 'standard') ?? list[0] ?? null;
}

/**
 * The guest's pad under its « Who plays » choice (web/ui settings.js `device`) : 'auto' = the
 * keyboard and the gamepad merged, 'keyboard' = the keys only, 'gamepad' = the chosen pad only.
 * One machine opening the host and the guest page splits its devices this way : a controller seen
 * by both windows no longer drives two players. `maps` : {keys, buttons} (web/ui guest-input.js).
 */
export function pickPad(device, held, gamepads, maps = {}) {
  const mode = device?.mode ?? 'auto';
  const keys = mode === 'gamepad' ? null : padFromKeys(held, maps.keys);
  const gp = mode === 'keyboard' ? null : choosePad(gamepads, mode === 'gamepad' ? device.pad : null);
  return mergePads(keys, gp ? padFromGamepad(gp, maps.buttons) : null) ?? NEUTRAL;
}
