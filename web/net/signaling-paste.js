// Signaling backend 3 : copy-paste. No server at all — the players carry the guest's offer
// and the host's answer themselves (chat, mail, anything), one blob each way.
//
// Same contract as signaling.js, read through a human :
//   signal(to, payload)  does not send : it makes a blob and emits 'blob' ({to, blob}) — the
//                        page shows it, the player copies it to the other side
//   paste(text)          the other side's blob, pasted : emits 'signal' ({from, payload}) like
//                        a received message ; rejects with code 'paste' when it is not a blob
//                        of this room for this peer, or was already used
// A guest sees one peer, `host` ; the host learns each guest when its offer is pasted.
// No game data path (no `data()`) : a pair without a direct WebRTC path cannot play.
//
// Blob : base64url of `version (1) | from length (1) | from (UTF-8) | sealed`, where `sealed`
// is the crypto.js envelope (room, from and to bound in, counter against replays) around
// the payload JSON compressed with deflate-raw. Compression before sealing : ciphertext does
// not compress. A non-trickle SDP is mostly candidates and fingerprints : ~1–2 KB as a blob.
import { b64u, createSealer, randomBytes } from './crypto.js';
import { Emitter } from './events.js';

export const PASTE_HOST_ID = 'host';
const VERSION = 1;
const utf8 = new TextEncoder();
const text = new TextDecoder();

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
export const inflate = (bytes) => pipe(bytes, new DecompressionStream('deflate-raw'));

function fail(message) {
  const error = new Error(message);
  error.code = 'paste';
  return error;
}

/**
 * @param {object} options
 * @param {string} options.room
 * @param {CryptoKey} options.aead - from roomKeys()
 * @param {'host'|'guest'} options.kind
 * @param {string} [options.name]
 */
export function pasteSignaling({ room, aead, kind, name = '' }) {
  const sig = new Emitter();
  const id = kind === 'host' ? PASTE_HOST_ID : b64u.encode(randomBytes(8));
  const sealer = createSealer(aead, room, id);
  sig.selfId = id;
  sig.peers = [{ id, name, kind }];
  if (kind !== 'host') sig.peers.push({ id: PASTE_HOST_ID, name: 'host', kind: 'host' });

  sig.join = async () => {};

  sig.signal = async (to, payload) => {
    const sealed = await sealer.seal(to, await deflate(utf8.encode(JSON.stringify(payload))));
    const from = utf8.encode(id);
    const out = new Uint8Array(2 + from.length + sealed.length);
    out[0] = VERSION;
    out[1] = from.length;
    out.set(from, 2);
    out.set(sealed, 2 + from.length);
    const blob = b64u.encode(out);
    sig.emit('blob', { to, blob });
  };

  sig.paste = async (pasted) => {
    let bytes;
    try { bytes = b64u.decode(String(pasted).replace(/\s+/g, '')); } catch { throw fail('not a blob : unexpected characters'); }
    if (bytes.length < 3 || bytes[0] !== VERSION) throw fail('not a blob of this version');
    const from = text.decode(bytes.subarray(2, 2 + bytes[1]));
    if (from === id) throw fail('this is your own blob : send it to the other player');
    const plain = await sealer.open(from, bytes.subarray(2 + bytes[1]));
    if (!plain) throw fail('not for this room or this player, or already used');
    let payload;
    try { payload = JSON.parse(text.decode(await inflate(plain))); } catch { throw fail('damaged blob'); }
    if (!sig.peers.some((p) => p.id === from)) {
      sig.peers = [...sig.peers, { id: from, name: '', kind: kind === 'host' ? 'guest' : 'host' }];
      sig.emit('peers', sig.peers);
    }
    sig.emit('signal', { from, payload });
    return { from, payload };
  };

  sig.leave = () => sig.emit('close', { code: 'left', reason: 'left the room' });
  return sig;
}
