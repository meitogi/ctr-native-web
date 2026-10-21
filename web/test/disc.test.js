// node --test web/test/disc.test.js
//
// Builds a minimal synthetic raw MODE2/2352 disc (PVD at LBA 16, a root
// directory at LBA 17 with one SYSTEM.CNF entry at LBA 18) entirely in
// memory and runs it through disc.js's probeDisc(), the same function the
// drop zone uses on a real ctr-u.bin. No DOM, no OPFS — just Node's global
// Blob/File (Node 20+) backing the byte slicing probeDisc() does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPECTED_SERIAL, checkRawSectorHeader, probeDisc } from '../disc.js';

const RAW_SECTOR_SIZE = 2352;
const FORM1_DATA_OFFSET = 24;
const SECTOR_COUNT = 20;
const ROOT_LBA = 17;
const CNF_LBA = 18;

function writeLE32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeAscii(bytes, offset, text) {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

function sectorHeader(bytes, lba) {
  const base = lba * RAW_SECTOR_SIZE;
  bytes[base] = 0x00;
  for (let i = 1; i < 11; i++) bytes[base + i] = 0xff;
  bytes[base + 11] = 0x00;
  bytes[base + 15] = 0x02;
}

function formDataOffset(lba) {
  return lba * RAW_SECTOR_SIZE + FORM1_DATA_OFFSET;
}

function writeDirRecord(bytes, offset, { lba, size, flags, name }) {
  const length = 33 + name.length;
  bytes[offset] = length;
  writeLE32(bytes, offset + 2, lba);
  writeLE32(bytes, offset + 10, size);
  bytes[offset + 25] = flags;
  bytes[offset + 32] = name.length;
  writeAscii(bytes, offset + 33, name);
  return length;
}

function buildDisc({ serial = EXPECTED_SERIAL, cnfText } = {}) {
  const bytes = new Uint8Array(SECTOR_COUNT * RAW_SECTOR_SIZE);
  for (const lba of [16, ROOT_LBA, CNF_LBA]) sectorHeader(bytes, lba);

  // PVD at LBA 16.
  const pvd = formDataOffset(16);
  bytes[pvd] = 1;
  writeAscii(bytes, pvd + 1, 'CD001');
  bytes[pvd + 6] = 1;
  writeDirRecord(bytes, pvd + 156, { lba: ROOT_LBA, size: 2048, flags: 0x02, name: '\0' });

  // Root directory at LBA 17: one entry, SYSTEM.CNF.
  const text = cnfText ?? `BOOT = cdrom:\\${serial};1\r\nTCB = 4\r\n`;
  const root = formDataOffset(ROOT_LBA);
  writeDirRecord(bytes, root, { lba: CNF_LBA, size: text.length, flags: 0x00, name: 'SYSTEM.CNF;1' });

  // SYSTEM.CNF data at LBA 18.
  writeAscii(bytes, formDataOffset(CNF_LBA), text);

  return new File([bytes], 'ctr-u.bin');
}

test('checkRawSectorHeader accepts a well-formed MODE2/2352 sync pattern', () => {
  const sector = new Uint8Array(RAW_SECTOR_SIZE);
  sector[11] = 0x00;
  sector[15] = 0x02;
  for (let i = 1; i < 11; i++) sector[i] = 0xff;
  assert.equal(checkRawSectorHeader(sector), true);
});

test('checkRawSectorHeader rejects a corrupt sync pattern', () => {
  const sector = new Uint8Array(RAW_SECTOR_SIZE);
  assert.equal(checkRawSectorHeader(sector), false);
});

test('probeDisc accepts a valid synthetic NTSC-U disc', async () => {
  const result = await probeDisc(buildDisc());
  assert.deepEqual(result, { ok: true, serial: EXPECTED_SERIAL });
});

test('probeDisc rejects a size that is not a multiple of 2352 (cooked .iso)', async () => {
  const file = buildDisc();
  const truncated = new File([await file.arrayBuffer().then((b) => b.slice(0, file.size - 1))], 'ctr.iso');
  const result = await probeDisc(truncated);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'size');
});

test('probeDisc rejects a bad raw-sector sync pattern', async () => {
  const buf = new Uint8Array(await buildDisc().arrayBuffer());
  buf[16 * RAW_SECTOR_SIZE] = 0xaa; // corrupt the PVD sector's sync byte
  const result = await probeDisc(new File([buf], 'ctr-u.bin'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'format');
});

test('probeDisc rejects a PAL serial', async () => {
  const result = await probeDisc(buildDisc({ serial: 'SCES_123.45' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'region');
  assert.match(result.message, /SCES_123\.45/);
});

test('probeDisc rejects a disc with no SYSTEM.CNF at the root', async () => {
  // A disc whose root entry name does not match SYSTEM.CNF at all.
  const bytes = new Uint8Array(await buildDisc().arrayBuffer());
  const root = formDataOffset(ROOT_LBA);
  writeDirRecord(bytes, root, { lba: CNF_LBA, size: 10, flags: 0x00, name: 'OTHER.TXT;1' });
  const probed = await probeDisc(new File([bytes], 'ctr-u.bin'));
  assert.equal(probed.ok, false);
  assert.equal(probed.reason, 'missing-system-cnf');
});
