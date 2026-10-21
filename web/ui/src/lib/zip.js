// A .zip read in the browser with the platform only : the central directory through Blob.slice()
// (a 605 MB archive is never read whole), zip64 records, entries stored or deflated, deflate
// through DecompressionStream('deflate-raw'), CRC-32 and size checked while the bytes stream by.
// No dependency. Encrypted entries and other methods are refused with a code.
//
// Format : PKWARE APPNOTE.TXT 6.3.10 — 4.3.16 end of central directory, 4.3.14 / 4.3.15 zip64
// end of central directory record / locator, 4.3.12 central directory header, 4.3.7 local file
// header, 4.5.3 zip64 extended information extra field.

export class ZipError extends Error {
  constructor(code, message) {
    super(message ?? code)
    this.code = code
  }
}

const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff

async function bytesAt(blob, start, end) {
  if (start < 0 || end > blob.size || start > end) throw new ZipError('truncated', 'The archive is cut short.')
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

const u64 = (view, off) => Number(view.getBigUint64(off, true))

/**
 * The entries of a zip archive, from its central directory.
 * @param {Blob} blob
 * @returns {Promise<Array<{name: string, method: number, flags: number, crc: number, compressedSize: number, size: number, localOffset: number, directory: boolean, encrypted: boolean}>>}
 */
export async function readZipDirectory(blob) {
  const size = blob.size
  if (size < EOCD_MIN) throw new ZipError('not-zip', 'Not a zip archive.')
  const tailStart = Math.max(0, size - EOCD_MIN - MAX_COMMENT - 20)
  const tail = await bytesAt(blob, tailStart, size)
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_EOCD && i + EOCD_MIN + tv.getUint16(i + 20, true) <= tail.length) { eocd = i; break }
  }
  if (eocd < 0) {
    const head = await bytesAt(blob, 0, 4)
    const local = new DataView(head.buffer).getUint32(0, true) === SIG_LOCAL
    throw new ZipError(local ? 'truncated' : 'not-zip', local ? 'The archive is cut short (no end of central directory).' : 'Not a zip archive.')
  }
  const disk = tv.getUint16(eocd + 4, true)
  let count = tv.getUint16(eocd + 10, true)
  let cdSize = tv.getUint32(eocd + 12, true)
  let cdOffset = tv.getUint32(eocd + 16, true)

  const loc = eocd - 20
  if (loc >= 0 && tv.getUint32(loc, true) === SIG_ZIP64_LOCATOR) {
    const recOffset = u64(tv, loc + 8)
    const rec = await bytesAt(blob, recOffset, recOffset + 56)
    const rv = new DataView(rec.buffer)
    if (rv.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipError('truncated', 'Damaged zip64 record.')
    count = u64(rv, 32)
    cdSize = u64(rv, 40)
    cdOffset = u64(rv, 48)
  } else if (disk !== 0) {
    throw new ZipError('multi-disk', 'Split (multi-part) archives are not supported.')
  }
  if (cdOffset + cdSize > size) throw new ZipError('truncated', 'The archive is cut short (central directory past the end).')

  const cd = await bytesAt(blob, cdOffset, cdOffset + cdSize)
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const utf8 = new TextDecoder('utf-8')
  const latin1 = new TextDecoder('latin1')
  const entries = []
  let p = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('truncated', 'Damaged central directory.')
    const flags = cv.getUint16(p + 8, true)
    const method = cv.getUint16(p + 10, true)
    const crc = cv.getUint32(p + 16, true)
    let compressedSize = cv.getUint32(p + 20, true)
    let fileSize = cv.getUint32(p + 24, true)
    const nameLen = cv.getUint16(p + 28, true)
    const extraLen = cv.getUint16(p + 30, true)
    const commentLen = cv.getUint16(p + 32, true)
    let localOffset = cv.getUint32(p + 42, true)
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen)
    const name = (flags & 0x800 ? utf8 : latin1).decode(nameBytes)
    // zip64 extended information : only the fields whose 32-bit value is 0xffffffff, in order
    let e = p + 46 + nameLen
    const extraEnd = e + extraLen
    while (e + 4 <= extraEnd) {
      const id = cv.getUint16(e, true)
      const len = cv.getUint16(e + 2, true)
      if (id === 0x0001) {
        let f = e + 4
        if (fileSize === 0xffffffff) { fileSize = u64(cv, f); f += 8 }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cv, f); f += 8 }
        if (localOffset === 0xffffffff) { localOffset = u64(cv, f); f += 8 }
      }
      e += 4 + len
    }
    entries.push({
      name, method, flags, crc, compressedSize, size: fileSize, localOffset,
      directory: name.endsWith('/'),
      encrypted: (flags & 0x1) !== 0,
    })
    p = extraEnd + commentLen
  }
  return entries
}

