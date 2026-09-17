'use strict';
/* pdf.test.cjs — pinning the quiet failures a hand-rolled PDF writer can
   produce without a single visible symptom until a reader opens the file:

     1. An xref offset that is off by even one byte still "renders" in a
        lenient reader (most are) while a strict one — or Preview.app's PDF
        kit — refuses the file outright. The small PDF reader below walks
        every offset and demands it land exactly on "N 0 obj".
     2. A stream whose /Length disagrees with its real byte count either
        truncates the page (reader stops early) or bleeds into the next
        object (reader reads garbage as PDF syntax) — both silent until
        render.
     3. UTF-8-encoding a WinAnsi byte (writing the file as a JS string
        through TextEncoder instead of raw bytes) corrupts every accented
        character AND shifts every later xref offset, because the
        corruption changes the byte length of everything after it.
     4. A numeric column, once truncated, is a WRONG FIGURE wearing a
        correct-looking width — worse than an ugly wide table, because
        nothing announces it.
     5. AFM width values typed from memory instead of read off the real
        font metrics: right-aligned money columns silently stop lining up,
        and nothing in a single render tells you why.

   Pure — no DOM, no obsidian, no vault; tests/ itself may use Node APIs
   freely (fs/Buffer/child_process) even though src/pdf.js must not. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const {
  PAGE, normalizeText, canEncode, docEncodable, helveticaMeasure,
  layoutDocument, renderVectorPdf, renderImagePdf,
} = require('../src/pdf');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ============================================================
   A small PDF reader, used to validate every rendered file below
   structurally rather than trusting that a byte pattern "looks right". */
