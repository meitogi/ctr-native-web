#!/bin/bash
# Serves build-web-<config>/ on http://localhost:<port>/ (default 8090).
#
#   web/serve.sh [debug|release] [port]

set -euo pipefail

config=${1:-debug}
port=${2:-8090}
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root/build-web-$config"
exec python3 -m http.server "$port" --bind 127.0.0.1
