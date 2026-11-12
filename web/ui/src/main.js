// The page's interface (web/index.html loads ui/ui.js) : boot screen and disc drop, the whole-window
// drop overlay, the speaker / Settings buttons, the Settings sidebar, toasts. Exposes
// globalThis.ctrUI for the other page modules :
//   ctrUI.settings            the settings store (settings.js) — name, volume, mappings…
//   ctrUI.adopt(id, title, el)  put another module's panel in a Settings tab (web/online/page.js,
//                             web/share/panel.js) ; returns { open(), close() }
//   ctrUI.toast(title, detail, family, { sticky, action, ms })
//   ctrUI.text                 the strings (lib/strings.js, EN / FR) — Share's join / leave toasts
//   ctrUI.players              couch mode (lib/players.js) : slots as the game reports them, swap(a, b)
//   ctrUI.lobby(on)            an Online room's guest in the lobby : the game gets no local input
//   ctrUI.joinSaid(code, n)    a code typed on the home page did not join once the game ran (the
//                             host's no…) : back to the home page's dials, the reason in red
//   ctrUI.guestInput()         the player's mapping as web/share/protocol.js reads it (guest-input.js)
// Debug builds (__CTR_DEV__) load src/dev/ : the « Bot » switch and Settings › Dev with its second
// window ; a window opened as that second one (?dev=<mode>) boots by itself.
// and Module.ctrInput for the game (lib/input-hook.js, pulled by platform/native_input.c).
import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { findCachedDisc, forgetDisc, probeDisc, storeDiscStream } from '../../disc.js'
import { parseCode, codeText } from '../../net/code.js'
import { formatRoomLink } from '../../net/link.js'
import { resolveDisc } from './lib/discsource.js'
import { guestInput } from './lib/guest-input.js'
import { createInputHook } from './lib/input-hook.js'
import { DEFAULT_RELAY_KEY, SAID, findRoom, keptRelay, press } from './lib/join.js'
import { createPlayers } from './lib/players.js'
import { LANG, T, errorText } from './lib/strings.js'
import { ui } from './state.svelte.js'
import { role, settings } from './store.js'

const Module = globalThis.Module

// ---- sound : index.html routes the game's Web Audio through window.ctrAudio's gain nodes ----
// A forced mute (player harness, ?mute) holds until the player touches the sound itself.
const audio = globalThis.ctrAudio
let heard = null
settings.subscribe((s) => {
  if (!audio) return
  if (heard && (heard.muted !== s.muted || heard.volume !== s.volume)) audio.forcedMute = false
  heard = { muted: s.muted, volume: s.volume }
  audio.set(s.muted || audio.forcedMute ? 0 : s.volume)
})
document.documentElement.lang = LANG

// ---- the game's input hook ----
// The game gets no local input while the player is in the Settings panel (its keyboard focus is
// there, a key is being bound, or a confirmation is up) ; with the panel open and the focus on the
// game (a click on it), the game plays — the Online tab stays open beside a race. With the Bot
// switch on (debug builds), the panel's focus does not stop the bot's keys.
const inPanel = () => !!document.activeElement?.closest?.('#ctr-settings')
// Couch mode : the game reports its four player slots, Settings › Players swaps them.
const players = createPlayers({
  onChange: (slots) => { ui.players = slots },
  onAnalog: (slot, pad) => toast(pad.analog ? T.analogOn(slot + 1) : T.analogOff(slot + 1), pad.analog ? '' : T.analogOffHelp, pad.family),
})
const input = createInputHook(settings, { blocked: () => ui.phase === 'running' && (ui.lobbyGuest || ui.listening !== null || ui.confirm !== null || (ui.settingsOpen && inPanel() && !ui.bot)), skipAll: () => !!ui.joining }, { players })
if (Module) Module.ctrInput = input

