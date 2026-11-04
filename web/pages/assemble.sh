#!/bin/bash
# assemble.sh — copies one build output into a Pages-ready site tree : the
# CTR_ONLINE=ON build (one build since session 14 : Solo, Share and Online)
# at the root, and online/index.html as a redirect to the root for the links
# of the two-build site. An explicit allowlist, never a wildcard copy of a
# build dir (which also holds CMake cache files, tests/, .o).
#
#   web/pages/assemble.sh <on-build-dir> <site-dir>
#
# <on-build-dir> : a web/build-web.sh build with -DCTR_ONLINE=ON
# <site-dir>     : recreated from scratch
#
# Run web/pages/guard.sh on the result before publishing it anywhere.
set -euo pipefail

on=${1:?usage: assemble.sh <on-build-dir> <site-dir>}
site=${2:?usage: assemble.sh <on-build-dir> <site-dir>}

# Every build (web/emscripten.cmake, web/share/share.cmake, web/audio/audio.cmake).
COMMON_FILES=(index.html disc.js preload-flag.js ctr_native.js ctr_native.wasm)
COMMON_DIRS=(ui share net audio)
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

copy_build "$on" "$site"
for d in "${ONLINE_DIRS[@]}"; do
  [ -d "$on/$d" ] || {
    echo "assemble.sh: missing $on/$d/ — is $on a CTR_ONLINE=ON build?" >&2
    exit 1
  }
  cp -r "$on/$d" "$site/$d"
done

# The two-build site served Online under /online/ : its links keep working (the
# room is in the fragment, which a redirect keeps).
mkdir -p "$site/online"
cat > "$site/online/index.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>CTR in your browser</title>
<script>location.replace('../' + location.search + location.hash);</script>
<p>Online now lives on the main page : <a href="../">ctr.suuuper.app</a></p>
HTML

# Confirmed against GitHub's own docs this session : a CNAME file is not
# read under the Actions-deploy flow (the custom domain lives in Settings >
# Pages only, TEST-PLAN-13.md), and .nojekyll is a "Deploy from a branch"
# concern. Both are harmless, so both are kept.
: > "$site/.nojekyll"
echo "ctr.suuuper.app" > "$site/CNAME"

echo "assemble.sh: assembled $site :"
find "$site" -type f | sort
