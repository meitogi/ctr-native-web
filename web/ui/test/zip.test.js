// node --test web/ui/test/*.test.js  —  the zip reader on its own : central directory (stored, deflated,
// zip64, several entries, a comment), refusals (not a zip, truncated, encrypted, method), CRC-32.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crc32 as zlibCrc } from 'node:zlib'
import { ZipError, crc32, entryView, openEntry, readZipDirectory } from '../src/lib/zip.js'
import { makeZip } from '../../test/fixtures.js'

const text = async (stream) => new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer()))

test('central directory : names, methods, sizes, offsets of several entries', async () => {
  const zip = new File([makeZip([
    { name: 'dir/', data: '', method: 0 },
    { name: 'a.txt', data: 'hello', method: 0 },
    { name: 'b.txt', data: 'x'.repeat(10000), method: 8 },
    { name: 'é.bin', data: 'utf8 name' },
  ], { comment: 'a comment after the end record' })], 'test.zip')
  const entries = await readZipDirectory(zip)
  assert.deepEqual(entries.map((e) => [e.name, e.method, e.size, e.directory]), [
    ['dir/', 0, 0, true], ['a.txt', 0, 5, false], ['b.txt', 8, 10000, false], ['é.bin', 8, 9, false],
  ])
  assert.ok(entries[2].compressedSize < 100)
  assert.equal(await text(await openEntry(zip, entries[1])), 'hello')
  assert.equal(await text(await openEntry(zip, entries[2])), 'x'.repeat(10000))
})

test('zip64 : the 0xffffffff slots are read from the zip64 extra field and records', async () => {
  const zip = new File([makeZip([{ name: 'a', data: 'aaaa' }, { name: 'b', data: 'bbbbbb', method: 0 }], { zip64: true })], 'test.zip')
  const entries = await readZipDirectory(zip)
  assert.deepEqual(entries.map((e) => [e.name, e.size]), [['a', 4], ['b', 6]])
  assert.ok(entries[1].localOffset > 0 && entries[1].localOffset < 0xffffffff)
  assert.equal(await text(await openEntry(zip, entries[1])), 'bbbbbb')
})

test('refusals carry a code', async () => {
  const code = async (bytes) => readZipDirectory(new File([bytes], 'x.zip')).then(() => 'none', (e) => (e instanceof ZipError ? e.code : String(e)))
  assert.equal(await code(new Uint8Array(100)), 'not-zip')
  const zip = makeZip([{ name: 'a', data: 'a'.repeat(5000) }])
  assert.equal(await code(zip.slice(0, zip.length - 10)), 'truncated')
  assert.equal(await code(zip.slice(0, 40)), 'truncated')
  const entries = await readZipDirectory(new File([zip], 'x.zip'))
  await assert.rejects(openEntry(new File([zip], 'x.zip'), { ...entries[0], encrypted: true }), (e) => e.code === 'encrypted')
  await assert.rejects(openEntry(new File([zip], 'x.zip'), { ...entries[0], method: 14 }), (e) => e.code === 'method')
})

test('crc32 matches zlib on odd lengths and chained updates', () => {
  const bytes = new Uint8Array(100003).map((_, i) => (i * 7919) & 0xff)
  assert.equal(crc32(0, bytes), zlibCrc(bytes))
  assert.equal(crc32(crc32(0, bytes.subarray(0, 333)), bytes.subarray(333)), zlibCrc(bytes))
  assert.equal(crc32(0, new Uint8Array(0)), 0)
})

test('entryView of a deflated entry decompresses only as far as a read asks', async () => {
  const data = new Uint8Array(1 << 20).map((_, i) => i & 0xff)
  const zip = new File([makeZip([{ name: 'big.bin', data }])], 'test.zip')
  const [entry] = await readZipDirectory(zip)
  const view = await entryView(zip, entry, { limit: 64 << 10 })
  assert.equal(view.size, 1 << 20)
  const part = new Uint8Array(await view.slice(1000, 1010).arrayBuffer())
  assert.deepEqual([...part], [...data.subarray(1000, 1010)])
  await assert.rejects(view.slice(0, 1 << 20).arrayBuffer(), (e) => e.code === 'probe')
  view.close()
})
