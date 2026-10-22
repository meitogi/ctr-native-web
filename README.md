# CTR Native Web

**Crash Team Racing, in your browser.** Yes, the real one. Bring your own disc, grab a
pad, and race — alone, on the sofa, or online against that friend who swears they
"weren't even trying".

> **[Play at ctr.suuuper.app](https://ctr.suuuper.app/)**

No install, no emulator, no plugin, no "download this totally legit .exe" : the
decompiled PS1 game, rebuilt for the web (WebAssembly, WebGL2, Web Audio). This is a
fork of [CTR Native](https://github.com/CTR-tools/ctr-native), the native PC port.

## Bring your own disc

We don't host the game. Not on the site, not in this repo, not in a zip called
`ctr_full_free_NO_VIRUS.rar`. You need your own **NTSC-U** copy as a raw disc image
(`ctr-u.bin`, `MODE2/2352` — what a CD ripper gives you ; a cooked 2048-byte `.iso`
loses the voices and the videos, and Aku Aku deserves better). Loose or inside a
`.zip`, drop it anywhere on the page **once** : it is copied into your browser's own
storage and stays there. Nothing is uploaded. Next time, the game is waiting — press
the button on screen and go.

## What's already on the track

- **The whole game, in a tab** — menus, races, the music, the voices, and your saves,
  kept in the browser (clear your site data and Uka Uka wins).
- **Your controls, your way** — keyboard or any gamepad, every button remappable in
  Settings (yes, even Triangle to accelerate, we won't judge — out loud), the right
  button icons for your pad, and « Skip intro » for the impatient. English or French,
  following your browser.
- **Couch party** — 2 to 4 players on one machine in the original split screen, one
  pad each, or two players on one keyboard (left half : WASD ; right half : the arrows ;
  elbows : included). Settings › Players shows who is P1–P4 and swaps them. Pads start
  in analog mode (ANA) ; Select + Start toggles digital (DIG), like the PlayStation's
  Analog button.
- **Share** — send a link, and your friends play as P2–P4 **without a disc** : they get
  your game as live video and sound, you get their pads, peer to peer. Like screen
  sharing, except they can actually blame you for the Warp Orb.
- **[Online](https://ctr.suuuper.app/online/)** — Mario Kart–style netplay ported from
  OnlineCTR : everyone races on their own screen with their own disc, in a private room
  you share by link. Direct connections first, a relay when there is no other way, and
  everything end-to-end encrypted — even the relay can't watch you miss every turbo.
- **Your own relay, if you like** — hosting a Share or Online room goes through a small
  relay ; the default one needs a key (ask nicely), or run yours in minutes : a Docker
  image, a one-file setup for a throwaway cloud VM with automatic HTTPS, or a drop-in
  behind Traefik, HAProxy or Caddy ([relay/README.md](relay/README.md)). Online can
  also meet through a public MQTT broker, or by copy-pasting a code like it's 2003.
- **The game on a TV (Mac)** — Safari refuses to AirPlay the game alone (« This engine
  does not support wireless playback », thanks WebKit). Workaround : Control Center ›
  Screen Mirroring › your Apple TV › **Use As Separate Display**, move the window there
  in full screen, and pick the Apple TV as the sound output.

## Next laps

What's coming. Dates ? Ask N. Tropy, he's the one with the time machine.

| | Feature | What you get |
|---|---|---|
| In the pit lane | **Smoother racing** | No more freeze-frame at the finish line, and the game keeps its pace while you alt-tab to check Discord |
| On the starting grid | **Share, upgraded** | Guests get the full menu too (volume, settings, their own controls) ; every player gets a name — something like `Mad Roo` to start with — so the host finally knows who just joined (and who rammed whom) ; pick keyboard *or* gamepad, so a lazy stick stops wandering through the menus on its own |
| In the garage | **One game, one link** | Online straight from the game's own multiplayer menus, no separate page ; one link whatever the mode, and a friend without a disc lands in Share on their own |
| In the garage | **Sturdier online** | Your Wi-Fi drops, you come back, the race didn't forget you ; smoother remote karts |
| In the garage | **Couch + online together** | Sofa vs. sofa : two here against two over there |
| In the garage | **Your screen, your shape** | The game drawn at your window's own resolution, and widescreen. 240p was fine in 1999 |
| In the garage | **A proper home page** | Pick Solo, Share or Online from one place |
| In the garage | **Race the DuckStation crowd** | Join the public OnlineCTR servers and race players on the original game. They've been practising since 1999. Good luck |
| In the garage | **Your disc from your own server** | Load it from a machine on your home network : drop the disc once per house, not once per device |
| Pure Wumpa dream | **PAL discs** | The French version first. 50 Hz and all |

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
