// The one settings store of the page (lib/settings.js over localStorage), shared by main.js and
// the components ; `current` follows it for Svelte templates. Share's guest page
// (<html data-page="share-guest">) keeps its own « Who plays » key : one machine opening both
// pages gives each its own device.
import { fromStore } from 'svelte/store'
import { BOT_SEED, memoryStorage, pageRole } from './lib/second-window.js'
import { GUEST_DEVICE_KEY, KEYS, createSettings } from './lib/settings.js'

// A bot's page (?bot : Settings › Dev's second window, web/*/bot.sh) keeps its settings in memory —
// « Bot », the keyboard, the default keys — and never writes the player's.
export const role = pageRole(globalThis.location?.search ?? '')
const storage = role.bot ? memoryStorage(BOT_SEED) : (() => { try { return globalThis.localStorage } catch { return null } })()
export const guestPage = globalThis.document?.documentElement?.dataset.page === 'share-guest'
export const settings = createSettings(storage, { deviceKey: guestPage ? GUEST_DEVICE_KEY : KEYS.device })
export const live = fromStore(settings)
