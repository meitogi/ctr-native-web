// « Report a problem » : the link to a new GitHub issue, its form's fields filled from the page
// (.github/ISSUE_TEMPLATE/bug.yml — one query key per field `id`). Free of the DOM : node tests it
// (test/report.test.js) ; Settings › System wires it.
//
// Nothing private goes in the link : no room code, no relay or relay key, no player name. The
// `state` field is for a release-safe copy of the page's state (a later session) : the caller hands
// over only what may be public.

export const ISSUES = 'https://github.com/meitogi/ctr-native-web/issues/new'

/** The bug form's mode field, as the form lists them. */
export const MODES = { solo: 'Solo', couchHost: 'Couch host', couchGuest: 'Couch guest', netplayHost: 'Netplay host', netplayGuest: 'Netplay guest' }

/** Past this the link is cut (GitHub answers 414 to a URL that long) : `state` is shortened first. */
export const MAX_URL = 6000

/**
 * « Firefox 133 · Windows » from a user agent string. Order matters : Edge and Opera say Chrome,
 * Chrome says Safari, iOS browsers all run WebKit (CriOS, FxiOS).
 * @param {string} ua
 */
export function browserOf(ua = '') {
  const v = (re) => ua.match(re)?.[1] ?? ''
  let name
  if (/Edg(e|A|iOS)?\//.test(ua)) name = `Edge ${v(/Edg(?:e|A|iOS)?\/(\d+)/)}`
  else if (/OPR\//.test(ua)) name = `Opera ${v(/OPR\/(\d+)/)}`
  else if (/CriOS\//.test(ua)) name = `Chrome ${v(/CriOS\/(\d+)/)}`
  else if (/FxiOS\//.test(ua)) name = `Firefox ${v(/FxiOS\/(\d+)/)}`
  else if (/Firefox\//.test(ua)) name = `Firefox ${v(/Firefox\/(\d+)/)}`
  else if (/Chrom(e|ium)\//.test(ua)) name = `Chrome ${v(/Chrom(?:e|ium)\/(\d+)/)}`
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) name = `Safari ${v(/Version\/(\d+(?:\.\d+)?)/)}`
  else name = 'unknown browser'
  let os
  if (/iPhone/.test(ua)) os = 'iOS'
  else if (/iPad/.test(ua)) os = 'iPadOS'
  else if (/Android/.test(ua)) os = 'Android'
  else if (/CrOS/.test(ua)) os = 'ChromeOS'
  else if (/Windows/.test(ua)) os = 'Windows'
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS'
  else if (/Linux/.test(ua)) os = 'Linux'
  else os = 'unknown OS'
  return `${name.trim()} · ${os}`
}

/**
 * The page's mode as the form names it.
 * @param {{guest?: boolean, sharing?: boolean, netplay?: 'host' | 'guest' | null}} at - a Couch
 *   guest's page ; the host sharing its game ; in a Netplay room, and as what
 */
export function modeOf({ guest = false, sharing = false, netplay = null } = {}) {
  if (guest) return MODES.couchGuest
  if (netplay === 'host') return MODES.netplayHost
  if (netplay === 'guest') return MODES.netplayGuest
  if (sharing) return MODES.couchHost
  return MODES.solo
}

/**
 * The new-issue link with the bug form's fields filled.
 * @param {{version?: string, browser?: string, mode?: string, lang?: string, state?: string}} fields
 * @param {string} [base] - the repository's issues/new URL
 */
export function issueUrl({ version, browser, mode, lang, state } = {}, base = ISSUES) {
  const q = new URLSearchParams({ template: 'bug.yml' })
  const put = (k, v) => { if (typeof v === 'string' && v.trim()) q.set(k, v.trim()) }
  put('version', version)
  put('browser', browser)
  put('mode', mode)
  put('lang', lang)
  const url = () => `${base}?${q}`
  if (typeof state === 'string' && state.trim()) {
    const s = state.trim()
    q.set('state', s)
    if (url().length > MAX_URL) {
      // the longest start of it that fits with the note, found by halves (one character can take
      // up to 12 once encoded)
      const cut = (n) => `${s.slice(0, n)}\n[… cut to fit the link]`
      let lo = 0
      let hi = s.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        q.set('state', cut(mid))
        if (url().length <= MAX_URL) lo = mid
        else hi = mid - 1
      }
      q.set('state', cut(lo))
    }
  }
  return url()
}
