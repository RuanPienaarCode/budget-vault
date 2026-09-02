'use strict';
/* Export formatting, pinned.

   The failures this guards against are all quiet ones — an export that looks
   perfectly successful and is wrong in a spreadsheet nobody re-checks:

     1. A description beginning = + - or @ must not execute as a formula when
        the CSV is opened in Excel or Sheets. Bank descriptions really do start
        with a minus.
     2. CSV amounts must be RAW numbers. "R -1 234,56" imports as text and every
        SUM over the column returns zero, silently.
     3. Excluded rows must appear, marked. The glossary says an excluded
        transaction is vetoed from the totals, not hidden — an export that drops
        them disagrees with the app it came from with nothing to explain why.
     4. A markdown total built over excluded rows would contradict the app's own
        arithmetic, so the totals cover only the counted rows and say so when
        the two differ.
     5. A pipe in a description must not break the markdown table.
     6. A period name the user controls must not escape into the file path.
     7. A split PARENT and its PARTS both reach the CSV (the parent stays on
        disk so a re-import can't re-add it, see src/tx-role.js) — and without a
        way to tell "parent, superseded" apart from "transfer, still real
        money", a plain SUM over the Amount column double-counts every split by
        exactly the amount that was split. The Split column is that way; it is
        not decorative.
     8. amountRaw is the loader's "could not strictly parse this cell, keep it
        verbatim" flag — right for the vault file, wrong for a CSV whose whole
        job is a number a spreadsheet can add. Writing it into the Amount cell
        quotes it (the formula guard), Excel's SUM silently skips a quoted
        cell, and the markdown export — which always uses the parsed number —
        disagrees with the CSV over the very rows a reader is most likely to
        have hand-corrected.
     9. A wrapped cell (a real newline, the shape unescMd hands back on load —
        src/load.js) must not terminate the markdown table. This module used
        to carry its own pipes-only escMd instead of markdown.js's shared one,
        so a raw `\n` inside a cell reached the row write untouched, and the
        continuation line — not starting with `|` — ended the table; every
        row after it rendered as plain paragraph text. Proven against the
        same fixture value tests/vault-roundtrip.test.cjs uses on disk
        ("multi<br>line").
    10. The exported column order is read from SCHEMAS.transactions
        (src/table-schema.js), not a fourth hand-written copy — so a column
        appended there cannot silently reach the vault file, the loader and
        the byte-golden gate while never reaching either export.
    11. A rendered ROW is as wide as the header claims. Item 10 compares the
        header of an export with no rows in it, so it stayed green while
        transactionRow() emitted eight cells under a nine-column header —
        the Currency column reached TX_HEAD and the CSV and never reached
        the one row template the Markdown export and the Report's own
        transaction-detail table both draw through. Every value from Amount
        onward was one column left, in a table that still parsed.

   Pure — no DOM, no obsidian, no vault. */

const assert = require('assert');
const {
  transactionsCsv, categoriesCsv, transactionsMarkdown, categoriesMarkdown,
  exportPaths, safeName, EXPORT_DIR, txHeaderLines, transactionRow,
} = require('../src/exporter');
const { SCHEMAS } = require('../src/table-schema');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The REAL csvCell, imported. This used to be a hand-copied duplicate pinned
   against the original by regex-extracting it out of util.js — because util.js
   pulled in obsidian and could not be required in bare node. Splitting util.js
   left csvCell in a pure src/csv.js, so the duplicate and the machinery
   guarding it both go: the assertions below now drive the shipped function. */
const { csvCell } = require('../src/csv');

const money = v => `R ${v < 0 ? '-' : ''}${Math.abs(v).toFixed(2)}`;

/* Read off the SHIPPED header rather than written down as a literal, so
   appending a column moves this test's expectation and the file under test
   together. A hardcoded 8 here is precisely what let the Currency column ship
   into the header while the row template stayed one cell short (item 11
   below) — the number was pinned in one place and the shape in another. */
