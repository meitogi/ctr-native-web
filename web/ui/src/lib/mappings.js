// The PSX pad's buttons, their default keyboard and gamepad bindings (the ones
// platform/native_input.c NativeInput_DefaultMappings hardcodes), persistence and conflicts.
//
// A mapping is an array of 16 ints in the order of the C structs' fields after `id`
// (NativeInputKeyboardMapping kc_square … kc_dpad_down, NativeInputControllerMapping gc_square …
// gc_dpad_down) : the C side copies it as is (Module.ctrInput, input-hook.js).
// Keyboard values are SDL scancodes ; gamepad values are SDL_GamepadButton, or SDL_GamepadAxis |
// AXIS_FLAG for the triggers. -1 = unbound.

export const AXIS_FLAG = 0x4000 // NATIVE_INPUT_MAP_FLAG_AXIS

// SDL3 include/SDL3/SDL_gamepad.h (test/keys.test.js checks them)
export const SDL_PAD = {
  SOUTH: 0, EAST: 1, WEST: 2, NORTH: 3, BACK: 4, GUIDE: 5, START: 6, LEFT_STICK: 7, RIGHT_STICK: 8,
  LEFT_SHOULDER: 9, RIGHT_SHOULDER: 10, DPAD_UP: 11, DPAD_DOWN: 12, DPAD_LEFT: 13, DPAD_RIGHT: 14,
}
export const SDL_AXIS = { LEFT_TRIGGER: 4, RIGHT_TRIGGER: 5 }

/** The PSX buttons, in the C structs' field order. */
export const BUTTONS = [
  'square', 'circle', 'triangle', 'cross',
  'l1', 'l2', 'l3', 'r1', 'r2', 'r3',
  'start', 'select',
  'left', 'right', 'up', 'down',
]
/** Display order in the Controls tab. */
export const DISPLAY_ORDER = ['cross', 'circle', 'square', 'triangle', 'up', 'down', 'left', 'right', 'r1', 'l1', 'r2', 'l2', 'start', 'select', 'r3', 'l3']

export const DEFAULT_KEYBOARD = [
  27 /* X */, 25 /* V */, 29 /* Z */, 6 /* C */,
  225 /* LSHIFT */, 224 /* LCTRL */, 47 /* [ */,
  229 /* RSHIFT */, 228 /* RCTRL */, 48 /* ] */,
  40 /* RETURN */, 44 /* SPACE */,
  80 /* LEFT */, 79 /* RIGHT */, 82 /* UP */, 81 /* DOWN */,
]

export const DEFAULT_GAMEPAD = [
  SDL_PAD.WEST, SDL_PAD.EAST, SDL_PAD.NORTH, SDL_PAD.SOUTH,
  SDL_PAD.LEFT_SHOULDER, SDL_AXIS.LEFT_TRIGGER | AXIS_FLAG, SDL_PAD.LEFT_STICK,
  SDL_PAD.RIGHT_SHOULDER, SDL_AXIS.RIGHT_TRIGGER | AXIS_FLAG, SDL_PAD.RIGHT_STICK,
  SDL_PAD.START, SDL_PAD.BACK,
  SDL_PAD.DPAD_LEFT, SDL_PAD.DPAD_RIGHT, SDL_PAD.DPAD_UP, SDL_PAD.DPAD_DOWN,
]

// The Gamepad API's `standard` button index → what SDL's emscripten driver makes of it
// (externals/SDL/src/joystick/SDL_gamepad_db.h, the SDL_JOYSTICK_EMSCRIPTEN « default » mapping,
// with SDL_sysjoystick.c turning 12–15 into the hat and 6–7 into the trigger axes).
export const STANDARD_TO_SDL = [
  SDL_PAD.SOUTH, SDL_PAD.EAST, SDL_PAD.WEST, SDL_PAD.NORTH,
  SDL_PAD.LEFT_SHOULDER, SDL_PAD.RIGHT_SHOULDER,
  SDL_AXIS.LEFT_TRIGGER | AXIS_FLAG, SDL_AXIS.RIGHT_TRIGGER | AXIS_FLAG,
  SDL_PAD.BACK, SDL_PAD.START, SDL_PAD.LEFT_STICK, SDL_PAD.RIGHT_STICK,
  SDL_PAD.DPAD_UP, SDL_PAD.DPAD_DOWN, SDL_PAD.DPAD_LEFT, SDL_PAD.DPAD_RIGHT,
  SDL_PAD.GUIDE,
]

/** The `standard` index of an SDL gamepad value (for glyphs), or -1. */
export function standardIndexOf(value) {
  return STANDARD_TO_SDL.indexOf(value)
}

/** Validated copy of a stored mapping, or the defaults. */
export function sanitize(value, defaults) {
  if (!Array.isArray(value) || value.length !== defaults.length) return defaults.slice()
  return value.map((v, i) => (Number.isInteger(v) && v >= -1 && v <= 0xffff ? v : defaults[i]))
}

export function loadMapping(storage, key, defaults) {
  try {
    const raw = storage?.getItem(key)
    return raw ? sanitize(JSON.parse(raw), defaults) : defaults.slice()
  } catch {
    return defaults.slice()
  }
}

export function saveMapping(storage, key, mapping, defaults) {
  try {
    if (mapping.every((v, i) => v === defaults[i])) storage?.removeItem(key)
    else storage?.setItem(key, JSON.stringify(mapping))
  } catch { /* private mode : not remembered */ }
}

/**
 * Buttons sharing a binding : { [button]: [other buttons with the same binding] }. A shared
 * binding is allowed (the game reads both), it is only shown.
 */
export function conflicts(mapping) {
  const byValue = {}
  for (let i = 0; i < BUTTONS.length; i++) {
    const v = mapping[i]
    if (v < 0) continue
    ;(byValue[v] ??= []).push(BUTTONS[i])
  }
  const out = {}
  for (const v in byValue) {
    const list = byValue[v]
    if (list.length < 2) continue
    for (const b of list) out[b] = list.filter((o) => o !== b)
  }
  return out
}

/** A copy of `mapping` with `button` bound to `value`. */
export function bind(mapping, button, value) {
  const next = mapping.slice()
  next[BUTTONS.indexOf(button)] = value
  return next
}
