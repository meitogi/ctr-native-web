// Signaling : how peers of a room find each other and exchange their WebRTC offer / answer.
//
// Backend contract — every backend (this ctr-relay one ; public signaling and copy-paste
// come next) returns an Emitter with :
//   selfId                 this peer's id in the room
//   peers                  [{id, name, kind}] currently in the room, self included
//   join()                 → Promise, resolves once in the room ; rejects with `code`
//   signal(to, payload)    sends a JSON value to one peer, sealed with the room key
//   leave()
//   events : 'peers' (list), 'signal' ({from, payload}), 'close' ({code, reason})
// Only ctr-relay also carries game traffic, for the WebSocket transport :
//   data(to, bytes)        sealed, through the relay
//   events : 'data' ({from, bytes})
// `transport.js` uses `data` when the backend has it ; a backend without it is signaling only.
import { b64u, createSealer } from './crypto.js';
import { Emitter } from './events.js';

const PING_MS = 20_000; // under every proxy's idle timeout
const utf8 = new TextEncoder();
const text = new TextDecoder();

/**
 * Why join() failed or the backend closed :
 * - `relay` : unreachable, or closed by the network
 * - `relay-key` : the relay refused its access key (rk), or no hello in time (close 4401)
 * - `room-full` / `id-taken` : the relay refused the hello (4403 / 4409)
 * @typedef {Error & {code: string}} SignalingError
 */
const CLOSE_CODES = { 4401: 'relay-key', 4403: 'room-full', 4409: 'id-taken', 4429: 'rate', 4400: 'bad-hello' };

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Backend 1 : a ctr-relay.
 * @param {object} options
 * @param {string} options.url - ws:// or wss://
 * @param {string} [options.rk] - the relay access key
 * @param {string} options.room
 * @param {CryptoKey} options.aead - from roomKeys()
 * @param {string} [options.id] - random when absent
 * @param {string} [options.name]
 * @param {string} [options.kind='guest'] - 'host' or 'guest'
 * @param {typeof WebSocket} [options.WebSocketImpl]
 */
export function relaySignaling({ url, rk = '', room, aead, id = crypto.randomUUID(), name = '', kind = 'guest', WebSocketImpl = globalThis.WebSocket }) {
  const sig = new Emitter();
  const sealer = createSealer(aead, room, id);
  let ws = null;
  let ping = null;
  // The counter check needs order both ways : seal and send one message at a time,
  // open them in arrival order.
  let outbox = Promise.resolve();
  let inbox = Promise.resolve();

  sig.selfId = id;
  sig.peers = [];

  const sendRaw = (obj) => {
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  };
  const sendSealed = (to, bytes, frame) => {
    outbox = outbox.then(async () => sendRaw({ ...frame, to, data: b64u.encode(await sealer.seal(to, bytes)) })).catch(() => {});
    return outbox;
  };
  const openFrom = async (from, data) => {
    try { return await sealer.open(from, b64u.decode(data)); } catch { return null; }
  };

  async function onMessage(msg) {
    const type = msg.type;
    if (type === 'peers' || type === 'welcome') {
      sig.peers = (type === 'welcome' ? msg.peers : msg.list) ?? [];
      sig.emit('peers', sig.peers);
    } else if (type === 'signal' && msg.kind === 'sealed') {
      const plain = await openFrom(msg.from, msg.data);
      if (!plain) return; // not sealed with this room's key : ignored
      let payload;
      try { payload = JSON.parse(text.decode(plain)); } catch { return; }
      sig.emit('signal', { from: msg.from, payload });
    } else if (type === 'data') {
      const bytes = await openFrom(msg.from, msg.data);
      if (bytes) sig.emit('data', { from: msg.from, bytes });
    }
  }

  sig.join = () => new Promise((resolve, reject) => {
    let joined = false;
    try {
      ws = new WebSocketImpl(url);
    } catch (e) {
      return reject(fail('relay', `invalid relay URL : ${e.message}`));
    }
    ws.addEventListener('open', () => {
      sendRaw({ type: 'hello', id, name, kind, room, key: rk || undefined });
      ping = setInterval(() => sendRaw({ type: 'ping', ts: Date.now() }), PING_MS);
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'welcome' && !joined) {
        joined = true;
        resolve();
      }
      inbox = inbox.then(() => onMessage(msg)).catch(() => {});
    });
    ws.addEventListener('close', (event) => {
      clearInterval(ping);
      const code = CLOSE_CODES[event.code] ?? 'relay';
      const error = fail(code, `relay closed (${event.code}${event.reason ? ` ${event.reason}` : ''})`);
      if (!joined) reject(error);
      sig.emit('close', { code, reason: error.message });
    });
  });

  sig.signal = (to, payload) => sendSealed(to, utf8.encode(JSON.stringify(payload)), { type: 'signal', kind: 'sealed' });
  sig.data = (to, bytes) => sendSealed(to, bytes, { type: 'data' });

  sig.leave = () => {
    clearInterval(ping);
    if (ws && ws.readyState <= 1) ws.close();
  };

  return sig;
}
