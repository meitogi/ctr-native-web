// ctr-relay — WebSocket meeting point for CTR Native Web rooms.
//
// Fork of the debrid-remote signal-relay : same `hello` / `peers` / `signal` /
// `ping` protocol, scoped to rooms, plus forwarding of opaque `data` messages
// for players with no direct WebRTC path. The relay never reads what it
// forwards : the browsers encrypt it with the room secret, which it never sees.
//
// Rate : a token bucket per socket. A `data` message the sender flagged `lossy`
// (kart states only, nothing the game must receive) is dropped when the bucket is
// empty ; anything else may borrow up to one more burst, then the socket is closed
// 4429 — a reliable message is never dropped silently, the client reports the close.
//
// Run : `node relay.js` — env in README.md. Import `createRelay()` to embed it.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, watchFile } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

/** Close codes sent to a client, in the 4000–4999 application range. */
export const CLOSE = {
  badHello: 4400, // malformed hello
  key: 4401, // missing / wrong RELAY_KEY, or no hello in time
  roomFull: 4403,
  idTaken: 4409,
  rate: 4429,
  // an open relay's limits (all off by default) : each refusal and each kick says which it was
  idle: 4408, // nothing but pings on this socket for idleMs
  alone: 4410, // nobody joined this room for aloneMs
  life: 4411, // the room reached roomLifeMs
  address: 4430, // ipMax sockets already open from this address
  full: 4503, // maxSockets or maxRooms reached
};

const FIELD_MAX = 64;
const HEARTBEAT_MS = 30_000;

const digest = (text) => createHash('sha256').update(text).digest();

function validField(value, required) {
  if (value === undefined && !required) return true;
  return typeof value === 'string' && value.length <= FIELD_MAX && (!required || value.length > 0);
}

/** Forwarding counters since start (`GET /stats` with `stats: true`). */
function newStats() {
  return {
    since: new Date().toISOString(), sockets: 0, rooms: 0, forwarded: 0, droppedLossy: 0, closedRate: 0, refusedOrigin: 0,
    peakSockets: 0, peakRooms: 0,
    refused: { sockets: 0, rooms: 0, address: 0 },
    kicked: { idle: 0, alone: 0, life: 0 },
  };
}

/**
 * Starts a relay and resolves once it listens.
 * @param {object} [options]
 * @param {number} [options.port=8787] - 0 picks a free port (tests)
 * @param {string} [options.host='0.0.0.0']
 * @param {string} [options.key=''] - RELAY_KEY ; empty = open relay
 * @param {{cert: string|Buffer, key: string|Buffer}} [options.tls] - serve wss:// itself
 * @param {number} [options.maxBytes=16384] - largest WebSocket message accepted
 * @param {number} [options.rate=300] - messages per second per socket, sustained (8 players
 *   on the relay : the host sends 7 × 30 coalesced messages / s, web/net/transport.js)
 * @param {number} [options.burst=600] - messages a socket may send at once
 * @param {number} [options.roomMax=8] - peers per room (OnlineCTR MAX_NUM_PLAYERS)
 * @param {number} [options.helloTimeoutMs=5000] - a socket without a valid hello by then is closed
 * @param {boolean} [options.logData=false] - log the head of each forwarded `data` (ciphertext)
 * @param {string[]} [options.origins=[]] - browser pages allowed to connect (their `Origin`
 *   header) ; empty = any. A client without the header (not a browser) is not refused : the
 *   key gates the relay, this only fences other sites' pages off it
 * @param {boolean} [options.stats=false] - answer `GET /stats` with the counters (JSON)
 * @param {boolean} [options.live=false] - answer `GET /live` to any page (CORS) with what may be shown in
 *   public : players and rooms now, their peaks, since when. Never a refusal or a kick : those stay in /stats
 * @param {number} [options.maxSockets=0] - sockets open at once ; one more is closed `full` (0 = no limit,
 *   as for every limit below : a relay started without them behaves as it always did)
 * @param {number} [options.maxRooms=0] - rooms open at once ; a hello that would open one more is closed `full`
 * @param {number} [options.ipMax=0] - sockets open at once from one client address ; one more is closed `address`
 * @param {number} [options.trustProxy=0] - reverse proxies in front of the relay. 0 : the client's address
 *   is the socket's. n : it is the n-th entry from the right of `X-Forwarded-For`, the one the outermost
 *   trusted proxy wrote — never the left of the list, which the client writes itself
 * @param {number} [options.idleMs=0] - a joined socket that neither sent nor was sent anything but pings
 *   for that long is closed `idle`. Players on a direct link are silent on the relay : this cuts their room
 * @param {number} [options.aloneMs=0] - a room with one peer for that long is closed `alone`
 * @param {number} [options.roomLifeMs=0] - a room open for that long is closed `life`, whoever is in it
 * @param {(line: string) => void} [options.log=console.log]
 * @returns {Promise<{port: number, stats(): object, setTls(tls: {cert, key}): void, close(): Promise<void>}>}
 *   `setTls` swaps the certificate for new TLS handshakes ; open sockets keep theirs.
 */
