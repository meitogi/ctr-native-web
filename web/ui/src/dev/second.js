// Settings › Dev's « Second window » (debug builds) : one click and a one-person race is on.
//   1. Settings closes (the game gets the keys again) and a real window opens beside this one,
//      inside the click (pop-up rule), on a small same-origin file while the room does not exist ;
//   2. this window's running game hosts the room of the mode (Online for VS / Battle, Share) ;
//   3. the second window goes to the room link with ?bot&mute&dev=<mode> : it boots by itself
//      (main.js), keeps its own settings (« Bot », the keyboard : store.js) and its Bot switch is
//      on (src/dev/index.js) ;
//   4. once Bot is in the room, the player picks the race from this window's own menus ; Bot
//      follows (its character locked, its race driven by its Bot switch).
// walkToRace (globalThis.ctrDev.walk, for the player suites) walks this window's menus to the race
// instead : ONLINE → VS, BATTLE or ARCADE (Share : VS. → players) → character → the defaults.
import { MAIN_MENU, menuTo, onMainMenu } from '../lib/autopilot.js'
import { SECOND, host, secondWindowUrl, waitFor, windowFeatures } from '../lib/second-window.js'
import { frames, out } from './keys.js'
import { D } from './strings.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const game = () => globalThis.__ctr ?? null

/**
 * The room's guests as this window's host sees them ([{ slot, name, state }]) : 'streaming', or
 * 'nomedia' for an Online guest on the relay (no picture, its pad works : LOG 14).
 */
function guests(room) {
  if (room === 'share') return globalThis.__ctrShare?.state().guests ?? []
  return globalThis.__ctrOnline?.state().share?.guests ?? []
}

async function until(label, pred, timeout) {
  const s = await waitFor(() => { const v = game(); return v && pred(v) ? v : null }, { timeout, every: 100 })
  if (!s) throw new Error(`no ${label} after ${Math.round(timeout / 1000)} s`)
  return s
}

/** This window's menus, from the main menu to the race's start (`spec` : lib/second-window.js SECOND). */
export async function walkToRace(spec, { step = () => {} } = {}) {
  const read = async () => game()
  await until('main menu', onMainMenu, 60_000)
  await menuTo({ read, out, label: spec.menu, rows: MAIN_MENU, settle: () => frames(8) })
  // ONLINE → VS (first row) → single race, or BATTLE (second) : the room's 2 humans, no players
  // menu (session 32b) ; VS. → single race → players
  // ONLINE → ARCADE (third) → single race → the difficulty's default
  const presses = spec.arcade
    ? ['c', 'ArrowDown', 'ArrowDown', 'c', 'c', 'c']
    : ['c', ...(spec.battle ? ['ArrowDown'] : []), 'c', 'c']
  for (const key of presses) {
    await out.press(key)
    await frames(15)
  }
  // a menu more on the way (Battle's) : Cross on its default until the character select
  for (let i = 0; i < 6 && !game()?.charSelect; i++) { await sleep(800); if (!game()?.charSelect) await out.press('c') }
  await until('character select', (s) => s.charSelect != null, 15_000)
  step('menus')
  await sleep(1000)
  for (let i = 0; i < 8 && !(game()?.charSelect?.locked & 1); i++) { await out.press('c'); await sleep(800) }
  await until("Bot's character", (s) => !s.charSelect || s.charSelect.locked & 2, 90_000)
  // the track / arena and any setup page : their defaults, until the race loads
  for (let i = 0; i < 30 && game()?.screen === 'menu'; i++) {
    if (!game()?.charSelect) await out.press('c')
    await sleep(700)
  }
  return until('race', (s) => s.screen !== 'menu', 120_000)
}

/**
 * Opens the second window for `mode` ('vs' | 'battle' | 'share' | 'arcade') beside this window, whose game
 * runs. Progress in ui.second ({ mode, text, error }).
 */
export function openSecond(mode, { ui }) {
  const spec = SECOND[mode]
  const steps = D.secondSteps
  const say = (key, error = false) => { ui.second = { mode, text: steps[key] ?? key, error } }
  const win = window.open(new URL('preload-flag.js', location.href).href, 'ctr-second', windowFeatures(window))
  if (!win) { say('blocked', true); return null }
  ui.settingsOpen = false
  document.getElementById('canvas')?.focus()
  say('hosting')
  return (async () => {
    const link = await host(spec.room)
    win.location.replace(secondWindowUrl(link, mode))
    say('joining')
    const bot = await waitFor(() => guests(spec.room).find((g) => g.slot > 0 && (g.state === 'streaming' || g.state === 'nomedia')), { timeout: 180_000, every: 250 })
    if (!bot) throw new Error('Bot never joined the room (see the second window)')
    say('ready')
    return win
  })().catch((e) => { say(String(e?.message ?? e), true); return null })
}
