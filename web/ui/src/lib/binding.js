// Settings › Controls waiting for a key or a pad button (ui.listening = {device, button}) : the
// press that comes is bound and saved. Shared by the game page (App.svelte) and Share's guest page
// (GuestApp.svelte), whose window-wide listeners route the press here.
import { refusal, scancodeOf } from './keys.js'
import { bind, STANDARD_TO_SDL } from './mappings.js'

/** A keydown while listening : bound, or refused with a notice (F1–F12, unsupported), Esc cancels. */
export function bindKey(e, ui, settings, T) {
  const why = refusal(e.code)
  if (why === 'cancel') { ui.listening = null; return }
  if (why) {
    const name = /^F\d+$/.test(e.code) ? e.code : (e.key && e.key.length === 1 ? e.key.toUpperCase() : e.code)
    ui.notice = why === 'debug' ? T.refusedDebug(name) : T.refusedKey(name)
    return
  }
  ui.notice = ''
  const s = settings.get()
  const field = ui.listening.device === 'keyboard2' ? 'keyboardRight' : s.duo ? 'keyboardLeft' : 'keyboard'
  settings.patch({ [field]: bind(s[field], ui.listening.button, scancodeOf(e.code)) })
  ui.listening = null
}

/** A pad button (Gamepad API standard index) while listening for one. Home (16) is never bound. */
export function bindPadButton(button, ui, settings) {
  if (button === 16) return
  settings.patch({ gamepad: bind(settings.get().gamepad, ui.listening.button, STANDARD_TO_SDL[button] ?? -1) })
  ui.listening = null
}
