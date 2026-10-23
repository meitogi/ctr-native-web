// The home's « Second window » (debug builds) : one click and a one-person race is on.
//   1. a real window opens beside this one, inside the click (pop-up rule), on a small
//      same-origin file while the room does not exist yet ;
//   2. this window boots and hosts the room of the mode (Online for VS / Battle, Share) ;
//   3. the second window goes to the room link with ?bot&mute&dev=<mode> : it boots by itself
//      (main.js), keeps its own settings (« Bot », the keyboard : store.js) and its Bot switch is
//      on (src/dev/index.js) ;
//   4. once Bot is in the room, this window's own menus are walked to the race : ONLINE → VS or
//      BATTLE (Share : VS.) → players → this player's character → the defaults to the start.
// The race itself is the player's (or this window's Bot switch).
import { MAIN_MENU, menuTo, onMainMenu } from '../lib/autopilot.js'
import { SECOND, secondWindowUrl, waitFor, windowFeatures } from '../lib/home.js'
import { frames, out } from './keys.js'
import { D } from './strings.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const game = () => globalThis.__ctr ?? null

/** The room's guests as this window's host sees them ([{ slot, name, state }]). */
function guests(room) {
  if (room === 'share') return globalThis.__ctrShare?.state().guests ?? []
  return globalThis.__ctrOnline?.state().share?.guests ?? []
}

async function until(label, pred, timeout) {
  const s = await waitFor(() => { const v = game(); return v && pred(v) ? v : null }, { timeout, every: 100 })
  if (!s) throw new Error(`no ${label} after ${Math.round(timeout / 1000)} s`)
  return s
}

/** This window's menus, from the main menu to the race's start (`spec` : lib/home.js SECOND). */
export async function walkToRace(spec, { step = () => {} } = {}) {
  const read = async () => game()
  await until('main menu', onMainMenu, 60_000)
  await menuTo({ read, out, label: spec.menu, rows: MAIN_MENU, settle: () => frames(8) })
  // ONLINE → VS (first row) or BATTLE (second) → players ; VS. → single race → players
  for (let i = 0; i < 3; i++) {
    if (i === 1 && spec.battle) { await out.press('ArrowDown'); await frames(15) }
    await out.press('c')
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
 * Opens the second window for `mode` ('vs' | 'battle' | 'share') ; `startGame(room, opts)` boots
 * this window and hosts (main.js). Progress in ui.second ({ mode, text, error }).
 */
export function openSecond(mode, { ui, startGame }) {
  const spec = SECOND[mode]
  const steps = D.secondSteps
  const say = (key, error = false) => { ui.second = { mode, text: steps[key] ?? key, error } }
  const win = window.open(new URL('preload-flag.js', location.href).href, 'ctr-second', windowFeatures(window))
  if (!win) { say('blocked', true); return null }
  say('hosting')
  ui.mode = spec.room
  return (async () => {
    const link = await startGame(spec.room, { show: false })
    if (!link) throw new Error('no room')
    win.location.replace(secondWindowUrl(link, mode))
    say('joining')
    const bot = await waitFor(() => guests(spec.room).find((g) => g.slot > 0 && g.state === 'streaming'), { timeout: 180_000, every: 250 })
    if (!bot) throw new Error('Bot never joined the room (see the second window)')
    say('menus')
    await walkToRace(spec)
    say('racing')
    return win
  })().catch((e) => { say(String(e?.message ?? e), true); return null })
}
