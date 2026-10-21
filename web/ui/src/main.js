// The page's interface (web/index.html loads ui/ui.js) : boot screen and disc drop, the whole-window
// drop overlay, the speaker / Settings buttons, the Settings sidebar, toasts. Exposes
// globalThis.ctrUI for the other page modules :
//   ctrUI.settings            the settings store (settings.js) — name, volume, mappings…
//   ctrUI.adopt(id, title, el)  put another module's panel in a Settings tab (web/online/page.js,
//                             web/share/panel.js) ; returns { open(), close() }
//   ctrUI.toast(title, detail)
// and Module.ctrInput for the game (lib/input-hook.js, pulled by platform/native_input.c).
import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { findCachedDisc, forgetDisc, probeDisc, storeDiscStream } from '../../disc.js'
import { resolveDisc } from './lib/discsource.js'
import { createInputHook } from './lib/input-hook.js'
import { LANG, T, errorText } from './lib/strings.js'
import { ui } from './state.svelte.js'
import { settings } from './store.js'

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
// game (a click on it), the game plays — the Online tab stays open beside a race.
const inPanel = () => !!document.activeElement?.closest?.('#ctr-settings')
const input = createInputHook(settings, { blocked: () => ui.phase === 'running' && (ui.listening !== null || ui.confirm !== null || (ui.settingsOpen && inPanel())) })
if (Module) Module.ctrInput = input

// ---- boot ----
function bootGame(serial) {
  ui.disc = ui.disc ?? { serial, size: 0 }
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

export function forgetStoredDisc() {
  ui.confirm = {
    text: T.forgetAsk,
    action: T.forget,
    danger: true,
    run: async () => { await forgetDisc(); location.reload() },
  }
}

let toastSeq = 0
export function toast(title, detail = '', family = '') {
  const id = ++toastSeq
  ui.toasts = [...ui.toasts, { id, title, detail, family }]
  setTimeout(() => { ui.toasts = ui.toasts.filter((t) => t.id !== id) }, 4500)
  return id
}

// Adopted panels live in a hidden parking spot while their tab is not shown, so their elements
// stay in the document (scripts and suites reach them by id).
const parking = Object.assign(document.createElement('div'), { id: 'ctr-parked', hidden: true })
document.body.appendChild(parking)
function adopt(id, title, el) {
  parking.appendChild(el)
  ui.adopted = [...ui.adopted.filter((a) => a.id !== id), { id, title, el }]
  return {
    open: () => { ui.tab = id; ui.settingsOpen = true },
    close: () => { ui.settingsOpen = false },
  }
}

globalThis.ctrUI = { settings, adopt, toast, handleFile }

// Test-only hook (session 3) : the agent browser runs on another machine than the files, so CDP's
// DOM.setFileInputFiles cannot point at them ; suites fetch a same-origin fixture into the same
// handleFile() a drop or a pick calls.
globalThis.__ctrTestHandleFileFromUrl = async (url) => {
  const res = await fetch(url)
  const blob = await res.blob()
  return handleFile(new File([blob], url.split('/').pop()))
}

mount(App, { target: document.getElementById('ctr-ui'), props: { input, handleFile, forgetStoredDisc } })

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
  ui.disc = { serial: probe.serial, size: cached.size }
  globalThis.__ctrDisc = cached
  bootGame(probe.serial)
})()
