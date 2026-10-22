<script>
  // Share's guest page (src/guest.js) : the host's game is a <video> under this (guest-page.js) ;
  // over it the HUD (« My view », the speaker, the gear), Settings, toasts, and one screen at a
  // time while there is no game to show — connecting, click for sound, refused, the host left.
  // Esc or a pad's Home opens Settings ; F (guest-page.js) or the HUD's button crops to our view.
  import Hud from './Hud.svelte'
  import Settings from './Settings.svelte'
  import Toasts from './Toasts.svelte'
  import { bindKey, bindPadButton } from './lib/binding.js'
  import { watchPads } from './lib/input-hook.js'
  import { watchPadConnections } from './lib/pad-events.js'
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { settings } from './store.js'
  import { tick } from 'svelte'

  let { actions } = $props()
  const g = $derived(ui.guest)

  let layout = $state(null)
  navigator.keyboard?.getLayoutMap?.().then((m) => { layout = m }).catch(() => {})

  const setOpen = async (open) => {
    ui.settingsOpen = open
    ui.listening = null
    ui.notice = ''
    if (!open) { document.activeElement?.blur?.(); return }
    await tick()
    document.querySelector('#ctr-settings [role=tab][aria-selected=true]')?.focus()
  }
  $effect(() => { document.body.classList.toggle('ctr-sidebar', ui.settingsOpen) })

  // what covers the video : null while the game plays
  const screen = $derived.by(() => {
    if (!g || g.state === 'idle' || g.state === 'connecting') return { kind: 'wait', text: T.guestConnecting }
    if (g.state === 'nolink') return { kind: 'error', text: T.guestNoLink }
    if (g.state === 'refused') return { kind: 'error', text: g.code === 'online-mode' ? T.guestOnline : g.code === 'full' ? T.guestFull : g.message }
    if (g.state === 'closed') return { kind: 'error', text: g.code === 'closed' ? T.guestHostLeft : g.message || T.guestClosed }
    if (g.stream && !g.sound) return { kind: 'click', text: T.guestClickSound, detail: T.guestClickHelp }
    if (!g.stream) return { kind: 'wait', text: T.guestConnecting }
    return null
  })

  // Settings holds the keyboard while its focus is in it ; Esc opens / closes it ; Controls waiting
  // for a key takes the next one
  function onKey(e) {
    if (ui.listening && ui.listening.device !== 'gamepad') {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.type === 'keydown' && !e.repeat) bindKey(e, ui, settings, T)
      return
    }
    if (e.type !== 'keydown') return
    if (e.code === 'Escape') {
      e.preventDefault()
      if (ui.listening) ui.listening = null
      else setOpen(!ui.settingsOpen)
    }
  }
  $effect(() => {
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('keyup', onKey, { capture: true })
    const stopToasts = watchPadConnections(ui, (...a) => globalThis.ctrUI?.toast(...a), T)
    // a pad's Home button opens Settings, as on the game page
    const stopPads = watchPads((index, button) => {
      if (ui.listening?.device === 'gamepad') bindPadButton(button, ui, settings)
      else if (button === 16) setOpen(!ui.settingsOpen)
    })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('keyup', onKey, { capture: true })
      stopToasts()
      stopPads()
    }
  })
</script>

<Hud onsettings={() => setOpen(!ui.settingsOpen)}>
  {#snippet extra()}
    {#if g?.state === 'connected' && g.players > 1}
      <button type="button" id="ctr-my-view" class="view" aria-pressed={g.crop} title={T.myViewHelp} onclick={() => actions.crop()}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18" />{#if g.crop}<rect x="5" y="14" width="14" height="4" fill="currentColor" stroke="none" />{/if}</svg>
        <span>{T.myView}</span>
      </button>
    {/if}
  {/snippet}
</Hud>

{#if g?.state === 'connected' && g.slot}
  <div id="ctr-guest-status" class="status">{T.guestYouAre(g.slot + 1, g.host)}</div>
{/if}

{#if ui.settingsOpen}
  <Settings profile="guest" {layout} onclose={() => setOpen(false)} />
{/if}

{#if screen}
  <!-- the whole window takes the click that starts the sound (a user gesture) -->
  <div id="overlay" class="overlay" class:clickable={screen.kind === 'click'} role="presentation"
    onclick={() => { if (screen.kind === 'click') actions.unlock() }}>
    <div class="card" class:error={screen.kind === 'error'}>
      {#if screen.kind === 'wait'}<span class="spinner" aria-hidden="true"></span>{/if}
      {#if screen.kind === 'click'}
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
      {/if}
      <p id="overlay-text">{screen.text}</p>
      {#if screen.detail}<small>{screen.detail}</small>{/if}
    </div>
  </div>
{/if}

<Toasts />

<style>
  .overlay { position: fixed; inset: 0; right: var(--sidebar); z-index: 10; display: grid; place-items: center; background: rgba(8, 10, 16, 0.6); backdrop-filter: blur(6px); }
  .overlay.clickable { cursor: pointer; }
  .card { max-width: min(520px, calc(100vw - 32px)); display: grid; justify-items: center; gap: 10px; text-align: center; padding: 28px 36px; border-radius: 24px; background: var(--panel); border: 1px solid var(--line); }
  .card p { margin: 0; font: 400 24px/1.25 var(--display); }
  .card.error p { font: 600 16px/1.5 var(--text); color: var(--danger); }
  .card small { color: var(--ink-dim); }
  .spinner { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line-strong); border-top-color: var(--accent-2); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status { position: fixed; left: 14px; bottom: 14px; z-index: 30; padding: 8px 14px; border-radius: 999px; background: rgba(20, 22, 30, 0.6); border: 1px solid rgba(255, 255, 255, 0.14); backdrop-filter: blur(12px); font-weight: 600; font-size: 13px; }
  .view { height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 16px; border-radius: 22px; cursor: pointer; color: #fff; background: rgba(20, 22, 30, 0.6); border: 1px solid rgba(255, 255, 255, 0.14); backdrop-filter: blur(12px); font-weight: 600; font-size: 13px; }
  .view[aria-pressed='true'] { background: rgba(79, 140, 255, 0.45); }
</style>
