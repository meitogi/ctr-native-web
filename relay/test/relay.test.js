import { strict as assert } from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect as tlsConnect } from 'node:tls';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { CLOSE, createRelay } from '../relay.js';
import { connect, join, quiet } from './helpers.js';

const KEY = 'k3y-for-tests';

describe('open relay (no key)', () => {
  let relay;
  let url;
  before(async () => {
    relay = await createRelay({ port: 0, host: '127.0.0.1', log: quiet, roomMax: 3 });
    url = `ws://127.0.0.1:${relay.port}`;
  });
  after(() => relay.close());

  test('hello → welcome with self, peers broadcast to the room', async () => {
    const a = await join(url, { id: 'a1', name: 'alice', room: 'r1' });
    assert.deepEqual(a.welcome.peers, [{ id: 'a1', name: 'alice', kind: 'client' }]);
    await a.next('peers');
    const b = await join(url, { id: 'b1', name: 'bob', kind: 'server', room: 'r1' });
    assert.deepEqual(b.welcome.peers.map((p) => p.id), ['a1', 'b1']);
    const seen = await a.next('peers');
    assert.deepEqual(seen.list, [{ id: 'a1', name: 'alice', kind: 'client' }, { id: 'b1', name: 'bob', kind: 'server' }]);
    b.close();
    assert.deepEqual((await a.next('peers')).list.map((p) => p.id), ['a1']);
    a.close();
  });

  test('rooms are isolated : peers, signal and data never cross', async () => {
    const a = await join(url, { id: 'iso-a', room: 'one' });
    const b = await join(url, { id: 'iso-b', room: 'two' });
    assert.deepEqual(b.welcome.peers.map((p) => p.id), ['iso-b']);
    a.send({ type: 'signal', to: 'iso-b', kind: 'offer', sdp: 'x' });
    a.send({ type: 'data', to: 'iso-b', data: 'AAAA' });
    a.send({ type: 'data', data: 'BBBB' });
    assert.equal(await b.silent('signal'), true);
    assert.equal(await b.silent('data'), true);
    a.close(); b.close();
  });

  test('signal is forwarded with all its fields, from stamped by the relay', async () => {
    const a = await join(url, { id: 'sa', room: 'sig' });
    const b = await join(url, { id: 'sb', room: 'sig' });
    a.send({ type: 'signal', from: 'sb', to: 'sb', kind: 'offer', sdp: '{"type":"offer"}', ts: 5, extra: { n: 1 } });
    const got = await b.next('signal');
    assert.deepEqual(got, { type: 'signal', from: 'sa', to: 'sb', kind: 'offer', sdp: '{"type":"offer"}', ts: 5, extra: { n: 1 } });
    a.close(); b.close();
  });

  test('data : unicast, broadcast to the others, from stamped, payload intact', async () => {
    const a = await join(url, { id: 'da', room: 'dat' });
    const b = await join(url, { id: 'db', room: 'dat' });
    const c = await join(url, { id: 'dc', room: 'dat' });
    a.send({ type: 'data', to: 'dc', from: 'db', data: 'Y2lwaGVy' });
    assert.deepEqual(await c.next('data'), { type: 'data', from: 'da', data: 'Y2lwaGVy' });
    assert.equal(await b.silent('data'), true);
    a.send({ type: 'data', data: 'YWxs' });
    assert.equal((await b.next('data')).data, 'YWxs');
    assert.equal((await c.next('data')).data, 'YWxs');
    assert.equal(await a.silent('data'), true);
    a.send({ type: 'data', data: 42 }); // not a string : dropped
    assert.equal(await b.silent('data'), true);
    a.close(); b.close(); c.close();
  });

  test('a hello without room joins the default room (webrtc-node-peer clients)', async () => {
    const node = await join(url, { id: 'srv-1', name: 'my-app', kind: 'server' });
    const web = await join(url, { id: 'web-1', name: 'browser', kind: 'client' });
    assert.ok(web.welcome.peers.some((p) => p.kind === 'server' && p.name === 'my-app'));
    web.send({ type: 'signal', from: 'web-1', to: 'srv-1', kind: 'offer', sdp: 's' });
    assert.equal((await node.next('signal')).kind, 'offer');
    node.close(); web.close();
  });

  test('ping → pong with ts and server clock', async () => {
    const a = await join(url, { id: 'p1', room: 'ping' });
    a.send({ type: 'ping', ts: 123 });
    const pong = await a.next('pong');
    assert.equal(pong.ts, 123);
    assert.ok(Math.abs(pong.srv - Date.now()) < 5000);
    a.close();
  });

  test('duplicate id in a room is refused, same id in another room is fine', async () => {
    const a = await join(url, { id: 'dup', room: 'd1' });
    const b = connect(url);
    await b.opened;
    b.send({ type: 'hello', id: 'dup', room: 'd1' });
    assert.equal(await b.closed, CLOSE.idTaken);
    const c = await join(url, { id: 'dup', room: 'd2' });
    a.close(); c.close();
  });

  test('room cap', async () => {
    const peers = [];
    for (let i = 0; i < 3; i++) peers.push(await join(url, { id: `cap${i}`, room: 'cap' }));
    const extra = connect(url);
    await extra.opened;
    extra.send({ type: 'hello', id: 'cap3', room: 'cap' });
    assert.equal(await extra.closed, CLOSE.roomFull);
    for (const p of peers) p.close();
  });

  test('malformed hello closes 4400', async () => {
    const a = connect(url);
    await a.opened;
    a.send({ type: 'hello', id: 'x'.repeat(65) });
    assert.equal(await a.closed, CLOSE.badHello);
  });

  test('/healthz answers 200, any other path 426', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${relay.port}/healthz`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${relay.port}/`)).status, 426);
  });
});

