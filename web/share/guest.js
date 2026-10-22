// Share mode, guest side : a direct WebRTC link to the host, the host's stream on it, our pad
// back to the host. No disc, no game.
//
// A link through the relay (or none at all) means no direct path : Share stops there and
// points the player to Online mode (ROLLOUT : the relay never carries video).
import { Emitter } from '../net/events.js';
import { answerMedia } from './media.js';
import { NEUTRAL, ONLINE_MODE, TAG, cleanName, decodeControl, encodeControl, encodePad } from './protocol.js';

const LEAVE_MS = 1000;

/**
 * @param {object} room - an open guest room (web/net/room.js openRoom, role 'guest')
 * @param {object} [o]
 * @param {(event: RTCTrackEvent) => void} [o.onTrack]
 * @param {string} [o.name] - our player name, sent to the host (HELLO)
 * @param {boolean} [o.bot] - a scripted guest (web/share/bot.sh) : asks a debug host for its own
 *   kart (BOT), kept in `game` (the last KART) and `track` (the last TRACK)
 * @returns {Emitter & {state: string, slot: number, players: number, list: {slot, name}[], host: string|null,
 *   path: string|null, code: string|null, message: string, link: object|null, game: object|null, track: object|null, connect(): Promise<void>,
 *   sendPad(pad): void, setName(name: string): void, close(): void}}
 *   `state` : 'idle' → 'connecting' → 'connected' | 'refused' | 'closed' ; events 'change'.
 */
export function createShareGuest(room, { onTrack = () => {}, name = '', bot = false } = {}) {
  const g = new Emitter();
  g.state = 'idle';
  g.slot = 0;
  g.players = 0;
  g.list = [];
  g.host = null;
  g.name = cleanName(name);
  g.path = null;
  g.code = null;
  g.message = '';
  g.link = null;
  g.game = null;
  g.track = null;
  let seq = 0;
  let stopMedia = null;
  const set = (fields) => {
    Object.assign(g, fields);
    g.emit('change', g);
  };
  const refuse = (code, message) => {
    g.link?.close();
    room.close();
    set({ state: 'refused', code, message });
  };

  g.connect = async () => {
    set({ state: 'connecting' });
    let link;
    try {
      link = await room.connect();
    } catch (e) {
      if (e.code === 'no-direct-path' || e.code === 'no-relay') return refuse('online-mode', ONLINE_MODE);
      room.close();
      set({ state: 'closed', code: e.code ?? 'error', message: e.message });
      return;
    }
    g.link = link;
    g.path = link.path;
    if (link.backend !== 'webrtc' || !link.pc) {
      // the relay link's `join` is still being sealed and sent : leave after it, so the host
      // sees who it refused
      set({ state: 'refused', code: 'online-mode', message: ONLINE_MODE });
      setTimeout(() => refuse('online-mode', ONLINE_MODE), LEAVE_MS);
      return;
    }
    stopMedia = answerMedia(link, { onTrack, onError: (e) => set({ code: 'media', message: e.message }) });
    link.on('message', (bytes) => {
      const msg = decodeControl(bytes);
      if (msg?.tag === TAG.welcome) {
        set({ slot: Number(msg.body.slot) || 0, host: msg.body.host == null ? null : cleanName(msg.body.host) });
        // the host listens for sure by now : a HELLO sent before its link handlers existed is not lost
        sendName();
        if (bot) link.send(encodeControl(TAG.bot, {}), { reliable: true });
      }
      else if (msg?.tag === TAG.kart) g.game = msg.body; // ~30 a second : no 'change'
      else if (msg?.tag === TAG.track) g.track = msg.body;
      else if (msg?.tag === TAG.players) {
        const list = Array.isArray(msg.body.list) ? msg.body.list.map((p) => ({ slot: Number(p?.slot) || 0, name: cleanName(p?.name) })) : [];
        set({ players: Number(msg.body.players) || 0, list });
      }
      else if (msg?.tag === TAG.refuse) refuse(String(msg.body.code), String(msg.body.message));
    });
    link.on('close', () => {
      stopMedia?.();
      if (g.state === 'connected') set({ state: 'closed', code: 'closed', message: 'The host left.' });
    });
    set({ state: 'connected' });
    sendName();
    g.sendPad(NEUTRAL); // the host starts the stream on our first pad : we listen from here
  };

  const sendName = () => {
    if (g.state === 'connected' && g.name) g.link.send(encodeControl(TAG.hello, { name: g.name }), { reliable: true });
  };
  /** Our name changed : the host hears it at once while connected. */
  g.setName = (n) => {
    const clean = cleanName(n);
    if (clean === g.name) return;
    g.name = clean;
    sendName();
  };

  /** Sends the pad now (unreliable, latest wins on the host). */
  g.sendPad = (pad) => {
    if (g.state !== 'connected') return;
    seq = (seq + 1) & 0xffff;
    g.link.send(encodePad(seq, pad));
  };

  g.close = () => {
    stopMedia?.();
    g.link?.close();
    room.close();
    if (g.state !== 'refused') set({ state: 'closed' });
  };
  return g;
}
