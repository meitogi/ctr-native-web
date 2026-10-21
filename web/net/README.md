# web/net — rooms, signaling, transport

The network layer of CTR Native Web, as plain ES modules with no dependency
(browser, and Node ≥ 24 for the tests). It knows nothing of the game : it moves
bytes between a host and its guests.

## Room link

```
https://<page>#room=<id>&key=<secret>&relay=wss://<relay>&rk=<relay key>
```

Everything after `#`, so no web server receives it. `room` is the name peers
meet under on the relay ; `key` (32 bytes, base64url) is the room secret, which
no server ever sees ; `relay` picks the relay ; `rk` is its access key when it is
private. `link.js` : `newRoom()`, `formatRoomLink()`, `parseRoomLink()`.

## Pieces

| File | Role |
|---|---|
| `link.js` | room link format |
| `crypto.js` | HKDF from the secret → AES-GCM key (sealing) + HMAC key (identity proof) ; the sealed envelope (sender, recipient and a counter bound in : no forgery, redirection or replay) |
| `signaling.js` | the signaling backend contract (header comment) and backend 1, `ctr-relay` ; offer, answer and game data through it are sealed |
| `webrtc.js` | non-trickle offer and answer, channels `ctl` (reliable) and `game` (unordered, `maxRetransmits: 0`), public STUN only, DTLS fingerprints, path labels |
| `transport.js` | the link contract (header comment) over WebRTC and over the relay ; the identity proof |
| `room.js` | `openRoom({link, role, mode})` : star around the host, WebRTC first with automatic fallback to the relay, or forced relay (`mode: 'ws'`) |

Path labels a link reports : `direct-ipv6`, `direct-lan`, `direct-nat` (WebRTC),
`relay` (WebSocket through `ctr-relay`).

## Use

```js
import { newRoom, formatRoomLink } from './net/link.js';
import { openRoom } from './net/room.js';

const link = formatRoomLink(location.href, newRoom({ relay: 'wss://relay.example', rk }));
const host = await openRoom({ link, role: 'host' });
host.on('link', (l) => l.on('message', (bytes) => { /* from guest l.peerId */ }));

const guest = await openRoom({ link, role: 'guest' });   // mode: 'ws' forces the relay
const toHost = await guest.connect();                   // toHost.path : 'direct-nat', 'relay'…
toHost.send(new Uint8Array([1, 2, 3]));
```

## Tests and demo

```
(cd relay && npm ci)                       # the tests start a real relay
node --test web/net/test/*.test.js
```

`demo/index.html` runs a host and a guest in one page through both transports.
Serve the repository root (`python3 -m http.server 8790`), run a relay
(`RELAY_KEY=… node relay/relay.js`), open
`http://localhost:8790/web/net/demo/index.html#relay=ws://localhost:8787&rk=…`.
