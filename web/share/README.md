# web/share — Share mode (« Couch »)

The player reads **Couch** ; the code keeps `share`. The host runs the game and streams it ; guests open a link, see and hear it in a `<video>`, and
play as P2–P4 with their gamepad or keyboard. Guests need no disc and load no game code. Plain ES
modules, no dependency, no bundler, like `web/net/`, whose rooms and links Share uses as they are.

**Peer to peer only.** The video goes over the room link's own WebRTC connection. A guest whose
link came through the relay's WebSocket path, or who has no link at all, is told to use Online
mode instead : the relay never carries video, and there is no TURN server (ROLLOUT, « Transport »).

## Use

**The Netplay build** : Couch is started and stopped in the game — Select on the character
select — on the relay and key of Settings › Netplay (one relay, one key, for Netplay and Couch).
Settings › Multiplayer › **Couch** (`share/panel.js`) then shows the room : its code, read only
(the characters' names, « — » when off), **Stop**, the relay and its key (the Netplay tab's own
values : typed in either tab, saved under `ctr-online.*`), the video bitrate per guest
(0.5–6 Mbit/s, default 2.5) and who is in. No start button there.

**A build without Netplay** : the panel starts it. Relay URL and key (remembered under
`ctr-share.*` ; `?relay=&rk=` in the page URL prefill them), **Couch**, **Stop**, **Copy guest
link**, the bitrate.

The guest link is `…/share/guest.html#room=…&key=…&relay=…&rk=…` : everything after `#`, never
sent to a server.

**Players of the host's own machine** hold seats too : an extra gamepad that presses Start on the
character select takes the next free one of P2–P4, Couch on or not, and holds Select to leave. A
seat left free on the menus is closed : the players above it move down, guests told so.

**The room has a code** (the Netplay build) : a few of the game's characters, as a Netplay room's.
The page says it once, in the toast of Couch starting ; in the game the menus show it top right and
the pad's Select (the Space key) opens INVITE. A guest types it on the home page — « or join a
room », before any disc — and knocks : the host's game asks « … WANTS IN », ACCEPT / REFUSE, on its
menus (one line in a race, the box with the next menu). The link carries a pass and goes straight
in. In a build without Netplay the room has no code : the link alone joins.

On the guest page — the site's interface (`web/ui`, `src/guest.js`, built into `ui/` beside
`share/`) : click once for sound, then the speaker (mute, volume) and the gear. Settings ›
**Players** : the player name (sent to the host, shown to everyone), **Who plays** on this page
(Auto : keyboard and gamepad · Keyboard · Gamepad, and which one) and who is in the game ;
**Controls** : the keyboard and gamepad mapping, the native defaults (arrows, C Cross, V Circle,
X Square, Z Triangle, Enter Start, Space Select, shifts L1 / R1, ctrls L2 / R2) until changed ;
**System** : volume, about. **F** or « My view » shows only our part of the split screen
(2 players : top / bottom halves, 3–4 : quadrants). `?mode=ws` forces the relay path : a test
knob, to see the refusal.

**One machine, two windows** (the game and a guest, e.g. to try Share alone) : a controller is
seen by both windows and would drive two players. Set Who plays to Keyboard on one page and to
Gamepad on the other — each page keeps its own choice (`ctr-ui.device`, `ctr-share.guest-device`).

The host sees who joins and leaves (a toast, names in Settings › Multiplayer › Couch). A guest
refused for want of a direct connection is said in the host's game for 6 seconds
(« GUEST - NO DIRECT CONNECTION »).

## How it works

