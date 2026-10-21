// node --test web/ui/test/*.test.js  —  pad detection from real Gamepad.id strings, the keyboard and
// gamepad tables checked against SDL3's own headers (what the C side compares with), mapping
// defaults equal to platform/native_input.c's, persistence and conflicts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SCANCODES, codeOf, keyLabel, refusal, scancodeOf } from '../src/lib/keys.js'
import { AXIS_FLAG, BUTTONS, DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, SDL_AXIS, SDL_PAD, STANDARD_TO_SDL, bind, conflicts, loadMapping, saveMapping } from '../src/lib/mappings.js'
import { parsePadId } from '../src/lib/pads.js'

const root = new URL('../../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

test('pad ids : Chromium, Firefox, Safari, XInput', () => {
  const cases = [
    ['DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', 'playstation', '054c', '0ce6', 'DualSense Wireless Controller'],
    ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'playstation', '054c', '09cc', 'Wireless Controller'],
    ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox', '045e', '0b13', 'Xbox Wireless Controller'],
    ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'nintendo', '057e', '2009', 'Pro Controller'],
    ['Xbox 360 Controller (XInput STANDARD GAMEPAD)', 'xbox', '', '', 'Xbox 360 Controller'],
    ['054c-0ce6-DualSense Wireless Controller', 'playstation', '054c', '0ce6', 'DualSense Wireless Controller'],
    ['45e-b13-Xbox Wireless Controller', 'xbox', '045e', '0b13', 'Xbox Wireless Controller'],
    ['057e-2009-Pro Controller', 'nintendo', '057e', '2009', 'Pro Controller'],
    ['xinput', 'xbox', '', '', 'Xbox Controller'],
    ['DualSense Wireless Controller', 'playstation', '', '', 'DualSense Wireless Controller'],
    ['Xbox Wireless Controller', 'xbox', '', '', 'Xbox Wireless Controller'],
    ['Pro Controller', 'nintendo', '', '', 'Pro Controller'],
    ['Joy-Con (L/R)', 'nintendo', '', '', 'Joy-Con (L/R)'],
    ['8BitDo SN30 Pro (STANDARD GAMEPAD Vendor: 2dc8 Product: 6101)', 'other', '2dc8', '6101', '8BitDo SN30 Pro'],
    ['player-harness virtual pad (STANDARD GAMEPAD Vendor: 0000 Product: 0000)', 'other', '0000', '0000', 'player-harness virtual pad'],
    ['', 'other', '', '', 'Gamepad'],
  ]
  for (const [id, family, vendor, product, name] of cases) {
    assert.deepEqual(parsePadId(id), { family, vendor, product, name }, id)
  }
})

function sdlEnum(header, prefix) {
  const out = {}
  const body = read(header)
  const re = new RegExp(`\\b(${prefix}[A-Z0-9_]+)\\s*(?:=\\s*(-?\\d+))?\\s*,`, 'g')
  let next = 0
  let m
  while ((m = re.exec(body))) {
    const v = m[2] !== undefined ? Number(m[2]) : next
    if (!(m[1] in out)) out[m[1]] = v
    next = v + 1
  }
  return out
}

test('every bindable key maps to the SDL scancode SDL_scancode.h gives that name', () => {
  const sdl = sdlEnum('externals/SDL/include/SDL3/SDL_scancode.h', 'SDL_SCANCODE_')
  for (const code in SCANCODES) {
    const [name, value] = SCANCODES[code]
    assert.equal(sdl[name], value, `${code} → ${name}`)
  }
  assert.equal(scancodeOf('KeyC'), 6)
  assert.equal(codeOf(225), 'ShiftLeft')
  assert.deepEqual(['F4', 'F12', 'Escape', 'AltLeft', 'MetaLeft', 'KeyQ'].map(refusal), ['debug', 'debug', 'cancel', 'unsupported', 'unsupported', ''])
})

test('gamepad enum values are SDL_gamepad.h\'s', () => {
  const buttons = sdlEnum('externals/SDL/include/SDL3/SDL_gamepad.h', 'SDL_GAMEPAD_BUTTON_')
  const axes = sdlEnum('externals/SDL/include/SDL3/SDL_gamepad.h', 'SDL_GAMEPAD_AXIS_')
  for (const k in SDL_PAD) assert.equal(buttons[`SDL_GAMEPAD_BUTTON_${k}`], SDL_PAD[k], k)
  for (const k in SDL_AXIS) assert.equal(axes[`SDL_GAMEPAD_AXIS_${k}`], SDL_AXIS[k], k)
  assert.equal(STANDARD_TO_SDL.length, 17)
})

