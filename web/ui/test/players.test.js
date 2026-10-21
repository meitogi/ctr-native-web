// node --test web/ui/test/*.test.js  —  couch mode : the two keyboard halves (the user's layout, no
// key shared between them, SDL scancodes), what the game pulls (input-hook pull : both key sets and
// the duo flag, in the C structs' layout), the swap commands and the slot reports
// (platform/native_input.c NativeInput_WebPullPlayerCommand / NativeInput_WebReportPlayersJS).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createInputHook } from '../src/lib/input-hook.js'
import { BUTTONS, DEFAULT_KEYBOARD, DEFAULT_KEYBOARD_LEFT, DEFAULT_KEYBOARD_RIGHT, conflicts } from '../src/lib/mappings.js'
import { codeOf } from '../src/lib/keys.js'
import { padFamily } from '../src/lib/pads.js'
import { FLAG, createPlayers, swapCommand } from '../src/lib/players.js'
import { keyboardSets } from '../src/lib/settings.js'

const c = readFileSync(new URL('../../../platform/native_input.c', import.meta.url), 'utf8')
const define = (name) => Number(new RegExp(`#define ${name}\\s+(0x[0-9a-f]+|\\d+)`, 'i').exec(c)[1])

test('the two keyboard halves : the user\'s keys, nothing shared, nothing on a debug key', () => {
  const at = (map) => Object.fromEntries(BUTTONS.map((b, i) => [b, map[i] < 0 ? null : codeOf(map[i])]))
  assert.deepEqual(at(DEFAULT_KEYBOARD_LEFT), {
    square: 'KeyF', circle: 'KeyH', triangle: 'KeyT', cross: 'KeyG', l1: 'KeyR', l2: 'KeyQ', l3: null,
    r1: 'KeyY', r2: 'KeyE', r3: null, start: 'Tab', select: 'Backquote', left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS',
  })
  assert.deepEqual(at(DEFAULT_KEYBOARD_RIGHT), {
    square: 'KeyK', circle: 'Semicolon', triangle: 'KeyO', cross: 'KeyL', l1: 'KeyI', l2: 'Comma', l3: null,
    r1: 'KeyP', r2: 'Period', r3: null, start: 'Enter', select: 'Slash', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  })
  const left = DEFAULT_KEYBOARD_LEFT.filter((v) => v >= 0)
  for (const v of DEFAULT_KEYBOARD_RIGHT) if (v >= 0) assert.ok(!left.includes(v), `key ${codeOf(v)} in both halves`)
  assert.deepEqual(conflicts(DEFAULT_KEYBOARD_LEFT), {})
  assert.deepEqual(conflicts(DEFAULT_KEYBOARD_RIGHT), {})
})

test('pull : the solo keys alone, the two halves in duo, the flag in its own int', () => {
  let s = { keyboard: DEFAULT_KEYBOARD, gamepad: Array(16).fill(7), duo: false, keyboardLeft: DEFAULT_KEYBOARD_LEFT, keyboardRight: DEFAULT_KEYBOARD_RIGHT, skipIntro: true }
  const hook = createInputHook({ get: () => s }, { blocked: () => false })
  const heap = new Int32Array(100)
  // C : (keyboard, keyboard2, gamepad, duo) → pull(HEAP32, kb, pad, kb2, duo)
  hook.pull(heap, 0, 16, 32, 48)
  assert.deepEqual([...heap.slice(0, 16)], DEFAULT_KEYBOARD)
  assert.deepEqual([...heap.slice(16, 32)], s.gamepad)
  assert.deepEqual([...heap.slice(32, 48)], DEFAULT_KEYBOARD_RIGHT)
  assert.equal(heap[48], 0)
  s = { ...s, duo: true }
  hook.pull(heap, 0, 16, 32, 48)
  assert.deepEqual([...heap.slice(0, 16)], DEFAULT_KEYBOARD_LEFT)
  assert.deepEqual([...heap.slice(32, 48)], DEFAULT_KEYBOARD_RIGHT)
  assert.equal(heap[48], 1)
  assert.deepEqual(keyboardSets(s), [DEFAULT_KEYBOARD_LEFT, DEFAULT_KEYBOARD_RIGHT])
  // an older wasm passing two pointers still gets its tables
  const old = new Int32Array(32)
  hook.pull(old, 0, 16)
  assert.deepEqual([...old.slice(0, 16)], DEFAULT_KEYBOARD_LEFT)
})

