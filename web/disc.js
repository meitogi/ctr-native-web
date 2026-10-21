// Disc validation and OPFS storage for the drop zone in index.html.
//
// Mirrors platform/native_disc_image.c's own read contract (same raw-sector
// sync-pattern check, same ISO9660 directory-record parsing) so a disc that
// passes validate() here is read the same way by the native code once it's
// handed a Blob at globalThis.__ctrDisc. Reads only the sectors it needs
// (the PVD, the root directory, SYSTEM.CNF) off the dropped File directly —
// slicing a Blob doesn't read bytes until .arrayBuffer() is called on the
// slice, so this never touches the rest of a 605 MB file.
//
// No bundler, no dependency — plain ES module, like web/net/.

export const DISC_FILE_NAME = 'ctr-u.bin';
export const EXPECTED_SERIAL = 'SCUS_944.26';

const RAW_SECTOR_SIZE = 2352;
const FORM1_DATA_OFFSET = 24;
const FORM1_DATA_SIZE = 2048;
const PVD_LBA = 16;
const PVD_ROOT_RECORD_OFFSET = 156;
const DIRECTORY_FLAG = 0x02;

export function checkRawSectorHeader(sector) {
  if (sector.length < 16 || sector[0] !== 0x00 || sector[11] !== 0x00 || sector[15] !== 0x02) return false;
  for (let i = 1; i < 11; i++) if (sector[i] !== 0xff) return false;
  return true;
}

function readAscii(bytes, offset, length) {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[offset + i]);
  return s;
}

