#!/bin/bash
# guard.sh — the last lock before a deploy : refuses to let any game data
# leave this repo through the published site. Run after assemble.sh, before
# actions/upload-pages-artifact (ROLLOUT.md "No game data is ever hosted").
#
#   web/pages/guard.sh <site-dir>
#
# Fails (prints the offending path, exits 1) on the first of :
#   - any symlink (find -type f never matches one, so a linked disc image
#     would otherwise walk straight past every other check below)
#   - any *.data file (a preloaded disc)
#   - any file >= 50 MB
#   - any *.bin / *.iso / *.cue / *.img file (case-insensitive)
#   - preload-flag.js saying window.__CTR_WEB_PRELOAD = true
#   - any .js/.html file literally setting window.__CTR_WEB_PRELOAD = true
# On success, prints the accepted file list and the site's total size, and
# exits 0. CTR_WEB_PRELOAD_DISC is never ON in the Pages workflow — this is
# the second lock, not the only one.
set -euo pipefail

site=${1:?usage: guard.sh <site-dir>}
[ -d "$site" ] || { echo "guard.sh: no such directory: $site" >&2; exit 1; }

max_bytes=$((50 * 1024 * 1024))

fail() {
  echo "guard.sh: REFUSED — $1: $2" >&2
  exit 1
}

while IFS= read -r -d '' l; do
  fail "a symlink (not allowed in a published site)" "$l"
done < <(find "$site" -type l -print0)

while IFS= read -r -d '' f; do
  name=$(basename "$f")
  lower=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')

  case "$lower" in
    *.data) fail "a .data file (preloaded disc)" "$f" ;;
    *.bin | *.iso | *.cue | *.img) fail "a disc image extension" "$f" ;;
  esac

  size=$(stat -c%s "$f")
  [ "$size" -ge "$max_bytes" ] && fail "file >= 50 MB ($size bytes)" "$f"

  if [ "$name" = "preload-flag.js" ] && grep -q '__CTR_WEB_PRELOAD *= *true' "$f"; then
    fail "preload-flag.js says true" "$f"
  fi
  case "$lower" in
    *.js | *.html)
      if grep -q 'window\.__CTR_WEB_PRELOAD *= *true' "$f"; then
        fail "sets window.__CTR_WEB_PRELOAD = true" "$f"
      fi
      ;;
  esac
done < <(find "$site" -type f -print0)

echo "guard.sh: accepted files :"
find "$site" -type f -printf '%10s  %p\n' | sort -k2
total=$(find "$site" -type f -printf '%s\n' | awk '{s+=$1} END{print s+0}')
echo "guard.sh: total size: $total bytes"
