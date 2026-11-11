<script>
  // The page's interface. Owns the window-wide listeners :
  //   drag & drop  the whole window is the drop target as soon as a drag carrying files enters it
  //                (enter / leave counted, so moving over child elements does not flicker) ;
  //   keyboard     a capture listener on window, ahead of SDL's : Esc opens / closes Settings ;
  //                while Settings is open the game sees no keydown (keyup passes, so SDL never
  //                keeps a key stuck) and arrows move the focus ; a key being bound is taken here ;
  //   gamepads     connect / disconnect toasts with the pad's family, a rAF poll of the buttons
  //                for the Home button (Settings), the panel's navigation and the binding of a
  //                pad button ;
  //   ready        with a stored disc, the boot screen waits : Enter, Space, the keys or pad
  //                buttons bound to Cross / Start start the game.
  import Boot from './Boot.svelte'
  import Glyph from './Glyph.svelte'
  import Hud from './Hud.svelte'
  import Settings from './Settings.svelte'
  import Toasts from './Toasts.svelte'
  import { scancodeOf } from './lib/keys.js'
  import { bindKey, bindPadButton } from './lib/binding.js'
  import { BUTTONS, STANDARD_TO_SDL } from './lib/mappings.js'
  import { watchPadConnections } from './lib/pad-events.js'
  import { keyboardSets } from './lib/settings.js'
  import { T } from './lib/strings.js'
  import { watchPads } from './lib/input-hook.js'
  import { tick } from 'svelte'
  import { ui } from './state.svelte.js'
  import { settings } from './store.js'

  let { input, handleFile, forgetStoredDisc, startGame, joinBack, waitBack, join } = $props()

  const running = $derived(ui.phase === 'running' || ui.phase === 'starting')
  let layout = $state(null)
  navigator.keyboard?.getLayoutMap?.().then((m) => { layout = m }).catch(() => {})

  // ---- Settings open / closed : the game re-centres in what the sidebar leaves ----
  // opened by the player (Esc, the gear, a pad's Home) : the focus goes in, the game waits ;
  // closed : the focus goes back to the game
  const inPanel = () => !!document.activeElement?.closest?.('#ctr-settings')
  const setOpen = async (open) => {
    ui.settingsOpen = open
    ui.listening = null
    ui.notice = ''
    if (!open) { document.getElementById('canvas')?.focus(); return }
    await tick()
    document.querySelector('#ctr-settings [role=tab][aria-selected=true]')?.focus()
  }
  $effect(() => { document.body.classList.toggle('ctr-sidebar', ui.settingsOpen && running) })

  // ---- the game's size : the canvas keeps its 800 × 600 pixels and is scaled for display ----
  // SDL sizes its window from the canvas's CSS box once, when it creates the window (it sets the
  // canvas to 1 × 1 and reads the box back : a CSS-sized canvas becomes an « external size » it
  // then follows, and the game draws 800 × 600 in a corner of it). So the scale (a transform)
  // starts only once SDL has set the canvas back from 1 × 1.
  let scaling = false
  function rescale() {
    const canvas = document.getElementById('canvas')
    if (!canvas || !scaling) return
    const side = ui.settingsOpen && running ? 400 : 0
    const k = Math.max(0.25, Math.min((window.innerWidth - side) / canvas.width, window.innerHeight / canvas.height))
    canvas.style.setProperty('--game-scale', k.toFixed(4))
  }
  $effect(() => {
    const canvas = document.getElementById('canvas')
    if (!canvas) return
    // records arrive batched (1 then 800 in one callback) : the one leaving « 1 » is the sign
    const mo = new MutationObserver((records) => {
      if (!scaling && records.some((r) => r.oldValue === '1') && canvas.width > 1) { scaling = true; rescale() }
    })
    mo.observe(canvas, { attributes: true, attributeOldValue: true, attributeFilter: ['width', 'height'] })
    window.addEventListener('resize', rescale)
    return () => { mo.disconnect(); window.removeEventListener('resize', rescale) }
  })
  $effect(() => { void ui.settingsOpen; void running; rescale() })
  if (new URLSearchParams(location.search).has('log')) document.body.classList.add('ctr-log')

  // ---- drag & drop over the whole window ----
  let depth = 0
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')
  function onDragEnter(e) {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth++
    ui.dragging = true
  }
  function onDragOver(e) {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    ui.dragging = true
  }
  function onDragLeave(e) {
    if (!hasFiles(e)) return
    depth = Math.max(0, depth - 1)
    // leaving the window itself (no element to go to) also ends it
    if (depth === 0 || e.relatedTarget === null && e.clientX <= 0 && e.clientY <= 0) { depth = 0; ui.dragging = false }
  }
  function onDrop(e) {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth = 0
    ui.dragging = false
    const file = e.dataTransfer.files[0]
    if (file && ui.phase !== 'preparing') handleFile(file)
  }

  // ---- keyboard ----
  const focusables = () => [...document.querySelectorAll('#ctr-settings button:not([disabled]), #ctr-settings input, #ctr-settings textarea, #ctr-settings [tabindex="0"]')].filter((n) => n.offsetParent !== null)
  function moveFocus(step) {
    const list = focusables()
    if (!list.length) return
    const i = list.indexOf(document.activeElement)
    const next = i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length
    list[next].focus()
  }
  function switchTab(step) {
    const tabs = [...document.querySelectorAll('#ctr-settings [role=tab][data-tab]')]
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')
    tabs[(i + step + tabs.length) % tabs.length]?.click()
  }
  const typing = () => {
    const a = document.activeElement
    return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|password|search|url)$/.test(a.type)))
  }
  // A key nothing in the page handles makes macOS play its « unhandled key » sound (the « toc »),
  // on every press of a player mashing Enter through the intro. The game's keys, Esc, Enter and
  // Space are the page's when the focus is on the game (not a button, field or link) : their
  // default is prevented — browser shortcuts (with Cmd / Ctrl / Alt) and the F-keys are left alone.
  const onAControl = () => {
    const a = document.activeElement
    return !!a && a !== document.body && a.id !== 'canvas' && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(a.tagName)
  }
  // the key sets the game reads : the right half only while two players share the keyboard
  const claimed = (s) => (s.duo ? keyboardSets(s) : [s.keyboard])
  function claimKey(e) {
    if (e.metaKey || e.altKey || (e.ctrlKey && !/^Control/.test(e.code)) || /^F\d+$/.test(e.code) || onAControl()) return
    const sc = scancodeOf(e.code)
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space' || /^Arrow/.test(e.code) || (sc >= 0 && claimed(settings.get()).some((m) => m.includes(sc)))) e.preventDefault()
  }
  // the ready screen : the PSX buttons that start the game, as indices into a mapping
  const START_BUTTONS = [BUTTONS.indexOf('cross'), BUTTONS.indexOf('start')]
  // the joining card and the watching band (32f) : Triangle is their Back, as on every screen
  const TRIANGLE = BUTTONS.indexOf('triangle')
  const triangleKey = (e) => {
    const sc = scancodeOf(e.code)
    return sc >= 0 && claimed(settings.get()).some((m) => m[TRIANGLE] === sc)
  }
  const back = () => (ui.joining ? joinBack : ui.waiting ? waitBack : null)
  // « or join a room » (28b) : while the home page shows the room code, the keys and the pad are
  // the dials' — the game's own menu keys (the player's mapping) and the arrows, Enter, Escape
  const SQUARE = BUTTONS.indexOf('square')
  const DIAL_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'start', NumpadEnter: 'start', Backspace: 'square', Delete: 'square' }
  const DIAL_BUTTONS = ['up', 'down', 'left', 'right', 'cross', 'square', 'start']
  const joinBackOut = () => (ui.join.phase === 'dials' ? join.close() : join.toDials())
  /** The dial press a mapped value stands for (`mapping` : the player's keyboard or gamepad row). */
  const dialPress = (mapping, value) => DIAL_BUTTONS.find((b) => mapping[BUTTONS.indexOf(b)] === value)
  function joinKey(e) {
    if (e.type !== 'keydown' || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.code === 'Escape' || (!typing() && triangleKey(e))) { e.preventDefault(); joinBackOut(); return }
    if (ui.join.phase !== 'dials' || typing()) return
    const sc = scancodeOf(e.code)
    const key = DIAL_KEYS[e.code] ?? (sc >= 0 ? claimed(settings.get()).map((m) => dialPress(m, sc)).find(Boolean) : null)
    // Enter or Space on a button (Back, Join, an arrow) is that button's
    if (!key || (onAControl() && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space'))) return
    e.preventDefault()
    join.press(key)
  }
  function joinPad(button) {
    const gamepad = settings.get().gamepad
    const sdl = STANDARD_TO_SDL[button]
    if (gamepad[TRIANGLE] === sdl) return joinBackOut()
    const key = dialPress(gamepad, sdl)
    if (key) join.press(key)
  }
  function startKey(e) {
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') return true
    const sc = scancodeOf(e.code)
    return sc >= 0 && claimed(settings.get()).some((m) => START_BUTTONS.some((b) => m[b] === sc))
  }
  function onKeyCapture(e) {
    // the Bot switch's keys (src/dev/keys.js, debug builds) : for the game and the pad, never for
    // this page's own shortcuts — only « Skip intro » counts them
    if (e.ctrBot) { if (e.type === 'keydown') input.onKey(e); return }
    if (ui.join && !running && !ui.progress) { joinKey(e); return }
    if (ui.phase === 'ready' && e.type === 'keydown' && !e.repeat && !ui.confirm && !onAControl() && !e.metaKey && !e.ctrlKey && !e.altKey && startKey(e)) {
      e.preventDefault()
      startGame()
      return
    }
    if (e.type === 'keydown') {
      input.onKey(e) // « Skip intro » counts presses
      claimKey(e)
    }
    if (ui.listening && ui.listening.device !== 'gamepad') {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.type === 'keydown' && !e.repeat) bindKey(e, ui, settings, T)
      return
    }
    if (e.type !== 'keydown') return // keyup always reaches SDL : no key stays down in the game
    if (ui.confirm) {
      if (e.code === 'Escape') { e.preventDefault(); ui.confirm = null }
      e.stopImmediatePropagation()
      return
    }
    if ((e.code === 'Escape' || (!e.repeat && !ui.settingsOpen && !typing() && triangleKey(e))) && back()) {
      // the joining screen's way back (session 32e), the watching band's (32f)
      e.preventDefault()
      e.stopImmediatePropagation()
      back()()
      return
    }
    if (e.code === 'Escape' && running) {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (ui.listening) ui.listening = null
      else setOpen(!ui.settingsOpen)
      return
    }
    if (!ui.settingsOpen || !running || !inPanel()) return
    e.stopImmediatePropagation() // the game does not see it
    if (typing()) return
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight') { e.preventDefault(); moveFocus(1) }
    else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft') { e.preventDefault(); moveFocus(-1) }
  }

  // ---- gamepads ----
  const ctrToast = (...a) => globalThis.ctrUI?.toast(...a)

  // a pad press is no gesture for the browser's sound : a player on a pad alone hears nothing
  // until a click (or a key), and is told so once (session 32e)
  let soundHint = 0
  const clearSoundHint = () => {
    if (!soundHint) return
    globalThis.ctrUI?.dismissToast(soundHint)
    soundHint = -1
  }
  function onPadDown(index, button) {
    if (!soundHint && globalThis.ctrAudio?.context?.state === 'suspended') soundHint = ctrToast(T.clickForSound, '', '', { sticky: true })
    if (ui.join && !running && !ui.progress) { joinPad(button); return }
    // the home page's « or join a room » : Square (Cross plays)
    if ((ui.phase === 'ready' || ui.phase === 'boot') && !ui.confirm && !ui.progress && settings.get().gamepad[SQUARE] === STANDARD_TO_SDL[button]) { join.open(); return }
    if (ui.phase === 'ready' && !ui.confirm) {
      const gamepad = settings.get().gamepad
      if (START_BUTTONS.some((b) => gamepad[b] === STANDARD_TO_SDL[button])) startGame()
      return
    }
    input.press() // « Skip intro »
    if (button === 16 && running) { setOpen(!ui.settingsOpen); return }
    if (!ui.settingsOpen && !ui.confirm && back() && settings.get().gamepad[TRIANGLE] === STANDARD_TO_SDL[button]) { back()(); return }
    if (ui.listening?.device === 'gamepad') {
      bindPadButton(button, ui, settings)
      return
    }
    if (ui.confirm) {
      if (button === 0) document.querySelector('#ctr-confirm .primary')?.click()
      else if (button === 1) ui.confirm = null
      return
    }
    if (!ui.settingsOpen || !running || !inPanel()) return
    if (button === 12 || button === 14) moveFocus(-1)
    else if (button === 13 || button === 15) moveFocus(1)
    else if (button === 0) document.activeElement?.click?.()
    else if (button === 1) setOpen(false)
    else if (button === 4) switchTab(-1)
    else if (button === 5) switchTab(1)
  }

  $effect(() => {
    const opts = { capture: true }
    window.addEventListener('keydown', onKeyCapture, opts)
    window.addEventListener('keyup', onKeyCapture, opts)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    const stopPads = watchPadConnections(ui, ctrToast, T)
    const canvas = document.getElementById('canvas')
    // a click on the game folds Settings away and gives the game the keys
    const focusGame = () => { if (ui.settingsOpen) setOpen(false); else canvas?.focus() }
    canvas?.addEventListener('pointerdown', focusGame)
    window.addEventListener('pointerdown', clearSoundHint, opts)
    window.addEventListener('keydown', clearSoundHint, opts)
    const stop = watchPads(onPadDown)
    return () => {
      window.removeEventListener('keydown', onKeyCapture, opts)
      window.removeEventListener('keyup', onKeyCapture, opts)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      stopPads()
      canvas?.removeEventListener('pointerdown', focusGame)
      window.removeEventListener('pointerdown', clearSoundHint, opts)
      window.removeEventListener('keydown', clearSoundHint, opts)
      stop()
    }
  })
</script>

<div id="boot" class:hidden={running && !ui.progress && !ui.joining}>
  <Boot {handleFile} {startGame} {joinBack} {join} {layout} />
</div>

{#if running && ui.waiting && !ui.joining}
  <div id="ctr-waiting" role="status" aria-live="polite">
    <span>{ui.waiting.cup ? T.watchCup : T.watchRace}</span>
    <button type="button" class="btn" onclick={waitBack}>{T.waitBack} <Glyph kind="psx" value="triangle" size={20} /> / Esc</button>
  </div>
{/if}

{#if running}
  <Hud onsettings={() => setOpen(!ui.settingsOpen)} />
  {#if ui.settingsOpen}
    <Settings {forgetStoredDisc} {layout} onclose={() => setOpen(false)} />
  {/if}
{/if}

{#if ui.dragging}
  <div id="ctr-drop-overlay" class:replace={running}>
    <div class="frame"></div>
    <div class="msg">
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><circle cx="32" cy="32" r="27" /><circle cx="32" cy="32" r="7" /><path d="M32 13a19 19 0 0 1 19 19" stroke-linecap="round" opacity=".6" /></svg>
      <h2>{running ? T.dropReplaceTitle : T.dropBootTitle}</h2>
      <p>{running ? T.dropReplaceHelp : T.dropBootHelp}</p>
    </div>
  </div>
{/if}

{#if ui.confirm}
  <div id="ctr-confirm" class="modal" role="dialog" aria-modal="true">
    <div class="box">
      <p>{ui.confirm.text}</p>
      <div class="actions">
        <button type="button" class="btn" onclick={() => { ui.confirm = null }}>{T.cancel} <Glyph kind="pad" value={1} family={ui.pads[0]?.family ?? 'other'} size={22} /></button>
        <!-- svelte-ignore a11y_autofocus -->
        <button type="button" class="btn primary" class:danger={ui.confirm.danger} autofocus onclick={() => { const c = ui.confirm; ui.confirm = null; c.run() }}>{ui.confirm.action}</button>
      </div>
    </div>
  </div>
{/if}

<Toasts />

<style>
  #boot.hidden { display: none; }
  #ctr-waiting { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 20; display: flex; align-items: center; gap: 18px;
    max-width: calc(100vw - 32px); box-sizing: border-box; padding: 12px 14px 12px 22px; border-radius: 18px;
    background: var(--panel); border: 1px solid var(--line); color: var(--ink); font-size: 17px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); }
  #ctr-waiting span { flex: 1; }
  #ctr-drop-overlay { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; pointer-events: none;
    background: rgba(8, 10, 16, 0.55); backdrop-filter: blur(10px); animation: fade 140ms ease-out; }
  @keyframes fade { from { opacity: 0; } }
  .frame { position: absolute; inset: 14px; border-radius: 26px; border: 2px solid rgba(124, 243, 255, 0.75);
    box-shadow: 0 0 0 6px rgba(79, 140, 255, 0.18), inset 0 0 60px rgba(79, 140, 255, 0.25); animation: breathe 1.4s ease-in-out infinite; }
  @keyframes breathe { 50% { box-shadow: 0 0 0 10px rgba(79, 140, 255, 0.1), inset 0 0 90px rgba(79, 140, 255, 0.35); } }
  .msg { text-align: center; background: var(--panel); border: 1px solid var(--line); border-radius: 24px; padding: 30px 46px; }
  .msg svg { width: 64px; height: 64px; color: var(--warm); }
  .msg h2 { margin: 10px 0 4px; font: 400 30px var(--display); }
  .msg p { margin: 0; color: var(--ink-dim); }
  .modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(6px); }
  .box { width: min(460px, calc(100vw - 32px)); background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 24px; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6); }
  .box p { margin: 0 0 20px; font-size: 16px; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; }
  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border: 0; border-radius: 12px; background: rgba(255, 255, 255, 0.08); font-weight: 600; font-size: 14px; cursor: pointer; }
  .btn.primary { background: #fff; color: #111; }
  .btn.primary.danger { background: var(--danger); color: #fff; }
</style>
