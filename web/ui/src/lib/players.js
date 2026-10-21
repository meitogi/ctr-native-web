// Couch mode : the game's four player slots as platform/native_input.c reports them, and the swap
// commands it pulls (JS never calls into the wasm : ASYNCIFY).
//   report(list)  C → page when a slot changes : { flags, buttons, instance, vendor, product, name }
//                 per slot (NativeInput_WebReportPlayersJS)
//   next()        C pulls one command per call, 0 = none : (1 << 8) | (a << 4) | b swaps players
//                 a and b — their pads and their keyboards (NativeInput_WebPullPlayerCommand)
import { padFamily } from './pads.js'

export const FLAG = { CONNECTED: 0x1, PAD: 0x2, KEYBOARD: 0x4, KEYBOARD2: 0x8, ANALOG: 0x10 }
export const CMD_SWAP = 1
export const SLOTS = 4

export const swapCommand = (a, b) => (CMD_SWAP << 8) | (a << 4) | b

// SDL names a pad after its Gamepad API id, cut at 64 bytes (EmscriptenGamepadEvent.id) :
// Chromium's « (STANDARD GAMEPAD Vendor: … » tail goes, closed or not.
const padName = (name) => String(name ?? '').replace(/\s*\((?:XInput\s+)?STANDARD GAMEPAD.*$/i, '').trim() || 'Gamepad'

/** One reported slot → what the Players part shows. */
export function describe(r) {
  const pad = r.flags & FLAG.PAD
    ? { instance: r.instance, name: padName(r.name), family: padFamily(r.vendor, r.name), analog: !!(r.flags & FLAG.ANALOG) }
    : null
  return {
    pad,
    keyboard: !!(r.flags & FLAG.KEYBOARD),
    keyboard2: !!(r.flags & FLAG.KEYBOARD2),
    // active low : any bit cleared is a button held
    pressed: (r.buttons & 0xffff) !== 0xffff,
  }
}

/**
 * @param {{ onChange?: (slots: object[]) => void, onAnalog?: (slot: number, pad: object) => void }} hooks
 *   onAnalog : the same pad switched analog ⇄ digital (Select + Start), not a pad arriving
 */
export function createPlayers({ onChange = () => {}, onAnalog = () => {} } = {}) {
  const queue = []
  let slots = []
  return {
    get slots() { return slots },
    swap(a, b) {
      if (a !== b && a >= 0 && b >= 0 && a < SLOTS && b < SLOTS) queue.push(swapCommand(a, b))
    },
    next: () => queue.shift() ?? 0,
    report(list) {
      const prev = slots
      slots = list.map(describe)
      for (let i = 0; i < slots.length; i++) {
        const was = prev[i]?.pad
        const now = slots[i].pad
        if (was && now && was.instance === now.instance && was.analog !== now.analog) onAnalog(i, now)
      }
      onChange(slots)
    },
  }
}
