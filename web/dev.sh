#!/bin/bash
# web/dev.sh — the one dev entry point (wtf ctr build / dev / prod) : one game build, Online built
# in and switched on at run time (solo by default), the page on one port.
#
#   web/dev.sh build [debug|release]    (re)build the game into build-web-<config> ; a page reload
#                                       in a running `dev` picks the new wasm up
#   web/dev.sh dev                      Vite's dev server on 8090 : the page's sources with hot
#                                       reload (web/ui, index.html, share/, online/, net/), the
#                                       game from build-web-debug (built first if missing)
#   web/dev.sh prod [debug|release]     the site exactly as web/pages/assemble.sh publishes it,
#                                       served on 8090 (release : guard.sh checks it first)
#   Both start a ctr-relay on 8787 with a fresh key and print two ready links : that local relay,
#   and the VPS one with the key from web/.relay-key (gitignored, the VPS's CTR_RELAY_KEY).
#   web/dev.sh ports [--env|--check]    the port list (web/dev-ports.tsv) ; --env : the agent
#                                       browser's AGENT_BROWSER_ORIGINS value ; --check : README,
#                                       .devcontainer/.env and .env.example agree with it
#
# From a container, forward 8090 and 8787 to your machine : VS Code's Ports
# panel, same local number. Ctrl-C stops what dev / prod started.
# Needs what web/build-web.sh needs (emsdk, cmake), python3, openssl.
set -euo pipefail

tree=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=build-progress.sh
source "$tree/web/build-progress.sh"
PAGE=8090
RELAY=8787
# the page's default relay : CTR_RELAY_URL as the build gets it, else web/net/relay-default.js's
DEFAULT_RELAY=${CTR_RELAY_URL:-$(sed -n "s/^export const BUILT_IN_RELAY = '\(.*\)'$/\1/p" "$tree/web/net/relay-default.js")}
[ -n "$DEFAULT_RELAY" ] || { echo "dev.sh: no BUILT_IN_RELAY in web/net/relay-default.js" >&2; exit 1; }
RELAY_KEY_FILE="$tree/web/.relay-key"
PORTS_FILE="$tree/web/dev-ports.tsv"
DEVCONTAINER=${DEVCONTAINER_DIR:-/workspace/.devcontainer}

usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; }

config_of() {
  case "${1:-debug}" in debug|release) echo "${1:-debug}" ;; *) usage >&2; exit 2 ;; esac
}

port_free() {
  if ss -ltn | grep -q ":$1 "; then
    echo "dev.sh: port $1 is already taken :" >&2
    ss -ltnp | grep ":$1 " >&2 || true
    echo "  stop it first : bash plans/ctr-native-web/tools/ports.sh stop $1" >&2
    exit 1
  fi
}

# emsdk's node / npm (Vite), as web/build-web.sh finds them
emsdk_env() {
  local emsdk=${EMSDK:-/workspace/.tmp/emsdk}
  [ -f "$emsdk/emsdk_env.sh" ] || { echo "dev.sh: no emsdk at $emsdk (set EMSDK)" >&2; exit 1; }
  # shellcheck disable=SC1091
  source "$emsdk/emsdk_env.sh" >/dev/null 2>&1
}

cmd_build() {
  local config build
  config=$(config_of "${1:-}")
  build="$tree/build-web-$config"
  echo "== building the $config game in $build (a few minutes the first time)"
  # the CMake cache keeps the options of the last configure : always pass them
  build_with_progress "$build.log" "$tree/web/build-web.sh" "$config" -DCTR_ONLINE=ON -DCTR_WEB_PRELOAD_DISC=OFF || exit 1
  # the disc the agent-browser bots store in their browser (web/*/bot.sh), linked, never copied
  [ -f "$tree/assets/ctr-u.bin" ] && ln -sf "$tree/assets/ctr-u.bin" "$build/ctr-u.bin"
  return 0
}

servers=()
stop_servers() {
  for pid in "${servers[@]}"; do kill "$pid" 2>/dev/null || true; done
  echo
  echo "dev.sh: stopped"
}

# 60 s : Vite's first start after a container restart re-optimizes its deps (~25 s on a busy machine)
wait_port() {
  for _ in $(seq 1 300); do ss -ltn | grep -q ":$1 " && return 0; sleep 0.2; done
  echo "dev.sh: nothing listens on $1 — $2" >&2
  exit 1
}

# a ctr-relay on 8787 with a fresh key, its log beside the build ; sets relay_key
start_relay() {
  [ -d "$tree/relay/node_modules" ] || (cd "$tree/relay" && npm ci --no-audit --no-fund --loglevel=error)
  relay_key=$(openssl rand -hex 12)
  (cd "$tree/relay" && RELAY_KEY="$relay_key" RELAY_LIVE=1 PORT="$RELAY" exec node relay.js) > "$1.relay.log" 2>&1 &
  servers+=($!)
  wait_port "$RELAY" "the relay did not start (log $1.relay.log)"
}

