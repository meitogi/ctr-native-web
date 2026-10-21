// The guest page of Share mode : the host's game as a video, our pad back. No disc, no game
// code : web/net/ for the link, guest.js for the protocol. Opened from the host's link
// (share/guest.html#room=…&key=…&relay=…&rk=…).
//
// Input : the first connected gamepad (Gamepad API, standard mapping) and the keyboard, with the
// host's key mapping (arrows, C Cross, V Circle, X Square, Z Triangle, Enter Start, Space
// Select, shifts L1 / R1, ctrls L2 / R2) ; F toggles « my view » (our part of the split screen).
// window.__ctrShareGuest.state() / .stats() / rec*() are for the player suites.
import { parseRoomLink } from '../net/link.js';
import { openRoom } from '../net/room.js';
import { createShareGuest } from './guest.js';
import { minimisePlayout } from './media.js';
import { KEYS, mergePads, padFromGamepad, padFromKeys, viewOf } from './protocol.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const overlayText = $('overlay-text');
const statusEl = $('status');
const padEl = $('pad');
const cropButton = $('crop');
const wall = () => performance.timeOrigin + performance.now();

const stream = new MediaStream();
const held = Object.create(null);
let guest = null;
let playout = null;
let crop = false;
let sound = false;
let lastButtons = 0xffff;
let lastChange = null; // {buttons, at} : when we first sent a new button word
const delays = []; // expectedDisplayTime − captureTime of the last frames (ms)

function show(text, isError = false) {
  overlayText.textContent = text;
  overlayText.className = isError ? 'error' : '';
  overlay.classList.remove('hidden');
}

function render() {
  const g = guest;
  if (!g) return;
  if (g.state === 'connected') statusEl.textContent = `P${g.slot + 1 || '?'} · ${g.path} · ${video.videoWidth}×${video.videoHeight}${sound ? '' : ' · muted'}`;
  else if (g.state === 'connecting') statusEl.textContent = 'Connecting…';
  else statusEl.textContent = g.message || g.state;
  if (g.state === 'refused' || g.state === 'closed') show(g.message || 'Disconnected.', true);
  else if (g.state === 'connected' && !sound && stream.getTracks().length) show('Click to play with sound.');
  const v = crop && g.slot ? viewOf(g.slot, g.players) : null;
  video.style.objectViewBox = v && v.w < 1 ? `inset(${v.y * 100}% ${(1 - v.x - v.w) * 100}% ${(1 - v.y - v.h) * 100}% ${v.x * 100}%)` : '';
  cropButton.textContent = `My view : ${crop ? 'on' : 'off'}`;
}

overlay.addEventListener('click', () => {
  if (guest?.state !== 'connected') return;
  sound = true;
  video.muted = false;
  video.play().catch(() => {});
  overlay.classList.add('hidden');
  render();
});
cropButton.addEventListener('click', () => { crop = !crop; render(); });

// ---- input ----
const gamepad = () => {
  for (const gp of navigator.getGamepads?.() ?? []) if (gp?.connected) return gp;
  return null;
};
function sendPad() {
  const gp = gamepad();
  const pad = mergePads(padFromKeys(held), gp ? padFromGamepad(gp) : null);
  padEl.textContent = gp ? `pad : ${gp.id.slice(0, 24)}` : 'keyboard';
  if (pad.buttons !== lastButtons) {
    lastButtons = pad.buttons;
    lastChange = { buttons: pad.buttons, at: wall() };
  }
  guest?.sendPad(pad);
}
for (const type of ['keydown', 'keyup']) {
  window.addEventListener(type, (e) => {
    if (type === 'keydown' && e.code === 'KeyF' && !e.repeat) { crop = !crop; render(); return; }
    if (!KEYS[e.code]) return;
    e.preventDefault();
    held[e.code] = type === 'keydown';
    sendPad();
  }, { capture: true });
}
window.addEventListener('blur', () => { for (const k in held) held[k] = false; sendPad(); });
// ~60 pads a second while the tab is in front (latest wins on the host) ; a hidden tab's rAF
// stops, the timer keeps the host from timing our pad out
(function loop() { sendPad(); requestAnimationFrame(loop); })();
setInterval(() => { if (document.hidden) sendPad(); }, 200);

// ---- latency probe : capture → display, from the frames' own timestamps ----
function frameLoop(_, meta) {
  if (meta.captureTime) {
    delays.push(meta.expectedDisplayTime - meta.captureTime);
    if (delays.length > 120) delays.shift();
  }
  video.requestVideoFrameCallback(frameLoop);
}
if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(frameLoop);

