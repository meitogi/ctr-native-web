// Module.ctrInput : what platform/native_input.c pulls (JS never calls into the wasm, ASYNCIFY).
//   pull(HEAP32, kbIndex, padIndex, kb2Index, duoIndex, deviceIndex)
//                                    writes the 16 + 16 + 16 mapping ints (mappings.js order) into
//                                    the C structs, the duo flag and « Who plays » (deviceInts), once
//                                    per input update
//   players                          couch mode (players.js) : next() swap command, report(slots)
//   blocked()                        true while the Settings panel holds the input
//   introSkip()                      true once per recent press while « Skip intro » is on
//                                    (include/platform/native_web_ui.h)
// Also tracks those presses : keydown (no repeats, not F1–F12) and pad buttons going down
// (watchPads, a rAF poll of navigator.getGamepads — the pad itself is SDL's, this only watches).
import { parsePadId } from './pads.js'
import { keyboardSets } from './settings.js'

export const DEVICE_MODE = { auto: 0, keyboard: 1, gamepad: 2 }

/**
 * « Who plays » as the game pulls it (platform/native_input.c s_webDevice) : [mode, USB vendor,
 * product, rank]. The chosen pad is named by its Gamepad API id and its rank among the connected
 * pads with that id ; the game knows its pads by SDL id, so it is matched by vendor / product (the
 * id's « Vendor: 045e Product: 0b13 » tail). No vendor in the id (Safari) : 0, the first pad.
 */
export function deviceInts(device) {
  const mode = DEVICE_MODE[device?.mode] ?? 0
  const pad = mode === DEVICE_MODE.gamepad ? device.pad : null
  if (!pad) return [mode, 0, 0, 0]
  const { vendor, product } = parsePadId(pad.id)
  const v = Number.parseInt(vendor, 16)
  const p = Number.parseInt(product, 16)
  return Number.isInteger(v) && Number.isInteger(p) ? [mode, v, p, pad.nth] : [mode, 0, 0, 0]
}

const PRESS_WINDOW_MS = 1000

/**
 * @param {{ get: () => { keyboard: number[], gamepad: number[], skipIntro: boolean, duo: boolean, keyboardLeft: number[], keyboardRight: number[] } }} settings
 * @param {{ blocked: () => boolean }} ui
 * @param {{ now?: () => number, players?: { next: () => number, report: (slots: object[]) => void } }} [opts]
 */
export function createInputHook(settings, ui, { now = () => performance.now(), players = null } = {}) {
  let lastPress = -Infinity
  let device = null
  let ints = [0, 0, 0, 0]
  const press = () => {
    if (settings.get().skipIntro) lastPress = now()
  }
  return {
    pull(heap32, kb, pad, kb2, duo, dev) {
      const s = settings.get()
      const [first, second] = keyboardSets(s)
      heap32.set(first, kb)
      heap32.set(s.gamepad, pad)
      if (kb2 !== undefined) heap32.set(second, kb2)
      if (duo !== undefined) heap32[duo] = s.duo ? 1 : 0
      if (dev !== undefined) {
        if (s.device !== device) {
          device = s.device
          ints = deviceInts(device)
        }
        heap32.set(ints, dev)
      }
    },
    players,
    blocked: () => ui.blocked(),
    introSkip() {
      if (!settings.get().skipIntro || now() - lastPress > PRESS_WINDOW_MS) return false
      lastPress = -Infinity
      return true
    },
    /** A key or pad button went down (the page's listeners call this). */
    press,
    /** keydown listener body : counts a press unless it is a repeat or a debug F-key. */
    onKey(e) {
      if (!e.repeat && !/^F([1-9]|1[0-2])$/.test(e.code)) press()
    },
  }
}

/**
 * Polls the Gamepad API once per animation frame and calls onDown(padIndex, buttonIndex, pad) for
 * every `standard` button that goes down (triggers past half way). Returns a stop function.
 */
export function watchPads(onDown, { getGamepads = () => navigator.getGamepads?.() ?? [], raf = requestAnimationFrame, caf = cancelAnimationFrame } = {}) {
  const prev = {}
  let id = 0
  const tick = () => {
    const pads = getGamepads()
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i]
      if (!p || !p.connected) continue
      const key = `${p.index}`
      const was = prev[key] ?? []
      const now = []
      for (let b = 0; b < p.buttons.length; b++) {
        const btn = p.buttons[b]
        now[b] = btn.pressed || btn.value > 0.5
        if (now[b] && !was[b]) onDown(p.index, b, p)
      }
      prev[key] = now
    }
    id = raf(tick)
  }
  id = raf(tick)
  return () => caf(id)
}
