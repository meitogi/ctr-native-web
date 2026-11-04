<script>
  // Settings › Dev (debug builds) : « Second window » (Online VS, Online Battle, Share — a guest
  // window beside this one playing as Bot, second.js ; the game page only), the page log over the
  // game (?log's), and the state a bug report needs — window.__ctr (the game,
  // platform/web_debug_bridge.c), __ctrOnline.state() (the room), __ctrShare.state() (Share) —
  // read twice a second, copied whole with one click.
  import { ui } from '../state.svelte.js'
  import { D } from './strings.js'

  let shown = $state(document.body.classList.contains('ctr-log'))
  let brief = $state('')
  let tail = $state('')

  const pick = (o, keys) => { if (!o) return null; const r = {}; for (const k of keys) r[k] = o[k]; return r }
  function snapshot(full) {
    const g = globalThis
    let online = null
    try { online = g.__ctrOnline?.state() ?? null } catch { /* not attached yet */ }
    const game = g.__ctr ? (full ? (({ track, ...s }) => s)(g.__ctr) : pick(g.__ctr, ['screen', 'levelID', 'menu', 'sub', 'charSelect', 'players', 'kart', 'fps'])) : null
    const room = online && (full ? online : { role: online.role, backend: online.backend, links: online.links?.length, phase: online.lobby?.phase, error: online.error })
    const share = g.__ctrShare?.state?.() ?? g.__ctrShareGuest?.state?.() ?? null
    return { game, online: room, share: full ? share : share && pick(share, ['sharing', 'state', 'slot', 'guests', 'error']) }
  }
  $effect(() => {
    const t = setInterval(() => {
      brief = JSON.stringify(snapshot(false), null, 1)
      tail = (document.getElementById('log')?.textContent ?? '').split('\n').slice(-12).join('\n')
    }, 500)
    return () => clearInterval(t)
  })
  const toggle = (on) => { shown = on; document.body.classList.toggle('ctr-log', on) }
  async function copy() {
    await navigator.clipboard?.writeText(JSON.stringify(snapshot(true), null, 1))
    globalThis.ctrUI?.toast(D.dev.copied)
  }
</script>

<div id="ctr-dev">
  {#if globalThis.ctrDev?.second}
    <div class="label">{D.second}</div>
    <div class="row" id="ctr-second">
      {#each Object.keys(D.secondModes) as m}
        <button type="button" class="btn" data-second={m} disabled={!!ui.second && !ui.second.error && ui.second.text !== D.secondSteps.racing && ui.second.text !== D.secondSteps.ready} onclick={() => globalThis.ctrDev.second(m)}>{D.secondModes[m]}</button>
      {/each}
    </div>
    <p class="help">{D.secondHelp}</p>
    {#if ui.second}<p class="help step" class:error={ui.second.error} aria-live="polite">{ui.second.text}</p>{/if}
  {/if}
  <div class="label">{D.dev.log}</div>
  <label class="setrow">
    <span>{D.dev.showLog}</span>
    <input id="ctr-dev-log" type="checkbox" role="switch" class="switch" checked={shown} onchange={(e) => toggle(e.currentTarget.checked)} />
  </label>
  <pre class="out">{tail}</pre>
  <div class="label">{D.dev.state}</div>
  <pre class="out" id="ctr-dev-state">{brief}</pre>
  <button type="button" class="btn" id="ctr-dev-copy" onclick={copy}>{D.dev.copy}</button>
</div>

<style>
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 20px 2px 8px; }
  .label:first-child { margin-top: 6px; }
  .setrow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); }
  .switch { appearance: none; flex: none; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.18); position: relative; cursor: pointer; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 150ms; }
  .switch:checked { background: var(--accent); }
  .switch:checked::after { left: 21px; }
  .out { margin: 8px 0 0; padding: 10px 12px; border-radius: 10px; background: rgba(0, 0, 0, 0.35); font: 11px/1.4 ui-monospace, Menlo, monospace; color: var(--ink-dim); max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-all; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .row .btn { margin-top: 0; }
  .help { font-size: 12px; color: var(--ink-dim); margin: 8px 2px 0; }
  .step { color: var(--accent-2); }
  .step.error { color: var(--danger); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn { margin-top: 10px; padding: 10px 16px; border: 0; border-radius: 12px; background: rgba(255, 255, 255, 0.08); font-weight: 600; font-size: 14px; cursor: pointer; }
  .btn:hover { background: rgba(255, 255, 255, 0.14); }
</style>
