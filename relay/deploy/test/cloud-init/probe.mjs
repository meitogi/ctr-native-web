// From inside the stand-in VM : the relay serves the ACME certificate for --name, the key
// is checked ; with --renew, a forced renewal (the timer's command) swaps the certificate for
// new handshakes while a socket opened before stays in its room.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect as tlsConnect } from 'node:tls';
import { createRequire } from 'node:module';

const WebSocket = createRequire('/relay-src/')('ws');
const arg = (n) => process.argv[process.argv.indexOf(`--${n}`) + 1];
const name = arg('name');
const key = arg('key');
const ca = readFileSync(arg('ca'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const servername = /^[\d.]+$/.test(name) ? undefined : name;

const serial = () => new Promise((resolve, reject) => {
  const s = tlsConnect({ host: '127.0.0.1', port: 8787, servername, ca, checkServerIdentity: () => undefined }, () => {
    const cert = s.getPeerCertificate();
    const names = cert.subjectaltname ?? '';
    if (!s.authorized) return reject(new Error(`not trusted : ${s.authorizationError}`));
    if (!names.includes(name)) return reject(new Error(`certificate names ${names}, not ${name}`));
    resolve(cert.serialNumber);
    s.end();
  });
  s.once('error', reject);
});

function join(id) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://127.0.0.1:8787', { ca, servername, checkServerIdentity: () => undefined });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', id, room: 'probe', key })));
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'welcome') resolve(ws); });
    ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    ws.on('error', reject);
  });
}

const before = await serial();
const a = await join('a');
console.log(`  certificate ${before} for ${name}, trusted ; key accepted`);
if (process.argv.includes('--renew')) {
  execFileSync('/usr/local/sbin/ctr-relay-renew', { env: { ...process.env, LEGO_RENEW_FORCE: 'true', LEGO_NO_RANDOM_SLEEP: 'true' }, stdio: 'ignore' });
  let after = before;
  for (let i = 0; i < 50 && after === before; i++) { await sleep(100); after = await serial(); }
  if (after === before) throw new Error('the renewed certificate is not served');
  const pong = new Promise((resolve) => a.on('message', (raw) => { if (JSON.parse(raw).type === 'pong') resolve(); }));
  a.send(JSON.stringify({ type: 'ping', ts: 1 }));
  await Promise.race([pong, sleep(2000).then(() => { throw new Error('the socket opened before the renewal is gone'); })]);
  console.log(`  renewed : now ${after} ; the socket opened under ${before} still answers`);
}
a.close();
process.exit(0);