// ---- boot ----
function bootGame(serial) {
  ui.disc = ui.disc ?? { serial, size: 0 }
  // a room link, or a Netplay code typed on the home page : the boot screen says « Joining the
  // room… » until the host's picture (page.js)
  if (joinsAtBoot()) ui.joining = { state: 'joining' }
  ui.phase = 'starting'
  ui.status = T.booting
  const script = document.createElement('script')
  script.src = 'ctr_native.js'
  document.body.appendChild(script)
  const canvas = document.getElementById('canvas')
  canvas?.focus()
  // running once the game presents (the canvas gets its first frame) — or soon anyway
  const done = () => { if (ui.phase === 'starting') ui.phase = 'running' }
  setTimeout(done, 400)
}

async function storeAndBoot(found, { reload }) {
  ui.phase = 'preparing'
  ui.error = ''
  ui.status = ''
  ui.progress = { title: T.preparing, detail: T.preparingFrom(found.source, found.name), kind: found.kind, serial: found.serial, written: 0, total: found.size }
  let stored
  try {
    stored = await storeDiscStream(await found.open(), found.size, (written, total) => {
      ui.progress = { ...ui.progress, written, total }
    })
  } catch (e) {
    ui.progress = null
    ui.phase = reload ? 'running' : 'boot'
    const failure = e?.code ? { reason: `zip-${e.code}`, message: e.message } : { reason: 'storage', message: String(e) }
    ui.error = errorText(T, failure)
    if (reload) toast(ui.error)
    return
  }
  // what was written is checked again before anything boots from it ; a bad image is deleted
  const probe = await probeDisc(stored)
  if (!probe.ok) {
    await forgetDisc()
    ui.progress = null
    ui.phase = 'boot'
    ui.error = errorText(T, probe)
    return
  }
  ui.disc = { serial: probe.serial, size: stored.size }
  if (reload) {
    location.reload()
    return
  }
  ui.progress = null
  globalThis.__ctrDisc = stored
  // the disc a Netplay code was waiting for (28b) : the game boots into that room
  if (ui.join?.phase === 'disc') bootInto(ui.join.ids)
  bootGame(probe.serial)
}

/** A file dropped or picked : checked, then stored and booted (or, over a running game, confirmed). */
export async function handleFile(file) {
  ui.error = ''
  const running = ui.phase === 'running' || ui.phase === 'starting'
  if (!running) ui.status = T.checking(file.name)
  let found
  try {
    found = await resolveDisc(file, probeDisc)
  } catch (e) {
    found = { ok: false, reason: 'unknown', message: String(e) }
  }
  if (!found.ok) {
    ui.error = errorText(T, found)
    if (!running) ui.status = ''
    if (running) toast(ui.error)
    return
  }
  if (running) {
    ui.confirm = {
      text: T.replaceAsk(found.serial.replace('_', '-').replace('.', '')),
      action: T.replace,
      run: () => storeAndBoot(found, { reload: true }),
    }
    return
  }
  await storeAndBoot(found, { reload: false })
}

/** The ready screen's press (a key, a pad button, the Play button) : boots the stored disc. */
export function startGame() {
  if (ui.phase === 'ready') bootGame(ui.disc.serial)
}

export function forgetStoredDisc() {
  ui.confirm = {
    text: T.forgetAsk,
    action: T.forget,
    danger: true,
    run: async () => { await forgetDisc(); location.reload() },
  }
}

let toastSeq = 0
export function toast(title, detail = '', family = '', { sticky = false, action = null, ms = 4500 } = {}) {
  const id = ++toastSeq
  // a toast with an action is a button : a click (or Enter) runs it and dismisses the toast
  const run = action && (() => { dismissToast(id); action() })
  ui.toasts = [...ui.toasts, { id, title, detail, family, action: run }]
  if (!sticky) setTimeout(() => dismissToast(id), ms)
  return id
}
export function dismissToast(id) {
  ui.toasts = ui.toasts.filter((t) => t.id !== id)
}