const TX_HEAD_LEN = txHeaderLines()[0].split('|').length - 2;

const ROWS = [
  { date: '2026-08-01', desc: 'GROCER ONE CITYVILLE', label: 'Cheque', cat: 'Food', amount: -250.5, excluded: false, note: '' },
  { date: '2026-08-02', desc: '-DEBIT ORDER REVERSAL', label: 'Cheque', cat: '', amount: 99.99, excluded: false, note: 'check this' },
  { date: '2026-08-03', desc: 'TRANSFER TO SAVINGS', label: 'Cheque', cat: 'Transfer', amount: -1000, excluded: true, note: '' },
  { date: '2026-08-04', desc: 'PAY | ROLL', label: 'Cheque', cat: 'Salary', amount: 45000, excluded: false, note: '' },
];

/* ---- 1. formula injection is neutralised ---- */
{
  const csv = transactionsCsv(ROWS);
  const line = csv.split('\n').find(l => l.includes('DEBIT ORDER REVERSAL'));
  ok(line.includes("'-DEBIT ORDER REVERSAL"), 'a description starting with - is prefixed so it cannot execute');
  ok(!/(^|,)-DEBIT/.test(line), 'and the bare form is not what lands in the cell');
}

/* ---- 2. CSV amounts are raw numbers a spreadsheet can sum ----

   ISSUE 28 (2026-08-29 audit): a `Currency` column was spliced in immediately
   BEFORE Amount, so the amount column moved from index 4 to index 5. Without
   it the file was uninterpretable the moment a household held two currencies
   — a euro row and a rand row both wrote a bare number into one column, and
   SUM(Amount) returned a figure in no currency that exists. The amount cell
   itself is unchanged and must stay a bare number: the unit belongs in its
   own column precisely so this one stays summable. ---- */
{
  const csv = transactionsCsv(ROWS);
  const rows = csv.trim().split('\n').slice(1).map(l => l.split(','));
  // amount is column 5 (Date, Description, Account, Category, Currency, Amount, …)
  const amounts = rows.map(r => r[csv.split('\n')[0].split(',').indexOf('Amount')]);
  ok(amounts.every(a => /^-?\d+\.\d{2}$/.test(a)),
    `every amount is a bare number, got ${JSON.stringify(amounts)}`);
  /* Checked on the amount COLUMN, not the whole file — a description may
     legitimately contain a currency letter or a space between digits. */
  ok(amounts.every(a => !/[^\d.-]/.test(a)),
    'no currency symbol or thousands separator in an amount cell');
  ok(amounts.includes('-250.50') && amounts.includes('45000.00'),
    'negatives keep their sign and large numbers keep no separators');
}

/* amountRaw does NOT win in the CSV — the parsed number does, so the column
   stays arithmetic-ready and agrees with what markdown counts for the same
   row. amountRaw is untouched everywhere else (the vault file still gets it
   verbatim via serializeTxFile); this is only about what the CSV Amount cell
   holds. */
{
  // The loader's best-guess parse of "1 234,56 CR" IS 1234.56 (normalizeAmount
  // handles the format) — amount already carries that value even though the
  // strict on-disk-shape check failed and set amountRaw.
  const row = { ...ROWS[0], amount: 1234.56, amountRaw: '1 234,56 CR' };
  const csv = transactionsCsv([row]);
  const cell = csv.trim().split('\n')[1].split(',')[csv.split('\n')[0].split(',').indexOf('Amount')];
  eq(cell, '1234.56', 'the Amount cell is the parsed number, not the raw text');
  ok(!csv.includes('1 234,56 CR'), 'the unparsed original text does not leak into the CSV at all');
}
/* A cell too garbled even for normalizeAmount falls back to amount: 0 at load
   — and that is exactly what the CSV and the markdown must now agree on,
   instead of one saying "abc" and the other saying R 0.00. */
{
  const row = { ...ROWS[0], amount: 0, amountRaw: 'abc' };
  const csv = transactionsCsv([row]);
  const md = transactionsMarkdown([row], { range: 'Aug 2026', filters: [], generated: 'x' }, money);
  const cell = csv.trim().split('\n')[1].split(',')[csv.split('\n')[0].split(',').indexOf('Amount')];
  eq(cell, '0.00', 'a cell the loader could not parse at all exports as the same zero the app itself uses');
  ok(md.includes(money(0)), 'and markdown agrees — same row, same figure, in both files');
}

