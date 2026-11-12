// The relay a page uses when Settings › Netplay has none typed — the one place it is written. The
// Netplay panel (web/online/page.js), Share's (web/share/panel.js) and the home page's room code
// (web/ui/src/lib/join.js) import it ; web/dev.sh reads BUILT_IN_RELAY's line.
//
// A fork that publishes its own page points it at its own relay without editing this file :
// CTR_RELAY_URL at build time (web/build-web.sh → web/emscripten.cmake writes window.__CTR_RELAY
// into preload-flag.js, a classic script that runs before these modules ; the Pages workflow sets
// it from the repository variable of the same name). Without it, the built-in address.
//
// CTR_RELAY_KEY the same way (window.__CTR_RELAY_KEY), for a fork that wants its players never to
// type a key : a key built into a public page is public — anyone reads it in the page's source. It
// keeps other sites' pages and casual scans off, no more. Without it (and on our own site), no key :
// it comes in the room link (rk=) or is typed once in Settings › Netplay.

export const BUILT_IN_RELAY = 'wss://ctr-relay.suuuper.app'

/** The relay a build names, or the built-in one when it names none (or not a ws:// / wss:// URL). */
export function relayOf(built) {
  return typeof built === 'string' && /^wss?:\/\/[^\s"'\\]+$/.test(built) ? built : BUILT_IN_RELAY
}

/** The key a build names, or none (also when it holds anything a key never does). */
export function relayKeyOf(built) {
  return typeof built === 'string' && /^[A-Za-z0-9+/=_.~-]+$/.test(built) ? built : ''
}

export const DEFAULT_RELAY = relayOf(globalThis.__CTR_RELAY)
export const DEFAULT_RELAY_KEY = relayKeyOf(globalThis.__CTR_RELAY_KEY)