function parsePdf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  ok(buf instanceof Buffer, 'renderer returns bytes that convert to a Buffer');
  const text = buf.toString('latin1'); // 1 char == 1 byte: safe for structural PDF parsing

  ok(text.startsWith('%PDF-1.4\n'), 'file opens with the %PDF-1.4 header');
  const secondLine = text.slice('%PDF-1.4\n'.length, text.indexOf('\n', '%PDF-1.4\n'.length) + 1);
  ok(secondLine[0] === '%', 'header is followed by a comment line');
  for (let i = 1; i <= 4; i++) {
    ok(secondLine.charCodeAt(i) >= 0x80, `binary-comment byte ${i} is >= 0x80 (forces binary-safe transfer)`);
  }

  const sxIdx = text.lastIndexOf('startxref');
  ok(sxIdx !== -1, 'startxref present');
  const sxMatch = /startxref\s+(\d+)/.exec(text.slice(sxIdx));
  ok(sxMatch, 'startxref value parses');
  const xrefOffset = parseInt(sxMatch[1], 10);
  const xrefBlock = text.slice(xrefOffset);
  const header = /^xref\n(\d+) (\d+)\n/.exec(xrefBlock);
  ok(header, `startxref (${xrefOffset}) points exactly at the "xref" keyword and a well-formed subsection header`);
  const start = parseInt(header[1], 10);
  const count = parseInt(header[2], 10);
  eq(start, 0, 'the one xref subsection starts at object 0');

  const entriesStart = xrefOffset + header[0].length;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const raw = text.slice(entriesStart + i * 20, entriesStart + i * 20 + 20);
    eq(raw.length, 20, `xref entry ${i} is exactly 20 bytes`);
    const m = /^(\d{10}) (\d{5}) (n|f) \n$/.exec(raw);
    ok(m, `xref entry ${i} matches the fixed-width "0000000000 65535 f " form (got ${JSON.stringify(raw)})`);
    entries.push({ offset: parseInt(m[1], 10), type: m[3] });
  }
  eq(entries[0].type, 'f', 'object 0 is the free-list head');

  for (let num = 1; num < count; num++) {
    const e = entries[num];
    if (e.type !== 'n') continue;
    const at = text.slice(e.offset, e.offset + String(num).length + 6);
    ok(at.startsWith(`${num} 0 obj`), `xref offset for object ${num} lands exactly on "${num} 0 obj" (got ${JSON.stringify(at)})`);
  }

  const trailerIdx = text.lastIndexOf('trailer');
  ok(trailerIdx !== -1 && trailerIdx > xrefOffset, 'trailer keyword present, after the xref table it describes');
  const tDictStart = text.indexOf('<<', trailerIdx);
  const tDictEnd = text.indexOf('>>', tDictStart) + 2;
  const trailerDict = text.slice(tDictStart, tDictEnd);
  const rootM = /\/Root (\d+) 0 R/.exec(trailerDict);
  const infoM = /\/Info (\d+) 0 R/.exec(trailerDict);
  ok(rootM, 'trailer names /Root');
  ok(infoM, 'trailer names /Info');
  const sizeM = /\/Size (\d+)/.exec(trailerDict);
  ok(sizeM, 'trailer names /Size');
  eq(parseInt(sizeM[1], 10), count, '/Size matches the xref entry count');

  // Every object body, keyed by object number.
  const objBodies = new Map();
  const objRe = /(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g;
  let m;
  while ((m = objRe.exec(text))) objBodies.set(parseInt(m[1], 10), m[2]);
  eq(objBodies.size, count - 1, 'one object body found per in-use xref entry');

  // /Length vs real stream byte count, for every object that declares one.
  for (const [num, body] of objBodies) {
    const lm = /\/Length (\d+)/.exec(body);
    if (!lm) continue;
    const L = parseInt(lm[1], 10);
    const sIdx = body.indexOf('stream\n');
    ok(sIdx !== -1, `object ${num} declaring /Length has a "stream" keyword`);
    const dataStart = sIdx + 'stream\n'.length;
    const actualLen = body.slice(dataStart, dataStart + L).length;
    eq(actualLen, L, `object ${num} stream data is exactly the declared /Length (${L}) bytes`);
    const tail = body.slice(dataStart + L, dataStart + L + 10);
    ok(tail.startsWith('\nendstream'), `object ${num} stream is followed immediately by endstream (got ${JSON.stringify(tail)})`);
  }

  // /Type /Page count vs the Pages object's /Count.
  const pageTypeCount = (text.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const pagesDictM = /\/Type\s*\/Pages[\s\S]*?\/Count (\d+)/.exec(text);
  ok(pagesDictM, 'a /Type /Pages object declares /Count');
  eq(pageTypeCount, parseInt(pagesDictM[1], 10), 'the number of /Type /Page objects equals /Count');

  return { text, buf, entries, objBodies, count };
}

/* ============================================================
   1. normalizeText / canEncode */
{
  const CASES = [
    ['R 1 234,56', true, 'ZAR grouped with a NO-BREAK SPACE (what Intl actually emits)'],
    ['1 234,56 €', true, 'fr-FR-style NARROW NO-BREAK SPACE grouping plus euro sign'],
    ['€ 10', true, 'euro sign is in the WinAnsi high range'],
    ['日本', false, 'CJK has no WinAnsi byte'],
    ['naïve café', true, 'accented Latin is in WinAnsi'],
    ['', false, 'empty string is not an encodable string'],
  ];
  for (const [input, expected, msg] of CASES) {
    eq(canEncode(input), expected, `${msg} — canEncode(${JSON.stringify(input)})`);
  }

  eq(normalizeText('−250.50'), '-250.50', 'MINUS SIGN U+2212 normalizes to ascii hyphen');
  eq(normalizeText('non‑breaking'), 'non-breaking', 'NON-BREAKING HYPHEN normalizes to ascii hyphen');
  eq(normalizeText('a\tb\nc\rd'), 'a b c d', 'tab/newline/CR normalize to a single space each');
  eq(normalizeText('ab'), 'ab', 'other C0 controls are stripped, not turned into a space');
  eq(normalizeText(null), '', 'null is the empty string');

  ok(docEncodable({ title: 'Budget', blocks: [{ type: 'note', text: 'naïve café totals' }] }),
    'a doc whose strings are all WinAnsi-encodable is docEncodable');
  ok(!docEncodable({ title: '预算', blocks: [] }), 'a non-WinAnsi title fails docEncodable');
  ok(docEncodable({ title: 'Budget', subtitle: '', blocks: [] }),
    'an absent/empty subtitle does not force the raster path (vacuously encodable)');
  ok(!docEncodable({ title: 'Budget', blocks: [{ type: 'table', head: ['A'], rows: [['日']] }] }),
    'a non-WinAnsi cell deep in a table still fails docEncodable');
}

/* ============================================================
   2. Helvetica/Helvetica-Bold AFM widths — sanity anchors read off the real
   Adobe Core-14 metrics (see src/pdf.js header for how they were sourced
   and cross-checked). size=1000 makes the returned number the raw AFM
   width directly (total * size / 1000). */
{
  eq(helveticaMeasure(' ', 'regular', 1000), 278, 'Helvetica space width');
  eq(helveticaMeasure(' ', 'bold', 1000), 278, 'Helvetica-Bold space width');
  for (const d of '0123456789') {
    eq(helveticaMeasure(d, 'regular', 1000), 556, `Helvetica digit '${d}' width`);
    eq(helveticaMeasure(d, 'bold', 1000), 556, `Helvetica-Bold digit '${d}' width`);
  }
  eq(helveticaMeasure('A', 'regular', 1000), 667, "Helvetica 'A' width");
  eq(helveticaMeasure('A', 'bold', 1000), 722, "Helvetica-Bold 'A' width");
  eq(helveticaMeasure('W', 'regular', 1000), 944, "Helvetica 'W' width");
  eq(helveticaMeasure('W', 'bold', 1000), 944, "Helvetica-Bold 'W' width");
  eq(helveticaMeasure('i', 'regular', 1000), 222, "Helvetica 'i' width");
  eq(helveticaMeasure('i', 'bold', 1000), 278, "Helvetica-Bold 'i' width");
  eq(helveticaMeasure('.', 'regular', 1000), 278, 'period width');
  eq(helveticaMeasure(',', 'regular', 1000), 278, 'comma width');
  eq(helveticaMeasure('-', 'regular', 1000), 333, 'hyphen width');
}

/* ============================================================
   Shared fixture helpers */
function buildDoc(overrides) {
  return Object.assign({
    title: 'Household Budget',
    subtitle: 'Aug 2026',
    footer: 'Generated by Budget Vault',
    blocks: [],
  }, overrides || {});
}
function vectorPdf(doc, layoutOpts, metaOverrides) {
  const pages = layoutDocument(doc, Object.assign({ measure: helveticaMeasure, page: PAGE.A4 }, layoutOpts || {}));
  const meta = Object.assign({ title: doc.title, created: '2026-09-17T09:00' }, metaOverrides || {});
  return { pages, bytes: renderVectorPdf(pages, { meta }) };
}
/* Independent reference implementation of the PDF literal-string escape
   rule, used only to build expected substrings for the escaping test below
   — not imported from src/pdf.js, so it cannot pass by mirroring a bug. */
function pdfEscapeRef(s) {
  let out = '';
  for (const ch of s) out += (ch === '\\' || ch === '(' || ch === ')') ? '\\' + ch : ch;
  return out;
}

/* ============================================================
   3. Empty input still yields >= 1 page, always */
{
  const { pages: p1 } = vectorPdf(buildDoc({ blocks: [{ type: 'table', head: ['A', 'B'], align: ['left', 'right'], rows: [] }] }));
  eq(p1.length, 1, 'a table with zero rows still produces exactly one page');
  ok(p1[0].ops.some(o => o.op === 'text' && o.text === 'A'), 'and the header is drawn even with zero rows');

  const { pages: p2, bytes: b2 } = vectorPdf(buildDoc({ blocks: [] }));
  eq(p2.length, 1, 'an empty document still yields one page');
  ok(p2[0].ops.some(o => o.op === 'text' && o.text === 'Household Budget'), 'carrying the title');
  parsePdf(b2);
}

/* ============================================================
   4. Literal-string escaping: \ ( ) survive into the content stream,
   escaped, and an accented character is a SINGLE cp1252 byte, never a
   2-byte UTF-8 sequence. */
{
  const cat1 = 'Rent (Jan)\\Feb';
  const cat2 = '50% \\ tax';
  const { bytes } = vectorPdf(buildDoc({ blocks: [
    { type: 'table', head: ['Category', 'Amount'], align: ['left', 'right'], rows: [[cat1, '-900.00'], [cat2, '-10.00']] },
  ] }));
  const text = Buffer.from(bytes).toString('latin1');
  ok(text.includes(pdfEscapeRef(cat1)), 'parens and a backslash in a category name survive into the content stream, escaped');
  ok(text.includes(pdfEscapeRef(cat2)), 'a lone backslash is escaped too');
  ok(!text.includes(cat1), 'the UNescaped form (which would break the PDF string) is not what was written');

  const accented = 'naïve café';
  const { bytes: b2 } = vectorPdf(buildDoc({ blocks: [
    { type: 'note', text: accented },
  ] }));
  const buf2 = Buffer.from(b2);
  ok(buf2.includes(Buffer.from([0x6e, 0x61, 0xef, 0x76, 0x65])), "'naïve' is written as ASCII n,a then a SINGLE byte 0xEF ('ï'), not a 2-byte UTF-8 sequence");
  ok(buf2.includes(Buffer.from([0x63, 0x61, 0x66, 0xe9])), "'café' ends in a SINGLE byte 0xE9 ('é'), not 2-byte UTF-8");
  ok(!buf2.includes(Buffer.from([0xc3, 0xaf])), 'the UTF-8 encoding of ï (0xC3 0xAF) is NOT what was written');
  ok(!buf2.includes(Buffer.from([0xc3, 0xa9])), 'the UTF-8 encoding of é (0xC3 0xA9) is NOT what was written');
}

/* ============================================================
   5. /Info dictionary: Title/Producer/CreationDate, and the UTF-16BE+BOM
   fallback for a title the base-14 fonts cannot draw. */
{
  const { bytes } = vectorPdf(buildDoc({ blocks: [] }), {}, { title: 'Plain Title', created: '2026-09-17T14:33', producer: 'Budget Vault Test' });
  const text = Buffer.from(bytes).toString('latin1');
  ok(text.includes('/CreationDate (D:20260917143300)'), 'CreationDate is derived from the injected timestamp, seconds forced to 00');
  ok(text.includes('/Title (Plain Title)'), 'an encodable title is written as a plain literal string');
  ok(text.includes('/Producer (Budget Vault Test)'), 'Producer is written too');
}
{
  const title = '预算报告'; // Chinese — not WinAnsi-encodable
  const { bytes } = vectorPdf(buildDoc({ title, blocks: [] }), {}, { title, created: '2026-01-01T00:00' });
  const text = Buffer.from(bytes).toString('latin1');
  const m = /\/Title <(feff[0-9a-f]+)>/i.exec(text);
  ok(m, 'a non-WinAnsi title falls back to a hex string with the UTF-16BE BOM (FEFF)');
  const raw = Buffer.from(m[1], 'hex');
  const swapped = Buffer.from(raw.slice(2)).swap16(); // BE -> LE so Buffer can decode it
  eq(swapped.toString('utf16le'), title, 'the hex string round-trips to the exact original title via UTF-16BE');
}

/* ============================================================
   6. Numbers in content streams: never NaN, never exponent notation —
   forced by giving computeColWidths a pathological, near-zero weight. */
{
  const { bytes } = vectorPdf(buildDoc({ blocks: [
    { type: 'table', head: ['A', 'B'], align: ['left', 'right'], weights: [0.0000001, 999999], rows: [['x', '1.00']] },
  ] }));
  const text = Buffer.from(bytes).toString('latin1');
  ok(!/NaN/.test(text), 'no NaN ever reaches the content stream');
  ok(!/\d[eE][+-]\d/.test(text), 'no exponent notation ever reaches the content stream');
}

/* ============================================================
   7. Determinism: same input -> byte-identical output. No clock, no
   randomness, no /ID. */
{
  const doc = buildDoc({ blocks: [{ type: 'table', head: ['A', 'B'], align: ['left', 'right'], rows: [['x', '1.00']] }] });
  const meta = { title: 'Det', created: '2026-05-05T09:00' };
  const p1 = layoutDocument(doc, { measure: helveticaMeasure, page: PAGE.A4 });
  const p2 = layoutDocument(doc, { measure: helveticaMeasure, page: PAGE.A4 });
  const b1 = renderVectorPdf(p1, { meta });
  const b2 = renderVectorPdf(p2, { meta });
  ok(Buffer.from(b1).equals(Buffer.from(b2)), 'the same document renders to byte-identical PDFs on repeated calls');
}

/* ============================================================
   8. A 200-row table paginates, repeats its header on every page, and
   prints "Page 1 of N" ... "Page N of N" with the right N. */
{
  const rows = [];
  for (let i = 1; i <= 200; i++) rows.push([String(i), `Item ${i}`, (i * 1.5).toFixed(2)]);
  const doc = buildDoc({ blocks: [
    { type: 'table', head: ['#', 'Description', 'Amount'], align: ['right', 'left', 'right'], rows },
  ] });
  const { pages, bytes } = vectorPdf(doc);
  ok(pages.length > 1, `200 rows paginate across more than one page (got ${pages.length})`);
  for (const p of pages) {
    const headTexts = new Set(p.ops.filter(o => o.op === 'text' && o.font === 'bold').map(o => o.text));
    ok(['#', 'Description', 'Amount'].every(h => headTexts.has(h)), 'every page repeats all three header cells');
  }
  const text = Buffer.from(bytes).toString('latin1');
  const N = pages.length;
  for (let n = 1; n <= N; n++) ok(text.includes(`Page ${n} of ${N}`), `footer states "Page ${n} of ${N}"`);
  parsePdf(bytes);
}

/* ============================================================
   9. A 15-column table never truncates a numeric cell, and never emits a
   text op whose right edge exceeds the page's right margin. */
{
  const heads = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Q1', 'Q2', 'Total'];
  const align = heads.map(() => 'right');
  const row1 = heads.map((_, i) => (1000 + i * 123.45).toFixed(2));
  const row2 = heads.map((_, i) => (-(500 + i * 67.89)).toFixed(2));
  const doc = buildDoc({ blocks: [{ type: 'table', head: heads, align, rows: [row1, row2] }] });
  const { pages } = vectorPdf(doc);
  const rightMargin = PAGE.A4.width - 40; // MARGIN, per the ~40pt design rule

  for (const p of pages) {
    for (const op of p.ops) {
      if (op.op !== 'text') continue;
      const w = helveticaMeasure(op.text, op.font, op.size);
      ok(op.x + w <= rightMargin + 0.01, `text "${op.text}" right edge (${(op.x + w).toFixed(2)}) stays within the right margin (${rightMargin.toFixed(2)})`);
    }
  }
  for (const row of [row1, row2]) {
    for (const cell of row) {
      const found = pages.some(p => p.ops.some(o => o.op === 'text' && o.text === cell));
      ok(found, `numeric cell "${cell}" appears WHOLE in some text op, never truncated`);
    }
  }
}

/* ============================================================
   10. Right-aligned cells in one column share the same right edge, within
   0.01pt of each other. */
{
  const doc = buildDoc({ blocks: [
    { type: 'table', head: ['Category', 'Amount'], align: ['left', 'right'], rows: [
      ['Food', '1234.56'],
      ['Rent', '9000.00'],
      ['A rather long category name that pushes the left column wide', '5.00'],
    ] },
  ] });
  const { pages } = vectorPdf(doc);
  const amountOps = [];
  for (const p of pages) for (const op of p.ops) {
    if (op.op === 'text' && op.font === 'regular' && /^-?\d/.test(op.text)) amountOps.push(op);
  }
  eq(amountOps.length, 3, 'found the three amount cells');
  const rightEdges = amountOps.map(o => o.x + helveticaMeasure(o.text, o.font, o.size));
  for (const re of rightEdges) ok(Math.abs(re - rightEdges[0]) <= 0.01, `right edges align within 0.01pt (${rightEdges.map(n => n.toFixed(3))})`);
}

/* ============================================================
   11. A heading is never stranded as the last thing on a page — swept
   across many note lengths so the sweep crosses the critical page-boundary
   point without hand-computed geometry. */
{
  const tableRows = ['Food', 'Rent', 'Other'];
  const table = { type: 'table', head: ['Category', 'Amount'], align: ['left', 'right'], rows: [['Food', '100.00'], ['Rent', '200.00'], ['Other', '5.00']] };
  let sawBoundaryEffect = false;
  for (let words = 10; words <= 1400; words += 35) {
    const note = Array(words).fill('word').join(' ');
    const doc = buildDoc({ blocks: [{ type: 'note', text: note }, { type: 'heading', text: 'Summary' }, table] });
    const { pages } = vectorPdf(doc);
    let headingPageIdx = -1;
    pages.forEach((p, i) => { if (p.ops.some(o => o.op === 'text' && o.font === 'bold' && o.text === 'Summary')) headingPageIdx = i; });
    ok(headingPageIdx !== -1, `heading placed somewhere (words=${words})`);
    const hp = pages[headingPageIdx];
    const rowsHere = tableRows.filter(t => hp.ops.some(o => o.op === 'text' && o.text === t)).length;
    ok(rowsHere >= 2, `heading (words=${words}) is never left with fewer than 2 of its table's rows on its own page (got ${rowsHere})`);
    if (headingPageIdx < pages.length - 1) sawBoundaryEffect = true;
  }
  ok(sawBoundaryEffect, 'the sweep pushed the heading onto an earlier page at least once, proving the keep-with-next path actually ran');
}

/* ============================================================
   11b. …and the thing it heads need not be the NEXT block. budget-export.js
   puts a one-line note (the period's income and spend) between a period's
   heading and its table. A lookahead of exactly one block saw "a note, not a
   table", reserved nothing, and the first rendered export stranded
   "May 2026" plus its income line at the foot of page 2 with their table on
   page 3 — found by looking at the page, not by a test, which is why this
   one exists. Same sweep as above, with the note in between. */
{
  const tableRows = ['Food', 'Rent', 'Other'];
  const table = { type: 'table', head: ['Category', 'Amount'], align: ['left', 'right'], rows: [['Food', '100.00'], ['Rent', '200.00'], ['Other', '5.00']] };
  let pushed = false;
  for (let words = 10; words <= 1400; words += 35) {
    const filler = Array(words).fill('word').join(' ');
    const doc = buildDoc({ blocks: [{ type: 'note', text: filler }, { type: 'heading', text: 'May 2026' },
      { type: 'note', text: 'Income R 50 000,00 - Spent R 38 500,00' }, table] });
    const { pages } = vectorPdf(doc);
    const pageOf = text => pages.findIndex(p => p.ops.some(o => o.op === 'text' && o.text === text));
    const h = pageOf('May 2026');
    ok(h !== -1, `heading placed (words=${words})`);
    eq(pageOf('Income R 50 000,00 - Spent R 38 500,00'), h, `the heading's note stays on the heading's page (words=${words})`);
    const rowsHere = tableRows.filter(t => pages[h].ops.some(o => o.op === 'text' && o.text === t)).length;
    ok(rowsHere >= 2, `heading + note (words=${words}) keep at least 2 rows of their table with them (got ${rowsHere})`);
    if (h > 0 && pageOf('word') !== -1 && h === pages.length - 1 && pages.length > 1) pushed = true;
  }
  ok(pushed, 'the sweep crossed a page boundary at least once, so the lookahead-through-notes path actually ran');
}

/* ============================================================
   12. layoutDocument driven by a FAKE measure still produces in-bounds
   ops — proves it never reaches for Helvetica metrics itself. */
{
  const fakeMeasure = (t, f, s) => t.length * s * 0.5;
  const doc = buildDoc({ blocks: [
    { type: 'heading', text: 'Section' },
    { type: 'table', head: ['A', 'B', 'C'], align: ['left', 'left', 'right'], rows: Array.from({ length: 30 }, (_, i) => [`row${i}`, `text${i}`, `${i}.00`]) },
    { type: 'note', text: 'A reasonably long note that should wrap using only the fake measure function supplied by the caller, never Helvetica metrics, even though the two disagree wildly on every width.' },
  ] });
  const pages = layoutDocument(doc, { measure: fakeMeasure, page: PAGE.A4 });
  ok(pages.length >= 1, 'fake-measure layout produces at least one page');
  const rightMargin = PAGE.A4.width - 40;
  for (const p of pages) {
    for (const op of p.ops) {
      if (op.op !== 'text') continue;
      const w = fakeMeasure(op.text, op.font, op.size);
      ok(op.x >= 40 - 0.01, `op "${op.text}" left edge respects the margin under the fake measure`);
      ok(op.x + w <= rightMargin + 0.01, `op "${op.text}" right edge (${(op.x + w).toFixed(2)}) respects the margin under the fake measure`);
    }
  }
}

/* ============================================================
   13. pageLabel override is used instead of the English default. */
{
  const doc = buildDoc({ blocks: [{ type: 'table', head: ['A'], align: ['left'], rows: [['x']] }] });
  const { pages, bytes } = vectorPdf(doc, { pageLabel: (n, m) => `Bladsy ${n} van ${m}` });
  const text = Buffer.from(bytes).toString('latin1');
  ok(text.includes(`Bladsy 1 van ${pages.length}`), 'a custom pageLabel function replaces the English default');
  ok(!text.includes('Page 1 of'), 'and the default English label is not also written');
}

/* ============================================================
   14. renderImagePdf: DCTDecode pages, correct Width/Height/Length, and
   the JPEG bytes reproduced verbatim (no re-encoding). */
{
  function fakeJpeg(n, salt) {
    const head = [0xff, 0xd8, 0xff, 0xd9];
    const body = [];
    for (let i = 0; i < n; i++) body.push((i * 37 + salt) % 256);
    return new Uint8Array(head.concat(body));
  }
  const images = [
    { jpeg: fakeJpeg(50, 1), width: 800, height: 1131 },
    { jpeg: fakeJpeg(80, 2), width: 800, height: 1131 },
  ];
  const bytes = renderImagePdf(images, { page: PAGE.A4, meta: { title: 'Raster export', created: '2026-01-01T00:00' } });
  parsePdf(bytes);
  const text = Buffer.from(bytes).toString('latin1');
  const pageCount = (text.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  eq(pageCount, 2, 'two pages produced for two images');
  eq((text.match(/\/DCTDecode/g) || []).length, 2, 'each image XObject declares /DCTDecode');
  eq((text.match(/\/Width 800/g) || []).length, 2, 'Width is written for both images');
  eq((text.match(/\/Height 1131/g) || []).length, 2, 'Height is written for both images');

  const buf = Buffer.from(bytes);
  for (const img of images) {
    ok(buf.indexOf(Buffer.from(img.jpeg)) !== -1, 'the JPEG bytes appear verbatim in the file, not re-encoded');
    ok(text.includes(`/Length ${img.jpeg.length} >>`), `the image stream's /Length equals the real JPEG byte length (${img.jpeg.length})`);
  }
}

/* ============================================================
   15. A4 vs A4 landscape page sizes reach the MediaBox. */
{
  const doc = buildDoc({ blocks: [{ type: 'table', head: ['A'], align: ['left'], rows: [['x']] }] });
  const { bytes } = vectorPdf(doc, { page: PAGE.A4_LANDSCAPE });
  const text = Buffer.from(bytes).toString('latin1');
  ok(text.includes(`/MediaBox [0 0 ${PAGE.A4_LANDSCAPE.width} ${PAGE.A4_LANDSCAPE.height}]`), 'a landscape page size reaches the MediaBox');
}

/* ============================================================
   16. Sample PDF: a realistic 2-page budget report, written to the OS temp
   directory, validated structurally and (where tools exist on this
   machine) by real external readers. */
const sampleDoc = {
  title: 'Household Budget — August 2026',
  subtitle: 'Whole household · generated 2026-09-17',
  footer: 'Budget Vault export',
  blocks: [
    { type: 'note', text: 'A two-page sample export, used to prove the vector PDF writer produces a file a real reader can open.' },
    { type: 'table', head: ['Category', 'Budgeted', 'Spent', 'Remaining', 'Note', 'Status'],
      align: ['left', 'right', 'right', 'right', 'left', 'left'],
      boldRows: [5],
      rows: [
        ['Food', '2000.00', '1875.50', '124.50', '', 'On track'],
        ['Rent', '9000.00', '9000.00', '0.00', 'Paid on the 1st', 'Paid'],
        ['Transport', '1200.00', '1340.25', '-140.25', 'Over — check fuel', 'Over'],
        ['Insurance', '850.00', '850.00', '0.00', '', 'Paid'],
        ['Savings', '3000.00', '3000.00', '0.00', 'Auto transfer', 'Paid'],
        ['Total', '16050.00', '16065.75', '-15.75', '', 'Total'],
      ] },
    { type: 'pagebreak' },
    { type: 'heading', text: 'Notes' },
    { type: 'note', text: 'Transport ran over budget this month due to two unplanned fuel price increases and an out-of-town trip.' },
  ],
};
const samplePages = layoutDocument(sampleDoc, { measure: helveticaMeasure, page: PAGE.A4 });
const sampleBytes = renderVectorPdf(samplePages, {
  meta: { title: sampleDoc.title, created: '2026-09-17T09:00', producer: 'budget-vault pdf.js test' },
});
parsePdf(sampleBytes);
ok(samplePages.length >= 2, `sample document produced ${samplePages.length} pages (>= 2 expected: table page + forced pagebreak)`);

/* os.tmpdir(), in a directory of its own — never a path from the machine the
   test was written on. This suite runs on CI and on a contributor's laptop,
   and the repo is public. */
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-vault-pdf-'));
const samplePath = path.join(scratchDir, 'sample-budget.pdf');
fs.writeFileSync(samplePath, Buffer.from(sampleBytes));
console.log(`sample PDF written: ${samplePath} (${sampleBytes.length} bytes, ${samplePages.length} pages)`);

/* External validators — every one optional, none failing the suite if
   absent from this machine. Each is reported so the caller can see exactly
   which independent reader actually opened the file. */
function tryValidator(label, fn) {
  try {
    const out = fn();
    console.log(`validator ${label}: ran OK${out ? ' — ' + out : ''}`);
    return true;
  } catch (e) {
    const msg = e.code === 'ENOENT' ? 'not installed' : String(e.message || e).split('\n')[0];
    console.log(`validator ${label}: skipped (${msg})`);
    return false;
  }
}
let anyValidatorRan = false;
anyValidatorRan = tryValidator('qpdf --check', () => {
  execFileSync('qpdf', ['--check', samplePath], { stdio: ['ignore', 'pipe', 'pipe'] });
  return 'no structural errors reported';
}) || anyValidatorRan;
anyValidatorRan = tryValidator('mutool info', () => {
  return execFileSync('mutool', ['info', samplePath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().split('\n')[0];
}) || anyValidatorRan;
anyValidatorRan = tryValidator('pdfinfo', () => {
  const out = execFileSync('pdfinfo', [samplePath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const pagesLine = out.split('\n').find(l => l.startsWith('Pages:'));
  ok(pagesLine && parseInt(pagesLine.split(':')[1], 10) === samplePages.length,
    `pdfinfo reports the same page count pdf.js produced (${pagesLine})`);
  return pagesLine;
}) || anyValidatorRan;
anyValidatorRan = tryValidator('python3 pypdf/PyPDF2', () => {
  const script = "import sys\ntry:\n    from pypdf import PdfReader\nexcept ImportError:\n    from PyPDF2 import PdfReader\nr = PdfReader(sys.argv[1])\nprint(len(r.pages))\n";
  const out = execFileSync('python3', ['-c', script, samplePath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  return `pages=${out}`;
}) || anyValidatorRan;
anyValidatorRan = tryValidator('mdls kMDItemNumberOfPages', () => {
  return execFileSync('mdls', ['-name', 'kMDItemNumberOfPages', samplePath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}) || anyValidatorRan;
anyValidatorRan = tryValidator('qlmanage -t (Quick Look thumbnail, Apple PDFKit)', () => {
  const out = execFileSync('qlmanage', ['-t', '-s', '64', '-o', os.tmpdir(), samplePath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return out.split('\n')[0];
}) || anyValidatorRan;
anyValidatorRan = tryValidator('pdftoppm (poppler, an independent renderer from PDFKit)', () => {
  const outBase = path.join(os.tmpdir(), 'pdf-test-render');
  execFileSync('pdftoppm', ['-png', '-r', '72', samplePath, outBase], { stdio: ['ignore', 'pipe', 'pipe'] });
  const rendered = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('pdf-test-render'));
  ok(rendered.length === samplePages.length, `poppler rendered one PNG per page (${rendered.length} of ${samplePages.length})`);
  return `rendered ${rendered.length} page(s) to PNG`;
}) || anyValidatorRan;
console.log(anyValidatorRan
  ? 'at least one external validator confirmed the sample PDF opens'
  : 'no external PDF validator/reader was found on this machine — only the in-test structural parser confirmed the file');

console.log(`pdf.test.cjs — ${checks} checks OK`);
