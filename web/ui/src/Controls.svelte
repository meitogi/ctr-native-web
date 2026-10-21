<script>
  // Settings › Controls : every PSX button, its keyboard key and its gamepad button (and the second
  // keyboard's key while two players share it : Settings › Players). Click a box,
  // press the key or button (App.svelte routes the press here through ui.listening) ; conflicts
  // shown on both buttons ; reset per device. Saved at once (settings store → localStorage), the
  // game reads it at its next input update (Module.ctrInput.pull).
  import Glyph from './Glyph.svelte'
  import { BUTTONS, DEFAULT_GAMEPAD, DEFAULT_KEYBOARD, DEFAULT_KEYBOARD_LEFT, DEFAULT_KEYBOARD_RIGHT, DISPLAY_ORDER, conflicts } from './lib/mappings.js'
  import { codeOf } from './lib/keys.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  let { layout = null } = $props()

  const s = $derived(live.current)

  let device = $state(ui.pads.length ? 'gamepad' : 'keyboard')
  const pad = $derived(ui.pads[0] ?? null)
  const family = $derived(pad?.family ?? 'other')
  // the settings field each device edits : the keyboard is its left half while two players share it
  const FIELD = { keyboard: () => (s.duo ? 'keyboardLeft' : 'keyboard'), keyboard2: () => 'keyboardRight', gamepad: () => 'gamepad' }
  const DEFAULTS = { keyboard: DEFAULT_KEYBOARD, keyboardLeft: DEFAULT_KEYBOARD_LEFT, keyboardRight: DEFAULT_KEYBOARD_RIGHT, gamepad: DEFAULT_GAMEPAD }
  $effect(() => { if (device === 'keyboard2' && !s.duo) device = 'keyboard' })
  const map = $derived(s[FIELD[device]()])
  const clash = $derived(conflicts(map))

  const listen = (button) => {
    ui.notice = ''
    ui.listening = ui.listening?.button === button && ui.listening.device === device ? null : { device, button }
  }
  const reset = () => {
    ui.listening = null
    ui.notice = ''
    const field = FIELD[device]()
    settings.patch({ [field]: DEFAULTS[field].slice() })
  }
  const label = (b) => T.buttons[b][0]
  const firstClash = $derived.by(() => {
    for (const b of DISPLAY_ORDER) if (clash[b]) return [b, clash[b][0]]
    return null
  })
</script>

<div class="controls">
  <div class="seg" role="tablist">
    <button role="tab" aria-selected={device === 'keyboard'} class:on={device === 'keyboard'} onclick={() => { device = 'keyboard'; ui.listening = null }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" stroke-linecap="round" /></svg>
      {s.duo ? T.keyboardLeft : T.keyboard}
    </button>
    {#if s.duo}
      <button role="tab" data-device="keyboard2" aria-selected={device === 'keyboard2'} class:on={device === 'keyboard2'} onclick={() => { device = 'keyboard2'; ui.listening = null }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" stroke-linecap="round" /></svg>
        {T.keyboardRight}
      </button>
    {/if}
    <button role="tab" aria-selected={device === 'gamepad'} class:on={device === 'gamepad'} onclick={() => { device = 'gamepad'; ui.listening = null }}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M7 6h10c3 0 4.5 2 5 5l.5 4c.3 2.5-2 4-4 2l-2.5-2.5h-8L5.5 17c-2 2-4.3.5-4-2L2 11c.5-3 2-5 5-5z" /></svg>
      {pad ? T.families[family] : T.gamepad}
    </button>
  </div>
  <p class="help">{device === 'gamepad' && !pad ? T.noPad : T.remapHelp}</p>

  <div class="rows" data-device={device}>
    {#each DISPLAY_ORDER as b}
      {@const i = BUTTONS.indexOf(b)}
      {@const isListening = ui.listening?.device === device && ui.listening.button === b}
      <div class="row" class:sel={isListening}>
        <Glyph kind="psx" value={b} />
        <div class="name">{label(b)}{#if T.buttons[b][1]}<small>{T.buttons[b][1]}</small>{/if}</div>
        <button type="button" class="cell" class:clash={clash[b]} class:listen={isListening} data-button={b}
          aria-label={`${label(b)} : ${device}`} onclick={() => listen(b)}>
          {#if isListening}
            <span class="pulse">{T.listening}</span>
          {:else if device !== 'gamepad'}
            <Glyph kind="key" value={codeOf(map[i])} {layout} />
          {:else}
            <Glyph kind="pad" value={map[i]} {family} />
          {/if}
        </button>
      </div>
    {/each}
  </div>

  {#if ui.listening}
    <p class="note">{ui.listening.device !== 'gamepad' ? T.listeningKey : T.listeningPad}</p>
  {/if}
  {#if ui.notice}<p class="note warn">{ui.notice}</p>{/if}
  {#if firstClash}
    <p class="note warn" data-conflict>{T.conflict(label(firstClash[0]), label(firstClash[1]))}</p>
  {/if}

  <div class="foot">
    <button type="button" class="btn" onclick={reset}>{T.reset}</button>
    <span class="dim">{T.savedAuto}</span>
  </div>
</div>

<style>
  .seg { display: flex; padding: 4px; border-radius: 12px; gap: 4px; background: rgba(255, 255, 255, 0.06); }
  .seg button { flex: 1; display: flex; gap: 8px; align-items: center; justify-content: center; padding: 8px 10px; border: 0; border-radius: 9px; background: none; font-weight: 600; font-size: 13px; cursor: pointer; color: var(--ink-dim); }
  .seg button.on { background: #fff; color: #111; }
  .help { margin: 10px 2px 8px; font-size: 13px; color: var(--ink-dim); }
  .rows { display: grid; gap: 2px; }
  .row { display: grid; grid-template-columns: 40px 1fr 112px; gap: 12px; align-items: center; padding: 5px 8px; border-radius: 10px; }
  .row > :global(.glyph:first-child) { justify-self: center; }
  .row.sel { background: rgba(255, 255, 255, 0.06); }
  .name { font-size: 14px; }
  .name small { display: block; font-size: 11.5px; color: var(--ink-dim); }
  .cell { height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--line); padding: 0 6px; white-space: nowrap; overflow: hidden; }
  .cell:hover { border-color: var(--line-strong); }
  .cell.clash { border-color: var(--danger); background: rgba(255, 80, 80, 0.12); }
  .cell.listen { border-color: var(--accent); background: rgba(79, 140, 255, 0.18); color: #cfe0ff; font-weight: 600; font-size: 13px; }
  .pulse { animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  .note { margin: 10px 4px 0; font-size: 13px; color: #cfe0ff; }
  .note.warn { color: var(--danger); }
  .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
  .btn { padding: 9px 16px; border: 0; border-radius: 12px; background: rgba(255, 255, 255, 0.08); font-weight: 600; font-size: 14px; cursor: pointer; }
  .btn:hover { background: rgba(255, 255, 255, 0.14); }
  .dim { color: var(--ink-dim); font-size: 12px; }
</style>
