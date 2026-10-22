<script>
  // The boot screen : the wordmark, what to drop and why, the file picker, the copy's progress,
  // errors in plain words. The whole window is the drop target (App.svelte) ; #drop-zone is the
  // visible invitation. Ids kept from session 3's page (#drop-zone, #pick-disc, #disc-input,
  // #drop-progress, #drop-error, #boot-status) : suites read them.
  // With a stored disc (phase 'ready'), #press-start : the disc, and the real button that starts
  // the game — the connected pad's Cross in its family's look, the keyboard's Start key.
  import Glyph from './Glyph.svelte'
  import Logo from './Logo.svelte'
  import { codeOf } from './lib/keys.js'
  import { BUTTONS } from './lib/mappings.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { live } from './store.js'

  let { handleFile, startGame, layout = null } = $props()
  let input = $state()

  const mb = (n) => Math.round(n / (1024 * 1024))
  const pct = $derived(ui.progress?.total ? Math.min(100, (ui.progress.written / ui.progress.total) * 100) : 0)
  const pick = () => { const f = input.files[0]; input.value = ''; if (f) handleFile(f) }
  const padCross = $derived(live.current.gamepad[BUTTONS.indexOf('cross')])
  const startKey = $derived(codeOf((live.current.duo ? live.current.keyboardLeft : live.current.keyboard)[BUTTONS.indexOf('start')]))
</script>

