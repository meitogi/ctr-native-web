<script>
  // The page's wordmark : « CTR » in Lilita One over a speed ring, « in your browser » on a
  // checkered plate. Drawn for this page, inspired by the game's colours — not the game's logo
  // (a trademark ; nothing of it is reproduced).
  let { width = 460 } = $props()
  const DEPTH = 9
</script>

<svg {width} viewBox="0 0 520 330" role="img" aria-label="CTR in your browser" class="logo">
  <defs>
    <linearGradient id="ctr-face" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3a6" />
      <stop offset="0.38" stop-color="#ffd23f" />
      <stop offset="1" stop-color="#ff7a12" />
    </linearGradient>
    <linearGradient id="ctr-ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3f7bff" />
      <stop offset="1" stop-color="#1a2f9e" />
    </linearGradient>
    <pattern id="ctr-check" width="16" height="16" patternUnits="userSpaceOnUse">
      <rect width="16" height="16" fill="#111" />
      <rect width="8" height="8" fill="#f4f4f4" />
      <rect x="8" y="8" width="8" height="8" fill="#f4f4f4" />
    </pattern>
    <clipPath id="ctr-plate"><rect x="96" y="246" width="328" height="56" rx="28" /></clipPath>
  </defs>

  <!-- speed ring behind the letters -->
  <ellipse cx="260" cy="150" rx="236" ry="112" fill="none" stroke="#0b1440" stroke-width="40" opacity="0.6" />
  <ellipse cx="260" cy="146" rx="236" ry="112" fill="none" stroke="url(#ctr-ring)" stroke-width="28" />
  <ellipse cx="260" cy="146" rx="236" ry="112" fill="none" stroke="#9cc2ff" stroke-width="3" stroke-dasharray="60 26" opacity="0.7" />

  <!-- the letters : extrusion, outline, face -->
  <g font-family="'Lilita One', sans-serif" font-size="200" text-anchor="middle" letter-spacing="4">
    {#each Array.from({ length: DEPTH }, (_, i) => DEPTH - i) as d}
      <text x={260 + d * 0.6} y={210 + d} fill="#8a2a04" stroke="#3a1100" stroke-width="16" stroke-linejoin="round">CTR</text>
    {/each}
    <text x="260" y="210" fill="url(#ctr-face)" stroke="#3a1100" stroke-width="12" stroke-linejoin="round" paint-order="stroke">CTR</text>
    <text x="260" y="210" fill="none" stroke="#fff8c9" stroke-width="2.5" opacity="0.55">CTR</text>
  </g>

  <!-- the plate -->
  <rect x="90" y="242" width="340" height="64" rx="32" fill="#0b0d14" />
  <g clip-path="url(#ctr-plate)">
    <rect x="96" y="246" width="328" height="56" fill="#141a3a" />
    <rect x="96" y="246" width="44" height="56" fill="url(#ctr-check)" />
    <rect x="380" y="246" width="44" height="56" fill="url(#ctr-check)" />
  </g>
  <text x="260" y="284" text-anchor="middle" font-family="'Lilita One', sans-serif" font-size="27" fill="#ffffff" letter-spacing="1">in your browser</text>
</svg>

<style>
  .logo { display: block; max-width: 100%; height: auto; filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.55)); }
</style>
