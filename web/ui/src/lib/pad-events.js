// Gamepads coming and going, for the page's interface : ui.pads (by Gamepad.index) and a toast
// with the pad's family — « Gamepad connected · Xbox Wireless Controller · Xbox · Player 1 ».
// Shared by the game page (App.svelte) and Share's guest page (GuestApp.svelte). Returns a stop
// function.
import { parsePadId } from './pads.js'

export function padInfo(gp) {
  const p = parsePadId(gp.id)
  return { index: gp.index, id: gp.id, family: p.family, name: p.name }
}

/**
 * @param {{ pads: object[] }} ui
 * @param {(title: string, detail?: string, family?: string) => void} toast
 * @param {object} T - strings.js
 */
export function watchPadConnections(ui, toast, T, target = globalThis) {
  const connected = (e) => {
    const info = padInfo(e.gamepad)
    ui.pads = [...ui.pads.filter((p) => p.index !== info.index), info].sort((a, b) => a.index - b.index)
    const n = ui.pads.findIndex((p) => p.index === info.index) + 1
    toast(T.padConnected, `${info.name} · ${T.families[info.family]} · ${T.player(n)}`, info.family)
  }
  const disconnected = (e) => {
    const gone = ui.pads.find((p) => p.index === e.gamepad.index) ?? padInfo(e.gamepad)
    ui.pads = ui.pads.filter((p) => p.index !== e.gamepad.index)
    toast(T.padDisconnected, gone.name, gone.family)
  }
  target.addEventListener('gamepadconnected', connected)
  target.addEventListener('gamepaddisconnected', disconnected)
  return () => {
    target.removeEventListener('gamepadconnected', connected)
    target.removeEventListener('gamepaddisconnected', disconnected)
  }
}
