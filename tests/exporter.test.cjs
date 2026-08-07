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

   Pure — no DOM, no obsidian, no vault. */

const assert = require('assert');
const {
  transactionsCsv, categoriesCsv, transactionsMarkdown, categoriesMarkdown,
  exportPaths, safeName, EXPORT_DIR,
} = require('../src/exporter');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The real csvCell from util.js, copied rather than imported: util.js pulls in
   obsidian. Pinned against the original below so the copy cannot drift. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /["',\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
{
  const fs = require('fs'), path = require('path');
  const util = fs.readFileSync(path.join(__dirname, '..', 'src', 'util.js'), 'utf8');
  const real = /function csvCell\(v\) \{([\s\S]*?)\n\}/.exec(util);
  ok(real, 'csvCell still exists in util.js');
  const mine = /function csvCell\(v\) \{([\s\S]*?)\n\}/.exec(csvCell.toString().replace(/^function csvCell/, 'function csvCell'));
  eq(real[1].replace(/\s+/g, ' ').trim(), mine[1].replace(/\s+/g, ' ').trim(),
    'the copy of csvCell in this test matches util.js — update both or neither');
}

const money = v => `R ${v < 0 ? '-' : ''}${Math.abs(v).toFixed(2)}`;

const ROWS = [
  { date: '2026-08-01', desc: 'GROCER ONE CITYVILLE', label: 'Cheque', cat: 'Food', amount: -250.5, excluded: false, note: '' },
  { date: '2026-08-02', desc: '-DEBIT ORDER REVERSAL', label: 'Cheque', cat: '', amount: 99.99, excluded: false, note: 'check this' },
  { date: '2026-08-03', desc: 'TRANSFER TO SAVINGS', label: 'Cheque', cat: 'Transfer', amount: -1000, excluded: true, note: '' },
  { date: '2026-08-04', desc: 'PAY | ROLL', label: 'Cheque', cat: 'Salary', amount: 45000, excluded: false, note: '' },
];

/* ---- 1. formula injection is neutralised ---- */
{
  const csv = transactionsCsv(ROWS, csvCell);
  const line = csv.split('\n').find(l => l.includes('DEBIT ORDER REVERSAL'));
  ok(line.includes("'-DEBIT ORDER REVERSAL"), 'a description starting with - is prefixed so it cannot execute');
  ok(!/(^|,)-DEBIT/.test(line), 'and the bare form is not what lands in the cell');
}

/* ---- 2. CSV amounts are raw numbers a spreadsheet can sum ---- */
{
  const csv = transactionsCsv(ROWS, csvCell);
  const rows = csv.trim().split('\n').slice(1).map(l => l.split(','));
  // amount is column 4 (Date, Description, Account, Category, Amount, …)
  const amounts = rows.map(r => r[4]);
  ok(amounts.every(a => /^-?\d+\.\d{2}$/.test(a)),
    `every amount is a bare number, got ${JSON.stringify(amounts)}`);
  /* Checked on the amount COLUMN, not the whole file — a description may
     legitimately contain a currency letter or a space between digits. */
  ok(amounts.every(a => !/[^\d.-]/.test(a)),
    'no currency symbol or thousands separator in an amount cell');
  ok(amounts.includes('-250.50') && amounts.includes('45000.00'),
    'negatives keep their sign and large numbers keep no separators');
}

/* amountRaw wins when the loader could not strictly parse the cell. */
{
  const csv = transactionsCsv([{ ...ROWS[0], amount: 0, amountRaw: '1 234,56 CR' }], csvCell);
  ok(csv.includes('1 234,56 CR'), 'an unparseable original amount is written back verbatim, not as 0.00');
}

/* ---- 3. excluded rows are exported, and marked ---- */
{
  const csv = transactionsCsv(ROWS, csvCell);
  ok(csv.includes('TRANSFER TO SAVINGS'), 'an excluded row still appears in the CSV');
  const line = csv.split('\n').find(l => l.includes('TRANSFER TO SAVINGS'));
  eq(line.split(',')[5], 'yes', 'and is marked excluded');
  eq(csv.trim().split('\n').length, ROWS.length + 1, 'every row plus a header, nothing dropped');
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
  eq(line.split(/(?<!\\)\|/).length - 2, 7, 'so the row still has exactly seven cells');
}

/* ---- 6. filters are disclosed in the document ---- */
{
  const md = transactionsMarkdown(ROWS, {
    range: 'Whole history', filters: ['account: Cheque', 'category: Food'], generated: 'x',
  }, money);
  ok(md.includes('Filtered by: account: Cheque · category: Food'),
    'a partial export says what was filtered out — otherwise it reads as the whole set');
}

/* ---- 7. a period name cannot escape the export folder ---- */
{
  eq(safeName('../../etc/passwd'), '..-..-etc-passwd', 'every path separator becomes a dash');
  eq(safeName(''), 'export', 'and an empty name still produces a usable filename');
  ok(!exportPaths('../../evil').txCsv.includes('../'), 'so the built path cannot climb out of the export folder');
  ok(exportPaths('Aug 2026').txCsv.startsWith(EXPORT_DIR + '/'), 'exports land in the export folder');
  eq(exportPaths('Aug 2026').txCsv, 'Exports/Transactions Aug 2026.csv', 'named after what is in it');
  eq(exportPaths('Aug 2026').txMd, 'Exports/Transactions Aug 2026.md', 'markdown sits beside the CSV');
}

/* ---- 8. categories ---- */
{
  const cats = [
    { name: 'Food', type: 'expense', color: '#22c55e' },
    { name: 'Salary', type: 'income', color: '#0ea5e9' },
    { name: 'Rent, and rates', type: 'expense', color: '#f43f5e' },
  ];
  const csv = categoriesCsv(cats, csvCell);
  ok(csv.includes('"Rent, and rates"'), 'a comma in a category name is quoted');
  eq(csv.trim().split('\n').length, 4, 'header plus every category');

  const md = categoriesMarkdown(cats, '2026-08-07 09:00');
  ok(md.includes('## expense') && md.includes('## income'), 'grouped by type');
  ok(md.indexOf('Food') < md.indexOf('Rent, and rates'), 'and sorted by name inside a group');
}

/* ---- 9. empty input does not produce a broken file ---- */
{
  eq(transactionsCsv([], csvCell).trim().split('\n').length, 1, 'an empty export is a header and nothing else');
  ok(categoriesMarkdown([], 'x').includes('0 categories'), 'and says so in words');
}

console.log(`exporter.test.cjs — ${checks} checks OK`);
