# web/share — Share mode

The host runs the game and streams it ; guests open a link, see and hear it in a `<video>`, and
play as P2–P4 with their gamepad or keyboard. Guests need no disc and load no game code. Plain ES
modules, no dependency, no bundler, like `web/net/`, whose rooms and links Share uses as they are.

**Peer to peer only.** The video goes over the room link's own WebRTC connection. A guest whose
link came through the relay's WebSocket path, or who has no link at all, is told to use Online
mode instead : the relay never carries video, and there is no TURN server (ROLLOUT, « Transport »).

## Use

On the game page (`index.html` loads `share/panel.js`), the **Share** panel on the right (beside
the Online sidebar in the CTR_ONLINE build) :
relay URL and key (remembered ; `?relay=&rk=` in the page URL prefill them), **Share**, **Copy
guest link**, the video bitrate per guest (0.5–6 Mbit/s, default 2.5). The guest link is
`…/share/guest.html#room=…&key=…&relay=…&rk=…` : everything after `#`, never sent to a server.

On the guest page : click once for sound. Keys as on the host — arrows, C Cross, V Circle, X
Square, Z Triangle, Enter Start, Space Select, shifts L1 / R1, ctrls L2 / R2 — or the first
gamepad (standard mapping). **F** shows only our part of the split screen (2 players : top /
bottom halves, 3–4 : quadrants). `?mode=ws` forces the relay path : a test knob, to see the
refusal.

## How it works

| File | Role |
|---|---|
| `protocol.js` | the messages (tag byte first), the PSX pad from the Gamepad API / keyboard, `viewOf` |
| `slots.js` | the host's slots 1–3 : guests in order of arrival, latest pad of each, the bytes the game reads |
| `media.js` | the renegotiation of the link's `RTCPeerConnection`, encoder settings, playout delay, stereo Opus |
| `host.js` | `createShareHost({room, stream})` : refuses relay links, gives slots, streams to each guest |
| `guest.js` | `createShareGuest(room)` : connects, refuses itself without a direct path, answers the media offer, sends the pad |
| `capture.js` | the canvas at one frame per present, SDL's audio output |
| `panel.js` | the game page's Share panel ; `Module.ctrShare` (the game's two hooks), `window.__ctrShare` |
| `guest.html`, `guest-page.js` | the guest page ; `window.__ctrShareGuest` |
| `share.cmake` | copies `share/*` (and `net/*` unless the CTR_ONLINE build already does) next to `index.html` |
| `demo/` | the same host on a canvas the page draws, a tone for SDL's audio : Share without the game |

- **Media** : the host adds its video and audio tracks to the link's own `RTCPeerConnection`
  (`link.pc`) and renegotiates. The offer and the answer travel as Share messages on the link's
  reliable `ctl` channel, never through signaling. Same ICE and DTLS transport as the channels,
  so nothing is gathered again and the identity proof `web/net/` checked over both DTLS
  fingerprints covers the media : SRTP keys come from that DTLS session.
- **Messages** (`protocol.js` header) : `PAD` on the unreliable `game` channel, ~60 a second,
  latest wins by a u16 sequence number ; `OFFER` / `ANSWER` / `WELCOME {slot}` / `REFUSE {code,
  message}` / `PLAYERS {players}` on `ctl`. The host sends nothing before the guest's first pad :
  a link's handlers exist only once `connect()` resolved.
- **Pads into the game** : `platform/native_input.c` pulls the guests' pads once per input
  update (`Module.ctrShare.readPads`, an `EM_JS`), after the SDL / keyboard pass, into slots 1–3
  only ; slot 0 stays the host's. A held slot reads as plugged in : the game's player count
  follows (`MainFrame_HaveAllPads`), slots 2–3 switch the bus to the multitap. A guest silent for
  500 ms reads as nothing held ; a guest leaving unplugs its slot.
- **Video** : `canvas.captureStream(0)` and `requestFrame()` after each present
  (`platform/native_renderer.c`, an `EM_JS`) : ~30 frames a second, the game's own. The encoder
  scales the 800 × 600 canvas down to the PS1 display width (512 → 512 × 384), caps the bitrate,
  keeps 30 fps (`degradationPreference: 'maintain-framerate'`, `contentHint: 'motion'`). The guest
  asks for the lowest playout delay (`jitterBufferTarget = 0`, else Chrome's `playoutDelayHint`).
- **Audio** : SDL's ScriptProcessorNode also feeds a `MediaStreamAudioDestinationNode`, before the
  dev page's mute (`index.html` without `?sound`) : guests hear the game, the host tab stays
  muted. Stereo Opus.

## By hand

`web/share/dev.sh [debug|release] [page-port] [relay-port]` (or `wtf ctr shared` in the
workspace) : builds, serves, starts a local relay with a fresh key, prints the host address.

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

The game in two windows : `web/test/player/share.suite.mjs` (its header has the run).
