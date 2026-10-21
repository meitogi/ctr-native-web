// Backend 3, copy-paste : the two blobs, end to end, in Node.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { roomKeys } from '../crypto.js';
import { newRoom } from '../link.js';
import { PASTE_HOST_ID, pasteSignaling } from '../signaling-paste.js';

const sdp = readFileSync(new URL('./fixtures/offer.sdp', import.meta.url), 'utf8').replaceAll('\n', '\r\n');

async function pair(link = newRoom()) {
  const keys = await roomKeys(link.key, link.room);
  const host = pasteSignaling({ room: link.room, aead: keys.aead, kind: 'host', name: 'h' });
  const guest = pasteSignaling({ room: link.room, aead: keys.aead, kind: 'guest', name: 'g' });
  await host.join();
  await guest.join();
  return { host, guest, link };
}
const next = (emitter, type) => new Promise((resolve) => { const off = emitter.on(type, (v) => { off(); resolve(v); }); });

test('offer blob → host, answer blob → guest : payloads intact, peers learnt, sizes logged', async (t) => {
  const { host, guest } = await pair();
  assert.deepEqual(guest.peers.map((p) => p.id), [guest.selfId, PASTE_HOST_ID], 'a guest knows the host from the start');
  const offer = { t: 'offer', sdp, nonce: 'n'.repeat(22) };
  const shown = next(guest, 'blob');
  await guest.signal(PASTE_HOST_ID, offer);
  const { to, blob } = await shown;
  assert.equal(to, PASTE_HOST_ID);
  assert.match(blob, /^[A-Za-z0-9_-]+$/, 'URL-safe');

  const learnt = next(host, 'peers');
  const received = next(host, 'signal');
  await host.paste(`  ${blob.slice(0, 40)}\n${blob.slice(40)}  `); // chat clients wrap and pad
  assert.deepEqual((await learnt).map((p) => p.id), [PASTE_HOST_ID, guest.selfId]);
  assert.deepEqual(await received, { from: guest.selfId, payload: offer });

  const answer = { t: 'answer', sdp: sdp.replace('actpass', 'active'), nonce: 'm'.repeat(22), proof: 'p'.repeat(43) };
  const back = next(host, 'blob');
  await host.signal(guest.selfId, answer);
  const answerBlob = (await back).blob;
  const atGuest = next(guest, 'signal');
  await guest.paste(answerBlob);
  assert.deepEqual(await atGuest, { from: PASTE_HOST_ID, payload: answer });

  const json = JSON.stringify(offer).length;
  t.diagnostic(`offer : SDP ${sdp.length} B, JSON ${json} B → blob ${blob.length} chars ; answer blob ${answerBlob.length} chars`);
  assert.ok(blob.length < json, `the blob (${blob.length}) is smaller than the JSON it carries (${json})`);
});

test('a blob is refused when used twice, sent back to its maker, damaged, or from another room', async () => {
  const { host, guest } = await pair();
  const shown = next(guest, 'blob');
  await guest.signal(PASTE_HOST_ID, { t: 'offer', sdp });
  const { blob } = await shown;
  await host.paste(blob);
  const refused = async (sig, text, why) => assert.rejects(sig.paste(text), (e) => e.code === 'paste', why);
  await refused(host, blob, 'used twice (replay)');
  await refused(guest, blob, 'its own blob');
  await refused(host, `${blob.slice(0, -4)}AAAA`, 'damaged');
  await refused(host, 'hello there', 'not a blob');
  const other = await pair();
  await refused(other.host, blob, 'another room');
});

test('a blob made for one guest does not open at another', async () => {
  const link = newRoom();
  const { host, guest } = await pair(link);
  const keys = await roomKeys(link.key, link.room);
  const second = pasteSignaling({ room: link.room, aead: keys.aead, kind: 'guest' });
  const shown = next(guest, 'blob');
  await guest.signal(PASTE_HOST_ID, { t: 'offer', sdp });
  await host.paste((await shown).blob);
  const back = next(host, 'blob');
  await host.signal(guest.selfId, { t: 'answer', sdp });
  await assert.rejects(second.paste((await back).blob), (e) => e.code === 'paste');
});
