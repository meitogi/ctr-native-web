#!/bin/bash
# web/share/bot.sh — a fake Share guest, « Bot », so you can test a Share race alone : the agent
# browser opens your guest link and plays P2 over it, like a second player would — at each
# character select it browses the grid and locks one at random, it drives each race along the racing line and fires its items,
# until you stop sharing (or Ctrl-C) (web/test/player/share-bot.suite.mjs).
#
#   web/share/bot.sh '<guest link>'
#
# Host with a debug build on two of the agent browser's ports (AGENT_BROWSER_ORIGINS) :
# web/share/dev.sh debug 8091 8788 — then Share → Copy guest link. A release host sends the bot
# no kart state : it holds Cross (accelerates, locks its character) and does not steer.
# BOT_INSTANCE=b runs it on agent browser b (default a). The run's index lands in build-bot-proofs/
# (no screenshot : the agent browser shoots a guest page's <video> grey — the host's screen is the proof).
set -euo pipefail

link=${1:-}
tree=$(cd "$(dirname "$0")/../.." && pwd)
instance=${BOT_INSTANCE:-a}
if [ -z "$link" ]; then
  echo "usage: $0 '<guest link>'   (Share panel → Share → Copy guest link ; quote it, it has a #)" >&2
  exit 2
fi
origin=$(node -e 'const u = new URL(process.argv[1]); if (!u.hash.includes("room=")) throw 0; console.log(u.origin)' "$link" 2>/dev/null) \
  || { echo "bot.sh: not a guest link (…/share/guest.html#room=…) : $link" >&2; exit 2; }
# the relay rides after the # : relay=ws://host:port
relay=$(node -e 'const u = new URL(process.argv[1]); console.log(new URLSearchParams(u.hash.slice(1)).get("relay") || "")' "$link")
command -v agent-browser >/dev/null 2>&1 || { echo "bot.sh: no agent-browser in this container (wtf base dev)" >&2; exit 1; }
for o in "$origin" ${relay:+"$(node -e 'const u = new URL(process.argv[1]); console.log("http://" + u.host)' "$relay")"}; do
  case "$o" in http://localhost:*|http://127.0.0.1:*) ;; *) continue ;; esac # a public relay is reached directly
  case " ${AGENT_BROWSER_ORIGINS:-} " in
    *" $o "*) ;;
    *) echo "bot.sh: the agent browser does not open $o (AGENT_BROWSER_ORIGINS : ${AGENT_BROWSER_ORIGINS:-none})" >&2
       echo "  host on two of its ports instead, e.g. : web/share/dev.sh debug 8091 8788" >&2
       exit 1 ;;
  esac
done

e2e=""
for dir in /opt/devcontainer/base/skills/visual-loop /workspace/packages/devcontainer-sandbox/assets/opt/skills/visual-loop; do
  [ -f "$dir/lib/player.mjs" ] && { e2e=$dir/scripts/e2e.mjs; break; }
done
[ -n "$e2e" ] || { echo "bot.sh: no visual-loop with the player harness (lib/player.mjs)" >&2; exit 1; }

ab() { agent-browser -i "$instance" "$@"; }
eval "$(ab env)"
lock=/tmp/cdp/.cdp-lock-$CDP_HOST-$CDP_PORT.json
if [ -f "$lock" ] && node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).expires > Date.now() ? 0 : 1)' "$lock" 2>/dev/null; then
  echo "bot.sh: agent browser $instance is busy (another session holds $lock) — try again later" >&2
  exit 1
fi
ab down >/dev/null 2>&1 || true
ab up "$origin/preload-flag.js" >/dev/null
eval "$(ab env)"
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://$CDP_HOST:$CDP_PORT/json/version" && break
  sleep 1
done
# the host turns an idle browser off after AGENT_BROWSER_IDLE_S : the bot stays as long as you share
( while :; do ab hold 30 || true; sleep 600; done ) >/dev/null 2>&1 &
keep=$!
trap 'kill $keep 2>/dev/null || true' EXIT

echo "bot.sh: Bot is joining on agent browser $instance — pick VS. › 2 players : it locks P2's character and races ; stop sharing (or Ctrl-C) to end"
node "$e2e" --suite "$tree/web/test/player/share-bot.suite.mjs" --url "$origin/preload-flag.js" \
  --proofs "$tree/build-bot-proofs" --set "link=$link"
