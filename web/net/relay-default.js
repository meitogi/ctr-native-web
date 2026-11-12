// The relay a page uses when Settings › Netplay has none typed — the one place it is written. The
// Netplay panel (web/online/page.js), Share's (web/share/panel.js) and the home page's room code
// (web/ui/src/lib/join.js) import it ; web/dev.sh reads BUILT_IN_RELAY's line.
//
// A fork that publishes its own page points it at its own relay without editing this file :
// CTR_RELAY_URL at build time (web/build-web.sh → web/emscripten.cmake writes window.__CTR_RELAY
// into preload-flag.js, a classic script that runs before these modules ; the Pages workflow sets
// it from the repository variable of the same name). Without it, the built-in address.
//
// The built-in relay is public : it asks for no key, and holds its own limits (relay/README.md,
// « An open relay »). A relay with a key is one a player sets in Settings › Netplay, with its key
// there or in the room link (rk=).
//
// CTR_RELAY_KEY (window.__CTR_RELAY_KEY, the same way) is for a fork whose own relay has a key and
// whose players should never type it : a key built into a public page is public — anyone reads it
// in the page's source. It keeps other sites' pages and casual scans off, no more.

export const BUILT_IN_RELAY = 'wss://ctr.public.suuuper.app'
/** The built-in relay before the public one : private, its key typed or carried by a link. */
const FORMER_RELAY = 'wss://ctr-relay.suuuper.app'

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

/**
 * The relay a browser kept, as it is used today : the former built-in address kept with no key
 * was never a choice (a page saved the default it showed) and could open nothing — it is the
 * default again. With a key it is the player's private relay, and stays.
 */
export function keptRelay(relay, key) {
  return !relay || (relay === FORMER_RELAY && !key) ? DEFAULT_RELAY : relay
}

/** « public » for the relay this page comes with, « yours » for any other address. */
export const relayWord = (relay) => (relay.trim() === DEFAULT_RELAY ? 'public' : 'yours')
