// The home page's pictures of a room code (session 28b) : one flat animal per name, by the
// game's character id (web/net/code.js CODE_NAMES). The page has no disc when it shows them, so
// none of the game's art is used : these are original drawings, made for this project (the code's
// licence), a generic animal each — no face, hair, outfit or pose of a character taken. In the
// game the dials keep the game's own icons.
// Each entry is the inside of a 64 × 64 <svg> ; Picto.svelte wraps it.
const INK = '#1b1b22'
const eyes = (y, a = 24.5, b = 39.5, r = 2.8) => `<circle cx="${a}" cy="${y}" r="${r}" fill="${INK}"/><circle cx="${b}" cy="${y}" r="${r}" fill="${INK}"/>`
const disc = (color) => `<circle cx="32" cy="32" r="30" fill="${color}"/>`
// a fox-like marsupial : pointed ears, a long snout ; `fur` and `ear` recolour it
const fox = (ground, fur, ear) => `${disc(ground)}<path d="M13 24 15 7 28 20Z M51 24 49 7 36 20Z" fill="${ear}"/><path d="M11 22 24 17h16l13 5L32 57Z" fill="${fur}"/><path d="M23 37 32 57 41 37 32 42Z" fill="#fff4e6"/><circle cx="32" cy="53" r="3.2" fill="${INK}"/>`

