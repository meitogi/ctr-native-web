// Which pad is this : the Gamepad API `id` string → family (PlayStation / Xbox / Nintendo / other),
// USB vendor / product ids when the browser gives them, and a display name.
//
// Shapes of `id` (test/pads.test.js has real ones) :
//   Chromium : "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
//              "Xbox 360 Controller (XInput STANDARD GAMEPAD)"            (Windows, no ids)
//   Firefox  : "054c-0ce6-DualSense Wireless Controller"
//              "45e-b13-Xbox Wireless Controller"                         (macOS : no zero padding)
//              "xinput"                                                    (Windows XInput)
//   Safari   : "DualSense Wireless Controller", "Xbox Wireless Controller", "Pro Controller"
//              (the controller's product name only)
//
// Vendors : Sony 054c, Microsoft 045e, Nintendo 057e (USB-IF ids).

export const VENDORS = { '054c': 'playstation', '045e': 'xbox', '057e': 'nintendo' }

const NAME_HINTS = [
  [/dualsense|dualshock|playstation|\bps[345]\b|sony/i, 'playstation'],
  [/xbox|xinput|x-box|microsoft/i, 'xbox'],
  [/nintendo|switch|pro controller|joy-?con/i, 'nintendo'],
]

const hex4 = (s) => s.toLowerCase().padStart(4, '0')

/**
 * @param {string} id - Gamepad.id
 * @returns {{ family: 'playstation'|'xbox'|'nintendo'|'other', vendor: string, product: string, name: string }}
 */
export function parsePadId(id = '') {
  let vendor = ''
  let product = ''
  let name = String(id).trim()

  // Chromium : "Name (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)" or "(… Vendor: 054c Product: 0ce6)"
  let m = /\(([^()]*?)Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})\s*\)\s*$/i.exec(name)
  if (m) {
    vendor = hex4(m[2])
    product = hex4(m[3])
    name = name.slice(0, m.index).trim()
  } else {
    // Firefox : "054c-0ce6-Name"
    m = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-(.*)$/i.exec(name)
    if (m) {
      vendor = hex4(m[1])
      product = hex4(m[2])
      name = m[3].trim()
    }
  }
  // "(XInput STANDARD GAMEPAD)", "(STANDARD GAMEPAD)" without ids
  name = name.replace(/\s*\((?:XInput\s+)?STANDARD GAMEPAD\)\s*$/i, '').trim()

  let family = VENDORS[vendor] ?? ''
  if (!family) {
    for (const [re, f] of NAME_HINTS) {
      if (re.test(id)) { family = f; break }
    }
  }
  if (!name || /^xinput$/i.test(name)) name = family === 'xbox' ? 'Xbox Controller' : 'Gamepad'
  return { family: family || 'other', vendor, product, name }
}

// The four face buttons, by position (SDL : SOUTH, EAST, WEST, NORTH), as each family labels them.
// Nintendo prints B at the bottom and A on the right — the remap follows the position (user's
// choice), the glyph shows the pad's own label.
export const FACE_LABELS = {
  playstation: ['cross', 'circle', 'square', 'triangle'],
  xbox: ['A', 'B', 'X', 'Y'],
  nintendo: ['B', 'A', 'Y', 'X'],
  other: ['south', 'east', 'west', 'north'],
}

/** Shoulder / trigger / menu labels per family : [L1, R1, L2, R2, L3, R3, Back, Start, Guide]. */
export const OTHER_LABELS = {
  playstation: ['L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'Share', 'Options', 'PS'],
  xbox: ['LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'View', 'Menu', 'Xbox'],
  nintendo: ['L', 'R', 'ZL', 'ZR', 'LS', 'RS', '−', '+', 'Home'],
  other: ['L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'Back', 'Start', 'Home'],
}

/** The family of a pad from its USB vendor id (a number, 0 when unknown) and its name. */
export function padFamily(vendor, name = '') {
  const v = vendor ? VENDORS[vendor.toString(16).padStart(4, '0')] : ''
  return v || parsePadId(name).family
}
