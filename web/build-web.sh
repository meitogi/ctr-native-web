#!/bin/bash
# Builds the browser target (Emscripten / WebAssembly) into build-web-<config>/.
#
#   web/build-web.sh [debug|release] [extra cmake -D options...]
#
# EMSDK points at an activated emsdk (default /workspace/.tmp/emsdk, the
# devcontainer install) ; cmake must be on PATH (or under $CMAKE_ROOT/bin).
# Dev only : -DCTR_WEB_PRELOAD_DISC=ON bundles assets/ctr-u.bin into
# ctr_native.data, so the page boots without the drag & drop.

set -euo pipefail

config=${1:-debug}
shift || true
case "$config" in
    debug) build_type=Debug ;;
    release) build_type=Release ;;
    *) echo "usage: $0 [debug|release] [cmake -D options...]" >&2; exit 2 ;;
esac

root=$(cd "$(dirname "$0")/.." && pwd)
EMSDK=${EMSDK:-/workspace/.tmp/emsdk}
if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
    echo "ERROR: no emsdk at $EMSDK (set EMSDK)" >&2
    exit 1
fi
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
if [ -n "${CMAKE_ROOT:-}" ]; then
    PATH="$CMAKE_ROOT/bin:$PATH"
elif [ -x /workspace/.tmp/cmake/bin/cmake ]; then
    PATH="/workspace/.tmp/cmake/bin:$PATH"
fi

build="$root/build-web-$config"
emcmake cmake -S "$root" -B "$build" -DCMAKE_BUILD_TYPE="$build_type" -DBUILD_TESTING=ON "$@"
cmake --build "$build" -j"$(nproc)"

echo ""
# shellcheck source=build-progress.sh
source "$root/web/build-progress.sh"
echo "built in $(build_duration "$SECONDS")"
ls -l "$build"/index.html "$build"/ctr_native.js "$build"/ctr_native.wasm "$build"/ctr_native.data 2>/dev/null || true
echo "Serve with: web/serve.sh $config"
