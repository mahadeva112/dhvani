/**
 * A zip written and read without holding its files in memory.
 *
 * JSZip reads every file into one ArrayBuffer and joins the whole zip into
 * another, so a project of a gigabyte or two (source media, review video, every
 * take, earlier Syncs' banks) fails with "Array buffer allocation failed".
 * Here a file goes into the zip as the Blob it is: only its checksum is worked
 * out, a slice at a time, and the zip is a Blob made of the headers and those
 * Blobs. Reading slices each file back out of the zip the same way.
 *
 * Files are stored as they are (method 0); a small text file can be deflated.
 * ZIP64 is written when a size or offset needs it, so the file opens in any
 * unzip tool and in JSZip (older Dhvani).
 */

const CHUNK = 16 * 1024 * 1024;
const MAX32 = 0xffffffff;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crcUpdate = (crc: number, bytes: Uint8Array) => {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
};

/** The CRC-32 of a Blob, read a slice at a time. */
export const crc32OfBlob = async (blob: Blob): Promise<number> => {
  let c = 0xffffffff;
  for (let at = 0; at < blob.size; at += CHUNK) c = crcUpdate(c, new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
  return (c ^ 0xffffffff) >>> 0;
};

const setU64 = (view: DataView, at: number, n: number) => {
  view.setUint32(at, n % 0x100000000, true);
  view.setUint32(at + 4, Math.floor(n / 0x100000000), true);
};
const getU64 = (view: DataView, at: number) => view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x100000000;

const dosTime = (d: Date) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

const pipeBlob = (blob: Blob, transform: { readable: ReadableStream; writable: WritableStream }) =>
  new Response(blob.stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).blob();

export interface ZipEntryIn {
  name: string;
  data: Blob;
  /** Deflate it (for text). Stored as it is when the browser can't. */
  deflate?: boolean;
}

/**
 * A zip of these files as one Blob. `zip64At` is the size or offset from which
 * ZIP64 fields are written (lower only to test them).
 */
export const writeZip = async (
  entries: ZipEntryIn[],
  { mimeType = 'application/zip', zip64At = MAX32, now = new Date() }: { mimeType?: string; zip64At?: number; now?: Date } = {}
): Promise<Blob> => {
  const { time, date } = dosTime(now);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let anyZip64 = false;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = await crc32OfBlob(entry.data);
    const size = entry.data.size;
    let method = 0;
    let body = entry.data;
    if (entry.deflate && typeof CompressionStream === 'function') {
      body = await pipeBlob(entry.data, new CompressionStream('deflate-raw'));
      method = 8;
    }
    const comp = body.size;
    const sizes64 = size >= zip64At || comp >= zip64At;
    const offset64 = offset >= zip64At;
    if (sizes64 || offset64) anyZip64 = true;
    const version = sizes64 || offset64 ? 45 : 20;

    const localExtra = sizes64 ? 20 : 0;
    const local = new Uint8Array(30 + name.length + localExtra);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, version, true);
    lv.setUint16(6, 0x0800, true); // names are UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, sizes64 ? MAX32 : comp, true);
    lv.setUint32(22, sizes64 ? MAX32 : size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, localExtra, true);
    local.set(name, 30);
    if (sizes64) {
      lv.setUint16(30 + name.length, 0x0001, true);
      lv.setUint16(32 + name.length, 16, true);
      setU64(lv, 34 + name.length, size);
      setU64(lv, 42 + name.length, comp);
    }
    parts.push(local, body);

    const fields64 = [...(sizes64 ? [size, comp] : []), ...(offset64 ? [offset] : [])];
    const centralExtra = fields64.length ? 4 + 8 * fields64.length : 0;
    const head = new Uint8Array(46 + name.length + centralExtra);
    const cv = new DataView(head.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, version, true);
    cv.setUint16(6, version, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, sizes64 ? MAX32 : comp, true);
    cv.setUint32(24, sizes64 ? MAX32 : size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, centralExtra, true);
    cv.setUint32(42, offset64 ? MAX32 : offset, true);
    head.set(name, 46);
    if (fields64.length) {
      const at = 46 + name.length;
      cv.setUint16(at, 0x0001, true);
      cv.setUint16(at + 2, 8 * fields64.length, true);
      fields64.forEach((n, i) => setU64(cv, at + 4 + 8 * i, n));
    }
    central.push(head);
    offset += local.length + comp;
  }

  const cdOffset = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  parts.push(...central);
  const needs64 = anyZip64 || entries.length >= 0xffff || cdOffset >= zip64At || cdSize >= zip64At;
  if (needs64) {
    const rec = new Uint8Array(56 + 20);
    const rv = new DataView(rec.buffer);
    rv.setUint32(0, 0x06064b50, true);
    setU64(rv, 4, 44);
    rv.setUint16(12, 45, true);
    rv.setUint16(14, 45, true);
    setU64(rv, 24, entries.length);
    setU64(rv, 32, entries.length);
    setU64(rv, 40, cdSize);
    setU64(rv, 48, cdOffset);
    rv.setUint32(56, 0x07064b50, true);
    setU64(rv, 64, cdOffset + cdSize);
    rv.setUint32(72, 1, true);
    parts.push(rec);
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, needs64 ? 0xffff : entries.length, true);
  ev.setUint16(10, needs64 ? 0xffff : entries.length, true);
  ev.setUint32(12, needs64 ? MAX32 : cdSize, true);
  ev.setUint32(16, needs64 ? MAX32 : cdOffset, true);
  parts.push(end);
  return new Blob(parts, { type: mimeType });
};