export function createRelay({
  port = 8787,
  host = '0.0.0.0',
  key = '',
  tls,
  maxBytes = 16384,
  rate = 300,
  burst = 600,
  roomMax = 8,
  helloTimeoutMs = 5000,
  logData = false,
  origins = [],
  stats: statsOn = false,
  live: liveOn = false,
  maxSockets = 0,
  maxRooms = 0,
  ipMax = 0,
  trustProxy = 0,
  idleMs = 0,
  aloneMs = 0,
  roomLifeMs = 0,
  log = console.log,
} = {}) {
  const keyDigest = key ? digest(key) : null;
  /** room name → peer id → client */
  const rooms = Object.create(null);
  /** room name → { born, aloneSince } : when it opened, since when it has had one peer (0 : it has more) */
  const roomInfo = Object.create(null);
  let roomCount = 0;
  /** client address → its open sockets ; the accepted sockets in all */
  const perAddress = Object.create(null);
  let accepted = 0;
  const stats = newStats();
  const snapshot = () => ({ ...stats, sockets: wss.clients.size, rooms: roomCount });

  const onRequest = (req, res) => {
    if (statsOn && req.url === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(`${JSON.stringify(snapshot())}\n`);
    }
    if (liveOn && req.url === '/live') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      const live = { players: accepted, rooms: roomCount, peakPlayers: stats.peakSockets, peakRooms: stats.peakRooms, since: stats.since };
      return res.end(`${JSON.stringify(live)}\n`);
    }
    const ok = req.url === '/healthz';
    res.writeHead(ok ? 200 : 426, { 'content-type': 'text/plain' });
    res.end(ok ? 'ok\n' : 'ctr-relay : WebSocket only\n');
  };
  const server = tls ? createHttpsServer({ cert: tls.cert, key: tls.key }, onRequest) : createHttpServer(onRequest);
  const verifyClient = ({ origin }) => {
    if (!origins.length || origin === undefined || origins.includes(origin)) return true;
    stats.refusedOrigin++;
    log(`- refused origin ${String(origin).slice(0, 80)}`);
    return false;
  };
  const wss = new WebSocketServer({ server, maxPayload: maxBytes, verifyClient });

  function peerList(room) {
    const list = [];
    for (const id in room) {
      const c = room[id];
      list.push({ id, name: c.name, kind: c.kind });
    }
    return list;
  }

  function broadcastPeers(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    const raw = JSON.stringify({ type: 'peers', list: peerList(room) });
    for (const id in room) room[id].send(raw);
  }

  function keyMatches(candidate) {
    return typeof candidate === 'string' && timingSafeEqual(digest(candidate), keyDigest);
  }

  function join(client, msg) {
    const { id, room: roomName = '' } = msg;
    if (!validField(id, true) || !validField(roomName) || !validField(msg.name) || !validField(msg.kind)) {
      return client.ws.close(CLOSE.badHello, 'bad hello');
    }
    let room = rooms[roomName];
    let count = 0;
    if (room) {
      if (room[id]) return client.ws.close(CLOSE.idTaken, 'id taken');
      for (const _ in room) count++;
      if (count >= roomMax) return client.ws.close(CLOSE.roomFull, 'room full');
    } else {
      if (maxRooms && roomCount >= maxRooms) {
        stats.refused.rooms++;
        return client.ws.close(CLOSE.full, 'rooms');
      }
      // opened only now : a refused hello leaves no room behind
      room = rooms[roomName] = Object.create(null);
      roomInfo[roomName] = { born: Date.now(), aloneSince: 0 };
      if (++roomCount > stats.peakRooms) stats.peakRooms = roomCount;
    }
    roomInfo[roomName].aloneSince = count ? 0 : Date.now();
    client.id = id;
    client.roomName = roomName;
    client.name = msg.name || id.slice(0, 6);
    client.kind = msg.kind || 'client';
    client.active = Date.now();
    room[id] = client;
    clearTimeout(client.helloTimer);
    log(`  hello ${client.name} (${id.slice(0, 6)}) kind=${client.kind} room=${roomName.slice(0, 8) || '-'}`);
    client.send(JSON.stringify({ type: 'welcome', peers: peerList(room) }));
    broadcastPeers(roomName);
  }

  function route(client, msg) {
    const room = rooms[client.roomName];
    const type = msg.type;
    if (type === 'signal') {
      const target = room[msg.to];
      msg.from = client.id; // stamped : a peer cannot speak for another
      if (target) target.send(JSON.stringify(msg));
      log(`  route ${msg.kind || '?'} ${client.id.slice(0, 6)}→${String(msg.to).slice(0, 6)} ${target ? 'OK' : 'dest offline'}`);
    } else if (type === 'data') {
      const data = msg.data;
      if (typeof data !== 'string') return;
      const raw = JSON.stringify({ type: 'data', from: client.id, data });
      const to = msg.to;
      if (to === undefined) {
        for (const id in room) if (id !== client.id) room[id].send(raw);
      } else {
        room[to]?.send(raw);
      }
      stats.forwarded++;
      if (logData) log(`  data ${client.id.slice(0, 6)}→${to === undefined ? '*' : String(to).slice(0, 6)} ${data.slice(0, 24)}…`);
    }
  }

  /** The client's address : the socket's, or the one the outermost trusted proxy saw. */
  function addressOf(req) {
    const direct = req.socket.remoteAddress;
    if (!trustProxy) return direct;
    const list = String(req.headers['x-forwarded-for'] ?? '').split(',');
    return list[list.length - trustProxy]?.trim() || direct;
  }

  function refuse(ws, why, code) {
    stats.refused[why]++;
    ws.on('error', () => {});
    ws.close(code, why);
  }

  function kick(client, why) {
    if (client.kicked) return;
    client.kicked = true;
    stats.kicked[why]++;
    log(`  kicked ${client.name} (${client.id.slice(0, 6)}) ${why}`);
    client.ws.close(CLOSE[why], why);
  }

  wss.on('connection', (ws, req) => {
    const remote = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    // refused just after the handshake : a browser cannot read why an upgrade was refused, a close code it can
    const address = addressOf(req);
    if (maxSockets && accepted >= maxSockets) return refuse(ws, 'sockets', CLOSE.full);
    const fromHere = perAddress[address] ?? 0;
    if (ipMax && fromHere >= ipMax) return refuse(ws, 'address', CLOSE.address);
    perAddress[address] = fromHere + 1;
    if (++accepted > stats.peakSockets) stats.peakSockets = accepted;
    const client = {
      ws,
      id: null,
      roomName: null,
      name: null,
      kind: null,
      alive: true,
      kicked: false,
      active: 0, // the last message that was not a ping, either way
      tokens: burst,
      stamp: Date.now(),
      drops: 0,
      helloTimer: setTimeout(() => ws.close(CLOSE.key, 'no hello'), helloTimeoutMs),
      send(raw, isPong = false) {
        if (!isPong) client.active = Date.now();
        if (ws.readyState === ws.OPEN) ws.send(raw);
      },
    };
    ws.client = client;
    log(`+ ${remote}`);

    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (raw, isBinary) => {
      if (ws.readyState !== ws.OPEN) return; // closing : what is still buffered goes nowhere
      let msg = null;
      if (!isBinary) {
        try { msg = JSON.parse(raw.toString()); } catch { /* not JSON */ }
      }
      const valid = msg !== null && typeof msg === 'object';

      const now = Date.now();
      client.tokens = Math.min(burst, client.tokens + ((now - client.stamp) * rate) / 1000);
      client.stamp = now;
      if (client.tokens < 1) {
        // a lossy data message (kart states) is dropped ; sustained flooding still closes
        if (valid && msg.type === 'data' && msg.lossy === true) {
          stats.droppedLossy++;
          if (++client.drops >= burst) {
            stats.closedRate++;
            ws.close(CLOSE.rate, 'rate limit');
          }
          return;
        }
        // anything else borrows up to one more burst, then the socket closes : never a silent drop
        if (client.tokens < 1 - burst) {
          stats.closedRate++;
          return ws.close(CLOSE.rate, 'rate limit');
        }
      }
      client.tokens--;
      client.drops = 0;

      if (client.id === null) {
        const isHello = valid && msg.type === 'hello';
        if (keyDigest && !(isHello && keyMatches(msg.key))) return ws.close(CLOSE.key, 'key');
        if (isHello) join(client, msg);
        return;
      }
      if (!valid) return;
      if (msg.type === 'ping') return client.send(JSON.stringify({ type: 'pong', ts: msg.ts, srv: now }), true);
      client.active = now;
      route(client, msg);
    });
    ws.on('close', (code) => {
      clearTimeout(client.helloTimer);
      accepted--;
      if (--perAddress[address] === 0) delete perAddress[address];
      const roomName = client.roomName;
      if (client.id === null) return log(`- ${remote} (no hello, ${code})`);
      const room = rooms[roomName];
      delete room[client.id];
      let left = 0;
      for (const _ in room) left++;
      if (!left) {
        delete rooms[roomName];
        delete roomInfo[roomName];
        roomCount--;
      } else {
        if (left === 1) roomInfo[roomName].aloneSince = Date.now();
        broadcastPeers(roomName);
      }
      log(`- ${client.name} (${client.id.slice(0, 6)}) ${code}`);
    });
    ws.on('error', () => {}); // a 1009 (too big) or a reset ; 'close' follows
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const client = ws.client;
      if (!client.alive) { ws.terminate(); continue; }
      client.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  // the kicks, looked for often enough that none is late by more than a quarter of its own delay
  let shortest = Infinity;
  for (const ms of [idleMs, aloneMs, roomLifeMs]) if (ms && ms < shortest) shortest = ms;
  const sweep = shortest === Infinity ? null : setInterval(() => {
    const now = Date.now();
    for (const roomName in rooms) {
      const info = roomInfo[roomName];
      const room = rooms[roomName];
      if (roomLifeMs && now - info.born >= roomLifeMs) for (const id in room) kick(room[id], 'life');
      else if (aloneMs && info.aloneSince && now - info.aloneSince >= aloneMs) for (const id in room) kick(room[id], 'alone');
    }
    if (!idleMs) return;
    for (const ws of wss.clients) {
      const client = ws.client;
      if (client && client.id !== null && now - client.active >= idleMs) kick(client, 'idle');
    }
  }, Math.min(5000, Math.max(20, shortest / 4)));

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      log(`ctr-relay listening ${tls ? 'wss' : 'ws'}://${host}:${actual} ${keyDigest ? 'private (RELAY_KEY set)' : 'OPEN (no RELAY_KEY)'}`);
      if (maxSockets || maxRooms || ipMax || trustProxy || sweep) {
        const s = (ms) => (ms ? `${ms / 1000} s` : 'off');
        log(`limits : sockets ${maxSockets || 'off'}, rooms ${maxRooms || 'off'}, per address ${ipMax || 'off'} (proxies trusted : ${trustProxy}), idle ${s(idleMs)}, alone ${s(aloneMs)}, room life ${s(roomLifeMs)}`);
      }
      resolve({
        port: actual,
        stats: snapshot,
        setTls(next) {
          if (!tls) throw new Error('setTls() needs a relay started with tls');
          server.setSecureContext({ cert: next.cert, key: next.key });
        },
        close() {
          clearInterval(heartbeat);
          clearInterval(sweep);
          for (const ws of wss.clients) ws.terminate();
          wss.close();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}

function envInt(name, fallback) {
  const value = process.env[name];
  return value ? Number.parseInt(value, 10) : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const readTls = () => ({ cert: readFileSync(env.TLS_CERT), key: readFileSync(env.TLS_KEY) });
  const tls = env.TLS_CERT && env.TLS_KEY ? readTls() : undefined;
  createRelay({
    port: envInt('PORT', 8787),
    host: env.HOST || '0.0.0.0',
    key: env.RELAY_KEY || '',
    tls,
    maxBytes: envInt('RELAY_MAX_BYTES', 16384),
    rate: envInt('RELAY_RATE', 300),
    burst: envInt('RELAY_BURST', 600),
    roomMax: envInt('RELAY_ROOM_MAX', 8),
    logData: env.RELAY_LOG_DATA === '1',
    origins: (env.RELAY_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
    stats: env.RELAY_STATS === '1',
    live: env.RELAY_LIVE === '1',
    maxSockets: envInt('RELAY_MAX_SOCKETS', 0),
    maxRooms: envInt('RELAY_MAX_ROOMS', 0),
    ipMax: envInt('RELAY_IP_MAX', 0),
    trustProxy: envInt('RELAY_TRUST_PROXY', 0),
    idleMs: envInt('RELAY_IDLE_S', 0) * 1000,
    aloneMs: envInt('RELAY_ALONE_S', 0) * 1000,
    roomLifeMs: envInt('RELAY_ROOM_LIFE_S', 0) * 1000,
  }).then((relay) => {
    if (!tls) return;
    // A renewed certificate (lego, certbot…) is written over the same files : re-read them on
    // SIGHUP, or when they change. Rooms and open sockets are untouched ; a half-written pair
    // fails to load and the previous certificate stays until the next change.
    const reload = (why) => {
      try {
        relay.setTls(readTls());
        console.log(`tls reloaded (${why})`);
      } catch (e) {
        console.error(`tls reload failed (${why}), keeping the previous certificate : ${e.message}`);
      }
    };
    process.on('SIGHUP', () => reload('SIGHUP'));
    const interval = envInt('TLS_WATCH_MS', 60_000);
    if (interval > 0) {
      for (const file of [env.TLS_CERT, env.TLS_KEY]) {
        watchFile(file, { interval }, (now, before) => { if (now.mtimeMs !== before.mtimeMs) reload('file changed'); });
      }
    }
  }).catch((e) => {
    console.error('ctr-relay :', e.message);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
}
