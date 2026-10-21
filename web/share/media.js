// The stream on a WebRTC room link : the host renegotiates the link's own RTCPeerConnection
// (`link.pc`, web/net/transport.js) with its video and audio tracks. The offer and the answer
// travel as Share's reliable messages on that link (protocol.js OFFER / ANSWER), never through
// signaling : the relay sees none of it.
//
// Same ICE and DTLS transport as the link's channels (bundled), so nothing is gathered again,
// and the identity proof web/net/ checked over both DTLS fingerprints covers the media too :
// SRTP keys come from that DTLS session.
import { TAG, decodeControl, encodeControl } from './protocol.js';

/** Waits for the control message `tag` on `link` ; rejects on close or after `ms`. */
export function nextControl(link, tag, ms = 10_000) {
  return new Promise((resolve, reject) => {
    const done = () => { offMessage(); offClose(); clearTimeout(timer); };
    const offMessage = link.on('message', (bytes) => {
      const msg = decodeControl(bytes);
      if (msg?.tag !== tag) return;
      done();
      resolve(msg.body);
    });
    const offClose = link.on('close', () => { done(); reject(new Error('the link closed')); });
    const timer = setTimeout(() => { done(); reject(new Error(`no ${tag === TAG.answer ? 'answer' : 'offer'} in time`)); }, ms);
  });
}

/**
 * Encoder settings of one video sender : bitrate cap, 30 fps, keep the frame rate under
 * pressure (drop resolution first), and `scale` (≥ 1) down from the canvas.
 */
export async function tuneVideo(sender, { maxBitrate, scale = 1 }) {
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  const e = params.encodings[0];
  e.maxBitrate = maxBitrate;
  e.maxFramerate = 30;
  e.scaleResolutionDownBy = Math.max(1, scale);
  params.degradationPreference = 'maintain-framerate';
  await sender.setParameters(params);
}

/**
 * Host : adds `stream`'s tracks to the guest's link and renegotiates. Resolves with the
 * senders once the guest's answer is applied.
 * @param {object} link - a WebRTC room link (`link.pc`)
 * @param {MediaStream} stream - one video track, at most one audio track
 */
export async function offerMedia(link, stream, { maxBitrate, scale = 1, answerMs = 10_000 }) {
  const pc = link.pc;
  const senders = {};
  for (const track of stream.getTracks()) {
    senders[track.kind] = pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] }).sender;
  }
  const answer = nextControl(link, TAG.answer, answerMs);
  await pc.setLocalDescription(await pc.createOffer());
  link.send(encodeControl(TAG.offer, { sdp: pc.localDescription.sdp }), { reliable: true });
  await pc.setRemoteDescription({ type: 'answer', sdp: String((await answer).sdp) });
  if (senders.video) await tuneVideo(senders.video, { maxBitrate, scale });
  return senders;
}

/** Asks the remote sender for stereo Opus (the game's audio is stereo ; Opus answers mono by default). */
export function stereoOpus(sdp) {
  const opus = /^a=rtpmap:(\d+) opus\/48000\/2/im.exec(sdp)?.[1];
  if (!opus) return sdp;
  return sdp.replace(new RegExp(`^(a=fmtp:${opus} [^\\r\\n]*)`, 'm'), (line) => (/stereo=1/.test(line) ? line : `${line};stereo=1;sprop-stereo=1`));
}

/**
 * The lowest receiver playout delay this browser takes : `jitterBufferTarget` (ms, the
 * standard) or Chrome's older `playoutDelayHint` (s). Returns the knob used, or null.
 */
export function minimisePlayout(receiver) {
  if ('jitterBufferTarget' in receiver) {
    receiver.jitterBufferTarget = 0;
    return 'jitterBufferTarget';
  }
  if ('playoutDelayHint' in receiver) {
    receiver.playoutDelayHint = 0;
    return 'playoutDelayHint';
  }
  return null;
}

/**
 * Guest : answers the host's media offers on `link` (the first, and any later one).
 * `onTrack(event)` gets the RTCTrackEvent of each received track.
 * @returns {() => void} stops answering
 */
export function answerMedia(link, { onTrack, onError = () => {} }) {
  const pc = link.pc;
  pc.addEventListener('track', onTrack);
  const off = link.on('message', async (bytes) => {
    const msg = decodeControl(bytes);
    if (msg?.tag !== TAG.offer) return;
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: String(msg.body.sdp) });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({ type: 'answer', sdp: stereoOpus(answer.sdp) });
      link.send(encodeControl(TAG.answer, { sdp: pc.localDescription.sdp }), { reliable: true });
    } catch (e) {
      onError(e);
    }
  });
  return () => {
    off();
    pc.removeEventListener('track', onTrack);
  };
}
