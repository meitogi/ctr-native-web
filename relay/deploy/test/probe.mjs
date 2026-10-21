// Probe a relay through a proxy : wss connect, key check, data round trip, /healthz.
// Runs inside the ctr-relay image (it has `ws`) on the proxy's network :
//   node probe.mjs <wss-url>   with RELAY_KEY in the environment.
import WebSocket from 'ws';

const url = process.argv[2];
const key = process.env.RELAY_KEY;
const tls = { rejectUnauthorized: false }; // test proxies use self-signed / internal-CA certs
let failed = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

function open(hello) {
  const ws = new WebSocket(url, tls);
  const messages = [];
  const state = { ws, messages, closeCode: null, openedAt: 0, closedAt: 0 };
  state.closed = new Promise((resolve) => ws.on('close', (code) => {
    state.closeCode = code;
    state.closedAt = Date.now();
    resolve(code);
  }));
  state.opened = new Promise((resolve, reject) => {
    ws.on('open', () => {
      state.openedAt = Date.now();
      if (hello) ws.send(JSON.stringify(hello));
      resolve();
    });
    ws.on('error', reject);
  });
  ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  return state;
}

const waitFor = async (pred, ms) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
};

// The proxy picks the relay up a moment after it is healthy : wait for the route first.
const healthUrl = url.replace(/^wss:/, 'https:') + '/healthz';
let routed = false;
for (const end = Date.now() + 30_000; !routed && Date.now() < end;) {
  routed = (await fetch(healthUrl).catch(() => ({ status: 0 }))).status === 200;
  if (!routed) await new Promise((r) => setTimeout(r, 500));
}
check('GET /healthz through the proxy', routed);
if (!routed) process.exit(1);

const room = 'probe-' + Math.random().toString(36).slice(2, 8);
const a = open({ type: 'hello', id: 'pa', room, key });
const b = open({ type: 'hello', id: 'pb', room, key });
await Promise.all([a.opened, b.opened]);
check('wss connect through the proxy, right key → welcome',
  await waitFor(() => a.messages.some((m) => m.type === 'welcome') && b.messages.some((m) => m.type === 'welcome'), 3000));
a.ws.send(JSON.stringify({ type: 'data', to: 'pb', data: 'cHJvYmU=' }));
check('data forwarded through the proxy, from stamped',
  await waitFor(() => b.messages.some((m) => m.type === 'data' && m.from === 'pa' && m.data === 'cHJvYmU='), 3000));
a.ws.close(); b.ws.close();

const wrong = open({ type: 'hello', id: 'pw', room, key: key + '-wrong' });
await wrong.opened;
await wrong.closed;
check('wrong key → closed 4401, no welcome', wrong.closeCode === 4401 && !wrong.messages.length, `code ${wrong.closeCode}`);

const silent = open(null);
await silent.opened;
await silent.closed;
const after = silent.closedAt - silent.openedAt;
check('no hello → closed 4401 after ~5 s', silent.closeCode === 4401 && after >= 4500 && after < 7000, `code ${silent.closeCode} after ${after} ms`);

process.exit(failed ? 1 : 0);
