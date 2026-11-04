// The second window of Settings › Dev (debug builds, src/dev/second.js), no DOM : the room it
// joins and how this window hosts it, its address, its place beside this one, its own settings.
// test/second-window.test.js drives it.

/**
 * The second window's modes (debug builds) : which room this window hosts, and the game menu
 * row its own menus are walked to (lib/autopilot.js menuTo, src/dev/second.js).
 */
export const SECOND = {
  vs: { room: 'online', menu: 'NETPLAY', battle: false },
  battle: { room: 'online', menu: 'NETPLAY', battle: true },
  share: { room: 'share', menu: 'VS.', battle: false },
  arcade: { room: 'online', menu: 'NETPLAY', battle: false, arcade: true },
}

/** Polls `get()` until it returns something, every `every` ms ; null after `timeout`. */
export async function waitFor(get, { timeout = 60_000, every = 100, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  for (const end = now() + timeout; ; await sleep(every)) {
    const v = get()
    if (v) return v
    if (now() > end) return null
  }
}

/**
 * Hosts the room of `mode` in the running game : Share through the Share panel
 * (web/share/panel.js ctrShareApi.start), Online through the Online panel (web/online/page.js
 * __ctrOnline.host, P2P or relay from its saved settings). Resolves with the room link (the
 * guest's address). `g` : globalThis.
 */
export async function host(mode, g = globalThis, opts) {
  if (mode === 'share') {
    const api = await waitFor(() => g.ctrShareApi?.start && g.ctrShareApi, opts)
    if (!api) throw new Error('the Share panel never loaded')
    await api.start()
    const link = api.link()
    if (!link) throw new Error('Share did not start (see Settings › Multiplayer)')
    return link
  }
  if (mode === 'online') {
    const online = await waitFor(() => g.__ctrOnline, opts)
    if (!online) throw new Error('the Online panel never loaded (not a CTR_ONLINE build ?)')
    await online.host()
    const link = online.state().link
    if (!link) throw new Error(online.state().error || 'the room did not open (see Settings › Multiplayer)')
    return link
  }
  throw new Error(`no room for ${mode}`)
}

/** The second window's address : the room link with ?bot (the bot's pad and state), ?mute, ?dev=<mode>. */
export function secondWindowUrl(link, mode) {
  const url = new URL(link)
  url.searchParams.set('bot', '1')
  url.searchParams.set('mute', '1')
  url.searchParams.set('dev', mode)
  return url.href
}

/**
 * window.open's features for a window beside this one : the right of this window when the screen
 * has room, else the screen's right half ; this window's height.
 */
export function windowFeatures(win) {
  const s = win.screen
  const availLeft = s.availLeft ?? 0
  const availTop = s.availTop ?? 0
  const width = Math.max(480, Math.min(win.outerWidth, Math.floor(s.availWidth / 2)))
  const height = Math.max(360, Math.min(win.outerHeight, s.availHeight))
  const right = win.screenX + win.outerWidth
  const left = right + width <= availLeft + s.availWidth ? right : availLeft + s.availWidth - width
  const top = Math.max(availTop, win.screenY)
  return `popup,left=${left},top=${top},width=${width},height=${height}`
}

/**
 * A Storage kept in memory, seeded : the second window's settings (name « Bot », the keyboard,
 * the default keys), so it never writes the first window's name, « Who plays » or mappings — one
 * origin, one localStorage.
 */
export function memoryStorage(seed = {}) {
  const m = {}
  for (const k in seed) m[k] = String(seed[k])
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v) },
    removeItem: (k) => { delete m[k] },
  }
}

export const BOT_SEED = { 'ctr-online.name': 'Bot', 'ctr-ui.device': JSON.stringify({ mode: 'keyboard', pad: null }), 'ctr-share.guest-device': JSON.stringify({ mode: 'keyboard', pad: null }) }

/** The page's query : the second window's mode (?dev=), and whether it is the bot's window (?bot). */
export function pageRole(search) {
  const q = new URLSearchParams(search)
  const dev = q.get('dev')
  return { bot: q.has('bot'), second: dev in SECOND ? dev : null }
}
