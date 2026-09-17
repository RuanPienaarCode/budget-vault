'use strict';
/* zip.js — a ZIP container with no dependency.

   A bundle already refused a PDF library for size (src/exporter.js's header:
   the smallest credible PDF engine is an 85% bundle increase to draw a
   table). An xlsx library is the same trade from the other direction —
   SheetJS's free build alone outweighs this entire plugin. A .xlsx file IS a
   ZIP of XML parts, so the one primitive this module owns — write a ZIP —
   is enough for xlsx.js and any future consumer that needs one.

   STORE method only, no DEFLATE. Compression would buy smaller files at the
   cost of an inflate/deflate implementation this repo would then have to own
   and trust on iOS WebKit, where CompressionStream does not exist before
   Safari 16.4 (this plugin's floor is 15.0 — see CLAUDE.md). A spreadsheet's
   XML is not large enough for that trade to be worth it.

   The quiet failures a hand-rolled zip writer can produce, each guarded by
   tests/zip.test.cjs:

     1. A wrong CRC-32 doesn't fail loudly — a reader silently refuses or
        "repairs" the archive, and nothing tells the user why their export
        looked fine and opened broken. Verified against the standard test
        vectors, not just round-tripped through this module's own reader.
     2. General-purpose bit 11 (UTF-8 names) has to be SET, or a reader falls
        back to CP437/Latin-1 for the entry name and a household's own
        non-ASCII period or category name (café, 日本) becomes mojibake in
        the filename before the content inside is ever read.
     3. Sizes and CRCs are written into the LOCAL header, not only the
        central directory — this module never emits a data descriptor, so
        both copies must already agree at write time; there is no "patch it
        in after" step to forget.
     4. A duplicate entry name is not just wasteful, it's ambiguous — which
        of two "xl/worksheets/sheet1.xml" a reader unpacks is undefined — so
        this throws rather than silently keeping whichever one won.
     5. A name starting with /, containing a backslash, or containing a ..
        segment could extract OUTSIDE the target directory. Every caller in
        this repo controls its own names today; rejecting these anyway means
        the next caller that doesn't gets a thrown error instead of a path
        traversal.
     6. No zip64: an archive over 4 GiB or with more than 65 535 entries
        throws rather than silently truncating a 32-bit offset field, which
        would produce a file that LOOKS valid and points a reader at the
        wrong bytes.

   Pure — no DOM, no Node API (Buffer, zlib, fs) — Uint8Array, DataView and
   TextEncoder only, all present on iOS 15 WebKit and Node 18+ alike. */

/* ---------------------------- CRC-32 ------------------------------------ */

/* The standard CRC-32/ISO-HDLC table (polynomial 0xEDB88320, reflected),
   the same algorithm zlib/gzip/PNG use — built once at module load rather
   than shipped as a 1024-byte literal, so there is nothing here to transcribe
   wrong. Cross-checked in tests/zip.test.cjs against the three canonical
   vectors (empty, "123456789", the fox pangram) precisely because a subtly
   wrong table still LOOKS like a CRC — every archive it produces disagrees
   with every other implementation and no error is ever thrown. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* -------------------------- name safety ---------------------------------- */

/* A backslash, a leading /, or a .. segment are each a way an entry name
   could resolve outside the folder a naive extractor creates for the
   archive — the zip-slip class of bug. Checked here even though nothing in
   this repo currently builds a name from anything but a fixed literal
   (xl/worksheets/sheet1.xml and the like): a public function that silently
   accepts a traversal name today is a trap for the next caller who builds
   one from a category or period name, not a defence against a threat that
   exists yet. */
function assertValidName(name, seen) {
  if (typeof name !== 'string' || name === '') {
    throw new Error(`zip entry name must be a non-empty string, got ${JSON.stringify(name)}`);
  }
  if (name.indexOf('\\') !== -1) {
    throw new Error(`zip entry name may not contain a backslash — zip paths are always / : ${name}`);
  }
  if (name.charAt(0) === '/') {
    throw new Error(`zip entry name may not start with / (that is an absolute path outside the archive): ${name}`);
  }
  const segments = name.split('/');
  if (segments.indexOf('..') !== -1) {
    throw new Error(`zip entry name may not contain a .. segment (path traversal): ${name}`);
  }
  if (seen.has(name)) {
    throw new Error(`duplicate zip entry name — which copy a reader unpacks is undefined: ${name}`);
  }
  seen.add(name);
}