// ---- the room ----
async function main() {
  let link;
  try {
    link = parseRoomLink(location.hash);
  } catch {
    show('This page needs the Share link from the host (…/share/guest.html#room=…).', true);
    return;
  }
  // ?mode=ws : forces the relay's WebSocket path — a test knob, to see the Online-mode refusal
  const mode = new URLSearchParams(location.search).get('mode') === 'ws' ? 'ws' : 'auto';
  const room = await openRoom({ link, role: 'guest', mode, name: 'guest' }).catch((e) => {
    show(`${e.code ?? 'error'} : ${e.message}`, true);
    return null;
  });
  if (!room) return;
  guest = createShareGuest(room, {
    onTrack(e) {
      stream.addTrack(e.track);
      playout = minimisePlayout(e.receiver) ?? playout;
      if (video.srcObject !== stream) video.srcObject = stream;
      render();
    },
  });
  guest.on('change', render);
  await guest.connect();
  render();
}
video.addEventListener('resize', render);
setInterval(render, 1000);
main();

// ---- for the suites ----
let rec = null;
const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
};
window.__ctrShareGuest = {
  state() {
    return {
      state: guest?.state ?? 'idle', slot: guest?.slot ?? 0, players: guest?.players ?? 0, path: guest?.path ?? null,
      code: guest?.code ?? null, message: guest?.message ?? '', tracks: stream.getTracks().map((t) => t.kind),
      video: [video.videoWidth, video.videoHeight], playing: !video.paused, muted: video.muted, playout, crop,
      lastChange, displayDelayMs: median(delays), delaySamples: delays.length,
    };
  },
  /** The receiver side : frames, jitter buffer, decode, audio energy, round trip. */
  async stats() {
    const pc = guest?.link?.pc;
    if (!pc) return null;
    const out = {};
    (await pc.getStats()).forEach((r) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        Object.assign(out, { frameWidth: r.frameWidth, frameHeight: r.frameHeight, framesPerSecond: r.framesPerSecond,
          framesDecoded: r.framesDecoded, framesDropped: r.framesDropped, decoder: r.decoderImplementation,
          jitterBufferMs: r.jitterBufferEmittedCount ? (r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000 : null,
          decodeMsPerFrame: r.framesDecoded ? (r.totalDecodeTime / r.framesDecoded) * 1000 : null, videoBytes: r.bytesReceived });
      } else if (r.type === 'inbound-rtp' && r.kind === 'audio') {
        Object.assign(out, { audioBytes: r.bytesReceived, audioEnergy: r.totalAudioEnergy, audioLevel: r.audioLevel,
          audioJitterBufferMs: r.jitterBufferEmittedCount ? (r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000 : null });
      } else if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
        out.rttMs = r.currentRoundTripTime != null ? r.currentRoundTripTime * 1000 : null;
      }
    });
    const [receiver] = pc.getReceivers().filter((r) => r.track?.kind === 'video');
    if (receiver) out.jitterBufferTarget = receiver.jitterBufferTarget ?? null;
    return out;
  },
  /** The frame on screen now : a PNG (base64) and a 32 × 24 grey thumbnail to diff frames with. */
  grab() {
    const [w, h] = [video.videoWidth, video.videoHeight];
    if (!w || !h) return null;
    const c = new OffscreenCanvas(w, h);
    const g2d = c.getContext('2d');
    g2d.drawImage(video, 0, 0);
    const t = new OffscreenCanvas(32, 24).getContext('2d', { willReadFrequently: true });
    t.drawImage(c, 0, 0, 32, 24);
    const px = t.getImageData(0, 0, 32, 24).data;
    const grey = [];
    for (let i = 0; i < px.length; i += 4) grey.push(Math.round((px[i] + px[i + 1] + px[i + 2]) / 3));
    return c.convertToBlob({ type: 'image/png' }).then(async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { width: w, height: h, png: btoa(bin), grey };
    });
  },
  /** Records what this guest receives (video + sound, as received), pulled in base64 pieces. */
  recStart() {
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    rec = { mr, chunks: [], stopped: new Promise((r) => { mr.onstop = r; }) };
    mr.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
    mr.start(500);
    return mimeType;
  },
  async recDrain() {
    if (!rec) return '';
    const blob = new Blob(rec.chunks.splice(0));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  async recStop() {
    if (!rec) return '';
    rec.mr.stop();
    await rec.stopped;
    const rest = await window.__ctrShareGuest.recDrain();
    rec = null;
    return rest;
  },
};
