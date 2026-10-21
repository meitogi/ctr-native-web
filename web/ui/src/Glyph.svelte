<script>
  // Button glyphs, drawn for this page (no third-party art) : the PSX pad's own buttons, a
  // connected pad's buttons in its family's look (PlayStation shapes, Xbox / Nintendo letters in
  // their colours — Nintendo labels by position : B at the bottom), and keyboard key caps.
  import { AXIS_FLAG, SDL_AXIS, SDL_PAD } from './lib/mappings.js'
  import { FACE_LABELS, OTHER_LABELS } from './lib/pads.js'
  import { keyLabel } from './lib/keys.js'
  import { LANG } from './lib/strings.js'

  /** kind : 'psx' (value = cross|circle|…|up|l1|start…), 'pad' (value = SDL gamepad value, family), 'key' (value = KeyboardEvent.code) */
  let { kind, value, family = 'other', layout = null, size = 30 } = $props()

  const PS_COLORS = { cross: '#7aa6f5', circle: '#f0606a', square: '#e58fd0', triangle: '#3fd1b0' }
  const LETTER_COLORS = {
    xbox: { A: '#5dc21e', B: '#ff4048', X: '#2e88ff', Y: '#ffc214' },
    nintendo: { A: '#e8e8ee', B: '#e8e8ee', X: '#e8e8ee', Y: '#e8e8ee' },
  }
  const FACE = [SDL_PAD.SOUTH, SDL_PAD.EAST, SDL_PAD.WEST, SDL_PAD.NORTH]
  const DPAD = { [SDL_PAD.DPAD_UP]: 'up', [SDL_PAD.DPAD_DOWN]: 'down', [SDL_PAD.DPAD_LEFT]: 'left', [SDL_PAD.DPAD_RIGHT]: 'right' }

  // what to draw : { shape: 'ps'|'letter'|'dot'|'dpad'|'pill'|'key', … }
  const g = $derived.by(() => {
    if (kind === 'key') return { shape: 'key', text: value ? keyLabel(value, LANG, layout) : '—' }
    if (kind === 'psx') {
      if (PS_COLORS[value]) return { shape: 'ps', ps: value }
      if (['up', 'down', 'left', 'right'].includes(value)) return { shape: 'dpad', dir: value }
      return { shape: 'pill', text: value.toUpperCase() }
    }
    // pad
    if (value < 0) return { shape: 'pill', text: '—' }
    const face = FACE.indexOf(value)
    if (face >= 0) {
      const label = FACE_LABELS[family]?.[face] ?? FACE_LABELS.other[face]
      if (family === 'playstation') return { shape: 'ps', ps: label }
      if (family === 'other') return { shape: 'dot', pos: face }
      return { shape: 'letter', text: label, color: LETTER_COLORS[family]?.[label] ?? '#e8e8ee' }
    }
    if (DPAD[value]) return { shape: 'dpad', dir: DPAD[value] }
    const o = OTHER_LABELS[family] ?? OTHER_LABELS.other
    const byValue = {
      [SDL_PAD.LEFT_SHOULDER]: o[0], [SDL_PAD.RIGHT_SHOULDER]: o[1],
      [SDL_AXIS.LEFT_TRIGGER | AXIS_FLAG]: o[2], [SDL_AXIS.RIGHT_TRIGGER | AXIS_FLAG]: o[3],
      [SDL_PAD.LEFT_STICK]: o[4], [SDL_PAD.RIGHT_STICK]: o[5],
      [SDL_PAD.BACK]: o[6], [SDL_PAD.START]: o[7], [SDL_PAD.GUIDE]: o[8],
    }
    return { shape: 'pill', text: byValue[value] ?? `#${value}` }
  })
  // the face-button diamond's dot positions : south, east, west, north
  const DOTS = [[16, 23], [23, 16], [9, 16], [16, 9]]
</script>

{#if g.shape === 'key'}
  <span class="key">{g.text}</span>
{:else if g.shape === 'pill'}
  <svg class="glyph" width={size * 1.3} height={size} viewBox="0 0 40 32" role="img" aria-label={g.text}>
    <rect x="1" y="5" width="38" height="22" rx="11" fill="#1d1f27" stroke="#3b3e4a" />
    <text x="20" y={g.text.length > 3 ? 19.2 : 20.5} text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size={g.text.length > 4 ? 7 : g.text.length > 3 ? 8 : 11} fill="#e8e8ee">{g.text}</text>
  </svg>
{:else}
  <svg class="glyph" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={g.ps ?? g.text ?? g.dir ?? 'button'}>
    <circle cx="16" cy="16" r="15" fill="#1d1f27" stroke="#3b3e4a" />
    {#if g.shape === 'ps'}
      <g fill="none" stroke={PS_COLORS[g.ps]} stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        {#if g.ps === 'cross'}<path d="M10 10l12 12M22 10 10 22" />
        {:else if g.ps === 'circle'}<circle cx="16" cy="16" r="6.5" />
        {:else if g.ps === 'square'}<rect x="10" y="10" width="12" height="12" />
        {:else}<path d="M16 9l7.5 12.5h-15z" />{/if}
      </g>
    {:else if g.shape === 'letter'}
      <text x="16" y="21.5" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="15" fill={g.color}>{g.text}</text>
    {:else if g.shape === 'dot'}
      {#each DOTS as [x, y], i}
        <circle cx={x} cy={y} r="3.2" fill={i === g.pos ? '#fff' : '#4a4d5a'} />
      {/each}
    {:else if g.shape === 'dpad'}
      <rect x="13" y="5" width="6" height="9" rx="2" fill={g.dir === 'up' ? '#fff' : '#4a4d5a'} />
      <rect x="13" y="18" width="6" height="9" rx="2" fill={g.dir === 'down' ? '#fff' : '#4a4d5a'} />
      <rect x="5" y="13" width="9" height="6" rx="2" fill={g.dir === 'left' ? '#fff' : '#4a4d5a'} />
      <rect x="18" y="13" width="9" height="6" rx="2" fill={g.dir === 'right' ? '#fff' : '#4a4d5a'} />
    {/if}
  </svg>
{/if}

<style>
  .glyph { flex: none; display: block; }
  .key {
    display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 28px; padding: 0 9px;
    border-radius: 7px; font: 600 13px var(--text); color: #fff; white-space: nowrap;
    background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.18); border-bottom-width: 3px;
  }
</style>