/** The joining screen's Back (or Escape) : out of the room, the player's own title — or, for a code typed on the home page, its dials. */
export function joinBack() {
  const code = hashParam('c')
  if (code && !location.hash.includes('room=')) return joinSaid(code, 0)
  ui.joining = null
  history.replaceState(null, '', location.pathname + location.search)
  globalThis.ctrUI.onJoinBack?.()
}
// ---- « or join a room » : a room's code on the home page, before the game starts (28b) ----
// The dials are Join.svelte ; the code is kept from one visit to the next, as the game's JOIN keeps
// its own. The relay and its key are the Netplay settings' (web/online/page.js stores them : that
// module only loads with the game).
const read = (key) => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key, value) => { try { localStorage.setItem(key, value) } catch { /* private mode */ } }
const where = () => {
  const rk = (read('ctr-online.rk') ?? DEFAULT_RELAY_KEY).trim()
  return { relay: keptRelay((read('ctr-online.relay') ?? '').trim(), rk), rk }
}
const hashParam = (name) => new URLSearchParams(location.hash.slice(1)).get(name)
const joinsAtBoot = () => location.hash.includes('room=') || !!parseCode(hashParam('c'))
let looking = 0 // a newer look, or Back, drops the one on its way
const setDials = (d) => {
  ui.join = { ...ui.join, ids: d.ids, at: d.at, said: d.changed ? 0 : ui.join.said }
  write('ctr-ui.joinCode', codeText(d.ids))
}
/** The game boots into the room of `ids` : page.js reads `#c=` once it is there. */
function bootInto(ids) {
  history.replaceState(null, '', `${location.pathname}${location.search}#c=${codeText(ids)}`)
  ui.join = null
}
/** Back on the home page's dials with what went wrong (a number of lib/join.js SAID, 0 : nothing) : the page loads again, the game with it. */
function joinSaid(code, status) {
  history.replaceState(null, '', `${location.pathname}${location.search}#join=${code}${status ? `&said=${status}` : ''}`)
  location.reload()
}
/** `#join=<code>&said=<n>` (back from a room that did not take us), or `#c=` reloaded : the dials, as they were. */
function openFromHash() {
  const ids = parseCode(hashParam('join') ?? hashParam('c'))
  if (!ids) return
  const status = Number(hashParam('said')) || 0
  history.replaceState(null, '', location.pathname + location.search)
  join.open(ids, status)
}
export const join = {
  where,
  open(ids = parseCode(read('ctr-ui.joinCode')) ?? [0, 0, 0], status = 0) {
    ui.error = ''
    ui.join = { ids, at: 0, said: status, phase: status === SAID.noKey || status === SAID.keyRefused ? 'nokey' : 'dials' }
  },
  /** Back : the home page as it was. */
  close() { looking++; ui.join = null },
  /** Back from a waiting card or the Netplay drop zone : the dials, kept. */
  toDials() { looking++; ui.join = { ...ui.join, phase: 'dials' } },
  press(key) {
    if (ui.join?.phase !== 'dials') return
    const d = press(ui.join, key)
    setDials(d)
    if (d.join) join.go()
  },
  pick(i) { ui.join = { ...ui.join, at: i } },
  turn(i, key) { ui.join = { ...ui.join, at: i }; join.press(key) },
  more() { ui.join = { ...ui.join, at: ui.join.ids.length - 1 }; join.press('right') },
  saveKey(relay, rk) {
    write('ctr-online.relay', relay)
    write('ctr-online.rk', rk)
    join.go()
  },
  /** The dials sent : the relay says who hosts the room and which kind it is ; then on by its kind. */
  async go() {
    const mine = ++looking
    const ids = ui.join.ids
    ui.join = { ...ui.join, phase: 'looking', said: 0 }
    let found
    try {
      found = await findRoom(ids, where())
    } catch (e) {
      if (mine !== looking) return
      const status = e.said ?? SAID.offline
      ui.join = { ...ui.join, said: status, phase: status === SAID.noKey || status === SAID.keyRefused ? 'nokey' : 'dials' }
      return
    }
    if (mine !== looking) return
    if (found.kind === 'share') {
      // the host's screen, no disc : the guest page, where the host is asked (web/share/guest-page.js)
      location.href = formatRoomLink(new URL('share/guest.html', location.href).href, found.link)
    } else if (ui.phase === 'ready') {
      bootInto(ids)
      startGame()
    } else {
      // a Netplay room and no disc : the drop zone, saying why ; storeAndBoot goes on from there
      ui.join = { ...ui.join, phase: 'disc' }
    }
  },
}

