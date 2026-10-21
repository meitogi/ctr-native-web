// A room : one host, guests around it (star). Each guest gets one link to the host —
// WebRTC when a direct path exists, else (or when forced) WebSocket through the relay.
import { parseRoomLink } from './link.js';
import { roomKeys } from './crypto.js';
import { Emitter } from './events.js';
import { relaySignaling } from './signaling.js';
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
 * @param {string | {room: string, key: string, relay: string, rk?: string}} options.link -
 *   a room link (or its hash), or its parsed form
 * @param {'host'|'guest'} options.role
 * @param {'auto'|'ws'} [options.mode='auto'] - guest : 'auto' tries WebRTC then falls back to
 *   the WebSocket path ; 'ws' forces it. The host accepts both.
 * @param {string} [options.name]
 * @param {RTCIceServer[]} [options.iceServers=STUN]
 * @param {number} [options.rtcTimeoutMs=10000] - deadline for an authenticated WebRTC link
 * @param {typeof WebSocket} [options.WebSocketImpl]
 * @returns {Promise<Emitter & {selfId: string, role: string, links: object,
 *   connect(): Promise<object>, close(): void}>} events : 'link' (a new link), 'linkclose',
 *   'warning' ({code, message} — e.g. a WebRTC attempt that fell back), 'close'.
 *   Guests call `connect()` for their link to the host.
 */
export async function openRoom({ link, role, mode = 'auto', name = '', iceServers = STUN, rtcTimeoutMs = 10_000, WebSocketImpl }) {
  const { room, key, relay, rk } = typeof link === 'string' ? parseRoomLink(link) : link;
  if (!relay) throw fail('link', 'the room link names no relay');
  const keys = await roomKeys(key, room);
  const sig = relaySignaling({ url: relay, rk, room, aead: keys.aead, name, kind: role, WebSocketImpl });
  await sig.join();

  const r = new Emitter();
  r.selfId = sig.selfId;
  r.role = role;
  r.links = Object.create(null);
  r.signaling = sig;
  const pending = Object.create(null); // guest id → AbortController of a WebRTC attempt

  const add = (l) => {
    r.links[l.peerId] = l;
    l.on('close', () => {
      if (r.links[l.peerId] === l) delete r.links[l.peerId];
      r.emit('linkclose', l);
    });
    r.emit('link', l);
    return l;
  };
  const warn = (error) => r.emit('warning', { code: error.code ?? 'error', message: error.message });

  sig.on('data', ({ from, bytes }) => {
    let l = r.links[from];
    // A guest coming through the relay : its first frame, or its `join` after giving up on
    // WebRTC. Anything else from a guest with a live WebRTC link is ignored, not a reason
    // to drop that link.
    const fallback = !l ? bytes[0] !== TAG.bye : l.backend !== 'ws' && bytes[0] === TAG.join;
    if (role === 'host' && fallback) {
      pending[from]?.abort();
      l?.close();
      l = add(wsLink(sig, from));
    }
    if (l?.backend === 'ws') l.receive(bytes);
  });
  sig.on('peers', (list) => {
    for (const id in r.links) if (!list.some((p) => p.id === id)) r.links[id].close();
  });
  sig.on('close', (info) => {
    for (const id in r.links) r.links[id].close();
    r.emit('close', info);
  });

  if (role === 'host') {
    sig.on('signal', ({ from, payload }) => {
      if (payload?.t !== 'offer' || typeof RTCPeerConnection === 'undefined') return;
      pending[from]?.abort();
      const ac = new AbortController();
      pending[from] = ac;
      const timer = setTimeout(() => ac.abort(), rtcTimeoutMs);
      rtcHost({ sig, guestId: from, offer: payload, room, auth: keys.auth, iceServers, signal: ac.signal })
        .then((l) => {
          r.links[from]?.close();
          add(l);
        }, warn)
        .finally(() => {
          clearTimeout(timer);
          if (pending[from] === ac) delete pending[from];
        });
    });
  }

  r.connect = async () => {
    if (role !== 'guest') throw new Error('connect() is for guests');
    const host = await waitForPeer(sig, (p) => p.kind === 'host', rtcTimeoutMs);
    if (mode === 'auto') {
      if (typeof RTCPeerConnection === 'undefined') {
        warn(fail('no-webrtc', 'WebRTC unavailable here : using the relay'));
      } else {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), rtcTimeoutMs);
        try {
          return add(await rtcGuest({ sig, hostId: host.id, room, auth: keys.auth, iceServers, signal: ac.signal }));
        } catch (e) {
          warn(e);
        } finally {
          clearTimeout(timer);
        }
      }
    }
    const l = add(wsLink(sig, host.id));
    l.announce();
    return l;
  };

  r.close = () => {
    for (const id in pending) pending[id].abort();
    for (const id in r.links) r.links[id].close();
    sig.leave();
  };
  return r;
}
