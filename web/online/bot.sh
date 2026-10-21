#!/bin/bash
# web/online/bot.sh — a fake Online guest, « Bot », so you can test a race alone : the agent
# browser opens your room link, joins your room, waits for your track and laps, locks a
# character and drives one race (web/test/player/online-bot.suite.mjs).
#
#   web/online/bot.sh '<room link>'
#
# Serve with web/online/dev.sh debug 8092 8787 : the agent browser's proxy only opens the ports
# in AGENT_BROWSER_ORIGINS, and only a debug build lets the bot follow the racing line (a
# release build gets Cross held and items fired). Start it once you are in your room, before
# you confirm the track. Screenshots and the run's index land in build-bot-proofs/.
set -euo pipefail

link=${1:-}
tree=$(cd "$(dirname "$0")/../.." && pwd)
if [ -z "$link" ]; then
  echo "usage: $0 '<room link>'   (Online panel → Create room → Copy link ; quote it, it has a #)" >&2
  exit 2
fi
origin=$(node -e 'const u = new URL(process.argv[1]); console.log(u.origin)' "$link" 2>/dev/null) \
  || { echo "bot.sh: not a link : $link" >&2; exit 2; }
relay=$(node -e 'const u = new URL(process.argv[1]); console.log(u.searchParams.get("relay") || "")' "$link")
command -v agent-browser >/dev/null 2>&1 || { echo "bot.sh: no agent-browser in this container (wtf base dev)" >&2; exit 1; }
for o in "$origin" ${relay:+"$(node -e 'const u = new URL(process.argv[1]); console.log("http://" + u.host)' "$relay")"}; do
  case " ${AGENT_BROWSER_ORIGINS:-} " in
    *" $o "*) ;;
    *) echo "bot.sh: the agent browser does not open $o (AGENT_BROWSER_ORIGINS : ${AGENT_BROWSER_ORIGINS:-none})" >&2
       echo "  serve on two of its ports instead, e.g. : wtf ctr online debug 8092 8787" >&2
       exit 1 ;;
  esac
done

e2e=""
for dir in /opt/devcontainer/base/skills/visual-loop /workspace/packages/devcontainer-sandbox/assets/opt/skills/visual-loop; do
  [ -f "$dir/lib/player.mjs" ] && { e2e=$dir/scripts/e2e.mjs; break; }
done
[ -n "$e2e" ] || { echo "bot.sh: no visual-loop with the player harness (lib/player.mjs)" >&2; exit 1; }

eval "$(agent-browser env)"
lock=/tmp/cdp/.cdp-lock-$CDP_HOST-$CDP_PORT.json
if [ -f "$lock" ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).expires > Date.now() ? 0 : 1)' "$lock" 2>/dev/null; then
  echo "bot.sh: the agent browser is busy (another session holds $lock) — try again later" >&2
  exit 1
fi
agent-browser down >/dev/null 2>&1 || true
agent-browser up "$origin/preload-flag.js" >/dev/null
eval "$(agent-browser env)"
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://$CDP_HOST:$CDP_PORT/json/version" && break
  sleep 1
done

echo "bot.sh: Bot is joining — enter your room (it picks the one with a player), then the track and laps"
node "$e2e" --suite "$tree/web/test/player/online-bot.suite.mjs" --url "$origin/index.html" \
  --proofs "$tree/build-bot-proofs" --set "link=$link"
