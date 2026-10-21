// The Online panel of the CTR_ONLINE web build, on the right of the 4:3 game canvas.
// Loaded by the game itself (web/online/library.js, from a constructor before main()), so
// index.html stays the same for both builds.
//
// The room comes before the game needs it : the panel hosts a new room or joins the one in
// the page's link (`#room=…`, web/net/link.js), and the game's « Private Room » entry
// connects to it. The player name is read when the game connects.
//
// Debug getter : `window.__ctrOnline.state()` — octr as the bridge sees it, the room and its
// links ; tests read it instead of pixels (never `window.__ctr`, which is T3's).
import { formatRoomLink, newRoom, parseRoomLink } from '../net/link.js';
import { openRoom } from '../net/room.js';
import { createOnlineNet } from './net.js';

const DEFAULT_RELAY = 'wss://ctr-relay.suuuper.app';
const NAME_LEN = 9; // game/OnlineCTR/global.h

// game/OnlineCTR/global.h enum ClientState
const STATES = ['LAUNCH_ENTER_PID', 'LAUNCH_PICK_SERVER', 'LAUNCH_PICK_ROOM', 'LAUNCH_ERROR', 'LOBBY_ASSIGN_ROLE',
  'LOBBY_HOST_TRACK_PICK', 'LOBBY_GUEST_TRACK_WAIT', 'LOBBY_CHARACTER_PICK', 'LOBBY_WAIT_FOR_LOADING',
  'LOBBY_START_LOADING', 'GAME_WAIT_FOR_RACE', 'GAME_START_RACE', 'GAME_END_RACE'];

const CSS = `
#online { position: fixed; top: 32px; right: 8px; width: 260px; z-index: 15; padding: 8px;
  background: #111; border: 1px solid #333; color: #ccc; font: 12px/1.5 monospace; }
#online h2 { font-size: 13px; margin: 0 0 6px; color: #eee; }
#online label { display: block; margin: 4px 0; }
#online input[type=text], #online input[type=password] { width: 100%; box-sizing: border-box; font: inherit;
  background: #000; color: #ddd; border: 1px solid #444; padding: 2px 4px; }
#online button { font: inherit; background: #222; color: #ccc; border: 1px solid #444; cursor: pointer; margin: 4px 4px 0 0; }
#online .row { display: flex; gap: 4px; align-items: center; }
#online .row input { flex: 1; }
#online .hint { color: #888; margin-top: 6px; }
#online .error { color: #f66; white-space: pre-wrap; }
#online ul { margin: 2px 0; padding-left: 16px; }
#online details { margin-top: 6px; }
`;