/* --------------------------- DOS date/time -------------------------------- */

/* ZIP's local/central headers only ever carry an MS-DOS date/time (a 1980
   epoch, 2-second resolution) — there is no ISO field to put a real
   timestamp in. `created` is `opts.created`, never `Date.now()`: this module
   must be deterministic so a byte-golden test is possible, and the DOS
   epoch itself (1980-01-01, midnight) is the fixed stand-in for "no
   timestamp was given" rather than "today", which would make yesterday's
   golden bytes wrong for a reason that has nothing to do with a real bug. */
const CREATED_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function dosDateTime(created) {
  let y = 1980, mo = 1, d = 1, h = 0, mi = 0;
  if (created) {
    const m = CREATED_RE.exec(created);
    if (!m) throw new Error(`opts.created must look like YYYY-MM-DDTHH:MM, got ${JSON.stringify(created)}`);
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); h = Number(m[4]); mi = Number(m[5]);
  }
  // DOS date/time can only express 1980-2107; a year outside that range is
  // clamped rather than wrapped or truncated silently into a wrong year.
  const clampedYear = Math.min(Math.max(y, 1980), 2107) - 1980;
  const date = ((clampedYear & 0x7F) << 9) | ((mo & 0xF) << 5) | (d & 0x1F);
  // Seconds are dropped, not rounded to the nearest even second the DOS
  // format would otherwise want — opts.created never carries seconds
  // (YYYY-MM-DDTHH:MM), so there is nothing more precise to encode.
  const time = ((h & 0x1F) << 11) | ((mi & 0x3F) << 5);
  return { date, time };
}

/* ----------------------------- writer ------------------------------------ */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_NAME_BIT = 0x0800;
const VERSION_NEEDED = 20; // 2.0 — the oldest version that defines STORE plus long names

function zipStore(entries, opts) {
  opts = opts || {};
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('zipStore requires at least one entry — an empty archive is not a useful export');
  }
  if (entries.length > 0xFFFF) {
    // ZIP64 would be needed past 65 535 entries; not implemented (see header).
    throw new Error(`zipStore: ${entries.length} entries exceeds 65535 — zip64 is not implemented`);
  }

  const { date, time } = dosDateTime(opts.created);
  const enc = new TextEncoder();
  const seen = new Set();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry && entry.name;
    assertValidName(name, seen);
    const nameBytes = enc.encode(name);
    const data = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
    if (!(data instanceof Uint8Array)) {
      throw new Error(`zip entry "${name}" data must be a Uint8Array or a string, got ${typeof entry.data}`);
    }
    if (data.length > 0xFFFFFFFF || offset > 0xFFFFFFFF) {
      throw new Error(`zip entry "${name}" pushes the archive past 4 GiB — zip64 is not implemented`);
    }

    const crc = crc32(data);
    const localOffset = offset;

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, VERSION_NEEDED, true);
    lv.setUint16(6, UTF8_NAME_BIT, true);
    lv.setUint16(8, 0, true); // method: store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size == uncompressed, store only
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra field length

    chunks.push(local, nameBytes, data);
    offset += local.length + nameBytes.length + data.length;
    central.push({ nameBytes, crc, size: data.length, localOffset });
  }

  const centralStart = offset;
  for (const c of central) {
    const rec = new Uint8Array(46);
    const cv = new DataView(rec.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, VERSION_NEEDED, true); // version made by
    cv.setUint16(6, VERSION_NEEDED, true); // version needed to extract
    cv.setUint16(8, UTF8_NAME_BIT, true);
    cv.setUint16(10, 0, true); // method
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, c.crc, true);
    cv.setUint32(20, c.size, true);
    cv.setUint32(24, c.size, true);
    cv.setUint16(28, c.nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra field length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, c.localOffset, true);

    chunks.push(rec, c.nameBytes);
    offset += rec.length + c.nameBytes.length;
  }
  const centralSize = offset - centralStart;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // this disk
  ev.setUint16(6, 0, true); // disk with central directory start
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true); // comment length
  chunks.push(eocd);
  offset += eocd.length;

  const out = new Uint8Array(offset);
  let p = 0;
  for (const chunk of chunks) { out.set(chunk, p); p += chunk.length; }
  return out;
}

module.exports = { crc32, zipStore };
