// An in-memory stand-in for web/net/room.js : one host room, guest rooms whose connect()
// opens a link pair to it. Links follow web/net/transport.js's contract (peerId, send(bytes,
// {reliable}), close(), events 'message' / 'close') and deliver asynchronously, as a real
// DataChannel or WebSocket does, so the wasm is always asleep when a message lands.
// Every delivery is logged with the channel it took (reliable = `ctl`, else `game`).
import { Emitter } from '../../net/events.js';

export function fakeNetwork() {
  const net = {
    /** receiver name → [{reliable, bytes}] in delivery order */
    deliveries: Object.create(null),
    /** sends that reached a link : {from, to, reliable, bytes} */
    sends: [],
    connects: 0,
    host: null,
  };

  const end = (link) => {
    if (link.closed) return;
    link.closed = true;
    link.emit('close');
  };

  function pair(guestId, guestName, hostName) {
    const toHost = new Emitter();
    const toGuest = new Emitter();
    toHost.peerId = 'host';
    toGuest.peerId = guestId;
    for (const l of [toHost, toGuest]) {
      l.backend = 'webrtc';
      l.path = 'direct-lan';
      l.closed = false;
    }
    const wire = (from, to, toName) => (bytes, { reliable = false } = {}) => {
      if (from.closed) return;
      const copy = bytes.slice();
      net.sends.push({ from: from === toHost ? guestName : hostName, to: toName, reliable, bytes: copy });
      setTimeout(() => {
        if (to.closed) return;
        (net.deliveries[toName] ??= []).push({ reliable: reliable ? 1 : 0, bytes: copy });
        to.emit('message', copy);
      }, 0);
    };
    toHost.send = wire(toHost, toGuest, hostName);
    toGuest.send = wire(toGuest, toHost, guestName);
    const close = (self, other) => () => {
      end(self);
      setTimeout(() => end(other), 0);
    };
    toHost.close = close(toHost, toGuest);
    toGuest.close = close(toGuest, toHost);
    return [toHost, toGuest];
  }

  /** The host's room ; `name` labels its deliveries. */
  net.hostRoom = (name) => {
    const room = new Emitter();
    room.role = 'host';
    room.name = name;
    net.host = room;
    return room;
  };

  /** A guest's room ; connect() rejects with code 'absent' while there is no host. */
  net.guestRoom = (name, { connectDelayMs = 0, fail = null } = {}) => {
    const room = new Emitter();
    room.role = 'guest';
    room.selfId = `guest-${name}`;
    room.connect = () => new Promise((resolve, reject) => {
      net.connects++;
      setTimeout(() => {
        if (fail) return reject(Object.assign(new Error(fail), { code: fail }));
        if (!net.host) return reject(Object.assign(new Error('no host in the room'), { code: 'absent' }));
        const [toHost, toGuest] = pair(room.selfId, name, net.host.name);
        net.host.emit('link', toGuest);
        resolve(toHost);
      }, connectDelayMs);
    });
    return room;
  };

  return net;
}
