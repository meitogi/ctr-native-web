<script>
  // Settings › Players : « Who plays on this page » — Auto (the keyboard and the gamepads), Keyboard
  // only, Gamepad only and which one. Per page (settings.js deviceKey) : the game and Share's guest
  // page on one machine each keep their own, so one controller seen by both windows drives one
  // player. The game applies it at its next input update (input-hook.js), the guest page in its
  // pad merge (web/share/protocol.js pickPad).
  import { DEVICE_MODES } from './lib/settings.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  const s = $derived(live.current)
  const mode = $derived(s.device.mode)
  // a pad is named by its Gamepad API id and its rank among the connected pads with that id
  const pads = $derived(ui.pads.map((p, i) => ({ ...p, nth: ui.pads.slice(0, i).filter((q) => q.id === p.id).length })))
  const chosen = (p) => s.device.pad?.id === p.id && s.device.pad.nth === p.nth
  const setMode = (m) => settings.patch({ device: { mode: m, pad: m === 'gamepad' ? s.device.pad : null } })
  const choose = (p) => settings.patch({ device: { mode: 'gamepad', pad: p ? { id: p.id, nth: p.nth } : null } })
</script>

<div class="label">{T.whoPlays}</div>
<div class="seg" role="radiogroup" aria-label={T.whoPlays}>
  {#each DEVICE_MODES as m}
    <button type="button" role="radio" id={`ctr-device-${m}`} aria-checked={mode === m} class:on={mode === m} onclick={() => setMode(m)}>{T.modes[m]}</button>
  {/each}
</div>
<p class="help">{T.modeHelp[mode]} {T.whoPlaysHelp}</p>
{#if mode === 'gamepad'}
  <div class="pads" role="radiogroup" aria-label={T.whichPad}>
    <button type="button" role="radio" class="pad" data-pad="" aria-checked={!s.device.pad} class:on={!s.device.pad} onclick={() => choose(null)}>{T.firstPad}</button>
    {#each pads as p (p.index)}
      <button type="button" role="radio" class="pad" data-pad={p.index} aria-checked={chosen(p)} class:on={chosen(p)} onclick={() => choose(p)}>
        {p.name}<small>{T.families[p.family]}{p.nth ? ` · ${p.nth + 1}` : ''}</small>
      </button>
    {/each}
  </div>
{/if}

<style>
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 20px 2px 8px; }
  .seg { display: flex; padding: 4px; border-radius: 12px; gap: 4px; background: rgba(255, 255, 255, 0.06); }
  .seg button { flex: 1; padding: 8px 10px; border: 0; border-radius: 9px; background: none; font-weight: 600; font-size: 13px; cursor: pointer; color: var(--ink-dim); }
  .seg button.on { background: #fff; color: #111; }
  .help { font-size: 12px; color: var(--ink-dim); margin: 8px 2px 0; }
  .pads { display: grid; gap: 4px; margin-top: 10px; }
  .pad { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.04); font-size: 14px; text-align: left; cursor: pointer; }
  .pad small { color: var(--ink-dim); font-size: 12px; }
  .pad.on { border-color: var(--accent); background: rgba(79, 140, 255, 0.16); }
</style>
