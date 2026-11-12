<script>
  // « or join a room » (session 28b) : the home page turned into the room code's dials — the
  // game's JOIN, in the page, with the page's own pictures (no disc yet). One dial per character :
  // Up / Down turn it, Left / Right change dial, Right past the last adds one, Square takes it
  // away, Start joins, Triangle goes back ; the mouse clicks the same things. App.svelte sends
  // the keys and the pad here through `actions.press`.
  // Phases : 'dials' · 'looking' (the relay is asked who hosts the room) · 'nokey' (no relay key
  // in this browser, or a refused one : typed here once).
  import Glyph from './Glyph.svelte'
  import Picto from './Picto.svelte'
  import { CODE_MAX, CODE_MIN, CODE_NAMES } from '../../net/code.js'
  import { SAID } from './lib/join.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'

  let { actions } = $props()
  const j = $derived(ui.join)
  let relay = $state(actions.where().relay)
  let rk = $state(actions.where().rk)
</script>

{#if j.phase === 'nokey'}
  <section id="join-nokey" class="card">
    <div class="disp big bad">{j.said === SAID.keyRefused ? T.joinSaid[SAID.keyRefused] : T.joinSaid[SAID.noKey]}</div>
    <p class="dim">{T.joinNoKeyHelp}</p>
    <form onsubmit={(e) => { e.preventDefault(); actions.saveKey(relay.trim(), rk.trim()) }}>
      <label>{T.joinRelay}<input id="join-relay" type="text" bind:value={relay} autocomplete="off" spellcheck="false" /></label>
      <!-- svelte-ignore a11y_autofocus -->
      <label>{T.joinRelayKey}<input id="join-rk" type="password" bind:value={rk} autocomplete="off" autofocus /></label>
      <div class="row">
        <button id="join-back" type="button" class="ghost" onclick={actions.toDials}>{T.joinBack}</button>
        <button id="join-save" type="submit" class="primary" disabled={!relay.trim() || !rk.trim()}>{T.joinSaveKey}</button>
      </div>
    </form>
    <p class="dim small">{T.joinKeyKept}</p>
  </section>
{:else if j.phase === 'looking'}
  <section id="join-looking" class="card" aria-live="polite">
    <div class="code small-code">{#each j.ids as id}<Picto {id} size={40} />{/each}</div>
    <div class="disp big">{T.joinLooking}</div>
    <span class="spinner" aria-hidden="true"></span>
    <button id="join-back" type="button" class="ghost" onclick={actions.toDials}>{T.joinBack} <Glyph kind="psx" value="triangle" size={18} /></button>
  </section>
{:else}
  <section id="join-code" class="card" data-code={j.ids.join(',')} data-at={j.at}>
    <div class="disp big">{T.joinCodeTitle}</div>
    <p class="dim">{T.joinCodeHelp}</p>
    <div class="dials" role="group" aria-label={T.joinCodeTitle}>
      {#each j.ids as id, i}
        <div class="dial" class:at={i === j.at}>
          <button type="button" class="turn" aria-label={T.joinPrev} onclick={() => actions.turn(i, 'up')}>▲</button>
          <button type="button" class="face" aria-label={CODE_NAMES[id]} onclick={() => actions.pick(i)}><Picto {id} /></button>
          <span class="name">{CODE_NAMES[id]}</span>
          <button type="button" class="turn" aria-label={T.joinNext} onclick={() => actions.turn(i, 'down')}>▼</button>
        </div>
      {/each}
      {#if j.ids.length < CODE_MAX}
        <button id="join-more" type="button" class="more" title={T.joinMore} aria-label={T.joinMore} onclick={actions.more}>+</button>
      {/if}
    </div>
    {#if j.ids.length > CODE_MIN}
      <button id="join-less" type="button" class="link" onclick={() => actions.press('square')}>{T.joinLess} <Glyph kind="psx" value="square" size={18} /></button>
    {/if}
    <div id="join-said" class="said" role="alert">{j.said ? T.joinSaid[j.said] ?? T.joinSaid[SAID.offline] : ''}</div>
    {#if T.joinSaidHelp[j.said]}<p id="join-said-help" class="dim">{T.joinSaidHelp[j.said]}</p>{/if}
    <div class="row">
      <button id="join-back" type="button" class="ghost" onclick={actions.close}>{T.joinBack} <Glyph kind="psx" value="triangle" size={18} /></button>
      <button id="join-go" type="button" class="primary" onclick={actions.go}>{T.joinGo} <Glyph kind="psx" value="start" size={18} /></button>
    </div>
  </section>
{/if}

<style>
  .card { width: 100%; box-sizing: border-box; padding: 28px 28px 24px; display: flex; flex-direction: column; align-items: center; gap: 6px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 24px; backdrop-filter: blur(20px); }
  .disp { font-family: var(--display); font-size: 22px; }
  .disp.big { font-size: 28px; }
  .bad { color: var(--danger); }
  .dim { color: var(--ink-dim); margin: 0; }
  .small { font-size: 13px; }
  .dials { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 18px 0 6px; }
  .dial { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 8px; border-radius: 18px; border: 2px solid transparent; }
  .dial.at { border-color: var(--accent); background: rgba(79, 140, 255, 0.1); }
  .face { padding: 0; border: 0; background: none; cursor: pointer; line-height: 0; border-radius: 50%; }
  .name { font-family: var(--display); font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
  .turn { width: 34px; height: 22px; padding: 0; border: 0; border-radius: 8px; background: none; color: var(--ink-dim); font-size: 12px; cursor: pointer; }
  .dial.at .turn { color: var(--accent-2); }
  .turn:hover { background: rgba(255, 255, 255, 0.08); color: var(--ink); }
  .more { width: 56px; height: 56px; border-radius: 50%; border: 2px dashed var(--line-strong); background: none; color: var(--ink-dim); font: 400 26px var(--display); cursor: pointer; }
  .more:hover { color: var(--ink); border-color: var(--ink-dim); }
  .said { min-height: 1.5em; margin-top: 6px; font-family: var(--display); font-size: 20px; letter-spacing: 0.03em; color: var(--danger); }
  .row { display: flex; gap: 12px; justify-content: center; align-items: center; margin-top: 10px; }
  .primary, .ghost { display: inline-flex; align-items: center; gap: 8px; padding: 11px 22px; border-radius: 12px; font-weight: 700; cursor: pointer; }
  .primary { border: 0; background: #fff; color: #111; }
  .primary:hover { background: #e8ecff; }
  .primary:disabled { opacity: 0.5; cursor: default; }
  .ghost { border: 1px solid var(--line-strong); background: none; color: var(--ink); }
  .ghost:hover { background: rgba(255, 255, 255, 0.06); }
  .link { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: var(--ink-dim); font: inherit; font-size: 13px; cursor: pointer; }
  .code { display: flex; gap: 8px; }
  .small-code { margin-bottom: 10px; }
  .spinner { width: 28px; height: 28px; margin: 14px 0 6px; border-radius: 50%; border: 3px solid var(--line-strong); border-top-color: var(--accent-2); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  form { width: 100%; display: grid; gap: 10px; margin-top: 14px; text-align: left; }
  label { display: grid; gap: 4px; font-size: 13px; color: var(--ink-dim); }
  input { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line-strong); background: rgba(0, 0, 0, 0.35); color: var(--ink); font: inherit; }
</style>
