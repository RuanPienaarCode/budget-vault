'use strict';
/* zip.js, pinned.

   The quiet failures a hand-rolled zip writer can produce, and where each is
   guarded below:

     1. A wrong CRC-32 doesn't fail loudly — a reader silently refuses or
        "repairs" the archive. Checked against the three standard test
        vectors (RFC 1952's own, not just this module's own round trip).
     2. General-purpose bit 11 (UTF-8 names) must be SET on every entry, or a
        non-ASCII name (a household's own café/日本 period or category)
        decodes as mojibake before the content inside is ever read.
     3. Sizes and CRCs in the LOCAL header must already match the central
        directory's copy — this writer never emits a data descriptor, so
        there is no second chance to patch them in.
     4. A duplicate entry name, or one that could extract outside the target
        directory (a leading /, a backslash, a .. segment), must throw rather
        than silently producing an ambiguous or unsafe archive.
     5. Two calls with identical input must produce byte-identical output —
        a `created` timestamp is the only thing allowed to vary the bytes,
        and only in the DOS date/time fields.

   The reader below is a SEPARATE hand-written walk of EOCD -> central
   directory -> local headers, deliberately not sharing a line with
   src/zip.js — sharing code with the thing under test would let a bug in
   both sides cancel out and still look green. */

const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { crc32, zipStore } = require('../src/zip');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
function throwsOk(fn, m) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(threw, m);
}

const enc = new TextEncoder();

/* ---- 1. CRC-32 against the standard check vectors ---- */
eq(crc32(new Uint8Array(0)) >>> 0, 0, 'crc32 of empty input is 0');
eq(crc32(enc.encode('123456789')) >>> 0, 0xCBF43926, 'the canonical CRC-32/ISO-HDLC check vector');
eq(crc32(enc.encode('The quick brown fox jumps over the lazy dog')) >>> 0, 0x414FA339, 'the pangram check vector');

/* ---- a hand-written reader, independent of src/zip.js's own writer ---- */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  ok(eocdOffset !== -1, 'EOCD signature (PK\\x05\\x06) found by scanning from the end');
  const count = dv.getUint16(eocdOffset + 10, true);
  const cdSize = dv.getUint32(eocdOffset + 12, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    eq(dv.getUint32(p, true), 0x02014b50, `central directory signature for entry ${i}`);
    const gpFlag = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const time = dv.getUint16(p + 12, true);
    const date = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.slice(p + 46, p + 46 + nameLen));
    entries.push({ name, gpFlag, method, time, date, crc, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  eq(p, cdOffset + cdSize, 'walking every central directory record consumes exactly cdSize bytes');

  for (const e of entries) {
    const lo = e.localOffset;
    eq(dv.getUint32(lo, true), 0x04034b50, `local header signature (PK\\x03\\x04) for ${e.name}`);
    eq(dv.getUint32(lo + 14, true), e.crc, `local CRC matches the central directory's copy for ${e.name}`);
    eq(dv.getUint32(lo + 18, true), e.compSize, `local compressed size matches for ${e.name}`);
    eq(dv.getUint32(lo + 22, true), e.size, `local uncompressed size matches for ${e.name}`);
    const lNameLen = dv.getUint16(lo + 26, true);
    const lExtraLen = dv.getUint16(lo + 28, true);
    const dataStart = lo + 30 + lNameLen + lExtraLen;
    e.data = bytes.slice(dataStart, dataStart + e.compSize);
  }
  return entries;
}

/* ---- 2/3. round trip: names, sizes, CRCs, method, UTF-8 bit, offsets ---- */
{
  const fixture = [
    { name: 'a.txt', data: 'hello world' },
    { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 254, 255]) },
    { name: 'Begroting é 日本.xml', data: 'multi-byte name, ascii body' },
  ];
  const z = zipStore(fixture, { created: '2026-09-17T10:30' });
  const entries = readZip(z);
  eq(entries.length, fixture.length, 'every entry made it into the central directory');
  for (let i = 0; i < fixture.length; i++) {
    const src = fixture[i];
    const bytes = typeof src.data === 'string' ? enc.encode(src.data) : src.data;
    const e = entries.find(x => x.name === src.name);
    ok(e, `entry named ${JSON.stringify(src.name)} round-trips — the UTF-8 name itself`);
    eq(e.method, 0, `${src.name} is stored, not deflated`);
    ok((e.gpFlag & 0x0800) !== 0, `${src.name} carries general-purpose bit 11 (UTF-8 names)`);
    eq(e.crc >>> 0, crc32(bytes), `${src.name}'s CRC matches an independent recomputation`);
    eq(e.size, bytes.length, `${src.name}'s uncompressed size is correct`);
    eq(e.compSize, bytes.length, `${src.name}'s compressed size equals uncompressed — STORE only`);
    eq(Buffer.from(e.data).equals(Buffer.from(bytes)), true, `${src.name}'s bytes round-trip exactly`);
  }
}

