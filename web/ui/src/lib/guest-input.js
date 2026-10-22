// Share's guest page reads its keyboard and gamepad itself (web/share/guest-page.js, no game, no
// SDL) : this turns the player's own Controls mapping (mappings.js : SDL scancodes, SDL gamepad
// values) into the tables web/share/protocol.js reads — { keys: {KeyboardEvent.code: PSX bit},
// buttons: [[standard Gamepad API button index, PSX bit]] }. Exposed as ctrUI.guestInput().
import { codeOf } from './keys.js'
import { BUTTONS, standardIndexOf } from './mappings.js'

/** PSX button bits (web/share/protocol.js BTN, platform/native_input.c) by mappings.js name. */
export const PSX_BIT = {
  select: 0x1, l3: 0x2, r3: 0x4, start: 0x8,
  up: 0x10, right: 0x20, down: 0x40, left: 0x80,
  l2: 0x100, r2: 0x200, l1: 0x400, r1: 0x800,
  triangle: 0x1000, circle: 0x2000, cross: 0x4000, square: 0x8000,
}

/** The guest's tables from the settings' keyboard and gamepad mappings (unbound entries left out). */
export function guestInput(s) {
  const keys = {}
  const buttons = []
  // the key set Controls edits : the left half while two players share this machine's keyboard
  const keyboard = s.duo ? s.keyboardLeft : s.keyboard
  for (let i = 0; i < BUTTONS.length; i++) {
    const bit = PSX_BIT[BUTTONS[i]]
    const code = keyboard[i] >= 0 ? codeOf(keyboard[i]) : null
    if (code) keys[code] = (keys[code] ?? 0) | bit
    const index = s.gamepad[i] >= 0 ? standardIndexOf(s.gamepad[i]) : -1
    if (index >= 0) buttons.push([index, bit])
  }
  return { keys, buttons }
}
