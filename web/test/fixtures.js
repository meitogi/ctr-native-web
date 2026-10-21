// Test fixtures shared by the node tests : a synthetic raw MODE2/2352 NTSC-U disc (PVD at LBA 16,
// a root directory at LBA 17 with one SYSTEM.CNF entry at LBA 18 — what web/disc.js probeDisc
// reads), optionally padded with pseudo-random sectors so a compressed copy is not trivial, and
// zip archives built in memory (stored / deflated, zip64 records on demand). Never a real disc.
import { deflateRawSync } from 'node:zlib';
import { EXPECTED_SERIAL } from '../disc.js';

export { EXPECTED_SERIAL };
const RAW_SECTOR_SIZE = 2352;
const FORM1_DATA_OFFSET = 24;
const SECTOR_COUNT = 20;
export const ROOT_LBA = 17;
export const CNF_LBA = 18;

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

export function formDataOffset(lba) {
  return lba * RAW_SECTOR_SIZE + FORM1_DATA_OFFSET;
}

export function writeDirRecord(bytes, offset, { lba, size, flags, name }) {
  const length = 33 + name.length;
  bytes[offset] = length;
  writeLE32(bytes, offset + 2, lba);
  writeLE32(bytes, offset + 10, size);
  bytes[offset + 25] = flags;
  bytes[offset + 32] = name.length;
  writeAscii(bytes, offset + 33, name);
  return length;
}

export function buildDisc({ serial = EXPECTED_SERIAL, cnfText, sectors = SECTOR_COUNT, seed = 0, name = 'ctr-u.bin' } = {}) {
  const bytes = new Uint8Array(sectors * RAW_SECTOR_SIZE);
  if (seed) fillRandom(bytes, 19 * RAW_SECTOR_SIZE, seed);
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

  return new File([bytes], name);
}

// xorshift32 : the same bytes for the same seed, half-compressible (every other byte is a
// small value) so deflate has work to do without the archive being as big as the disc
function fillRandom(bytes, from, seed) {
  let x = seed >>> 0 || 1;
  for (let i = from; i < bytes.length; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    bytes[i] = i & 1 ? x & 0xff : x & 0x0f;
  }
}

function crc32(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

/**
 * A zip archive in memory.
 * @param {Array<{name: string, data: Uint8Array|string, method?: 0|8}>} entries
 * @param {{zip64?: boolean, comment?: string, badCrc?: string}} options - zip64 : sizes and
 *   offsets go in zip64 extra fields and records (0xffffffff in the 32-bit slots) ; badCrc : the
 *   entry name whose recorded CRC is wrong.
 * @returns {Uint8Array}
 */
export function makeZip(entries, { zip64 = false, comment = '', badCrc } = {}) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
    const name = enc.encode(e.name);
    let crc = crc32(data);
    if (badCrc === e.name) crc = (crc ^ 0xdeadbeef) >>> 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, zip64 ? 45 : 20, true);
    local.setUint16(6, 0x800, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, zip64 ? 0xffffffff : body.length, true);
    local.setUint32(22, zip64 ? 0xffffffff : data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const extra = zip64 ? new DataView(new ArrayBuffer(28)) : null;
    if (extra) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(data.length), true);
      extra.setBigUint64(12, BigInt(body.length), true);
      extra.setBigUint64(20, BigInt(offset), true);
    }
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 0x031e, true);
    cd.setUint16(6, zip64 ? 45 : 20, true);
    cd.setUint16(8, 0x800, true);
    cd.setUint16(10, method, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, zip64 ? 0xffffffff : body.length, true);
    cd.setUint32(24, zip64 ? 0xffffffff : data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, extra ? 28 : 0, true);
    cd.setUint32(42, zip64 ? 0xffffffff : offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    if (extra) central.push(new Uint8Array(extra.buffer));
    offset += 30 + name.length + body.length;
  }
  const cdBytes = concat(central);
  const cdOffset = offset;
  const tail = [];
  if (zip64) {
    const rec = new DataView(new ArrayBuffer(56));
    rec.setUint32(0, 0x06064b50, true);
    rec.setBigUint64(4, 44n, true);
    rec.setUint16(12, 45, true);
    rec.setUint16(14, 45, true);
    rec.setBigUint64(24, BigInt(entries.length), true);
    rec.setBigUint64(32, BigInt(entries.length), true);
    rec.setBigUint64(40, BigInt(cdBytes.length), true);
    rec.setBigUint64(48, BigInt(cdOffset), true);
    const loc = new DataView(new ArrayBuffer(20));
    loc.setUint32(0, 0x07064b50, true);
    loc.setBigUint64(8, BigInt(cdOffset + cdBytes.length), true);
    loc.setUint32(16, 1, true);
    tail.push(new Uint8Array(rec.buffer), new Uint8Array(loc.buffer));
  }
  const commentBytes = enc.encode(comment);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, zip64 ? 0xffff : entries.length, true);
  eocd.setUint16(10, zip64 ? 0xffff : entries.length, true);
  eocd.setUint32(12, zip64 ? 0xffffffff : cdBytes.length, true);
  eocd.setUint32(16, zip64 ? 0xffffffff : cdOffset, true);
  eocd.setUint16(20, commentBytes.length, true);
  return concat([...parts, cdBytes, ...tail, new Uint8Array(eocd.buffer), commentBytes]);
}

export function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
