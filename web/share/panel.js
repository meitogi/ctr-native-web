// The Share panel of the game page (web/index.html loads this module ; nothing else of the page
// knows about it) ; the player reads « Couch ». On the right of the 4:3 canvas ; in the CTR_ONLINE
// build, beside the Online sidebar. Sharing opens a room on the relay, streams the game to each
// guest that reaches this tab directly (WebRTC) and plugs their pads in as P2–P4.
//
// In the Netplay build the game starts and stops it (Select on the character select :
// `Module.ctrInput.couchStart`, web/online/page.js), on the relay and key of Settings › Netplay ;
// the panel then shows the room and has no start button. A build without Netplay keeps its own
// fields and buttons.
//
// The game calls `Module.ctrShare.present()` after each present and `readPads()` once per input
// update (platform/native_renderer.c, platform/native_input.c) ; both only touch JS state.
// `localJoin()` / `localLeave()` seat a player of the host's own machine in P2–P4 (slots.js).
// window.__ctrShare.state() / .stats() are for the player suites.
//
// The room has a code (session 28b), as a Netplay room's : a few of the game's characters, said
// aloud, typed on the home page by a guest with no disc. A guest who came by code knocks and the
// host answers in its game ; the link carries a pass and goes straight in (web/net/admit.js). The
// page says the code once, in a toast ; the game shows it after that (`door()`, read by
// web/online/page.js for the game's hooks). A build without Netplay has no such screens in its
// game : its room has no code, and the link alone joins.
//
// An Online room (web/online/page.js, session 14) shares its lobby the same way, on its own room :
// `globalThis.ctrShareApi.startOn(room)` / `stopOn()`. While that room's race runs (the game's
// lobby phase, Module.ctrOnlineLobby), no frame is captured, the audio track is muted and the
// guests' pads are not read : the race's pads come from OnlineCTR.
import { gateHost } from '../net/admit.js';
import { CODE_MAX, CODE_MIN, ROOM_KIND, codeNames, codeRoom, openFreeRoom, parseCode, randomCode } from '../net/code.js';
import { formatRoomLink, newRoom } from '../net/link.js';
import { openRoom, peersOf } from '../net/room.js';
import { DEFAULT_RELAY, DEFAULT_RELAY_KEY, keptRelay, relayWord } from '../net/relay-default.js';
import { createCapture } from './capture.js';
import { BITRATE, createShareHost } from './host.js';
import { nameOf } from './protocol.js';
import { FIRST_SLOT, LOCAL, SLOT_COUNT, createSlots, isLocal } from './slots.js';

const STORE = 'ctr-share.';