<div class="screen">
  <div class="glow"></div>
  <div class="col">
    <Logo width={440} />
    <p class="lead">{T.bootLead}</p>

    {#if ui.progress}
      <section class="card prep" aria-live="polite">
        <div class="disp">{ui.progress.title}</div>
        <div class="dim">{ui.progress.detail}</div>
        <progress id="drop-progress" value={pct} max="100"></progress>
        <div class="row dim small"><span>{T.mb(mb(ui.progress.written), mb(ui.progress.total))}</span><span>{Math.floor(pct)} %</span></div>
        <ul class="steps">
          <li class="done">{T.found(ui.progress.serial?.replace('_', '-').replace('.', ''))}</li>
          <li class="now">{ui.progress.kind === 'zip' ? T.unzipping : T.copying}</li>
        </ul>
      </section>
    {:else if ui.phase === 'ready'}
      <section id="press-start" class="card ready">
        <svg class="disc spin" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
          <circle cx="32" cy="32" r="27" /><circle cx="32" cy="32" r="7" /><path d="M32 13a19 19 0 0 1 19 19" stroke-linecap="round" opacity=".6" />
        </svg>
        <div class="disp big">{T.readyTitle}</div>
        <div class="dim">{T.found(ui.disc?.serial?.replace('_', '-').replace('.', ''))} · {T.readyKept}</div>
        <p class="press" aria-live="polite">
          {T.pressTo}
          {#if ui.pads.length}<Glyph kind="pad" value={padCross} family={ui.pads[0].family} size={34} /> {T.or}{/if}
          <Glyph kind="key" value={startKey} {layout} />
          {T.toPlay}
        </p>
        <button id="start-game" type="button" class="primary" onclick={startGame}>{T.play}</button>
      </section>
      <p class="dim small other">{T.otherDisc} <button id="pick-disc" type="button" class="link" onclick={() => input.click()}>{T.chooseFile}</button></p>
      <input id="disc-input" type="file" accept=".bin,.zip,application/zip" hidden bind:this={input} onchange={pick} />
    {:else}
      <section id="drop-zone" class="card drop" class:busy={ui.phase === 'checking' || ui.phase === 'starting'}>
        <svg class="disc" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
          <circle cx="32" cy="32" r="27" /><circle cx="32" cy="32" r="7" /><path d="M32 13a19 19 0 0 1 19 19" stroke-linecap="round" opacity=".6" />
        </svg>
        <div class="disp big">{T.dropTitle}</div>
        <div class="dim">{T.dropAnywhere}</div>
        <button id="pick-disc" type="button" class="primary" onclick={() => input.click()}>{T.browse}</button>
        <input id="disc-input" type="file" accept=".bin,.zip,application/zip" hidden bind:this={input} onchange={pick} />
      </section>
      <ul class="needs">
        {#each T.needs as line}<li>{line}</li>{/each}
      </ul>
    {/if}

    <p id="boot-status" class="dim small" aria-live="polite">{ui.status}</p>
    <div id="drop-error" class="error" role="alert" hidden={!ui.error}>{ui.error}</div>
  </div>
</div>

<style>
  .screen {
    position: fixed; inset: 0; display: grid; place-items: center; overflow: auto; z-index: 10;
    background: radial-gradient(900px 600px at 30% 15%, #1b2a55, transparent), radial-gradient(800px 600px at 85% 95%, #3a1a4a, transparent), var(--bg);
  }
  .glow { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(600px 300px at 50% 30%, rgba(255, 178, 30, 0.08), transparent); }
  .col { position: relative; width: min(560px, calc(100vw - 32px)); display: flex; flex-direction: column; align-items: center; text-align: center; padding: 32px 0; }
  .lead { margin: 4px 0 22px; color: var(--ink-dim); }
  .card { width: 100%; box-sizing: border-box; background: var(--panel); border: 1px solid var(--line); border-radius: 24px; backdrop-filter: blur(20px); }
  .drop { padding: 34px 28px 30px; border: 2px dashed var(--line-strong); display: flex; flex-direction: column; align-items: center; gap: 4px; transition: border-color 160ms, background 160ms; }
  .drop:hover { border-color: rgba(124, 243, 255, 0.5); }
  .drop.busy { opacity: 0.6; }
  .ready { padding: 34px 28px 30px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .disc.spin { animation: spin 6s linear infinite; }
  .press { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; margin: 22px 0 4px; font-size: 18px; animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.55; } }
  .other { margin: 16px 0 0; }
  .link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
  .disc { width: 60px; height: 60px; color: var(--warm); margin-bottom: 8px; }
  .disp { font-family: var(--display); font-size: 22px; letter-spacing: 0.01em; }
  .disp.big { font-size: 28px; }
  .dim { color: var(--ink-dim); }
  .small { font-size: 13px; }
  .primary { margin-top: 16px; padding: 11px 22px; border: 0; border-radius: 12px; background: #fff; color: #111; font-weight: 700; cursor: pointer; }
  .primary:hover { background: #e8ecff; }
  .needs { list-style: none; padding: 0; margin: 18px 0 0; display: grid; gap: 6px; font-size: 13px; color: var(--ink-dim); text-align: left; width: 100%; }
  .needs li { padding-left: 22px; position: relative; }
  .needs li::before { content: ''; position: absolute; left: 4px; top: 6px; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
  .prep { padding: 26px 28px; text-align: left; }
  progress { width: 100%; height: 10px; margin-top: 18px; appearance: none; border: 0; border-radius: 5px; overflow: hidden; background: rgba(255, 255, 255, 0.1); }
  progress::-webkit-progress-bar { background: rgba(255, 255, 255, 0.1); }
  progress::-webkit-progress-value { background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: 5px; transition: width 120ms linear; }
  progress::-moz-progress-bar { background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
  .row { display: flex; justify-content: space-between; margin-top: 6px; }
  .steps { list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 6px; font-size: 14px; }
  .steps li { padding-left: 24px; position: relative; }
  .steps .done { color: var(--ok); }
  .steps .done::before { content: '✓'; position: absolute; left: 4px; }
  .steps .now::before { content: ''; position: absolute; left: 3px; top: 5px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--accent-2); border-right-color: transparent; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { margin-top: 10px; width: 100%; box-sizing: border-box; text-align: left; padding: 14px 18px; border-radius: 16px; background: rgba(255, 80, 80, 0.12); border: 1px solid rgba(255, 107, 107, 0.5); white-space: pre-wrap; }
  #boot-status { min-height: 1.4em; margin: 12px 0 0; }
</style>
