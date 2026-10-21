// Module.ctrInput : what platform/native_input.c pulls (JS never calls into the wasm, ASYNCIFY).
//   pull(HEAP32, kbIndex, padIndex, kb2Index, duoIndex)
//                                    writes the 16 + 16 + 16 mapping ints (mappings.js order) into
//                                    the C structs and the duo flag, once per input update
//   players                          couch mode (players.js) : next() swap command, report(slots)
//   blocked()                        true while the Settings panel holds the input
//   introSkip()                      true once per recent press while « Skip intro » is on
//                                    (include/platform/native_web_ui.h)
// Also tracks those presses : keydown (no repeats, not F1–F12) and pad buttons going down
// (watchPads, a rAF poll of navigator.getGamepads — the pad itself is SDL's, this only watches).
import { keyboardSets } from './settings.js'

const PRESS_WINDOW_MS = 1000

/**
 * @param {{ get: () => { keyboard: number[], gamepad: number[], skipIntro: boolean, duo: boolean, keyboardLeft: number[], keyboardRight: number[] } }} settings
 * @param {{ blocked: () => boolean }} ui
 * @param {{ now?: () => number, players?: { next: () => number, report: (slots: object[]) => void } }} [opts]
 */
export function createInputHook(settings, ui, { now = () => performance.now(), players = null } = {}) {
  let lastPress = -Infinity
  const press = () => {
    if (settings.get().skipIntro) lastPress = now()
  }
  return {
    pull(heap32, kb, pad, kb2, duo) {
      const s = settings.get()
      const [first, second] = keyboardSets(s)
      heap32.set(first, kb)
      heap32.set(s.gamepad, pad)
      if (kb2 !== undefined) heap32.set(second, kb2)
      if (duo !== undefined) heap32[duo] = s.duo ? 1 : 0
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
