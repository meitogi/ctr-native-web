// Two room rules of the Online page (session 11b), kept free of the DOM and the game so node
// tests them (web/online/test/rules.test.mjs) ; web/online/page.js wires them.

/** A guest's rejoin attempts after its link to the host is lost : the waits before each, ms. */
export const REJOIN_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 15000];

/**
 * Tries `attempt()` after each delay until it says 'ok' (re-linked) or 'gone' (the host left the
 * meeting point) ; 'retry' goes on to the next delay. Stops early, with 'cancelled', once
 * `cancelled()` is true (the player left, or a newer loop took over).
 * @param {object} o
 * @param {() => Promise<'ok'|'gone'|'retry'>} o.attempt
 * @param {() => boolean} [o.cancelled]
 * @param {number[]} [o.delays]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {(n: number) => void} [o.onAttempt] - before attempt n (1-based)
 * @returns {Promise<'ok'|'gone'|'failed'|'cancelled'>}
 */
export async function rejoinLoop({ attempt, cancelled = () => false, delays = REJOIN_DELAYS_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onAttempt }) {
  for (let i = 0; i < delays.length; i++) {
    await sleep(delays[i]);
    if (cancelled()) return 'cancelled';
    onAttempt?.(i + 1);
    let result;
    try { result = await attempt(); } catch { result = 'retry'; }
    if (cancelled()) return 'cancelled';
    if (result === 'ok' || result === 'gone') return result;
  }
  return 'failed';
}

/** The host's choices for the end-of-race timeout, seconds after the first finisher (0 = off). */
export const END_AFTER_CHOICES = [0, 15, 30, 60, 120];
export const END_AFTER_DEFAULT = 60;

/**
 * The host's end-of-race timeout : a player who never finishes no longer holds the room. Fed
 * every lobby tick ; says when to warn everyone (`notice`, ms left) and when to end the
 * stragglers' races (`end`), once each per race.
 */
export function createEndTimer() {
  let deadline = null;
  let ended = false;
  return {
    /**
     * @param {{race: boolean, finished: number, endAfterMs: number, now: number}} s - `finished` :
     *   drivers who ended this race (the host's octr.numDriversEnded)
     * @returns {null | {notice: number} | {end: true}}
     */
    tick({ race, finished, endAfterMs, now }) {
      if (!race) {
        deadline = null;
        ended = false;
        return null;
      }
      if (ended || !(endAfterMs > 0)) return null;
      if (deadline === null) {
        if (finished < 1) return null;
        deadline = now + endAfterMs;
        return { notice: endAfterMs };
      }
      if (now < deadline) return null;
      ended = true;
      return { end: true };
    },
  };
}

/**
 * Session 32f : when a guest out of the room's race (its QUIT, a lost link) lets its game in
 * again. The host's room info (D12.3) must be known — a Cup under way keeps it out until the Cup
 * ends (the room opens between two Cup races, and a rejoin mid-Cup is not wanted) ; a host whose
 * word never came (`waitedMs` past `patienceMs`) is taken as no Cup.
 * @param {{room: object|null, linked: boolean, waitedMs: number, patienceMs?: number}} s
 */
export function letIn({ room, linked, waitedMs, patienceMs = 3000 }) {
  if (!linked) return false;
  if (!room) return waitedMs >= patienceMs;
  return !room.cup;
}

// the tag's alphabet : no 0 / O, no 1 / I (the game's font draws letters in capitals only)
const TAG_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Session 32f : the room's id as 4 characters, drawn top right on the game's menus. The id is
 * base64url, its case lost in the game's capitals : 20 bits of its FNV-1a hash instead, the same
 * on every page of the room.
 */
export function roomTag(id) {
  if (!id) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  let tag = '';
  for (let k = 0; k < 4; k++, h >>>= 5) tag += TAG_ALPHABET[h & 31];
  return tag;
}
