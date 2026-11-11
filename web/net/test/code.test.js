import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CODE_NAMES, codeNames, codeRoom, codeText, parseCode, randomCode, roomFromCode, validCode } from '../code.js';
import { formatRoomLink, parseRoomLink } from '../link.js';

test('a code is 3 to 5 character ids', () => {
  assert.equal(CODE_NAMES.length, 15);
  assert.ok(validCode([0, 3, 2]));
  assert.ok(validCode([14, 14, 14, 14, 14]));
  for (const bad of [[0, 3], [0, 1, 2, 3, 4, 5], [0, 15, 2], [0, 1.5, 2], [0, -1, 2], '032', null]) assert.ok(!validCode(bad), JSON.stringify(bad));
});

test('codeText ↔ parseCode, and the names said aloud', () => {
  assert.equal(codeText([0, 3, 2]), '032');
  assert.equal(codeText([14, 10, 0, 7]), 'ea07');
  assert.deepEqual(parseCode('ea07'), [14, 10, 0, 7]);
  assert.equal(codeNames([0, 3, 2]), 'Crash · Coco · Tiny');
  for (const bad of ['', '03', '03f', '0312345', 'EA07', 7, undefined]) assert.equal(parseCode(bad), null, String(bad));
});

test('randomCode : the asked length, every character reachable, none favoured by the modulo', () => {
  const seen = new Array(15).fill(0);
  for (let i = 0; i < 400; i++) {
    const ids = randomCode(4);
    assert.ok(validCode(ids));
    for (const id of ids) seen[id]++;
  }
  assert.ok(seen.every((n) => n > 0), seen.join(' '));
  // bytes 240–255 would map onto the first characters again : they are thrown away
  let call = 0;
  const ids = randomCode(3, (n) => (call++ ? new Uint8Array(n).fill(16) : new Uint8Array(n).fill(255)));
  assert.deepEqual(ids, [1, 1, 1]);
});

test('roomFromCode : the same room for the same code, another for any other code or length', async () => {
  const a = await roomFromCode([0, 3, 2]);
  assert.deepEqual(await roomFromCode([0, 3, 2]), a);
  assert.match(a.room, /^[A-Za-z0-9_-]{11}$/);
  assert.match(a.key, /^[A-Za-z0-9_-]{43}$/);
  const others = await Promise.all([[0, 3, 1], [2, 3, 0], [0, 3, 2, 0], [0, 0, 3, 2]].map(roomFromCode));
  for (const o of others) {
    assert.notEqual(o.room, a.room);
    assert.notEqual(o.key, a.key);
  }
  await assert.rejects(() => roomFromCode([0, 3]), { code: 'link' });
});

test('a code room in a link : the code and the pass travel, the guest by code derives the same room', async () => {
  const room = await codeRoom([7, 0, 12], { relay: 'wss://relay.example.org', rk: 'k' });
  assert.equal(room.code, '70c');
  assert.match(room.pass, /^[A-Za-z0-9_-]{22}$/);
  const parsed = parseRoomLink(formatRoomLink('https://game.example/', room));
  assert.deepEqual(parsed, room);
  const typed = await roomFromCode(parseCode(parsed.code));
  assert.equal(typed.room, room.room);
  assert.equal(typed.key, room.key);
  // the pass is not the code's : two rooms under one code have different ones
  assert.notEqual((await codeRoom([7, 0, 12], { relay: 'wss://relay.example.org' })).pass, room.pass);
});

test('a link refuses a malformed code or pass', () => {
  const ok = 'room=abc&key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&relay=wss://r.example';
  assert.equal(parseRoomLink(`#${ok}&c=032&t=abc_-`).code, '032');
  assert.throws(() => parseRoomLink(`#${ok}&c=03`), { code: 'link' });
  assert.throws(() => parseRoomLink(`#${ok}&c=03f`), { code: 'link' });
  assert.throws(() => parseRoomLink(`#${ok}&t=a b`), { code: 'link' });
});
