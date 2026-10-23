<script>
  // The home : how to play — Solo, Share (this screen streamed, guests without a disc) or Online
  // (everyone with a disc). The choice is ui.mode ; the press, the Play button or the drop starts
  // the game in it (main.js startGame / bootMode). Shown in the ready card (a disc kept) and above
  // the drop zone (none yet : the drop starts the mode).
  // Debug builds (src/dev/SecondRow.svelte) add « Second window » : Online VS, Online Battle or Share
  // — a pre-configured guest window beside this one, playing as Bot (src/dev/second.js).
  import { MODES } from './lib/home.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'

  let { ready = false } = $props()
  // debug builds only : the second window's row, loaded with the dev tools
  let SecondRow = $state(null)
  if (__CTR_DEV__) import('./dev/SecondRow.svelte').then((m) => { SecondRow = m.default })
</script>

<div id="ctr-home" class:ready>
  <div class="label">{T.home.choose}</div>
  <div class="modes" role="radiogroup" aria-label={T.home.choose}>
    {#each MODES as m}
      <button type="button" role="radio" data-mode={m} aria-checked={ui.mode === m} class:on={ui.mode === m} onclick={() => { ui.mode = m }}>
        <span class="name">{T.home.modes[m]}</span>
      </button>
    {/each}
  </div>
  <p class="help">{T.home.help[ui.mode]}</p>
  {#if !ready}<p class="help then">{T.home.thenDrop}</p>{/if}

  {#if ready && SecondRow}<SecondRow />{/if}
</div>

<style>
  #ctr-home { width: 100%; text-align: left; margin-bottom: 14px; }
  #ctr-home.ready { margin: 18px 0 0; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 0 2px 8px; }
  .modes { display: flex; padding: 4px; border-radius: 14px; gap: 4px; background: rgba(255, 255, 255, 0.06); }
  .modes button { flex: 1; padding: 10px 8px; border: 0; border-radius: 10px; background: none; cursor: pointer; color: var(--ink-dim); font: 400 18px var(--display); letter-spacing: 0.01em; }
  .modes button.on { background: #fff; color: #111; }
  .modes button:not(.on):hover { color: #fff; }
  .help { font-size: 13px; color: var(--ink-dim); margin: 8px 2px 0; min-height: 2.8em; }
  .help.then { min-height: 0; margin-top: 2px; }
</style>