function readLE32(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

export function parseDirRecord(bytes, offset, available) {
  if (available < 34) return null;
  const length = bytes[offset];
  if (length === 0 || length > available || length < 34) return null;
  const nameLen = bytes[offset + 32];
  if (nameLen + 33 > length) return null;
  return {
    length,
    lba: readLE32(bytes, offset + 2) >>> 0,
    size: readLE32(bytes, offset + 10) >>> 0,
    flags: bytes[offset + 25],
    name: bytes.subarray(offset + 33, offset + 33 + nameLen),
  };
}

function normalizeComponent(name) {
  let str = readAscii(name, 0, name.length).toUpperCase();
  str = str.replace(/ +$/, '');
  if (str.endsWith(';1')) str = str.slice(0, -2);
  return str;
}

export function nameEquals(record, component) {
  return normalizeComponent(record.name) === component.toUpperCase().replace(/;1$/i, '');
}

export function findInDirectory(dirBytes, component) {
  let offset = 0;
  while (offset < dirBytes.length) {
    const length = dirBytes[offset];
    if (length === 0) {
      offset = (offset + FORM1_DATA_SIZE) & ~(FORM1_DATA_SIZE - 1);
      continue;
    }
    if (length < 34 || offset + length > dirBytes.length) break;
    const record = parseDirRecord(dirBytes, offset, dirBytes.length - offset);
    if (record && nameEquals(record, component)) return record;
    offset += length;
  }
  return null;
}

function dataSectorCount(size) {
  return Math.ceil(size / FORM1_DATA_SIZE);
}

async function readRawSector(file, lba) {
  const buf = await file.slice(lba * RAW_SECTOR_SIZE, lba * RAW_SECTOR_SIZE + RAW_SECTOR_SIZE).arrayBuffer();
  return new Uint8Array(buf);
}

async function readDataSector(file, lba) {
  const raw = await readRawSector(file, lba);
  return raw.subarray(FORM1_DATA_OFFSET, FORM1_DATA_OFFSET + FORM1_DATA_SIZE);
}

async function readDirectoryBytes(file, dir) {
  const sectorCount = dataSectorCount(dir.size);
  const out = new Uint8Array(sectorCount * FORM1_DATA_SIZE);
  for (let i = 0; i < sectorCount; i++) {
    out.set(await readDataSector(file, dir.lba + i), i * FORM1_DATA_SIZE);
  }
  return out;
}

async function readFileBytes(file, entry) {
  const sectorCount = dataSectorCount(entry.size);
  const out = new Uint8Array(sectorCount * FORM1_DATA_SIZE);
  for (let i = 0; i < sectorCount; i++) {
    out.set(await readDataSector(file, entry.lba + i), i * FORM1_DATA_SIZE);
  }
  return out.subarray(0, entry.size);
}

// Reads only the PVD sector, the root directory's sectors, and the small
// SYSTEM.CNF file — never the rest of the disc.
export async function probeDisc(file) {
  if (!file.size || (file.size % RAW_SECTOR_SIZE) !== 0) {
    return { ok: false, reason: 'size', message: `${file.name || 'This file'} is ${file.size} bytes, not a multiple of ${RAW_SECTOR_SIZE} — looks like a cooked 2048-byte-sector .iso (or a truncated file), not a raw MODE2/2352 BIN.` };
  }

  const pvd = await readRawSector(file, PVD_LBA);
  if (!checkRawSectorHeader(pvd)) {
    return { ok: false, reason: 'format', message: 'This file does not look like a raw MODE2/2352 CD image (bad sector sync pattern).' };
  }
  const pvdData = pvd.subarray(FORM1_DATA_OFFSET, FORM1_DATA_OFFSET + FORM1_DATA_SIZE);
  if (pvdData[0] !== 1 || readAscii(pvdData, 1, 5) !== 'CD001' || pvdData[6] !== 1) {
    return { ok: false, reason: 'format', message: 'This file does not look like a raw MODE2/2352 CD image (no ISO9660 volume descriptor at sector 16).' };
  }

  const root = parseDirRecord(pvdData, PVD_ROOT_RECORD_OFFSET, FORM1_DATA_SIZE - PVD_ROOT_RECORD_OFFSET);
  if (!root) {
    return { ok: false, reason: 'format', message: 'This file does not look like a raw MODE2/2352 CD image (unreadable root directory record).' };
  }

  const rootBytes = await readDirectoryBytes(file, root);
  const systemCnf = findInDirectory(rootBytes, 'SYSTEM.CNF');
  if (!systemCnf || (systemCnf.flags & DIRECTORY_FLAG) !== 0) {
    return { ok: false, reason: 'missing-system-cnf', message: 'No SYSTEM.CNF at the disc root — this does not look like a PS1 disc image.' };
  }

  const cnfBytes = await readFileBytes(file, systemCnf);
  const cnfText = readAscii(cnfBytes, 0, cnfBytes.length);
  const match = /BOOT\s*=\s*cdrom:\\?([A-Za-z0-9_.]+);1/i.exec(cnfText);
  const serial = match ? match[1].toUpperCase() : null;
  if (serial !== EXPECTED_SERIAL) {
    return { ok: false, reason: 'region', message: serial ? `This disc's serial is ${serial} — only the NTSC-U release (${EXPECTED_SERIAL}) is supported.` : `Could not find a disc serial in SYSTEM.CNF — only the NTSC-U release (${EXPECTED_SERIAL}) is supported.` };
  }

  return { ok: true, serial };
}

async function opfsRoot() {
  return navigator.storage.getDirectory();
}

export async function findCachedDisc() {
  try {
    const root = await opfsRoot();
    const handle = await root.getFileHandle(DISC_FILE_NAME);
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function storeDisc(file, onProgress) {
  const root = await opfsRoot();
  const handle = await root.getFileHandle(DISC_FILE_NAME, { create: true });
  const writable = await handle.createWritable();
  const reader = file.stream().getReader();
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      written += value.byteLength;
      onProgress?.(written, file.size);
    }
  } catch (e) {
    await writable.abort(String(e));
    throw e;
  }
  await writable.close();
  return handle.getFile();
}

export async function forgetDisc() {
  const root = await opfsRoot();
  await root.removeEntry(DISC_FILE_NAME).catch(() => {});
}
