// The room code : a few of the game's characters, said aloud (« Crash, Coco, Tiny ») and picked
// on dials in the game (NETPLAY > JOIN). The code is the room's password : the room id and the
// room secret are both derived from it here, so the relay keeps no table and never sees it.
//
// What that gives up : with so few codes (15^3 = 3 375, 15^4 = 50 625, 15^5 = 759 375) whoever
// may use the relay can try them all. The host therefore lets a guest who only had the code in
// by hand (web/online/admit.js) ; the room link carries a random pass and goes straight in.
import { b64u, randomBytes } from './crypto.js';

/** The characters, by the game's character id (game/zGlobal_DATA.c MetaDataCharacters). */
export const CODE_NAMES = ['Crash', 'Cortex', 'Tiny', 'Coco', 'N. Gin', 'Dingodile', 'Polar', 'Pura', 'Pinstripe', 'Papu Papu', 'Ripper Roo', 'Komodo Joe', 'N. Tropy', 'Penta', 'Fake Crash'];
export const CODE_MIN = 3;
export const CODE_MAX = 5;

const SALT = new TextEncoder().encode('ctr-native-web room code v1');
// ~0.1 s in a browser : nothing for a player, a cost for whoever tries every code
const ROUNDS = 200_000;

/** @param {unknown} ids - true for 3 to 5 character ids */
export function validCode(ids) {
  if (!Array.isArray(ids) || ids.length < CODE_MIN || ids.length > CODE_MAX) return false;
  const count = CODE_NAMES.length;
  for (const id of ids) if (!Number.isInteger(id) || id < 0 || id >= count) return false;
  return true;
}

/** The code in a link and between the game and the page : one hex digit per character. */
export const codeText = (ids) => ids.map((id) => id.toString(16)).join('');

/** @returns {number[] | null} the ids of a `codeText`, null when it is not one */
export function parseCode(text) {
  if (typeof text !== 'string' || !/^[0-9a-e]+$/.test(text)) return null;
  const ids = [...text].map((digit) => Number.parseInt(digit, 16));
  return validCode(ids) ? ids : null;
}

/** « Crash · Coco · Tiny » */
export const codeNames = (ids) => ids.map((id) => CODE_NAMES[id]).join(' · ');

/**
 * `length` random characters, each equally likely.
 * @param {number} length
 * @param {(n: number) => Uint8Array} [bytes]
 */
export function randomCode(length, bytes = randomBytes) {
  const count = CODE_NAMES.length;
  const fair = 256 - (256 % count); // bytes from here up would favour the first characters
  const ids = [];
  while (ids.length < length) {
    for (const byte of bytes(length * 2)) {
      if (byte < fair && ids.length < length) ids.push(byte % count);
    }
  }
  return ids;
}

/**
 * The room a code names : its id on the relay and its secret, as a room link carries them.
 * Codes of different lengths never meet (the length is part of what is hashed).
 * @param {number[]} ids
 * @returns {Promise<{room: string, key: string}>}
 */
export async function roomFromCode(ids) {
  if (!validCode(ids)) throw Object.assign(new Error('invalid room code'), { code: 'link' });
  const subtle = globalThis.crypto.subtle;
  const material = await subtle.importKey('raw', new TextEncoder().encode(`${ids.length}:${codeText(ids)}`), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: ROUNDS }, material, 320));
  return { room: b64u.encode(bits.subarray(0, 8)), key: b64u.encode(bits.subarray(8, 40)) };
}

/**
 * A room under a code, shaped as web/net/link.js newRoom's : met on the relay, its pass fresh.
 * @param {number[]} ids
 * @param {{relay: string, rk?: string}} where
 */
export async function codeRoom(ids, { relay, rk = '' }) {
  return { ...(await roomFromCode(ids)), relay, rk, signaling: ['relay'], mqtt: [], code: codeText(ids), pass: b64u.encode(randomBytes(16)) };
}

/**
 * What a host says of its room on the relay, as its signaling name (session 28b) : the home page
 * reads it before asking for a disc — a Netplay room needs one, a Share room does not. The relay
 * hands the name back in its peer list and is not changed. Longer than a player's name can be
 * (9 characters), so no player's name reads as one.
 */
export const ROOM_KIND = { netplay: 'ctr-room:netplay', share: 'ctr-room:share' };

/**
 * The kind of the room a relay's peer list shows : 'share', 'netplay' — also what a host from
 * before the kinds is, its name being its player's —, or null with nobody hosting.
 * @param {{name?: string, kind?: string}[]} peers
 * @returns {'share' | 'netplay' | null}
 */
export function roomKind(peers) {
  const host = peers.find((p) => p.kind === 'host');
  if (!host) return null;
  return host.name === ROOM_KIND.share ? 'share' : 'netplay';
}

/** A host's code grows by one character after this many codes drawn in a row were already taken. */
export const CODE_TAKEN_BEFORE_LONGER = 3;

/**
 * A room under a code no other host holds (session 28). The relay keeps no table : a host joins
 * the room its code names and reads who is there ; someone hosting already, it leaves and draws
 * again. `CODE_TAKEN_BEFORE_LONGER` taken in a row : the relay is crowded at that length, the
 * code gets one more character (3, then 4, then 5).
 * @param {object} o
 * @param {number} o.length - characters of the first code drawn
 * @param {number} [o.max=5]
 * @param {(length: number) => Promise<{room: {close(): void}, taken: boolean}>} o.open - a room
 *   opened under a fresh code of that length, and whether another host was in it
 * @returns {Promise<object>} the room kept
 */
export async function openFreeRoom({ length, max = 5, open }) {
  for (let taken = 0; ; ) {
    const { room, taken: held } = await open(length);
    if (!held) return room;
    room.close();
    if (++taken >= CODE_TAKEN_BEFORE_LONGER && length < max) {
      length++;
      taken = 0;
    }
  }
}
