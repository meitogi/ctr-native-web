// The room link : everything a player needs, after `#` so no web server ever receives it.
//   https://game.example/#room=<id>&key=<secret>&sig=relay,mqtt,paste&relay=wss://relay.example&rk=<relay key>
// room  — the room id (the relay sees it ; the MQTT topic is derived from the secret instead)
// key   — the room secret, 32 bytes base64url (no server ever sees it)
// sig   — the signaling backends, in the order a guest tries them : `relay` (ctr-relay),
//         `mqtt` (public MQTT brokers), `paste` (copy-paste, no server). Absent : `relay`
//         when `relay=` is set (links made before the list existed), else `paste`.
// relay — ctr-relay URL (ws:// or wss://), required when `relay` is in the list
// rk    — the relay's access key, when it is private
// mqtt  — MQTT-over-WebSocket broker URLs, comma-separated ; absent = the public defaults
import { b64u, randomBytes } from './crypto.js';

export const BACKENDS = ['relay', 'mqtt', 'paste'];

const wsUrl = (url) => /^wss?:\/\/[^\s,]+$/.test(url);

/**
 * A fresh room : random id and secret.
 * @param {{relay?: string, rk?: string, signaling?: string[], mqtt?: string[]}} [where]
 */
export function newRoom({ relay = '', rk = '', signaling, mqtt = [] } = {}) {
  return {
    room: b64u.encode(randomBytes(8)),
    key: b64u.encode(randomBytes(32)),
    relay,
    rk,
    signaling: signaling ?? (relay ? ['relay'] : ['paste']),
    mqtt,
  };
}

/**
 * @param {string} base - page URL ; its query is kept, its hash replaced
 * @param {{room: string, key: string, relay?: string, rk?: string, signaling?: string[], mqtt?: string[]}} link
 *   `sig` is written unless it is what a link without it means (old links stay byte-identical).
 */
export function formatRoomLink(base, { room, key, relay, rk, signaling, mqtt }) {
  const params = new URLSearchParams({ room, key });
  const implied = relay ? 'relay' : 'paste';
  if (signaling?.length && signaling.join(',') !== implied) params.set('sig', signaling.join(','));
  if (relay) params.set('relay', relay);
  if (rk) params.set('rk', rk);
  if (mqtt?.length) params.set('mqtt', mqtt.join(','));
  return `${base.split('#')[0]}#${params}`;
}

/**
 * Reads a room link, or just its hash. Throws an Error with `code: 'link'` when the room or
 * the secret is missing or malformed, or the backend list cannot work.
 * @returns {{room: string, key: string, relay: string, rk: string, signaling: string[], mqtt: string[]}}
 */
export function parseRoomLink(linkOrHash) {
  const hash = linkOrHash.includes('#') ? linkOrHash.slice(linkOrHash.indexOf('#') + 1) : linkOrHash;
  const params = new URLSearchParams(hash);
  const room = params.get('room') ?? '';
  const key = params.get('key') ?? '';
  const relay = params.get('relay') ?? '';
  const rk = params.get('rk') ?? '';
  const sig = params.get('sig');
  const signaling = sig ? sig.split(',') : [relay ? 'relay' : 'paste'];
  const mqttParam = params.get('mqtt');
  const mqtt = mqttParam ? mqttParam.split(',') : [];
  let keyLength = 0;
  try { keyLength = b64u.decode(key).length; } catch { /* reported below */ }
  const problem = !/^[A-Za-z0-9_-]{1,64}$/.test(room) ? 'room id missing or invalid'
    : keyLength !== 32 ? 'room secret missing or not 32 bytes'
      : relay && !wsUrl(relay) ? 'relay must be a ws:// or wss:// URL'
        : signaling.some((b) => !BACKENDS.includes(b)) ? `sig lists an unknown backend (known : ${BACKENDS.join(', ')})`
          : signaling.some((b, i) => signaling.indexOf(b) !== i) ? 'sig lists a backend twice'
            : signaling.includes('relay') && !relay ? 'sig lists relay but the link names no relay'
              : !mqtt.every(wsUrl) ? 'mqtt must list ws:// or wss:// URLs'
                : null;
  if (problem) {
    const error = new Error(`invalid room link : ${problem}`);
    error.code = 'link';
    throw error;
  }
  return { room, key, relay, rk, signaling, mqtt };
}
