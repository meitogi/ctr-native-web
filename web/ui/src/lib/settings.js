// The page's settings, one place : player name, volume / mute, skip intro, keyboard and gamepad
// mappings. Persisted in localStorage ; a missing or blocked storage (private mode) only means
// nothing is remembered.
//
// The player name keeps the key the Online panel already used (`ctr-online.name`,
// web/online/page.js) : existing players keep their name, no migration. web/online/page.js
// reads it through globalThis.ctrUI (src/main.js).
//
// createSettings() returns a Svelte-compatible store (subscribe / set / update) usable from plain
// JS too — test/settings.test.js drives it with an in-memory storage.
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, loadMapping, saveMapping } from './mappings.js'

export const NAME_LEN = 9 // game/OnlineCTR/global.h
export const KEYS = {
  name: 'ctr-online.name',
  volume: 'ctr-ui.volume',
  muted: 'ctr-ui.muted',
  skipIntro: 'ctr-ui.skip-intro',
  keyboard: 'ctr-ui.keyboard',
  gamepad: 'ctr-ui.gamepad',
}
export const DEFAULT_VOLUME = 0.8

/** Printable ASCII only (the game's font), at most NAME_LEN characters. */
export function cleanName(name) {
  return String(name ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, NAME_LEN)
}

const read = (storage, key) => { try { return storage?.getItem(key) ?? null } catch { return null } }
const write = (storage, key, value) => {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, String(value))
  } catch { /* private mode */ }
}

export function loadSettings(storage) {
  const volume = Number.parseFloat(read(storage, KEYS.volume))
  return {
    name: cleanName(read(storage, KEYS.name) ?? ''),
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOLUME,
    muted: read(storage, KEYS.muted) === '1',
    skipIntro: read(storage, KEYS.skipIntro) !== '0',
    keyboard: loadMapping(storage, KEYS.keyboard, DEFAULT_KEYBOARD),
    gamepad: loadMapping(storage, KEYS.gamepad, DEFAULT_GAMEPAD),
  }
}

function saveSettings(storage, s) {
  write(storage, KEYS.name, s.name)
  write(storage, KEYS.volume, s.volume)
  write(storage, KEYS.muted, s.muted ? '1' : null)
  write(storage, KEYS.skipIntro, s.skipIntro ? null : '0')
  saveMapping(storage, KEYS.keyboard, s.keyboard, DEFAULT_KEYBOARD)
  saveMapping(storage, KEYS.gamepad, s.gamepad, DEFAULT_GAMEPAD)
}

/** A store over the settings. `storage` : localStorage, or anything with getItem / setItem / removeItem. */
export function createSettings(storage) {
  let value = loadSettings(storage)
  const subs = []
  const set = (next) => {
    value = { ...next, name: cleanName(next.name) }
    saveSettings(storage, value)
    for (const fn of subs.slice()) fn(value)
  }
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
