// Keyboard keys the remap accepts : KeyboardEvent.code (the physical key, what SDL's emscripten
// driver reads — externals/SDL/src/video/emscripten/SDL_emscriptenevents.c, Emscripten_MapScanCode)
// → the SDL scancode the C side tests in SDL_GetKeyboardState. Values are SDL3's
// (include/SDL3/SDL_scancode.h) ; test/keys.test.js checks every one against that header.
//
// Not bindable : F1–F12 (the game's debug keys, F4 moves the keyboard to the next player),
// Escape (cancels a binding), Alt (the C side ignores the keyboard while Alt is held,
// NativeInput_KeyboardSuppressed), Meta / OS keys.

/** code → [SDL_SCANCODE_* name, value] */
export const SCANCODES = {}
const add = (code, name, value) => { SCANCODES[code] = [name, value] }

for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(65 + i)
  add(`Key${letter}`, `SDL_SCANCODE_${letter}`, 4 + i)
}
for (let i = 1; i <= 9; i++) add(`Digit${i}`, `SDL_SCANCODE_${i}`, 29 + i)
add('Digit0', 'SDL_SCANCODE_0', 39)
add('Enter', 'SDL_SCANCODE_RETURN', 40)
add('Backspace', 'SDL_SCANCODE_BACKSPACE', 42)
add('Tab', 'SDL_SCANCODE_TAB', 43)
add('Space', 'SDL_SCANCODE_SPACE', 44)
add('Minus', 'SDL_SCANCODE_MINUS', 45)
add('Equal', 'SDL_SCANCODE_EQUALS', 46)
add('BracketLeft', 'SDL_SCANCODE_LEFTBRACKET', 47)
add('BracketRight', 'SDL_SCANCODE_RIGHTBRACKET', 48)
add('Backslash', 'SDL_SCANCODE_BACKSLASH', 49)
add('Semicolon', 'SDL_SCANCODE_SEMICOLON', 51)
add('Quote', 'SDL_SCANCODE_APOSTROPHE', 52)
add('Backquote', 'SDL_SCANCODE_GRAVE', 53)
add('Comma', 'SDL_SCANCODE_COMMA', 54)
add('Period', 'SDL_SCANCODE_PERIOD', 55)
add('Slash', 'SDL_SCANCODE_SLASH', 56)
add('CapsLock', 'SDL_SCANCODE_CAPSLOCK', 57)
add('Insert', 'SDL_SCANCODE_INSERT', 73)
add('Home', 'SDL_SCANCODE_HOME', 74)
add('PageUp', 'SDL_SCANCODE_PAGEUP', 75)
add('Delete', 'SDL_SCANCODE_DELETE', 76)
add('End', 'SDL_SCANCODE_END', 77)
add('PageDown', 'SDL_SCANCODE_PAGEDOWN', 78)
add('ArrowRight', 'SDL_SCANCODE_RIGHT', 79)
add('ArrowLeft', 'SDL_SCANCODE_LEFT', 80)
add('ArrowDown', 'SDL_SCANCODE_DOWN', 81)
add('ArrowUp', 'SDL_SCANCODE_UP', 82)
add('NumpadDivide', 'SDL_SCANCODE_KP_DIVIDE', 84)
add('NumpadMultiply', 'SDL_SCANCODE_KP_MULTIPLY', 85)
add('NumpadSubtract', 'SDL_SCANCODE_KP_MINUS', 86)
add('NumpadAdd', 'SDL_SCANCODE_KP_PLUS', 87)
add('NumpadEnter', 'SDL_SCANCODE_KP_ENTER', 88)
for (let i = 1; i <= 9; i++) add(`Numpad${i}`, `SDL_SCANCODE_KP_${i}`, 88 + i)
add('Numpad0', 'SDL_SCANCODE_KP_0', 98)
add('NumpadDecimal', 'SDL_SCANCODE_KP_PERIOD', 99)
add('IntlBackslash', 'SDL_SCANCODE_NONUSBACKSLASH', 100)
add('ControlLeft', 'SDL_SCANCODE_LCTRL', 224)
add('ShiftLeft', 'SDL_SCANCODE_LSHIFT', 225)
add('ControlRight', 'SDL_SCANCODE_RCTRL', 228)
add('ShiftRight', 'SDL_SCANCODE_RSHIFT', 229)

const BY_VALUE = {}
for (const code in SCANCODES) BY_VALUE[SCANCODES[code][1]] = code

/** The SDL scancode of a KeyboardEvent.code, or -1 when the key cannot be bound. */
export function scancodeOf(code) {
  const entry = SCANCODES[code]
  return entry ? entry[1] : -1
}

/** The KeyboardEvent.code of an SDL scancode, or '' . */
export function codeOf(scancode) {
  return BY_VALUE[scancode] ?? ''
}

/** Why a key cannot be bound : 'debug' (F1–F12), 'cancel' (Escape), 'unsupported', or '' . */
export function refusal(code) {
  if (/^F([1-9]|1[0-2])$/.test(code)) return 'debug'
  if (code === 'Escape') return 'cancel'
  return SCANCODES[code] ? '' : 'unsupported'
}

const NAMES = {
  en: {
    Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Space: 'Space', CapsLock: 'Caps Lock',
    Insert: 'Insert', Home: 'Home', PageUp: 'Page Up', Delete: 'Delete', End: 'End', PageDown: 'Page Down',
    ArrowRight: '→', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑',
    ControlLeft: 'Left Ctrl', ShiftLeft: 'Left Shift', ControlRight: 'Right Ctrl', ShiftRight: 'Right Shift',
    NumpadEnter: 'Num Enter', IntlBackslash: '< >',
  },
  fr: {
    Enter: 'Entrée', Backspace: 'Retour arr.', Tab: 'Tab', Space: 'Espace', CapsLock: 'Verr. Maj',
    Insert: 'Inser', Home: 'Début', PageUp: 'Page préc.', Delete: 'Suppr', End: 'Fin', PageDown: 'Page suiv.',
    ArrowRight: '→', ArrowLeft: '←', ArrowDown: '↓', ArrowUp: '↑',
    ControlLeft: 'Ctrl gauche', ShiftLeft: 'Maj gauche', ControlRight: 'Ctrl droite', ShiftRight: 'Maj droite',
    NumpadEnter: 'Entrée pavé', IntlBackslash: '< >',
  },
}

/**
 * What to print on a key cap. `layout` is the browser's keyboard layout map
 * (navigator.keyboard.getLayoutMap(), Chromium) when there is one : on an AZERTY keyboard the
 * physical KeyQ prints A.
 */
export function keyLabel(code, lang = 'en', layout = null) {
  const names = NAMES[lang] ?? NAMES.en
  if (names[code]) return names[code]
  const printed = layout?.get?.(code)
  if (printed && printed.trim()) return printed.toUpperCase()
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit(\d)$/.exec(code)
  if (m) return m[1]
  m = /^Numpad(\d)$/.exec(code)
  if (m) return `Num ${m[1]}`
  const punct = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/', NumpadDivide: 'Num /', NumpadMultiply: 'Num *', NumpadSubtract: 'Num -', NumpadAdd: 'Num +', NumpadDecimal: 'Num .' }
  return punct[code] ?? code
}
