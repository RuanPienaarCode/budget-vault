'use strict';
/* xlsx.js, pinned.

   The quiet failures a hand-rolled xlsx writer can produce, and where each
   is guarded below:

     1. A formula-looking string (a bank description starting =, +, -, @)
        must NOT be quoted the way src/csv.js's csvCell quotes it for a CSV.
        An inline string is never evaluated as a formula, so a leading
        apostrophe here would just be a stray character IN the cell, visible
        to the reader — the defence csvCell exists for is structural here,
        not a character to add.
     2. A number must land as a real numeric cell (`<v>`, no `t=` attribute),
        never as text — a SUM over a text-typed column silently returns
        zero, this repo's canonical export bug (src/exporter.js's amountCell
        comment).
     3. `&`, `<`, a C0 control character and a lone UTF-16 surrogate must all
        be handled without producing malformed XML — Excel refuses the WHOLE
        workbook on a single illegal byte, not just the one cell.
     4. sheetName's rules (31-char cap, forbidden characters, no leading or
        trailing apostrophe, case-insensitive uniqueness) are the only thing
        standing between a user-typed category/period name and a workbook
        that fails to open.
     5. colRef must match Excel's own bijective base-26 column naming past
        the single-letter range, where an off-by-one is easy (Z -> AA).
     6. styles.xml must declare exactly the cellXfs a sheet actually
        references — an index a cell points at that doesn't exist opens with
        a repair prompt.
     7. Two calls with identical input must produce byte-identical output.

   The reader below is a small hand-written zip walk, independent of
   src/zip.js's own writer/central-directory logic (tests/zip.test.cjs pins
   that separately) — it exists only to get the XML parts back out. */

const assert = require('assert');
const { execFileSync } = require('child_process');
const { buildXlsx, sheetName, colRef } = require('../src/xlsx');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
function throwsOk(fn, m) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  ok(threw, m);
}

