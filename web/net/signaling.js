// Signaling : how peers of a room find each other and exchange their WebRTC offer / answer.
//
// Backend contract — every backend (this ctr-relay one, signaling-mqtt.js, signaling-paste.js)
// returns an Emitter with :
//   selfId                 this peer's id in the room
//   peers                  [{id, name, kind}] currently in the room, self included
//   join()                 → Promise, resolves once in the room ; rejects with `code`
//   signal(to, payload)    sends a JSON value to one peer, sealed with the room key
//   leave()
//   events : 'peers' (list), 'signal' ({from, payload}), 'close' ({code, reason})
// Only ctr-relay also carries game traffic, for the WebSocket transport :
//   data(to, bytes, {lossy}?)  sealed, through the relay ; `lossy` : the relay may drop it
//                          under load (unreliable payloads only — never a reliable one)
//   events : 'data' ({from, bytes})
// `transport.js` uses `data` when the backend has it ; a backend without it is signaling only.
import { b64u, createSealer } from './crypto.js';
import { Emitter } from './events.js';

const PING_MS = 20_000; // under every proxy's idle timeout
const CONNECT_TIMEOUT_MS = 8_000; // the hello's welcome ; the relay itself waits 5 s for a hello
const utf8 = new TextEncoder();
const text = new TextDecoder();

/**
 * Why join() failed or the backend closed :
 * - `relay` : unreachable, or closed by the network
 * - `relay-silent` : no welcome within `connectTimeoutMs` (a port that accepts and never answers) ;
 *   the error carries the relay's `url`
 * - `relay-key` : the relay refused its access key (rk), or no hello in time (close 4401)
 * - `room-full` / `id-taken` : the relay refused the hello (4403 / 4409)
 * - `relay-full` / `relay-address` : an open relay at its limit — sockets or rooms (4503), sockets
 *   from this address (4430) ; `room-alone` / `room-life` / `relay-idle` : it closed the room —
 *   nobody joined (4410), its longest life (4411), a silent socket (4408)
 * @typedef {Error & {code: string}} SignalingError
 */
const CLOSE_CODES = {
  4401: 'relay-key', 4403: 'room-full', 4409: 'id-taken', 4429: 'rate', 4400: 'bad-hello',
  // an open relay's limits (relay/README.md) : refused at the door, or a room it closed
  4503: 'relay-full', 4430: 'relay-address', 4410: 'room-alone', 4411: 'room-life', 4408: 'relay-idle',
};

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
 * @param {number} [options.connectTimeoutMs]
 * @param {typeof WebSocket} [options.WebSocketImpl]
 */
export function relaySignaling({ url, rk = '', room, aead, id = crypto.randomUUID(), name = '', kind = 'guest', connectTimeoutMs = CONNECT_TIMEOUT_MS, WebSocketImpl = globalThis.WebSocket }) {
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
    let silent = false;
    try {
      ws = new WebSocketImpl(url);
    } catch (e) {
      return reject(fail('relay', `invalid relay URL : ${e.message}`));
    }
    // a port that takes the connection and never answers fires no close for minutes
    const timer = setTimeout(() => {
      silent = true;
      const error = fail('relay-silent', `no answer from the relay in ${connectTimeoutMs / 1000} s`);
      error.url = url;
      reject(error);
      ws.close();
    }, connectTimeoutMs);
    ws.addEventListener('open', () => {
      sendRaw({ type: 'hello', id, name, kind, room, key: rk || undefined });
      ping = setInterval(() => sendRaw({ type: 'ping', ts: Date.now() }), PING_MS);
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'welcome' && !joined) {
        joined = true;
        clearTimeout(timer);
        resolve();
      }
      inbox = inbox.then(() => onMessage(msg)).catch(() => {});
    });
    ws.addEventListener('close', (event) => {
      clearInterval(ping);
      clearTimeout(timer);
      if (silent) return;
      const code = CLOSE_CODES[event.code] ?? 'relay';
      const error = fail(code, `relay closed (${event.code}${event.reason ? ` ${event.reason}` : ''})`);
      if (!joined) reject(error);
      sig.emit('close', { code, reason: error.message });
    });
  });

  sig.signal = (to, payload) => sendSealed(to, utf8.encode(JSON.stringify(payload)), { type: 'signal', kind: 'sealed' });
  sig.data = (to, bytes, { lossy = false } = {}) => sendSealed(to, bytes, lossy ? { type: 'data', lossy: true } : { type: 'data' });

  sig.leave = () => {
    clearInterval(ping);
    if (ws && ws.readyState <= 1) ws.close();
  };

  return sig;
}

/**
 * Tries a relay and its key without opening a room : a hello for a throwaway room, then closes.
 * @param {string} url - ws:// or wss://
 * @param {string} rk - the relay access key
 * @returns {Promise<'ok'|'key'|'full'|'address'|'unreachable'>} welcomed, the key refused (4401), the
 *   relay at its limit (4503) or at this address's (4430), or no relay there
 */
const PROBE_SAYS = { 'relay-key': 'key', 'relay-full': 'full', 'relay-address': 'address' };

export function probeRelay(url, rk, { timeoutMs = CONNECT_TIMEOUT_MS, WebSocketImpl = globalThis.WebSocket } = {}) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocketImpl(url); } catch { return resolve('unreachable'); }
    const done = (result) => { clearTimeout(timer); resolve(result); if (ws.readyState <= 1) ws.close(); };
    const timer = setTimeout(() => done('unreachable'), timeoutMs);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', id: crypto.randomUUID(), name: '', kind: 'guest', room: `probe-${crypto.randomUUID()}`, key: rk || undefined })));
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'welcome') done('ok');
    });
    ws.addEventListener('close', (event) => done(PROBE_SAYS[CLOSE_CODES[event.code]] ?? 'unreachable'));
  });
}

/**
 * Who is in a room, without staying in it (session 28b : the home page, before any disc) : a
 * hello as a guest, the relay's answer, then closes. A full room refuses the hello itself.
 * @param {string} url - ws:// or wss://
 * @param {string} rk - the relay access key
 * @param {string} room - the room id
 * @returns {Promise<{id: string, name: string, kind: string}[]>} the peers there, this look aside ;
 *   rejects with `code` : 'relay' (nothing there), 'relay-silent', 'relay-key', 'room-full',
 *   'relay-full', 'relay-address'
 */
export function lookRoom(url, rk, room, { timeoutMs = CONNECT_TIMEOUT_MS, WebSocketImpl = globalThis.WebSocket } = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    let ws;
    let settled = false;
    try { ws = new WebSocketImpl(url); } catch (e) { return reject(fail('relay', `invalid relay URL : ${e.message}`)); }
    const done = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
      if (ws.readyState <= 1) ws.close();
    };
    const timer = setTimeout(() => done(reject, Object.assign(fail('relay-silent', `no answer from the relay in ${timeoutMs / 1000} s`), { url })), timeoutMs);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', id, name: '', kind: 'guest', room, key: rk || undefined })));
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'welcome') done(resolve, (msg.peers ?? []).filter((p) => p.id !== id));
    });
    ws.addEventListener('close', (event) => done(reject, fail(CLOSE_CODES[event.code] ?? 'relay', `relay closed (${event.code})`)));
  });
}
