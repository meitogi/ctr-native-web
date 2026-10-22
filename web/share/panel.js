// The Share panel of the game page (web/index.html loads this module ; nothing else of the page
// knows about it). On the right of the 4:3 canvas ; in the CTR_ONLINE build, beside the Online
// sidebar. « Share » opens a room on the relay, streams the game to each guest that reaches this tab
// directly (WebRTC) and plugs their pads in as P2–P4.
//
// The game calls `Module.ctrShare.present()` after each present and `readPads()` once per input
// update (platform/native_renderer.c, platform/native_input.c) ; both only touch JS state.
// window.__ctrShare.state() / .stats() are for the player suites.
import { formatRoomLink, newRoom } from '../net/link.js';
import { openRoom } from '../net/room.js';
import { createCapture } from './capture.js';
import { BITRATE, createShareHost } from './host.js';
import { nameOf } from './protocol.js';
import { createSlots } from './slots.js';

const DEFAULT_RELAY = 'wss://ctr-relay.suuuper.app';
const STORE = 'ctr-share.';

const CSS = `
#share { position: fixed; top: 32px; right: 8px; width: 260px; z-index: 15; padding: 8px;
  background: #111; border: 1px solid #333; color: #ccc; font: 12px/1.4 monospace; }
#share h2 { margin: 0 0 6px; font-size: 13px; color: #eee; }
#share label { display: block; margin: 4px 0; }
#share input[type=text], #share input[type=password] { width: 100%; box-sizing: border-box; font: inherit;
  background: #000; color: #ccc; border: 1px solid #444; }
#share input[type=range] { width: 100%; }
#share button { font: inherit; background: #222; color: #ccc; border: 1px solid #444; cursor: pointer; margin: 4px 4px 0 0; }
#share button:disabled { opacity: .5; cursor: default; }
#share .error { color: #f66; white-space: pre-wrap; }
#share .status { white-space: pre-wrap; margin-top: 6px; }
#share .hint { color: #888; margin-top: 6px; }
`;

