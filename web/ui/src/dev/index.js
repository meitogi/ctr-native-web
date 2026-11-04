// The debug builds' tools (__CTR_DEV__ : vite.config.js), loaded by main.js and guest.js — never
// in a release bundle : the « Bot » switch (bot.js : on by itself in the second window),
// Settings › Dev (Dev.svelte) with its second window (second.js), globalThis.ctrDev for scripts.
import { ui } from '../state.svelte.js'
import { guestPage, role } from '../store.js'
import { startBot } from './bot.js'
import { D } from './strings.js'
import { SECOND } from '../lib/second-window.js'
import { openSecond, walkToRace } from './second.js'

export function install({ toast = () => {} } = {}) {
  const log = (line) => { console.log(line); globalThis.Module?.print?.(line) }
  ui.bot = !!role.second || ui.bot
  startBot(ui, { log })
  globalThis.ctrDev = {
    // web/pages/guard.sh refuses a release site that carries this name
    tools: 'ctr-dev-tools',
    // the game page only (Share's guest page hosts nothing)
    second: guestPage ? null : (mode) => openSecond(mode, { ui }),
    // the player suites : this window's menus walked to the race of `mode` (after second(mode))
    walk: guestPage ? null : async (mode) => {
      ui.second = { mode, text: D.secondSteps.menus, error: false }
      try {
        await walkToRace(SECOND[mode])
        ui.second = { mode, text: D.secondSteps.racing, error: false }
      } catch (e) {
        ui.second = { mode, text: String(e?.message ?? e), error: true }
      }
      return ui.second
    },
    bot: (on) => { ui.bot = !!on; return ui.bot },
    // the second window's progress ({ mode, text, error }) : Settings closes on the click
    status: () => (ui.second ? { ...ui.second } : null),
    toast,
  }
}
