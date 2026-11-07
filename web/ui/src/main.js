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
//   ctrUI.guestInput()         the player's mapping as web/share/protocol.js reads it (guest-input.js)
// Debug builds (__CTR_DEV__) load src/dev/ : the « Bot » switch and Settings › Dev with its second
// window ; a window opened as that second one (?dev=<mode>) boots by itself.
// and Module.ctrInput for the game (lib/input-hook.js, pulled by platform/native_input.c).
import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { findCachedDisc, forgetDisc, probeDisc, storeDiscStream } from '../../disc.js'
import { resolveDisc } from './lib/discsource.js'
import { guestInput } from './lib/guest-input.js'
import { createInputHook } from './lib/input-hook.js'
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
  // a room link : the boot screen says « Joining the room… » until the host's picture (page.js)
  if (location.hash.includes('room=')) ui.joining = { state: 'joining' }
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

/** The joining screen's Back (or Escape) : out of the room, the player's own title. */
export function joinBack() {
  ui.joining = null
  history.replaceState(null, '', location.pathname + location.search)
  globalThis.ctrUI.onJoinBack?.()
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
globalThis.ctrUI = { settings, adopt, toast, dismissToast, handleFile, players, text: T, lobby, joining, waiting, guestInput: () => guestInput(settings.get()) }

// Test-only hook (session 3) : the agent browser runs on another machine than the files, so CDP's
// DOM.setFileInputFiles cannot point at them ; suites fetch a same-origin fixture into the same
// handleFile() a drop or a pick calls.
globalThis.__ctrTestHandleFileFromUrl = async (url) => {
  const res = await fetch(url)
  const blob = await res.blob()
  return handleFile(new File([blob], url.split('/').pop()))
}

if (__CTR_DEV__) import('./dev/index.js').then((dev) => dev.install({ toast }))

mount(App, { target: document.getElementById('ctr-ui'), props: { input, handleFile, forgetStoredDisc, startGame, joinBack, waitBack } })

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
  // the second window of Settings › Dev (debug) : in the room already, nobody to press
  if (__CTR_DEV__ && role.second) startGame()
})()
