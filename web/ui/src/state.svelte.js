// The page's shared UI state (Svelte 5 runes). One object, read and written by the components and
// by main.js's boot / drop flow.

export const ui = $state({
  // 'checking' (looking for a stored disc) · 'boot' (drop screen) · 'ready' (a stored disc, waiting
  // for the player's press) · 'preparing' (copy into OPFS) · 'starting' (game script injected) · 'running'
  phase: 'checking',
  status: '',
  error: '',
  // the copy into OPFS : { title, detail, written, total, kind, serial }
  progress: null,
  // whole-window drag overlay
  dragging: false,
  // the replace-disc / forget-disc confirmation : { text, action, run }
  confirm: null,
  settingsOpen: false,
  tab: 'players',
  // the Multiplayer tab's panel (an adopted id : 'share', 'online')
  multi: null,
  // Share's guest page : { slot, host, list: [{ slot, name }] } from the host's messages
  room: null,
  // an Online room's guest in the lobby (web/online/page.js) : the local keys and pads go to the
  // host, not to this game
  lobbyGuest: false,
  // a room link opened at boot (session 32e), or a Netplay code typed on the home page (28b) :
  // null, or { state: 'joining' | 'waiting' (the host's yes) | 'racing' | 'failed', reason }
  joining: null,
  // « or join a room » on the home page (28b, Join.svelte) : null, or { ids, at, said, phase :
  // 'dials' | 'looking' | 'nokey' | 'disc' (a Netplay room and no disc : the drop zone, saying why) }
  join: null,
  // a Netplay guest out of the room's race (its QUIT, a lost link ; web/online/page.js, session
  // 32f) : null, or { cup } — the band over the host's picture until the room takes it again
  waiting: null,
  // Share's guest page : the connection as web/share/guest-page.js reports it (guest.js)
  guest: null,
  // panels other modules hand over (web/online/page.js, web/share/panel.js) : { id, title, el }
  adopted: [],
  // { id, title, detail, family, leaving }
  toasts: [],
  // connected pads by Gamepad.index : { index, id, family, name }
  pads: [],
  // the game's four player slots (lib/players.js describe()) : { pad, keyboard, keyboard2, pressed }
  players: [],
  // the stored disc : { serial, size } or null
  disc: null,
  // the Controls tab is waiting for a key / button : { device: 'keyboard'|'gamepad', button }
  listening: null,
  notice: '',
  volumeOpen: false,
  // debug builds (src/dev/) : this window's « Bot » switch (lib/autopilot.js drives it), the second
  // window's progress line ({ mode, text, error })
  bot: false,
  second: null,
})