/** Where an entry's data starts (after its local header). */
async function dataOffset(blob, entry) {
  const head = await bytesAt(blob, entry.localOffset, entry.localOffset + 30)
  const hv = new DataView(head.buffer)
  if (hv.getUint32(0, true) !== SIG_LOCAL) throw new ZipError('truncated', 'Damaged local header.')
  const start = entry.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true)
  if (start + entry.compressedSize > blob.size) throw new ZipError('truncated', 'The archive is cut short.')
  return start
}

function checkSupported(entry) {
  if (entry.encrypted) throw new ZipError('encrypted', `${entry.name} is encrypted.`)
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError('method', `${entry.name} uses compression method ${entry.method} (only stored and deflate are supported).`)
}

// CRC-32 (IEEE 802.3, reflected 0xEDB88320), slicing by 4.
const T = (() => {
  const t = new Int32Array(1024)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  for (let n = 0; n < 256; n++) {
    for (let s = 1; s < 4; s++) t[s * 256 + n] = t[(s - 1) * 256 + n] >>> 8 ^ t[t[(s - 1) * 256 + n] & 0xff]
  }
  return t
})()

/** Updates a running CRC-32 (start with 0) with `bytes`. */
export function crc32(crc, bytes) {
  let c = ~crc
  let i = 0
  const n = bytes.length
  for (; i + 4 <= n; i += 4) {
    c ^= bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24
    c = T[768 + (c & 0xff)] ^ T[512 + (c >>> 8 & 0xff)] ^ T[256 + (c >>> 16 & 0xff)] ^ T[c >>> 24]
  }
  for (; i < n; i++) c = T[(c ^ bytes[i]) & 0xff] ^ c >>> 8
  return ~c >>> 0
}

/**
 * The uncompressed bytes of an entry as a stream. With `check` (the default) the stream errors
 * with ZipError 'crc' / 'size' at its end when the bytes do not match the central directory.
 * @returns {Promise<ReadableStream<Uint8Array>>}
 */
export async function openEntry(blob, entry, { check = true } = {}) {
  checkSupported(entry)
  const start = await dataOffset(blob, entry)
  let stream = blob.slice(start, start + entry.compressedSize).stream()
  if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'))
  if (!check) return stream
  let crc = 0
  let length = 0
  return stream.pipeThrough(new TransformStream({
    transform(chunk, ctl) {
      crc = crc32(crc, chunk)
      length += chunk.byteLength
      if (length > entry.size) throw new ZipError('size', `${entry.name} is larger than the archive says.`)
      ctl.enqueue(chunk)
    },
    flush() {
      if (length !== entry.size) throw new ZipError('size', `${entry.name} : ${length} bytes, the archive says ${entry.size}.`)
      if (crc !== entry.crc) throw new ZipError('crc', `${entry.name} is damaged (CRC-32 ${crc.toString(16)} ≠ ${entry.crc.toString(16)}).`)
    },
  }))
}

/**
 * A Blob-like view of an entry for random reads near its start (`size`, `name`,
 * `slice(a, b).arrayBuffer()`), what web/disc.js's probeDisc needs. Stored entries are real Blob
 * slices ; deflated ones are decompressed from the start as far as a read asks, up to `limit`.
 */
export async function entryView(blob, entry, { limit = 16 << 20 } = {}) {
  checkSupported(entry)
  const name = entry.name.split('/').pop()
  if (entry.method === 0) {
    const start = await dataOffset(blob, entry)
    return Object.assign(blob.slice(start, start + entry.size), { name })
  }
  const reader = (await openEntry(blob, entry, { check: false })).getReader()
  let buf = new Uint8Array(0)
  let done = false
  const fill = async (end) => {
    if (end > limit) throw new ZipError('probe', `Reading ${end} bytes into ${name} to check it is more than allowed (${limit}).`)
    while (buf.length < end && !done) {
      const r = await reader.read()
      if (r.done) { done = true; break }
      const next = new Uint8Array(buf.length + r.value.length)
      next.set(buf)
      next.set(r.value, buf.length)
      buf = next
    }
  }
  return {
    name,
    size: entry.size,
    slice(a = 0, b = entry.size) {
      return {
        async arrayBuffer() {
          await fill(Math.min(b, entry.size))
          return buf.slice(a, Math.min(b, buf.length)).buffer
        },
      }
    },
    close: () => reader.cancel().catch(() => {}),
  }
}
