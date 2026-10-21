#!/usr/bin/env bash
# Runs relay/deploy/cloud-init.yaml's install path for real, against a local ACME CA :
# pebble (Let's Encrypt's test CA) and its challenge DNS, plus a Debian container standing
# in for the VM. Inside it (vm.sh) : the cloud-init schema check, the user data's files
# written as cloud-init would, then the setup script — real lego download and checksum,
# real HTTP-01 on :80, the real relay serving the certificate — for three cases : the
# default <ip>.sslip.io name, a custom RELAY_DOMAIN, and the fallback to an IP-address
# certificate when the sslip.io order fails. Docker and systemd inside the « VM » are shims
# (docker run starts relay.js directly, docker build does nothing) : the image build from
# the git context, the systemd timer and the boot itself are checked on a real VM only.
#
#   relay/deploy/test/cloud-init/run.sh
#
# Needs docker, and internet from the containers (apt, GitHub for lego). Bind mounts use
# this checkout's absolute path : with a remote daemon (dind), that path must exist there too.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RELAY="$(cd "$HERE/../../.." && pwd)"
NET=ctr-relay-ci-test
VM_IP=172.30.77.10
PEBBLE=ghcr.io/letsencrypt/pebble:2.10.1
CHALL=ghcr.io/letsencrypt/pebble-challtestsrv:2.10.1
VM_IMAGE=node:24.22.0-bookworm

cleanup() {
  docker rm -f ctr-ci-pebble ctr-ci-chall ctr-ci-vm >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create --subnet 172.30.77.0/24 "$NET" >/dev/null
# Every name resolves to the « VM », as the real DNS (or sslip.io) would.
docker run -d --name ctr-ci-chall --network "$NET" --network-alias challtestsrv "$CHALL" \
  -defaultIPv4 "$VM_IP" -defaultIPv6 "" -http01 "" -https01 "" -tlsalpn01 "" -doh "" >/dev/null
docker run -d --name ctr-ci-pebble --network "$NET" --network-alias pebble \
  -e PEBBLE_VA_NOSLEEP=1 -e PEBBLE_WFE_NONCEREJECT=0 \
  -v "$HERE/pebble-config.json:/config.json:ro" "$PEBBLE" -config /config.json -dnsserver challtestsrv:8053 >/dev/null
docker run --rm --name ctr-ci-vm --network "$NET" --ip "$VM_IP" \
  -v "$RELAY:/relay-src:ro" -e VM_IP="$VM_IP" \
  "$VM_IMAGE" bash /relay-src/deploy/test/cloud-init/vm.sh
