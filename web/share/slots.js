// The host's side of the remote pads : which guest drives which player, and the latest pad of
// each, read by the game once per input update (platform/native_input.c, NativeWeb_ReadRemotePads).
//
// Slots 1–3 are the game's P2–P4 (pad slot n = player n, with or without the multitap bus).
// Slot 0 is the host's own keyboard / gamepad and is never handed out.
//
// A seat can also be held by a player on the host's own machine (a second gamepad that pressed
// Start) : owner `local:<id>`, the id being the game's. Its pad is not here : the game reads a
// marker packet carrying the id and fills the slot itself.
import { NEUTRAL, decodePad, isNewer } from './protocol.js';

export const FIRST_SLOT = 1;
export const SLOT_COUNT = 4;
/** Bytes per slot that the game reads : the PSX pad packet (native_input.c WritePadPacket). */
export const PACKET_BYTES = 8;
/** The owner of a seat held on the host's machine : `local:<id>`. */
export const LOCAL = 'local:';
export const isLocal = (peerId) => typeof peerId === 'string' && peerId.startsWith(LOCAL);

/**
 * @param {object} [o]
 * @param {() => number} [o.now] - milliseconds
 * @param {number} [o.staleMs=500] - a guest silent this long reads as nothing held (its slot
 *   stays connected) : the pad channel drops packets, a lost release must not hold a button
 */
export function createSlots({ now = () => performance.now(), staleMs = 500 } = {}) {
  const owner = [null, null, null, null]; // slot → peerId
  const pads = [null, null, null, null]; // slot → {seq, id, buttons, analog, at}

  const slotOf = (peerId) => {
    for (let s = FIRST_SLOT; s < SLOT_COUNT; s++) if (owner[s] === peerId) return s;
    return 0;
  };

  return {
    slotOf,
    /** The lowest free slot for `peerId` (its own if it has one), or 0 when all are taken. */
    take(peerId) {
      const had = slotOf(peerId);
      if (had) return had;
      for (let s = FIRST_SLOT; s < SLOT_COUNT; s++) {
        if (owner[s] === null) {
          owner[s] = peerId;
          pads[s] = null;
          return s;
        }
      }
      return 0;
    },
    /** Frees `peerId`'s slot : the game sees that pad unplugged. Returns the slot, or 0. */
    release(peerId) {
      const s = slotOf(peerId);
      if (s) {
        owner[s] = null;
        pads[s] = null;
      }
      return s;
    },
    /**
     * Moves the guests above a free slot down, so P2..Pn stay a run with no gap (a Netplay room's
     * character select counts its humans that way, session 32e). Returns [{peerId, from, to}].
     */
    compact() {
      const moves = [];
      let to = FIRST_SLOT;
      for (let s = FIRST_SLOT; s < SLOT_COUNT; s++) {
        if (owner[s] === null) continue;
        if (s !== to) {
          owner[to] = owner[s];
          pads[to] = pads[s];
          owner[s] = null;
          pads[s] = null;
          moves.push({ peerId: owner[to], from: s, to });
        }
        to++;
      }
      return moves;
    },
    /** A PAD message from `peerId` ; older or foreign messages are dropped. True when applied. */
    receive(peerId, bytes) {
      const s = slotOf(peerId);
      const pad = s && decodePad(bytes);
      if (!pad || !isNewer(pad.seq, pads[s]?.seq ?? null)) return false;
      pads[s] = { ...pad, at: now() };
      return true;
    },
    /** What slot `s` holds : {peerId, pad} or null. */
    get(s) {
      return owner[s] === null ? null : { peerId: owner[s], pad: pads[s] };
    },
    /**
     * Writes slots 1–3 as PSX pad packets at `heap[dst + (slot - 1) * 8]` (status, id, buttons
     * lo / hi, analog ×4) and returns the mask of slots held (bit n = slot n). A local owner's
     * slot is the marker 0xFF, 0, 0xFF, 0xFF and its id, little endian.
     */
    read(heap, dst) {
      let mask = 0;
      const t = now();
      for (let s = FIRST_SLOT; s < SLOT_COUNT; s++) {
        if (owner[s] === null) continue;
        mask |= 1 << s;
        const o = dst + (s - FIRST_SLOT) * PACKET_BYTES;
        if (isLocal(owner[s])) {
          const id = Number(owner[s].slice(LOCAL.length));
          heap[o] = 0xff;
          heap[o + 1] = 0;
          heap[o + 2] = 0xff;
          heap[o + 3] = 0xff;
          heap[o + 4] = id & 0xff;
          heap[o + 5] = (id >> 8) & 0xff;
          heap[o + 6] = (id >> 16) & 0xff;
          heap[o + 7] = (id >>> 24) & 0xff;
          continue;
        }
        const p = pads[s] && t - pads[s].at <= staleMs ? pads[s] : NEUTRAL;
        heap[o] = 0;
        heap[o + 1] = p.id;
        heap[o + 2] = p.buttons & 0xff;
        heap[o + 3] = p.buttons >> 8;
        heap.set(p.analog, o + 4);
      }
      return mask;
    },
  };
}
