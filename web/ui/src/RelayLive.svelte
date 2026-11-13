<script>
  // #relay-live, under « or join a room » : what the relay the page uses says of itself (GET /live,
  // web/net/relay-live.js) — players and rooms now. Asked at once, then every 30 s while the tab is
  // shown ; nothing at all until an answer came, nor when the relay has no /live (a player's own).
  // Mounted only beside #or-join, so it stops with the game.
  import { fetchLive } from '../../net/relay-live.js'
  import { T } from './lib/strings.js'

  let { relay } = $props()
  let live = $state(null)

  $effect(() => {
    const url = relay
    let gone = false
    const ask = async () => {
      if (document.hidden) return
      const next = await fetchLive(url)
      if (!gone) live = next
    }
    ask()
    const every = setInterval(ask, 30000)
    const shown = () => { if (!document.hidden) ask() }
    document.addEventListener('visibilitychange', shown)
    return () => {
      gone = true
      clearInterval(every)
      document.removeEventListener('visibilitychange', shown)
    }
  })
</script>

{#if live}<p id="relay-live" class="dim small">{T.relayLive(live.players, live.rooms)}</p>{/if}

<style>
  p { margin: 6px 0 0; font-size: 13px; color: var(--ink-dim); }
</style>
