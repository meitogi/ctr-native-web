# CTR Native Web

**ctr. in your browser. no cap.** bring your own disc, grab a pad, ruin a few
friendships. gg.

a [Meitogi](https://github.com/meitogi) thing.

> **[Play at ctr.suuuper.app](https://ctr.suuuper.app/)**

no install. no emulator. no plugin. no sketchy .exe from a forum post in 2009. it's the
decompiled PS1 game rebuilt for the web (WebAssembly, WebGL2, Web Audio), forked from
[CTR Native](https://github.com/CTR-tools/ctr-native), the native PC port.

## bring your own disc

we don't host the game. don't ask. you know why (lawyers).

you need your own **NTSC-U** copy as a raw disc image : `ctr-u.bin`, `MODE2/2352`, what a
CD ripper spits out. a cooked 2048-byte `.iso` won't do — no voices, no videos, sad Aku
Aku. loose or in a `.zip`, drop it anywhere on the page **once**. it lives in your
browser now. nothing gets uploaded. next time you just press the button and send it.

## what already works (fr)

- **the whole game, in a tab** — menus, races, music, voices, saves kept in your
  browser. clear your site data and that's on you.
- **controls** — keyboard or any gamepad, remap every button in Settings (Triangle to
  accelerate ? bold. respect.), the right button icons for your pad, « Skip intro »
  because we've all seen it. English or French, whatever your browser speaks.
- **couch party** — 2 to 4 players, 1 screen, 0 friendships left. one pad each, or two
  on one keyboard (left half WASD, right half arrows, elbows included). Settings ›
  Players shows who's P1–P4 and swaps them. pads start in analog (ANA), Select + Start
  flips to digital (DIG), just like the PlayStation's Analog button.
- **Share** — send a link, your friends play as P2–P4 **with no disc**. they get your
  game as live video + sound, you get their pads, peer to peer. they lose, it's lag.
  they win, it's skill. classic.
- **host your own relay** — Share rooms go through a tiny relay. the default one needs
  a key (slide into the DMs), or spin up yours : Docker image, a one-file setup for a
  throwaway cloud VM with auto HTTPS, or drop it behind Traefik, HAProxy or Caddy
  ([relay/README.md](relay/README.md)).

## soon™

no dates. no versions. trust the process.

| | what | why you care |
|---|---|---|
| cooking | **smoother racing** | keeps its pace while you alt-tab to Discord, no more stutter when the first track loads |
| next | **Share, upgraded** | guests get the full menu (volume, settings, their own controls) ; everyone gets a name — think `Mad Roo` — so the host knows who joined (and who rammed who) ; pick keyboard *or* gamepad so a drifting stick stops speedrunning the menus |
| in the oven | **LAN / Netplay** | netplay like Mario Kart, ported from OnlineCTR, right from the game's own multiplayer menus. everyone on their own screen, full screen, with their own disc — same house or across the internet. private room, invite by link or by a code you say out loud — three characters, « Crash, Coco, Tiny » — and the host lets you in. end-to-end encrypted, so nobody sees your skill issue. except the other racers. wifi dies, you come back, the race remembers you |
| in the oven | **one game, one link** | one link for everything ; no disc = you land in Share automatically. no link ? « or join a room » on the home page takes the code before any disc : a Share room opens right there, a Netplay one asks for your disc first |
| in the oven | **couch + netplay** | sofa vs. sofa. 2v2. bring snacks |
| in the oven | **your screen, your shape** | full window resolution + widescreen. 240p was a vibe in 1999, it's 2026 |
| in the oven | **race the DuckStation crowd** | public OnlineCTR servers, players on the original game. they've been grinding since 1999. gl hf |
| in the oven | **disc from your own server** | load it from a box on your home network. drop it once per house, not once per device |
| trust me bro | **PAL discs** | French version first. 50 Hz and all |

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
Netplay VS, Netplay Battle, Netplay Arcade or Share. one click, a window opens beside the first, joins the room by
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

## under the hood

this whole thing stands on [CTR Native](https://github.com/CTR-tools/ctr-native), the
native PC port of Crash Team Racing (PS1, 1999), itself built on the
[CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) decompilation. want the native
Windows / Linux build instead ? [their README](https://github.com/CTR-tools/ctr-native#readme)
has you covered.

## credits (the real MVPs)

- [CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) — decompiled the whole game.
  absolute legends
- [CTR Native](https://github.com/CTR-tools/ctr-native) — the native PC port this is a
  fork of
- [PsyCross](https://github.com/OpenDriver2/PsyCross) — the original PS1 compatibility
  code that parts of CTR Native's platform layer and PsyQ facade headers come from
- [SDL3](https://github.com/libsdl-org/SDL) — audio, input, windows : the boring
  essentials nobody thanks
- the browser port — WebAssembly, Share, LAN / Netplay, the whole web thing :
  [Meitogi](https://github.com/meitogi)
- Crash Team Racing is a trademark of Sony Computer Entertainment / Naughty Dog. we're
  just fans with a compiler.
