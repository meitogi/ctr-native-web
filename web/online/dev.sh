#!/bin/bash
# web/online/dev.sh — plays the Online mode by hand, in your own browser : builds the
# CTR_ONLINE web client, serves it, starts a local ctr-relay with a fresh key, and
# prints the address to open. Ctrl-C stops both servers.
#
#   web/online/dev.sh [debug|release] [page-port] [relay-port]
#
# Defaults : release, page 8094, relay 8789 ; from a container, forward the same numbers
# to your machine (VS Code : Ports panel, local port = remote port).
# Needs what web/build-web.sh needs (an activated emsdk, cmake), node, python3, openssl.
# ONLINE_DEV_NO_BUILD=1 reuses the last build.
set -euo pipefail

config=${1:-release}
page=${2:-8094}
relayPort=${3:-8789}
tree=$(cd "$(dirname "$0")/../.." && pwd)
build="$tree/build-web-$config"

case "$config" in debug|release) ;; *) echo "usage: $0 [debug|release] [page-port] [relay-port]" >&2; exit 2 ;; esac
for p in "$page" "$relayPort"; do
  if ss -ltn | grep -q ":$p "; then
    echo "dev.sh: port $p is already taken :" >&2
    ss -ltnp | grep ":$p " >&2 || true
    echo "  pick other ports : $0 $config <page-port> <relay-port>" >&2
    exit 1
  fi
done

if [ "${ONLINE_DEV_NO_BUILD:-}" != 1 ]; then
  echo "== building the $config CTR_ONLINE client in $build (a few minutes the first time)"
  "$tree/web/build-web.sh" "$config" -DCTR_ONLINE=ON -DCTR_WEB_PRELOAD_DISC=OFF > "$build.log" 2>&1 \
    || { tail -20 "$build.log"; echo "dev.sh: build failed, full log $build.log" >&2; exit 1; }
fi
[ -f "$build/online/page.js" ] || { echo "dev.sh: $build has no online/page.js — not a CTR_ONLINE build" >&2; exit 1; }
if [ ! -d "$tree/relay/node_modules" ]; then
  echo "== installing the relay's dependencies"
  (cd "$tree/relay" && npm ci --no-audit --no-fund >/dev/null)
fi

key=$(openssl rand -hex 12)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  echo
  echo "dev.sh: stopped the page server ($page) and the relay ($relayPort)"
}
trap cleanup EXIT INT TERM

python3 "$tree/web/test/player/serve.py" "$build" "$page" > /dev/null 2>&1 &
pids+=($!)
(cd "$tree/relay" && RELAY_KEY="$key" PORT="$relayPort" exec node relay.js) > "$build.relay.log" 2>&1 &
pids+=($!)

for _ in $(seq 1 50); do
  ss -ltn | grep -q ":$page " && ss -ltn | grep -q ":$relayPort " && break
  sleep 0.2
done
curl -sf -o /dev/null "http://127.0.0.1:$page/index.html" || { echo "dev.sh: the page server did not start" >&2; exit 1; }
curl -sf -o /dev/null "http://127.0.0.1:$relayPort/healthz" || { echo "dev.sh: the relay did not start (log $build.relay.log)" >&2; exit 1; }

url="http://localhost:$page/index.html?relay=ws://localhost:$relayPort&rk=$key"
cat <<EOF

Ready. In VS Code's Ports panel, forward $page and $relayPort (same local numbers).

1. Host — open in your browser :
     $url
   First time on this address : drop your ctr-u.bin (kept in the browser after that).
   Online panel (right) → Create room → Copy link.
2. Guest — open the copied link in a second window (or on another machine
   that reaches these ports), give it another player name.
3. In both games (they boot straight into the server menu) : Private Room, then the same room number (the host
   joins first : it picks the track). Rooms 5-9 have items.
   Keys : C = Cross (accelerate / OK), V = Circle (fire), X = Square, arrows, Space = Select (leave).

Relay log : $build.relay.log   (Ctrl-C here stops everything)
EOF
wait
