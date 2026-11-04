// ctr-autopilot — the bot's decisions, one implementation for the page's « Bot » switch
// (src/dev/bot.js, debug builds only) and the player suites' bots (web/test/player/*.suite.mjs).
// No DOM and no node here : state comes through `read()` / `track()` (window.__ctr-shaped, see
// platform/web_debug_bridge.c), keys go out through `out = { hold, release, press }` with the
// harness's key names ('c' Cross / accelerate, 'x' Square / reverse, 'v' Circle / item, arrows) —
// CDP key events in the suites, synthetic KeyboardEvents in the page.
// The release bundle never imports it : guard.sh refuses a site carrying its marker (first line).

export const ACCEL = 'c'
export const REVERSE = 'x'
export const FIRE = 'v'
export const CROSS = 'c'
export const DIRS = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']
// Main menu rows (D230.rowsMainMenuBasic, game/230/D230.c), as the game spells them.
// ONLINE : the CTR_ONLINE build's row (session 14) ; absent from the OFF build's menu
export const MAIN_MENU = ['ADVENTURE', 'TIME TRIAL', 'ARCADE', 'VS.', 'BATTLE', 'NETPLAY', 'HIGH SCORE', 'SCRAPBOOK']
/** True on the main menu taking input (any row selected). */
export const onMainMenu = (s) => s?.screen === 'menu' && s.menu != null && s.menu.input && MAIN_MENU.includes(s.menu.label)
// enum LevelID (include/namespace_Level.h)
const MAIN_MENU_LEVEL = 39
const NAUGHTY_DOG_CRATE = 41
/** True while the boot intro plays : the Naughty Dog crate, then the title until its menu takes input (« Skip intro » cuts both on a press). */
export const inBootIntro = (s) => !!s && (s.levelID === NAUGHTY_DOG_CRATE || (s.levelID === MAIN_MENU_LEVEL && s.screen === 'menu' && s.menu != null && !s.menu.input))

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Drives one kart along the level's racing line until its race ends (pure pursuit), firing
 * whatever item it holds every 1.5 s, reversing out when stuck. `read()` : the state without its
 * track ({ screen, kart, gone? }), `track()` : { path: [{x, y, z}] }. Returns { finished, rank, fired }.
 */
