'use strict';
/* pdf.js assembles a file in CHUNKS, and the bytes it writes did not move.

   2026-10-07 audit, L5-04. Both PDF backends built every byte of the file
   through a plain JS array — `bytes(arr) { for (…) this._b.push(arr[i]) }`,
   then `new Uint8Array(this._b)` at the end. For the vector path that is a
   few kilobytes and harmless. For the RASTER path (a category in Chinese,
   Devanagari, an emoji — any text Helvetica cannot draw) every page is a
   ~500 KB JPEG, and every byte of every JPEG went through `push()`: measured
   in macOS JavaScriptCore at ~21-26 bytes of resident memory per PDF byte,
   so a 60-page export (~30 MB) needed roughly 630-760 MB transient. The
   2 GB iPhones that stop at iOS 15 are the floor population, and a WebView
   killed for memory reloads with nothing written and nothing said.

   Pinned two ways:

     1. THE BYTES DID NOT MOVE. A fixed five-page vector document (accents,
        escapes, an en dash in the body, a landscape page, a pagebreak) and a
        fixed three-image raster document hash to exactly what the
        byte-at-a-time writer of release 1.49.1 produced. A golden digest,
        because "byte-identical" is the claim and anything weaker would let
        an offset drift through. Both documents use an ASCII title and no
        `utcOffset`, the two inputs later fixes deliberately re-encode.
     2. THE MEMORY IS BOUNDED BY THE PAYLOAD, not by twenty times it. A child
        process with a 64 MB JavaScript heap assembles a raster PDF of 24 one-
        megabyte pages. A typed-array chunk lives outside V8's old space, so
        the chunked writer finishes; the old writer needed ~190 MB of JS-heap
        array for the same file and dies with "heap out of memory". The child
        is a real Node process, not a model of one.

   No real data: the "JPEGs" are synthetic byte runs between SOI and EOI
   markers — pdf.js never decodes them, it copies them.

     node tests/pdf-byte-assembly.test.cjs */

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { PAGE, layoutDocument, helveticaMeasure, renderVectorPdf, renderImagePdf } = require('../src/pdf');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const sha = b => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');

