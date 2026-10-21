<script>
  // Over the game, top right : the speaker (click = mute / unmute, hover or long press = the
  // volume slider) and the Settings gear. Fades out while the mouse rests, back on any move.
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
  import { live, settings } from './store.js'

  let { onsettings } = $props()
  const s = $derived(live.current)

  let awake = $state(true)
  let timer = 0
  const wake = () => {
    awake = true
    clearTimeout(timer)
    timer = setTimeout(() => { if (!ui.volumeOpen) awake = false }, 2500)
  }
  $effect(() => {
    wake()
    window.addEventListener('pointermove', wake)
    return () => { window.removeEventListener('pointermove', wake); clearTimeout(timer) }
  })
  let closeTimer = 0
  const openVolume = () => { clearTimeout(closeTimer); ui.volumeOpen = true }
  const closeVolume = () => { closeTimer = setTimeout(() => { ui.volumeOpen = false }, 350) }
  // a page started muted by the test harness or ?mute (index.html) shows as muted until touched
  const forced = () => !!globalThis.ctrAudio?.forcedMute
  const level = $derived(s.muted || forced() ? 0 : Math.round(s.volume * 100))
  const toggle = () => {
    if (forced()) { globalThis.ctrAudio.forcedMute = false; settings.patch({ muted: false }) }
    else settings.patch({ muted: !s.muted })
  }
</script>

<div class="hud" class:awake={awake || ui.volumeOpen || ui.settingsOpen}>
  <div class="speaker" role="group" onpointerenter={openVolume} onpointerleave={closeVolume}>
    <button type="button" id="ctr-sound" class="hbtn" aria-pressed={level === 0} title={level === 0 ? T.unmute : T.mute}
      onclick={toggle} onfocus={openVolume} onblur={closeVolume}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
        {#if level === 0}<path d="M16 9l6 6M22 9l-6 6" />
        {:else if level < 50}<path d="M15.5 8.5a5 5 0 0 1 0 7" />
        {:else}<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />{/if}
      </svg>
    </button>
    {#if ui.volumeOpen}
      <div class="pop">
        <input id="ctr-hud-volume" type="range" min="0" max="100" value={level} aria-label={T.volume}
          onfocus={openVolume} onblur={closeVolume}
          oninput={(e) => settings.patch({ volume: e.currentTarget.value / 100, muted: e.currentTarget.value === '0' })} />
        <span>{level}</span>
      </div>
    {/if}
  </div>
  <button type="button" id="ctr-gear" class="hbtn" title={T.settings} aria-label={T.settings} aria-expanded={ui.settingsOpen} onclick={onsettings}>
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  </button>
</div>

<style>
  .hud { position: fixed; top: 14px; right: calc(var(--sidebar) + 14px); z-index: 30; display: flex; gap: 10px; opacity: 0.12; transition: opacity 400ms, right 220ms ease; }
  .hud.awake, .hud:hover, .hud:focus-within { opacity: 1; transition: opacity 120ms, right 220ms ease; }
  .speaker { position: relative; }
  .hbtn { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: #fff; background: rgba(20, 22, 30, 0.6); border: 1px solid rgba(255, 255, 255, 0.14); backdrop-filter: blur(12px); }
  .hbtn:hover { background: rgba(40, 44, 58, 0.8); }
  .pop { position: absolute; top: 52px; right: 0; width: 220px; display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(16px); }
  .pop::before { content: ''; position: absolute; top: -10px; left: 0; right: 0; height: 10px; } /* keeps the hover across the gap */
  .pop input { flex: 1; accent-color: #fff; }
  .pop span { font-weight: 700; font-size: 13px; width: 28px; text-align: right; }
</style>
