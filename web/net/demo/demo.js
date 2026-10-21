// Standalone demo of web/net. Top : one host and one guest in this page exchange messages,
// once per signaling backend (relay, MQTT, copy-paste) and once over the relay's WebSocket
// path. Bottom : host here and join from another device with the link.
// Configure with the page hash : #relay=ws://localhost:8787&rk=…&mqtt=ws://localhost:9001
// (a join link adds room / key / sig). window.__netDemo holds the results for automated checks.
import { formatRoomLink, newRoom, parseRoomLink } from '../link.js';
import { openRoom } from '../room.js';
import { MQTT_BROKERS } from '../signaling-mqtt.js';

const COUNT = 10;
const MARKER = 'ctr-demo-plaintext';
const hash = new URLSearchParams(location.hash.slice(1));
const $ = (id) => document.getElementById(id);
$('relay').value = hash.get('relay') || 'ws://localhost:8787';
$('rk').value = hash.get('rk') || '';
$('brokers').value = hash.get('mqtt') || MQTT_BROKERS.join(',');
$('sig').value = hash.get('sig') || 'relay';

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
const where = (signaling) => newRoom({
  relay: $('relay').value,
  rk: $('rk').value,
  mqtt: $('brokers').value.split(',').map((s) => s.trim()).filter(Boolean),
  signaling,
});

/** Each run : the backend list of its room link, and the guest mode. */
const RUNS = {
  auto: { signaling: ['relay'], mode: 'auto' },
  ws: { signaling: ['relay'], mode: 'ws' },
  mqtt: { signaling: ['mqtt'], mode: 'auto' },
  paste: { signaling: ['paste'], mode: 'auto' },
};

function render(name) {
  const run = state.runs[name];
  const section = $(name);
  const status = section.querySelector('.status');
  status.textContent = run.status;
  status.className = `status ${run.status === 'PASS' ? 'pass' : run.status === 'FAIL' ? 'fail' : ''}`;
  const rows = [
    ['signaling', run.signaling && `<span class="path">${run.signaling}</span>`],
    ['guest sees', run.guestPath && `<span class="path">${run.guestPath}</span>`],
    ['host sees', run.hostPath && `<span class="path">${run.hostPath}</span>`],
    ['transport', run.backend],
    ['host → guest', `${run.toGuest.length} / ${COUNT}`],
    ['guest → host', `${run.toHost.length} / ${COUNT}`],
    ['reliable', run.reliable === undefined ? '' : run.reliable ? 'both ways' : 'missing'],
    ['warnings', run.warnings.map((w) => w.code).join(', ') || '—'],
    ['time', run.ms === null ? '' : `${run.ms} ms to link`],
  ];
  section.querySelector('dl').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? ''}</dd>`).join('');
  section.querySelector('pre').textContent = run.log.join('\n');
}

async function runOnce(name) {
  const { signaling, mode } = RUNS[name];
  const run = { status: 'running', log: [], warnings: [], toGuest: [], toHost: [], guestPath: null, hostPath: null, backend: null, signaling: null, ms: null, blobs: {} };
  state.runs[name] = run;
  const log = (line) => { run.log.push(line); render(name); };
  render(name);
  let host;
  let guest;
  try {
    const room = where(signaling);
    const link = formatRoomLink(location.href, room);
    log(`room ${room.room} over ${signaling.join(', ')}`);
    host = await openRoom({ link, role: 'host', name: 'demo-host' });
    guest = await openRoom({ link, role: 'guest', mode, name: 'demo-guest' });
    log(`host ${host.selfId.slice(0, 8)} · guest ${guest.selfId.slice(0, 8)} joined ${guest.backend}`);
    for (const r of [host, guest]) r.on('warning', (w) => { run.warnings.push(w); log(`warning ${w.backend} ${w.code} : ${w.message}`); });
    if (name === 'paste') wirePaste(run, host, guest, log);

    let hostLink = null;
    host.on('link', (l) => {
      hostLink = l;
      l.on('message', (b) => { run.toHost.push(str(b)); render(name); });
    });
    const t0 = performance.now();
    const guestLink = await guest.connect();
    run.ms = Math.round(performance.now() - t0);
    guestLink.on('message', (b) => { run.toGuest.push(str(b)); render(name); });
    if (!(await waitFor(() => hostLink, 5000))) throw new Error('the host never got a link');
    run.backend = guestLink.backend;
    run.signaling = guestLink.signaling;
    run.guestPath = guestLink.path;
    run.hostPath = hostLink.path;
    log(`linked over ${guestLink.signaling} : ${guestLink.backend}, guest sees ${guestLink.path}, host sees ${hostLink.path}`);

    for (let i = 0; i < COUNT; i++) {
      const reliable = i === 0; // one message on the reliable channel, the rest unreliable
      guestLink.send(bytes(`${MARKER} guest→host #${i}${reliable ? ' reliable' : ''}`), { reliable });
      hostLink.send(bytes(`${MARKER} host→guest #${i}${reliable ? ' reliable' : ''}`), { reliable });
      await sleep(20);
    }
    await waitFor(() => run.toGuest.length === COUNT && run.toHost.length === COUNT, 3000);
    const expectedPath = mode === 'ws' ? run.guestPath === 'relay' : run.guestPath !== 'relay';
    run.reliable = run.toGuest.some((m) => m.endsWith(' reliable')) && run.toHost.some((m) => m.endsWith(' reliable'));
    const ok = run.reliable && run.toGuest.length === COUNT && run.toHost.length === COUNT && expectedPath && run.hostPath === run.guestPath
      && run.signaling === signaling[0] && (mode === 'ws' || run.backend === 'webrtc');
    run.status = ok ? 'PASS' : 'FAIL';
    log(`${run.toHost.length}/${COUNT} to host, ${run.toGuest.length}/${COUNT} to guest → ${run.status}`);
  } catch (e) {
    run.status = 'FAIL';
    log(`error ${e.code ?? ''} ${e.message}`);
  } finally {
    host?.close();
    guest?.close();
    render(name);
  }
  return run;
}

