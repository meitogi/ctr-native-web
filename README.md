# CTR Native Web

**ctr. in your browser. no cap.** bring your own disc, grab a pad, ruin a few
friendships. gg.

a [Meitogi](https://github.com/meitogi) thing. **beta** : it works, it has bugs, tell us
([report a problem](#report-a-problem)).

> **[Play at ctr.suuuper.app](https://ctr.suuuper.app/)**

no install. no emulator. no plugin. no sketchy .exe from a forum post in 2009. it's the
decompiled PS1 game rebuilt for the web, forked from
[CTR Native](https://github.com/CTR-tools/ctr-native), the native PC port.

## bring your own disc

we don't host the game. don't ask. you know why (lawyers).

you need your own **NTSC-U** copy as a raw disc image : `ctr-u.bin`, `MODE2/2352`, what a
CD ripper spits out. a cooked 2048-byte `.iso` won't do — no voices, no videos, sad Aku
Aku. loose or in a `.zip`, drop it anywhere on the page **once**. it lives in your
browser now. nothing gets uploaded. next time you just press the button and send it.

## what works

- **the whole game, in a tab** — menus, races, music, voices, saves kept in your
  browser. clear your site data and that's on you.
- **controls** — keyboard or any gamepad, remap every button in Settings (Triangle to
  accelerate ? bold. respect.), the right button icons for your pad, « Skip intro »
  because we've all seen it. pads start in analog (ANA), Select + Start flips to digital
  (DIG), just like the PlayStation's Analog button.
- **couch party** — 2 to 4 players, 1 screen, 0 friendships left. one pad each, or two
  on one keyboard (left half WASD, right half arrows, elbows included). whoever drives
  the menus is P1 ; everyone else presses Start on the character select to hop in, and
  holds Select to hop out. hold L1 + R1 in the menus to see who's who.
- **Couch** — the couch, minus the couch. Select on the character select opens a room :
  say its code out loud, your friends type it under « or join a room » on the home page
  and play as P2–P4 **with no disc**. they get your game as live video + sound — so a bit
  of delay — you get their pads, peer to peer. they lose, it's lag. they win, it's
  skill. classic. Select again to stop.
- **Netplay** — everyone on their own screen, with their own disc, same house or across
  the internet. pick VS, Battle or Arcade in NETPLAY and you're hosting ; INVITE shows the
  room's code — a few of the game's characters, « Crash, Coco, Tiny » — or copies the link.
  your friends pick JOIN and dial the code, or click the link. someone who came by code
  knocks, you let them in (or not). Arcade fills the grid to 8 karts with your game's
  bots. wifi dies, you come back, the race remembers you.
- **private by default** — rooms are end-to-end encrypted : what goes through the relay
  is sealed with the room's secret, which never leaves the link or the code.

## the limits (read this before you report them)

- **your own NTSC-U disc.** PAL and Japanese discs are refused, for now.
- **Netplay : one player per browser**, four in a room, each with their own disc.
- **Couch : several players on the host's machine, one per guest browser, four in all.**
  the guests watch a video of the host's game : expect a little delay.
- **Couch needs a direct connection** between the host and each guest. some networks
  (offices, schools, some mobile data) don't allow one : the guest is told so. Netplay
  still works there, through the relay.
- **the default relay is public, and capped.** no key to ask for : rooms meet on our relay
  out of the box. it holds a limited number of players and rooms, closes a room nobody
  joined after ten minutes, and any room after six hours. « RELAY FULL » ? try later, or
  [run your own relay](#run-your-own-relay) and set it in Settings › Multiplayer › Netplay.
- **a room's code is short on purpose** (you say it out loud). the host's door keeps
  strangers out ; for a room nobody else could ever read, share the link, not the code.
- **browsers** : played in Chrome (and the other Chromium browsers) every session ; Safari
  by hand, with one open crash in Netplay Arcade ; Firefox not checked yet. no touch
  controls : phones aren't a target today.
- **not there yet** : the list right below.

## soon™

no dates. no versions. trust the process.

| | what | why you care |
|---|---|---|
| next | **every setting with the pad** | never touch the keyboard again (the Home button where the browser lets us) |
| in the oven | **couch + netplay** | sofa vs. sofa. 2v2. bring snacks. several players per guest, and per Netplay browser |
| in the oven | **your screen, your shape** | full window resolution + widescreen. 240p was a vibe in 1999, it's 2026 |
| in the oven | **race the DuckStation crowd** | public OnlineCTR servers, players on the original game. they've been grinding since 1999. gl hf |
| in the oven | **disc from your own server** | load it from a box on your home network. drop it once per house, not once per device |
| in the oven | **the original** | a bare page at `/original/` : the game, local multiplayer, nothing else |
| trust me bro | **PAL discs** | French version first. 50 Hz and all |

## how it's built

- **the game** — [CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) decompiled it to C,
  [CTR Native](https://github.com/CTR-tools/ctr-native) made it a PC game, this fork builds
  it to **WebAssembly** with Emscripten (SDL3 underneath).
- **the picture** — **WebGL2** (CTR Native's renderer, ported to GLSL ES 3.0).
- **the sound** — the PS1's sound chip emulated in an **AudioWorklet** (Web Audio), off the
  main thread, so the music keeps time when the page is busy.
- **the disc** — your image, checked (NTSC-U, raw sectors), streamed into the browser's
  private storage (**OPFS**) once ; saves in IndexedDB.
- **Netplay** — [OnlineCTR](https://github.com/CTR-tools/CTR-ModSDK)'s netcode, ported : the
  host's page runs the room's server inside its own game. players talk over **WebRTC**
  (direct, public STUN only), or through the relay when no direct path exists.
- **Couch** — the host's canvas and sound sent as a WebRTC video + audio stream ; the
  guests' pads sent back.
- **the relay** ([relay/](relay/)) — one small Node file, WebSocket. it introduces players
  and carries their messages when there's no direct path. **it sees** : connection IP
  addresses, a room id (random, or derived from the code), random peer ids, who hosts,
  message sizes and timing. **it does not see** : player names, the game's messages, the
  WebRTC offers — all sealed with the room's secret (AES-GCM) — nor the secret itself.
- **the page** — Svelte 5 + Vite, published on GitHub Pages by
  [a workflow](.github/workflows/pages.yml) that refuses to ship any game data
  ([web/pages/guard.sh](web/pages/guard.sh)).

## report a problem

[open an issue](https://github.com/meitogi/ctr-native-web/issues/new/choose) — a bug or an
idea, the form asks the right questions. faster : on the page, **Settings › System ›
Report a problem** opens it with the version, the browser and the mode already filled in.

**never attach the disc, or any piece of it** — not the `.bin`, not a `.zip`, not a file
from inside it. screenshots and short videos are great.

## run your own relay

our relay down or full, or you'd rather have one of your own ? one line on any box with
Docker (the key printed first, keep it) :

```
key=$(openssl rand -base64 24); echo "relay key : $key"
docker run -d -p 8787:8787 -e RELAY_KEY="$key" ghcr.io/meitogi/ctr-relay
```

then put it behind HTTPS — or skip the box : a hosted service in a few clicks, a
throwaway cloud VM with auto HTTPS, or behind your Traefik / HAProxy / Caddy.
everything's in [relay/README.md](relay/README.md). players type its `wss://` address and
key in Settings › Multiplayer › Netplay, or get them in your invite links.

**your fork, your page, your relay.** fork it, set the repository variable
`CTR_RELAY_URL` (Settings › Secrets and variables › Actions › Variables), turn on Pages,
push : your page points at your relay. [relay/README.md](relay/README.md#your-own-page-on-your-own-relay)
says what an optional built-in key protects, and what it doesn't.

## run it yourself (devs)

one game build, the page on one port. from the repo, with emsdk and cmake around :

```
web/dev.sh dev
```

opens the dev page on http://localhost:8090 — the page's sources with hot reload, the debug game
built the first time. rebuild the game with `web/dev.sh build`, then reload the page.
`web/dev.sh prod` serves the site exactly as GitHub Pages gets it (`web/dev.sh prod release`
checks it with the guard too). in the devcontainer : `wtf ctr dev`, `wtf ctr build`, `wtf ctr prod`.

testing alone ? on the debug page, from the main menu, Settings › Dev has a **second window** :
Netplay VS, Netplay Battle, Netplay Arcade or Couch. one click, a window opens beside the first, joins the room by
itself and plays as Bot ; the first window walks its menus to the race. Settings › Players has the
Bot switch, Settings › Dev the log and the game state too. none of it ships on the site.

the ports (one list : [web/dev-ports.tsv](web/dev-ports.tsv), checked by `web/dev.sh ports --check`) :

<!-- ports -->
| Port | Use | Forward in VS Code |
|---|---|---|
| 8090 | the dev page : wtf ctr dev (hot reload) or wtf ctr prod (the site as published) | yes |
| 8091 | player suites' page server (one per parallel session) | yes |
| 8092 | player suites' page server (one per parallel session) | yes |
| 8093 | player suites' page server (one per parallel session) | yes |
| 8787 | local relay, started by wtf ctr dev and prod | yes |
| 8788 | player suites' relay | yes |
| 8790 | the web/net and web/share demo pages | yes |
| 9001 | MQTT stand-in (signaling suite) | yes |
| 8099 | the LAN disc server (wtf disc), on the LAN host, not in the container | no |
<!-- /ports -->

## credits (the real MVPs)

- [CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) — decompiled the whole game.
  absolute legends
- [CTR Native](https://github.com/CTR-tools/ctr-native) — the native PC port this is a
  fork of
- [OnlineCTR](https://github.com/CTR-tools/CTR-ModSDK) (in CTR-ModSDK) — the netcode
  Netplay is ported from
- [PsyCross](https://github.com/OpenDriver2/PsyCross) — the original PS1 compatibility
  code that parts of CTR Native's platform layer and PsyQ facade headers come from
- [SDL3](https://github.com/libsdl-org/SDL) — audio, input, windows : the boring
  essentials nobody thanks
- the browser port — WebAssembly, Couch, LAN / Netplay, the whole web thing :
  [Meitogi](https://github.com/meitogi)
- Crash Team Racing is a trademark of Sony Computer Entertainment / Naughty Dog. we're
  just fans with a compiler.
