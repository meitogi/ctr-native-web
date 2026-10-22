// The interface of Share's guest page (web/share/guest.html loads ui/guest.js, then
// share/guest-page.js) : the speaker / volume and Settings buttons, Settings (Players : name, who
// plays, who is in the game · Controls · System), toasts, the connection screens. No disc, no
// game : guest-page.js keeps the room, the <video> and the pad, and talks to this through
// globalThis.ctrUI :
//   ctrUI.settings        the settings store (name, volume, mappings, device — the guest's own key)
//   ctrUI.toast(title, detail, family)
//   ctrUI.text            the strings (EN / FR)
//   ctrUI.guestInput()    the player's mapping as web/share/protocol.js reads it (lib/guest-input.js)
//   ctrUI.guest.set(fields)   the connection : {state, code, message, slot, players, list, host,
//                         path, stream (tracks arrived), sound (unmuted by a click), crop}
//   ctrUI.guest.bind({unlock, crop})   what the screens' buttons do
//   ctrUI.guest.blocked() true while Settings holds the keys : the pad sent is neutral
import { mount } from 'svelte'
import GuestApp from './GuestApp.svelte'
import './app.css'
import { guestInput } from './lib/guest-input.js'
import { LANG, T } from './lib/strings.js'
import { ui } from './state.svelte.js'
import { settings } from './store.js'

document.documentElement.lang = LANG

let toastSeq = 0
function toast(title, detail = '', family = '') {
  const id = ++toastSeq
  ui.toasts = [...ui.toasts, { id, title, detail, family }]
  setTimeout(() => { ui.toasts = ui.toasts.filter((t) => t.id !== id) }, 4500)
  return id
}

let mapped = null
let mappedFrom = null
const actions = { unlock: () => {}, crop: () => {} }

ui.guest = { state: 'connecting', code: null, message: '', slot: 0, players: 0, list: [], host: null, path: null, stream: false, sound: false, crop: false }

globalThis.ctrUI = {
  settings,
  toast,
  text: T,
  guestInput() {
    const s = settings.get()
    if (s !== mappedFrom) {
      mappedFrom = s
      mapped = guestInput(s)
    }
    return mapped
  },
  guest: {
    set(fields) {
      ui.guest = { ...ui.guest, ...fields }
      ui.room = { slot: ui.guest.slot, host: ui.guest.host, list: ui.guest.list }
    },
    bind(fns) { Object.assign(actions, fns) },
    blocked: () => ui.settingsOpen && !!document.activeElement?.closest?.('#ctr-settings'),
  },
}

mount(GuestApp, { target: document.getElementById('ctr-ui'), props: { actions } })
