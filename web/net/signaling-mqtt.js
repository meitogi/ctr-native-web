// Signaling backend 2 : public MQTT brokers, no server of ours. Trystero's discovery idea
// (meet on a topic of a public broker), with our own minimal client and our own envelope :
// Trystero creates its own RTCPeerConnection with one reliable channel, and the identity
// proof and the unreliable `game` channel live in webrtc.js / transport.js.
//
// Every peer of a room subscribes to one topic derived from the room secret (the brokers
// never see the room id nor the secret) and publishes everything there :
//   wire    {"f": from, "o": to | "*", "d": base64url(sealed)}    (JSON text)
//   sealed  crypto.js envelope ; '*' = to everyone, bound into the additional data like an id
//   inside  {t:'hello', name, kind, reply?} | {t:'bye'} | {t:'signal', payload}
// A peer says hello on joining ; whoever hears a new peer answers with its own hello, to it.
// One topic, one publisher order : MQTT keeps a client's messages to a topic in order, which
// the envelope's counter needs. The same message goes out through every broker joined ; the
// copies are dropped as replays. Across brokers the first copy of message n always arrives
// before the first copy of n+1 (each broker delivers n before n+1), so nothing is lost —
// unless one broker drops n (QoS 0) and delivers n+1 before another delivers n : then n is
// refused as a replay. Brokers that connect after join() are not used, so every broker in
// use carries every message from the first hello on.
// No game data path (no `data()`) : a pair without a direct WebRTC path cannot play.
//
// MQTT 3.1.1 over WebSocket (subprotocol `mqtt`), QoS 0 only : CONNECT, SUBSCRIBE, PUBLISH,
// PINGREQ, DISCONNECT — what signaling needs, nothing else.
import { b64u, createSealer, mac, randomBytes } from './crypto.js';
import { Emitter } from './events.js';

/** Public brokers with WebSocket TLS listeners (the list Trystero 0.26 uses, minus the one needing a login). */
export const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const KEEPALIVE_S = 30;
const SETTLE_MS = 2000; // once one broker is up, how long the others get to join in
const utf8 = new TextEncoder();
const text = new TextDecoder();

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const concat = (...parts) => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  n = 0;
  for (const p of parts) { out.set(p, n); n += p.length; }
  return out;
};
const u16 = (n) => new Uint8Array([n >> 8, n & 0xff]);
const str = (s) => { const b = utf8.encode(s); return concat(u16(b.length), b); };
function packet(head, body) {
  const len = [];
  let n = body.length;
  do { let byte = n & 0x7f; n >>= 7; if (n) byte |= 0x80; len.push(byte); } while (n);
  return concat(new Uint8Array([head, ...len]), body);
}

/**
 * One broker connection.
 * @returns {{ready: Promise<void>, publish(topic: string, payload: Uint8Array): void, close(): void}}
 */
export function mqttConnect(url, topic, { onMessage, onClose, WebSocketImpl = globalThis.WebSocket }) {
  const ws = new WebSocketImpl(url, 'mqtt');
  ws.binaryType = 'arraybuffer';
  let buffer = new Uint8Array(0);
  let ping = null;
  let settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const send = (bytes) => { if (ws.readyState === 1) ws.send(bytes); };

  const onPacket = (type, flags, body) => {
    if (type === 2) { // CONNACK
      if (body[1] !== 0) return settle.reject(fail('mqtt', `${url} refused the connection (${body[1]})`));
      send(packet(0x82, concat(u16(1), str(topic), new Uint8Array([0]))));
    } else if (type === 9) { // SUBACK
      if (body[2] === 0x80) return settle.reject(fail('mqtt', `${url} refused the subscription`));
      ping = setInterval(() => send(new Uint8Array([0xc0, 0])), (KEEPALIVE_S * 1000) / 2);
      settle.resolve();
    } else if (type === 3) { // PUBLISH
      const topicLength = (body[0] << 8) | body[1];
      const skip = 2 + topicLength + ((flags >> 1) & 3 ? 2 : 0);
      onMessage(body.subarray(skip));
    }
  };

  ws.addEventListener('open', () => {
    const clientId = `ctr${b64u.encode(randomBytes(9))}`; // 15 characters, under 3.1.1's 23
    send(packet(0x10, concat(str('MQTT'), new Uint8Array([4, 0x02]), u16(KEEPALIVE_S), str(clientId))));
  });
  ws.addEventListener('message', ({ data }) => {
    buffer = concat(buffer, new Uint8Array(data));
    for (;;) {
      let length = 0;
      let i = 1;
      for (let shift = 0; ; shift += 7, i++) {
        if (i > 4) return ws.close(); // MQTT's remaining length is 4 bytes at most
        if (i >= buffer.length) return; // header not complete yet
        length |= (buffer[i] & 0x7f) << shift;
        if (!(buffer[i] & 0x80)) break;
      }
      const end = i + 1 + length;
      if (buffer.length < end) return;
      onPacket(buffer[0] >> 4, buffer[0] & 0x0f, buffer.subarray(i + 1, end));
      buffer = buffer.subarray(end);
    }
  });
  ws.addEventListener('close', () => {
    clearInterval(ping);
    settle.reject(fail('mqtt', `${url} closed`));
    onClose();
  });
  ws.addEventListener('error', () => {}); // 'close' follows

  return {
    ready,
    publish: (t, payload) => send(packet(0x30, concat(str(t), payload))),
    close() {
      send(new Uint8Array([0xe0, 0]));
      ws.close();
    },
  };
}

