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
 * @returns {Emitter & {slots, guests: object, maxBitrate: number, hostName: string, setBitrate(bps: number): Promise<void>,
 *   setScale(scale: number): Promise<void>, setHostName(name: string): void, players(): {slot, name}[], frame(): void, close(): void}}
 *   `guests` : peerId → {slot, name (null until its HELLO), path, backend, state ('joining' |
 *   'streaming' | 'failed'), error?, senders?, bot?, link} ; `refusals` : the last 8 {peerId, code, path} ;
 *   events 'change', 'join' (guest : streaming), 'leave' (guest).
 */
export function createShareHost({ room, stream, maxBitrate = BITRATE.default, scale = 1, slots = createSlots(), hostName = '', game = () => null }) {
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
    if (link.backend !== 'webrtc' || !link.pc) return refuse(link, 'online-mode', ONLINE_MODE);
    const slot = slots.take(link.peerId);
    if (!slot) return whenListening(link, () => refuse(link, 'full', 'Three guests are already playing : Share drives P2 to P4.'));
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
    });
    whenListening(link, () => {
      guest.listening = true;
      link.send(encodeControl(TAG.welcome, { slot, host: nameOf(0, host.hostName) }), { reliable: true });
      link.send(encodeControl(TAG.players, playersBody()), { reliable: true });
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
    change();
  });

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
  host.close = () => {
    offLink();
    offClose();
    for (const id in host.guests) {
      slots.release(id);
      host.guests[id].link.close();
    }
    room.close();
  };
  return host;
}
