'use strict';
/* THREE WAYS THE APP DESTROYED WHAT THE HOUSEHOLD TYPED (#51, #52, #54).

   All three are the same failure with different surfaces: a reader and a
   writer that were not inverses of each other, in a file that had never been
   put on the shared machinery `table-schema.js` and `amount.js` exist to be.

   ---- #51. One stray double-quote swallowed a block of transactions --------

   `src/csv.js` entered quoting mode on a double quote appearing ANYWHERE, so
   in an otherwise unquoted export every delimiter and newline after it was
   absorbed until the next quote. RFC 4180 only opens a quoted field on the
   FIRST character of the field.

   Measured on twelve rows carrying two ordinary South African merchant names:
   thirteen lines parsed to SIX rows, seven transactions swallowed into one
   merged field. Because the merged row still had a date, a description and an
   amount, views/import.js reported "0 unparseable".

   ---- #52. Tax figures were read with a digit-scraper -------------------

   `Number(String(v).replace(/[^\d.-]/g, ''))` DELETES separators rather than
   interpreting them, and it read the two figures a household copies straight
   off an ITA34. A refund of R1 234,56 was read as R123 456 and written back.

   ---- #54. YAML escapes doubled on every save ---------------------------

   `parseFrontmatter` stripped the quotes and never undid the escapes, so every
   field yamlStr wrote came back still escaped and was escaped again on the next
   save. Visible to the reader from the first reload.

   WHAT IS PINNED: for each, the defect's own input, and — the half that makes
   these fixes rather than patches — that the surrounding correct behaviour is
   untouched. A CSV fix that broke real quoting, or a YAML fix that ate a
   legitimate backslash, would be the same bug one turn further on.

     node tests/write-path-integrity.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { parseDelimited } = require('../src/csv');
const { parseFrontmatter, yamlStr } = require('../src/markdown');
const { normalizeAmount } = require('../src/amount');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ===================== #51 — the CSV quote rule ========================= */
{
  const rows = parseDelimited([
    'Date,Description,Amount',
    '2026-01-01,MERCHANT 1,-100.00',
    '2026-01-04,BUILDERS 15" HOSE,-400.00',
    '2026-01-05,MERCHANT 5,-500.00',
    '2026-01-11,CASHBUILD 24" PIPE,-1100.00',
    '2026-01-12,MERCHANT 12,-1200.00',
  ].join('\n'), ',');

  eq(rows.length, 6, 'every line is its own row — an inch mark swallows nothing');
  eq(rows[2], ['2026-01-04', 'BUILDERS 15" HOSE', '-400.00'],
    'a mid-field quote is a literal character, and the field still splits on the delimiter');
  eq(rows[4], ['2026-01-11', 'CASHBUILD 24" PIPE', '-1100.00'], 'and so is the second one');
  eq(rows.reduce((t, r) => t + (Number(r[2]) || 0), 0), -3300,
    'the money adds up to what the file says, which is the whole point');

  /* The other half: real quoting must still work, or this is a worse bug. */
  eq(parseDelimited('a,"b,c",d', ','), [['a', 'b,c', 'd']], 'a quoted field still hides its delimiter');
  eq(parseDelimited('a, "b,c" ,d', ','), [['a', ' b,c ', 'd']],
    'and still opens after leading whitespace — a bank writing `, "x"` has always been read this way');
  eq(parseDelimited('a,"he said ""hi""",d', ','), [['a', 'he said "hi"', 'd']], 'doubled quotes still escape');
  eq(parseDelimited('a,"line1\nline2",d', ','), [['a', 'line1\nline2', 'd']],
    'and a newline inside a real quoted field is still part of that field');
  eq(parseDelimited('a;"b;c";d', ';'), [['a', 'b;c', 'd']], 'unchanged for a semicolon export');
}

/* ===================== #54 — yamlStr round-trip ========================= */
{
  const read = line => parseFrontmatter(`---\n${line}\n---\n`).fm;

  /* The fixed point. Not "one save is right" — SEVERAL, because the defect was
     growth, and a single generation would have looked fine while doubling. */
  let disk = `institution: ${yamlStr('O"Reilly \\ Sons Bank')}`;
  const gen1 = disk;
  for (let i = 0; i < 5; i++) disk = `institution: ${yamlStr(read(disk).institution)}`;
  eq(disk, gen1, 'six generations of save/reload leave the bytes exactly as they started');
  eq(read(disk).institution, 'O"Reilly \\ Sons Bank', 'and the value read back is the one typed');

  eq(read('note: "a\\nb"').note, 'a\nb', 'an escaped newline decodes to a newline');
  eq(read('t: "a\\tb"').t, 'a\tb', 'and a tab to a tab');
  eq(read('path: C:\\temp').path, 'C:\\temp',
    'an UNQUOTED scalar is untouched — the unescape is gated on the value having been quoted, which is exactly when yamlStr wrote it');
  eq(read(`x: ${yamlStr('')}`).x, '', 'an empty string survives the trip');
  eq(read(`x: ${yamlStr('multi\nline\ttext "quoted" and \\ slash')}`).x,
    'multi\nline\ttext "quoted" and \\ slash', 'and so does everything yamlStr escapes, at once');
}

/* ===================== #52 — tax figures ================================ */
(async () => {
  const B = 'Budget';
  const load = async body => {
    const ctx = makeCtx({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Tax/2026.md`]: body,
    }, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx);
    return S.tax['2026'];
  };

  const t = await load('---\nkind: tax\nassessment: assessed\nassessment_result: -1 234,56\nassessment_income: 480 000,00\n---\n');
  eq(t.assessment_result, -1234.56, 'a refund typed the way SARS prints it is that refund, not 100x it');
  eq(t.assessment_income, 480000, 'and so is the assessed income');
  eq(t.assessment_resultRaw, null, 'a readable cell keeps no raw — there is nothing to preserve');

  /* The same reader every other hand-editable amount in this app goes through. */
  for (const cell of ['-1 234,56', '480 000,00', '1.250,00', 'R 1 234.56', '-0.01']) {
    const one = await load(`---\nkind: tax\nassessment_result: ${cell}\n---\n`);
    eq(one.assessment_result, normalizeAmount(cell),
      `"${cell}" reads exactly as normalizeAmount reads it — one reader, not a private fourth copy`);
  }

  const bad = await load('---\nkind: tax\nassessment: assessed\nassessment_result: about R2k\n---\n');
  eq(bad.assessment_result, null, 'a cell nobody can read is not a number');
  eq(bad.assessment_resultRaw, 'about R2k',
    'and its text is kept, so the next save writes the household\'s own words back rather than a fabricated 0');

  const blank = await load('---\nkind: tax\nassessment: assessed\nassessment_result:\n---\n');
  eq(blank.assessment_result, null, 'a blank cell is still null');
  eq(blank.assessment_resultRaw, null, 'with nothing to preserve — "not stated" and "unreadable" stay different facts');

  console.log(`PASS write-path-integrity (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
