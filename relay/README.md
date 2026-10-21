# ctr-relay

The meeting point of CTR Native Web rooms : a small WebSocket server where the
players of a room find each other and exchange their WebRTC offer and answer.
When two players have no direct WebRTC path, it also forwards their game
messages. It never reads them : the browsers encrypt everything with the room
secret, which stays in the room link and never reaches any server.

One Node file (`relay.js`), one dependency (`ws`). Node 24 or later.

## Run it

```
docker build -t ctr-relay relay/
docker run -d --name ctr-relay -p 8787:8787 -e RELAY_KEY="$(openssl rand -base64 24)" ctr-relay
```

or without Docker : `cd relay && npm ci && RELAY_KEY=… npm start`.

It listens on plain `ws://:8787`. Browsers need `wss://` : put it behind a
reverse proxy ([deploy/](deploy/), next section), or give it a certificate with
`TLS_CERT` / `TLS_KEY` and it serves `wss://` itself.

| Variable | Default | |
|---|---|---|
| `RELAY_KEY` | empty | access key ; empty = open relay (anyone can use it) |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | listening address |
| `TLS_CERT` / `TLS_KEY` | — | PEM files : serve `wss://` without a proxy |
| `TLS_WATCH_MS` | `60000` | how often the TLS files are checked for a renewal ; `0` = only on `SIGHUP` |
| `RELAY_MAX_BYTES` | `16384` | largest message ; above it the socket is closed (1009) |
| `RELAY_RATE` / `RELAY_BURST` | `120` / `240` | messages per second per socket, sustained / at once |
| `RELAY_ROOM_MAX` | `8` | peers per room |
| `RELAY_LOG_DATA` | — | `1` logs the first characters of each forwarded message (ciphertext), for debugging |

`GET /healthz` answers `200 ok` (Docker healthcheck, proxy health checks).

A renewed certificate is picked up without a restart : when `TLS_CERT` / `TLS_KEY`
change on disk, or on `SIGHUP` (`docker kill -s HUP ctr-relay`), the relay re-reads them
for new connections. Rooms and open sockets are untouched. A pair that does not load (a
key that does not match the certificate, a file half-written) is logged and the previous
certificate stays.

## On a fresh VM, no domain : cloud-init

[deploy/cloud-init.yaml](deploy/cloud-init.yaml) turns a new Ubuntu 24.04 (or Debian 12+)
VM at any provider into a relay with HTTPS, in a few minutes : paste the file as the VM's
**user data** (the VM creation form has a field for it, named « user data » or
« cloud-init » depending on the provider), create the VM, wait, read the result. Destroy the VM after the game.

Its two settings are at the top of the file :

| Setting | Empty | Set |
|---|---|---|
| `RELAY_DOMAIN` | `<ip>.sslip.io` (`203-0-113-7.sslip.io` resolves to `203.0.113.7`, nothing to own) | your name ; its DNS A record must point at the VM before it boots |
| `RELAY_KEY` | random, drawn at first boot | the access key you choose |