# the page with each relay and its key in the query (page.js reads relay / rk from it)
print_links() {
  local vps_key=''
  [ -f "$RELAY_KEY_FILE" ] && vps_key=$(tr -d '[:space:]' < "$RELAY_KEY_FILE")
  echo "Ready, local relay : http://localhost:$PAGE/?relay=ws://localhost:$RELAY&rk=$relay_key"
  echo "Ready, public relay : http://localhost:$PAGE/   (the page's default, $DEFAULT_RELAY : no key)"
  # the VPS's private relay, for whoever keeps its key in web/.relay-key
  [ -z "$vps_key" ] || echo "Ready, private relay : http://localhost:$PAGE/?relay=${CTR_PRIVATE_RELAY:-wss://ctr-relay.suuuper.app}&rk=$vps_key"
}

cmd_dev() {
  local build="$tree/build-web-debug" relay_key
  [ $# -eq 0 ] || { usage >&2; exit 2; }
  port_free "$PAGE"
  port_free "$RELAY"
  [ -f "$build/ctr_native.wasm" ] || cmd_build debug
  emsdk_env
  [ -d "$tree/web/ui/node_modules" ] || (cd "$tree/web/ui" && npm ci --no-audit --no-fund --loglevel=error)
  trap stop_servers EXIT INT TERM
  start_relay "$build"
  (cd "$tree/web/ui" && CTR_GAME_DIR="$build" exec node node_modules/vite/bin/vite.js --port "$PAGE" --strictPort --host 127.0.0.1 --clearScreen false) > "$build.vite.log" 2>&1 &
  servers+=($!)
  wait_port "$PAGE" "Vite did not start (log $build.vite.log)"
  cat <<EOF

$(print_links)
  Forward $PAGE and $RELAY (the local relay) in VS Code's Ports panel, same local numbers.
  The page's sources reload as you edit them ; the game : wtf ctr build in another terminal,
  then reload the page.
  Debug build, from the main menu : Settings › Dev › « Second window » (Online VS, Online Battle
  or Share) opens a guest beside this window, playing as Bot ; the log and the game state too.
Vite log : $build.vite.log   (Ctrl-C here stops everything)
EOF
  wait
}

cmd_prod() {
  local config build site relay_key
  config=$(config_of "${1:-}")
  build="$tree/build-web-$config"
  site="$build-site"
  port_free "$PAGE"
  port_free "$RELAY"
  # the cmake build also runs vite build into $build/ui : the Svelte production bundle
  cmd_build "$config"
  bash "$tree/web/pages/assemble.sh" "$build" "$site"
  if [ "$config" = release ]; then bash "$tree/web/pages/guard.sh" "$site"; fi
  trap stop_servers EXIT INT TERM
  start_relay "$build"
  python3 "$tree/web/test/player/serve.py" "$site" "$PAGE" > /dev/null 2>&1 &
  servers+=($!)
  wait_port "$PAGE" "the page server did not start"
  cat <<EOF

$(print_links)
  ($config build, the tree assemble.sh publishes : $site)
  Forward $PAGE and $RELAY (the local relay) in VS Code's Ports panel. Ctrl-C here stops both.
EOF
  wait
}

# ---- ports : web/dev-ports.tsv is the one list ----
rows() { grep -v '^#' "$PORTS_FILE" | grep -v '^$'; }
origins() { rows | awk -F'\t' '$4 != "-" { printf "%s%s", sep, $4; sep=" " } END { print "" }'; }
readme_table() {
  echo '| Port | Use | Forward in VS Code |'
  echo '|---|---|---|'
  rows | awk -F'\t' '$1 != "-" { print "| " $1 " | " $2 " | " $3 " |" }'
}

cmd_ports() {
  case "${1:-}" in
    '') rows | awk -F'\t' '$1 != "-" { printf "%-5s %-4s %s\n", $1, $3, $2 }' ;;
    --env) origins ;;
    --check)
      local fails=0 want table env
      want=$(origins)
      table=$(sed -n '/<!-- ports -->/,/<!-- \/ports -->/p' "$tree/README.md" | grep '^|' || true)
      if [ "$table" = "$(readme_table)" ]; then echo "PASS README.md port table"
      else echo "FAIL README.md port table (between <!-- ports --> markers) — expected :"; readme_table; fails=1; fi
      for env in "$DEVCONTAINER/.env" "$DEVCONTAINER/.env.example"; do
        [ -f "$env" ] || { echo "SKIP $env (absent)"; continue; }
        if grep -qxF "AGENT_BROWSER_ORIGINS=$want" "$env" || grep -qxF "#AGENT_BROWSER_ORIGINS=$want" "$env"; then echo "PASS $env AGENT_BROWSER_ORIGINS"
        else echo "FAIL $env : expected the line AGENT_BROWSER_ORIGINS=$want"; fails=1; fi
      done
      return $fails ;;
    --table) readme_table ;;
    *) usage >&2; exit 2 ;;
  esac
}

case "${1:-}" in
  build) shift; cmd_build "$@" ;;
  dev) shift; cmd_dev "$@" ;;
  prod) shift; cmd_prod "$@" ;;
  ports) shift; cmd_ports "$@" ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