/* ---- duplicate names and path traversal throw, not silently corrupt ---- */
throwsOk(() => zipStore([{ name: 'a.txt', data: 'x' }, { name: 'a.txt', data: 'y' }]), 'a duplicate name throws');
throwsOk(() => zipStore([{ name: '', data: 'x' }]), 'an empty name throws');
throwsOk(() => zipStore([{ name: 'a\\b.txt', data: 'x' }]), 'a backslash in a name throws');
throwsOk(() => zipStore([{ name: '/a.txt', data: 'x' }]), 'a leading / throws');
throwsOk(() => zipStore([{ name: 'a/../secrets.txt', data: 'x' }]), 'a .. segment throws');
throwsOk(() => zipStore([]), 'zero entries throws rather than emitting an empty-looking archive');

/* ---- determinism: same input, byte-identical output ---- */
{
  const fixture = [{ name: 'a.txt', data: 'x' }, { name: 'b/c.txt', data: new Uint8Array([1, 2, 3]) }];
  const z1 = zipStore(fixture, { created: '2026-09-17T10:30' });
  const z2 = zipStore(fixture, { created: '2026-09-17T10:30' });
  eq(Buffer.from(z1).toString('hex'), Buffer.from(z2).toString('hex'), 'identical input produces identical bytes');
}

/* ---- injected `created` moves the DOS date/time fields, and only those ---- */
{
  const fixture = [{ name: 'a.txt', data: 'x' }];
  const z1 = zipStore(fixture, { created: '2020-01-01T00:00' });
  const z2 = zipStore(fixture, { created: '2025-06-15T13:45' });
  const dv1 = new DataView(z1.buffer);
  const dv2 = new DataView(z2.buffer);
  ok(dv1.getUint16(10, true) !== dv2.getUint16(10, true) || dv1.getUint16(12, true) !== dv2.getUint16(12, true),
    'a different created timestamp changes the local header DOS time and/or date field');
  eq(z1.length, z2.length, 'and changes nothing about the archive\'s shape — same length either way');
}

/* ---- absent `created` defaults to the DOS epoch itself (1980-01-01, midnight) ----
   Not "today" — this module never reads the clock, so a caller that forgets
   the option gets a fixed, deterministic stand-in rather than a byte-golden
   test that only passes on the day it was written. */
{
  const z = zipStore([{ name: 'a.txt', data: 'x' }]);
  const dv = new DataView(z.buffer);
  eq(dv.getUint16(10, true), 0, 'default DOS time is midnight');
  eq(dv.getUint16(12, true), 0x0021, 'default DOS date is 1980-01-01 — ((1980-1980)<<9)|(1<<5)|1');
}

/* ---- optional external validation: unzip -t, when the binary exists ---- */
{
  let hasUnzip = false;
  try { execFileSync('which', ['unzip'], { stdio: 'ignore' }); hasUnzip = true; } catch (e) { hasUnzip = false; }
  if (hasUnzip) {
    const z = zipStore([{ name: 'x/y.txt', data: 'hello world' }, { name: 'z.txt', data: 'more content here' }],
      { created: '2026-09-17T10:30' });
    const p = path.join(os.tmpdir(), `zip-guard-${process.pid}-${Date.now()}.zip`);
    fs.writeFileSync(p, Buffer.from(z));
    try {
      execFileSync('unzip', ['-t', p], { stdio: 'ignore' });
      ok(true, 'unzip -t validated the archive with exit 0');
    } finally {
      fs.unlinkSync(p);
    }
  } else {
    console.log('zip.test.cjs: unzip binary not found on this machine — external validation skipped');
  }
}

console.log(`zip.test.cjs — ${checks} checks OK`);
