# CTR Native Web

**Crash Team Racing, in your browser.** Bring your own disc, grab a pad, and race —
alone, on the sofa with friends, or online with someone across town.

> **[Play at ctr.suuuper.app](https://ctr.suuuper.app/)**

No install, no emulator, no plugin : the decompiled PS1 game, rebuilt for the web
(WebAssembly, WebGL2, Web Audio). This is a fork of
[CTR Native](https://github.com/CTR-tools/ctr-native), the native PC port.

## Bring your own disc

You need your own **NTSC-U** copy of the game as a raw disc image (`ctr-u.bin`,
`MODE2/2352` — what a CD ripper gives you, not a cooked 2048-byte `.iso`), loose or
inside a `.zip`. Drop it anywhere on the page **once** : it is copied into your
browser's own storage and stays there. Nothing is uploaded, and no game data is ever
hosted here. Next time, the game is ready — press the button on screen and go.

## What's already on the track

- **The whole game, in a tab** — menus, races, the music and the voices, your saves
  kept in the browser.
- **Your controls, your way** — keyboard or any gamepad, every button remappable in
  Settings, the right button icons for your pad, « Skip intro » to get straight to the
  menu. English or French, following your browser.
- **Couch party** — 2 to 4 players on one machine in the original split screen, one
  pad each, or two players on one keyboard (left half : WASD ; right half : the
  arrows). Settings › Players shows who is P1–P4 and swaps them. Pads start in analog
  mode (ANA) ; Select + Start toggles digital (DIG), like the PlayStation's Analog button.
- **Share** — send a link, and your friends play as P2–P4 **without a disc** : they
  get your game as live video and sound, you get their pads, peer to peer.
- **[Online](https://ctr.suuuper.app/online/)** — Mario Kart–style netplay ported from
  OnlineCTR : everyone races on their own screen with their own disc, in a private room
  you share by link. Direct connections first, a relay when there is no other way,
  and everything end-to-end encrypted.
- **Your own relay, if you like** — hosting a Share or Online room goes through a
  small relay ; the default one needs a key, or run yours in minutes : a Docker image,
  a one-file setup for a throwaway cloud VM with automatic HTTPS, or a drop-in behind
  Traefik, HAProxy or Caddy ([relay/README.md](relay/README.md)). Online can also meet
  through a public MQTT broker, or by copy-pasting a code.
- **The game on a TV (Mac)** — Safari won't AirPlay the game alone ; use Control
  Center › Screen Mirroring › your Apple TV › **Use As Separate Display**, move the
  window there in full screen, and pick the Apple TV as the sound output.

## Next laps

What's coming, with no promised date :

| | Feature | What you get |
|---|---|---|
| In the pit lane | **Smoother racing** | No hiccup when a level loads, a steady pace even when the tab is in the background |
| Next up | **Share, upgraded** | Guests get the full menu too (volume, settings, their own controls) ; every player gets a name — a silly CTR one to start with — and the host sees who just joined ; pick keyboard *or* gamepad, so a lazy stick stops wandering through the menus |
| Planned | **One game, one link** | Online straight from the game's own multiplayer menus, no separate page ; one link whatever the mode, and a friend without a disc lands in Share on their own |
| Planned | **Sturdier online** | Drop out and rejoin a room, smoother remote karts |
| Planned | **Couch + online together** | Two on the sofa against two somewhere else |
| Planned | **Your screen, your shape** | The game drawn at your window's own resolution, and widescreen |
| Planned | **A proper home page** | Pick Solo, Share or Online from one place |
| Planned | **Race the DuckStation crowd** | Join the public OnlineCTR servers and race players on the original game |
| Planned | **Your disc from your own server** | Load it from a machine on your home network instead of dropping it again on every device |
| Maybe, one day | **PAL discs** | The French version first |

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