/* ---- 3. excluded rows are exported, and marked ---- */
{
  const csv = transactionsCsv(ROWS);
  ok(csv.includes('TRANSFER TO SAVINGS'), 'an excluded row still appears in the CSV');
  const line = csv.split('\n').find(l => l.includes('TRANSFER TO SAVINGS'));
  eq(line.split(',')[csv.split('\n')[0].split(',').indexOf('Excluded')], 'yes', 'and is marked excluded');
  eq(csv.trim().split('\n').length, ROWS.length + 1, 'every row plus a header, nothing dropped');
}

/* ---- 3b. a split parent and its transfer look-alike are distinguishable ----

   A R1 000 charge split 600/400: the parent stays on disk (excluded: true,
   split: 'parent'), the parts are new rows (excluded: false, split: 'part').
   A transfer carries excluded: true too, with no split role at all — the one
   thing that makes it impossible to tell "phantom, drop it" from "real money,
   keep it" using the Excluded column alone. */
const SPLIT_ROWS = [
  { date: '2026-08-05', desc: 'SUPERMARKET', label: 'Cheque', cat: 'Food', amount: -1000, excluded: true, note: 'split into 2', split: 'parent' },
  { date: '2026-08-05', desc: 'SUPERMARKET', label: 'Cheque', cat: 'Food', amount: -600, excluded: false, note: '', split: 'part' },
  { date: '2026-08-05', desc: 'SUPERMARKET', label: 'Cheque', cat: 'Household', amount: -400, excluded: false, note: '', split: 'part' },
  { date: '2026-08-06', desc: 'TRANSFER TO SAVINGS', label: 'Cheque', cat: 'Transfer', amount: -500, excluded: true, note: '' },
];
{
  const csv = transactionsCsv(SPLIT_ROWS);
  const head = csv.split('\n')[0];
  ok(/(^|,)Split(,|$)/.test(head), 'the CSV header carries a Split column');

  /* Columns looked up BY NAME rather than by a hardcoded index. Splicing the
     Currency column in (issue #28) shifted six literals in this file at once,
     and each failed as a baffling assertion about split roles rather than as
     "a column moved". The header is right there in the file under test;
     reading it is both truer to what a consumer of this CSV actually does and
     immune to the next column anyone adds. */
  const cols = head.split(',');
  const at = name => {
    const i = cols.indexOf(name);
    ok(i !== -1, `the CSV header carries a ${name} column`);
    return i;
  };
  const AMOUNT = at('Amount'), EXCLUDED = at('Excluded'), SPLIT = at('Split');
  ok(at('Currency') < AMOUNT,
    'and Currency sits immediately beside Amount — a unit two columns away from its figure is a unit nobody reads');

  const rows = csv.trim().split('\n').slice(1).map(l => l.split(','));
  eq(rows[0][SPLIT], 'parent', 'the split parent is marked, not just excluded');
  eq(rows[1][SPLIT], 'part', 'so are its parts');
  eq(rows[2][SPLIT], 'part', '');
  eq(rows[3][EXCLUDED], 'yes', 'the transfer is excluded, same as the parent...');
  eq(rows[3][SPLIT], '', '...but its Split cell is empty — Excluded alone could never tell these apart');

  /* The correct filter now exists: drop rows where Split is "parent" and sum
     the rest. That is real money only — the parts (already summing back to
     what the parent was) plus the transfer, which still moved. */
  const realTotal = rows.filter(r => r[SPLIT] !== 'parent').reduce((t, r) => t + Number(r[AMOUNT]), 0);
  eq(realTotal, -1500, 'no double count: -600 + -400 + -500, the parent itself excluded from the sum');

  /* And the filter the app already uses for its own totals (Excluded != yes)
     still lands on the same figure for the split specifically, because a
     part is never excluded and a parent always is. */
  const budgetTotal = rows.filter(r => r[EXCLUDED] !== 'yes').reduce((t, r) => t + Number(r[AMOUNT]), 0);
  eq(budgetTotal, -1000, 'Excluded != yes already avoided the double-count on its own — -600 + -400');
}

