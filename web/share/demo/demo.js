// Share without the game : the same capture, host and pad path as web/share/panel.js, on a
// canvas the page draws itself. The frame shows a counter and each remote slot's pad word, so a
// guest sees its own key presses come back through the stream, and the wall clock as blocks (see
// STAMP in plans/ctr-native-web/suites/stream-share.mjs). window.__shareDemo for checks.
import { formatRoomLink, newRoom } from '../../net/link.js';
import { openRoom } from '../../net/room.js';
import { createCapture } from '../capture.js';
import { createShareHost } from '../host.js';
import { createSlots } from '../slots.js';

const $ = (id) => document.getElementById(id);
const hash = new URLSearchParams(location.hash.slice(1));
$('relay').value = hash.get('relay') || 'ws://localhost:8787';
$('rk').value = hash.get('rk') || '';

const canvas = $('canvas');
const g2d = canvas.getContext('2d');
const slots = createSlots();
const heap = new Uint8Array(24);
const state = { frames: 0, mask: 0, pads: [null, null, null, null], link: '', host: null };
window.__shareDemo = state;

// SDL3's audio graph, as the game builds it : Module.SDL3.audioContext and a playback
// ScriptProcessorNode connected to the destination (here, a quiet 440 Hz tone).
const Module = { canvas, SDL3: null };
function startAudio() {
  const ctx = new AudioContext();
  const node = ctx.createScriptProcessor(2048, 0, 2);
  let phase = 0;
  node.onaudioprocess = (e) => {
    const l = e.outputBuffer.getChannelData(0);
    const r = e.outputBuffer.getChannelData(1);
    for (let i = 0; i < l.length; i++, phase += (2 * Math.PI * 440) / ctx.sampleRate) l[i] = r[i] = 0.1 * Math.sin(phase);
  };
  node.connect(ctx.destination);
  Module.SDL3 = { audioContext: ctx, audio_playback: { scriptProcessorNode: node } };
}

let capture = null;
function frame() {
  state.frames++;
  state.mask = slots.read(heap, 0);
  g2d.fillStyle = `hsl(${(state.frames * 3) % 360} 60% 25%)`;
  g2d.fillRect(0, 0, canvas.width, canvas.height);
  g2d.fillStyle = '#fff';
  g2d.font = '48px monospace';
  g2d.fillText(`frame ${state.frames}`, 40, 80);
  for (let s = 1; s < 4; s++) {
    const on = state.mask & (1 << s);
    state.pads[s] = on ? heap[(s - 1) * 8 + 2] | (heap[(s - 1) * 8 + 3] << 8) : null;
    g2d.fillText(`P${s + 1} ${on ? `0x${state.pads[s].toString(16).padStart(4, '0')}` : '—'}`, 40, 160 + s * 70);
  }
  // a square that moves with P2's d-pad, to see a press come back through the stream
  const p2 = state.pads[1] ?? 0xffff;
  state.x = Math.max(0, Math.min(700, (state.x ?? 600) + (!(p2 & 0x80) ? -8 : 0) + (!(p2 & 0x20) ? 8 : 0)));
  g2d.fillRect(state.x, 480, 60, 60);
  // the wall clock (ms, low 20 bits) as 20 black / white blocks along the bottom edge : a
  // guest on the same machine reads it back off the video for a capture-to-display time
  const stamp = Date.now() & 0xfffff;
  for (let b = 0; b < 20; b++) {
    g2d.fillStyle = stamp & (1 << b) ? '#fff' : '#000';
    g2d.fillRect(b * 40, 560, 40, 40);
  }
  capture?.present(512, 240, canvas.width, canvas.height);
}
setInterval(frame, 1000 / 30);

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  startAudio();
  capture = createCapture(canvas, Module);
  capture.tapAudio();
  const link = newRoom({ relay: $('relay').value.trim(), rk: $('rk').value.trim() });
  state.link = formatRoomLink(new URL('../guest.html', location.href).href, link);
  $('link').textContent = $('link').href = state.link;
  const room = await openRoom({ link, role: 'host' });
  state.host = createShareHost({ room, stream: capture.stream, scale: capture.scale, slots });
  state.host.on('change', (guests) => {
    $('status').textContent = Object.values(guests).map((g) => `P${g.slot + 1} ${g.path} ${g.state}`).join('\n')
      + state.host.refusals.map((r) => `\nrefused (${r.code}) ${r.path}`).join('');
  });
});
