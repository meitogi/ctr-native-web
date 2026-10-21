import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mac, roomKeys, verifyMac } from '../crypto.js';
import { newRoom } from '../link.js';
import { classifyPair, fingerprints, transcript } from '../webrtc.js';

const OFFER = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-',
  'a=fingerprint:SHA-256 ab:cd:ef:01',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=fingerprint:sha-256 AB:CD:EF:01',
  'a=fingerprint:sha-384 11:22',
].join('\r\n');
const ANSWER = 'v=0\na=fingerprint:sha-256 99:88\n';
const SWAPPED = 'v=0\na=fingerprint:sha-256 66:66\n';

test('fingerprints : normalised, deduplicated, sorted', () => {
  assert.equal(fingerprints(OFFER), 'sha-256 AB:CD:EF:01,sha-384 11:22');
  assert.equal(fingerprints('v=0\r\n'), '');
});

test('identity proof : accepted over the same SDPs, refused when a relay swapped one', async () => {
  const { room, key } = newRoom();
  const { auth } = await roomKeys(key, room);
  const t = { offerSdp: OFFER, answerSdp: ANSWER, room, guestNonce: 'g', hostNonce: 'h' };
  const hostProof = await mac(auth, transcript('host', t));
  assert.equal(await verifyMac(auth, transcript('host', t), hostProof), true);
  // the guest checks against the answer it received : a swapped answer fails
  assert.equal(await verifyMac(auth, transcript('host', { ...t, answerSdp: SWAPPED }), hostProof), false);
  assert.equal(await verifyMac(auth, transcript('host', { ...t, offerSdp: SWAPPED }), hostProof), false);
  // role-bound : the host's proof is not a guest proof ; nonce-bound : no replay
  assert.equal(await verifyMac(auth, transcript('guest', t), hostProof), false);
  assert.equal(await verifyMac(auth, transcript('host', { ...t, guestNonce: 'g2' }), hostProof), false);
  // another room secret cannot produce it
  const { auth: other } = await roomKeys(newRoom().key, room);
  assert.equal(await verifyMac(auth, transcript('host', t), await mac(other, transcript('host', t))), false);
});

test('path labels from candidate stats', () => {
  const c = (candidateType, address) => ({ candidateType, address });
  assert.equal(classifyPair(c('host', '2a01:e0a::1'), c('host', '2001:db8::2')), 'direct-ipv6');
  assert.equal(classifyPair(c('srflx', '2a01:e0a::1'), c('prflx', '2001:db8::2')), 'direct-ipv6');
  assert.equal(classifyPair(c('host', '192.168.1.10'), c('host', '192.168.1.11')), 'direct-lan');
  assert.equal(classifyPair(c('host', '192.168.1.10'), c('host', 'b3c1e0a4-1.local')), 'direct-lan');
  assert.equal(classifyPair(c('srflx', '82.64.1.2'), c('srflx', '90.1.2.3')), 'direct-nat');
  assert.equal(classifyPair(c('host', '192.168.1.10'), c('prflx', '90.1.2.3')), 'direct-nat');
  assert.equal(classifyPair(c('host', '2a01:e0a::1'), c('host', 'x.local')), 'direct-ipv6');
  assert.equal(classifyPair(c('srflx', '82.64.1.2'), c('srflx', '2001:db8::2')), 'direct-nat');
});
