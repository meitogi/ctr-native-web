# CTR Native Web

**ctr. in your browser. no cap.** bring your own disc, grab a pad, ruin a few
friendships. gg.

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
| in the oven | **Online** | Mario Kart–style netplay ported from OnlineCTR, right from the game's own multiplayer menus : everyone races on their own screen with their own disc, private room, invite by link. end-to-end encrypted, so nobody sees your skill issue. except the other racers. wifi dies, you come back, the race remembers you |
| in the oven | **one game, one link** | one link for everything ; no disc = you land in Share automatically |
| in the oven | **couch + online** | sofa vs. sofa. 2v2. bring snacks |
| in the oven | **your screen, your shape** | full window resolution + widescreen. 240p was a vibe in 1999, it's 2026 |
| in the oven | **race the DuckStation crowd** | public OnlineCTR servers, players on the original game. they've been grinding since 1999. gl hf |
| in the oven | **disc from your own server** | load it from a box on your home network. drop it once per house, not once per device |
| trust me bro | **PAL discs** | French version first. 50 Hz and all |

## Under the hood : CTR Native

This fork is built on [CTR Native](https://github.com/CTR-tools/ctr-native), a native PC
port of Crash Team Racing (PS1, 1999) based on the
[CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) decompilation. To build and run the
native Windows / Linux version, follow
[its README](https://github.com/CTR-tools/ctr-native#readme).

## Credits

- [CTR-ModSDK](https://github.com/CTR-tools/CTR-ModSDK) — the decompilation project this is built on
- [PsyCross](https://github.com/OpenDriver2/PsyCross) — original PS1 compatibility code from which parts of CTR Native's owned platform layer and PsyQ facade headers are derived
- [SDL3](https://github.com/libsdl-org/SDL) — cross-platform multimedia
- Crash Team Racing is a trademark of Sony Computer Entertainment / Naughty Dog
