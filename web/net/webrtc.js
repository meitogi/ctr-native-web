// WebRTC side of a room link : one RTCPeerConnection per guest, guest offers, host answers.
//
// Non-trickle like webrtc-node-peer (one complete SDP each way, so the copy-paste backend
// can carry it too), but both roles live in the browser. Two pre-negotiated channels, so
// neither side waits for `ondatachannel` :
//   ctl  (id 0) — reliable, ordered : the identity proof, control
//   game (id 1) — unordered, maxRetransmits 0 : game messages, a late one is useless
// iceServers = one public STUN server : a direct path or nothing (no TURN, by design).

export const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
const GATHER_CAP_MS = 3000;

function waitGathering(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState !== 'complete') return;
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, GATHER_CAP_MS); // a slow STUN server must not stall signaling
  });
}

function channels(pc) {
  const ctl = pc.createDataChannel('ctl', { negotiated: true, id: 0 });
  const game = pc.createDataChannel('game', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
  ctl.binaryType = 'arraybuffer';
  game.binaryType = 'arraybuffer';
  return { ctl, game };
}

/** Guest side : the offer, complete. `accept(answerSdp)` applies the host's answer. */
export async function createOffer({ iceServers = STUN } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  try {
    const { ctl, game } = channels(pc);
    await pc.setLocalDescription(await pc.createOffer());
    await waitGathering(pc);
    return { pc, ctl, game, sdp: pc.localDescription.sdp, accept: (sdp) => pc.setRemoteDescription({ type: 'answer', sdp }) };
  } catch (e) {
    pc.close();
    throw e;
  }
}

/** Host side : answers a guest's offer, complete — the browser-side answerer. */
export async function createAnswer(offerSdp, { iceServers = STUN } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  try {
    const { ctl, game } = channels(pc);
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitGathering(pc);
    return { pc, ctl, game, sdp: pc.localDescription.sdp };
  } catch (e) {
    pc.close();
    throw e;
  }
}

/**
 * The DTLS fingerprints an SDP commits to, normalised : every `a=fingerprint:` line, algorithm
 * lowercase, value uppercase, deduplicated, sorted, joined by `,`. DTLS refuses a peer whose
 * certificate does not match the SDP that was applied, so a proof over these values binds
 * to the actual encrypted connection.
 */
export function fingerprints(sdp) {
  const found = [];
  for (const line of sdp.split(/\r?\n/)) {
    const m = /^a=fingerprint:(\S+)\s+(\S+)/.exec(line.trim());
    if (!m) continue;
    const value = `${m[1].toLowerCase()} ${m[2].toUpperCase()}`;
    if (!found.includes(value)) found.push(value);
  }
  return found.sort().join(',');
}

/**
 * What each side proves knowledge of the room secret over : role, both SDPs' fingerprints,
 * the room, and one fresh nonce per side (a proof from another connection does not replay).
 */
export function transcript(role, { offerSdp, answerSdp, room, guestNonce, hostNonce }) {
  return ['ctr-net auth v1', role, fingerprints(offerSdp), fingerprints(answerSdp), room, guestNonce, hostNonce].join('\n');
}

/**
 * Path label of a connected pair, from its two candidate stats.
 * - `direct-ipv6` : both ends IPv6 — no NAT at all
 * - `direct-lan`  : both host candidates over IPv4 — same network
 * - `direct-nat`  : anything else (server- or peer-reflexive) — a hole punched through NAT
 * A remote address hidden by mDNS (`….local`) or absent falls back to the local one.
 */
export function classifyPair(local, remote) {
  const isV6 = (address) => typeof address === 'string' && address.includes(':');
  const remoteAddress = remote.address && !remote.address.endsWith('.local') ? remote.address : local.address;
  if (isV6(local.address) && isV6(remoteAddress)) return 'direct-ipv6';
  if (local.candidateType === 'host' && remote.candidateType === 'host') return 'direct-lan';
  return 'direct-nat';
}

/** Path label of a connected RTCPeerConnection, or null when no pair is selected yet. */
export async function pathOf(pc) {
  const stats = await pc.getStats();
  let pairId = null;
  stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId; });
  if (!pairId) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pairId = s.id; });
  const pair = pairId && stats.get(pairId);
  if (!pair) return null;
  return classifyPair(stats.get(pair.localCandidateId) ?? {}, stats.get(pair.remoteCandidateId) ?? {});
}