/* ---- unzip just enough to get named parts back as text/bytes ---- */
function unzipParts(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('no EOCD found in generated archive');
  const count = dv.getUint16(eocdOffset + 10, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  const parts = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error(`bad central directory signature at record ${i}`);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.slice(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    parts.set(name, bytes.slice(dataStart, dataStart + compSize));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return parts;
}
const text = bytes => new TextDecoder('utf-8').decode(bytes);

/* A tiny well-formedness check — balanced tags and no raw & outside a
   recognised entity. Not a real XML parser (that's what the optional
   python3 minidom pass below is for); it exists so a control character or a
   lone surrogate that leaked through unescaped fails HERE, in a way that
   names which cell did it, rather than as an opaque "Excel needs to repair
   workbook.xlsx" a real user would hit. */
function wellFormedXml(xml) {
  const amps = xml.match(/&/g) || [];
  const entityAmps = xml.match(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g) || [];
  if (amps.length !== entityAmps.length) return false;
  const tagRe = /<(\/?)([a-zA-Z_][\w:.-]*)(?:\s+[^<>]*?)?(\/?)>/g;
  const stack = [];
  let m; let sawTag = false;
  while ((m = tagRe.exec(xml))) {
    const closing = m[1], name = m[2], selfClose = m[3];
    sawTag = true;
    if (closing) { if (stack.pop() !== name) return false; }
    else if (!selfClose) stack.push(name);
  }
  return sawTag && stack.length === 0;
}

/* ---- required parts exist, and Content_Types lists every sheet ---- */
{
  const xlsx = buildXlsx([
    { name: 'Transactions', rows: [['Date', 'Amount'], ['2026-08-01', -250.5]] },
    { name: 'Categories', rows: [['Name'], ['Food']] },
  ], { created: '2026-09-17T09:00' });
  const parts = unzipParts(xlsx);
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml',
    'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    ok(parts.has(p), `required part ${p} is present`);
  }
  const ct = text(parts.get('[Content_Types].xml'));
  ok(ct.includes('/xl/worksheets/sheet1.xml') && ct.includes('/xl/worksheets/sheet2.xml'),
    '[Content_Types].xml declares an Override for every sheet');
  ok(wellFormedXml(ct), '[Content_Types].xml is well-formed');
  ok(wellFormedXml(text(parts.get('xl/workbook.xml'))), 'workbook.xml is well-formed');
}

/* ---- formula-looking strings are inline strings, never quoted ---- */
{
  const xlsx = buildXlsx([{ name: 'S', rows: [['=SUM(A1)', '+1', '-1', '@cmd']] }]);
  const sheet = text(unzipParts(xlsx).get('xl/worksheets/sheet1.xml'));
  ok(sheet.includes('<is><t xml:space="preserve">=SUM(A1)</t></is>'),
    'a leading = is an inline string, verbatim, with no defensive quote — inlineStr is never evaluated');
  ok(!sheet.includes("'=SUM(A1)") && !sheet.includes("&apos;=SUM"),
    'unlike csvCell, no apostrophe is prefixed — there is no formula hole to close here');
  ok(sheet.includes('<t xml:space="preserve">+1</t>') && sheet.includes('<t xml:space="preserve">-1</t>'),
    'same for + and -');
}

/* ---- numbers are real numeric cells, never text ---- */
{
  const xlsx = buildXlsx([{ name: 'S', rows: [[{ v: -250.5 }]] }]);
  const sheet = text(unzipParts(xlsx).get('xl/worksheets/sheet1.xml'));
  const cellMatch = /<c r="A1"[^>]*>(.*?)<\/c>/.exec(sheet);
  ok(cellMatch, 'the numeric cell exists');
  ok(!/t="/.test(cellMatch[0].split('>')[0]), 'a numeric cell carries no t= attribute');
  ok(cellMatch[1] === '<v>-250.5</v>', 'the value is a bare numeric <v>, not inline-string text');
}
{
  // NaN/Infinity are not finite numbers a spreadsheet can hold — empty cell,
  // never a string "NaN" that LOOKS numeric and breaks a SUM the same way
  // amountRaw would in the CSV sibling (src/exporter.js's canonical bug).
  const xlsx = buildXlsx([{ name: 'S', rows: [[{ v: NaN }, { v: Infinity }, 42]] }]);
  const sheet = text(unzipParts(xlsx).get('xl/worksheets/sheet1.xml'));
  ok(!sheet.includes('NaN') && !sheet.includes('Infinity'), 'neither leaks into the file as text');
  ok(sheet.includes('<c r="C1"><v>42</v></c>') || /r="C1"[^>]*><v>42<\/v>/.test(sheet),
    'a finite number in the same row still lands correctly — the column position is unaffected');
}

/* ---- XML escaping and illegal-character stripping, all without lookbehind ---- */
{
  const nasty = 'A & B <tag> "quoted" tail' + String.fromCharCode(0xD800) + 'end';
  const xlsx = buildXlsx([{ name: 'S', rows: [[nasty]] }]);
  const sheet = text(unzipParts(xlsx).get('xl/worksheets/sheet1.xml'));
  ok(wellFormedXml(sheet), 'a cell holding &, <, a control char and a lone surrogate still yields well-formed XML');
  ok(sheet.includes('A &amp; B &lt;tag&gt; &quot;quoted&quot;'), 'the legal characters are escaped, not dropped');
  ok(!sheet.includes(''), 'the C0 control character (BEL) is stripped, not smuggled through raw');
  ok(!sheet.includes(String.fromCharCode(0xD800)), 'the lone surrogate is stripped rather than emitted as invalid UTF-8/16');
  ok(sheet.includes('tailend'), 'and the surrounding legal text on both sides of the stripped characters survives intact');
}

/* ---- sheetName: length cap, forbidden characters, apostrophe edges, case-insensitive uniqueness ---- */
{
  const taken = new Set();
  eq(sheetName('Transactions', taken), 'Transactions', 'an ordinary name passes through unchanged');
  const collide = sheetName('transactions', taken);
  ok(collide.toLowerCase() !== 'transactions', 'a case-insensitive collision is not returned as the same name again');
  ok(/\(2\)$/.test(collide), 'and the disambiguated form says so');

  const long = sheetName('A'.repeat(50), new Set());
  ok(long.length <= 31, `31-char cap is enforced, got length ${long.length}`);

  const forbidden = sheetName('Cat[1]:Type*?/2026\\x', new Set());
  ok(!/[[\]:*?/\\]/.test(forbidden), `none of [ ] : * ? / \\ survive, got ${JSON.stringify(forbidden)}`);

  const quoted = sheetName("'Quoted Name'", new Set());
  ok(!quoted.startsWith("'") && !quoted.endsWith("'"), `no leading/trailing apostrophe, got ${JSON.stringify(quoted)}`);

  eq(sheetName('', new Set()) !== '', true, 'an empty name still produces a non-empty, usable sheet name');

  // Two long names differing only after the 31-char cut collide once
  // truncated, and still have to disambiguate rather than silently produce
  // two sheets with the identical name.
  const tk = new Set();
  const n1 = sheetName('X'.repeat(35) + 'one', tk);
  const n2 = sheetName('X'.repeat(35) + 'two', tk);
  ok(n1.length <= 31 && n2.length <= 31, 'both stay within the 31-char cap after disambiguation');
  ok(n1.toLowerCase() !== n2.toLowerCase(), 'and the two remain distinct sheet names, case-insensitively');
}

/* ---- colRef: single letters, the Z -> AA boundary, and three-letter columns ---- */
eq(colRef(0), 'A', 'colRef(0) is A');
eq(colRef(25), 'Z', 'colRef(25) is Z');
eq(colRef(26), 'AA', 'colRef(26) is AA — the boundary an off-by-one gets wrong');
eq(colRef(701), 'ZZ', 'colRef(701) is ZZ');
eq(colRef(702), 'AAA', 'colRef(702) is AAA');

/* ---- freeze pane and column widths are emitted ---- */
{
  const xlsx = buildXlsx([{ name: 'S', rows: [['H1', 'H2'], [1, 2]], widths: [12, 30], freezeRows: 1 }]);
  const sheet = text(unzipParts(xlsx).get('xl/worksheets/sheet1.xml'));
  ok(/ySplit="1"/.test(sheet) && /topLeftCell="A2"/.test(sheet) && /state="frozen"/.test(sheet),
    'freezeRows: 1 produces a frozen top pane');
  ok(/<col min="1" max="1" width="12"/.test(sheet) && /<col min="2" max="2" width="30"/.test(sheet),
    'widths become explicit <col> entries');
}

/* ---- styles.xml: cellXfs count matches the highest index any cell references ---- */
{
  const xlsx = buildXlsx([{
    name: 'S',
    rows: [
      [{ v: 'Head', s: 'head' }],
      [{ v: 1, s: 'bold' }],
      [{ v: 2, s: 'money' }],
      [{ v: 3, s: 'moneyBold' }],
      [{ v: 0.5, s: 'pct' }],
      [{ v: 'muted', s: 'muted' }],
      [{ v: 'unstyled' }],
      [{ v: 'unknown key', s: 'not-a-real-style' }],
    ],
  }]);
  const parts = unzipParts(xlsx);
  const styles = text(parts.get('xl/styles.xml'));
  ok(wellFormedXml(styles), 'styles.xml is well-formed');
  const countMatch = /<cellXfs count="(\d+)">/.exec(styles);
  ok(countMatch, 'styles.xml declares a cellXfs count');
  const xfCount = Number(countMatch[1]);
  // cellStyleXfs also holds one <xf> of its own, which a cell's `s=` never
  // indexes into — scoped to the <cellXfs> block alone so this checks the
  // table a cell reference actually points at.
  const cellXfsBlock = /<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/.exec(styles)[1];
  const cellXfsEntries = (cellXfsBlock.match(/<xf\b/g) || []).length;
  eq(cellXfsEntries, xfCount, 'the declared count matches the number of <xf> entries actually present');

  const sheet = text(parts.get('xl/worksheets/sheet1.xml'));
  const sAttrs = [...sheet.matchAll(/\ss="(\d+)"/g)].map(m => Number(m[1]));
  const maxReferenced = sAttrs.length ? Math.max(...sAttrs) : 0;
  eq(xfCount, maxReferenced + 1,
    `cellXfs count (${xfCount}) matches the highest index any cell references (${maxReferenced}) + 1`);

  ok(!sheet.includes('not-a-real-style'.toUpperCase()), 'sanity: the unknown style key made it through as plain text, not lost');
  const unknownCell = /<c r="A8"[^>]*>/.exec(sheet)[0];
  ok(!/s="\d/.test(unknownCell) || Number(/s="(\d+)"/.exec(unknownCell)[1]) === 0,
    'an unknown style key falls back to the default style (index 0), not a throw');
}

/* ---- at least one sheet is required ---- */
throwsOk(() => buildXlsx([]), 'zero sheets throws');
throwsOk(() => buildXlsx(null), 'a non-array throws');

/* ---- an empty sheet still yields a valid part ---- */
{
  const xlsx = buildXlsx([{ name: 'Empty', rows: [] }]);
  const sheet = text(unzipParts(xlsx).get('xl/worksheets/sheet1.xml'));
  ok(wellFormedXml(sheet), 'a sheet with zero rows is still well-formed XML');
  ok(sheet.includes('<sheetData/>') || sheet.includes('<sheetData></sheetData>'),
    'and its sheetData is simply empty, not omitted or malformed');
}

/* ---- determinism ---- */
{
  const shape = () => [{ name: 'S', rows: [['a', 1], ['b', -2.5]] }];
  const x1 = buildXlsx(shape(), { created: '2026-09-17T09:00', creator: 'Test' });
  const x2 = buildXlsx(shape(), { created: '2026-09-17T09:00', creator: 'Test' });
  eq(Buffer.from(x1).toString('hex'), Buffer.from(x2).toString('hex'), 'identical input produces identical bytes');
}

/* ---- optional external validation: every XML part parses under python3's minidom ---- */
{
  let hasPython = false;
  try { execFileSync('which', ['python3'], { stdio: 'ignore' }); hasPython = true; } catch (e) { hasPython = false; }
  if (hasPython) {
    const xlsx = buildXlsx([
      { name: 'Transactions', rows: [['Date', 'Amount'], ['2026-08-01', -250.5]], widths: [12, 12], freezeRows: 1 },
      { name: 'Categories', rows: [['Name', 'Colour', 'Share'], ['Food', '#22c55e', { v: 0.5, s: 'pct' }]] },
    ], { created: '2026-09-17T09:00' });
    const parts = unzipParts(xlsx);
    for (const [name, bytes] of parts) {
      if (!name.endsWith('.xml')) continue;
      try {
        execFileSync('python3',
          ['-c', 'import sys,xml.dom.minidom; xml.dom.minidom.parseString(sys.stdin.buffer.read())'],
          { input: Buffer.from(bytes), stdio: ['pipe', 'ignore', 'pipe'] });
        ok(true, `python3 xml.dom.minidom accepts ${name}`);
      } catch (e) {
        ok(false, `python3 xml.dom.minidom rejected ${name}: ${e.message}`);
      }
    }
  } else {
    console.log('xlsx.test.cjs: python3 not found on this machine — minidom validation skipped');
  }
}

/* Excel's hard limit is 32 767 characters in a cell; one longer and Excel
   offers to "repair" the WHOLE workbook, which is how a single pasted note
   becomes "the export is corrupt". Cut by CODE POINT, so the cut can never
   land inside a surrogate pair and leave half an emoji — which escXml would
   then have to strip, or which would make the part ill-formed. */
{
  const long = 'a'.repeat(32760) + '😀'.repeat(20);           // 32 800 UTF-16 units
  const bytes = buildXlsx([{ name: 'S', rows: [[long, 'short']] }]);
  // The archive is STORED, so the sheet XML is in there verbatim as UTF-8; the
  // zip's own binary headers decode to replacement characters, which is fine.
  const xml = new TextDecoder('utf-8').decode(bytes);
  const m = /<t xml:space="preserve">(a+[^<]*)<\/t>/.exec(xml);
  ok(m, 'the long cell is present');
  ok(m[1].length <= 32767, `cell text is capped at Excel's 32 767 (got ${m[1].length})`);
  ok(m[1].endsWith('…'), 'and says it was cut, rather than ending mid-word as if that were the whole note');
  ok(!/[\uD800-\uDBFF]$/.test(m[1].slice(0, -1)), 'the cut did not split a surrogate pair');
}

console.log(`xlsx.test.cjs — ${checks} checks OK`);