export async function drive({ out, read, track, deadline, now = Date.now, sleep = realSleep }) {
  const line = await track()
  const path = line?.path ?? []
  const n = path.length
  if (n < 10) throw new Error('no racing line (debug build ?)')
  const seg = path.map((q, i) => Math.hypot(path[(i + 1) % n].x - q.x, path[(i + 1) % n].z - q.z))
  const spacing = [...seg].sort((a, b) => a - b)[n >> 1]
  let near = -1
  const nearest = (k) => {
    const span = near < 0 ? n : 40
    const from = near < 0 ? 0 : near - 10
    let best = Infinity
    let at = near
    for (let j = 0; j < span; j++) {
      const i = (((from + j) % n) + n) % n
      const d = (path[i].x - k.pos.x) ** 2 + (path[i].z - k.pos.z) ** 2 + 4 * (path[i].y - k.pos.y) ** 2
      if (d < best) { best = d; at = i }
    }
    near = at
    return at
  }
  let held = null
  const steer = async (want) => {
    if (want === held) return
    if (held) await out.release(held)
    if (want) await out.hold(want)
    held = want
  }
  let fired = 0
  let lastFire = now()
  let slowSince = 0
  let maxSpeed = 0
  let lastPos = null
  let end = null
  // Progress along the line : a kart grinding along a wall moves, yet gets nowhere. No new
  // line point for 4 s is stuck too ; each recovery in a row reverses longer, wheel alternating.
  let best = { at: -1, since: now() }
  let recoveries = 0
  await out.hold(ACCEL)
  try {
    while (now() < deadline) {
      const s = await read()
      const k = s?.kart
      if (s?.gone) break // Share's bot : the host left
      if (s?.stop) break // the page's switch turned off
      if (!k) { await sleep(100); continue }
      if (s.screen === 'finished' || k.finished) { end = s; break }
      maxSpeed = Math.max(maxSpeed, k.speed)
      let i = nearest(k)
      for (let d = 0; d < spacing * 2 + Math.max(0, k.speed) / 25; i = (i + 1) % n) d += seg[i]
      const t = path[i]
      const err = wrap(Math.atan2(t.x - k.pos.x, t.z - k.pos.z) - (k.angle * 2 * Math.PI) / 4096)
      const moved = lastPos ? Math.hypot(k.pos.x - lastPos.x, k.pos.z - lastPos.z) : Infinity
      lastPos = k.pos
      if ((maxSpeed > 0 && k.speed < maxSpeed / 5) || moved < 5) slowSince ||= now()
      else slowSince = 0
      if (near !== best.at && (near - best.at + n) % n < n / 2) {
        if ((near - best.at + n) % n > 5) recoveries = 0
        best = { at: near, since: now() }
      }
      if ((slowSince && now() - slowSince > 1000) || now() - best.since > 4000) {
        const away = err > 0 ? 'ArrowRight' : 'ArrowLeft'
        await out.release(ACCEL)
        await steer(recoveries % 2 ? (away === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight') : away)
        await out.hold(REVERSE)
        await sleep(Math.min(1100 + 600 * recoveries, 3000))
        recoveries++
        best.since = now()
        await out.release(REVERSE)
        await steer(null)
        await out.hold(ACCEL)
        slowSince = 0
        near = -1
        lastPos = null
        continue
      }
      await steer(Math.abs(err) > 0.05 ? (err > 0 ? 'ArrowLeft' : 'ArrowRight') : null)
      if (now() - lastFire > 1500) {
        await out.press(FIRE)
        fired++
        lastFire = now()
      }
      await sleep(30)
    }
  } finally {
    await steer(null)
    await out.release(ACCEL)
  }
  return { finished: !!end, rank: end?.kart?.rank ?? null, fired }
}

/**
 * The character pick as the bots do it (user, 2026-10-22) : at the character select, browse the
 * grid for a few random moves, then Cross until this player's character is locked — a press
 * landing as the screen opens is lost, a character the other player holds may refuse it : after
 * 3 tries, move a little and try again. `step(charSelect, slot)` once per poll ; returns 'browse'
 * when it starts browsing, 'locked' once locked, else null.
 */
export function createPicker({ out, now = Date.now, sleep = realSleep, random = Math.random }) {
  let locking = false
  let tries = 0
  let lastPress = 0
  const browse = async (moves) => {
    for (let i = 0; i < moves; i++) {
      await out.press(DIRS[Math.floor(random() * DIRS.length)])
      await sleep(400)
    }
  }
  return {
    async step(charSelect, slot) {
      const mine = charSelect && (charSelect.locked >> slot) & 1
      if (charSelect && !mine) {
        let event = null
        if (!locking) {
          event = 'browse'
          await sleep(800)
          await browse(4 + Math.floor(random() * 7))
          tries = 0
        } else if (tries >= 3) {
          await browse(1 + Math.floor(random() * 3))
          tries = 0
        }
        locking = true
        if (now() - lastPress > 1500) { await out.press(CROSS); lastPress = now(); tries++ }
        return event
      }
      const was = locking
      locking = false
      return was && mine ? 'locked' : null
    },
  }
}

/**
 * Moves a menu's cursor to the row labelled `label` (rows : the menu's labels in order),
 * pressing ArrowDown / ArrowUp and checking each step leaves the row. `settle()` waits for the
 * game to sample the release (8 rAF in the suites). Returns the rows visited.
 */
export async function menuTo({ read, out, label, rows, settle, now = Date.now, sleep = realSleep }) {
  const visited = []
  for (let i = 0; i <= rows.length; i++) {
    const s = await read()
    visited.push(s.menu.label)
    if (s.menu.label === label) return visited
    const dir = rows.indexOf(s.menu.label) < rows.indexOf(label) ? 'ArrowDown' : 'ArrowUp'
    const row = s.menu.row
    await out.press(dir)
    for (const end = now() + 3000; ; await sleep(50)) {
      const m = (await read())?.menu
      if (m && m.row !== row) break
      if (now() > end) throw new Error(`the cursor never left row ${row} (${s.menu.label})`)
    }
    await settle()
  }
  throw new Error(`never reached ${label} (visited ${visited.join(' → ')})`)
}
