# web/net — rooms, signaling, transport

The network layer of CTR Native Web, as plain ES modules with no dependency
(browser, and Node ≥ 24 for the tests). It knows nothing of the game : it moves
bytes between a host and its guests.

## Room link

```
https://<page>#room=<id>&key=<secret>&sig=relay,mqtt,paste&relay=wss://<relay>&rk=<relay key>&mqtt=wss://<broker>,…
```

Everything after `#`, so no web server receives it. `link.js` : `newRoom()`,
`formatRoomLink()`, `parseRoomLink()`.

| Parameter | |
|---|---|
| `room` | the room id ; the relay sees it |
| `key` | the room secret, 32 bytes base64url ; no server ever sees it |
| `sig` | the signaling backends, comma-separated, **in the order a guest tries them** : `relay`, `mqtt`, `paste`. Absent : `relay` when `relay` is set, else `paste` |
| `relay` | the `ctr-relay` URL (`ws://` / `wss://`) ; required when `sig` lists `relay` |
| `rk` | the relay's access key, when it is private |
| `mqtt` | MQTT-over-WebSocket broker URLs, comma-separated ; absent = the public defaults (`MQTT_BROKERS`) |

A link made before `sig` existed (`room`, `key`, `relay`, `rk`) means `sig=relay` and
works as it did ; `formatRoomLink()` leaves `sig` out whenever it is that default, so such a
link formats back byte for byte. A list that cannot work (unknown or repeated backend,
`relay` without a relay URL) is refused with code `link`.

## Signaling backends

Every backend implements the contract in `signaling.js`'s header ; `webrtc.js` and the
identity proof (both DTLS fingerprints, `transport.js`) are the WebRTC path whatever the
backend, and everything a backend carries is sealed with the room key (`crypto.js`).

| `sig` | File | Needs | Game data path |
|---|---|---|---|
| `relay` | `signaling.js` | a `ctr-relay` (the VPS, any `docker run`, or `relay/deploy/cloud-init.yaml` on a VM) | yes : a guest without a direct path plays through the relay |
| `mqtt` | `signaling-mqtt.js` | a public MQTT broker over WebSocket (no server of ours) | no |
| `paste` | `signaling-paste.js` | nothing : the players carry two blobs | no |

- **`mqtt`** — every peer of the room subscribes to one topic derived from the secret
  (`ctr-net/v1/<22 chars>` : neither the room id nor the secret), publishes sealed
  hellos, offers and answers there, through every broker that answered within 2 s of the
  first ; copies from several brokers are dropped as replays. Its own MQTT 3.1.1 client
  (QoS 0, ~100 lines). Default brokers : EMQX, HiveMQ and Mosquitto's public test brokers ;
  they are third-party services, which is why the relay comes first in the list.
- **`paste`** — the guest's offer and the host's answer, each one sealed, compressed
  (`CompressionStream('deflate-raw')`) and base64url : ~700–900 characters for a non-trickle
  SDP. The room emits `blob` ({to, blob}) for the page to show, and `room.paste(text)` takes
  the other side's blob. A guest sees one peer, `host`. No QR code : the copy-paste needs no
  dependency, a QR encoder would (and scanning one, a decoder and a camera). Paste within a
  minute or so : a NAT forgets the port it opened for the offer's candidates.

How a room uses the list :

- **The host opens every backend at once** (`room.backends` : `[{name, state, error?}]`,
  a failed one is a `warning`, not an error) : a guest reaches it through whichever backend
  works for that guest.
- **A guest tries them in order** : the first it can join ; when the host is not there
  (`absent`), the next. `room.backend` names the one in use, `link.signaling` the one a link
  came through, the `backend` event fires on each move.
- **No direct path** : over `relay`, the guest falls back to the relay's WebSocket path as
  before. Over `mqtt` or `paste` there is none : the guest moves on to a `relay` later in the
  list if there is one, else `connect()` rejects with code **`no-direct-path`**. Forced
  WebSocket (`mode: 'ws'`) without `relay` in the list rejects with **`no-relay`**.

## Pieces

| File | Role |
|---|---|
| `link.js` | room link format, the backend list |
| `crypto.js` | HKDF from the secret → AES-GCM key (sealing) + HMAC key (identity proof, MQTT topic) ; the sealed envelope (sender, recipient and a counter bound in : no forgery, redirection or replay) |
| `signaling.js` | the signaling backend contract (header comment) and backend `relay`, `ctr-relay` ; offer, answer and game data through it are sealed |
| `signaling-mqtt.js` | backend `mqtt` : public MQTT brokers, a minimal MQTT-over-WebSocket client |
| `signaling-paste.js` | backend `paste` : the two blobs |
| `webrtc.js` | non-trickle offer and answer, channels `ctl` (reliable) and `game` (unordered, `maxRetransmits: 0`), public STUN only, DTLS fingerprints, path labels |
| `transport.js` | the link contract (header comment) over WebRTC and over the relay ; the identity proof |
| `room.js` | `openRoom({link, role, mode})` : star around the host, signaling backends in the link's order, WebRTC first with automatic fallback to the relay, or forced relay (`mode: 'ws'`) |

Path labels a link reports : `direct-ipv6`, `direct-lan`, `direct-nat` (WebRTC),
`relay` (WebSocket through `ctr-relay`).

## Use

```js
import { newRoom, formatRoomLink } from './net/link.js';
import { openRoom } from './net/room.js';

const link = formatRoomLink(location.href, newRoom({ relay: 'wss://relay.example', rk, signaling: ['relay', 'mqtt', 'paste'] }));
const host = await openRoom({ link, role: 'host' });
host.on('link', (l) => l.on('message', (bytes) => { /* from guest l.peerId */ }));

const guest = await openRoom({ link, role: 'guest' });   // mode: 'ws' forces the relay
const toHost = await guest.connect();                   // toHost.path : 'direct-nat', 'relay'… ; toHost.signaling : 'relay'…
toHost.send(new Uint8Array([1, 2, 3]));                 // unreliable, unordered over WebRTC
toHost.send(new Uint8Array([9]), { reliable: true });   // ordered, reliable
```

## Tests and demo

```
(cd relay && npm ci)                       # the tests start a real relay
node --test web/net/test/*.test.js         # links, crypto, copy-paste, backend order and fallback, the relay path
web/net/test/mqtt/run.sh                   # the mqtt backend against Mosquitto in Docker
```

`mqtt.test.js` is skipped without `MQTT_URL` ; `run.sh` sets it. Pointing `MQTT_URL` at a
public broker runs the same tests on the real thing.

`demo/index.html` runs a host and a guest in one page, once per backend (relay with
WebRTC, relay forced to WebSocket, MQTT, copy-paste with both blobs shown), and a
two-device mode with a backend list. Serve the repository root
(`python3 -m http.server 8790`), run a relay (`RELAY_KEY=… node relay/relay.js`), open
`http://localhost:8790/web/net/demo/index.html#relay=ws://localhost:8787&rk=…`
(add `&mqtt=ws://…` for a local broker).