/** The room's topic : from the secret's MAC key, so it says nothing of the room id. */
export async function mqttTopic(auth) {
  return `ctr-net/v1/${(await mac(auth, 'ctr-net mqtt topic v1')).slice(0, 22)}`;
}

/**
 * Backend 2 : public MQTT brokers.
 * @param {object} options
 * @param {string[]} [options.brokers=MQTT_BROKERS]
 * @param {string} options.room
 * @param {CryptoKey} options.aead - from roomKeys()
 * @param {CryptoKey} options.auth - from roomKeys(), for the topic
 * @param {string} [options.name]
 * @param {string} [options.kind='guest']
 * @param {number} [options.joinTimeoutMs=8000]
 * @param {typeof WebSocket} [options.WebSocketImpl]
 */
export function mqttSignaling({ brokers = MQTT_BROKERS, room, aead, auth, name = '', kind = 'guest', joinTimeoutMs = 8000, WebSocketImpl }) {
  const sig = new Emitter();
  const id = b64u.encode(randomBytes(8));
  const sealer = createSealer(aead, room, id);
  let topic = '';
  let live = []; // broker connections in use
  let outbox = Promise.resolve();
  let inbox = Promise.resolve();
  let left = false;

  sig.selfId = id;
  sig.peers = [{ id, name, kind }];

  const setPeers = (list) => {
    sig.peers = list;
    sig.emit('peers', list);
  };
  const send = (to, inner) => {
    outbox = outbox.then(async () => {
      const sealed = await sealer.seal(to, utf8.encode(JSON.stringify(inner)));
      const wire = utf8.encode(JSON.stringify({ f: id, o: to, d: b64u.encode(sealed) }));
      for (const c of live) c.publish(topic, wire);
    }).catch(() => {});
    return outbox;
  };
  const hello = (to, reply) => send(to, { t: 'hello', name, kind, reply });

  async function onWire(bytes) {
    let wire;
    try { wire = JSON.parse(text.decode(bytes)); } catch { return; }
    const { f: from, o: to } = wire ?? {};
    if (typeof from !== 'string' || from === id || (to !== id && to !== '*') || typeof wire.d !== 'string') return;
    let plain;
    try { plain = await sealer.open(from, b64u.decode(wire.d), to); } catch { return; }
    if (!plain) return; // another room's key, a copy from a second broker, or a replay
    let inner;
    try { inner = JSON.parse(text.decode(plain)); } catch { return; }
    const known = sig.peers.some((p) => p.id === from);
    if (inner.t === 'hello' && !known) {
      setPeers([...sig.peers, { id: from, name: String(inner.name ?? ''), kind: inner.kind === 'host' ? 'host' : 'guest' }]);
      if (!inner.reply) hello(from, true);
    } else if (inner.t === 'bye' && known) {
      setPeers(sig.peers.filter((p) => p.id !== from));
    } else if (inner.t === 'signal') {
      sig.emit('signal', { from, payload: inner.payload });
    }
  }

  sig.join = async () => {
    topic = await mqttTopic(auth);
    const conns = [];
    const onClose = (c) => () => {
      if (!live.includes(c)) return;
      live = live.filter((x) => x !== c);
      if (!live.length && !left) sig.emit('close', { code: 'mqtt', reason: 'every MQTT broker closed' });
    };
    for (const url of brokers) {
      let c;
      try {
        c = mqttConnect(url, topic, {
          onMessage: (bytes) => { inbox = inbox.then(() => onWire(bytes)).catch(() => {}); },
          onClose: () => onClose(c)(),
          WebSocketImpl,
        });
      } catch { continue; } // a malformed URL
      c.ready.catch(() => {});
      conns.push(c);
    }
    // The first broker up starts a short window for the others ; then the set is fixed.
    const up = [];
    await new Promise((resolve) => {
      let pending = conns.length;
      let window = null;
      const deadline = setTimeout(resolve, joinTimeoutMs);
      const done = () => { clearTimeout(deadline); clearTimeout(window); resolve(); };
      if (!pending) return done();
      for (const c of conns) {
        c.ready.then(() => {
          up.push(c);
          window ??= setTimeout(done, SETTLE_MS);
        }, () => {}).finally(() => { if (--pending === 0) done(); });
      }
    });
    for (const c of conns) if (!up.includes(c)) c.close();
    if (!up.length) throw fail('mqtt', `no MQTT broker reachable (${brokers.join(', ')})`);
    live = up.slice(); // a broker that comes up later is not used
    await hello('*', false);
  };

  sig.signal = (to, payload) => send(to, { t: 'signal', payload });

  sig.leave = () => {
    if (left) return;
    send('*', { t: 'bye' }).then(() => {
      left = true;
      for (const c of live) c.close();
      live = [];
      sig.emit('close', { code: 'left', reason: 'left the room' });
    });
  };

  return sig;
}
