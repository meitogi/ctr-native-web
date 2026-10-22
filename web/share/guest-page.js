// The guest page of Share mode : the host's game as a video, our pad back. No disc, no game
// code : web/net/ for the link, guest.js for the protocol. Opened from the host's link
// (share/guest.html#room=…&key=…&relay=…&rk=…).
//
// The page's interface is the site's (web/ui src/guest.js, loaded first : globalThis.ctrUI) — the
// speaker and its volume drive the <video>, Settings holds the player name (sent to the host),
// « Who plays » and the Controls mapping (read here for every pad sent), the screens show the
// connection. Without it (ui/ not built) the page still plays, with the defaults and one line of
// text. F toggles « my view » (our part of the split screen).
// window.__ctrShareGuest.state() / .stats() / rec*() are for the player suites.
import { parseRoomLink } from '../net/link.js';
import { openRoom } from '../net/room.js';
import { createShareGuest } from './guest.js';
import { minimisePlayout } from './media.js';
import { pickPad, viewOf } from './protocol.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const ui = globalThis.ctrUI ?? null;
const wall = () => performance.timeOrigin + performance.now();

const stream = new MediaStream();
const held = Object.create(null);
let guest = null;
let playout = null;
let crop = false;
let sound = false;
let nolink = false;
let lastButtons = 0xffff;
let lastChange = null; // {buttons, at} : when we first sent a new button word
const delays = []; // expectedDisplayTime − captureTime of the last frames (ms)
const settings = () => ui?.settings.get() ?? null;

// ---- the interface : our state in, its buttons out ----
let fallback = null;
function render() {
  const g = guest;
  const v = crop && g?.slot ? viewOf(g.slot, g.players) : null;
  video.style.objectViewBox = v && v.w < 1 ? `inset(${v.y * 100}% ${(1 - v.x - v.w) * 100}% ${(1 - v.y - v.h) * 100}% ${v.x * 100}%)` : '';
  const state = nolink ? 'nolink' : g?.state ?? 'connecting';
  const fields = { state, code: g?.code ?? null, message: g?.message ?? '', slot: g?.slot ?? 0, players: g?.players ?? 0, list: g?.list ?? [],
    host: g?.host ?? null, path: g?.path ?? null, stream: stream.getTracks().length > 0, sound, crop };
  if (ui) return ui.guest.set(fields);
  // no interface : a line of text, a click anywhere for sound
  fallback ??= document.body.appendChild(Object.assign(document.createElement('p'), { id: 'fallback' }));
  fallback.textContent = state === 'connected'
    ? `P${fields.slot + 1} · ${fields.path} · ${video.videoWidth}×${video.videoHeight}${sound ? '' : ' · click for sound'}`
    : fields.message || state;
}
function unlock() {
  if (guest?.state !== 'connected') return;
  sound = true;
  applySound();
  video.play().catch(() => {});
  render();
}
function toggleCrop() { crop = !crop; render(); }
ui?.guest.bind({ unlock, crop: toggleCrop });
if (!ui) document.addEventListener('click', unlock);

// the speaker / volume of the site (settings) : the <video> plays muted until a click
function applySound() {
  const s = settings();
  video.muted = !sound || !!s?.muted;
  video.volume = s ? Math.min(1, Math.max(0, s.volume)) : 1;
}
ui?.settings.subscribe((s) => {
  applySound();
  guest?.setName(s.name);
});

// ---- input ----
function sendPad() {
  const s = settings();
  const pad = ui?.guest.blocked() ? null : pickPad(s?.device, held, navigator.getGamepads?.() ?? [], ui?.guestInput());
  const word = pad ? pad.buttons : 0xffff;
  if (word !== lastButtons) {
    lastButtons = word;
    lastChange = { buttons: word, at: wall() };
  }
  if (pad) guest?.sendPad(pad);
  else guest?.sendPad({ id: 0x41, buttons: 0xffff, analog: [0x80, 0x80, 0x80, 0x80] });
}
const typing = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT' || a.tagName === 'SELECT' || !!a.closest?.('#ctr-settings'));
};
for (const type of ['keydown', 'keyup']) {
  window.addEventListener(type, (e) => {
    if (type === 'keydown' && typing()) return;
    if (type === 'keydown' && e.code === 'KeyF' && !e.repeat) { toggleCrop(); return; }
    const keys = ui?.guestInput().keys;
    const mine = keys ? keys[e.code] : true;
    held[e.code] = type === 'keydown';
    if (mine && e.code !== 'Escape') e.preventDefault();
    sendPad();
  });
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
    nolink = true;
    render();
    return;
  }
  // ?mode=ws : forces the relay's WebSocket path — a test knob, to see the Online-mode refusal
  const mode = new URLSearchParams(location.search).get('mode') === 'ws' ? 'ws' : 'auto';
  // 'guest' : the relay's signaling name, in clear — never the player's name (that one goes end
  // to end in Share's HELLO)
  const room = await openRoom({ link, role: 'guest', mode, name: 'guest' }).catch((e) => {
    guest = { state: 'closed', code: e.code ?? 'error', message: `${e.code ?? 'error'} : ${e.message}` };
    render();
    return null;
  });
  if (!room) return;
  guest = createShareGuest(room, {
    name: settings()?.name ?? '',
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
applySound();
render();
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
      name: guest?.name ?? null, host: guest?.host ?? null, list: guest?.list ?? [], volume: video.volume, ui: !!ui,
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
