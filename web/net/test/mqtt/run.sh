#!/usr/bin/env bash
# Runs mqtt.test.js against a real MQTT broker : Mosquitto in Docker standing in for the
# public brokers (third-party hosts a firewall may block), the test in a Node container on
# the same network. Cleans up after.
#
#   web/net/test/mqtt/run.sh
#
# Needs docker. Bind mounts use this checkout's absolute path : with a remote daemon (dind),
# that path must exist there too. Needs relay/node_modules (cd relay && npm ci).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
NET=ctr-net-mqtt-test
BROKER=ctr-net-mqtt-broker

cleanup() {
  docker rm -f "$BROKER" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$BROKER" --network "$NET" --network-alias broker \
  -v "$HERE/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro" eclipse-mosquitto:2.1.2-alpine >/dev/null
docker run --rm --network "$NET" -v "$ROOT:/repo:ro" -w /repo \
  -e MQTT_URL=ws://broker:9001 -e MQTT_DEAD_URL=ws://nobody.invalid:9001 \
  node:24.22.0-alpine3.24 node --test web/net/test/mqtt.test.js