/* ---- 4. markdown totals count only the counted rows, and say so ---- */
{
  const md = transactionsMarkdown(ROWS, { range: 'Aug 2026', filters: [], generated: '2026-08-07 09:00' }, money);
  // in = 99.99 + 45000; out = -250.50. The excluded -1000 is in neither.
  ok(md.includes(money(45099.99)), 'money in excludes the excluded row');
  ok(md.includes(money(-250.5)), 'money out excludes the excluded row');
  ok(!md.includes(money(-1250.5)), 'the excluded amount is not folded into the out total');
  ok(/Totals cover 3 of 4 rows/.test(md), 'and the gap between listed and counted is stated');
  ok(md.includes('TRANSFER TO SAVINGS'), 'while the excluded row is still listed');
}
{
  const clean = ROWS.filter(r => !r.excluded);
  const md = transactionsMarkdown(clean, { range: 'Aug 2026', filters: [], generated: 'x' }, money);
  ok(!/Totals cover/.test(md), 'with nothing excluded the caveat is not printed at all');
}

/* ---- 5. a pipe cannot break the table ---- */
{
  const md = transactionsMarkdown(ROWS, { range: 'Aug 2026', filters: [], generated: 'x' }, money);
  const line = md.split('\n').find(l => l.includes('ROLL'));
  ok(line.includes('PAY \\| ROLL'), 'a pipe in a description is escaped');
  // (?<!\\) is a plain node-side test helper, not shipped src/ — src/ itself
  // never uses lookbehind (it is a parse-time SyntaxError before iOS 16.4).
  eq(line.split(/(?<!\\)\|/).length - 2, TX_HEAD_LEN, `so the row still has exactly ${TX_HEAD_LEN} cells (Split is the last)`);
}

/* ---- 5b. a wrapped cell cannot break the table either ----

   Same fixture value tests/vault-roundtrip.test.cjs writes to disk
   ("multi<br>line"), so this pins the SAME newline shape the real loader
   hands back through unescMd — not a value chosen only for this test. */
{
  const wrapped = [
    { date: '2026-07-03', desc: 'café ¥', label: 'FNB Cheque', cat: '', amount: 42000.5, excluded: false, note: 'multi\nline' },
    { date: '2026-07-04', desc: 'next row', label: 'FNB Cheque', cat: 'Groceries', amount: -10, excluded: false, note: '' },
  ];
  const md = transactionsMarkdown(wrapped, { range: 'Jul 2026', filters: [], generated: 'x' }, money);
  const lines = md.split('\n');
  ok(lines.some(l => l.includes('multi<br>line')), 'the newline is escaped to <br>, not left raw');
  ok(!lines.some(l => l.trim() === 'line |' || /^line\b/.test(l.trim())),
    'so it never lands as a second, pipe-less continuation line');
  const rowIdx = lines.findIndex(l => l.includes('café'));
  ok(lines[rowIdx + 1].includes('2026-07-04'), 'and the next transaction is still the very next table row');
}

