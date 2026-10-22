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
  tab: 'player',
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
})
