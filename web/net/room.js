// A room : one host, guests around it (star). Each guest gets one link to the host —
// WebRTC when a direct path exists, else (or when forced) WebSocket through the relay.
//
// Signaling backends come from the room link (`sig=`, see link.js), in order. The host
// opens all of them at once, so a guest reaches it through whichever works for that guest.
// A guest tries them in order : the first it can join and find the host on carries its
// WebRTC offer. Only `relay` also carries game data ; on `mqtt` and `paste`, a guest without
// a direct WebRTC path has nowhere to go and connect() rejects with code 'no-direct-path'.
import { parseRoomLink } from './link.js';
import { roomKeys } from './crypto.js';
import { Emitter } from './events.js';
import { relaySignaling } from './signaling.js';
import { mqttSignaling } from './signaling-mqtt.js';
import { pasteSignaling } from './signaling-paste.js';
import { TAG, fail, rtcGuest, rtcHost, wsLink } from './transport.js';
import { STUN } from './webrtc.js';

function waitForPeer(sig, match, ms) {
  return new Promise((resolve, reject) => {
    const find = () => sig.peers.find(match);
    const found = find();
    if (found) return resolve(found);
    const timer = setTimeout(() => { off(); reject(fail('absent', 'no host in the room')); }, ms);
    const off = sig.on('peers', () => {
      const peer = find();
      if (!peer) return;
      clearTimeout(timer);
      off();
      resolve(peer);
    });
  });
}

/**
 * Joins a room.
 * @param {object} options
 * @param {string | {room: string, key: string, relay?: string, rk?: string, signaling?: string[], mqtt?: string[]}} options.link -
 *   a room link (or its hash), or its parsed form
 * @param {'host'|'guest'} options.role
 * @param {'auto'|'ws'} [options.mode='auto'] - guest : 'auto' tries WebRTC then falls back to
 *   the WebSocket path ; 'ws' forces it (relay backend only). The host accepts both.
 * @param {string} [options.name]
 * @param {RTCIceServer[]} [options.iceServers=STUN]
 * @param {number} [options.rtcTimeoutMs=10000] - deadline for an authenticated WebRTC link, and
 *   for a guest to find the host on a backend
 * @param {number} [options.pasteTimeoutMs=300000] - the same over `paste` : a person carries the blobs
 * @param {typeof WebSocket} [options.WebSocketImpl] - for `relay` and `mqtt`
 * @returns {Promise<Emitter & {selfId: string, role: string, links: object, backend: string,
 *   backends: {name: string, state: string, error?: string}[], signaling: object,
 *   connect(): Promise<object>, paste(text: string): Promise<void>, close(): void}>}
 *   events : 'link' (a new link ; `link.signaling` names its backend), 'linkclose',
 *   'warning' ({code, message, backend} — a backend that failed, a WebRTC attempt that fell back),
 *   'backend' (a guest moved to the next backend : its name), 'blob' ({to, blob} — paste : show
 *   it to the player), 'close'. Guests call `connect()` for their link to the host.
 */
