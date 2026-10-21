<script>
  // Settings › Players (couch mode) : P1–P4 as the game reports them (lib/players.js), the device
  // driving each — a pad with its family and ANA / DIG, the keyboard or one of its halves — a row
  // lit while its device is pressed, swaps by ▲ ▼ or by dragging a row onto another, and « two
  // players on the keyboard ». The game applies a swap at its next input update.
  import { SLOTS } from './lib/players.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  const s = $derived(live.current)
  const rows = $derived(Array.from({ length: SLOTS }, (_, i) => ui.players[i] ?? { pad: null, keyboard: false, keyboard2: false, pressed: false }))
  const swap = (a, b) => globalThis.ctrUI?.players?.swap(a, b)

  let dragFrom = $state(-1)
  let dragOver = $state(-1)
  const onDragStart = (e, i) => {
    dragFrom = i
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', `P${i + 1}`)
  }
  const onDrop = (e, i) => {
    e.preventDefault()
    if (dragFrom >= 0) swap(dragFrom, i)
    dragFrom = -1
    dragOver = -1
  }
  const kbName = (second) => (s.duo ? (second ? T.keyboardRight : T.keyboardLeft) : T.keyboardDev)
</script>

<div class="players">
  <div class="label">{T.players}</div>
  <ol class="rows">
    {#each rows as r, i}
      <li class="row" class:lit={r.pressed} class:over={dragOver === i && dragFrom !== i} class:empty={!r.pad && !r.keyboard && !r.keyboard2}
        data-player={i + 1} draggable="true"
        ondragstart={(e) => onDragStart(e, i)} ondragend={() => { dragFrom = -1; dragOver = -1 }}
        ondragover={(e) => { if (dragFrom >= 0) { e.preventDefault(); dragOver = i } }} ondragleave={() => { if (dragOver === i) dragOver = -1 }}
        ondrop={(e) => onDrop(e, i)}>
        <span class="p p{i + 1}">P{i + 1}</span>
        <div class="dev">
          {#if r.pad}
            <span class="chip" data-device="pad" data-family={r.pad.family}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M7 6h10c3 0 4.5 2 5 5l.5 4c.3 2.5-2 4-4 2l-2.5-2.5h-8L5.5 17c-2 2-4.3.5-4-2L2 11c.5-3 2-5 5-5z" /></svg>
              <span class="name">{r.pad.name}<small>{T.families[r.pad.family]}</small></span>
              <span class="mode" class:dig={!r.pad.analog} title={T.analogHelp}>{r.pad.analog ? T.analog : T.digital}</span>
            </span>
          {/if}
          {#if r.keyboard}
            <span class="chip" data-device="keyboard">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" stroke-linecap="round" /></svg>
              <span class="name">{kbName(false)}</span>
            </span>
          {/if}
          {#if r.keyboard2}
            <span class="chip" data-device="keyboard2">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" stroke-linecap="round" /></svg>
              <span class="name">{kbName(true)}</span>
            </span>
          {/if}
          {#if !r.pad && !r.keyboard && !r.keyboard2}<span class="free">— {T.free} —</span>{/if}
        </div>
        <div class="move">
          <button type="button" class="up" aria-label={T.moveUp(i + 1)} title={T.moveUp(i + 1)} disabled={i === 0} onclick={() => swap(i, i - 1)}>▲</button>
          <button type="button" class="down" aria-label={T.moveDown(i + 1)} title={T.moveDown(i + 1)} disabled={i === SLOTS - 1} onclick={() => swap(i, i + 1)}>▼</button>
        </div>
      </li>
    {/each}
  </ol>
  <p class="help">{T.playersHelp}</p>

  <label class="setrow">
    <span>{T.duo}<small>{T.duoHelp}</small></span>
    <input id="ctr-duo" type="checkbox" role="switch" class="switch" checked={s.duo} onchange={(e) => settings.patch({ duo: e.currentTarget.checked })} />
  </label>
  <p class="help">{T.analogHelp}</p>
  <p class="help">{T.couchHelp}</p>
</div>

<style>
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 6px 2px 8px; }
  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .row { display: grid; grid-template-columns: 38px 1fr auto; gap: 10px; align-items: center; padding: 8px 8px 8px 10px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); border: 1px solid transparent; cursor: grab; transition: background 120ms, border-color 120ms; }
  .row.lit { background: rgba(79, 140, 255, 0.22); border-color: var(--accent); }
  .row.over { border-color: var(--line-strong); border-style: dashed; }
  .p { font: 400 18px var(--display); text-align: center; border-radius: 8px; padding: 2px 0; color: #111; }
  .p1 { background: #4f8cff; } .p2 { background: #ff5a5f; } .p3 { background: #3fd17a; } .p4 { background: #ffc94a; }
  .dev { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .chip { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; }
  .chip svg { flex: none; color: var(--ink-dim); }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name small { display: block; font-size: 11.5px; color: var(--ink-dim); }
  .mode { margin-left: auto; flex: none; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; padding: 2px 6px; border-radius: 6px; background: rgba(63, 209, 122, 0.2); color: #8ff0b6; }
  .mode.dig { background: rgba(255, 201, 74, 0.18); color: #ffd97a; }
  .free { color: var(--ink-dim); font-size: 13px; }
  .move { display: flex; flex-direction: column; gap: 2px; }
  .move button { width: 30px; height: 20px; border: 0; border-radius: 6px; background: rgba(255, 255, 255, 0.08); font-size: 10px; cursor: pointer; color: #fff; }
  .move button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
  .move button:disabled { opacity: 0.25; cursor: default; }
  .help { font-size: 12.5px; color: var(--ink-dim); margin: 8px 2px 12px; }
  .setrow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); }
  .setrow small { display: block; color: var(--ink-dim); font-size: 12.5px; margin-top: 2px; }
  .switch { appearance: none; flex: none; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.18); position: relative; cursor: pointer; transition: background 150ms; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 150ms; }
  .switch:checked { background: var(--accent); }
  .switch:checked::after { left: 21px; }
</style>
