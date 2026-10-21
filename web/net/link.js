// The room link : everything a player needs, after `#` so no web server ever receives it.
//   https://game.example/#room=<id>&key=<secret>&relay=wss://relay.example&rk=<relay key>
// room  — the name peers meet under on the relay (the relay sees it)
// key   — the room secret, 32 bytes base64url (the relay never sees it)
// relay — signaling relay URL (ws:// or wss://), overridable per link
// rk    — the relay's access key, when it is private
import { b64u, randomBytes } from './crypto.js';

/**
 * A fresh room : random id and secret.
 * @param {{relay?: string, rk?: string}} [where]
 */
export function newRoom({ relay = '', rk = '' } = {}) {
  return { room: b64u.encode(randomBytes(8)), key: b64u.encode(randomBytes(32)), relay, rk };
}

/**
 * @param {string} base - page URL ; its query is kept, its hash replaced
 * @param {{room: string, key: string, relay?: string, rk?: string}} link
 */
export function formatRoomLink(base, { room, key, relay, rk }) {
  const params = new URLSearchParams({ room, key });
  if (relay) params.set('relay', relay);
  if (rk) params.set('rk', rk);
  return `${base.split('#')[0]}#${params}`;
}

/**
 * Reads a room link, or just its hash. Throws an Error with `code: 'link'` when the room or
 * the secret is missing or malformed.
 * @returns {{room: string, key: string, relay: string, rk: string}}
 */
export function parseRoomLink(linkOrHash) {
  const hash = linkOrHash.includes('#') ? linkOrHash.slice(linkOrHash.indexOf('#') + 1) : linkOrHash;
  const params = new URLSearchParams(hash);
  const room = params.get('room') ?? '';
  const key = params.get('key') ?? '';
  const relay = params.get('relay') ?? '';
  const rk = params.get('rk') ?? '';
  let keyLength = 0;
  try { keyLength = b64u.decode(key).length; } catch { /* reported below */ }
  const problem = !/^[A-Za-z0-9_-]{1,64}$/.test(room) ? 'room id missing or invalid'
    : keyLength !== 32 ? 'room secret missing or not 32 bytes'
      : relay && !/^wss?:\/\//.test(relay) ? 'relay must be a ws:// or wss:// URL'
        : null;
  if (problem) {
    const error = new Error(`invalid room link : ${problem}`);
    error.code = 'link';
    throw error;
  }
  return { room, key, relay, rk };
}