export async function openRoom({ link, role, mode = 'auto', name = '', iceServers = STUN, rtcTimeoutMs = 10_000, pasteTimeoutMs = 300_000, WebSocketImpl }) {
  const parsed = typeof link === 'string' ? parseRoomLink(link) : link;
  const { room, key, relay, rk = '', mqtt = [] } = parsed;
  const order = parsed.signaling ?? (relay ? ['relay'] : ['paste']);
  if (order.includes('relay') && !relay) throw fail('link', 'the room link lists relay but names no relay');
  const keys = await roomKeys(key, room);
  const make = (backend) => {
    if (backend === 'relay') return relaySignaling({ url: relay, rk, room, aead: keys.aead, name, kind: role, WebSocketImpl });
    if (backend === 'mqtt') return mqttSignaling({ brokers: mqtt.length ? mqtt : undefined, room, aead: keys.aead, auth: keys.auth, name, kind: role, WebSocketImpl });
    if (backend === 'paste') return pasteSignaling({ room, aead: keys.aead, kind: role, name });
    throw fail('link', `unknown signaling backend ${backend}`);
  };

  const r = new Emitter();
  r.role = role;
  r.links = Object.create(null);
  r.backends = order.map((backend) => ({ name: backend, state: 'idle' }));
  const sigs = Object.create(null); // backend name → signaling, while joined
  const pending = Object.create(null); // guest id → AbortController of a WebRTC attempt
  let closed = false;

  const warn = (error, backend) => r.emit('warning', { code: error.code ?? 'error', message: error.message, backend });
  const add = (l, backend) => {
    l.signaling = backend;
    r.links[l.peerId] = l;
    l.on('close', () => {
      if (r.links[l.peerId] === l) delete r.links[l.peerId];
      r.emit('linkclose', l);
    });
    r.emit('link', l);
    return l;
  };
  const closeLinksOf = (backend, keep) => {
    for (const id in r.links) if (r.links[id].signaling === backend && !keep?.(id)) r.links[id].close();
  };

  /** Joins one backend and wires it into the room ; rejects with the backend's error code. */
  async function join(backend, entry) {
    const sig = make(backend);
    entry.state = 'joining';
    try {
      await sig.join();
    } catch (e) {
      entry.state = 'failed';
      entry.error = e.code ?? 'error';
      throw e;
    }
    entry.state = 'joined';
    sigs[backend] = sig;
    sig.on('data', ({ from, bytes }) => {
      let l = r.links[from];
      // A guest coming through the relay : its first frame, or its `join` after giving up on
      // WebRTC. Anything else from a guest with a live WebRTC link is ignored, not a reason
      // to drop that link.
      const fallback = !l ? bytes[0] !== TAG.bye : l.backend !== 'ws' && bytes[0] === TAG.join;
      if (role === 'host' && fallback) {
        pending[from]?.abort();
        l?.close();
        l = add(wsLink(sig, from), backend);
      }
      if (l?.backend === 'ws' && l.signaling === backend) l.receive(bytes);
    });
    sig.on('peers', (list) => closeLinksOf(backend, (id) => list.some((p) => p.id === id)));
    sig.on('close', (info) => {
      if (sigs[backend] !== sig) return;
      delete sigs[backend];
      entry.state = 'closed';
      closeLinksOf(backend);
      let any = false;
      for (const _ in sigs) { any = true; break; }
      if (!any) r.emit('close', { ...info, backend });
    });
    sig.on('blob', (blob) => r.emit('blob', { ...blob, backend }));
    if (role === 'host') {
      const timeoutMs = backend === 'paste' ? pasteTimeoutMs : rtcTimeoutMs;
      sig.on('signal', ({ from, payload }) => {
        if (payload?.t !== 'offer' || typeof RTCPeerConnection === 'undefined') return;
        pending[from]?.abort();
        const ac = new AbortController();
        pending[from] = ac;
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        rtcHost({ sig, guestId: from, offer: payload, room, auth: keys.auth, iceServers, signal: ac.signal })
          .then((l) => {
            r.links[from]?.close();
            add(l, backend);
          }, (e) => warn(e, backend))
          .finally(() => {
            clearTimeout(timer);
            if (pending[from] === ac) delete pending[from];
          });
      });
    }
    return sig;
  }

  /** Leaves a backend without closing the room (a guest moving on). */
  const drop = (backend) => {
    const sig = sigs[backend];
    if (!sig) return;
    delete sigs[backend];
    r.backends[order.indexOf(backend)].state = 'left';
    sig.leave();
  };

  let current = -1; // guest : index in `order` of the backend in use
  const use = (i) => {
    current = i;
    r.backend = order[i];
    r.signaling = sigs[order[i]];
    r.selfId = r.signaling.selfId;
  };

  if (role === 'host') {
    const results = await Promise.allSettled(order.map((backend, i) => join(backend, r.backends[i])));
    results.forEach((res, i) => { if (res.status === 'rejected') warn(res.reason, order[i]); });
    const first = results.findIndex((res) => res.status === 'fulfilled');
    if (first < 0) throw results[0].reason;
    use(first);
  } else {
    // The first backend that joins ; connect() moves on when the host is not found there.
    let lastError = null;
    for (let i = 0; i < order.length && current < 0; i++) {
      try {
        await join(order[i], r.backends[i]);
        use(i);
      } catch (e) {
        warn(e, order[i]);
        lastError = e;
      }
    }
    if (current < 0) throw lastError;
  }

  r.connect = async () => {
    if (role !== 'guest') throw new Error('connect() is for guests');
    let lastError = null;
    let direct = true; // false once a WebRTC attempt failed : a backend without data cannot help
    for (let i = current; i < order.length; i++) {
      const backend = order[i];
      if (mode === 'ws' && backend !== 'relay') {
        lastError ??= fail('no-relay', 'forced WebSocket needs the relay backend in the room link');
        continue;
      }
      if (!direct && backend !== 'relay') continue; // the same direct path would fail again
      if (i !== current) {
        try {
          drop(order[current]);
          await join(backend, r.backends[i]);
          use(i);
          r.emit('backend', backend);
        } catch (e) {
          warn(e, backend);
          lastError = e;
          continue;
        }
      }
      const sig = sigs[backend];
      const timeoutMs = backend === 'paste' ? pasteTimeoutMs : rtcTimeoutMs;
      let host;
      try {
        host = await waitForPeer(sig, (p) => p.kind === 'host', timeoutMs);
      } catch (e) {
        warn(e, backend);
        lastError = e;
        continue;
      }
      // After a failed attempt, the next backend is the relay : straight to its WebSocket path.
      if (mode === 'auto' && direct && typeof RTCPeerConnection === 'undefined') {
        warn(fail('no-webrtc', 'WebRTC unavailable here'), backend);
        direct = false;
      } else if (mode === 'auto' && direct) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
          return add(await rtcGuest({ sig, hostId: host.id, room, auth: keys.auth, iceServers, signal: ac.signal }), backend);
        } catch (e) {
          warn(e, backend);
          if (e.code === 'impostor') throw e;
          direct = false;
        } finally {
          clearTimeout(timer);
        }
      }
      if (sig.data) {
        const l = add(wsLink(sig, host.id), backend);
        l.announce();
        return l;
      }
      lastError = fail('no-direct-path', `no direct WebRTC path to the host, and ${backend} carries no game data : add a relay to the room link`);
    }
    throw lastError ?? fail('no-direct-path', 'no backend left to try');
  };

  r.paste = async (text) => {
    const sig = sigs.paste;
    if (!sig) throw fail('paste', 'this room has no paste backend');
    await sig.paste(text);
  };

  r.close = () => {
    if (closed) return;
    closed = true;
    for (const id in pending) pending[id].abort();
    for (const id in r.links) r.links[id].close();
    for (const backend in sigs) sigs[backend].leave();
  };
  return r;
}