const readBytes = async (blob: Blob, start: number, end: number) => new DataView(await blob.slice(start, end).arrayBuffer());

const notAZip = () => new Error('Not a zip file.');

/**
 * The files in a zip, by name, each opened only when asked for: a stored file
 * is a slice of `zip`, a deflated one is inflated then.
 */
export const readZip = async (zip: Blob): Promise<Map<string, () => Promise<Blob>>> => {
  const tailStart = Math.max(0, zip.size - (0xffff + 22 + 20));
  const tail = await readBytes(zip, tailStart, zip.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw notAZip();
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const recAt = getU64(tail, eocd - 20 + 8);
    const rec = await readBytes(zip, recAt, recAt + 56);
    if (rec.byteLength < 56 || rec.getUint32(0, true) !== 0x06064b50) throw notAZip();
    count = getU64(rec, 32);
    cdSize = getU64(rec, 40);
    cdOffset = getU64(rec, 48);
  }
  if (cdOffset + cdSize > zip.size) throw notAZip();

  const cd = await readBytes(zip, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder();
  const files = new Map<string, () => Promise<Blob>>();
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > cd.byteLength || cd.getUint32(at, true) !== 0x02014b50) throw notAZip();
    const flags = cd.getUint16(at + 8, true);
    const method = cd.getUint16(at + 10, true);
    let comp = cd.getUint32(at + 20, true);
    let size = cd.getUint32(at + 24, true);
    const nameLen = cd.getUint16(at + 28, true);
    const extraLen = cd.getUint16(at + 30, true);
    const commentLen = cd.getUint16(at + 32, true);
    let local = cd.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + at + 46, nameLen));
    // ZIP64 extra: the 64-bit values, in order, for each field written as 0xFFFFFFFF.
    for (let e = at + 46 + nameLen; e + 4 <= at + 46 + nameLen + extraLen; ) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let f = e + 4;
        if (size === MAX32) (size = getU64(cd, f)), (f += 8);
        if (comp === MAX32) (comp = getU64(cd, f)), (f += 8);
        if (local === MAX32) local = getU64(cd, f);
      }
      e += 4 + len;
    }
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    files.set(name, async () => {
      if (flags & 1) throw new Error(`${name} is encrypted.`);
      const lh = await readBytes(zip, local, local + 30);
      if (lh.byteLength < 30 || lh.getUint32(0, true) !== 0x04034b50) throw notAZip();
      const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const data = zip.slice(start, start + comp);
      if (method === 0) return data;
      if (method === 8) return pipeBlob(data, new DecompressionStream('deflate-raw'));
      throw new Error(`${name} is packed in a way Dhvani can't read.`);
    });
  }
  return files;
};
