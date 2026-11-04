// The « Bot » switch (debug builds, Settings › Joueurs) : this window plays itself with
// lib/autopilot.js — the bots' character pick at the character select, the racing line and the
// items in a race, Cross through the boot intro and the race's fly-in. What it reads depends on the page :
//   Share's guest page   the host's view of our kart (__ctrShareGuest.bot(), ?bot : KART / TRACK)
//   an Online guest      the host's menus in the lobby (__ctrOnline.bot()), its own game in the race
//   any other page       its own game (window.__ctr) : P1 on the host, solo
import { createPicker, drive, inBootIntro } from '../lib/autopilot.js'
import { out } from './keys.js'

const PHASE_MENUS = 1 // web/online/page.js PHASE
const PHASE_RACE = 3
const RACE_MS = 420_000
const racing = (s) => !!s?.kart && !s.kart.finished && (s.screen === 'countdown' || s.screen === 'race')
const withoutTrack = (s) => { if (!s) return null; const { track, ...rest } = s; return rest }

/** What the bot sees now : { slot, menus (charSelect holder), race: { read, track } | null, intro }. */
function look(g) {
  const share = g.__ctrShareGuest
  if (share) {
    const b = share.bot()
    if (!b || b.gone) return null
    const line = b.track
    return { slot: share.state().slot, menus: b, race: racing(b) && line?.levelID === b.levelID && line.path?.length >= 10 ? { read: () => withoutTrack(share.bot()), track: () => share.bot()?.track } : null }
  }
  const own = g.__ctr
  // the boot intro first : an Online guest's room is already open while its game boots
  if (inBootIntro(own)) return { slot: 0, menus: null, race: null, intro: true }
  const online = g.__ctrOnline?.state?.()
  if (online?.role === 'guest' && online.lobby?.active) {
    const slot = online.share?.slot ?? 0
    if (online.lobby.phase === PHASE_MENUS) { const b = g.__ctrOnline.bot(); return { slot, menus: b && !b.gone ? b : null, race: null } }
    if (online.lobby.phase !== PHASE_RACE) return { slot, menus: null, race: null }
  }
  if (!own) return null
  return { slot: 0, menus: own, intro: own.screen === 'intro', race: racing(own) && own.track?.path?.length >= 10 ? { read: () => withoutTrack(g.__ctr), track: () => g.__ctr?.track } : null }
}

/** Runs while ui.bot is on ; `log` gets a line per race. */
export function startBot(ui, { g = globalThis, log = () => {} } = {}) {
  const picker = createPicker({ out })
  let busy = false
  let lastIntro = 0
  setInterval(async () => {
    if (busy || !ui.bot) return
    busy = true
    try {
      const v = look(g)
      if (!v) return
      if (v.race) {
        const r = await drive({ out, read: async () => ({ ...v.race.read(), stop: !ui.bot }), track: async () => v.race.track(), deadline: Date.now() + RACE_MS })
        log(`Bot : race ${r.finished ? `finished, rank ${r.rank + 1}` : 'stopped'}, ${r.fired} item(s)`)
        return
      }
      if (v.intro && Date.now() - lastIntro > 1000) { lastIntro = Date.now(); await out.press('c'); return }
      await picker.step(v.menus?.charSelect ?? null, v.slot)
    } catch (e) {
      log(`Bot : ${e?.message ?? e}`)
    } finally {
      busy = false
    }
  }, 250)
}
