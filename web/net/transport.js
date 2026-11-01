// Links : one per guest ↔ host pair, the same interface over both transports.
//
// Link contract :
//   peerId     the other side's id in the room
//   backend    'webrtc' | 'ws'
//   path       'direct-ipv6' | 'direct-lan' | 'direct-nat' (WebRTC) | 'relay' (WebSocket)
//   send(bytes, {reliable}?)   a Uint8Array ; WebRTC : unordered and unreliable by default,
//              `reliable: true` = ordered and reliable (the `ctl` channel) ; WebSocket : always
//              both, through the relay. OnlineCTR needs both kinds (kart state vs control).
//   close()
//   lastSeen   performance.now() of the last frame received from the other side (any frame,
//              keepalives included) ; a link sends a keepalive every KEEPALIVE_MS it has
//              sent nothing else, so a silent link is a dead one (web/online/net.js times it out)
//   events : 'message' (Uint8Array), 'close'
//
// The WebSocket link coalesces : what it is given within one JS task (the host's game fans
// every kart state out to every guest in one frame) leaves as one sealed relay message, split
// again on the other side before any 'message' event — the receiving game sees each payload
// on its own, as sent. Only to a peer that announced it reads batches (its `join` frame) ; a
// relay message holding only unreliable payloads is flagged `lossy`, the relay may drop it
// under load, never a reliable one (relay/relay.js).
//
// WebRTC is end-to-end encrypted by DTLS ; before a WebRTC link is handed out, both sides
// have proved they know the room secret over both SDPs' DTLS fingerprints, so a relay that
// swaps SDPs is caught. WebSocket frames are sealed with the room key by the signaling
// layer (crypto.js) : the relay forwards ciphertext it cannot read or forge.
import { b64u, mac, randomBytes, verifyMac } from './crypto.js';
import { Emitter } from './events.js';
import { createAnswer, createOffer, pathOf, transcript } from './webrtc.js';

/** First byte of every WebSocket-transport frame (inside the sealed envelope). */
export const TAG = { game: 0, join: 1, bye: 2, batch: 3, alive: 4 };

/** `join` payload bits : what the announcing side can read. */
const CAN_BATCH = 1;

/** A link that sent nothing for this long sends a keepalive (WebSocket frame / ctl text). */
export const KEEPALIVE_MS = 500;

export function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function frame(tag, bytes) {
  const out = new Uint8Array(1 + bytes.length);
  out[0] = tag;
  out.set(bytes, 1);
  return out;
}

/** Payloads of one task as one batch frame : [TAG.batch, (u16 length, bytes)…]. */
function batchFrame(items) {
  let size = 1;
  for (const b of items) size += 2 + b.length;
  const out = new Uint8Array(size);
  out[0] = TAG.batch;
  let at = 1;
  for (const b of items) {
    out[at] = b.length >> 8;
    out[at + 1] = b.length & 0xff;
    out.set(b, at + 2);
    at += 2 + b.length;
  }
  return out;
}

/** Sends a keepalive on `link` every KEEPALIVE_MS it has sent nothing else ; stops at close. */
function keepAlive(link, ping) {
  link.lastSent = performance.now();
  const timer = setInterval(() => {
    if (link.closed) return clearInterval(timer);
    if (performance.now() - link.lastSent >= KEEPALIVE_MS) {
      link.lastSent = performance.now();
      ping();
    }
  }, KEEPALIVE_MS / 2);
  timer.unref?.();
  link.on('close', () => clearInterval(timer));
}

/**
 * A link through the relay. `receive(bytes)` is fed by the room with what signaling opened
 * from that peer ; `announce()` tells the host a guest is there before any game message, and
 * that it reads batches.
 * @param {ReturnType<import('./signaling.js').relaySignaling>} sig
 */
export function wsLink(sig, peerId) {
  const link = new Emitter();
  link.peerId = peerId;
  link.backend = 'ws';
  link.path = 'relay';
  link.closed = false;
  link.batching = false; // the other side announced it reads batches
  link.lastSeen = performance.now();
  const end = () => {
    if (link.closed) return;
    link.closed = true;
    link.emit('close');
  };
  let pending = [];
  let pendingLossy = true;
  const flush = () => {
    const items = pending;
    const lossy = pendingLossy;
    pending = [];
    pendingLossy = true;
    if (link.closed || !items.length) return;
    sig.data(peerId, items.length === 1 ? frame(TAG.game, items[0]) : batchFrame(items), { lossy });
  };
  link.send = (bytes, { reliable = false } = {}) => {
    if (link.closed) return;
    link.lastSent = performance.now();
    if (!link.batching) return sig.data(peerId, frame(TAG.game, bytes), { lossy: !reliable });
    if (!pending.length) queueMicrotask(flush);
    pending.push(bytes.slice());
    pendingLossy &&= !reliable;
  };
  link.announce = () => sig.data(peerId, frame(TAG.join, Uint8Array.of(CAN_BATCH)));
  link.receive = (bytes) => {
    link.lastSeen = performance.now();
    const tag = bytes[0];
    if (tag === TAG.game) link.emit('message', bytes.subarray(1));
    else if (tag === TAG.batch) {
      for (let at = 1; at + 2 <= bytes.length;) {
        const len = (bytes[at] << 8) | bytes[at + 1];
        link.emit('message', bytes.subarray(at + 2, at + 2 + len));
        at += 2 + len;
      }
    } else if (tag === TAG.join) link.batching = bytes.length > 1 && (bytes[1] & CAN_BATCH) !== 0;
    else if (tag === TAG.bye) end();
  };
  link.close = () => {
    if (!link.closed) {
      flush();
      sig.data(peerId, frame(TAG.bye, new Uint8Array(0)));
    }
    end();
  };
  keepAlive(link, () => sig.data(peerId, frame(TAG.alive, new Uint8Array(0)), { lossy: true }));
  return link;
}