const load = (key, fallback = '') => {
  try { return localStorage.getItem(`ctr-online.${key}`) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(`ctr-online.${key}`, value); } catch { /* private mode : not remembered */ }
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** @param {object} Module - the game's Emscripten module */
export function attach(Module) {
  const query = new URLSearchParams(location.search);
  const net = createOnlineNet({ name: load('name', 'Player') });
  Module.ctrOnlineNet = net;

  let link = null; // the parsed room link, once there is a room
  let linkText = '';
  let error = '';

  document.head.append(el('style', { textContent: CSS }));
  const panel = el('div', { id: 'online' });
  document.body.append(panel);

  // ---- name ----
  const name = el('input', { type: 'text', maxLength: NAME_LEN, value: net.name, id: 'online-name', autocomplete: 'off' });
  name.addEventListener('input', () => { net.name = name.value || 'Player'; save('name', name.value); });
  // keys typed in the panel are not the game's
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  panel.addEventListener('keyup', (e) => e.stopPropagation());

  // ---- host ----
  const relay = el('input', { type: 'text', id: 'online-relay', value: query.get('relay') ?? load('relay', DEFAULT_RELAY) });
  const rk = el('input', { type: 'password', id: 'online-rk', value: query.get('rk') ?? load('rk'), autocomplete: 'off' });
  const hostButton = el('button', { type: 'button', id: 'online-host', textContent: 'Host a room' });
  const hostBox = el('div', {},
    el('label', {}, 'Relay', relay),
    el('label', {}, 'Relay key', rk),
    hostButton);

  // ---- join ----
  const joinInput = el('input', { type: 'text', id: 'online-join-link', placeholder: 'paste a room link' });
  const joinButton = el('button', { type: 'button', id: 'online-join', textContent: 'Join' });
  const forceWs = el('input', { type: 'checkbox', id: 'online-force-ws', checked: load('forceWs') === '1' });
  const joinBox = el('div', {},
    el('div', { className: 'row' }, joinInput, joinButton),
    el('label', {}, forceWs, ' Force relay (WebSocket)'));

  // ---- room ----
  const roomLine = el('div', { id: 'online-room' });
  const copyButton = el('button', { type: 'button', id: 'online-copy', textContent: 'Copy link' });
  const status = el('div', { id: 'online-status' });
  const errorLine = el('div', { className: 'error', id: 'online-error' });

  panel.append(
    el('h2', {}, 'Online'),
    el('label', {}, 'Name', name),
    el('details', { open: !location.hash.includes('room=') }, el('summary', {}, 'Host'), hostBox),
    el('details', { open: true }, el('summary', {}, 'Join'), joinBox),
    roomLine, copyButton, status, errorLine,
    el('div', { className: 'hint' }, 'In the game: Private Room, then the same room number as the host.'));
  copyButton.style.display = 'none';

  const fail = (e) => { error = `${e.code ? `${e.code}: ` : ''}${e.message ?? e}`; render(); };

  async function host() {
    if (net.room) return;
    error = '';
    save('relay', relay.value);
    save('rk', rk.value);
    try {
      link = newRoom({ relay: relay.value.trim(), rk: rk.value.trim() });
      // the relay key may have come in the query : it only travels after # (ROLLOUT, private relays)
      const base = new URL(location.href);
      base.searchParams.delete('relay');
      base.searchParams.delete('rk');
      linkText = formatRoomLink(base.href, link);
      const room = await openRoom({ link, role: 'host', name: net.name });
      room.on('link', render);
      room.on('linkclose', render);
      room.on('warning', (w) => fail(w));
      room.on('close', () => fail({ code: 'relay', message: 'the relay closed the room' }));
      net.host(room);
    } catch (e) {
      link = null;
      fail(e);
    }
    render();
  }

  // A guest's room : opened at once from the page's link ; reopened when the mode changes
  // before the game connected.
  async function guest() {
    error = '';
    try {
      link = parseRoomLink(location.hash);
      linkText = location.href;
      net.room?.close();
      const room = await openRoom({ link, role: 'guest', mode: forceWs.checked ? 'ws' : 'auto', name: net.name, rtcTimeoutMs: 5000 });
      room.on('link', render);
      room.on('linkclose', render);
      room.on('warning', (w) => { if (w.code !== 'no-webrtc') fail(w); });
      net.guest(room);
    } catch (e) {
      fail(e);
    }
    render();
  }

  hostButton.addEventListener('click', host);
  joinButton.addEventListener('click', () => {
    const text = joinInput.value.trim();
    if (!text.includes('#')) return fail({ code: 'link', message: 'a room link has a # part' });
    try { parseRoomLink(text); } catch (e) { return fail(e); }
    location.hash = text.slice(text.indexOf('#') + 1);
    location.reload();
  });
  forceWs.addEventListener('change', () => {
    save('forceWs', forceWs.checked ? '1' : '');
    if (net.role === 'guest' && !net.hostLink && !net.pending) guest();
    render();
  });
  copyButton.addEventListener('click', () => navigator.clipboard?.writeText(linkText));

  function links() {
    if (net.role === 'host') {
      const out = [];
      for (const peer in net.links) {
        const l = net.links[peer];
        out.push({ peer: Number(peer), peerId: l.peerId, path: l.path, backend: l.backend, signaling: l.signaling });
      }
      return out;
    }
    const l = net.hostLink;
    return l ? [{ peer: -1, peerId: l.peerId, path: l.path, backend: l.backend, signaling: l.signaling }] : [];
  }

  function render() {
    const room = net.room;
    hostButton.disabled = !!room;
    roomLine.textContent = room ? `${net.role === 'host' ? 'Hosting' : 'Guest of'} room ${link?.room ?? ''}` : 'No room yet.';
    copyButton.style.display = room && net.role === 'host' ? '' : 'none';
    const list = links();
    const octr = Module.ctrOnlineOctr?.();
    const lines = [];
    if (net.role === 'host') lines.push(list.length ? `Guests: ${list.map((l) => `${l.peer} ${l.path}`).join(', ')}` : 'Waiting for guests');
    if (net.role === 'guest') lines.push(net.hostLink ? `Path to host: ${net.hostLink.path}` : net.pending ? 'Connecting…' : 'Not connected');
    if (octr) lines.push(`Game: ${STATES[octr.CurrState] ?? octr.CurrState}${octr.NumDrivers ? `, ${octr.NumDrivers} driver(s)` : ''}`);
    status.textContent = lines.join('\n');
    status.style.whiteSpace = 'pre-wrap';
    errorLine.textContent = error || (net.lastError ? `${net.lastError.code ?? 'error'}: ${net.lastError.message}` : '');
  }
  setInterval(render, 500);

  window.__ctrOnline = {
    state() {
      return {
        role: net.role,
        room: link?.room ?? null,
        link: linkText,
        backend: net.room?.backend ?? null,
        links: links(),
        queue: net.queue.length,
        lastError: net.lastError ? { code: net.lastError.code, message: net.lastError.message } : null,
        error,
        octr: Module.ctrOnlineOctr?.() ?? null,
        karts: Module.ctrOnlineKarts?.() ?? null,
      };
    },
    host,
  };

  if (location.hash.includes('room=')) guest();
  render();
}
