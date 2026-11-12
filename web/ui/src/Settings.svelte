<script>
  // The Settings sidebar (design B) : four tabs (user, 2026-10-22 : eight were too many) —
  //   Players      the player name, « Who plays » on this page, P1–P4 (couch mode)
  //   Controls     keyboard and gamepad remapping
  //   Multiplayer  the panels other modules hand over, one segment each (Share : web/share/panel.js,
  //                Online : web/online/page.js) — shown when there is one
  //   System       volume, skip intro, the game data, about
//   Dev          debug builds only (src/dev/Dev.svelte) : the page log, the game state
// Debug builds also put the « Bot » switch in Players (src/dev/bot.js).
  // Share's guest page (profile 'guest') : Players (name, who plays, who is in the game), Controls,
  // System (volume, about). The game keeps running beside it, re-centred in what is left ; while it
  // is open the game gets no local input (Module.ctrInput.blocked).
  import Controls from './Controls.svelte'
  import Players from './Players.svelte'
  import RoomPlayers from './RoomPlayers.svelte'
  import WhoPlays from './WhoPlays.svelte'
  import { browserOf, issueUrl, modeOf } from './lib/report.js'
  import { NAME_LEN } from './lib/settings.js'
  import { LANG, T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'
  // debug builds only : the Dev tab's component, loaded with the dev tools (__CTR_DEV__ : vite.config.js)
  let Dev = $state(null)
  let BotSwitch = $state(null)
  if (__CTR_DEV__) {
    import('./dev/Dev.svelte').then((m) => { Dev = m.default })
    import('./dev/BotSwitch.svelte').then((m) => { BotSwitch = m.default })
  }

  let { forgetStoredDisc = () => {}, layout = null, onclose, profile = 'host' } = $props()
  const guest = $derived(profile === 'guest')

  const s = $derived(live.current)

  const ICONS = {
    player: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    multi: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    system: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    players: '<circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2.5 20a6 6 0 0 1 12 0M14 14.6a5 5 0 0 1 7.5 4.4"/>',
    dev: '<path d="M8 8 4 12l4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h0"/>',
    controls: '<path d="M7 6h10c3 0 4.5 2 5 5l.5 4c.3 2.5-2 4-4 2l-2.5-2.5h-8L5.5 17c-2 2-4.3.5-4-2L2 11c.5-3 2-5 5-5z"/>',
  }
  const tabs = $derived([
    { id: 'players', title: T.tabs.players },
    { id: 'controls', title: T.tabs.controls },
    ...(!guest && ui.adopted.length ? [{ id: 'multi', title: T.tabs.multi }] : []),
    { id: 'system', title: T.tabs.system },
    ...(!guest ? [{ id: 'help', title: T.tabs.help }] : []),
    ...(Dev ? [{ id: 'dev', title: 'Dev' }] : []),
  ])
  const current = $derived(tabs.find((t) => t.id === ui.tab) ?? tabs[0])
  const panels = $derived(ui.adopted.map((a) => ({ id: a.id, title: T.tabs[a.id] ?? a.title, el: a.el })))
  const panel = $derived(panels.find((a) => a.id === ui.multi) ?? panels[0])

  // an adopted panel is moved (not copied) into its tab while the tab shows
  function host(node, el) {
    node.appendChild(el)
    return { destroy() { if (el.parentNode === node) document.getElementById('ctr-parked')?.appendChild(el) } }
  }
  const mb = (n) => Math.round(n / (1024 * 1024))
  // « Report a problem » : the bug form filled when the link is used, with the mode the page is in then
  // (lib/report.js — nothing private goes in the link) ; set on focus and on any button's press, so
  // a middle click or a keyboard Enter gets it too
  function report(e) {
    const online = globalThis.__ctrOnline?.state?.()
    const netplay = online?.room && (online.role === 'host' || online.role === 'guest') ? online.role : null
    const mode = modeOf({ guest, sharing: !!globalThis.__ctrShare?.state?.().sharing, netplay })
    e.currentTarget.href = issueUrl({ version: globalThis.__CTR_VERSION ?? 'dev', browser: browserOf(navigator.userAgent), mode, lang: LANG })
  }
  const pickAnother = () => document.getElementById('disc-input')?.click()
</script>

<aside id="ctr-settings" aria-label={T.settings}>
  <header>
    <h2>{T.settings}</h2>
    <button type="button" class="x" aria-label={T.close} title={T.close} onclick={onclose}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  </header>
  <div class="tabs" role="tablist">
    {#each tabs as t}
      <button type="button" role="tab" data-tab={t.id} aria-selected={current.id === t.id} class:on={current.id === t.id} onclick={() => { ui.tab = t.id; ui.listening = null }}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">{@html ICONS[t.id]}</svg>
        <span>{t.title}</span>
      </button>
    {/each}
  </div>

  <div class="body" role="tabpanel">
    {#if current.id === 'players'}
      <div class="label">{T.playerName}</div>
      <label class="field">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">{@html ICONS.player}</svg>
        <input id="ctr-name" type="text" maxlength={NAME_LEN} autocomplete="off" spellcheck="false" value={s.name}
          oninput={(e) => settings.patch({ name: e.currentTarget.value })} />
        <span class="count">{s.name.length} / {NAME_LEN}</span>
      </label>
      <p class="help">{T.playerNameHelp(NAME_LEN)}</p>
      <WhoPlays />
      {#if BotSwitch}<BotSwitch />{/if}
      <div class="gap"></div>
      {#if guest}<RoomPlayers />{:else}<Players />{/if}
    {:else if current.id === 'controls'}
      <Controls {layout} />
    {:else if current.id === 'multi' && panel}
      {#if panels.length > 1}
        <div class="seg" role="tablist">
          {#each panels as a}
            <button type="button" role="tab" data-multi={a.id} aria-selected={panel.id === a.id} class:on={panel.id === a.id} onclick={() => { ui.multi = a.id }}>{a.title}</button>
          {/each}
        </div>
      {/if}
      <!-- keyed : from one panel to another, the old one is parked and the new one moved in -->
      {#key panel.id}<div class="adopted" data-panel={panel.id} use:host={panel.el}></div>{/key}
    {:else if current.id === 'help'}
      {#each T.help as part}
        <div class="label">{part.title}</div>
        <ul class="helplist" data-help={part.title}>
          {#each part.lines as line}<li>{line}</li>{/each}
        </ul>
      {/each}
    {:else if current.id === 'dev' && Dev}
      <Dev />
    {:else if current.id === 'system'}
      <div class="label">{T.volume}</div>
      <div class="setrow">
        <button type="button" class="mute" aria-pressed={s.muted} title={s.muted ? T.unmute : T.mute} onclick={() => settings.patch({ muted: !s.muted })}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
            {#if s.muted}<path d="M16 9l6 6M22 9l-6 6" />{:else}<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />{/if}
          </svg>
        </button>
        <input id="ctr-volume" type="range" min="0" max="100" value={Math.round(s.volume * 100)} aria-label={T.volume}
          oninput={(e) => settings.patch({ volume: e.currentTarget.value / 100, muted: false })} />
        <span class="count">{s.muted ? 0 : Math.round(s.volume * 100)}</span>
      </div>
      {#if !guest}
        <div class="label">{T.start}</div>
        <label class="setrow">
          <span>{T.skipIntro}<small>{T.skipIntroHelp}</small></span>
          <input id="ctr-skip-intro" type="checkbox" role="switch" class="switch" checked={s.skipIntro} onchange={(e) => settings.patch({ skipIntro: e.currentTarget.checked })} />
        </label>
        <div class="label">{T.gameData}</div>
        <div class="setrow">
          <span>{ui.disc ? T.found(ui.disc.serial.replace('_', '-').replace('.', '')) : T.discNone}{#if ui.disc?.size}<small>{T.discSize(mb(ui.disc.size))}</small>{/if}</span>
        </div>
        <div class="actions">
          <button type="button" class="btn" onclick={pickAnother}>{T.discChange}</button>
          <button type="button" id="forget-disc" class="btn danger" disabled={!ui.disc} onclick={forgetStoredDisc}>{T.discForget}</button>
        </div>
      {/if}
      <div class="label">{T.about}</div>
      <p class="about">{T.aboutText}</p>
      <p class="about"><span id="ctr-version">{T.version} {globalThis.__CTR_VERSION ?? 'dev'}</span>
        · <a id="ctr-report" href={issueUrl()} target="_blank" rel="noopener" title={T.reportHelp} onfocus={report} onpointerdown={report}>{T.report}</a></p>
      <div class="label">{T.licences}</div>
      <ul class="lic">{#each T.licenceLines as l}<li>{l}</li>{/each}</ul>
      <p class="help">{T.keysHint}</p>
    {/if}
  </div>
</aside>

<style>
  aside {
    position: fixed; top: 0; right: 0; bottom: 0; width: var(--sidebar-width); max-width: 100vw; z-index: 20;
    display: flex; flex-direction: column; background: var(--panel-solid); border-left: 1px solid var(--line);
    animation: slide 200ms ease-out;
  }
  @keyframes slide { from { transform: translateX(24px); opacity: 0; } }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 0 20px; }
  h2 { margin: 0; font: 400 26px var(--display); letter-spacing: 0.01em; }
  .x { width: 36px; height: 36px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.06); display: grid; place-items: center; cursor: pointer; }
  .x:hover { background: rgba(255, 255, 255, 0.14); }
  .tabs { display: flex; gap: 2px; padding: 12px 10px 0; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
  .tabs button { flex: 1 0 auto; min-width: 52px; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px 10px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--ink-dim); font-size: 11px; font-weight: 600; cursor: pointer; }
  .tabs button.on { color: #fff; border-bottom-color: #fff; }
  .tabs button:hover { color: #fff; }
  .body { flex: 1; overflow-y: auto; padding: 16px 16px 24px; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 6px 2px 8px; }
  .label:not(:first-child) { margin-top: 20px; }
  .field { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 14px; border-radius: 12px; background: rgba(255, 255, 255, 0.06); border: 1px solid var(--line); color: var(--ink-dim); }
  .field:focus-within { border-color: var(--accent); }
  .field input { flex: 1; min-width: 0; background: none; border: 0; outline: none; color: #fff; font: 700 16px var(--text); letter-spacing: 0.04em; }
  .count { font-size: 12px; color: var(--ink-dim); min-width: 32px; text-align: right; }
  .help { font-size: 12px; color: var(--ink-dim); margin: 6px 2px 0; }
  .setrow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); }
  .helplist { margin: 0 0 18px; padding: 12px 16px 12px 32px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); font-size: 14px; line-height: 1.45; }
  .helplist li + li { margin-top: 6px; }
  .setrow small { display: block; color: var(--ink-dim); font-size: 12.5px; margin-top: 2px; }
  .switch { appearance: none; flex: none; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.18); position: relative; cursor: pointer; transition: background 150ms; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 150ms; }
  .switch:checked { background: var(--accent); }
  .switch:checked::after { left: 21px; }
  .mute { width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.08); display: grid; place-items: center; cursor: pointer; flex: none; }
  input[type=range] { flex: 1; accent-color: #fff; }
  .gap { height: 14px; }
  .seg { display: flex; padding: 4px; border-radius: 12px; gap: 4px; background: rgba(255, 255, 255, 0.06); margin-bottom: 8px; }
  .seg button { flex: 1; padding: 8px 10px; border: 0; border-radius: 9px; background: none; font-weight: 600; font-size: 13px; cursor: pointer; color: var(--ink-dim); }
  .seg button.on { background: #fff; color: #111; }
  .actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  .btn { padding: 10px 16px; border: 0; border-radius: 12px; background: rgba(255, 255, 255, 0.08); font-weight: 600; font-size: 14px; cursor: pointer; }
  .btn:hover { background: rgba(255, 255, 255, 0.14); }
  .btn.danger { color: var(--danger); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .about { color: var(--ink); margin: 4px 2px 0; font-size: 14px; }
  .about a { color: inherit; }
  .lic { margin: 0; padding-left: 18px; font-size: 13px; color: var(--ink-dim); display: grid; gap: 4px; }
  /* an adopted panel (Online, Share) : its own layout, made to sit in the tab */
  .adopted :global(> *) { position: static !important; width: auto !important; inset: auto !important; max-height: none !important; border: 0 !important; background: none !important; padding: 0 !important; display: block !important; font: 13px/1.5 var(--text) !important; color: var(--ink) !important; }
  .adopted :global(h2) { display: none; }
  .adopted :global([hidden]) { display: none !important; }
  .adopted :global(h3) { font: 400 17px var(--display) !important; margin: 18px 0 6px !important; color: #fff !important; }
  /* the panel's own header (its title, its Hide) : Settings has both */
  .adopted :global(header) { display: none !important; }
  /* fields and buttons one height : the same line, padding and 1 px border (a button's is its fill) */
  .adopted :global(input[type=text]), .adopted :global(input[type=password]), .adopted :global(textarea), .adopted :global(select) { box-sizing: border-box; font: 13px/18px var(--text) !important; background-color: rgba(255, 255, 255, 0.06) !important; color: #fff !important; border: 1px solid var(--line) !important; border-radius: 10px !important; padding: 8px 10px !important; outline: none; }
  .adopted :global(:is(input, textarea, select):focus-visible) { border-color: var(--accent) !important; }
  .adopted :global(select) { appearance: none; padding-right: 30px !important; cursor: pointer; background-repeat: no-repeat; background-position: right 10px center; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none' stroke='%23ffffff' stroke-opacity='0.6' stroke-width='1.6'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E"); }
  .adopted :global(select option) { background: var(--panel-solid); color: #fff; }
  .adopted :global(button) { box-sizing: border-box; font: 600 13px/18px var(--text) !important; background: rgba(255, 255, 255, 0.08) !important; color: #fff !important; border: 1px solid transparent !important; border-radius: 10px !important; padding: 8px 14px !important; cursor: pointer; transition: background 100ms, transform 60ms; }
  .adopted :global(button:hover:not(:disabled)) { background: rgba(255, 255, 255, 0.14) !important; }
  .adopted :global(button:active:not(:disabled)) { background: rgba(255, 255, 255, 0.22) !important; transform: translateY(1px); }
  .adopted :global(button:focus-visible) { outline: 2px solid var(--accent-2); outline-offset: 2px; }
  .adopted :global(button:disabled) { opacity: 0.4; cursor: default; }
  .adopted :global(input:is([type=checkbox], [type=radio])) { accent-color: var(--accent); width: 16px; height: 16px; margin: 0 8px 0 0; vertical-align: -3px; cursor: pointer; }
  .adopted :global(.help), .adopted :global(.hint) { color: var(--ink-dim) !important; }
  .adopted :global(label) { margin: 12px 0 !important; }
  .adopted :global(.opt > label), .adopted :global(.opt) { margin: 10px 0 4px !important; }
  .adopted :global(label > :is(input:is([type=text], [type=password], [type=range]), select)) { display: block; margin-top: 6px !important; }
  .adopted :global(label > select) { width: 100%; }
  .adopted :global(.row) { gap: 8px !important; }
  .adopted :global(.row > button) { margin: 0 !important; }
  .adopted :global(section > button) { margin-top: 10px !important; }
</style>
