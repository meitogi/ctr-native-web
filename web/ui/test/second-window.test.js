// Settings › Dev's second window (src/lib/second-window.js) : its address, place and settings, hosting.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOT_SEED, SECOND, host, memoryStorage, pageRole, secondWindowUrl, windowFeatures } from '../src/lib/second-window.js'
import { KEYS, createSettings } from '../src/lib/settings.js'

test('second window url : the room link kept whole, ?bot ?mute ?dev added', () => {
  const online = 'http://localhost:8090/index.html?sound#room=abc&key=def&relay=wss%3A%2F%2Fr'
  const u = new URL(secondWindowUrl(online, 'battle'))
  assert.equal(u.pathname, '/index.html')
  assert.equal(u.hash, '#room=abc&key=def&relay=wss%3A%2F%2Fr')
  assert.equal(u.searchParams.get('dev'), 'battle')
  assert.ok(u.searchParams.has('bot') && u.searchParams.has('mute') && u.searchParams.has('sound'))
  const share = new URL(secondWindowUrl('http://localhost:8090/share/guest.html#room=x&key=y', 'share'))
  assert.equal(share.pathname, '/share/guest.html')
  assert.equal(share.hash, '#room=x&key=y')
})

test('page role : ?dev only for a known mode', () => {
  assert.deepEqual(pageRole('?bot=1&mute=1&dev=vs'), { bot: true, second: 'vs' })
  assert.deepEqual(pageRole('?dev=nope'), { bot: false, second: null })
  assert.deepEqual(pageRole(''), { bot: false, second: null })
  assert.deepEqual(Object.keys(SECOND), ['vs', 'battle', 'share', 'arcade'])
  assert.equal(SECOND.arcade.room, 'online')
  assert.equal(SECOND.battle.room, 'online')
  assert.equal(SECOND.share.menu, 'VS.')
})

test('window features : beside this window when there is room, else the right half', () => {
  const screen = { availLeft: 0, availTop: 25, availWidth: 1920, availHeight: 1055 }
  assert.equal(windowFeatures({ screen, screenX: 0, screenY: 25, outerWidth: 960, outerHeight: 1000 }), 'popup,left=960,top=25,width=960,height=1000')
  // a full-width first window : the second goes on the right half, over it
  assert.equal(windowFeatures({ screen, screenX: 0, screenY: 0, outerWidth: 1920, outerHeight: 1080 }), 'popup,left=960,top=25,width=960,height=1055')
})

test("the bot's settings stay in memory : « Bot », the keyboard, nothing written to the player's storage", () => {
  const player = memoryStorage({ [KEYS.name]: 'Kev', [KEYS.device]: JSON.stringify({ mode: 'gamepad', pad: { id: 'x', nth: 0 } }) })
  const bot = createSettings(memoryStorage(BOT_SEED))
  assert.equal(bot.get().name, 'Bot')
  assert.equal(bot.get().device.mode, 'keyboard')
  bot.patch({ name: 'Other' })
  assert.equal(player.getItem(KEYS.name), 'Kev')
  assert.equal(createSettings(player).get().device.mode, 'gamepad')
})

test('host : Share through the panel, Online through its page', async () => {
  const calls = []
  const g = {
    ctrShareApi: { start: async () => { calls.push('share') }, link: () => 'http://h/share/guest.html#room=1' },
    __ctrOnline: { host: async () => { calls.push('online') }, state: () => ({ link: 'http://h/index.html#room=2' }) },
  }
  await assert.rejects(host('solo', g), /no room/)
  assert.equal(await host('share', g), 'http://h/share/guest.html#room=1')
  assert.equal(await host('online', g), 'http://h/index.html#room=2')
  assert.deepEqual(calls, ['share', 'online'])
  await assert.rejects(host('online', { __ctrOnline: { host: async () => {}, state: () => ({ link: '', error: 'relay down' }) } }), /relay down/)
  await assert.rejects(host('share', {}, { timeout: 50, every: 10 }), /never loaded/)
})