// page.js : the joining screen's state ; nothing once it is gone (a room joined later from the
// panel has no boot screen)
const joining = (j) => { if (ui.joining) ui.joining = j }
// page.js : the watching band (32f) ; its Back leaves the room
const waiting = (w) => { if (JSON.stringify(ui.waiting) !== JSON.stringify(w)) ui.waiting = w }
/** The watching band's Back (Escape, Triangle, a click) : out of the room, the player's own main menu. */
export function waitBack() {
  ui.waiting = null
  globalThis.ctrUI.onWaitBack?.()
}

// Adopted panels live in a hidden parking spot while their tab is not shown, so their elements
// stay in the document (scripts and suites reach them by id).
const parking = Object.assign(document.createElement('div'), { id: 'ctr-parked', hidden: true })
document.body.appendChild(parking)
function adopt(id, title, el) {
  parking.appendChild(el)
  ui.adopted = [...ui.adopted.filter((a) => a.id !== id), { id, title, el }]
  return {
    open: () => { ui.tab = 'multi'; ui.multi = id; ui.settingsOpen = true },
    close: () => { ui.settingsOpen = false },
  }
}

// An Online room's guest in the lobby (web/online/page.js) : the game ignores the local devices
// and the page sends them to the host as a Share guest does — with the player's own mapping.
const lobby = (on) => { ui.lobbyGuest = !!on }
globalThis.ctrUI = { settings, adopt, toast, dismissToast, handleFile, players, text: T, lobby, joining, waiting, joinSaid, guestInput: () => guestInput(settings.get()) }

// Test-only hook (session 3) : the agent browser runs on another machine than the files, so CDP's
// DOM.setFileInputFiles cannot point at them ; suites fetch a same-origin fixture into the same
// handleFile() a drop or a pick calls.
globalThis.__ctrTestHandleFileFromUrl = async (url) => {
  const res = await fetch(url)
  const blob = await res.blob()
  return handleFile(new File([blob], url.split('/').pop()))
}

if (__CTR_DEV__) import('./dev/index.js').then((dev) => dev.install({ toast }))

mount(App, { target: document.getElementById('ctr-ui'), props: { input, handleFile, forgetStoredDisc, startGame, joinBack, waitBack, join } })

;(async () => {
  if (globalThis.__CTR_WEB_PRELOAD) {
    // Dev build with assets/ctr-u.bin baked into MEMFS (CTR_WEB_PRELOAD_DISC) : nothing to drop.
    ui.disc = { serial: 'preloaded (dev build)', size: 0 }
    bootGame('preloaded (dev build)')
    return
  }
  ui.status = T.checkingSaved
  const cached = await findCachedDisc()
  if (!cached) {
    ui.phase = 'boot'
    ui.status = ''
    openFromHash()
    return
  }
  ui.status = T.checking(cached.name || 'ctr-u.bin')
  const probe = await probeDisc(cached)
  if (!probe.ok) {
    ui.error = errorText(T, probe)
    ui.phase = 'boot'
    ui.status = ''
    await forgetDisc()
    return
  }
  // the boot screen stays : the game starts on the player's press (Boot.svelte, App.svelte), which
  // also lets the page's audio start with sound
  ui.disc = { serial: probe.serial, size: cached.size }
  globalThis.__ctrDisc = cached
  ui.phase = 'ready'
  ui.status = ''
  // a room link : no press, the game boots behind « Joining the room… » (session 32e)
  if (location.hash.includes('room=')) startGame()
  else openFromHash()
  // the second window of Settings › Dev (debug) : in the room already, nobody to press
  if (__CTR_DEV__ && role.second) startGame()
})()