test('commands and flags match native_input.c', () => {
  assert.equal(define('NATIVE_INPUT_WEB_CMD_SWAP'), 1)
  assert.equal(swapCommand(0, 3), 0x103)
  assert.equal(define('NATIVE_INPUT_WEB_SLOT_CONNECTED'), FLAG.CONNECTED)
  assert.equal(define('NATIVE_INPUT_WEB_SLOT_PAD'), FLAG.PAD)
  assert.equal(define('NATIVE_INPUT_WEB_SLOT_KEYBOARD'), FLAG.KEYBOARD)
  assert.equal(define('NATIVE_INPUT_WEB_SLOT_KEYBOARD2'), FLAG.KEYBOARD2)
  assert.equal(define('NATIVE_INPUT_WEB_SLOT_ANALOG'), FLAG.ANALOG)
  assert.equal(define('NATIVE_INPUT_WEB_REPORT_INTS'), 6)
})

test('swaps queue in order, one per pull ; bad ones are dropped', () => {
  const p = createPlayers()
  p.swap(0, 1)
  p.swap(2, 2)
  p.swap(1, 4)
  p.swap(3, 2)
  assert.deepEqual([p.next(), p.next(), p.next()], [0x101, 0x132, 0])
})

test('reports : devices per slot, the pad\'s family, a lit row, ANA ⇄ DIG of the same pad', () => {
  const seen = []
  const toggles = []
  const p = createPlayers({ onChange: (s) => seen.push(s), onAnalog: (i, pad) => toggles.push([i, pad.analog]) })
  const pad = (instance, analog, buttons = 0xffff) => ({ flags: FLAG.CONNECTED | FLAG.PAD | (analog ? FLAG.ANALOG : 0), buttons, instance, vendor: 0x054c, product: 0x0ce6, name: 'PS5 Controller' })
  const kb = { flags: FLAG.CONNECTED | FLAG.KEYBOARD, buttons: 0xbfff, instance: 0, vendor: 0, product: 0, name: '' }
  const none = { flags: 0, buttons: 0xffff, instance: 0, vendor: 0, product: 0, name: '' }
  p.report([pad(7, true), kb, none, none])
  assert.deepEqual(p.slots[0], { pad: { instance: 7, name: 'PS5 Controller', family: 'playstation', analog: true }, keyboard: false, keyboard2: false, pressed: false })
  assert.deepEqual(p.slots[1], { pad: null, keyboard: true, keyboard2: false, pressed: true })
  p.report([pad(7, false), kb, none, none])
  // a different pad arriving digital is not a toggle
  p.report([pad(7, false), kb, pad(9, false), none])
  assert.deepEqual(toggles, [[0, false]])
  assert.equal(seen.length, 3)
})

test('pad family from the USB vendor, else the name', () => {
  assert.equal(padFamily(0x045e, 'whatever'), 'xbox')
  assert.equal(padFamily(0x57e, ''), 'nintendo')
  assert.equal(padFamily(0, 'Xbox Wireless Controller'), 'xbox')
  assert.equal(padFamily(0x2dc8, '8BitDo SN30 Pro'), 'other')
})

test('pad names : Chromium\'s tail cut by SDL\'s 64 bytes is dropped', () => {
  const p = createPlayers()
  p.report([{ flags: FLAG.PAD, buttons: 0xffff, instance: 3, vendor: 0, product: 0, name: 'player-harness virtual pad (STANDARD GAMEPAD Vendor: 0000 Produ' }])
  assert.equal(p.slots[0].pad.name, 'player-harness virtual pad')
})