const CSS = `
#share { position: fixed; top: 32px; right: 8px; width: 260px; z-index: 15; padding: 8px;
  background: #111; border: 1px solid #333; color: #ccc; font: 12px/1.4 monospace; }
#share h2 { margin: 0 0 6px; font-size: 13px; color: #eee; }
#share label { display: block; margin: 4px 0; }
#share [hidden] { display: none; }
#share input[type=text], #share input[type=password] { width: 100%; box-sizing: border-box; font: inherit;
  background: #000; color: #ccc; border: 1px solid #444; }
#share input[type=range] { width: 100%; }
#share button { font: inherit; background: #222; color: #ccc; border: 1px solid #444; cursor: pointer; margin: 4px 4px 0 0; }
#share button:disabled { opacity: .5; cursor: default; }
#share .error { color: #f66; white-space: pre-wrap; }
#share .status { white-space: pre-wrap; margin-top: 6px; }
#share .hint { color: #888; margin-top: 6px; }
#share .word.public { color: #6c6; }
#share .word.yours { color: #fb4; }
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
let gate = null; // the room's door, while the panel's own Share is on
let code = ''; // its code (one hex digit per character), '' with none
let closedBy = ''; // the relay's close that ended the panel's own room ('room-alone'…), '' : none since the last start
// What the relay said, in words (its close codes : web/net/signaling.js)
const NO_ANSWER = 'The relay does not answer.';
const NO_ONE_CAME = 'Room closed : no one came. Couch opens a new one.';
const RELAY_SAYS = {
  relay: NO_ANSWER,
  'relay-silent': NO_ANSWER,
  'relay-key': 'This relay asks for a key, or refused this one.',
  'relay-full': 'The relay is full. Try again later, or set your own relay.',
  'relay-address': 'Too many players from your network are on this relay. Try again later, or set your own relay.',
  'room-alone': NO_ONE_CAME,
  'relay-idle': NO_ONE_CAME,
  'room-life': 'Room closed : its time on the relay is up. Couch opens a new one.',
};
const RELAY_CLOSED = { 'room-alone': true, 'relay-idle': true, 'room-life': true };
// the characters of a new room's code : the site's setting, shared with Netplay
let codeLength = CODE_MIN;
fetch(new URL('../online/config.json', import.meta.url)).then((r) => r.json()).then((config) => {
  const n = Number(config?.codeLength);
  if (Number.isInteger(n)) codeLength = Math.min(CODE_MAX, Math.max(CODE_MIN, n));
}).catch(() => { /* no file (a build without Netplay) : the shortest code */ });
// slot → {buttons, at} : when the game first read a new button word (input-latency probe)
const seen = [null, null, null, null];
const gone = []; // the slots a closed gap freed, for the game : one per readPads()
let starting = null; // start() on its way
let noDirect = null; // {name, until} : the last guest refused for want of a direct connection
let lastRefusal = null;

let owner = 'share'; // who started the host : 'share' (the panel) or 'online' (the Online room)
/** An Online room's race runs : the lobby's capture and pads pause (phase 1 = the menus). */
const racing = () => {
  const lobby = Module.ctrOnlineLobby?.();
  return !!lobby?.active && lobby.phase !== 1;
};
let audioOn = true;

/** The seats P2–P4 as a run with no hole : the slots freed (the holes, highest first). */
function closeGaps() {
  if (host) return host.compactHoles(); // each moved guest is told its new slot
  const holes = [];
  let top = 0;
  for (let s = FIRST_SLOT; s < SLOT_COUNT; s++) if (slots.get(s)) top = s;
  for (let s = top - 1; s >= FIRST_SLOT; s--) if (!slots.get(s)) holes.push(s);
  if (holes.length) slots.compact();
  return holes;
}

// The game's calls. Until sharing starts, no capture and no guest : only local seats are read.
Module.ctrShare = {
  present(displayW, displayH, viewportW, viewportH) {
    const paused = racing();
    // a guest out of the race watches it (32f) : the picture goes on, the sound stays off
    if (!paused || host?.watched()) capture?.present(displayW, displayH, viewportW, viewportH);
    if (capture && audioOn === paused) {
      audioOn = !paused;
      for (const t of capture.stream.getAudioTracks()) t.enabled = audioOn;
    }
    host?.frame(); // a bot guest's own kart (debug builds : window.__ctr)
  },
  /**
   * `menus` : the game is on its menus, where a seat left free is closed (an Online room closes
   * its own). Returns the mask of held slots, and in bits 8+ one slot a closed gap freed (0 = none).
   */
  readPads(heap, dst, menus) {
    if (racing()) return 0;
    // a Netplay room is one player per browser : its seats are its guests', none a local device's
    if (Module.ctrOnlineLobby?.()?.active) {
      for (let s = 1; s < 4; s++) if (isLocal(slots.get(s)?.peerId)) slots.release(slots.get(s).peerId);
    }
    if (menus && owner !== 'online') gone.push(...closeGaps());
    const mask = slots.read(heap, dst);
    for (let s = 1; s < 4; s++) {
      const o = dst + (s - 1) * 8;
      // a local seat's packet is a marker, not a pad
      if (!(mask & (1 << s)) || heap[o] === 0xff) { seen[s] = null; continue; }
      const buttons = heap[o + 2] | (heap[o + 3] << 8);
      if (seen[s]?.buttons !== buttons) seen[s] = { buttons, at: wall() };
    }
    return mask | ((gone.shift() ?? 0) << 8);
  },
  /** A player of this machine takes a seat : its slot (1–3), or 0 when all three are taken. */
  localJoin: (id) => slots.take(LOCAL + id),
  /** …and leaves it : the slot, or 0. The next readPads() on the menus closes the gap. */
  localLeave: (id) => slots.release(LOCAL + id),
};

const query = new URLSearchParams(location.search);
document.head.append(el('style', { textContent: CSS }));
const rk = el('input', { type: 'password', id: 'share-rk', value: query.get('rk') || load('rk') || DEFAULT_RELAY_KEY, autocomplete: 'off' });
const relay = el('input', { type: 'text', id: 'share-relay', value: query.get('relay') || keptRelay(load('relay') || '', rk.value) });
// which relay that is, in a word : « public » (the page's own, no key), « yours »
const relayWordOut = el('span', { id: 'share-relay-word' });
const usePublic = el('button', { type: 'button', id: 'share-relay-public', textContent: 'Use the public relay' });
const startButton = el('button', { type: 'button', id: 'share-start', textContent: 'Couch' });
const stopButton = el('button', { type: 'button', id: 'share-stop', textContent: 'Stop', disabled: true });
const copyButton = el('button', { type: 'button', id: 'share-copy', textContent: 'Copy guest link', disabled: true });
const bitrate = el('input', { type: 'range', id: 'share-bitrate', min: BITRATE.min, max: BITRATE.max, step: 250_000,
  value: Number(load('bitrate')) || BITRATE.default });
const bitrateLabel = el('span');
const status = el('div', { className: 'status', id: 'share-status' });
const errorLine = el('div', { className: 'error', id: 'share-error' });
// the Netplay build : the room's code, read only (its characters' names)
const codeLine = el('span', { id: 'share-code' });
const codeRow = el('label', {}, 'Room code ', codeLine);
const hint = el('div', { className: 'hint' });
const HINT = 'Guests open the link : they see and hear this game and play as P2–P4, no disc needed. Direct connections only.';
const HINT_IN_GAME = 'Started and stopped in the game : Select on the character select. Guests need no disc ; your screen is streamed to them, so they may see some delay. Direct connections only.';
const panel = el('div', { id: 'share' },
  el('h2', {}, 'Couch'),
  codeRow,
  el('label', {}, 'Relay ', relayWordOut, relay),
  usePublic,
  el('label', {}, 'Relay key (a private relay only)', rk),
  startButton, stopButton, copyButton,
  el('label', {}, 'Video bitrate ', bitrateLabel, bitrate),
  status, errorLine,
  hint);
// keys typed in the panel are not the game's
panel.addEventListener('keydown', (e) => e.stopPropagation());
panel.addEventListener('keyup', (e) => e.stopPropagation());
// In the page's Settings (web/ui, session 12) when it is there : the « Couch » tab ; else floating.
if (!globalThis.ctrUI?.adopt('share', 'Couch', panel)) document.body.append(panel);

// The Netplay build (web/online/page.js set its hooks, maybe after this module ran) : the game
// starts Couch, on the relay and key of Settings › Netplay. Asked at each render.
const inGame = () => typeof Module.ctrInput?.couchStart === 'function';
// one relay, one key : these two fields are the Netplay tab's, which saves and checks them
const mirrored = [[relay, 'online-relay'], [rk, 'online-rk']];
for (const [field, id] of mirrored) {
  for (const type of ['input', 'focusout']) {
    field.addEventListener(type, () => {
      const theirs = inGame() && document.getElementById(id);
      if (!theirs) return;
      theirs.value = field.value;
      theirs.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }
}

/** Waits up to `ms` for the game's audio output, so the guests' stream carries sound from the start. */
async function tapAudio(ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (capture.tapAudio()) return true;
  return false;
}

/** Shares this game on `room` (open, role host). `relayGuests` : guests on the relay keep their pad. */
async function startOn(room, { relayGuests = false, by = 'share' } = {}) {
  if (host) return host;
  owner = by;
  if (!Module.canvas?.captureStream) throw new Error('this browser cannot capture a canvas');
  capture = createCapture(Module.canvas, globalThis.ctrAudio, { onScale: (scale) => host?.setScale(scale) });
  audioOn = true;
  if (!(await tapAudio(3000))) error = 'No game audio yet : guests get video only.';
  room.on('warning', (w) => { error = `${w.code}: ${w.message}`; render(); });
  room.on('close', (info) => {
    if (!host) return; // stopped here : not the relay's doing
    const why = info?.code;
    error = RELAY_CLOSED[why] ? RELAY_SAYS[why] : 'The relay closed the room.';
    // the panel's own room, ended by the relay's limits : Couch is off, and says why (the game's box
    // reads closedBy ; a Netplay room is its own module's to leave)
    if (by === 'share' && RELAY_CLOSED[why]) {
      stopOn();
      closedBy = why;
      ui?.toast('Room closed', error, '', { ms: 15_000 });
    }
    render();
  });
  host = createShareHost({ room, stream: capture.stream, maxBitrate: Number(bitrate.value), scale: capture.scale, slots, hostName: hostName(),
    game: () => globalThis.__ctr ?? null, relayGuests, compact: by === 'online', compactNow: () => !racing() });
  host.on('change', () => {
    const r = host?.refusals.at(-1);
    if (r && r !== lastRefusal) {
      lastRefusal = r;
      if (r.code === 'online-mode' && by === 'share') noDirect = { name: host.guests[r.peerId]?.name ?? '', until: Date.now() + 6000 };
    }
    render();
  });
  // the host is told who comes and goes, Settings open or not
  host.on('join', (g) => ui?.toast(ui.text.joined(nameOf(g.slot, g.name), g.slot + 1)));
  host.on('leave', (g) => ui?.toast(ui.text.left(nameOf(g.slot, g.name), g.slot + 1)));
  render();
  return host;
}

/** Stops sharing ; the room stays open when another module owns it. */
function stopOn({ keepRoom = false } = {}) {
  const mine = host;
  host = null;
  mine?.close({ keepRoom });
  capture?.stop();
  capture = null;
  linkText = '';
  gate = null;
  code = '';
  owner = 'share';
  noDirect = null;
  render();
}

/**
 * Opens the panel's own room and shares on it. `where` ({relay, rk}) : the game's start, on the
 * relay of Settings › Netplay ; none : the panel's own fields, remembered.
 * Resolves {ok: true} or {ok: false, code, message}.
 */
function start(where) {
  if (host) return Promise.resolve({ ok: true });
  starting ??= begin(where).finally(() => { starting = null; });
  return starting;
}

async function begin(given) {
  let result = { ok: true };
  error = '';
  closedBy = '';
  startButton.disabled = true;
  if (!given) {
    save('relay', relay.value.trim());
    save('rk', rk.value.trim());
  }
  try {
    const where = given ?? { relay: relay.value.trim(), rk: rk.value.trim() };
    let link;
    // the relay's signaling name, in clear, says the room's kind (the home page reads it before
    // asking for a disc) — the player's name goes end to end (WELCOME)
    const open = () => openRoom({ link, role: 'host', name: ROOM_KIND.share });
    // a code needs the game's own screens to answer the door (the Netplay build's) and a relay
    const room = where.relay && typeof Module.ctrInput?.shareHost === 'function'
      ? await openFreeRoom({
        length: codeLength,
        async open(length) {
          link = await codeRoom(randomCode(length), where);
          const opened = await open();
          return { room: opened, taken: (await peersOf(opened)).some((p) => p.kind === 'host' && p.id !== opened.selfId) };
        },
      })
      : await (link = newRoom(where), open());
    // the guest page, without this page's query : a relay key there only travels after #
    const base = new URL('share/guest.html', location.href);
    linkText = formatRoomLink(base.href, link);
    code = link.code;
    gate = gateHost(room, { pass: link.pass, onChange: render });
    await startOn(gate);
    tellCode();
  } catch (e) {
    const message = String(e.message ?? e);
    error = RELAY_SAYS[e.code] ?? `${e.code ? `${e.code}: ` : ''}${message}`;
    result = { ok: false, code: e.code ?? '', message };
    capture?.stop();
    capture = null;
    host = null;
    linkText = '';
    gate = null;
    code = '';
  }
  render();
  return result;
}

function stop() {
  stopOn();
}

const names = () => (code ? codeNames(parseCode(code)) : '');
/** The link to the clipboard ; a toast says how it went (a pad press is no gesture : a click is). */
function copyLink(said) {
  const offer = () => ui?.toast(names() || ui.text.shareOn, ui.text.shareClickCopy, '', { action: () => copyLink(ui.text.shareCopied), ms: 10_000 });
  const write = navigator.clipboard?.writeText(linkText);
  if (!write) return offer();
  write.then(() => ui?.toast(said, names(), '', { action: () => copyLink(ui.text.shareCopied), ms: 10_000 }), offer);
}
/** Share started : the one thing the page says of the code — the game shows it from here on. */
const tellCode = () => { if (linkText) copyLink(ui?.text.shareOnCopied); };

/** The panel's own room, for the game's screens (its tag, INVITE, the door) : null without a code. */
const door = () => (host && owner === 'share' && code && gate
  ? { code, asking: () => gate.asking(), answer: (yes) => gate.answer(yes), invite: () => copyLink(ui?.text.shareCopied) }
  : null);

/** A line for the host's game (upper case, ASCII), or '' : a guest was just refused, no direct connection. */
function said() {
  if (!noDirect || owner !== 'share' || Date.now() > noDirect.until) return '';
  const name = noDirect.name.toUpperCase().replace(/[^\x20-\x7e]/g, '').trim().slice(0, 12).trim();
  return `${name || 'GUEST'} - NO DIRECT CONNECTION`;
}

// start / link : the page's home hosts Share without this panel's button (ui/src/lib/home.js)
globalThis.ctrShareApi = { slots, startOn, stopOn, host: () => host, guests, start, link: () => linkText, door, said, closedBy: () => closedBy };

ui?.settings.subscribe((s) => { if (host && s.name !== host.hostName) host.setHostName(s.name); });

startButton.addEventListener('click', () => start());
usePublic.addEventListener('click', () => {
  relay.value = DEFAULT_RELAY;
  rk.value = DEFAULT_RELAY_KEY;
  // the Netplay tab's fields when they are there (they save), this panel's own otherwise
  for (const [field] of mirrored) field.dispatchEvent(new Event('input', { bubbles: true }));
  if (!inGame()) { save('relay', relay.value); save('rk', rk.value); }
  render();
});
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
  const game = inGame();
  startButton.hidden = copyButton.hidden = game;
  codeRow.hidden = !game;
  startButton.disabled = game || !!host || !!starting;
  stopButton.disabled = !host || owner !== 'share';
  copyButton.disabled = game || !linkText;
  hint.textContent = game ? HINT_IN_GAME : HINT;
  if (game) {
    codeLine.textContent = names() || '—';
    for (const [field, id] of mirrored) {
      const theirs = document.getElementById(id);
      if (theirs && document.activeElement !== field && field.value !== theirs.value) field.value = theirs.value;
    }
  }
  const word = relayWord(relay.value);
  relayWordOut.className = `word ${word}`;
  relayWordOut.textContent = word;
  usePublic.hidden = word === 'public';
  bitrateLabel.textContent = `${(Number(bitrate.value) / 1e6).toFixed(2)} Mbit/s per guest`;
  const lines = [];
  if (!host) lines.push('Not sharing.');
  else {
    if (owner === 'online') lines.push('Sharing the Online room\'s lobby (Settings › Multiplayer › Online).');
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
  capture?.tapAudio(); // the game's audio opened late
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
      code,
      asking: gate?.asking()?.name ?? null,
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
