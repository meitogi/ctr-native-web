<script>
  // The Settings sidebar (design B) : tabs on top — Profile, Players, Controls, Sound, Disc, then the panels
  // other modules hand over (Online : web/online/page.js, Share : web/share/panel.js), About.
  // The game keeps running beside it, re-centred in what is left ; while it is open the game
  // gets no local input (Module.ctrInput.blocked).
  import Controls from './Controls.svelte'
  import Players from './Players.svelte'
  import { NAME_LEN } from './lib/settings.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  let { forgetStoredDisc, layout = null, onclose } = $props()

  const s = $derived(live.current)

  const ICONS = {
    player: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    players: '<circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M2.5 20a6 6 0 0 1 12 0M14 14.6a5 5 0 0 1 7.5 4.4"/>',
    controls: '<path d="M7 6h10c3 0 4.5 2 5 5l.5 4c.3 2.5-2 4-4 2l-2.5-2.5h-8L5.5 17c-2 2-4.3.5-4-2L2 11c.5-3 2-5 5-5z"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
    online: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  }
  const tabs = $derived([
    { id: 'player', title: T.tabs.player },
    { id: 'players', title: T.tabs.players },
    { id: 'controls', title: T.tabs.controls },
    { id: 'sound', title: T.tabs.sound },
    { id: 'disc', title: T.tabs.disc },
    ...ui.adopted.map((a) => ({ id: a.id, title: T.tabs[a.id] ?? a.title, el: a.el })),
    { id: 'about', title: T.tabs.about },
  ])
  const current = $derived(tabs.find((t) => t.id === ui.tab) ?? tabs[0])

  // an adopted panel is moved (not copied) into its tab while the tab shows
  function host(node, el) {
    node.appendChild(el)
    return { destroy() { if (el.parentNode === node) document.getElementById('ctr-parked')?.appendChild(el) } }
  }
  const mb = (n) => Math.round(n / (1024 * 1024))
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
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">{@html ICONS[t.id] ?? ICONS.about}</svg>
        <span>{t.title}</span>
      </button>
    {/each}
  </div>

  <div class="body" role="tabpanel">
    {#if current.id === 'player'}
      <div class="label">{T.playerName}</div>
      <label class="field">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">{@html ICONS.player}</svg>
        <input id="ctr-name" type="text" maxlength={NAME_LEN} autocomplete="off" spellcheck="false" value={s.name}
          oninput={(e) => settings.patch({ name: e.currentTarget.value })} />
        <span class="count">{s.name.length} / {NAME_LEN}</span>
      </label>
      <p class="help">{T.playerNameHelp(NAME_LEN)}</p>
      <div class="label">{T.start}</div>
      <label class="setrow">
        <span>{T.skipIntro}<small>{T.skipIntroHelp}</small></span>
        <input id="ctr-skip-intro" type="checkbox" role="switch" class="switch" checked={s.skipIntro} onchange={(e) => settings.patch({ skipIntro: e.currentTarget.checked })} />
      </label>
    {:else if current.id === 'players'}
      <Players />
    {:else if current.id === 'controls'}
      <Controls {layout} />
    {:else if current.id === 'sound'}
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
    {:else if current.id === 'disc'}
      <div class="label">{T.discStored}</div>
      <div class="setrow">
        <span>{ui.disc ? T.found(ui.disc.serial.replace('_', '-').replace('.', '')) : T.discNone}{#if ui.disc?.size}<small>{T.discSize(mb(ui.disc.size))}</small>{/if}</span>
      </div>
      <div class="actions">
        <button type="button" class="btn" onclick={pickAnother}>{T.discChange}</button>
        <button type="button" id="forget-disc" class="btn danger" disabled={!ui.disc} onclick={forgetStoredDisc}>{T.discForget}</button>
      </div>
    {:else if current.id === 'about'}
      <p class="about">{T.aboutText}</p>
      <div class="label">{T.licences}</div>
      <ul class="lic">{#each T.licenceLines as l}<li>{l}</li>{/each}</ul>
      <p class="help">{T.keysHint}</p>
    {:else if current.el}
      <!-- keyed : from one adopted tab to another, the old panel is parked and the new one moved in -->
      {#key current.id}<div class="adopted" use:host={current.el}></div>{/key}
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
  .setrow small { display: block; color: var(--ink-dim); font-size: 12.5px; margin-top: 2px; }
  .switch { appearance: none; flex: none; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.18); position: relative; cursor: pointer; transition: background 150ms; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 150ms; }
  .switch:checked { background: var(--accent); }
  .switch:checked::after { left: 21px; }
  .mute { width: 40px; height: 40px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, 0.08); display: grid; place-items: center; cursor: pointer; flex: none; }
  input[type=range] { flex: 1; accent-color: #fff; }
  .actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
  .btn { padding: 10px 16px; border: 0; border-radius: 12px; background: rgba(255, 255, 255, 0.08); font-weight: 600; font-size: 14px; cursor: pointer; }
  .btn:hover { background: rgba(255, 255, 255, 0.14); }
  .btn.danger { color: var(--danger); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .about { color: var(--ink); margin: 4px 2px 0; font-size: 14px; }
  .lic { margin: 0; padding-left: 18px; font-size: 13px; color: var(--ink-dim); display: grid; gap: 4px; }
  /* an adopted panel (Online, Share) : its own layout, made to sit in the tab */
  .adopted :global(> *) { position: static !important; width: auto !important; inset: auto !important; max-height: none !important; border: 0 !important; background: none !important; padding: 0 !important; display: block !important; font: 13px/1.5 var(--text) !important; color: var(--ink) !important; }
  .adopted :global(h2) { display: none; }
  .adopted :global([hidden]) { display: none !important; }
  .adopted :global(h3) { font: 400 17px var(--display) !important; margin: 18px 0 6px !important; color: #fff !important; }
  .adopted :global(input[type=text]), .adopted :global(input[type=password]), .adopted :global(textarea) { font: 13px var(--text) !important; background: rgba(255, 255, 255, 0.06) !important; color: #fff !important; border: 1px solid var(--line) !important; border-radius: 10px !important; padding: 8px 10px !important; }
  .adopted :global(button) { font: 600 13px var(--text) !important; background: rgba(255, 255, 255, 0.08) !important; color: #fff !important; border: 0 !important; border-radius: 10px !important; padding: 8px 14px !important; cursor: pointer; }
  .adopted :global(button:hover) { background: rgba(255, 255, 255, 0.14) !important; }
  .adopted :global(.help), .adopted :global(.hint) { color: var(--ink-dim) !important; }
  .adopted :global(label) { margin: 12px 0 !important; }
  .adopted :global(label > input:is([type=text], [type=password], [type=range])) { display: block; margin-top: 6px !important; }
</style>