| File | Role |
|---|---|
| `protocol.js` | the messages (tag byte first), the PSX pad from the Gamepad API / keyboard, `viewOf` |
| `slots.js` | the host's slots 1–3 : guests and local players (`local:<id>`) in order of arrival, latest pad of each, the bytes the game reads |
| `media.js` | the renegotiation of the link's `RTCPeerConnection`, encoder settings, playout delay, stereo Opus |
| `host.js` | `createShareHost({room, stream})` : refuses relay links, gives slots, streams to each guest |
| `guest.js` | `createShareGuest(room)` : connects, refuses itself without a direct path, answers the media offer, sends the pad |
| `capture.js` | the canvas at one frame per present, the game's audio output (`ctrAudio.output`) |
| `panel.js` | the game page's Couch panel ; `Module.ctrShare` (the game's hooks), `ctrShareApi` (the page's), `window.__ctrShare` |
| `guest.html`, `guest-page.js` | the guest page ; `window.__ctrShareGuest` |
| `share.cmake` | copies `share/*` (and `net/*` unless the CTR_ONLINE build already does) next to `index.html` |
| `demo/` | the same host on a canvas the page draws, a tone for the game's audio : Share without the game |

- **Media** : the host adds its video and audio tracks to the link's own `RTCPeerConnection`
  (`link.pc`) and renegotiates. The offer and the answer travel as Share messages on the link's
  reliable `ctl` channel, never through signaling. Same ICE and DTLS transport as the channels,
  so nothing is gathered again and the identity proof `web/net/` checked over both DTLS
  fingerprints covers the media : SRTP keys come from that DTLS session.
- **Messages** (`protocol.js` header) : `PAD` on the unreliable `game` channel, ~60 a second,
  latest wins by a u16 sequence number ; `OFFER` / `ANSWER` / `WELCOME {slot, host}` / `REFUSE
  {code, message}` / `PLAYERS {players, list}` / `HELLO {name}` (guest → host) on `ctl`. Player
  names travel only there, end to end ; the relay's `hello` keeps the fixed signaling names
  `host` / `guest`. A guest page without names still plays and shows as `P<n>`. The host sends nothing before the guest's first pad :
  a link's handlers exist only once `connect()` resolved. For the bot only (below) : `BOT {}`
  (guest → host, ctl), then `TRACK {levelID, path}` (ctl, once per level) and `KART {screen,
  levelID, players, charSelect, kart}` (the `game` channel, once per present) back — sent by a
  debug host only, to a guest that asked only.
- **Pads into the game** : `platform/native_input.c` pulls the guests' pads once per input
  update (`Module.ctrShare.readPads`, an `EM_JS`), after the SDL / keyboard pass, into slots 1–3
  only ; slot 0 stays the host's. A held slot reads as plugged in : the game's player count
  follows (`MainFrame_HaveAllPads`), slots 2–3 switch the bus to the multitap. A guest silent for
  500 ms reads as nothing held ; a guest leaving unplugs its slot.
- **Local seats** : `Module.ctrShare.localJoin(id)` gives owner `local:<id>` a slot (1–3, its own
  if it has one, 0 when all are taken), `localLeave(id)` frees it. `readPads` writes such a slot
  as the marker `FF 00 FF FF` + the id (u32, little endian) with its mask bit set : the game puts
  that gamepad there itself. Guests' packets start with 0.
- **Gaps** : `readPads(heap, dst, menus)` with `menus` set closes the holes in slots 1–3 first
  (not in an Online room's lobby, which closes its own) and returns `mask | (gone << 8)` : `gone`
  is one slot a closed gap freed, one per call, 0 for none. Without `menus`, the mask alone.
- **Started by the game** (`web/online/page.js`) : `Module.ctrInput.couchStart()` (1 = on its way
  or on, 0 = no : a Netplay room, no key), `couchStatus()` (the `NP` values of the Netplay
  screens), `couchStop()`, `couchSaid()`. They go through `ctrShareApi.start({relay, rk})`, which
  resolves `{ok: true}` or `{ok: false, code, message}`, `stopOn()` and `said()`.
- **Video** : `canvas.captureStream(0)` and `requestFrame()` after each present
  (`platform/native_renderer.c`, an `EM_JS`) : ~30 frames a second, the game's own. The encoder
  scales the 800 × 600 canvas down to the PS1 display width (512 → 512 × 384), caps the bitrate,
  keeps 30 fps (`degradationPreference: 'maintain-framerate'`, `contentHint: 'motion'`). The guest
  asks for the lowest playout delay (`jitterBufferTarget = 0`, else Chrome's `playoutDelayHint`).
- **Audio** : the page's output node (`ctrAudio.output`, the SPU worklet's sound, `web/audio/`) also
  feeds a `MediaStreamAudioDestinationNode`, before the page's mute (`index.html` without `?sound`) : guests hear the game, the host tab stays
  muted. Stereo Opus.

## By hand

`web/dev.sh dev` (or `wtf ctr dev` in the workspace) : the page on 8090,
a local relay with a fresh key on 8787, the host address printed ; Select on the character
select starts it. Alone : Settings › Dev › « Second window » → Share opens the guest beside it, as Bot.

## Bot : a second player to test with alone

`web/share/bot.sh '<guest link>'` (or `wtf ctr share-bot '<guest link>'` in the workspace) opens
the guest link in the agent browser in bot mode (`guest.html?bot`) : it joins as « Bot » in the
next free slot (P2), browses the characters at each character select and locks one at random,
drives each race along the racing line and fires its item every 1.5 s, until the host stops
sharing (or Ctrl-C). Its keys go to the host as the guest's pad over the Share link, like a
player's ; nothing reaches the game any other way.

It steers by its own kart as the host's game sees it : on `BOT`, a **debug** host (it has
`window.__ctr`, `platform/web_debug_bridge.c`, where `karts[i]` carries `drivers[i]` in full)
sends that guest its `karts[slot]` with every present, and the level's racing line once. A release
host has no `__ctr` and sends nothing : the bot then holds Cross (accelerates, locks its
character) and does not steer. Host on two ports the agent browser opens
(`AGENT_BROWSER_ORIGINS`) : `web/dev.sh dev`. `BOT_INSTANCE=b` runs it on agent
browser b. The steering and the character pick are `web/ui/src/lib/autopilot.js`'s — the ones Online's bot
and the page's « Bot » switch use —, reading `window.__ctrShareGuest.bot()` instead of `window.__ctr`.

## Tests and demo

```
node --test web/share/test/*.test.js
```

Pad bytes, slot assignment and release, the stale pad, the media offer / answer round trip
over in-memory links (`test/fake.mjs`), the relay-path refusal on both sides, the bitrate cap.

`demo/index.html` : serve the repository root (`python3 web/test/player/serve.py . 8790`), run a
relay (`RELAY_KEY=… PORT=8788 node relay/relay.js`), open
`http://localhost:8790/web/share/demo/index.html#relay=ws://localhost:8788&rk=…`, press Share and
open the guest link in another window.

The game in two windows : `web/test/player/share.suite.mjs` (its header has the run). A whole
race with the bot as P2, the host on agent browser a, the bot on b :
`web/test/player/share-bot.suite.mjs`.
