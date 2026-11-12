// « Report a problem » (src/lib/report.js) : the new-issue link fills the bug form's fields, by the
// form's own ids, and carries nothing private.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ISSUES, MAX_URL, MODES, browserOf, issueUrl, modeOf } from '../src/lib/report.js'

const FORM = readFileSync(new URL('../../../.github/ISSUE_TEMPLATE/bug.yml', import.meta.url), 'utf8')
const formIds = [...FORM.matchAll(/^\s+id: (\S+)$/gm)].map((m) => m[1])

test('the link opens the bug form and fills each field by its id', () => {
  const url = new URL(issueUrl({ version: 'v1.0.0-b.10', browser: 'Firefox 133 · Windows', mode: MODES.netplayGuest, lang: 'en', state: 'phase=running' }))
  assert.equal(`${url.origin}${url.pathname}`, ISSUES)
  assert.equal(url.searchParams.get('template'), 'bug.yml')
  assert.equal(url.searchParams.get('version'), 'v1.0.0-b.10')
  assert.equal(url.searchParams.get('browser'), 'Firefox 133 · Windows')
  assert.equal(url.searchParams.get('mode'), 'Netplay guest')
  assert.equal(url.searchParams.get('lang'), 'en')
  assert.equal(url.searchParams.get('state'), 'phase=running')
})

test('every key the link sets is a field of .github/ISSUE_TEMPLATE/bug.yml', () => {
  const url = new URL(issueUrl({ version: 'v', browser: 'b', mode: 'm', lang: 'l', state: 's' }))
  for (const k of url.searchParams.keys()) {
    if (k === 'template') continue
    assert.ok(formIds.includes(k), `${k} is not an id of bug.yml (${formIds.join(', ')})`)
  }
  for (const mode of Object.values(MODES)) assert.ok(FORM.includes(mode), `bug.yml's mode field names ${mode}`)
})

test('empty fields are left out, and nothing else is ever added', () => {
  const url = new URL(issueUrl({ version: 'v1', browser: '', mode: '  ', room: 'ABC', rk: 'secret', name: 'Mad Roo' }))
  assert.deepEqual([...url.searchParams.keys()], ['template', 'version'])
  assert.ok(!/ABC|secret|Mad/.test(url.href))
})

test('a long state is cut to keep the link under GitHub\'s limit, and says so', () => {
  const state = 'é'.repeat(20000)
  const url = issueUrl({ version: 'v1', state })
  assert.ok(url.length <= MAX_URL, `${url.length}`)
  const kept = new URL(url).searchParams.get('state')
  assert.match(kept, /^é+\n\[… cut to fit the link\]$/)
  assert.ok(kept.length > 500, 'most of what fits is kept')
})

test('the mode of the page', () => {
  assert.equal(modeOf(), 'Solo')
  assert.equal(modeOf({ sharing: true }), 'Couch host')
  assert.equal(modeOf({ guest: true }), 'Couch guest')
  assert.equal(modeOf({ netplay: 'host' }), 'Netplay host')
  assert.equal(modeOf({ netplay: 'guest', sharing: true }), 'Netplay guest')
})

test('the browser and the OS from a user agent', () => {
  const cases = {
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36': 'Chrome 131 · macOS',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0': 'Firefox 133 · Windows',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15': 'Safari 18.1 · macOS',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0': 'Edge 131 · Windows',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1': 'Chrome 131 · iOS',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36': 'Chrome 131 · Android',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36': 'Chrome 131 · Linux',
    '': 'unknown browser · unknown OS',
  }
  for (const ua in cases) assert.equal(browserOf(ua), cases[ua], ua)
})
