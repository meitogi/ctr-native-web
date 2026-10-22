// node --test web/ui/test/*.test.js  —  the settings store : defaults, round trip through storage, the
// shared player name (the Online panel's key, ctr-online.name, NAME_LEN 9), a blocked storage.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, DEFAULT_KEYBOARD_LEFT, DEFAULT_KEYBOARD_RIGHT, bind } from '../src/lib/mappings.js'
import { NAMES } from '../src/lib/names.js'
import { DEFAULT_DEVICE, DEFAULT_VOLUME, GUEST_DEVICE_KEY, KEYS, NAME_LEN, cleanName, createSettings } from '../src/lib/settings.js'

const memory = (init = {}) => {
  const m = new Map(Object.entries(init))
  return { map: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

test('defaults on an empty storage : a random name, drawn once and stored', () => {
  const storage = memory()
  const s = createSettings(storage, { random: () => 0 }).get()
  assert.deepEqual(s, { name: NAMES[0], volume: DEFAULT_VOLUME, muted: false, skipIntro: true, keyboard: DEFAULT_KEYBOARD, gamepad: DEFAULT_GAMEPAD, duo: false, keyboardLeft: DEFAULT_KEYBOARD_LEFT, keyboardRight: DEFAULT_KEYBOARD_RIGHT, device: DEFAULT_DEVICE })
  assert.equal(storage.map.get(KEYS.name), NAMES[0]) // Online reads this key
  assert.equal(createSettings(storage, { random: () => 0.99 }).get().name, NAMES[0]) // not drawn again
})

test('an empty stored name (a page from before) gets a random one too', () => {
  const storage = memory({ 'ctr-online.name': '' })
  const name = createSettings(storage).get().name
  assert.ok(NAMES.includes(name), name)
  assert.equal(storage.map.get(KEYS.name), name)
})

test('who plays : per page key, cleaned, auto not written', () => {
  const storage = memory()
  const host = createSettings(storage)
  const guest = createSettings(storage, { deviceKey: GUEST_DEVICE_KEY })
  host.patch({ device: { mode: 'keyboard', pad: { id: 'x', nth: 0 } } })
  guest.patch({ device: { mode: 'gamepad', pad: { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', nth: 1 } } })
  assert.deepEqual(createSettings(storage).get().device, { mode: 'keyboard', pad: null })
  assert.deepEqual(createSettings(storage, { deviceKey: GUEST_DEVICE_KEY }).get().device, { mode: 'gamepad', pad: { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', nth: 1 } })
  host.patch({ device: { mode: 'nonsense' } })
  assert.deepEqual(host.get().device, DEFAULT_DEVICE)
  assert.equal(storage.map.has(KEYS.device), false)
  storage.map.set(KEYS.device, '{not json')
  assert.deepEqual(createSettings(storage).get().device, DEFAULT_DEVICE)
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
  assert.deepEqual(b, { name: 'Crash', volume: 0.35, muted: true, skipIntro: false, keyboard, gamepad: DEFAULT_GAMEPAD, duo: true, keyboardLeft: DEFAULT_KEYBOARD_LEFT, keyboardRight, device: DEFAULT_DEVICE })
  assert.equal(storage.map.has(KEYS.keyboardLeft), false)
  assert.equal(storage.map.has(KEYS.gamepad), false) // defaults are not written
})

test('the name : NAME_LEN 9, printable ASCII, subscribers see the cleaned value', () => {
  assert.equal(NAME_LEN, 9)
  assert.equal(cleanName('Crash Bandicoot'), 'Crash Ban')
  assert.equal(cleanName('Coco 🦊é!'), 'Coco !')
  const s = createSettings(memory({ 'ctr-online.name': 'Coco' }))
  const seen = []
  const off = s.subscribe((v) => seen.push(v.name))
  s.patch({ name: 'Neo Cortex!' })
  off()
  s.patch({ name: 'Tiny' })
  assert.deepEqual(seen, ['Coco', 'Neo Corte'])
})

test('a storage that throws (private mode) : defaults, and setting still works in memory', () => {
  const boom = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
  const s = createSettings(boom)
  assert.equal(s.get().volume, DEFAULT_VOLUME)
  s.patch({ volume: 0.1 })
  assert.equal(s.get().volume, 0.1)
})
