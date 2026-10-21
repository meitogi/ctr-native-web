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
//   events : 'message' (Uint8Array), 'close'
//
// WebRTC is end-to-end encrypted by DTLS ; before a WebRTC link is handed out, both sides
// have proved they know the room secret over both SDPs' DTLS fingerprints, so a relay that
// swaps SDPs is caught. WebSocket frames are sealed with the room key by the signaling
// layer (crypto.js) : the relay forwards ciphertext it cannot read or forge.
import { b64u, mac, randomBytes, verifyMac } from './crypto.js';
import { Emitter } from './events.js';
import { createAnswer, createOffer, pathOf, transcript } from './webrtc.js';

/** First byte of every WebSocket-transport frame (inside the sealed envelope). */
export const TAG = { game: 0, join: 1, bye: 2 };

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

/**
 * A link through the relay. `receive(bytes)` is fed by the room with what signaling opened
 * from that peer ; `announce()` tells the host a guest is there before any game message.
 * @param {ReturnType<import('./signaling.js').relaySignaling>} sig
 */
export function wsLink(sig, peerId) {
  const link = new Emitter();
  link.peerId = peerId;
  link.backend = 'ws';
  link.path = 'relay';
  link.closed = false;
  const end = () => {
    if (link.closed) return;
    link.closed = true;
    link.emit('close');
  };
  link.send = (bytes) => { if (!link.closed) sig.data(peerId, frame(TAG.game, bytes)); };
  link.announce = () => sig.data(peerId, frame(TAG.join, new Uint8Array(0)));
  link.receive = (bytes) => {
    if (bytes[0] === TAG.game) link.emit('message', bytes.subarray(1));
    else if (bytes[0] === TAG.bye) end();
  };
  link.close = () => {
    if (!link.closed) sig.data(peerId, frame(TAG.bye, new Uint8Array(0)));
    end();
  };
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
  const end = () => {
    if (link.closed) return;
    link.closed = true;
    pc.close();
    link.emit('close');
  };
  game.addEventListener('message', ({ data }) => link.emit('message', new Uint8Array(data)));
  // On ctl, text is the handshake / control JSON ; binary is the caller's reliable messages.
  ctl.addEventListener('message', ({ data }) => { if (typeof data !== 'string') link.emit('message', new Uint8Array(data)); });
  ctl.addEventListener('close', end);
  pc.addEventListener('connectionstatechange', () => {
    const state = pc.connectionState;
    if (state === 'failed' || state === 'closed') end();
  });
  link.send = (bytes, { reliable = false } = {}) => {
    const channel = reliable ? ctl : game;
    if (channel.readyState === 'open') channel.send(bytes);
  };
  link.close = end;
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
