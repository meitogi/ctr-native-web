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

test('a link made before the backend list (relay only) parses as sig=relay, and formats back unchanged', () => {
  const { room, key } = newRoom();
  const old = `https://game.example/#room=${room}&key=${key}&relay=wss%3A%2F%2Frelay.example&rk=k`;
  const parsed = parseRoomLink(old);
  assert.deepEqual(parsed.signaling, ['relay']);
  assert.equal(parsed.relay, 'wss://relay.example');
  assert.equal(formatRoomLink('https://game.example/', parsed), old);
  assert.deepEqual(parseRoomLink(`room=${room}&key=${key}`).signaling, ['paste'], 'no relay, no list : copy-paste');
});

test('the backend list keeps its order and its options', () => {
  const room = newRoom({ relay: 'wss://relay.example', rk: 'k', signaling: ['mqtt', 'relay', 'paste'], mqtt: ['wss://broker.example:8084/mqtt'] });
  const link = formatRoomLink('https://game.example/', room);
  assert.match(link, /sig=mqtt%2Crelay%2Cpaste/);
  const parsed = parseRoomLink(link);
  assert.deepEqual(parsed.signaling, ['mqtt', 'relay', 'paste']);
  assert.deepEqual(parsed.mqtt, ['wss://broker.example:8084/mqtt']);
  assert.deepEqual(parsed, room);
  assert.deepEqual(parseRoomLink(formatRoomLink('https://g/', newRoom({ signaling: ['mqtt'] }))).signaling, ['mqtt']);
});

test('a backend list that cannot work is refused with code link', () => {
  const { room, key } = newRoom();
  for (const hash of [`room=${room}&key=${key}&sig=relay`, `room=${room}&key=${key}&sig=carrier-pigeon`,
    `room=${room}&key=${key}&sig=paste,paste`, `room=${room}&key=${key}&sig=mqtt&mqtt=https://x`]) {
    assert.throws(() => parseRoomLink(hash), (e) => e.code === 'link', hash);
  }
});
