<script>
  // One character of a room code, as the home page draws it with no disc (lib/pictos.js).
  import { PICTOS } from './lib/pictos.js'

  let { id, size = 72 } = $props()
</script>

<svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">{@html PICTOS[id]}</svg>