/* ---- 1. golden digests: the chunked writer reproduces the old writer exactly ---- */
const doc = {
  title: 'Budget summary June 2026 to July 2026',
  subtitle: 'June 2026 to July 2026 · Generated 2026-07-15 09:30',
  footer: 'Budget summary · June 2026 to July 2026',
  blocks: [
    { type: 'note', text: 'Only these categories are included: Café (Main), Rent \\ Levies. Totals cover the listed categories, not the whole budget.' },
    { type: 'heading', text: 'Summary by category' },
    { type: 'table', head: ['Category', 'June 2026', 'July 2026', 'Total', 'Average', 'Budgeted'],
      align: ['left', 'right', 'right', 'right', 'right', 'right'], boldRows: [3],
      rows: Array.from({ length: 70 }, (_, i) => [`Category ${i} — naïve (${i % 7})`, `${(i * 37.5).toFixed(2)}`, `${(i * 12.25).toFixed(2)}`, `${(i * 49.75).toFixed(2)}`, `${(i * 24.875).toFixed(2)}`, `${(i * 50).toFixed(2)}`]) },
    { type: 'pagebreak' },
    { type: 'heading', text: 'July 2026 · Jun 23 – Jul 22, 2026' },
    { type: 'note', text: 'Income R 31 000,00 · Spent R 15 400,00' },
    { type: 'table', head: ['Category', 'Type', 'Budget', 'Actual', 'Remaining', 'Used'],
      align: ['left', 'left', 'right', 'right', 'right', 'right'], boldRows: [],
      rows: [['Groceries', 'expense', 'R 6 000,00', 'R 6 400,00', 'R -400,00', '107%'], ['=Rent', 'expense', 'R 9 000,00', 'R 9 000,00', 'R 0,00', '100%']] },
  ],
};
{
  const pages = layoutDocument(doc, { measure: helveticaMeasure, page: PAGE.A4_LANDSCAPE });
  eq(pages.length, 5, 'the fixed document lays out on five pages, as it did under 1.49.1');
  const vec = renderVectorPdf(pages, { meta: { title: doc.title, created: '2026-07-15T09:30', producer: 'Budget Vault' } });
  ok(vec instanceof Uint8Array, 'the vector writer returns a Uint8Array');
  eq(vec.length, 28366, 'vector PDF: the same length as the byte-at-a-time writer');
  eq(sha(vec), '9d01437e9a801c8bca7caa57ed30d545f0df5515278d31dfd5f1f8d761314d0c', 'vector PDF: byte-identical to the 1.49.1 writer (sha256)');
}
{
  const jpeg = (n, salt) => {
    const a = new Uint8Array(n);
    a[0] = 0xff; a[1] = 0xd8;
    for (let i = 2; i < n - 2; i++) a[i] = (i * 31 + salt) & 0xff;
    a[n - 2] = 0xff; a[n - 1] = 0xd9;
    return a;
  };
  const ras = renderImagePdf([
    { jpeg: jpeg(5000, 1), width: 1191, height: 1684 },
    { jpeg: jpeg(7001, 2), width: 1191, height: 1684 },
    { jpeg: jpeg(3, 3), width: 10, height: 10 },
  ], { page: PAGE.A4, meta: { title: 'Budget summary June 2026 to July 2026', created: '2026-07-15T09:30', producer: 'Budget Vault' } });
  ok(ras instanceof Uint8Array, 'the raster writer returns a Uint8Array');
  eq(ras.length, 13778, 'raster PDF: the same length as the byte-at-a-time writer');
  eq(sha(ras), '4858b03429300cfbadacebef503a56e93912e90b4ce494c481d7d4225b9f0ea5', 'raster PDF: byte-identical to the 1.49.1 writer (sha256)');
  // A plain number array is still accepted where a Uint8Array is expected (renderImagePdf's own contract).
  const fromArray = renderImagePdf([{ jpeg: Array.from(jpeg(5000, 1)), width: 1191, height: 1684 }], { page: PAGE.A4, meta: { title: 'x', created: '2026-07-15T09:30' } });
  const fromTyped = renderImagePdf([{ jpeg: jpeg(5000, 1), width: 1191, height: 1684 }], { page: PAGE.A4, meta: { title: 'x', created: '2026-07-15T09:30' } });
  eq(sha(fromArray), sha(fromTyped), 'a JPEG handed over as a plain array writes the same bytes as one handed over typed');
}

/* ---- 2. a 24 MB raster PDF assembles inside a 64 MB JS heap ---- */
{
  const src = JSON.stringify(path.join(__dirname, '..', 'src', 'pdf.js'));
  const child = `
    const { PAGE, renderImagePdf } = require(${src});
    const MB = 1024 * 1024, N = 24;
    const images = [];
    for (let p = 0; p < N; p++) {
      const a = new Uint8Array(MB);
      a[0] = 0xff; a[1] = 0xd8; a[MB - 2] = 0xff; a[MB - 1] = 0xd9;
      for (let i = 2; i < MB - 2; i += 4096) a[i] = (i + p) & 0xff;
      images.push({ jpeg: a, width: 1191, height: 1684 });
    }
    const out = renderImagePdf(images, { page: PAGE.A4, meta: { title: 'Large', created: '2026-07-15T09:30' } });
    const head = String.fromCharCode(...out.subarray(0, 8));
    const tail = String.fromCharCode(...out.subarray(out.length - 5));
    process.stdout.write(JSON.stringify({ length: out.length, head, tail, payload: N * MB }));
  `;
  const r = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', child], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  ok(r.status === 0, `a 24 MB raster PDF must assemble inside a 64 MB JS heap — the child exited ${r.status} ${r.signal || ''}: ${String(r.stderr || '').split('\n').filter(l => /heap|memory|Error/i.test(l)).slice(0, 2).join(' | ')}`);
  const out = JSON.parse(r.stdout);
  eq(out.head, '%PDF-1.4', 'and what it assembled is a PDF from its first byte');
  eq(out.tail, '%%EOF', 'to its last');
  ok(out.length > out.payload && out.length < out.payload + 64 * 1024, `holding every JPEG byte plus a few KB of structure (${out.length} bytes for a ${out.payload}-byte payload)`);
}

console.log(`PASS pdf-byte-assembly (${checks} checks)`);