/* ---- 10. the export column order is read from SCHEMAS.transactions, not a
   fourth hand-written copy ---- */
{
  /* Two export-only columns now. Both are properties of the FOLDER a row
     lives in rather than cells the transaction file holds, which is exactly
     why neither is in SCHEMAS.transactions and why adding them did not trip
     ADR-0003's append-only tripwire. The point this test protects is
     unchanged: everything else comes from the schema, in the schema's order,
     rather than from a fourth hand-written copy. */
  const expectedHead = SCHEMAS.transactions.columns.map(c => c.header);
  expectedHead.splice(2, 0, 'Account');
  expectedHead.splice(4, 0, 'Currency');

  const csvHead = transactionsCsv([]).trim().split('\n')[0].split(',');
  eq(csvHead, expectedHead, 'the CSV header matches the schema plus Account and Currency');

  const md = transactionsMarkdown([], { range: 'x', filters: [], generated: 'x' }, money);
  const headerLine = md.split('\n').find(l => l.startsWith('| Date'));
  const mdHead = headerLine.split('|').slice(1, -1).map(s => s.trim());
  eq(mdHead, expectedHead, 'the markdown header matches the schema plus Account and Currency');
}

/* ---- 11. a rendered ROW carries as many cells as the header says it does,
   and the Currency cell is the row's own symbol ----

   The bug this pins: TX_CURRENCY_AT spliced `Currency` into TX_HEAD and
   TX_ALIGN (so txHeaderLines() emitted nine columns) and transactionsCsv
   grew its matching `csvCell(sym(r))` — but transactionRow(), the ONE row
   template the Markdown export and views/report.js's transaction-detail
   table both draw through, was left at eight. Every value from Amount
   onward landed one column to the left, so a reader of either document saw
   the amount filed under "Currency", the Excluded flag under "Amount" and
   the Split role under "Note", in a table that still looked perfectly
   well-formed.

   Item 10 above could not see it: it compares the header of an export with
   NO ROWS in it. A header-only file has no row to be short. So the check
   that actually has teeth is header-width against a REAL row — and against
   more than one, since a single row is also what the CSV/Markdown parity
   checks below would have caught by luck rather than by design. */
{
  const rows = [
    { ...ROWS[0], _symbol: 'R' },
    { date: '2026-08-05', desc: 'Rent Berlin', label: 'Euro Savings', cat: 'Housing', amount: -900, excluded: true, note: 'lease', split: 'parent', _symbol: '\u20ac' },
  ];
  const symbolFor = r => r._symbol || '';
  const md = transactionsMarkdown(rows, { range: 'Aug 2026', filters: [], generated: 'x', household: 'R' }, money, symbolFor);
  const lines = md.split('\n');
  const head = lines.find(l => l.startsWith('| Date')).split('|').slice(1, -1).map(x => x.trim());
  const body = lines.filter(l => /^\| 2026-/.test(l));
  eq(body.length, 2, 'both rows rendered');
  for (const l of body) {
    eq(l.split('|').length - 2, head.length,
      'a rendered row has exactly as many cells as the header — one short shifts every value from Amount onward into the wrong column');
  }

  const CUR = head.indexOf('Currency');
  ok(CUR !== -1, 'the markdown header carries a Currency column');
  eq(body[0].split('|')[CUR + 1].trim(), 'R', 'a household-currency row states the household symbol');
  eq(body[1].split('|')[CUR + 1].trim(), '\u20ac', 'and a euro row states the euro symbol, not the household one');

  /* The SAME per-row symbol both files resolve — the CSV had this from the
     start (csvCell(sym(r))) and the Markdown did not, which is the whole
     defect: one click writing two files that disagree about the unit of the
     figure beside it. */
  const csv = transactionsCsv(rows, symbolFor);
  const cols = csv.split('\n')[0].split(',');
  const csvRows = csv.trim().split('\n').slice(1).map(l => l.split(','));
  eq(csvRows[1][cols.indexOf('Currency')], '\u20ac', 'the CSV resolves the same symbol for the same row');
  eq(body[1].split('|')[CUR + 1].trim(), csvRows[1][cols.indexOf('Currency')],
    'and the two files agree on it — one row template, one symbol rule');

  /* transactionRow() driven directly, the shape src/report.js's own
     transaction-detail table calls it in: a caller that injects nothing
     still gets a full-width row rather than a silently short one. */
  const bare = transactionRow(rows[1], money, symbolFor);
  eq(bare.split('|').length - 2, TX_HEAD_LEN,
    'transactionRow() on its own emits a full-width row — this is the exact call src/report.js makes');
}

