// ctr-relay — WebSocket meeting point for CTR Native Web rooms.
//
// Fork of the debrid-remote signal-relay : same `hello` / `peers` / `signal` /
// `ping` protocol, scoped to rooms, plus forwarding of opaque `data` messages
// for players with no direct WebRTC path. The relay never reads what it
// forwards : the browsers encrypt it with the room secret, which it never sees.
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
};

const FIELD_MAX = 64;
const HEARTBEAT_MS = 30_000;

const digest = (text) => createHash('sha256').update(text).digest();

function validField(value, required) {
  if (value === undefined && !required) return true;
  return typeof value === 'string' && value.length <= FIELD_MAX && (!required || value.length > 0);
}

/**
 * Starts a relay and resolves once it listens.
 * @param {object} [options]
 * @param {number} [options.port=8787] - 0 picks a free port (tests)
 * @param {string} [options.host='0.0.0.0']
 * @param {string} [options.key=''] - RELAY_KEY ; empty = open relay
 * @param {{cert: string|Buffer, key: string|Buffer}} [options.tls] - serve wss:// itself
 * @param {number} [options.maxBytes=16384] - largest WebSocket message accepted
 * @param {number} [options.rate=120] - messages per second per socket, sustained
 * @param {number} [options.burst=240] - messages a socket may send at once
 * @param {number} [options.roomMax=8] - peers per room (OnlineCTR MAX_NUM_PLAYERS)
 * @param {number} [options.helloTimeoutMs=5000] - a socket without a valid hello by then is closed
 * @param {boolean} [options.logData=false] - log the head of each forwarded `data` (ciphertext)
 * @param {(line: string) => void} [options.log=console.log]
 * @returns {Promise<{port: number, setTls(tls: {cert, key}): void, close(): Promise<void>}>}
 *   `setTls` swaps the certificate for new TLS handshakes ; open sockets keep theirs.
 */
export function createRelay({
  port = 8787,
  host = '0.0.0.0',
  key = '',
  tls,
  maxBytes = 16384,
  rate = 120,
  burst = 240,
  roomMax = 8,
  helloTimeoutMs = 5000,
  logData = false,
  log = console.log,
} = {}) {
  const keyDigest = key ? digest(key) : null;
  /** room name → peer id → client */
  const rooms = Object.create(null);

  const onRequest = (req, res) => {
    const ok = req.url === '/healthz';
    res.writeHead(ok ? 200 : 426, { 'content-type': 'text/plain' });
    res.end(ok ? 'ok\n' : 'ctr-relay : WebSocket only\n');
  };
  const server = tls ? createHttpsServer({ cert: tls.cert, key: tls.key }, onRequest) : createHttpServer(onRequest);
  const wss = new WebSocketServer({ server, maxPayload: maxBytes });

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
    const room = (rooms[roomName] ??= Object.create(null));
    if (room[id]) return client.ws.close(CLOSE.idTaken, 'id taken');
    let count = 0;
    for (const _ in room) count++;
    if (count >= roomMax) return client.ws.close(CLOSE.roomFull, 'room full');
    client.id = id;
    client.roomName = roomName;
    client.name = msg.name || id.slice(0, 6);
    client.kind = msg.kind || 'client';
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
      if (logData) log(`  data ${client.id.slice(0, 6)}→${to === undefined ? '*' : String(to).slice(0, 6)} ${data.slice(0, 24)}…`);
    }
  }

  wss.on('connection', (ws, req) => {
    const remote = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    const client = {
      ws,
      id: null,
      roomName: null,
      name: null,
      kind: null,
      alive: true,
      tokens: burst,
      stamp: Date.now(),
      drops: 0,
      helloTimer: setTimeout(() => ws.close(CLOSE.key, 'no hello'), helloTimeoutMs),
      send(raw) {
        if (ws.readyState === ws.OPEN) ws.send(raw);
      },
    };
    ws.client = client;
    log(`+ ${remote}`);

    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (raw, isBinary) => {
      const now = Date.now();
      client.tokens = Math.min(burst, client.tokens + ((now - client.stamp) * rate) / 1000);
      client.stamp = now;
      if (client.tokens < 1) {
        if (++client.drops >= burst) ws.close(CLOSE.rate, 'rate limit');
        return;
      }
      client.tokens--;
      client.drops = 0;

      let msg = null;
      if (!isBinary) {
        try { msg = JSON.parse(raw.toString()); } catch { /* not JSON */ }
      }
      const valid = msg !== null && typeof msg === 'object';
      if (client.id === null) {
        const isHello = valid && msg.type === 'hello';
        if (keyDigest && !(isHello && keyMatches(msg.key))) return ws.close(CLOSE.key, 'key');
        if (isHello) join(client, msg);
        return;
      }
      if (!valid) return;
      if (msg.type === 'ping') client.send(JSON.stringify({ type: 'pong', ts: msg.ts, srv: now }));
      else route(client, msg);
    });
    ws.on('close', (code) => {
      clearTimeout(client.helloTimer);
      const roomName = client.roomName;
      if (client.id === null) return log(`- ${remote} (no hello, ${code})`);
      const room = rooms[roomName];
      delete room[client.id];
      let empty = true;
      for (const _ in room) { empty = false; break; }
      if (empty) delete rooms[roomName];
      else broadcastPeers(roomName);
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

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      log(`ctr-relay listening ${tls ? 'wss' : 'ws'}://${host}:${actual} ${keyDigest ? 'private (RELAY_KEY set)' : 'OPEN (no RELAY_KEY)'}`);
      resolve({
        port: actual,
        setTls(next) {
          if (!tls) throw new Error('setTls() needs a relay started with tls');
          server.setSecureContext({ cert: next.cert, key: next.key });
        },
        close() {
          clearInterval(heartbeat);
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
    rate: envInt('RELAY_RATE', 120),
    burst: envInt('RELAY_BURST', 240),
    roomMax: envInt('RELAY_ROOM_MAX', 8),
    logData: env.RELAY_LOG_DATA === '1',
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
