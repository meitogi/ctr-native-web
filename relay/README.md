# ctr-relay

The meeting point of CTR Native Web rooms : a small WebSocket server where the
players of a room find each other and exchange their WebRTC offer and answer.
When two players have no direct WebRTC path, it also forwards their game
messages. It never reads them : the browsers encrypt everything with the room
secret, which stays in the room link and never reaches any server.

One Node file (`relay.js`), one dependency (`ws`). Node 24 or later.

## The fastest way

Four ways, the quickest first. Each ends with the same two things : the relay's **`wss://`
address** and its **key**. Players type both once in **Settings › Multiplayer › Netplay** (Couch
uses the same), or get them inside your invite links : a room link made on a page with your
relay set carries them (`relay=` and `rk=` after the `#`).

**1. Any box with Docker — one line.** The image is published by the bare edition's repository,
ctr-web ([its workflow](https://github.com/meitogi/ctr-web/blob/web/main/.github/workflows/relay-image.yml)),
for amd64 and arm64 :

```
key=$(openssl rand -base64 24); echo "relay key : $key"
docker run -d --name ctr-relay --restart unless-stopped -p 8787:8787 -e RELAY_KEY="$key" ghcr.io/meitogi/ctr-relay
```

That is `ws://<box>:8787` : fine on your own network (`ws://192.168.1.20:8787`) when the page
is served there too ; the published page (HTTPS) needs `wss://` — put it behind your proxy
([below](#behind-your-reverse-proxy)), or use 2, 3 or 4. A fork's own image is
`ghcr.io/<owner>/ctr-relay`, once its workflow has run and the package is public.

**2. A hosted service — a few clicks, HTTPS included.** Checked 2026-11-12 ; offers change.

| | Cost | Click | The address | The key |
|---|---|---|---|---|
| **Koyeb** | free (one free service ; a card on file, not charged) | [Deploy to Koyeb](https://app.koyeb.com/deploy?type=docker&image=ghcr.io/meitogi/ctr-relay:latest&name=ctr-relay&instance_type=free&regions=fra&ports=8787;http;/&env[PORT]=8787&env[RELAY_KEY]=CHANGE-ME) — replace `CHANGE-ME` in the form before Deploy | `wss://<app>-<org>-<id>.koyeb.app`, on the service's page | the one you typed |
| **Render** | free (sleeps after 15 min with nobody on it ; the first room after that waits ~1 min) | [Deploy to Render](https://render.com/deploy?repo=https://github.com/meitogi/ctr-native-web) — builds `relay/` from the repository ([render.yaml](../render.yaml)) | `wss://<name>.onrender.com` | drawn by Render : the service's Environment, `RELAY_KEY` |
| **DigitalOcean** | ~$5 a month (App Platform's smallest service) | [Deploy to DigitalOcean](https://cloud.digitalocean.com/apps/new?repo=https://github.com/meitogi/ctr-native-web/tree/web/main) — runs the image ([.do/deploy.template.yaml](../.do/deploy.template.yaml)) ; set `RELAY_KEY` at the Environment Variables step | `wss://<app>-<id>.ondigitalocean.app` | the one you typed |

Left out : Fly.io (no free plan for new accounts ; about $2 a month, `fly launch --image
ghcr.io/meitogi/ctr-relay`), Hugging Face Docker Spaces (paid now), Google Cloud Run (a billing
card, and a WebSocket cut at 60 min), Railway (a template to publish from its dashboard first ;
$5 a month), Glitch (closed). A fork's buttons : change `meitogi` in the links and in
`.do/deploy.template.yaml` to its owner.

**3. A throwaway VM, no domain** : [deploy/cloud-init.yaml](deploy/cloud-init.yaml) as the VM's
user data, at any provider (a $4–6 a month VM, by the hour). It prints the `wss://` address and
the key ([below](#on-a-fresh-vm-no-domain--cloud-init)).

**4. Behind your reverse proxy** : Traefik, HAProxy or Caddy, one `.env`
([below](#behind-your-reverse-proxy)).

### What the key protects

The key keeps strangers off your relay : without it a socket is closed at its first message.
Give it with the room links (or out loud) ; change it (`RELAY_KEY`, restart) when it has gone
too far. **`RELAY_ORIGINS`** is the other half : the pages allowed to connect
(`RELAY_ORIGINS=https://you.github.io`), so another site's page cannot use your relay even with
the key. A program that is not a browser sends no `Origin` : only the key stops it.

What the relay sees and cannot see : [the front page](../README.md#how-its-built).

### Your own page on your own relay

A fork that publishes its page (GitHub Pages, [.github/workflows/pages.yml](../.github/workflows/pages.yml))
points it at its relay with one **repository variable** — Settings › Secrets and variables ›
Actions › **Variables** :

| Variable | Unset | Set |
|---|---|---|
| `CTR_RELAY_URL` | the page's relay is `wss://ctr.public.suuuper.app` ([web/net/relay-default.js](../web/net/relay-default.js)) | your `wss://` address : the page's default when a player has typed none |
| `CTR_RELAY_KEY` | no key built in : the public relay asks for none ; a keyed relay's comes in the room links, or is typed once | a key built into the page : players never type one |

Push to `web/main` : the page is rebuilt with them. **A key built into the page is public** :
anyone reads it in the page's source. That is why it is a *variable*, not a *secret* — a secret
would end up in the same public file. It still keeps other sites' pages (with `RELAY_ORIGINS`)
and casual scans off, nothing more. **For a relay that must stay private, leave
`CTR_RELAY_KEY` unset** and hand the key with your invite links. Locally :
`CTR_RELAY_URL=wss://… CTR_RELAY_KEY=… web/build-web.sh release …` does the same.

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
| `RELAY_RATE` / `RELAY_BURST` | `300` / `600` | messages per second per socket, sustained / at once (below) |
| `RELAY_ROOM_MAX` | `8` | peers per room |
| `RELAY_ORIGINS` | empty | pages allowed to connect, comma-separated `Origin`s (`https://ctr.suuuper.app`) ; empty = any. Only fences other sites' pages off a relay : a client without an `Origin` header (not a browser) still connects, the key is what gates it |
| `RELAY_STATS` | — | `1` answers `GET /stats` with counters (sockets, rooms, forwarded, `droppedLossy`, `closedRate`, `refusedOrigin`, and an open relay's : `peakSockets`, `peakRooms`, `refused` per reason, `kicked` per reason) |
| `RELAY_LIVE` | — | `1` answers `GET /live` to any page (`Access-Control-Allow-Origin: *`) with what may be shown in public : `players`, `rooms`, `peakPlayers`, `peakRooms`, `since`. Never a refusal nor a kick : those stay in `/stats`, which a public relay keeps off its public route. The home page shows it under « or join a room » |
| `RELAY_MAX_SOCKETS` | `0` | sockets open at once ; one more is closed 4503. `0` = no limit, as for every row below |
| `RELAY_MAX_ROOMS` | `0` | rooms open at once ; a hello that would open one more is closed 4503 |
| `RELAY_IP_MAX` | `0` | sockets open at once from one client address ; one more is closed 4430 |
| `RELAY_TRUST_PROXY` | `0` | reverse proxies in front of the relay (below). Leave `0` when clients reach it directly |
| `RELAY_ALONE_S` | `0` | seconds a room may stay with one peer ; then it is closed 4410 |
| `RELAY_ROOM_LIFE_S` | `0` | seconds a room may stay open at all ; then everyone in it is closed 4411 |
| `RELAY_IDLE_S` | `0` | seconds a joined socket may go with nothing but pings ; then it is closed 4408. **Players on a direct link are silent on the relay and their room ends when it closes them** : only for a relay that carries every room's traffic |
| `RELAY_LOG_DATA` | — | `1` logs the first characters of each forwarded message (ciphertext), for debugging |

`GET /healthz` answers `200 ok` (Docker healthcheck, proxy health checks).

**Rate.** Each socket has a token bucket (`RELAY_RATE` per second, `RELAY_BURST` at once). A
`data` message its sender flagged `lossy` (the browser does it for kart states only) is dropped
when the bucket is empty. Anything else — control messages, signaling — may borrow one more
burst, then the socket is closed with 4429 : a reliable message is never dropped silently,
the player's page reports the close. The browser coalesces what a host sends to a guest in one
game frame into one message, so a room of N players on the relay costs the host (N − 1) × 30
messages per second : 210 with 8 players.

**An open relay** (no `RELAY_KEY`) is anyone's to use : give it limits. The ones this project's
public relay starts with — one small container (half a CPU, 160 MB), measured at about 1 % of a
core and 57 kB/s for a room of four with every player on the relay :

```sh
RELAY_MAX_SOCKETS=120 RELAY_MAX_ROOMS=40 RELAY_IP_MAX=8 RELAY_ALONE_S=600 RELAY_ROOM_LIFE_S=21600
```

A refusal or a kick is a close code of its own (below), so the player's page says which it was :
« relay full », « too many players from your network », « room closed — no one came ». The counters
of `GET /stats` say how often each happened, and the highest number of sockets and rooms seen :
that is what to read before changing a limit.

**The client's address behind a proxy.** `RELAY_IP_MAX` counts sockets per address. Behind a
reverse proxy every socket comes from the proxy : set `RELAY_TRUST_PROXY` to the number of proxies
in front (`1` for Traefik, HAProxy or Caddy alone), and the address is read in `X-Forwarded-For`,
counting from the right — the entry your own proxy wrote. Never set it on a relay clients reach
directly : they write that header themselves, and there would be no limit per address at all.

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
1009 message too big ; with an open relay's limits : 4503 relay full (sockets or rooms),
4430 too many sockets from one address, 4410 a room nobody joined, 4411 a room's longest
life, 4408 an idle socket.

## Tests

```
cd relay && npm ci && npm test        # relay : rooms, key, limits, TLS and its reload
relay/deploy/test/run.sh              # the three proxy snippets, in Docker
relay/deploy/test/cloud-init/run.sh   # the cloud-init install path, against pebble, in Docker
```

## License

GPL-3.0, like the rest of CTR Native Web.