// Copy-paste in one page : the guest's offer blob and the host's answer blob are shown ; the
// person (or the suite) copies each one into the other side's box and presses Paste.
function wirePaste(run, host, guest, log) {
  const sides = { guest: { room: guest, out: $('paste-offer') }, host: { room: host, out: $('paste-answer') } };
  $('paste-into-host').value = '';
  $('paste-into-guest').value = '';
  for (const side in sides) {
    const s = sides[side];
    s.out.value = '';
    s.room.on('blob', ({ blob }) => {
      s.out.value = blob;
      run.blobs[side] = blob.length;
      log(`${side} blob ready : ${blob.length} characters`);
    });
  }
  $('paste-to-host').onclick = () => host.paste($('paste-into-host').value).then(() => log('host : guest blob pasted'), (e) => log(`host : ${e.message}`));
  $('paste-to-guest').onclick = () => guest.paste($('paste-into-guest').value).then(() => log('guest : host blob pasted'), (e) => log(`guest : ${e.message}`));
}

async function run(name) {
  if (state.busy) return;
  state.busy = true;
  try { return await runOnce(name); } finally { state.busy = false; }
}

for (const name in RUNS) $(`run-${name}`).addEventListener('click', () => run(name));
state.run = run;

// ── Two devices ─────────────────────────────────────────────────────────────

const remote = { role: null, status: 'idle', joinLink: '', backend: '', backends: [], links: {}, log: [], blob: '' };
state.remote = remote;

function renderRemote() {
  $('remote-status').textContent = remote.status;
  $('join-link').value = remote.joinLink;
  $('remote-backends').textContent = remote.backends.map((b) => `${b.name} ${b.state}${b.error ? ` (${b.error})` : ''}`).join(' · ');
  $('remote-blob').value = remote.blob;
  const info = $('remote-info');
  info.replaceChildren();
  for (const id in remote.links) {
    const l = remote.links[id];
    const dt = document.createElement('dt');
    dt.textContent = `${remote.role === 'host' ? 'guest' : 'host'} ${id.slice(0, 8)}`;
    const dd = document.createElement('dd');
    dd.innerHTML = '<span class="path"></span> <span class="path"></span> ';
    const [sig, path] = dd.querySelectorAll('.path');
    sig.textContent = l.signaling;
    path.textContent = l.path;
    dd.append(`${l.backend} · received ${l.received} · sent ${l.sent}${l.closed ? ' · closed' : ''}`);
    info.append(dt, dd);
  }
  $('remote-log').textContent = remote.log.join('\n');
}

function track(l) {
  const entry = { path: l.path, backend: l.backend, signaling: l.signaling, received: 0, sent: 0, closed: false };
  remote.links[l.peerId] = entry;
  l.on('message', () => { entry.received++; renderRemote(); });
  l.on('close', () => { entry.closed = true; renderRemote(); });
  const timer = setInterval(() => {
    if (entry.closed) return clearInterval(timer);
    l.send(bytes(`tick ${entry.sent++}`));
    renderRemote();
  }, 500);
  remote.log.push(`link ${l.peerId.slice(0, 8)} over ${l.signaling} : ${l.backend}, ${l.path}`);
  renderRemote();
}

async function startRemote(role) {
  if (remote.role) return;
  remote.role = role;
  remote.status = 'connecting';
  renderRemote();
  try {
    const room = role === 'host' ? where($('sig').value.split(',').map((s) => s.trim()).filter(Boolean)) : parseRoomLink(location.hash.slice(1));
    const r = await openRoom({ link: room, role, mode: $('guest-mode').value, name: `demo-${role}` });
    state.room = r;
    const refresh = () => { remote.backend = r.backend; remote.backends = r.backends.map((b) => ({ ...b })); renderRemote(); };
    r.on('warning', (w) => { remote.log.push(`warning ${w.backend} ${w.code} : ${w.message}`); refresh(); });
    r.on('backend', (b) => { remote.log.push(`moved to ${b}`); refresh(); });
    r.on('blob', ({ blob }) => { remote.blob = blob; remote.log.push(`blob ready (${blob.length} characters) : send it to the ${role === 'host' ? 'guest' : 'host'}`); renderRemote(); });
    r.on('close', (info) => { remote.status = `signaling closed (${info.code})`; renderRemote(); });
    $('remote-paste').onclick = () => r.paste($('remote-paste-box').value).then(
      () => { remote.log.push('blob pasted'); renderRemote(); },
      (e) => { remote.log.push(`paste : ${e.message}`); renderRemote(); });
    refresh();
    if (role === 'host') {
      remote.joinLink = formatRoomLink(location.href, room);
      r.on('link', track);
      remote.status = `hosting on ${r.backends.filter((b) => b.state === 'joined').map((b) => b.name).join(', ')}`;
    } else {
      remote.status = `joining over ${r.backend}`;
      renderRemote();
      const l = await r.connect();
      track(l);
      refresh();
      remote.status = `joined over ${l.signaling}`;
    }
  } catch (e) {
    remote.status = `failed : ${e.code ?? ''} ${e.message}`;
  }
  renderRemote();
}

$('host-room').addEventListener('click', () => startRemote('host'));
$('join-room').disabled = !hash.get('room');
$('join-room').addEventListener('click', () => startRemote('guest'));
state.startRemote = startRemote;