/* ---- 6. filters are disclosed in the document ---- */
{
  const md = transactionsMarkdown(ROWS, {
    range: 'Whole history', filters: ['account: Cheque', 'category: Food'], generated: 'x',
  }, money);
  ok(md.includes('Filtered by: account: Cheque · category: Food'),
    'a partial export says what was filtered out — otherwise it reads as the whole set');
}

/* ---- 7. neither the period name nor the chosen folder can escape ----

   The folder is typed into a dialog, so it is user input reaching a file write.
   io.js's guardedVaultPath is the second ring; this is the first, and the two
   are deliberately independent — a bug in either alone still leaves the write
   contained. */
{
  eq(safeName('../../etc/passwd'), '..-..-etc-passwd', 'every path separator becomes a dash');
  eq(safeName(''), 'export', 'and an empty name still produces a usable filename');
  ok(!exportPaths('../../evil').txCsv.includes('../'), 'a hostile RANGE cannot climb out');

  /* Each segment is sanitised, so a nested folder survives... */
  eq(exportPaths('Aug 2026', 'Admin/Tax 2026').txCsv, 'Admin/Tax 2026/Transactions Aug 2026.csv',
    'a nested destination is kept intact');
  /* ...while a traversal segment is defused rather than honoured. */
  const escaped = exportPaths('Aug 2026', '../../secrets');
  ok(!escaped.txCsv.includes('../'), 'a hostile FOLDER cannot climb out either');
  eq(escaped.dir, 'secrets', 'the traversal segments are dropped, leaving the folder actually named');
  eq(safeName('..'), 'export', 'and a bare traversal can never become a filename either');
  eq(safeName('.'), 'export', 'nor a single dot');

  eq(exportPaths('Aug 2026', '').dir, EXPORT_DIR, 'an empty folder falls back to the default');
  eq(exportPaths('Aug 2026', undefined).dir, EXPORT_DIR, 'so does a missing one');
  eq(exportPaths('Aug 2026', '///').dir, EXPORT_DIR, 'and so does one that is only separators');

  eq(exportPaths('Aug 2026', 'Exports').txCsv, 'Exports/Transactions Aug 2026.csv', 'named after what is in it');
  eq(exportPaths('Aug 2026', 'Exports').txMd, 'Exports/Transactions Aug 2026.md', 'markdown sits beside the CSV');
  eq(exportPaths('Aug 2026', 'Admin').catCsv, 'Admin/Categories.csv', 'categories land in the same folder');
}

/* ---- 8. categories ---- */
{
  const cats = [
    { name: 'Food', type: 'expense', color: '#22c55e' },
    { name: 'Salary', type: 'income', color: '#0ea5e9' },
    { name: 'Rent, and rates', type: 'expense', color: '#f43f5e' },
  ];
  const csv = categoriesCsv(cats);
  ok(csv.includes('"Rent, and rates"'), 'a comma in a category name is quoted');
  eq(csv.trim().split('\n').length, 4, 'header plus every category');

  const md = categoriesMarkdown(cats, '2026-08-07 09:00');
  ok(md.includes('## expense') && md.includes('## income'), 'grouped by type');
  ok(md.indexOf('Food') < md.indexOf('Rent, and rates'), 'and sorted by name inside a group');
}

/* ---- 9. empty input does not produce a broken file ---- */
{
  eq(transactionsCsv([]).trim().split('\n').length, 1, 'an empty export is a header and nothing else');
  ok(categoriesMarkdown([], 'x').includes('0 categories'), 'and says so in words');
}

console.log(`exporter.test.cjs — ${checks} checks OK`);
