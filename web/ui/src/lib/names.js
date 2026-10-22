// A player's default name : a short adjective and a CTR character, « Turbo Roo », drawn once on
// the first visit and stored as the player name (settings.js) — Share and Online both use it, the
// player can type their own in Settings › Players. At most NAME_LEN (9) printable ASCII
// characters, the wire format of OnlineCTR's names (game/OnlineCTR/global.h) : the pairs that do
// not fit are left out (test/names.test.js checks every pair against cleanName).

export const ADJECTIVES = ['Mad', 'Sly', 'Rad', 'Ace', 'Fab', 'Shy', 'Epic', 'Wild', 'Cool', 'Zany', 'Bold', 'Fast', 'Turbo', 'Nitro', 'Zippy', 'Wumpa', 'Comfy', 'Lucky', 'Spicy', 'Dizzy', 'Jolly', 'Brave', 'Swift', 'Funky']
export const CHARACTERS = ['Crash', 'Coco', 'Neo', 'Tiny', 'N.Gin', 'Dingo', 'Polar', 'Pura', 'Roo', 'Papu', 'Joe', 'Tropy', 'Oxide', 'Penta']

const MAX = 9 // settings.js NAME_LEN

/** Every name the generator can give. */
export const NAMES = ADJECTIVES.flatMap((a) => CHARACTERS.map((c) => `${a} ${c}`)).filter((n) => n.length <= MAX)

/** One of NAMES ; `rand` returns a number in [0, 1). */
export function randomName(rand = cryptoRandom) {
  return NAMES[Math.floor(rand() * NAMES.length) % NAMES.length]
}

function cryptoRandom() {
  const c = globalThis.crypto
  if (!c?.getRandomValues) return Math.random()
  return c.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
}
