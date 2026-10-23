// The bot's hands in the page (debug builds) : lib/autopilot.js's `out` as synthetic
// KeyboardEvents on window — where SDL listens for the game's keys and the guest pages for the pad
// they send (web/share/guest-page.js, web/online/page.js). Flagged `ctrBot` so App.svelte's
// Settings key capture lets them through. A press lasts 8 frames (a game frame at 30 fps on any
// display), 300 ms at most when the window is hidden and frames slow down.

const KEYS = {
  c: ['KeyC', 'c', 67], x: ['KeyX', 'x', 88], v: ['KeyV', 'v', 86], Enter: ['Enter', 'Enter', 13],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37], ArrowUp: ['ArrowUp', 'ArrowUp', 38], ArrowRight: ['ArrowRight', 'ArrowRight', 39], ArrowDown: ['ArrowDown', 'ArrowDown', 40],
}

function send(type, name) {
  const [code, key, keyCode] = KEYS[name]
  const e = new KeyboardEvent(type, { code, key, keyCode, which: keyCode, bubbles: true, cancelable: true })
  e.ctrBot = true
  window.dispatchEvent(e)
}

/** `n` animation frames, or `max` ms if the window paints no frame meanwhile. */
export function frames(n, max = 300) {
  return new Promise((done) => {
    let i = 0
    const timer = setTimeout(done, max)
    const step = () => { if (++i >= n) { clearTimeout(timer); done() } else requestAnimationFrame(step) }
    requestAnimationFrame(step)
  })
}

export const out = {
  hold: async (name) => send('keydown', name),
  release: async (name) => send('keyup', name),
  press: async (name) => { send('keydown', name); await frames(8); send('keyup', name) },
}
