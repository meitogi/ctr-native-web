// node --test web/ui/test/*.test.js  —  the settings store : defaults, round trip through storage, the
// shared player name (the Online panel's key, ctr-online.name, NAME_LEN 9), a blocked storage.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, DEFAULT_KEYBOARD_LEFT, DEFAULT_KEYBOARD_RIGHT, bind } from '../src/lib/mappings.js'
import { DEFAULT_VOLUME, KEYS, NAME_LEN, cleanName, createSettings } from '../src/lib/settings.js'

const memory = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { map: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

test('defaults on an empty storage', () => {
  const s = createSettings(memory()).get()
  assert.deepEqual(s, { name: '', volume: DEFAULT_VOLUME, muted: false, skipIntro: true, keyboard: DEFAULT_KEYBOARD, gamepad: DEFAULT_GAMEPAD, duo: false, keyboardLeft: DEFAULT_KEYBOARD_LEFT, keyboardRight: DEFAULT_KEYBOARD_RIGHT })
})

test('an existing Online name is kept (ctr-online.name, no migration)', () => {
  const storage = memory({ 'ctr-online.name': 'Kevin' })
  assert.equal(KEYS.name, 'ctr-online.name')
  assert.equal(createSettings(storage).get().name, 'Kevin')
})

test('round trip : every field survives a reload of the page', () => {
  const storage = memory()
  const a = createSettings(storage)
  const keyboard = bind(DEFAULT_KEYBOARD, 'cross', 22)
  const keyboardRight = bind(DEFAULT_KEYBOARD_RIGHT, 'start', 42)
  a.patch({ name: 'Crash', volume: 0.35, muted: true, skipIntro: false, keyboard, duo: true, keyboardRight })
  const b = createSettings(storage).get()
  assert.deepEqual(b, { name: 'Crash', volume: 0.35, muted: true, skipIntro: false, keyboard, gamepad: DEFAULT_GAMEPAD, duo: true, keyboardLeft: DEFAULT_KEYBOARD_LEFT, keyboardRight })
  assert.equal(storage.map.has(KEYS.keyboardLeft), false)
  assert.equal(storage.map.has(KEYS.gamepad), false) // defaults are not written
})

test('the name : NAME_LEN 9, printable ASCII, subscribers see the cleaned value', () => {
  assert.equal(NAME_LEN, 9)
  assert.equal(cleanName('Crash Bandicoot'), 'Crash Ban')
  assert.equal(cleanName('Coco 🦊é!'), 'Coco !')
  const s = createSettings(memory())
  const seen = []
  const off = s.subscribe((v) => seen.push(v.name))
  s.patch({ name: 'Neo Cortex!' })
  off()
  s.patch({ name: 'Tiny' })
  assert.deepEqual(seen, ['', 'Neo Corte'])
})

test('a storage that throws (private mode) : defaults, and setting still works in memory', () => {
  const boom = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  const s = createSettings(boom)
  assert.equal(s.get().volume, DEFAULT_VOLUME)
  s.patch({ volume: 0.1 })
  assert.equal(s.get().volume, 0.1)
})
