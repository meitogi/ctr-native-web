// Who may come into a room that has a code, Netplay or Share (28b). A room's code is short
// (./code.js), so knowing it only lets a guest knock : the host says yes or no in its game
// (game/230/MM_MenuFlow.c, « BEE WANTS IN »). A guest who has the room link shows its pass and comes straight in ; one the host already
// accepted comes back (a lost link, its QUIT) without being asked again.
//
// Both sides wrap their room : the host's modules (the game's server, the lobby share) only ever
// see a link once its guest is in ; a guest's connect() only resolves once it is.
import { fail } from './transport.js';

/** First byte of the three messages, beside Share's (0x01, 0x10–0x19) and the game's (0x20). */
export const ADMIT = { ask: 0x30, yes: 0x31, no: 0x32, wait: 0x33 };
const ASK_EVERY_MS = 1000;
const NAME_MAX = 16;

const text = new TextEncoder();
const frame = (tag, body) => {
  const json = text.encode(body ? JSON.stringify(body) : '');
  const out = new Uint8Array(json.length + 1);
  out[0] = tag;
  out.set(json, 1);
  return out;
};
const bodyOf = (bytes) => {
  try { return JSON.parse(new TextDecoder().decode(bytes.subarray(1))) ?? {}; } catch { return {}; }
};

/**
 * The host's door.
 * @param {object} room - an open host room (web/net/room.js)
 * @param {object} o
 * @param {string} o.pass - the room link's pass ; a guest showing it is not asked for
 * @param {() => void} [o.onChange] - someone knocked, or stopped waiting
 * @returns {object} `room` again, but 'link' / 'linkclose' only fire for guests let in ;
 *   `asking()` : the first guest waiting ({name}) or null ; `answer(yes)` : lets it in or sends it away
 */
export function gateHost(room, { pass, onChange = () => {} }) {
  const onLink = [];
  const onClose = [];
  const inside = Object.create(null); // peer id → its link, once in
  const accepted = Object.create(null); // guest identity → true, for this room's life
  const waiting = []; // {me, name, link}, in the order they knocked
  const gated = Object.create(room);

  gated.on = (event, fn) => {
    if (event !== 'link' && event !== 'linkclose') return room.on(event, fn);
    const list = event === 'link' ? onLink : onClose;
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  };
  const letIn = (link, me) => {
    inside[link.peerId] = link;
    if (me) accepted[me] = true;
    link.send(frame(ADMIT.yes), { reliable: true });
    for (const fn of onLink.slice()) fn(link);
  };

  room.on('link', (link) => {
    let knocked = false;
    link.on('message', (bytes) => {
      if (bytes[0] !== ADMIT.ask) return;
      // a guest asks until it is answered : in already, its yes was lost on the way
      if (inside[link.peerId] === link) return link.send(frame(ADMIT.yes), { reliable: true });
      if (knocked) return;
      knocked = true;
      const body = bodyOf(bytes);
      const me = typeof body.me === 'string' ? body.me.slice(0, 64) : '';
      if ((pass && body.pass === pass) || (me && accepted[me])) return letIn(link, me);
      waiting.push({ me, name: String(body.name ?? '').slice(0, NAME_MAX), link });
      link.send(frame(ADMIT.wait), { reliable: true });
      onChange();
    });
  });
  room.on('linkclose', (link) => {
    const i = waiting.findIndex((w) => w.link === link);
    if (i >= 0) {
      waiting.splice(i, 1);
      onChange();
    }
    if (inside[link.peerId] !== link) return;
    delete inside[link.peerId];
    for (const fn of onClose.slice()) fn(link);
  });

  gated.asking = () => (waiting.length ? { name: waiting[0].name } : null);
  gated.answer = (yes) => {
    const w = waiting.shift();
    if (!w) return;
    if (yes) letIn(w.link, w.me);
    else {
      w.link.send(frame(ADMIT.no), { reliable: true });
      // the no leaves before the link closes
      setTimeout(() => w.link.close(), 300);
    }
    onChange();
  };
  return gated;
}

/**
 * A guest's side of the door.
 * @param {object} room - an open guest room
 * @param {object} o
 * @param {string} [o.pass] - the link's pass ; none when the guest typed the code
 * @param {string} o.me - this browser's identity for the host's « already accepted »
 * @param {string} [o.name]
 * @param {() => void} [o.onWait] - the host was asked and has not answered yet
 * @returns {object} `room` again ; its connect() resolves once the host let us in, and rejects
 *   with code 'refused' when it said no
 */
export function gateGuest(room, { pass = '', me, name = '', onWait = () => {} }) {
  const gated = Object.create(room);
  gated.connect = async () => {
    const link = await room.connect();
    return new Promise((resolve, reject) => {
      const ask = () => link.send(frame(ADMIT.ask, { pass, me, name }), { reliable: true });
      const timer = setInterval(ask, ASK_EVERY_MS);
      timer.unref?.(); // node : a guest left waiting does not hold a test run open
      const done = () => {
        clearInterval(timer);
        offMessage();
        offClose();
      };
      const offMessage = link.on('message', (bytes) => {
        const tag = bytes[0];
        if (tag === ADMIT.wait) onWait();
        else if (tag === ADMIT.yes) {
          done();
          resolve(link);
        } else if (tag === ADMIT.no) {
          done();
          link.close();
          reject(fail('refused', 'the host said no'));
        }
      });
      const offClose = link.on('close', () => {
        done();
        reject(fail('absent', 'the link to the host closed before it answered'));
      });
      ask();
    });
  };
  return gated;
}
