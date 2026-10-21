// The JS half of the browser's OnlineCTR transport (platform/web_online_transport.c).
//
// D6 : nothing here calls into wasm. Network callbacks only push
//   { peer, event, bytes, reliable, key }
// into `queue` ; the game drains it from wasm once per frame (poll), and its sends / kicks
// are synchronous calls from wasm into this object.
//
// Guest : one link to the room's host, `peer` -1. Host : one int peer id per guest link for
// the server core (sv_core.c), never the loopback id the host's own client uses ; the address
// key that replaces upstream's same-IP-and-port check is a hash of the guest's id in the room.

/** enum OnlineTransportEvent (platform/native_online_transport.h) */
export const EVENT = { DATA: 1, CONNECTED: 2, DISCONNECTED: 3 };

/** SV_CORE_MAX_PEERS - 1 (platform/native_online_loopback.h) : the host's own client */
export const LOOPBACK_PEER = 259;

/** enum WebOnlineRole (platform/web_online_transport.c) */
export const ROLE = { none: 0, host: 1, guest: 2 };

/** FNV-1a 64 of a room peer id, as [low, high] unsigned 32-bit halves. */
export function addressKey(id) {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(id))) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return [Number(h & 0xffffffffn), Number(h >> 32n)];
}

/**
 * @param {object} [o]
 * @param {string} [o.name] - the player name the game sends on joining a room
 */
export function createOnlineNet({ name = 'Player' } = {}) {
  const net = {
    role: 'none',
    name,
    room: null,
    /** @type {{peer: number, event: number, bytes?: Uint8Array, reliable?: number, key?: number[]}[]} */
    queue: [],
    /** host : peer id → link */
    links: Object.create(null),
    /** guest : the link to the host, its pending connect, the last connect error */
    hostLink: null,
    pending: null,
    lastError: null,
  };
  let attached = false; // guest : the game is waiting for this connect

  const push = (entry) => { net.queue.push(entry); };

  // ---- page side ----

  /** The page hosts `room` (an openRoom({role: 'host'}) result). */
  net.host = (room) => {
    net.role = 'host';
    net.room = room;
    room.on('link', (link) => {
      let peer = 0;
      while (net.links[peer]) peer++;
      net.links[peer] = link;
      link.ctrPeer = peer;
      push({ peer, event: EVENT.CONNECTED, key: addressKey(link.peerId) });
      link.on('message', (bytes) => push({ peer, event: EVENT.DATA, bytes }));
      link.on('close', () => {
        if (net.links[peer] !== link) return; // kicked : the core already forgot it
        delete net.links[peer];
        push({ peer, event: EVENT.DISCONNECTED });
      });
    });
  };

  /** The page is a guest of `room` (an openRoom({role: 'guest'}) result). */
  net.guest = (room) => {
    net.role = 'guest';
    net.room = room;
  };

  // ---- wasm side (web/online/library.js) ----

  net.poll = () => net.queue.shift();

  /** Guest : 0 = started (CONNECTED / DISCONNECTED follow in the queue), -1 = refused. */
  net.connect = () => {
    if (net.role !== 'guest') return -1;
    attached = true;
    if (net.hostLink) {
      net.queue.length = 0;
      push({ peer: -1, event: EVENT.CONNECTED });
      return 0;
    }
    // The bridge gives up an attempt after 3 s and retries : the attempt in flight is kept,
    // a retry waits for the same link.
    if (net.pending) return 0;
    net.lastError = null;
    const pending = net.room.connect().then((link) => {
      if (net.pending === pending) net.pending = null;
      net.hostLink = link;
      link.on('message', (bytes) => { if (net.hostLink === link) push({ peer: -1, event: EVENT.DATA, bytes }); });
      link.on('close', () => {
        if (net.hostLink !== link) return;
        net.hostLink = null;
        if (attached) push({ peer: -1, event: EVENT.DISCONNECTED });
      });
      if (attached) push({ peer: -1, event: EVENT.CONNECTED });
    }, (error) => {
      if (net.pending === pending) net.pending = null;
      net.lastError = error;
      if (attached) push({ peer: -1, event: EVENT.DISCONNECTED });
    });
    net.pending = pending;
    return 0;
  };

  /** Guest : leave the host (SELECT, or a failed connect attempt). */
  net.disconnect = () => {
    attached = false;
    net.queue.length = 0;
    const link = net.hostLink;
    net.hostLink = null;
    link?.close();
  };

  /** `peer` -1 : to the host (guest) ; else to that guest (host). */
  net.send = (peer, bytes, reliable) => {
    const link = peer < 0 ? net.hostLink : net.links[peer];
    link?.send(bytes, { reliable: !!reliable });
  };

  /** Host : drop a guest, as enet_peer_disconnect_now (no DISCONNECTED event follows). */
  net.kick = (peer) => {
    const link = net.links[peer];
    delete net.links[peer];
    link?.close();
  };

  return net;
}
