// The page's settings, one place : player name, volume / mute, skip intro, keyboard and gamepad
// mappings, two players on one keyboard (duo) and its two key sets, who plays on this page
// (device : auto, keyboard only, gamepad only and which one). Persisted in localStorage ; a missing or blocked storage (private mode) only means
// nothing is remembered.
//
// The player name keeps the key the Online panel already used (`ctr-online.name`,
// web/online/page.js) : existing players keep their name, no migration. web/online/page.js
// reads it through globalThis.ctrUI (src/main.js). An empty name gets a random one (names.js),
// stored at once, so Share and Online start with the same name.
//
// The device choice is per page : the game page and Share's guest page share one origin, so one
// machine opening both keeps two keys (`deviceKey`) — the host on the keyboard, the guest on the
// gamepad, and one controller no longer drives both (« ça boucle », 2026-10-22).
//
// createSettings() returns a Svelte-compatible store (subscribe / set / update) usable from plain
// JS too — test/settings.test.js drives it with an in-memory storage.
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, DEFAULT_KEYBOARD_LEFT, DEFAULT_KEYBOARD_RIGHT, loadMapping, saveMapping } from './mappings.js'
import { randomName } from './names.js'

export const NAME_LEN = 9 // game/OnlineCTR/global.h
export const KEYS = {
  name: 'ctr-online.name',
  volume: 'ctr-ui.volume',
  muted: 'ctr-ui.muted',
  skipIntro: 'ctr-ui.skip-intro',
  keyboard: 'ctr-ui.keyboard',
  gamepad: 'ctr-ui.gamepad',
  duo: 'ctr-ui.duo',
  keyboardLeft: 'ctr-ui.keyboard-left',
  keyboardRight: 'ctr-ui.keyboard-right',
  device: 'ctr-ui.device',
}
/** The device key of Share's guest page. */
export const GUEST_DEVICE_KEY = 'ctr-share.guest-device'
export const DEVICE_MODES = ['auto', 'keyboard', 'gamepad']
/** Auto : keyboard and gamepads, as before. `pad` : { id, nth } of the chosen gamepad, null = the first. */
export const DEFAULT_DEVICE = Object.freeze({ mode: 'auto', pad: null })
export const DEFAULT_VOLUME = 0.8

/** Printable ASCII only (the game's font), at most NAME_LEN characters. */
export function cleanName(name) {
  return String(name ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, NAME_LEN)
}

/** A valid device choice from anything (a stored JSON value, a patch). */
export function cleanDevice(d) {
  const mode = DEVICE_MODES.includes(d?.mode) ? d.mode : 'auto'
  const pad = mode === 'gamepad' && typeof d?.pad?.id === 'string' ? { id: d.pad.id, nth: Number.isInteger(d.pad.nth) && d.pad.nth >= 0 ? d.pad.nth : 0 } : null
  return { mode, pad }
}

const read = (storage, key) => { try { return storage?.getItem(key) ?? null } catch { return null } }
const write = (storage, key, value) => {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, String(value))
  } catch { /* private mode */ }
}

function loadDevice(storage, key) {
  try {
    return cleanDevice(JSON.parse(read(storage, key) ?? 'null'))
  } catch {
    return cleanDevice(null)
  }
}

export function loadSettings(storage, { deviceKey = KEYS.device } = {}) {
  const volume = Number.parseFloat(read(storage, KEYS.volume))
  return {
    name: cleanName(read(storage, KEYS.name) ?? ''),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOLUME,
    muted: read(storage, KEYS.muted) === '1',
    skipIntro: read(storage, KEYS.skipIntro) !== '0',
    keyboard: loadMapping(storage, KEYS.keyboard, DEFAULT_KEYBOARD),
    gamepad: loadMapping(storage, KEYS.gamepad, DEFAULT_GAMEPAD),
    duo: read(storage, KEYS.duo) === '1',
    keyboardLeft: loadMapping(storage, KEYS.keyboardLeft, DEFAULT_KEYBOARD_LEFT),
    keyboardRight: loadMapping(storage, KEYS.keyboardRight, DEFAULT_KEYBOARD_RIGHT),
    device: loadDevice(storage, deviceKey),
  }
}

function saveSettings(storage, s, deviceKey) {
  write(storage, KEYS.name, s.name)
  write(storage, KEYS.volume, s.volume)
  write(storage, KEYS.muted, s.muted ? '1' : null)
  write(storage, KEYS.skipIntro, s.skipIntro ? null : '0')
  saveMapping(storage, KEYS.keyboard, s.keyboard, DEFAULT_KEYBOARD)
  saveMapping(storage, KEYS.gamepad, s.gamepad, DEFAULT_GAMEPAD)
  write(storage, KEYS.duo, s.duo ? '1' : null)
  saveMapping(storage, KEYS.keyboardLeft, s.keyboardLeft, DEFAULT_KEYBOARD_LEFT)
  saveMapping(storage, KEYS.keyboardRight, s.keyboardRight, DEFAULT_KEYBOARD_RIGHT)
  write(storage, deviceKey, s.device.mode === 'auto' ? null : JSON.stringify(s.device))
}

/** The key sets the game gets : [first keyboard, second keyboard] — the two halves in duo. */
export function keyboardSets(s) {
  return s.duo ? [s.keyboardLeft, s.keyboardRight] : [s.keyboard, s.keyboardRight]
}

/**
 * A store over the settings. `storage` : localStorage, or anything with getItem / setItem / removeItem.
 * `deviceKey` : where this page keeps its device choice (KEYS.device, GUEST_DEVICE_KEY) ; `random`
 * draws the default name (tests).
 */
export function createSettings(storage, { deviceKey = KEYS.device, random } = {}) {
  let value = loadSettings(storage, { deviceKey })
  const subs = []
  const set = (next) => {
    value = { ...next, name: cleanName(next.name), device: cleanDevice(next.device) }
    saveSettings(storage, value, deviceKey)
    for (const fn of subs.slice()) fn(value)
  }
  if (!value.name) set({ ...value, name: randomName(random) })
  return {
    get: () => value,
    set,
    update: (fn) => set(fn(value)),
    patch: (p) => set({ ...value, ...p }),
    subscribe(fn) {
      subs.push(fn)
      fn(value)
      return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1) }
    },
  }
}
