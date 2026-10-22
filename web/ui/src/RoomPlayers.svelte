<script>
  // Share's guest page, Settings › Players : who is in the game, from the host's PLAYERS message
  // (web/share/protocol.js) — P1 the host, then each guest, ours marked.
  import { T } from './lib/strings.js'
  import { ui } from './state.svelte.js'
</script>

<div class="label">{T.inThisGame}</div>
<ol class="rows" id="ctr-room-players">
  {#each ui.room?.list ?? [] as p (p.slot)}
    <li class="row" class:me={p.slot === ui.room.slot} data-player={p.slot + 1}>
      <span class="p p{p.slot + 1}">P{p.slot + 1}</span>
      <span class="name">{p.name}</span>
      <small>{p.slot === 0 ? T.hostTag : p.slot === ui.room.slot ? T.you : ''}</small>
    </li>
  {/each}
</ol>

<style>
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-dim); font-weight: 700; margin: 20px 2px 8px; }
  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .row { display: grid; grid-template-columns: 40px 1fr auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); }
  .row.me { background: rgba(79, 140, 255, 0.16); }
  .p { font: 400 18px var(--display); text-align: center; border-radius: 8px; padding: 2px 0; color: #111; }
  .p1 { background: #4f8cff; } .p2 { background: #ff5a5f; } .p3 { background: #3fd17a; } .p4 { background: #ffc94a; }
  .name { font-weight: 700; letter-spacing: 0.03em; }
  small { color: var(--ink-dim); font-size: 12px; }
</style>
