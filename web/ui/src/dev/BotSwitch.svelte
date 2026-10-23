<script>
  // Settings › Players' « Bot » switch (debug builds) : this window plays itself (bot.js).
  import { ui } from '../state.svelte.js'
  import { D } from './strings.js'
</script>

<label class="setrow">
  <span>{D.bot}<small>{D.botHelp}</small></span>
  <input id="ctr-bot" type="checkbox" role="switch" class="switch" checked={ui.bot} onchange={(e) => { ui.bot = e.currentTarget.checked }} />
</label>

<style>
  .setrow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border-radius: 12px; background: rgba(255, 255, 255, 0.04); margin-top: 14px; }
  .setrow small { display: block; color: var(--ink-dim); font-size: 12.5px; margin-top: 2px; }
  .switch { appearance: none; flex: none; width: 44px; height: 26px; border-radius: 13px; background: rgba(255, 255, 255, 0.18); position: relative; cursor: pointer; transition: background 150ms; margin: 0; }
  .switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 150ms; }
  .switch:checked { background: var(--accent); }
  .switch:checked::after { left: 21px; }
</style>