export const PICTOS = [
  // 0 Crash : the fox-like marsupial
  `${fox('#ffe8cc', '#ff7a1a', '#d9480f')}${eyes(30)}`,
  // 1 Cortex : an owl with round glasses, the brain of the band
  `${disc('#fff9db')}<path d="M15 22 14 8 26 16Z M49 22 50 8 38 16Z" fill="#f08c00"/><ellipse cx="32" cy="36" rx="19" ry="21" fill="#ffd43b"/><path d="M22 46q10 9 20 0q-10 14-20 0Z" fill="#f08c00"/><circle cx="23.5" cy="29" r="8.5" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="40.5" cy="29" r="8.5" fill="#fff" stroke="${INK}" stroke-width="3"/>${eyes(29.5, 24.5, 39.5, 3)}<path d="M29 37h6l-3 6Z" fill="#e8590c"/>`,
  // 2 Tiny : a tiger
  `${disc('#d3f9d8')}<circle cx="17" cy="17" r="7" fill="#f59f00"/><circle cx="47" cy="17" r="7" fill="#f59f00"/><rect x="11" y="13" width="42" height="42" rx="16" fill="#fcc419"/><path d="M27 13h10l-5 11Z M11 30l9 3-9 4Z M53 30l-9 3 9 4Z M21 13l4 7-7-3Z M43 13l-4 7 7-3Z" fill="${INK}"/><ellipse cx="32" cy="44" rx="10" ry="7" fill="#fff"/><path d="M28 40h8l-4 5Z" fill="${INK}"/>${eyes(32, 23.5, 40.5)}`,
  // 3 Coco : a cockatoo — « Coco », the parrot's name
  `${disc('#ffdeeb')}<path d="M22 22C16 12 20 5 27 4c-3 5-1 9 2 13Z M30 19C28 9 34 3 41 5c-5 3-6 8-5 13Z M38 21C40 13 47 10 53 14c-6 1-9 5-10 10Z" fill="#ffd43b"/><circle cx="30" cy="37" r="18" fill="#ff7eb6"/><circle cx="26" cy="33" r="5.5" fill="#fff"/><circle cx="27" cy="33.5" r="2.6" fill="${INK}"/><path d="M40 30c10 0 14 8 10 18c-2-6-6-8-12-8Z" fill="${INK}"/>`,
  // 4 N. Gin : a narwhal, its horn up
  `${disc('#dbe4ff')}<path d="M37 30 55 5 44 33Z" fill="#ffd43b"/><path d="M42 24l4 3M46 18l4 3" stroke="#f08c00" stroke-width="2" stroke-linecap="round"/><ellipse cx="30" cy="41" rx="20" ry="15" fill="#5c7cfa"/><ellipse cx="29" cy="48" rx="13" ry="7" fill="#bac8ff"/>${eyes(38, 21, 37)}<path d="M25 44q4 3 8 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
  // 5 Dingodile : a crocodile, in profile
  `${disc('#e9fac8')}<circle cx="21" cy="25" r="8" fill="#5c940d"/><path d="M7 38Q7 25 21 25L52 30Q59 31 59 36.500Q59 42 52 42.500L21 47Q7 47 7 38Z" fill="#74b816"/><circle cx="21" cy="24.500" r="4.200" fill="#fff"/><circle cx="22" cy="24.500" r="2.200" fill="${INK}"/><path d="M28 45.500l3 6 3-6.800Z M37 44.200l3 6 3-6.800Z M46 43l3 6 3-6.800Z" fill="#fff"/><circle cx="54" cy="34" r="1.600" fill="${INK}"/><path d="M26 38.500 56 38" stroke="#5c940d" stroke-width="2" stroke-linecap="round"/>`,
  // 6 Polar : a polar bear
  `${disc('#a5d8ff')}<circle cx="18" cy="19" r="8" fill="#fff"/><circle cx="46" cy="19" r="8" fill="#fff"/><circle cx="18" cy="19" r="4" fill="#ced4da"/><circle cx="46" cy="19" r="4" fill="#ced4da"/><circle cx="32" cy="36" r="21" fill="#fff"/><ellipse cx="32" cy="43" rx="10" ry="8" fill="#e9ecef"/><ellipse cx="32" cy="39.500" rx="4.500" ry="3.200" fill="${INK}"/>${eyes(31, 23.5, 40.5)}`,
  // 7 Pura : a kitten
  `${disc('#e5dbff')}<path d="M13 31 15 9 31 20Z M51 31 49 9 33 20Z" fill="#7950f2"/><path d="M17 24 18 14 25 20Z M47 24 46 14 39 20Z" fill="#fcc2d7"/><ellipse cx="32" cy="38" rx="21" ry="18" fill="#9775fa"/>${eyes(35, 23.5, 40.5, 3)}<path d="M29.500 41h5l-2.500 3.500Z" fill="#fcc2d7"/><path d="M7 39h11M8 46l10-3M57 39H46M56 46l-10-3" stroke="${INK}" stroke-width="1.600" stroke-linecap="round"/>`,
  // 8 Pinstripe : a zebra — the stripes
  `${disc('#ffc9c9')}<path d="M20 20 15 6 27 12Z M44 20 49 6 37 12Z" fill="#fff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><rect x="19" y="11" width="26" height="45" rx="13" fill="#fff"/><rect x="28.500" y="5" width="7" height="15" rx="3.500" fill="${INK}"/><path d="M19 24l10 2.500-10 3Z M45 24l-10 2.500 10 3Z M19 36l8 2-8 2.500Z M45 36l-8 2 8 2.500Z" fill="${INK}"/><path d="M19.500 44h25v-1q0 13-12.500 13T19.500 43Z" fill="#343a40"/><circle cx="27.500" cy="49" r="1.800" fill="#ced4da"/><circle cx="36.500" cy="49" r="1.800" fill="#ced4da"/>${eyes(32, 26.5, 37.5, 2.4)}`,
  // 9 Papu Papu : a hippo, the big chief
  `${disc('#f3d9fa')}<circle cx="16" cy="16" r="6" fill="#ae3ec9"/><circle cx="48" cy="16" r="6" fill="#ae3ec9"/><rect x="12" y="12" width="40" height="32" rx="15" fill="#cc5de8"/><rect x="7" y="31" width="50" height="25" rx="12.500" fill="#da77f2"/><ellipse cx="24" cy="40" rx="2.600" ry="3.400" fill="${INK}"/><ellipse cx="40" cy="40" rx="2.600" ry="3.400" fill="${INK}"/>${eyes(23, 23, 41)}<rect x="22" y="52" width="6" height="6" rx="1.500" fill="#fff"/><rect x="36" y="52" width="6" height="6" rx="1.500" fill="#fff"/>`,
  // 10 Ripper Roo : a kangaroo, long ears
  `${disc('#c5f6fa')}<ellipse cx="21" cy="15" rx="5.500" ry="14" transform="rotate(-14 21 15)" fill="#1c7ed6"/><ellipse cx="43" cy="15" rx="5.500" ry="14" transform="rotate(14 43 15)" fill="#1c7ed6"/><path d="M15 31Q15 18 32 18Q49 18 49 31Q49 45 38 53Q32 57 26 53Q15 45 15 31Z" fill="#4dabf7"/><ellipse cx="32" cy="46.500" rx="8.500" ry="7.500" fill="#d0ebff"/><ellipse cx="32" cy="43" rx="4.500" ry="2.800" fill="${INK}"/>${eyes(31, 24.5, 39.5)}`,
  // 11 Komodo Joe : a lizard, its forked tongue out
  `${disc('#c3fae8')}<path d="M32 44v9l-4 5M32 53l4 5" fill="none" stroke="#e03131" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="20" r="7.500" fill="#099268"/><circle cx="47" cy="20" r="7.500" fill="#099268"/><path d="M9 30Q9 17 32 17Q55 17 55 30Q55 41 32 49Q9 41 9 30Z" fill="#12b886"/><circle cx="17" cy="20.500" r="4.200" fill="#fff3bf"/><circle cx="47" cy="20.500" r="4.200" fill="#fff3bf"/><ellipse cx="17" cy="20.500" rx="1.400" ry="3.400" fill="${INK}"/><ellipse cx="47" cy="20.500" rx="1.400" ry="3.400" fill="${INK}"/><circle cx="28" cy="40" r="1.500" fill="${INK}"/><circle cx="36" cy="40" r="1.500" fill="${INK}"/><circle cx="24" cy="29" r="2" fill="#63e6be"/><circle cx="38" cy="27" r="2.600" fill="#63e6be"/><circle cx="32" cy="33" r="1.800" fill="#63e6be"/>`,
  // 12 N. Tropy : a white rabbit — the one who watches the time
  `${disc('#ffec99')}<rect x="18.500" y="2" width="10" height="30" rx="5" fill="#fff"/><rect x="35.500" y="2" width="10" height="30" rx="5" fill="#fff"/><rect x="21.500" y="6" width="4" height="20" rx="2" fill="#fcc2d7"/><rect x="38.500" y="6" width="4" height="20" rx="2" fill="#fcc2d7"/><circle cx="32" cy="40" r="18" fill="#fff"/>${eyes(37, 24.5, 39.5)}<path d="M29.500 43h5l-2.500 3Z" fill="#f783ac"/><rect x="29.500" y="48" width="5" height="6" rx="1" fill="#fff" stroke="${INK}" stroke-width="1.600"/>`,
  // 13 Penta : a penguin
  `${disc('#ffd8a8')}<ellipse cx="32" cy="34" rx="20" ry="24" fill="#212529"/><path d="M32 21Q20 15 17.500 30Q16 50 32 55Q48 50 46.500 30Q44 15 32 21Z" fill="#fff"/>${eyes(30, 24.5, 39.5)}<path d="M26.500 36h11L32 44Z" fill="#fd7e14"/>`,
  // 14 Fake Crash : the fox again, in another coat and a joke-shop disguise
  `${fox('#dee2e6', '#7048e8', '#5f3dc4')}<path d="M18 22.500h10v3H18Z M36 22.500h10v3H36Z" fill="${INK}"/><circle cx="24" cy="30.500" r="5.200" fill="#fff" stroke="${INK}" stroke-width="2.400"/><circle cx="40" cy="30.500" r="5.200" fill="#fff" stroke="${INK}" stroke-width="2.400"/><path d="M29 30.500h6" stroke="${INK}" stroke-width="2.400"/>${eyes(30.5, 24, 40, 2)}<path d="M23 44Q28 38 32 42Q36 38 41 44Q36 47 32 44.500Q28 47 23 44Z" fill="${INK}"/>`,
]
