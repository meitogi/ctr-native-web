#!/bin/bash
# web/share/dev.sh — plays the Share mode by hand, in your own browser : builds the
# single-player web client (the Share panel is on every page) into web/solo-dev.sh's build
# directory, serves it, starts a local ctr-relay with a fresh key, and prints the address to
# open. Ctrl-C stops both servers.
#
#   web/share/dev.sh [debug|release] [page-port] [relay-port]
#
# Defaults : release, page 8096, relay 8791 ; from a container, forward the same numbers to your
# machine (VS Code : Ports panel, local port = remote port). Share is peer to peer : a guest on
# another machine needs these two ports too (signaling), then a direct WebRTC path to the host.
# Needs what web/build-web.sh needs (an activated emsdk, cmake), node, python3, openssl.
# SHARE_DEV_NO_BUILD=1 reuses the last build.
set -euo pipefail

config=${1:-release}
page=${2:-8096}
relayPort=${3:-8791}
tree=$(cd "$(dirname "$0")/../.." && pwd)
# shellcheck source=../build-progress.sh
source "$tree/web/build-progress.sh"
build="$tree/build-web-$config-solo" # web/solo-dev.sh's : CTR_ONLINE off, never the online build
case "$config" in debug) type=Debug ;; release) type=Release ;; *) echo "usage: $0 [debug|release] [page-port] [relay-port]" >&2; exit 2 ;; esac
for p in "$page" "$relayPort"; do
  if ss -ltn | grep -q ":$p "; then
    echo "dev.sh: port $p is already taken :" >&2
    ss -ltnp | grep ":$p " >&2 || true
    echo "  pick other ports : $0 $config <page-port> <relay-port>" >&2
    exit 1
  fi
done

if [ "${SHARE_DEV_NO_BUILD:-}" != 1 ]; then
  EMSDK=${EMSDK:-/workspace/.tmp/emsdk}
  # shellcheck disable=SC1091
  source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
  [ -x /workspace/.tmp/cmake/bin/cmake ] && PATH="/workspace/.tmp/cmake/bin:$PATH"
  echo "== building the $config single-player client in $build (a few minutes the first time)"
  build() {
    emcmake cmake -S "$tree" -B "$build" -DCMAKE_BUILD_TYPE="$type" -DBUILD_TESTING=OFF -DCTR_ONLINE=OFF -DCTR_WEB_PRELOAD_DISC=OFF && cmake --build "$build" -j"$(nproc)"
  }
  build_with_progress "$build.log" build || exit 1
fi
[ -f "$build/share/panel.js" ] || { echo "dev.sh: $build has no share/panel.js — build it first" >&2; exit 1; }
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
curl -sf -o /dev/null "http://127.0.0.1:$page/share/guest.html" || { echo "dev.sh: no share/guest.html in $build" >&2; exit 1; }
curl -sf -o /dev/null "http://127.0.0.1:$relayPort/healthz" || { echo "dev.sh: the relay did not start (log $build.relay.log)" >&2; exit 1; }

url="http://localhost:$page/index.html?sound&relay=ws://localhost:$relayPort&rk=$key"
cat <<EOT

Ready. In VS Code's Ports panel, forward $page and $relayPort (same local numbers).

1. Host — open in your browser :
     $url
   First time on this address : drop your ctr-u.bin (kept in the browser after that).
   Share panel (right) → Share → Copy guest link.
2. Guest — open the copied link in a second window or on another machine (no disc there).
   Click once for sound. Keys : arrows, C = Cross, V = Circle, X = Square, Z = Triangle,
   Enter = Start, or a gamepad ; F = only your part of the split screen.
3. The guest is P2 : on the host, VS. or Arcade → 2 players.

Relay log : $build.relay.log   (Ctrl-C here stops everything)
EOT
wait
