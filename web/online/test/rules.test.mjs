// The Online page's room rules (session 11b) : the guest's rejoin loop and the host's
// end-of-race timeout (web/online/rules.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REJOIN_DELAYS_MS, createEndTimer, rejoinLoop } from '../rules.js';

const noSleep = { waits: [], sleep(ms) { this.waits.push(ms); return Promise.resolve(); } };
const sleeper = () => { const s = { waits: [] }; s.sleep = (ms) => { s.waits.push(ms); return Promise.resolve(); }; return s; };

test('rejoin : retries with growing waits until a link, then stops', async () => {
  const s = sleeper();
  const results = ['retry', 'retry', 'ok', 'retry'];
  let n = 0;
  const out = await rejoinLoop({ attempt: async () => results[n++], sleep: s.sleep });
  assert.equal(out, 'ok');
  assert.equal(n, 3);
  assert.deepEqual(s.waits, REJOIN_DELAYS_MS.slice(0, 3));
});

test('rejoin : bounded — every attempt failing ends in failed after the last wait', async () => {
  const s = sleeper();
  let n = 0;
  const out = await rejoinLoop({ attempt: async () => { n++; throw new Error('relay down'); }, sleep: s.sleep });
  assert.equal(out, 'failed');
  assert.equal(n, REJOIN_DELAYS_MS.length);
  assert.ok(REJOIN_DELAYS_MS.reduce((a, b) => a + b) <= 60_000, 'gives up within a minute of waits');
});

test('rejoin : a host gone from the meeting point stops the loop', async () => {
  let n = 0;
  const out = await rejoinLoop({ attempt: async () => (++n === 2 ? 'gone' : 'retry'), sleep: noSleep.sleep.bind(noSleep) });
  assert.equal(out, 'gone');
  assert.equal(n, 2);
});

test('rejoin : cancelled (the player left, or a newer loop) before or after an attempt', async () => {
  let stop = false;
  let n = 0;
  const s = sleeper();
  const out = await rejoinLoop({ attempt: async () => { n++; stop = true; return 'retry'; }, cancelled: () => stop, sleep: s.sleep });
  assert.equal(out, 'cancelled');
  assert.equal(n, 1);
  const before = await rejoinLoop({ attempt: async () => assert.fail('no attempt once cancelled'), cancelled: () => true, sleep: s.sleep });
  assert.equal(before, 'cancelled');
});

test('rejoin : each attempt is told its number', async () => {
  const seen = [];
  let n = 0;
  await rejoinLoop({ attempt: async () => (++n === 3 ? 'ok' : 'retry'), onAttempt: (i) => seen.push(i), sleep: () => Promise.resolve() });
  assert.deepEqual(seen, [1, 2, 3]);
});

test('end timer : notice at the first finisher, end once after the delay', () => {
  const t = createEndTimer();
  const race = (finished, now, endAfterMs = 15_000) => t.tick({ race: true, finished, endAfterMs, now });
  assert.equal(race(0, 0), null, 'nobody finished');
  assert.deepEqual(race(1, 1000), { notice: 15_000 });
  assert.equal(race(1, 2000), null);
  assert.equal(race(2, 15_999), null, 'a second finisher does not restart it');
  assert.deepEqual(race(2, 16_000), { end: true });
  assert.equal(race(2, 20_000), null, 'once per race');
});

test('end timer : off sends nothing ; a new race starts over', () => {
  const t = createEndTimer();
  assert.equal(t.tick({ race: true, finished: 1, endAfterMs: 0, now: 0 }), null);
  assert.equal(t.tick({ race: true, finished: 1, endAfterMs: 0, now: 99_000 }), null);
  assert.deepEqual(t.tick({ race: true, finished: 1, endAfterMs: 10_000, now: 100_000 }), { notice: 10_000 });
  assert.equal(t.tick({ race: false, finished: 0, endAfterMs: 10_000, now: 105_000 }), null, 'back to the lobby');
  assert.equal(t.tick({ race: true, finished: 0, endAfterMs: 10_000, now: 200_000 }), null);
  assert.deepEqual(t.tick({ race: true, finished: 1, endAfterMs: 10_000, now: 201_000 }), { notice: 10_000 });
  assert.deepEqual(t.tick({ race: true, finished: 1, endAfterMs: 10_000, now: 211_000 }), { end: true });
});
