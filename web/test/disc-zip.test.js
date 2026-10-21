// node --test web/test/disc-zip.test.js
//
// A disc image inside a .zip, end to end without a browser : the archive (built in memory by
// fixtures.js, never a real disc) goes through web/ui/src/lib/discsource.js's resolveDisc — the
// function the drop overlay calls — with web/disc.js's probeDisc, then the chosen entry is
// streamed out exactly as the page streams it into OPFS, and the bytes that come out are
// compared with the disc that went in.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { probeDisc } from '../disc.js';
import { resolveDisc } from '../ui/src/lib/discsource.js';
import { buildDisc, makeZip } from './fixtures.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function drain(stream) {
  const chunks = [];
  let n = 0;
  for await (const c of stream) { chunks.push(c); n += c.length; }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function discBytes(opts) {
  return new Uint8Array(await buildDisc(opts).arrayBuffer());
}

for (const method of [0, 8]) {
  test(`a zipped disc (${method ? 'deflated' : 'stored'}) resolves and streams out byte for byte`, async () => {
    const disc = await discBytes({ sectors: 600, seed: 7 }); // 1.4 MB, past the probe's prefix
    const zip = new File([makeZip([{ name: 'CTR (USA).cue', data: 'FILE "CTR (USA).bin" BINARY\n', method }, { name: 'CTR (USA).bin', data: disc, method }])], 'CTR (USA).zip');
    const r = await resolveDisc(zip, probeDisc);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.kind, 'zip');
    assert.equal(r.serial, 'SCUS_944.26');
    assert.equal(r.name, 'CTR (USA).bin');
    assert.equal(r.size, disc.length);
    const out = await drain(await r.open());
    assert.equal(out.length, disc.length);
    assert.equal(sha(out), sha(disc));
  });
}

test('a zip64 archive (sizes and offsets in zip64 records) resolves and streams the same bytes', async () => {
  const disc = await discBytes({ sectors: 300, seed: 3 });
  const zip = new File([makeZip([{ name: 'game/ctr.bin', data: disc }], { zip64: true })], 'ctr.zip');
  const r = await resolveDisc(zip, probeDisc);
  assert.equal(r.ok, true, r.message);
  assert.equal(sha(await drain(await r.open())), sha(disc));
});

test('several .bin : the one that probes NTSC-U is chosen, whatever its size', async () => {
  const pal = await discBytes({ sectors: 400, seed: 1, serial: 'SCES_021.05' });
  const ntsc = await discBytes({ sectors: 200, seed: 2 });
  const junk = new Uint8Array(4704).fill(0x55); // a .bin of the right size class, no sync pattern
  const zip = new File([makeZip([{ name: 'pal.bin', data: pal }, { name: 'junk.bin', data: junk }, { name: 'ntsc.bin', data: ntsc }])], 'discs.zip');
  const r = await resolveDisc(zip, probeDisc);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.name, 'ntsc.bin');
  assert.equal(sha(await drain(await r.open())), sha(ntsc));
});

test('only a PAL disc in the zip : refused with the region reason and its serial', async () => {
  const pal = await discBytes({ serial: 'SCES_021.05' });
  const r = await resolveDisc(new File([makeZip([{ name: 'ctr-pal.bin', data: pal }])], 'pal.zip'), probeDisc);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'region');
  assert.match(r.message, /SCES_021\.05/);
});

test('no .bin in the zip (only a .cue and an .iso) : zip-no-bin', async () => {
  const r = await resolveDisc(new File([makeZip([{ name: 'a.cue', data: 'x' }, { name: 'a.iso', data: 'y' }])], 'x.zip'), probeDisc);
  assert.deepEqual([r.ok, r.reason], [false, 'zip-no-bin']);
});

test('a truncated archive : zip-truncated, nothing streamed', async () => {
  const disc = await discBytes({ sectors: 100, seed: 4 });
  const zip = makeZip([{ name: 'ctr.bin', data: disc }]);
  const r = await resolveDisc(new File([zip.slice(0, zip.length - 1000)], 'cut.zip'), probeDisc);
  assert.deepEqual([r.ok, r.reason], [false, 'zip-truncated']);
});

test('a damaged entry (CRC mismatch) : the stream errors at its end, so the copy is aborted', async () => {
  const disc = await discBytes({ sectors: 100, seed: 5 });
  const zip = new File([makeZip([{ name: 'ctr.bin', data: disc }], { badCrc: 'ctr.bin' })], 'bad.zip');
  const r = await resolveDisc(zip, probeDisc);
  assert.equal(r.ok, true); // the probe reads only the start
  await assert.rejects(drain(await r.open()), (e) => e.code === 'crc');
});

test('a plain .bin still goes through as before', async () => {
  const file = buildDisc();
  const r = await resolveDisc(file, probeDisc);
  assert.equal(r.kind, 'bin');
  assert.equal(sha(await drain(await r.open())), sha(new Uint8Array(await file.arrayBuffer())));
});
