// The debug builds' tools (__CTR_DEV__ : vite.config.js), loaded by main.js and guest.js — never
// in a release bundle : the « Bot » switch (bot.js : on by itself in the second window),
// Settings › Dev (Dev.svelte) with its second window (second.js), globalThis.ctrDev for scripts.
import { ui } from '../state.svelte.js'
import { guestPage, role } from '../store.js'
import { startBot } from './bot.js'
import { openSecond } from './second.js'

export function install({ toast = () => {} } = {}) {
  const log = (line) => { console.log(line); globalThis.Module?.print?.(line) }
  ui.bot = !!role.second || ui.bot
  startBot(ui, { log })
  globalThis.ctrDev = {
    // web/pages/guard.sh refuses a release site that carries this name
    tools: 'ctr-dev-tools',
    // the game page only (Share's guest page hosts nothing)
    second: guestPage ? null : (mode) => openSecond(mode, { ui }),
    bot: (on) => { ui.bot = !!on; return ui.bot },
    // the second window's progress ({ mode, text, error }) : Settings closes on the click
    status: () => (ui.second ? { ...ui.second } : null),
    toast,
  }
}
