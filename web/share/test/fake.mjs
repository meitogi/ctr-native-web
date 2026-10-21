// In-memory stand-ins for the parts of web/net/ and WebRTC Share touches, no richer than what
// they stand for : a link (peerId, backend, path, pc, send(bytes, {reliable}), close(), events
// 'message' / 'close' — web/net/transport.js), a room (events 'link' / 'linkclose', connect(),
// close() — web/net/room.js) and the RTCPeerConnection calls media.js makes.
import { Emitter } from '../../net/events.js';

const later = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An RTCRtpSender's parameters, as setParameters left them. */
class FakeSender {
  constructor(track) {
    this.track = track;
    this.params = { encodings: [{}] };
  }

  getParameters() { return structuredClone(this.params); }

  async setParameters(p) { this.params = structuredClone(p); }
}

const OPUS = 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n';

/** The RTCPeerConnection surface media.js uses : transceivers, offer / answer, 'track'. */
export class FakePc extends EventTarget {
  constructor() {
    super();
    this.transceivers = [];
    this.localDescription = null;
    this.remoteDescription = null;
  }

  addTransceiver(track, init) {
    const t = { track, init, sender: new FakeSender(track) };
    this.transceivers.push(t);
    return t;
  }

  async createOffer() {
    return { type: 'offer', sdp: `v=0\r\n${this.transceivers.map((t) => `m=${t.track.kind}\r\n`).join('')}` };
  }

  async createAnswer() {
    return { type: 'answer', sdp: `v=0\r\n${this.remoteDescription.sdp.includes('m=audio') ? OPUS : ''}` };
  }

  async setLocalDescription(d) { this.localDescription = d; }

  async setRemoteDescription(d) {
    this.remoteDescription = d;
    if (d.type !== 'offer') return;
    for (const kind of ['video', 'audio']) {
      if (!d.sdp.includes(`m=${kind}`)) continue;
      const ev = new Event('track');
      ev.track = { kind };
      ev.receiver = {};
      this.dispatchEvent(ev);
    }
  }
}

/** One end of a link ; `pair()` makes both. Sends are delivered asynchronously, in order. */
function end(peerId, backend, pc, log) {
  const l = new Emitter();
  l.peerId = peerId;
  l.backend = backend;
  l.path = backend === 'ws' ? 'relay' : 'direct-lan';
  if (pc) l.pc = pc;
  l.closed = false;
  l.send = (bytes, { reliable = false } = {}) => {
    if (l.closed) return;
    log.push({ from: l.side, bytes: Uint8Array.from(bytes), reliable });
    const other = l.other;
    later().then(() => { if (!other.closed) other.emit('message', Uint8Array.from(bytes)); });
  };
  l.close = () => {
    if (l.closed) return;
    l.closed = true;
    l.emit('close');
    later().then(() => l.other.close());
  };
  return l;
}

/**
 * A guest's link to the host : `{host, guest, log}` — `host` is the link the host's room
 * emits (its peerId = the guest), `guest` the one `connect()` resolves to.
 * @param {'webrtc'|'ws'} backend
 */
export function pair(guestId, backend = 'webrtc') {
  const log = [];
  const rtc = backend === 'webrtc';
  const host = end(guestId, backend, rtc ? new FakePc() : null, log);
  const guest = end('host', backend, rtc ? new FakePc() : null, log);
  host.side = 'host';
  guest.side = 'guest';
  host.other = guest;
  guest.other = host;
  return { host, guest, log };
}

/** A host room : `add(link)` is a guest arriving ; it emits 'linkclose' when that link closes. */
export function hostRoom() {
  const r = new Emitter();
  r.closed = false;
  r.add = (link) => {
    link.on('close', () => r.emit('linkclose', link));
    r.emit('link', link);
  };
  r.close = () => { r.closed = true; };
  return r;
}

/** A guest room whose `connect()` resolves to `link`, or rejects with `error`. */
export function guestRoom({ link, error }) {
  const r = new Emitter();
  r.closed = false;
  r.connect = async () => {
    await later();
    if (error) throw error;
    return link;
  };
  r.close = () => { r.closed = true; };
  return r;
}

export const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** A MediaStream-like with one video and one audio track. */
export function fakeStream() {
  const tracks = [{ kind: 'video' }, { kind: 'audio' }];
  return { getTracks: () => tracks.slice() };
}
