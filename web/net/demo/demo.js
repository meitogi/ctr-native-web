// Standalone demo of web/net : one host and one guest in this page exchange messages
// through each transport. Configure with the page hash : #relay=ws://localhost:8787&rk=…
// window.__netDemo holds the results for automated checks.
import { formatRoomLink, newRoom } from '../link.js';
import { openRoom } from '../room.js';

const COUNT = 10;
const MARKER = 'ctr-demo-plaintext';
const hash = new URLSearchParams(location.hash.slice(1));
const $ = (id) => document.getElementById(id);
$('relay').value = hash.get('relay') || 'ws://localhost:8787';
$('rk').value = hash.get('rk') || '';

const state = { runs: {}, busy: false };
window.__netDemo = state;

const bytes = (s) => new TextEncoder().encode(s);
const str = (b) => new TextDecoder().decode(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (pred()) return true;
    await sleep(25);
  }
  return pred();
};

function render(mode) {
  const run = state.runs[mode];
  const section = $(mode);
  const status = section.querySelector('.status');
  status.textContent = run.status;
  status.className = `status ${run.status === 'PASS' ? 'pass' : run.status === 'FAIL' ? 'fail' : ''}`;
  const rows = [
    ['guest sees', run.guestPath && `<span class="path">${run.guestPath}</span>`],
    ['host sees', run.hostPath && `<span class="path">${run.hostPath}</span>`],
    ['transport', run.backend],
    ['host → guest', `${run.toGuest.length} / ${COUNT}`],
    ['guest → host', `${run.toHost.length} / ${COUNT}`],
    ['warnings', run.warnings.map((w) => w.code).join(', ') || '—'],
    ['time', run.ms === null ? '' : `${run.ms} ms to link`],
  ];
  section.querySelector('dl').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? ''}</dd>`).join('');
  section.querySelector('pre').textContent = run.log.join('\n');
}

async function runOnce(mode) {
  const run = { status: 'running', log: [], warnings: [], toGuest: [], toHost: [], guestPath: null, hostPath: null, backend: null, ms: null };
  state.runs[mode] = run;
  const log = (line) => { run.log.push(line); render(mode); };
  render(mode);
  let host;
  let guest;
  try {
    const room = newRoom({ relay: $('relay').value, rk: $('rk').value });
    const link = formatRoomLink(location.href, room);
    log(`room ${room.room} on ${room.relay}`);
    host = await openRoom({ link, role: 'host', name: 'demo-host' });
    guest = await openRoom({ link, role: 'guest', mode: mode === 'ws' ? 'ws' : 'auto', name: 'demo-guest' });
    log(`host ${host.selfId.slice(0, 8)} · guest ${guest.selfId.slice(0, 8)} joined the relay`);
    for (const r of [host, guest]) r.on('warning', (w) => { run.warnings.push(w); log(`warning ${w.code} : ${w.message}`); });

    let hostLink = null;
    host.on('link', (l) => {
      hostLink = l;
      l.on('message', (b) => { run.toHost.push(str(b)); render(mode); });
    });
    const t0 = performance.now();
    const guestLink = await guest.connect();
    run.ms = Math.round(performance.now() - t0);
    guestLink.on('message', (b) => { run.toGuest.push(str(b)); render(mode); });
    if (!(await waitFor(() => hostLink, 5000))) throw new Error('the host never got a link');
    run.backend = guestLink.backend;
    run.guestPath = guestLink.path;
    run.hostPath = hostLink.path;
    log(`linked : ${guestLink.backend}, guest sees ${guestLink.path}, host sees ${hostLink.path}`);

    for (let i = 0; i < COUNT; i++) {
      guestLink.send(bytes(`${MARKER} guest→host #${i}`));
      hostLink.send(bytes(`${MARKER} host→guest #${i}`));
      await sleep(20);
    }
    await waitFor(() => run.toGuest.length === COUNT && run.toHost.length === COUNT, 3000);
    const expectedPath = mode === 'ws' ? run.guestPath === 'relay' : run.guestPath !== 'relay';
    const ok = run.toGuest.length === COUNT && run.toHost.length === COUNT && expectedPath && run.hostPath === run.guestPath
      && (mode === 'ws' || run.backend === 'webrtc');
    run.status = ok ? 'PASS' : 'FAIL';
    log(`${run.toHost.length}/${COUNT} to host, ${run.toGuest.length}/${COUNT} to guest → ${run.status}`);
  } catch (e) {
    run.status = 'FAIL';
    log(`error ${e.code ?? ''} ${e.message}`);
  } finally {
    host?.close();
    guest?.close();
    render(mode);
  }
  return run;
}

async function run(mode) {
  if (state.busy) return;
  state.busy = true;
  try { return await runOnce(mode); } finally { state.busy = false; }
}

$('run-auto').addEventListener('click', () => run('auto'));
$('run-ws').addEventListener('click', () => run('ws'));
state.run = run;
