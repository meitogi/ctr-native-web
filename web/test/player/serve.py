#!/usr/bin/env python3
"""Serves a web build with `Cache-Control: no-store`, for the player suites.

    python3 web/test/player/serve.py <build-web-dir> [port]

The agent browser keeps its profile between runs, and a debug and a release
build served in turn on one port share every URL : with web/serve.sh (plain
http.server, no cache header) Chromium reused the release ctr_native.js and
.wasm from its cache under a debug run — no window.__ctr, no request in the
server log. no-store makes every run fetch what is being served.
Default port 8093, bound to 127.0.0.1 like web/serve.sh.
"""
import functools
import http.server
import sys


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8093
    handler = functools.partial(NoStore, directory=sys.argv[1])
    http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
