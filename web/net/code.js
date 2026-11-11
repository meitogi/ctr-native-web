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