describe('private relay (RELAY_KEY)', () => {
  let relay;
  let url;
  before(async () => {
    relay = await createRelay({ port: 0, host: '127.0.0.1', key: KEY, log: quiet, helloTimeoutMs: 400 });
    url = `ws://127.0.0.1:${relay.port}`;
  });
  after(() => relay.close());

  test('the right key in the first hello is welcomed', async () => {
    const a = await join(url, { id: 'k1', room: 'k', key: KEY });
    assert.equal(a.welcome.type, 'welcome');
    a.close();
  });

  test('a wrong key closes 4401 without a welcome', async () => {
    for (const key of ['nope', KEY + 'x', '', undefined, 7]) {
      const a = connect(url);
      await a.opened;
      a.send({ type: 'hello', id: 'k2', room: 'k', key });
      assert.equal(await a.closed, CLOSE.key, `key ${JSON.stringify(key)}`);
    }
  });

  test('a first message that is not hello closes 4401', async () => {
    const a = connect(url);
    await a.opened;
    a.send({ type: 'ping', ts: 1 });
    assert.equal(await a.closed, CLOSE.key);
    const b = connect(url);
    await b.opened;
    b.send('not json');
    assert.equal(await b.closed, CLOSE.key);
  });

  test('silence closes 4401 after the hello timeout', async () => {
    const a = connect(url);
    await a.opened;
    const t0 = Date.now();
    assert.equal(await a.closed, CLOSE.key);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 350 && elapsed < 2000, `closed after ${elapsed} ms`);
  });

  test('the default hello timeout is 5 s', async () => {
    const r = await createRelay({ port: 0, host: '127.0.0.1', key: KEY, log: quiet });
    const a = connect(`ws://127.0.0.1:${r.port}`);
    await a.opened;
    const t0 = Date.now();
    const code = await a.closed;
    const elapsed = Date.now() - t0;
    await r.close();
    assert.equal(code, CLOSE.key);
    assert.ok(elapsed >= 4900 && elapsed < 6000, `closed after ${elapsed} ms`);
  });
});

describe('limits', () => {
  test('a message over maxBytes closes the socket (1009), smaller ones pass', async () => {
    const relay = await createRelay({ port: 0, host: '127.0.0.1', log: quiet, maxBytes: 1024 });
    const url = `ws://127.0.0.1:${relay.port}`;
    const a = await join(url, { id: 'big-a', room: 'big' });
    const b = await join(url, { id: 'big-b', room: 'big' });
    a.send({ type: 'data', to: 'big-b', data: 'x'.repeat(900) });
    assert.equal((await b.next('data')).data.length, 900);
    a.send({ type: 'data', to: 'big-b', data: 'x'.repeat(1100) });
    assert.equal(await a.closed, 1009);
    assert.equal(await b.silent('data'), true);
    b.close();
    await relay.close();
  });

  test('rate limit : the burst passes, the excess is dropped, sustained flooding closes 4429', async () => {
    const relay = await createRelay({ port: 0, host: '127.0.0.1', log: quiet, rate: 10, burst: 20 });
    const url = `ws://127.0.0.1:${relay.port}`;
    const a = await join(url, { id: 'fl-a', room: 'fl' }); // the hello took one token
    const b = await join(url, { id: 'fl-b', room: 'fl' });
    let received = 0;
    b.ws.on('message', (raw) => { if (JSON.parse(raw).type === 'data') received++; });
    for (let i = 0; i < 30; i++) a.send({ type: 'data', to: 'fl-b', data: 'AA' });
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(received >= 19 && received <= 23, `received ${received} of 30`);
    assert.equal(a.ws.readyState, a.ws.OPEN, 'a short excess only drops');
    for (let i = 0; i < 40; i++) a.send({ type: 'data', to: 'fl-b', data: 'AA' });
    assert.equal(await a.closed, CLOSE.rate);
    b.close();
    await relay.close();
  });
});

