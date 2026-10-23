<script>
  // The home's « Second window » row (debug builds) : Online VS, Online Battle, Share — a
  // pre-configured guest window beside this one, playing as Bot (second.js) ; its progress below.
  import { ui } from '../state.svelte.js'
  import { D } from './strings.js'
</script>

<div class="second" id="ctr-second">
  <div class="label">{D.second}</div>
  <div class="row">
    {#each Object.keys(D.secondModes) as m}
      <button type="button" class="btn" data-second={m} disabled={!!ui.second && !ui.second.error} onclick={() => globalThis.ctrDev.second(m)}>{D.secondModes[m]}</button>
    {/each}
  </div>
  <p class="help">{D.secondHelp}</p>
  {#if ui.second}<p class="help step" class:error={ui.second.error} aria-live="polite">{ui.second.text}</p>{/if}
</div>

<style>
  .second { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--line-strong); }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 0 2px 8px; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { padding: 9px 14px; border: 0; border-radius: 10px; background: rgba(255, 255, 255, 0.08); font-weight: 600; font-size: 14px; cursor: pointer; }
  .btn:hover { background: rgba(255, 255, 255, 0.14); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .help { font-size: 13px; color: var(--ink-dim); margin: 8px 2px 0; }
  .step { color: var(--accent-2); }
  .step.error { color: var(--danger); }
</style>
