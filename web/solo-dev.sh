#!/bin/bash
# web/solo-dev.sh — plays the normal game (single player, no OnlineCTR) by hand, in your own
# browser : builds the CTR_ONLINE=OFF web client into its own build directory (so it never
# rebuilds the online one in build-web-<config>), serves it, prints the address. Ctrl-C stops.
#
#   web/solo-dev.sh [debug|release] [page-port]
#
# Defaults : release, port 8095 ; from a container, forward the same number to your machine
# (VS Code : Ports panel, local port = remote port).
# Needs what web/build-web.sh needs (an activated emsdk, cmake), python3.
# SOLO_DEV_NO_BUILD=1 reuses the last build.
set -euo pipefail

config=${1:-release}
page=${2:-8095}
tree=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=build-progress.sh
source "$tree/web/build-progress.sh"
build="$tree/build-web-$config-solo"
case "$config" in debug) type=Debug ;; release) type=Release ;; *) echo "usage: $0 [debug|release] [page-port]" >&2; exit 2 ;; esac

if ss -ltn | grep -q ":$page "; then
  echo "solo-dev.sh: port $page is already taken :" >&2
  ss -ltnp | grep ":$page " >&2 || true
  echo "  pick another : $0 $config <page-port>" >&2
  exit 1
fi

if [ "${SOLO_DEV_NO_BUILD:-}" != 1 ]; then
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
[ -f "$build/ctr_native.wasm" ] || { echo "solo-dev.sh: no build in $build" >&2; exit 1; }

python3 "$tree/web/test/player/serve.py" "$build" "$page" > /dev/null 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; echo; echo "solo-dev.sh: stopped the page server ($page)"' EXIT INT TERM
for _ in $(seq 1 50); do ss -ltn | grep -q ":$page " && break; sleep 0.2; done
curl -sf -o /dev/null "http://127.0.0.1:$page/index.html" || { echo "solo-dev.sh: the page server did not start" >&2; exit 1; }

cat <<EOF

Ready. In VS Code's Ports panel, forward $page (same local number), then open :
     http://localhost:$page/index.html?sound
First time on this address : drop your ctr-u.bin (kept in the browser after that).
Keys : arrows, C = Cross (OK / accelerate), V = Circle, X = Square, Z = Triangle (back),
Enter = Start, Shift / Ctrl = L1 R1 / L2 R2 ; a gamepad works as is.

(Ctrl-C here stops the server)
EOF
wait
