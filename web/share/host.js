// Share mode, host side : one room, the game's stream to every guest with a direct WebRTC
// link, each guest's pad into the next free player slot (P2–P4).
//
// Share is P2P only (ROLLOUT : no TURN, the relay never carries media) : a guest whose link
// came through the relay's WebSocket path is told to use Online mode and dropped.
import { Emitter } from '../net/events.js';
import { offerMedia, tuneVideo } from './media.js';
import { ONLINE_MODE, TAG, cleanName, decodeControl, encodeControl, nameOf } from './protocol.js';
import { createSlots } from './slots.js';

export const BITRATE = { min: 500_000, max: 6_000_000, default: 2_500_000 };

/**
 * @param {object} o
 * @param {object} o.room - an open host room (web/net/room.js openRoom, role 'host')
 * @param {MediaStream} o.stream - what every guest receives : one video track, one audio track
 * @param {number} [o.maxBitrate] - video, bits per second, per guest
 * @param {number} [o.scale=1] - video scale-down from the canvas (≥ 1)
 * @param {ReturnType<typeof createSlots>} [o.slots]
 * @param {string} [o.hostName] - the host's player name (WELCOME, PLAYERS)
 * @param {() => object|null} [o.game] - the game's debug state (window.__ctr, debug builds) : what
 *   a bot guest (BOT) is sent of its own kart ; null = nothing to send (release build)
 * @param {boolean} [o.compact] - a guest leaving moves the ones above it down a slot (a Netplay
 *   room, session 32e : P3 becomes P2 and is told so) ; plain Share keeps every slot
 * @param {() => boolean} [o.compactNow] - with `compact` : false while a leaver's slot must stay a
 *   hole (a Netplay room's race, session 32f : nobody moves, the leaver coming back takes it again) ;
 *   `compactHoles()` fills them later
 * @param {boolean} [o.relayGuests] - keep a guest whose link is not WebRTC : its pad plays, it
 *   gets no stream (state 'nomedia') — an Online room's lobby (session 14), never plain Share
 * @returns {Emitter & {slots, guests: object, maxBitrate: number, hostName: string, setBitrate(bps: number): Promise<void>,
 *   setScale(scale: number): Promise<void>, setHostName(name: string): void, players(): {slot, name}[], frame(): void,
 *   compactHoles(): number[], watched(): boolean, close(): void}}
 *   `guests` : peerId → {slot, name (null until its HELLO), path, backend, state ('joining' |
 *   'streaming' | 'failed'), error?, senders?, bot?, watching?, link} ; `watching` : the guest's
 *   page shows the host's picture while its game is out of the room's race (its LOBBY, 32f) ; `refusals` : the last 8 {peerId, code, path} ;
 *   events 'change', 'listen' (guest : its first pad, WELCOME sent), 'join' (guest : streaming), 'leave' (guest).
 */