const opened = (channel) => new Promise((resolve, reject) => {
  if (channel.readyState === 'open') return resolve();
  channel.addEventListener('open', () => resolve(), { once: true });
  channel.addEventListener('close', () => reject(fail('ice', `channel ${channel.label} closed before opening`)), { once: true });
});

const nextText = (channel) => new Promise((resolve, reject) => {
  channel.addEventListener('message', ({ data }) => {
    try { resolve(JSON.parse(data)); } catch { resolve(null); }
  }, { once: true });
  channel.addEventListener('close', () => reject(fail('ice', 'control channel closed')), { once: true });
});

/** Runs `work`, rejecting (and closing `pc`) when `signal` aborts or ICE fails first. */
function guard(pc, signal, work) {
  return new Promise((resolve, reject) => {
    const stop = (error) => { pc?.close(); reject(error); };
    signal?.addEventListener('abort', () => stop(fail('timeout', 'no authenticated WebRTC channel in time')), { once: true });
    pc?.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') stop(fail('ice', 'ICE failed : no direct path'));
    });
    work().then(resolve, stop);
  });
}

async function rtcLink(pc, ctl, game, peerId) {
  await opened(game);
  const link = new Emitter();
  link.peerId = peerId;
  link.backend = 'webrtc';
  link.path = (await pathOf(pc)) ?? 'direct-nat';
  link.pc = pc;
  link.closed = false;
  link.lastSeen = performance.now();
  const end = () => {
    if (link.closed) return;
    link.closed = true;
    pc.close();
    link.emit('close');
  };
  game.addEventListener('message', ({ data }) => {
    link.lastSeen = performance.now();
    link.emit('message', new Uint8Array(data));
  });
  // On ctl, text is the handshake / control JSON (and the keepalive) ; binary is the caller's
  // reliable messages.
  ctl.addEventListener('message', ({ data }) => {
    link.lastSeen = performance.now();
    if (typeof data !== 'string') link.emit('message', new Uint8Array(data));
  });
  ctl.addEventListener('close', end);
  pc.addEventListener('connectionstatechange', () => {
    const state = pc.connectionState;
    if (state === 'failed' || state === 'closed') end();
  });
  link.send = (bytes, { reliable = false } = {}) => {
    const channel = reliable ? ctl : game;
    link.lastSent = performance.now();
    if (channel.readyState === 'open') channel.send(bytes);
  };
  link.close = end;
  keepAlive(link, () => { if (ctl.readyState === 'open') ctl.send('{"t":"alive"}'); });
  return link;
}

/**
 * Guest side of a WebRTC link : offer, check the host's proof, prove itself on `ctl`.
 * @param {object} o
 * @param {AbortSignal} [o.signal] - abort = give up (closes the connection)
 * @throws {Error} code 'impostor' (host proof wrong : SDPs swapped, or not this room),
 *   'ice', 'timeout'
 */
export async function rtcGuest({ sig, hostId, room, auth, iceServers, signal }) {
  const o = await createOffer({ iceServers });
  return guard(o.pc, signal, async () => {
    const guestNonce = b64u.encode(randomBytes(16));
    const answer = await new Promise((resolve) => {
      const off = sig.on('signal', ({ from, payload }) => {
        if (from !== hostId || payload?.t !== 'answer') return;
        off();
        resolve(payload);
      });
      signal?.addEventListener('abort', off, { once: true });
      sig.signal(hostId, { t: 'offer', sdp: o.sdp, nonce: guestNonce });
    });
    const t = { offerSdp: o.sdp, answerSdp: String(answer.sdp), room, guestNonce, hostNonce: String(answer.nonce) };
    if (!(await verifyMac(auth, transcript('host', t), answer.proof))) {
      throw fail('impostor', 'the host did not prove the room secret over these DTLS fingerprints');
    }
    await o.accept(t.answerSdp);
    await opened(o.ctl);
    const reply = nextText(o.ctl);
    o.ctl.send(JSON.stringify({ t: 'auth', proof: await mac(auth, transcript('guest', t)) }));
    if ((await reply)?.t !== 'ok') throw fail('impostor', 'the host refused our proof');
    return rtcLink(o.pc, o.ctl, o.game, hostId);
  });
}

/**
 * Host side : answer a guest's offer with our proof, then require the guest's on `ctl`.
 * @throws {Error} code 'impostor' (guest proof wrong), 'ice', 'timeout'
 */
export async function rtcHost({ sig, guestId, offer, room, auth, iceServers, signal }) {
  const a = await createAnswer(String(offer.sdp), { iceServers });
  return guard(a.pc, signal, async () => {
    const t = { offerSdp: String(offer.sdp), answerSdp: a.sdp, room, guestNonce: String(offer.nonce), hostNonce: b64u.encode(randomBytes(16)) };
    const first = nextText(a.ctl);
    await sig.signal(guestId, { t: 'answer', sdp: a.sdp, nonce: t.hostNonce, proof: await mac(auth, transcript('host', t)) });
    const msg = await first;
    if (msg?.t !== 'auth' || !(await verifyMac(auth, transcript('guest', t), msg.proof))) {
      throw fail('impostor', 'the guest did not prove the room secret over these DTLS fingerprints');
    }
    a.ctl.send(JSON.stringify({ t: 'ok' }));
    return rtcLink(a.pc, a.ctl, a.game, guestId);
  });
}
