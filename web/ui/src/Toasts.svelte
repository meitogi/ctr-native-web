<script>
  // Toasts, top centre : « Gamepad connected · Xbox Wireless Controller · Player 1 », errors.
  import { ui } from './state.svelte.js'
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as t (t.id)}
    <div class="toast" data-family={t.family} role="status">
      {#if t.family}
        <span class="ic">
          <svg viewBox="0 0 48 32" width="30" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 4h24c6 0 9 4 10 10l1 8c.6 5-4 8-8 4l-5-5H14l-5 5c-4 4-8.6 1-8-4l1-8C3 8 6 4 12 4z" /><path d="M13 11v8M9 15h8" stroke-linecap="round" /><circle cx="33" cy="12.5" r="1.6" fill="currentColor" /><circle cx="37.5" cy="16.5" r="1.6" fill="currentColor" /></svg>
        </span>
      {/if}
      <span class="txt"><b>{t.title}</b>{#if t.detail}<span>{t.detail}</span>{/if}</span>
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; top: 18px; left: calc((100vw - var(--sidebar)) / 2); transform: translateX(-50%); z-index: 40; display: grid; gap: 8px; justify-items: center; pointer-events: none; }
  .toast { display: flex; gap: 14px; align-items: center; padding: 10px 24px 10px 12px; border-radius: 999px; min-width: 260px; max-width: min(560px, 90vw);
    background: var(--panel); border: 1px solid var(--line); backdrop-filter: blur(16px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); animation: in 220ms ease-out; }
  .toast:not([data-family]) , .toast[data-family=''] { padding-left: 22px; border-radius: 16px; }
  @keyframes in { from { transform: translateY(-12px); opacity: 0; } }
  .ic { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: rgba(255, 255, 255, 0.08); flex: none; }
  [data-family=playstation] .ic { color: #7aa6f5; }
  [data-family=xbox] .ic { color: #5dc21e; }
  [data-family=nintendo] .ic { color: #ff4554; }
  .txt b { display: block; font-size: 15px; }
  .txt span { font-size: 13px; color: var(--ink-dim); }
</style>