What it does : installs Docker, builds this image from the fork on GitHub, downloads
[lego](https://github.com/go-acme/lego) 5.5.2 (one static binary, SHA-256 checked against
the release's checksums), gets a Let's Encrypt certificate over HTTP-01 on port 80, runs the
relay serving `wss://` itself on port 443 (no proxy), and installs a systemd timer that
checks the certificate twice a day ; a renewal hands the new files to the relay and sends it
`SIGHUP`. Ports 80 and 443 must be open.

The result, on the provider's web console, in `/var/log/cloud-init-output.log` and in
`/root/ctr-relay.txt` :

```
ctr-relay is up : wss://203-0-113-7.sslip.io
Room link fragment (append after the room's # part, with &) :
  relay=wss%3A%2F%2F203-0-113-7.sslip.io&rk=Jm3…
Relay key : Jm3…
```

**sslip.io and Let's Encrypt's limits.** sslip.io is not on the Public Suffix List, so for
Let's Encrypt every `*.sslip.io` name belongs to one registered domain, `sslip.io`, and all
its users share one « new certificates per registered domain » allowance (50 per week by
default ; Let's Encrypt has raised it for sslip.io several times). When it runs out, the
order fails : the VM then asks for a certificate for its bare IP address instead (Let's
Encrypt's short-lived profile, valid 6 days, renewed by the same timer), and prints
`wss://<ip>`. With your own `RELAY_DOMAIN` neither applies.

`deploy/test/cloud-init/run.sh` runs this install path against a local ACME CA (pebble) in
Docker : the schema, lego's download and checksum, the three certificate cases (sslip.io
name, custom domain, IP fallback), the relay serving each, and a forced renewal reloaded
while a socket stays open.

## Behind your reverse proxy

[deploy/](deploy/) holds a drop-in for **Traefik**, **HAProxy** and **Caddy**.
Each one reads the host name from `RELAY_DOMAIN` in one `.env` :

```
cp relay/deploy/.env.example relay/deploy/.env     # set RELAY_DOMAIN, RELAY_KEY, PROXY_NETWORK
cd relay/deploy/traefik                            # or haproxy, caddy
docker compose --env-file ../.env -p ctr-relay up -d --build
```

- **Traefik** (docker provider) : the labels in `traefik/compose.yml` are the whole
  snippet. Set `TRAEFIK_ENTRYPOINT` and `TRAEFIK_CERTRESOLVER` to your names.
- **HAProxy** : load `haproxy/ctr-relay.cfg` next to your config
  (`haproxy -f haproxy.cfg -f ctr-relay.cfg`, with `RELAY_DOMAIN` in HAProxy's
  environment) and add the `use_backend` line from its header to your HTTPS
  frontend. `timeout tunnel 1h` keeps idle WebSockets open.
- **Caddy** : `import relay.caddy` in your Caddyfile, `RELAY_DOMAIN` in Caddy's
  environment. Caddy gets the certificate and proxies WebSockets as is.

The relay container joins your proxy's network (`PROXY_NETWORK`) as `ctr-relay`.
The DNS record of `RELAY_DOMAIN` must point straight at the proxy : a CDN in
front (Cloudflare's orange cloud) cuts idle WebSockets.

`deploy/test/run.sh [traefik|haproxy|caddy|all]` starts each snippet for real with
its proxy in Docker and checks a `wss://` connection, the key and forwarding
through it.

## The access key

With `RELAY_KEY` set, the first message of a connection must be its `hello` and
carry `key`. A wrong key, another first message, or no hello within 5 s closes
the socket with code 4401. Comparison is constant time. The key is not a header
or a query string (browsers cannot set WebSocket headers, and query strings end
up in proxy logs) ; players get it in the room link after `#`, as `rk=`.

Rotate it : change `RELAY_KEY`, restart, share new links.

## Protocol

JSON text messages : the `hello` / `peers` / `signal` / `ping` protocol of the
debrid-remote `signal-relay` (a client that sends no `room` still works), scoped
to rooms, plus `data`.

| Message | Sent by | Relay does |
|---|---|---|
| `{type:'hello', id, name?, kind?, room?, key?}` | every peer, first | joins `room` (default `""`), replies `{type:'welcome', peers}`, sends `{type:'peers', list}` to the room |
| `{type:'signal', to, …}` | a peer | forwards it as is to `to` in the same room, `from` set to the sender |
| `{type:'data', to?, data}` | a peer | forwards `{type:'data', from, data}` to `to`, or to everyone else in the room when `to` is absent ; `data` is an opaque string |
| `{type:'ping', ts}` | a peer | replies `{type:'pong', ts, srv}` |

`peers` / `list` are `[{id, name, kind}]` of the room, the peer itself included.
A peer leaving triggers a new `peers`. Close codes : 4400 malformed hello,
4401 key, 4403 room full, 4409 id already in the room, 4429 rate limit,
1009 message too big.

## Tests

```
cd relay && npm ci && npm test        # relay : rooms, key, limits, TLS and its reload
relay/deploy/test/run.sh              # the three proxy snippets, in Docker
relay/deploy/test/cloud-init/run.sh   # the cloud-init install path, against pebble, in Docker
```

## License

GPL-3.0, like the rest of CTR Native Web.