export function createShareHost({ room, stream, maxBitrate = BITRATE.default, scale = 1, slots = createSlots(), hostName = '', game = () => null, relayGuests = false, compact = false, compactNow = () => true }) {
  const host = new Emitter();
  host.slots = slots;
  host.guests = Object.create(null);
  host.refusals = [];
  host.maxBitrate = maxBitrate;
  host.hostName = cleanName(hostName);
  let currentScale = scale;
  let sent = ''; // the PLAYERS body the guests have
  /** Who is who : the host in slot 0, then each guest by slot. */
  host.players = () => {
    const list = [{ slot: 0, name: nameOf(0, host.hostName) }];
    for (const id in host.guests) list.push({ slot: host.guests[id].slot, name: nameOf(host.guests[id].slot, host.guests[id].name) });
    return list.sort((a, b) => a.slot - b.slot);
  };
  const playersBody = () => {
    const list = host.players();
    return { players: list.length, list };
  };
  const change = () => {
    const body = playersBody();
    const json = JSON.stringify(body);
    if (json !== sent) {
      sent = json;
      for (const id in host.guests) if (host.guests[id].listening) host.guests[id].link.send(encodeControl(TAG.players, body), { reliable: true });
    }
    host.emit('change', host.guests);
  };

  const refuse = (link, code, message) => {
    host.refusals = [...host.refusals.slice(-7), { peerId: link.peerId, code, path: link.path }];
    link.send(encodeControl(TAG.refuse, { code, message }), { reliable: true });
    link.close();
    change();
  };

  // The guest's first pad says it listens : a link's handlers are attached only once its
  // `connect()` resolved, and a message on `ctl` before that would be lost.
  const whenListening = (link, fn) => {
    const off = link.on('message', (bytes) => {
      if (bytes[0] !== TAG.pad) return;
      off();
      fn();
    });
  };

  const offLink = room.on('link', (link) => {
    // A guest on the relay sees its own backend and stops : this is a courtesy.
    const media = link.backend === 'webrtc' && !!link.pc;
    if (!media && !relayGuests) return refuse(link, 'online-mode', ONLINE_MODE);
    const slot = slots.take(link.peerId);
    if (!slot) return whenListening(link, () => refuse(link, 'full', 'Three guests are already playing : Couch drives P2 to P4.'));
    const guest = { slot, name: null, path: link.path, backend: link.backend, state: 'joining', link };
    host.guests[link.peerId] = guest;
    link.on('message', (bytes) => {
      if (bytes[0] === TAG.pad) slots.receive(link.peerId, bytes);
      else if (bytes[0] === TAG.hello) {
        const name = cleanName(decodeControl(bytes)?.body?.name).trim();
        if (host.guests[link.peerId] !== guest || !name || name === guest.name) return;
        guest.name = name;
        change();
      }
      else if (bytes[0] === TAG.bot && host.guests[link.peerId] === guest) {
        guest.bot = { levelID: null };
        change();
      }
      else if (bytes[0] === TAG.lobby && host.guests[link.peerId] === guest) {
        guest.watching = !!decodeControl(bytes)?.body?.watching;
        change();
      }
    });
    whenListening(link, () => {
      guest.listening = true;
      host.emit('listen', guest);
      link.send(encodeControl(TAG.welcome, { slot, host: nameOf(0, host.hostName) }), { reliable: true });
      link.send(encodeControl(TAG.players, playersBody()), { reliable: true });
      if (!media) {
        guest.state = 'nomedia';
        host.emit('join', guest);
        change();
        return;
      }
      offerMedia(link, stream, { maxBitrate: host.maxBitrate, scale: currentScale }).then((senders) => {
        if (host.guests[link.peerId] !== guest) return;
        guest.senders = senders;
        guest.state = 'streaming';
        host.emit('join', guest);
        change();
      }, (e) => {
        if (host.guests[link.peerId] !== guest) return;
        guest.state = 'failed';
        guest.error = e.message;
        change();
      });
    });
    change();
  });

  const offClose = room.on('linkclose', (link) => {
    const guest = host.guests[link.peerId];
    if (!guest || guest.link !== link) return;
    slots.release(link.peerId);
    delete host.guests[link.peerId];
    host.emit('leave', guest);
    if (compact && compactNow()) moveDown();
    change();
  });

  // the guests above a free slot one slot down, each told its new one
  const moveDown = () => {
    for (const { peerId, to } of slots.compact()) {
      const moved = host.guests[peerId];
      if (!moved) continue;
      moved.slot = to;
      if (moved.listening) moved.link.send(encodeControl(TAG.welcome, { slot: to, host: nameOf(0, host.hostName) }), { reliable: true });
    }
  };
  /** The holes a race left (`compactNow` false), filled now : the freed slots, highest first. */
  host.compactHoles = () => {
    const holes = [];
    let top = 0;
    for (let s = 1; s < 4; s++) if (slots.get(s)) top = s;
    for (let s = top - 1; s >= 1; s--) if (!slots.get(s)) holes.push(s);
    if (!holes.length) return holes;
    moveDown();
    change();
    return holes;
  };
  /** A guest's page shows the host's picture outside the room's race (32f) : keep it coming. */
  host.watched = () => {
    for (const id in host.guests) if (host.guests[id].watching && host.guests[id].state === 'streaming') return true;
    return false;
  };

  const retune = async () => {
    const jobs = [];
    for (const id in host.guests) {
      const video = host.guests[id].senders?.video;
      if (video) jobs.push(tuneVideo(video, { maxBitrate: host.maxBitrate, scale: currentScale }));
    }
    await Promise.all(jobs);
  };
  host.setBitrate = (bps) => {
    host.maxBitrate = Math.round(Math.min(BITRATE.max, Math.max(BITRATE.min, bps)));
    return retune();
  };
  host.setScale = (s) => {
    if (s === currentScale) return Promise.resolve();
    currentScale = s;
    return retune();
  };
  host.setHostName = (name) => {
    host.hostName = cleanName(name);
    change();
  };
  /** Once per present : each bot guest gets its own kart (KART), and the racing line (TRACK) on a new level. */
  host.frame = () => {
    let s = null;
    for (const id in host.guests) {
      const g = host.guests[id];
      if (!g.bot || !g.listening) continue;
      s ??= game();
      if (!s) return;
      const track = s.track;
      if (track && track.levelID !== g.bot.levelID) {
        g.bot.levelID = track.levelID;
        g.link.send(encodeControl(TAG.track, { levelID: track.levelID, path: track.path }), { reliable: true });
      }
      g.link.send(encodeControl(TAG.kart, { screen: s.screen, levelID: s.levelID, players: s.players, charSelect: s.charSelect ?? null,
        kart: s.karts?.[g.slot] ?? null }));
    }
  };
  /** Stops sharing. `keepRoom` : the room (and its links) stay open — an Online room owns them. */
  host.close = ({ keepRoom = false } = {}) => {
    offLink();
    offClose();
    for (const id in host.guests) {
      slots.release(id);
      if (!keepRoom) host.guests[id].link.close();
    }
    host.guests = Object.create(null);
    if (!keepRoom) room.close();
  };
  return host;
}
