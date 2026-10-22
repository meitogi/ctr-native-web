// node --test web/ui/test/*.test.js  —  the default names (src/lib/names.js) : adjective + CTR
// character, at most NAME_LEN printable ASCII (cleanName leaves each one as it is), no accident.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ADJECTIVES, CHARACTERS, NAMES, randomName } from '../src/lib/names.js'
import { NAME_LEN, cleanName } from '../src/lib/settings.js'

test('every name fits the wire format : cleanName returns it unchanged, ≤ NAME_LEN', () => {
  assert.ok(NAMES.length >= 100, `only ${NAMES.length} names`)
  for (const n of NAMES) {
    assert.equal(cleanName(n), n)
    assert.ok(n.length <= NAME_LEN, n)
    assert.match(n, /^[A-Z][a-z]+ [A-Z][A-Za-z.]+$/)
  }
  assert.equal(new Set(NAMES).size, NAMES.length)
  // every adjective and every character shows up at least once
  for (const a of ADJECTIVES) assert.ok(NAMES.some((n) => n.startsWith(`${a} `)), a)
  for (const c of CHARACTERS) assert.ok(NAMES.some((n) => n.endsWith(` ${c}`)), c)
})

test('no accidental word once the space is gone', () => {
  const bad = ['ass', 'fag', 'nig', 'cum', 'tit', 'sex', 'kkk', 'nazi', 'rape', 'porn', 'dick', 'cock', 'slut', 'whore', 'jew', 'gay', 'fuk', 'fuck', 'shit', 'piss', 'poo']
  for (const n of NAMES) {
    const flat = n.toLowerCase().replace(/[^a-z]/g, '')
    for (const w of bad) assert.ok(!flat.includes(w), `${n} contains « ${w} »`)
  }
})

test('randomName draws from NAMES, ends included', () => {
  assert.equal(randomName(() => 0), NAMES[0])
  assert.equal(randomName(() => 0.9999999), NAMES[NAMES.length - 1])
  assert.ok(NAMES.includes(randomName()))
})