test('the defaults are platform/native_input.c NativeInput_DefaultMappings, field for field', () => {
  const c = read('platform/native_input.c')
  const fields = { square: 'square', circle: 'circle', triangle: 'triangle', cross: 'cross', l1: 'l1', l2: 'l2', l3: 'l3', r1: 'r1', r2: 'r2', r3: 'r3', start: 'start', select: 'select', left: 'dpad_left', right: 'dpad_right', up: 'dpad_up', down: 'dpad_down' }
  const scancodes = sdlEnum('externals/SDL/include/SDL3/SDL_scancode.h', 'SDL_SCANCODE_')
  const buttons = sdlEnum('externals/SDL/include/SDL3/SDL_gamepad.h', 'SDL_GAMEPAD_BUTTON_')
  const axes = sdlEnum('externals/SDL/include/SDL3/SDL_gamepad.h', 'SDL_GAMEPAD_AXIS_')
  BUTTONS.forEach((b, i) => {
    const kc = new RegExp(`s_keyboardMapping\\.kc_${fields[b]} = (SDL_SCANCODE_\\w+);`).exec(c)[1]
    assert.equal(DEFAULT_KEYBOARD[i], scancodes[kc], `keyboard ${b}`)
    const gc = new RegExp(`s_controllerMapping\\.gc_${fields[b]} = ([^;]+);`).exec(c)[1]
    const m = /^(SDL_GAMEPAD_\w+)( \| NATIVE_INPUT_MAP_FLAG_AXIS)?$/.exec(gc)
    const v = m[2] ? axes[m[1]] | AXIS_FLAG : buttons[m[1]]
    assert.equal(DEFAULT_GAMEPAD[i], v, `gamepad ${b}`)
  })
  // the C struct's field order is the order the hook copies in
  const kStruct = /struct NativeInputKeyboardMapping\s*\{([^}]*)\}/.exec(c)[1]
  const order = [...kStruct.matchAll(/kc_(\w+)/g)].map((m) => m[1])
  assert.deepEqual(order, BUTTONS.map((b) => fields[b]))
  const gStruct = /struct NativeInputControllerMapping\s*\{([^}]*)\}/.exec(c)[1]
  assert.deepEqual([...gStruct.matchAll(/gc_(\w+)/g)].map((m) => m[1]).slice(0, 16), BUTTONS.map((b) => fields[b]))
})

test('mapping persistence round trip, defaults stored as nothing, garbage refused', () => {
  const mem = new Map()
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
  const remapped = bind(DEFAULT_KEYBOARD, 'down', scancodeOf('KeyS'))
  saveMapping(storage, 'k', remapped, DEFAULT_KEYBOARD)
  assert.deepEqual(loadMapping(storage, 'k', DEFAULT_KEYBOARD), remapped)
  saveMapping(storage, 'k', DEFAULT_KEYBOARD.slice(), DEFAULT_KEYBOARD)
  assert.equal(mem.has('k'), false)
  mem.set('k', '[1,2,3]')
  assert.deepEqual(loadMapping(storage, 'k', DEFAULT_KEYBOARD), DEFAULT_KEYBOARD)
  mem.set('k', 'not json')
  assert.deepEqual(loadMapping(storage, 'k', DEFAULT_KEYBOARD), DEFAULT_KEYBOARD)
})

test('conflicts : a key on two buttons is reported on both, unbound is never a conflict', () => {
  assert.deepEqual(conflicts(DEFAULT_KEYBOARD), {})
  const twice = bind(DEFAULT_KEYBOARD, 'square', scancodeOf('KeyV')) // V is Circle's
  assert.deepEqual(conflicts(twice), { square: ['circle'], circle: ['square'] })
  const unbound = bind(bind(DEFAULT_KEYBOARD, 'l3', -1), 'r3', -1)
  assert.deepEqual(conflicts(unbound), {})
})

test('key labels : names in each language, the layout map first', () => {
  assert.equal(keyLabel('ShiftLeft', 'fr'), 'Maj gauche')
  assert.equal(keyLabel('Enter', 'en'), 'Enter')
  assert.equal(keyLabel('KeyQ', 'fr'), 'Q')
  assert.equal(keyLabel('KeyQ', 'fr', new Map([['KeyQ', 'a']])), 'A')
  assert.equal(keyLabel('Digit5'), '5')
})
