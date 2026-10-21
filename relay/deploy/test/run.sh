#!/usr/bin/env bash
# Runs each drop-in snippet of relay/deploy/ for real : the kit's compose file plus a
# test overlay with the proxy itself, on a throwaway network, then probe.mjs from a
# container on that network (wss connect, key check, data, /healthz). Cleans up after.
#
#   relay/deploy/test/run.sh [traefik|haproxy|caddy|all]     (default : all)
#
# Needs docker with compose, and openssl. Bind mounts use this checkout's absolute
# path : with a remote daemon (dind), that path must exist there too.
set -euo pipefail

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(dirname "$TEST_DIR")"
TMP="$TEST_DIR/.tmp"
export TEST_DIR

mkdir -p "$TMP"
if [ ! -f "$TMP/relay.pem" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 7 \
    -subj /CN=relay.test -addext subjectAltName=DNS:relay.test \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
  cat "$TMP/cert.pem" "$TMP/key.pem" > "$TMP/relay.pem"
  chmod 644 "$TMP/relay.pem"
fi

run_one() {
  local proxy="$1" port="$2"
  local project="ctr-relay-test-$proxy"
  local env="$TMP/$proxy.env"
  cat > "$env" <<ENV
RELAY_DOMAIN=relay.test
RELAY_KEY=$(openssl rand -hex 16)
PROXY_NETWORK=$project
TRAEFIK_ENTRYPOINT=websecure
TRAEFIK_CERTRESOLVER=letsencrypt
ENV
  local compose=(docker compose -p "$project" --env-file "$env" -f "$DEPLOY_DIR/$proxy/compose.yml" -f "$TEST_DIR/$proxy.yml")
  cleanup() {
    "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
    docker network rm "$project" >/dev/null 2>&1 || true
  }
  trap cleanup RETURN
  echo "== $proxy"
  docker network create "$project" >/dev/null
  "${compose[@]}" up -d --build --wait --quiet-pull >/dev/null
  local status=0
  docker run --rm --network "$project" --env-file "$env" -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
    -v "$TEST_DIR/probe.mjs:/app/probe.mjs:ro" ctr-relay node probe.mjs "wss://relay.test:$port" || status=$?
  if [ "$status" -ne 0 ]; then
    "${compose[@]}" logs --tail 30 || true
    return "$status"
  fi
}

target="${1:-all}"
failed=0
for proxy in traefik haproxy caddy; do
  [ "$target" = all ] || [ "$target" = "$proxy" ] || continue
  case "$proxy" in haproxy) port=8443 ;; *) port=443 ;; esac
  run_one "$proxy" "$port" || failed=1
done
[ "$failed" -eq 0 ] && echo "all snippets OK" || { echo "a snippet FAILED"; exit 1; }