describe('TLS', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(joinPath(tmpdir(), 'ctr-relay-tls-'));
    const makeCert = (name, cn) => execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
      '-keyout', joinPath(dir, `${name}key.pem`), '-out', joinPath(dir, `${name}cert.pem`), '-days', '1', '-subj', `/CN=${cn}`], { stdio: 'ignore' });
    makeCert('', 'localhost');
    makeCert('a-', 'cert-a');
    makeCert('b-', 'cert-b');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('serves wss:// itself with TLS_CERT / TLS_KEY, key check included', async () => {
    const relay = await createRelay({
      port: 0, host: '127.0.0.1', key: KEY, log: quiet,
      tls: { cert: readFileSync(joinPath(dir, 'cert.pem')), key: readFileSync(joinPath(dir, 'key.pem')) },
    });
    const url = `wss://127.0.0.1:${relay.port}`;
    const ca = { ca: readFileSync(joinPath(dir, 'cert.pem')), servername: 'localhost' };
    const a = await join(url, { id: 't1', room: 'tls', key: KEY }, ca);
    assert.equal(a.welcome.type, 'welcome');
    const bad = connect(url, ca);
    await bad.opened;
    bad.send({ type: 'hello', id: 't2', room: 'tls', key: 'wrong' });
    assert.equal(await bad.closed, CLOSE.key);
    a.close();
    await relay.close();
  });

  // The CN of the certificate a fresh TLS handshake gets.
  const handshakeCn = (port) => new Promise((resolve, reject) => {
    const socket = tlsConnect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
      resolve(socket.getPeerCertificate().subject.CN);
      socket.end();
    });
    socket.once('error', reject);
  });

  // relay.js run as a process, as in the image : TLS_CERT / TLS_KEY files, renewed in place.
  async function startProcess(extraEnv) {
    const live = { cert: joinPath(dir, 'live-cert.pem'), key: joinPath(dir, 'live-key.pem') };
    copyFileSync(joinPath(dir, 'a-cert.pem'), live.cert);
    copyFileSync(joinPath(dir, 'a-key.pem'), live.key);
    const child = spawn(process.execPath, [new URL('../relay.js', import.meta.url).pathname], {
      env: { ...process.env, PORT: '0', HOST: '127.0.0.1', RELAY_KEY: KEY, TLS_CERT: live.cert, TLS_KEY: live.key, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const waiters = [];
    const onData = (chunk) => {
      out += chunk;
      for (const w of waiters.slice()) if (w.re.test(out)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(out.match(w.re)); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const waitLog = (re, ms = 5000) => new Promise((resolve, reject) => {
      if (re.test(out)) return resolve(out.match(re));
      waiters.push({ re, resolve });
      setTimeout(() => reject(new Error(`no ${re} in relay output within ${ms} ms :\n${out}`)), ms);
    });
    const port = Number((await waitLog(/listening wss:\/\/127\.0\.0\.1:(\d+)/))[1]);
    const swapToB = () => {
      copyFileSync(joinPath(dir, 'b-key.pem'), live.key);
      copyFileSync(joinPath(dir, 'b-cert.pem'), live.cert);
    };
    return { child, port, waitLog, swapToB, stop: () => child.kill('SIGTERM') };
  }

  for (const [how, extraEnv] of [['SIGHUP', { TLS_WATCH_MS: '0' }], ['a change of the files', { TLS_WATCH_MS: '100' }]]) {
    test(`reloads a renewed certificate on ${how} : new handshakes get it, open sockets and rooms stay up`, async (t) => {
      const relay = await startProcess(extraEnv);
      t.after(relay.stop);
      const url = `wss://127.0.0.1:${relay.port}`;
      const insecure = { rejectUnauthorized: false };
      assert.equal(await handshakeCn(relay.port), 'cert-a');
      const a = await join(url, { id: 'r1', room: 'renew', key: KEY }, insecure);
      assert.equal(a.ws._socket.getPeerCertificate().subject.CN, 'cert-a');
      await a.next('peers'); // its own arrival

      relay.swapToB();
      if (how === 'SIGHUP') relay.child.kill('SIGHUP');
      await relay.waitLog(/tls reloaded/);
      assert.equal(await handshakeCn(relay.port), 'cert-b', 'a new handshake sees the renewed certificate');

      const b = await join(url, { id: 'r2', room: 'renew', key: KEY }, insecure);
      assert.equal(b.ws._socket.getPeerCertificate().subject.CN, 'cert-b');
      assert.deepEqual((await a.next('peers')).list.map((p) => p.id).sort(), ['r1', 'r2'], 'the socket opened under cert A is still in its room');
      a.send({ type: 'data', to: 'r2', data: 'c3RpbGwgdXA' });
      assert.deepEqual(await b.next('data'), { type: 'data', from: 'r1', data: 'c3RpbGwgdXA' });
      a.close(); b.close();
    });
  }

  test('a key that does not match the certificate is refused, the previous pair stays', async (t) => {
    const relay = await startProcess({ TLS_WATCH_MS: '0' });
    t.after(relay.stop);
    copyFileSync(joinPath(dir, 'b-cert.pem'), joinPath(dir, 'live-cert.pem')); // cert B, key still A
    relay.child.kill('SIGHUP');
    await relay.waitLog(/tls reload failed/);
    assert.equal(await handshakeCn(relay.port), 'cert-a');
  });
});
