import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatRoomLink, newRoom, parseRoomLink } from '../link.js';

test('newRoom → formatRoomLink → parseRoomLink round trip', () => {
  const room = newRoom({ relay: 'wss://relay.example.org', rk: 'k+/=y' });
  const link = formatRoomLink('https://game.example/play?lang=fr#old', room);
  assert.deepEqual(parseRoomLink(link), room);
  assert.deepEqual(parseRoomLink(link.split('#')[1]), room);
});

test('secrets live after # only : the part a server receives carries none', () => {
  const room = newRoom({ relay: 'wss://relay.example.org', rk: 'relay-key' });
  const link = formatRoomLink('https://game.example/play?lang=fr', room);
  const sentToServer = link.split('#')[0];
  assert.equal(sentToServer, 'https://game.example/play?lang=fr');
  for (const secret of [room.key, 'relay-key', room.room]) assert.ok(!sentToServer.includes(secret));
  assert.equal(new URL(link).search, '?lang=fr');
});

test('a 32-byte secret and a short room id', () => {
  const { room, key } = newRoom();
  assert.match(room, /^[A-Za-z0-9_-]{11}$/);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
});

test('invalid links throw code link', () => {
  const { room, key } = newRoom();
  for (const hash of ['', `room=${room}`, `key=${key}`, `room=${room}&key=short`, `room=a b&key=${key}`,
    `room=${room}&key=${key}&relay=https://x`]) {
    assert.throws(() => parseRoomLink(hash), (e) => e.code === 'link', hash);
  }
  assert.equal(parseRoomLink(`room=${room}&key=${key}`).relay, '');
});
