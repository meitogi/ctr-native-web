// The one settings store of the page (lib/settings.js over localStorage), shared by main.js and
// the components ; `current` follows it for Svelte templates.
import { fromStore } from 'svelte/store'
import { createSettings } from './lib/settings.js'

const storage = (() => { try { return globalThis.localStorage } catch { return null } })()
export const settings = createSettings(storage)
export const live = fromStore(settings)
