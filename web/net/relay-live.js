// What a relay says in public of itself (GET /live, relay/README.md « RELAY_LIVE ») : players and
// rooms now, and their peaks since it started. The home page shows it under « or join a room »
// (ui/src/RelayLive.svelte). Never a refusal nor a kick : those stay in the relay's /stats.
// A relay without /live (yours, an older one) answers nothing usable : the page shows nothing.

const KEYS = ['players', 'rooms', 'peakPlayers', 'peakRooms']

/** `wss://host` → `https://host/live`, `ws://` → `http://` ; null for anything else. */
export function liveUrlOf(relay) {
  const m = /^(wss?):\/\/([^/\s?#]+)\/?$/.exec(typeof relay === 'string' ? relay.trim() : '')
  return m ? `${m[1] === 'wss' ? 'https' : 'http'}://${m[2]}/live` : null
}

/** The body of /live when it is one, else null. */
export function liveOf(body) {
  if (!body || typeof body !== 'object') return null
  for (const k of KEYS) if (!Number.isInteger(body[k]) || body[k] < 0) return null
  return { players: body.players, rooms: body.rooms, peakPlayers: body.peakPlayers, peakRooms: body.peakRooms }
}

/** Asks the relay ; null when it has no /live, is down, or slower than `ms`. */
export async function fetchLive(relay, { ms = 4000, fetch: get = globalThis.fetch } = {}) {
  const url = liveUrlOf(relay)
  if (!url) return null
  try {
    const res = await get(url, { signal: AbortSignal.timeout(ms), cache: 'no-store' })
    return res.ok ? liveOf(await res.json()) : null
  } catch {
    return null
  }
}
