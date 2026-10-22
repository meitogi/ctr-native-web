#!/bin/bash
# assemble.sh — copies two build outputs into one Pages-ready site tree :
# the CTR_ONLINE=OFF build (Solo + Share) at the root, the CTR_ONLINE=ON
# build (Online) under online/. An explicit allowlist, never a wildcard copy
# of a build dir (which also holds CMake cache files, tests/, .o).
#
#   web/pages/assemble.sh <off-build-dir> <on-build-dir> <site-dir>
#
# <off-build-dir> : a web/build-web.sh build with -DCTR_ONLINE=OFF
# <on-build-dir>  : a web/build-web.sh build with -DCTR_ONLINE=ON
# <site-dir>      : recreated from scratch
#
# Run web/pages/guard.sh on the result before publishing it anywhere.
set -euo pipefail

off=${1:?usage: assemble.sh <off-build-dir> <on-build-dir> <site-dir>}
on=${2:?usage: assemble.sh <off-build-dir> <on-build-dir> <site-dir>}
site=${3:?usage: assemble.sh <off-build-dir> <on-build-dir> <site-dir>}

# Every build (web/emscripten.cmake, web/share/share.cmake).
COMMON_FILES=(index.html disc.js preload-flag.js ctr_native.js ctr_native.wasm)
COMMON_DIRS=(ui share net)
# CTR_ONLINE=ON only (CMakeLists.txt's CTR_ONLINE block, EMSCRIPTEN branch).
ONLINE_DIRS=(online)

copy_build() {
  local src=$1 dst=$2
  mkdir -p "$dst"
  for f in "${COMMON_FILES[@]}"; do
    [ -f "$src/$f" ] || { echo "assemble.sh: missing $src/$f" >&2; exit 1; }
    cp "$src/$f" "$dst/$f"
  done
  for d in "${COMMON_DIRS[@]}"; do
    [ -d "$src/$d" ] || { echo "assemble.sh: missing $src/$d/" >&2; exit 1; }
    cp -r "$src/$d" "$dst/$d"
  done
}

rm -rf "$site"
mkdir -p "$site"

copy_build "$off" "$site"

copy_build "$on" "$site/online"
for d in "${ONLINE_DIRS[@]}"; do
  [ -d "$on/$d" ] || {
    echo "assemble.sh: missing $on/$d/ — is $on a CTR_ONLINE=ON build?" >&2
    exit 1
  }
  cp -r "$on/$d" "$site/online/$d"
done

# Confirmed against GitHub's own docs this session : a CNAME file is not
# read under the Actions-deploy flow (the custom domain lives in Settings >
# Pages only, TEST-PLAN-13.md), and .nojekyll is a "Deploy from a branch"
# concern. Both are harmless, so both are kept.
: > "$site/.nojekyll"
echo "ctr.suuuper.app" > "$site/CNAME"

echo "assemble.sh: assembled $site :"
find "$site" -type f | sort
