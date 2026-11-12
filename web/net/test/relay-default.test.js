// The page's default relay (../relay-default.js) : one source for the three modules and
// web/dev.sh ; a build may name another (window.__CTR_RELAY, preload-flag.js), nothing else may.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BUILT_IN_RELAY, DEFAULT_RELAY, DEFAULT_RELAY_KEY, relayKeyOf, relayOf } from '../relay-default.js';

const web = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, web), 'utf8');

test('no build value : today\'s relay, no key', () => {
  assert.equal(BUILT_IN_RELAY, 'wss://ctr-relay.suuuper.app');
  assert.equal(DEFAULT_RELAY, BUILT_IN_RELAY);
  assert.equal(DEFAULT_RELAY_KEY, '');
  assert.equal(relayOf(undefined), BUILT_IN_RELAY);
  assert.equal(relayOf(''), BUILT_IN_RELAY);
});

test('a build\'s relay is taken when it is a ws:// or wss:// URL, and only then', () => {
  assert.equal(relayOf('wss://relay.fork.example'), 'wss://relay.fork.example');
  assert.equal(relayOf('ws://localhost:8787'), 'ws://localhost:8787');
  for (const bad of ['https://relay.example', 'wss://a b', 'javascript:alert(1)', 'wss://a"b', 42, null]) {
    assert.equal(relayOf(bad), BUILT_IN_RELAY, String(bad));
  }
});

test('a build\'s key : what a key holds (cloud-init\'s, openssl\'s base64), nothing else', () => {
  assert.equal(relayKeyOf('Jm3-aZ_9'), 'Jm3-aZ_9');
  assert.equal(relayKeyOf('k+/=y'), 'k+/=y');
  for (const bad of [undefined, '', 'a b', 'a"b', '</script>', 7]) assert.equal(relayKeyOf(bad), '', String(bad));
});

test('preload-flag.js\'s values reach DEFAULT_RELAY and DEFAULT_RELAY_KEY', async () => {
  globalThis.__CTR_RELAY = 'wss://relay.fork.example';
  globalThis.__CTR_RELAY_KEY = 'fork-key';
  try {
    const m = await import('../relay-default.js?with-build-values');
    assert.equal(m.DEFAULT_RELAY, 'wss://relay.fork.example');
    assert.equal(m.DEFAULT_RELAY_KEY, 'fork-key');
  } finally {
    delete globalThis.__CTR_RELAY;
    delete globalThis.__CTR_RELAY_KEY;
  }
});

test('the address is written once : the three modules import it, dev.sh reads its line', () => {
  for (const f of ['online/page.js', 'share/panel.js', 'ui/src/lib/join.js', 'dev.sh']) {
    assert.ok(!read(f).includes(BUILT_IN_RELAY), `${f} writes the address itself`);
  }
  for (const f of ['online/page.js', 'share/panel.js', 'ui/src/lib/join.js']) {
    assert.match(read(f), /relay-default\.js/, f);
  }
  assert.match(read('dev.sh'), /BUILT_IN_RELAY.*relay-default\.js/);
});
