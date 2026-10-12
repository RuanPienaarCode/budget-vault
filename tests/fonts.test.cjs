'use strict';
/* THE BUNDLED TYPEFACE: GENERATED, CURRENT, TRUE TO ITS FILE, AND CREDITED.

   The October 2026 statement-type redesign ships one variable font (Geist) inside
   styles.css as a base64 data URI (scripts/fonts.cjs writes src/styles-fonts.css
   from the woff2 file in assets/fonts/). Four promises are pinned here:

     1. THE GENERATED SHEET IS CURRENT. Like the palette blocks
        (tests/palette.test.cjs, "the generated stylesheet on disk is current"),
        the committed file must equal what the generator writes now, so a changed
        woff2 or a hand-edit to the generated file fails instead of shipping, and
        the scorecard's clean `npm ci && npm run build` reproduces it.
     2. THE EMBEDDED BYTES ARE THE FILE. The data URI decodes to exactly the
        woff2 under assets/fonts/ (and starts with the woff2 magic), so a
        truncated or re-encoded blob cannot pass as current.
     3. THE DECLARED RANGE IS THE FONT'S OWN AXIS. font-weight is a descriptor
        the engine trusts: a range wider than the file makes it
        synthesise weights the font cannot draw, a narrower one hides real ones.
        It is compared against the fvar table inside the woff2 (read here
        with Node's own brotli; no font library).
     4. THEY ARE CREDITED. NOTICE names the font, its licence (SIL OFL 1.1),
        its copyright line (taken from the OFL file, not retyped), and where
        the file lives. The OFL requires the notice to travel with the font.

   Pure node. node tests/fonts.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const bytes = rel => fs.readFileSync(path.join(ROOT, rel));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const { generate, FONTS, OUT } = require('../scripts/fonts.cjs');

/* ---- 1. the generated stylesheet on disk is current ---- */
eq(path.relative(ROOT, OUT), path.join('src', 'styles-fonts.css'), 'the generator writes src/styles-fonts.css');
const onDisk = read('src/styles-fonts.css');
ok(onDisk === generate(), 'src/styles-fonts.css matches assets/fonts/ — run `npm run build` (or `npm run fonts`) and commit');
ok(onDisk.endsWith('\n'), 'the generated sheet ends with a newline (the assembly concatenates without a separator)');
ok(/^\/\* =+\n\s+GENERATED FILE — do not edit\./.test(onDisk), 'its first line says it is generated');

/* ---- 2. the family, the descriptors, and the embedded bytes ---- */
const faces = [...onDisk.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]);
eq(faces.length, 1, 'exactly one @font-face block');
const prop = (block, name) => (block.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1];

eq(faces.map(f => prop(f, 'font-family')), ["'BV Geist'"], 'the family is BV Geist (never the font\'s own name, so an installed copy cannot shadow it)');
for (const f of faces) {
  eq(prop(f, 'font-display'), 'swap', 'font-display: swap — text is never invisible while the face decodes');
  eq(prop(f, 'font-style'), 'normal', 'normal style only');
  ok(/format\("woff2"\)/.test(f), 'the src declares format("woff2")');
}
eq(prop(faces[0], 'font-stretch'), undefined, 'Geist has no width axis and declares no font-stretch');

for (let i = 0; i < FONTS.length; i++) {
  const uri = faces[i].match(/url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/);
  ok(uri, `${FONTS[i].family}: src is a base64 woff2 data URI`);
  const embedded = Buffer.from(uri[1], 'base64');
  const file = bytes(FONTS[i].file);
  ok(embedded.equals(file), `${FONTS[i].family}: the data URI decodes to exactly ${FONTS[i].file}`);
  eq(embedded.subarray(0, 4).toString('latin1'), 'wOF2', `${FONTS[i].family}: the file is a real woff2`);
}

/* ---- 3. the declared range is the font's own axis ---- */
/* A woff2 is a header, a table directory, and ONE brotli stream holding every
   table back to back. fvar is never transformed, so after decompressing, its
   bytes sit at the sum of the lengths of the tables before it. */
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB',
  'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar',
  'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf',
  'Glat', 'Gloc', 'Feat', 'Sill'];
function uint128(b, o) {
  let v = 0;
  for (let i = 0; i < 5; i++) { const c = b[o + i]; v = v * 128 + (c & 127); if (!(c & 128)) return [v, o + i + 1]; }
  throw new Error('bad UIntBase128');
}
function axesOf(buf) {
  const n = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  let o = 48;
  const tables = [];
  for (let i = 0; i < n; i++) {
    const flags = buf[o++], idx = flags & 63, xform = (flags >> 6) & 3;
    let tag;
    if (idx === 63) { tag = buf.toString('latin1', o, o + 4); o += 4; } else tag = KNOWN[idx];
    let len;
    [len, o] = uint128(buf, o);
    const transformed = (tag === 'glyf' || tag === 'loca') ? xform === 0 : xform !== 0;
    if (transformed) [len, o] = uint128(buf, o);
    tables.push({ tag, len });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(o, o + compressed));
  let at = 0;
  for (const t of tables) { if (t.tag === 'fvar') break; at += t.len; }
  const fvar = data.subarray(at);
  const off = fvar.readUInt16BE(4), count = fvar.readUInt16BE(8), size = fvar.readUInt16BE(10);
  const axes = {};
  for (let i = 0; i < count; i++) {
    const a = off + i * size;
    axes[fvar.toString('latin1', a, a + 4)] = [fvar.readInt32BE(a + 4) / 65536, fvar.readInt32BE(a + 12) / 65536];
  }
  return axes;
}
const range = (axes, tag) => axes[tag] ? `${axes[tag][0]} ${axes[tag][1]}` : undefined;
const geist = axesOf(bytes(FONTS[0].file));
eq(prop(faces[0], 'font-weight'), range(geist, 'wght'), 'Geist: font-weight is the wght axis of the file');
ok(!geist.wdth, 'Geist has no wdth axis, matching its descriptor-free face');

/* ---- 4. credited in NOTICE, licence text beside the file ---- */
const notice = read('NOTICE');
ok(/\bGeist\b/.test(notice), 'NOTICE names the font');
ok(/SIL Open Font License,? (Version )?1\.1/i.test(notice), 'NOTICE names the licence (SIL OFL 1.1)');
ok(/assets\/fonts\//.test(notice), 'NOTICE says where the font file and licence text live');
{
  const file = 'assets/fonts/OFL-Geist.txt';
  const copyright = read(file).split('\n')[0].trim();
  ok(/^Copyright /.test(copyright), 'Geist: the OFL text opens with its copyright line');
  ok(notice.includes(copyright), `NOTICE repeats Geist's copyright line verbatim: ${copyright.slice(0, 60)}…`);
  ok(/SIL OPEN FONT LICENSE Version 1\.1/.test(read(file)), `Geist: the full OFL 1.1 text is kept in ${file}`);
}

/* ---- the shipped stylesheet carries the face ---- */
const built = read('styles.css');
ok(built.startsWith(onDisk), 'root styles.css begins with the generated font (they come first in the assembly)');

console.log(`PASS fonts — generated sheet current, ${FONTS.length} face matches its file and axis, credited in NOTICE (${checks} checks)`);
