#!/usr/bin/env bash
# Inside the stand-in VM (see run.sh). /relay-src = the fork's relay/, read-only.
set -euo pipefail
T=/relay-src/deploy/test/cloud-init
USERDATA=/relay-src/deploy/cloud-init.yaml
fails=0
ok() { echo "PASS $*"; }
ko() { echo "FAIL $*"; fails=$((fails + 1)); }

echo "== packages (cloud-init for the schema check, the user data's own list)"
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cloud-init git curl openssl iproute2 procps >/dev/null 2>&1

echo "== schema"
if cloud-init schema -c "$USERDATA" >/tmp/schema.log 2>&1; then ok "cloud-init schema : $(tail -1 /tmp/schema.log)"; else cat /tmp/schema.log; ko "cloud-init schema"; fi

echo "== write_files, as cloud-init does"
python3 - "$USERDATA" <<'PY'
import os, sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
assert list(doc['write_files'][0]['content'].split('\n')[:2]) == ['RELAY_DOMAIN=', 'RELAY_KEY='], 'the two settings come first'
for f in doc['write_files']:
    os.makedirs(os.path.dirname(f['path']), exist_ok=True)
    with open(f['path'], 'w') as out: out.write(f['content'])
    os.chmod(f['path'], int(f.get('permissions', '0644'), 8))
print('wrote', len(doc['write_files']), 'files ; runcmd', doc['runcmd'])
PY
cp /etc/ctr-relay/settings.env /tmp/settings.default
cp "$T/shims/docker" "$T/shims/systemctl" /usr/local/bin/
chmod +x /usr/local/bin/docker /usr/local/bin/systemctl

# The pebble CA : its own HTTPS (lego talks to it), and the root it issues from (the probe).
curl -fsS -o /tmp/pebble-roots.pem --insecure https://pebble:15000/roots/0
export LEGO_SERVER=https://pebble:14000/dir
export LEGO_CA_CERTIFICATES=/tmp/pebble-minica.pem
curl -fsS --insecure -o /dev/null https://pebble:14000/dir
echo | openssl s_client -connect pebble:14000 -showcerts 2>/dev/null | sed -n '/BEGIN/,/END/p' > /tmp/pebble-leaf.pem
# pebble's HTTPS cert is signed by minica ; the image ships it, the network does not : trust the leaf.
cp /tmp/pebble-leaf.pem "$LEGO_CA_CERTIFICATES"

reset() {
  docker rm -f ctr-relay >/dev/null 2>&1 || true
  rm -rf /var/lib/ctr-relay /etc/ctr-relay/tls /etc/ctr-relay/relay.key /etc/ctr-relay/lego.env /root/ctr-relay.txt /tmp/shim.log
  cp /tmp/settings.default /etc/ctr-relay/settings.env
}

probe() { # name to expect in the certificate, then the probe's own arguments
  node "$T/probe.mjs" "$@"
}

scenario() { # title, expected name, settings lines…
  local title="$1" name="$2"; shift 2
  echo "== $title"
  reset
  printf '%s\n' "$@" > /etc/ctr-relay/settings.env
  if ! PUBLIC_IP="$VM_IP" RELAY_SOURCE=git-source-under-test /usr/local/sbin/ctr-relay-setup > /tmp/setup.log 2>&1; then
    cat /tmp/setup.log; ko "$title : setup failed"; return
  fi
  sed 's/^/  | /' /tmp/setup.log | grep -v '^  | $' | tail -8
  grep -q "wss://$name\$" /root/ctr-relay.txt && ok "$title : summary names wss://$name" || ko "$title : summary"
  local key; key="$(cat /etc/ctr-relay/relay.key)"
  grep -q "relay=wss%3A%2F%2F$name&rk=$key" /root/ctr-relay.txt && ok "$title : link fragment" || ko "$title : link fragment"
  grep -q 'enable --now ctr-relay-renew.timer' /tmp/shim.log && ok "$title : renewal timer enabled" || ko "$title : timer"
  grep -q 'build -q -t ctr-relay git-source-under-test' /tmp/shim.log && ok "$title : image built from RELAY_SOURCE" || ko "$title : build"
  [ "$(stat -c '%u %a' /etc/ctr-relay/tls/key.pem)" = "1000 600" ] && ok "$title : key readable by the relay's user only" || ko "$title : key owner"
  if probe --name "$name" --key "$key" --ca /tmp/pebble-roots.pem --renew; then ok "$title : wss serves the certificate, renewal reloaded it, open socket kept"; else ko "$title : probe"; fi
}

scenario 'default : <ip>.sslip.io' "${VM_IP//./-}.sslip.io" 'RELAY_DOMAIN=' 'RELAY_KEY='
scenario 'custom domain and key' relay.example.test 'RELAY_DOMAIN=relay.example.test' 'RELAY_KEY=chosen-key-123'
[ "$(cat /etc/ctr-relay/relay.key)" = chosen-key-123 ] && ok 'custom key kept' || ko 'custom key'

# sslip.io unusable (rate limit, outage) : its name points elsewhere, the order fails.
curl -fsS -X POST -d "{\"host\":\"${VM_IP//./-}.sslip.io.\",\"addresses\":[\"172.30.77.99\"]}" http://challtestsrv:8055/add-a
scenario 'fallback : IP-address certificate (short-lived profile)' "$VM_IP" 'RELAY_DOMAIN=' 'RELAY_KEY='
grep -q 'LEGO_PROFILE=shortlived' /etc/ctr-relay/lego.env && ok 'fallback : renewals keep the short-lived profile' || ko 'fallback profile'

echo
if [ "$fails" -eq 0 ]; then echo "cloud-init install path OK"; else echo "$fails check(s) FAILED"; exit 1; fi
