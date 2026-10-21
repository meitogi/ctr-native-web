import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { b64u, createSealer, mac, roomKeys, verifyMac } from '../crypto.js';
import { newRoom } from '../link.js';

const bytes = (s) => new TextEncoder().encode(s);
const str = (b) => new TextDecoder().decode(b);

test('base64url round trip, no padding', () => {
  for (let n = 0; n < 40; n++) {
    const data = crypto.getRandomValues(new Uint8Array(n));
    const text = b64u.encode(data);
    assert.match(text, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(b64u.decode(text), data);
  }
  assert.throws(() => b64u.decode('a+b'));
});

test('seal → open between two peers, ciphertext hides the plaintext', async () => {
  const { room, key } = newRoom();
  const { aead } = await roomKeys(key, room);
  const alice = createSealer(aead, room, 'alice');
  const bob = createSealer(aead, room, 'bob');
  const sealed = await alice.seal('bob', bytes('kart state 42'));
  assert.ok(!str(sealed).includes('kart state'));
  assert.equal(str(await bob.open('alice', sealed)), 'kart state 42');
});

test('open refuses : wrong key, tampering, wrong sender, wrong recipient, replay', async () => {
  const { room, key } = newRoom();
  const other = newRoom();
  const { aead } = await roomKeys(key, room);
  const { aead: aeadOther } = await roomKeys(other.key, room);
  const alice = createSealer(aead, room, 'alice');
  const bob = createSealer(aead, room, 'bob');
  const carol = createSealer(aead, room, 'carol');
  const sealed = await alice.seal('bob', bytes('hi'));

  assert.equal(await createSealer(aeadOther, room, 'bob').open('alice', sealed), null, 'other room secret');
  const flipped = sealed.slice();
  flipped[20] ^= 1;
  assert.equal(await bob.open('alice', flipped), null, 'tampered');
  assert.equal(await bob.open('carol', sealed), null, 'claimed by another sender');
  assert.equal(await carol.open('alice', sealed), null, 'redirected to another peer');
  assert.equal(await bob.open('alice', sealed.subarray(0, 20)), null, 'truncated');

  assert.equal(str(await bob.open('alice', sealed)), 'hi');
  assert.equal(await bob.open('alice', sealed), null, 'replayed');
  const second = await alice.seal('bob', bytes('two'));
  const third = await alice.seal('bob', bytes('three'));
  assert.equal(str(await bob.open('alice', third)), 'three');
  assert.equal(await bob.open('alice', second), null, 'older counter after a newer one');
});

test('a second sealer under an id already seen is refused (a new sealer needs a new id)', async () => {
  const { room, key } = newRoom();
  const { aead } = await roomKeys(key, room);
  const bob = createSealer(aead, room, 'bob');
  assert.ok(await bob.open('alice', await createSealer(aead, room, 'alice').seal('bob', bytes('first'))));
  assert.equal(await bob.open('alice', await createSealer(aead, room, 'alice').seal('bob', bytes('again'))), null);
});

test('the same secret under another room id derives other keys', async () => {
  const { room, key } = newRoom();
  const a = createSealer((await roomKeys(key, room)).aead, room, 'alice');
  const b = createSealer((await roomKeys(key, room + 'x')).aead, room, 'bob');
  assert.equal(await b.open('alice', await a.seal('bob', bytes('x'))), null);
});

test('mac / verifyMac', async () => {
  const { room, key } = newRoom();
  const { auth } = await roomKeys(key, room);
  const { auth: authOther } = await roomKeys(newRoom().key, room);
  const m = await mac(auth, 'transcript');
  assert.equal(await verifyMac(auth, 'transcript', m), true);
  assert.equal(await verifyMac(auth, 'transcript!', m), false);
  assert.equal(await verifyMac(authOther, 'transcript', m), false);
  assert.equal(await verifyMac(auth, 'transcript', 'not+b64'), false);
  assert.equal(await verifyMac(auth, 'transcript', undefined), false);
});