const load = (k) => { try { return localStorage.getItem(STORE + k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(STORE + k, v); } catch { /* private mode */ } };
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wall = () => performance.timeOrigin + performance.now();

const Module = globalThis.Module;
// the page's interface (web/ui) : the player name, toasts and their words ; absent = a bare page
const ui = globalThis.ctrUI ?? null;
const hostName = () => ui?.settings.get().name ?? '';
const slots = createSlots();
let capture = null;
let host = null;
let linkText = '';
let error = '';
// slot → {buttons, at} : when the game first read a new button word (input-latency probe)
const seen = [null, null, null, null];

// The game's two calls. Until « Share », no capture and no guest : both are no-ops.
Module.ctrShare = {
  present(displayW, displayH, viewportW, viewportH) {
    capture?.present(displayW, displayH, viewportW, viewportH);
  },
  readPads(heap, dst) {
    const mask = slots.read(heap, dst);
    for (let s = 1; s < 4; s++) {
      if (!(mask & (1 << s))) { seen[s] = null; continue; }
      const o = dst + (s - 1) * 8;
      const buttons = heap[o + 2] | (heap[o + 3] << 8);
      if (seen[s]?.buttons !== buttons) seen[s] = { buttons, at: wall() };
    }
    return mask;
  },
};

const query = new URLSearchParams(location.search);
document.head.append(el('style', { textContent: CSS }));
const relay = el('input', { type: 'text', id: 'share-relay', value: query.get('relay') || load('relay') || DEFAULT_RELAY });
const rk = el('input', { type: 'password', id: 'share-rk', value: query.get('rk') || load('rk') || '', autocomplete: 'off' });
const startButton = el('button', { type: 'button', id: 'share-start', textContent: 'Share' });
const stopButton = el('button', { type: 'button', id: 'share-stop', textContent: 'Stop', disabled: true });
const copyButton = el('button', { type: 'button', id: 'share-copy', textContent: 'Copy guest link', disabled: true });
const bitrate = el('input', { type: 'range', id: 'share-bitrate', min: BITRATE.min, max: BITRATE.max, step: 250_000,
  value: Number(load('bitrate')) || BITRATE.default });
const bitrateLabel = el('span');
const status = el('div', { className: 'status', id: 'share-status' });
const errorLine = el('div', { className: 'error', id: 'share-error' });
const panel = el('div', { id: 'share' },
  el('h2', {}, 'Share'),
  el('label', {}, 'Relay', relay),
  el('label', {}, 'Relay key', rk),
  startButton, stopButton, copyButton,
  el('label', {}, 'Video bitrate ', bitrateLabel, bitrate),
  status, errorLine,
  el('div', { className: 'hint' }, 'Guests open the link : they see and hear this game and play as P2–P4, no disc needed. Direct connections only.'));
// keys typed in the panel are not the game's
panel.addEventListener('keydown', (e) => e.stopPropagation());
panel.addEventListener('keyup', (e) => e.stopPropagation());
// In the page's Settings (web/ui, session 12) when it is there : the « Share » tab ; else floating.
if (!globalThis.ctrUI?.adopt('share', 'Share', panel)) document.body.append(panel);

/** Waits up to `ms` for SDL's audio output, so the guests' stream carries sound from the start. */
async function tapAudio(ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (capture.tapAudio()) return true;
  return false;
}

async function start() {
  if (host) return;
  error = '';
  startButton.disabled = true;
  save('relay', relay.value.trim());
  save('rk', rk.value.trim());
  try {
    if (!Module.canvas?.captureStream) throw new Error('this browser cannot capture a canvas');
    capture = createCapture(Module.canvas, Module, { onScale: (scale) => host?.setScale(scale) });
    if (!(await tapAudio(3000))) error = 'No game audio yet : guests get video only.';
    const link = newRoom({ relay: relay.value.trim(), rk: rk.value.trim() });
    // the guest page, without this page's query : a relay key there only travels after #
    const base = new URL('share/guest.html', location.href);
    linkText = formatRoomLink(base.href, link);
    // 'host' : the relay's signaling name, in clear — the player's name goes end to end (WELCOME)
    const room = await openRoom({ link, role: 'host', name: 'host' });
    room.on('warning', (w) => { error = `${w.code}: ${w.message}`; render(); });
    room.on('close', () => { error = 'relay: the relay closed the room'; render(); });
    host = createShareHost({ room, stream: capture.stream, maxBitrate: Number(bitrate.value), scale: capture.scale, slots, hostName: hostName() });
    host.on('change', render);
    // the host is told who comes and goes, Settings open or not
    host.on('join', (g) => ui?.toast(ui.text.joined(nameOf(g.slot, g.name), g.slot + 1)));
    host.on('leave', (g) => ui?.toast(ui.text.left(nameOf(g.slot, g.name), g.slot + 1)));
  } catch (e) {
    error = `${e.code ? `${e.code}: ` : ''}${e.message ?? e}`;
    capture?.stop();
    capture = null;
    host = null;
  }
  render();
}

function stop() {
  host?.close();
  capture?.stop();
  host = null;
  capture = null;
  linkText = '';
  render();
}

ui?.settings.subscribe((s) => { if (host && s.name !== host.hostName) host.setHostName(s.name); });

startButton.addEventListener('click', start);
stopButton.addEventListener('click', stop);
copyButton.addEventListener('click', () => navigator.clipboard?.writeText(linkText));
bitrate.addEventListener('input', () => {
  save('bitrate', bitrate.value);
  host?.setBitrate(Number(bitrate.value));
  render();
});

function guests() {
  const out = [];
  for (const peerId in host?.guests ?? {}) {
    const g = host.guests[peerId];
    out.push({ peerId, slot: g.slot, name: g.name, path: g.path, state: g.state, error: g.error ?? null });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

function render() {
  startButton.disabled = !!host;
  stopButton.disabled = !host;
  copyButton.disabled = !linkText;
  bitrateLabel.textContent = `${(Number(bitrate.value) / 1e6).toFixed(2)} Mbit/s per guest`;
  const lines = [];
  if (!host) lines.push('Not sharing.');
  else {
    lines.push(`Sharing${capture?.audio ? ' (video + sound)' : ' (video only)'}, ${capture?.frames ?? 0} frames`);
    const list = guests();
    lines.push(list.length ? list.map((g) => `P${g.slot + 1} ${nameOf(g.slot, g.name)} · ${g.path} · ${g.state}`).join('\n') : 'Waiting for guests');
    for (const r of host.refusals.slice(-2)) lines.push(`refused (${r.code}) : ${r.path}`);
  }
  status.textContent = lines.join('\n');
  errorLine.textContent = error;
  // the CTR_ONLINE build's sidebar (web/online/page.js) : beside it when open, under its round
  // toggle button when closed
  const online = document.getElementById('online');
  const open = online && !online.classList.contains('closed');
  panel.style.right = open ? `${online.offsetWidth + 8}px` : '8px';
  panel.style.top = online && !open ? '84px' : '32px';
}
setInterval(() => {
  capture?.tapAudio(); // late audio, or SDL recreated its node when the device reopened
  render();
}, 1000);
render();

/** One guest's outbound numbers : what the encoder does with the stream. */
async function senderStats(g) {
  const out = { peerId: g.link.peerId, slot: g.slot };
  const stats = await g.link.pc.getStats();
  stats.forEach((r) => {
    if (r.type === 'outbound-rtp' && r.kind === 'video') {
      Object.assign(out, { frameWidth: r.frameWidth, frameHeight: r.frameHeight, framesPerSecond: r.framesPerSecond,
        framesEncoded: r.framesEncoded, encodeMsPerFrame: r.framesEncoded ? (r.totalEncodeTime / r.framesEncoded) * 1000 : null,
        encoder: r.encoderImplementation, videoBytes: r.bytesSent, qualityLimitation: r.qualityLimitationReason, codecId: r.codecId });
    } else if (r.type === 'outbound-rtp' && r.kind === 'audio') {
      out.audioBytes = r.bytesSent;
    } else if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
      out.rttMs = r.currentRoundTripTime != null ? r.currentRoundTripTime * 1000 : null;
    }
  });
  if (out.codecId) out.codec = stats.get(out.codecId)?.mimeType;
  const p = g.senders?.video?.getParameters();
  if (p) out.params = { ...p.encodings[0], degradationPreference: p.degradationPreference };
  return out;
}

window.__ctrShare = {
  state() {
    return {
      sharing: !!host,
      link: linkText,
      maxBitrate: host?.maxBitrate ?? Number(bitrate.value),
      capture: capture && { frames: capture.frames, scale: capture.scale, display: capture.display, audio: capture.audio,
        canvas: [Module.canvas.width, Module.canvas.height] },
      guests: guests(),
      hostName: host?.hostName ?? null,
      refusals: host?.refusals ?? [],
      pads: seen.map((p, s) => (p ? { slot: s, ...p } : null)),
      error,
    };
  },
  async stats() {
    const out = [];
    for (const peerId in host?.guests ?? {}) if (host.guests[peerId].senders) out.push(await senderStats(host.guests[peerId]));
    return out;
  },
};
