'use strict';
/* Budget export — the model behind the PDF, the workbook and the CSVs, pinned.

   One model, three renderings. Everything here guards a way the three could
   come to disagree with each other, or with the screen they were made from,
   while each still looked perfectly well-formed on its own:

     1. THE RANGE WALK. "Last 3" with the in-progress period switched off must
        be the three FINISHED periods, not two finished ones and a hole; a
        vault younger than the range reports what it has rather than inventing
        zero-months (the M2 bug trend-math.js and views/report.js each had);
        and the current period is kept even when empty, because an export that
        silently drops "now" reads as broken.
     2. A CATEGORY FILTER NARROWS EVERYTHING AT ONCE — summary rows, every
        period's budget table, the subtotals and the transactions. A filter
        that reached the tables and not the subtotals would print a total over
        rows the reader cannot see.
     3. THE SUMMARY IS BUILT FROM THE SAME ROWS AS THE PERIOD TABLES. Each
        month column is that period's own `actual` (figures.js's
        budgetVsActualRows), so Total is the sum of the cells beside it and
        the August column equals the August table — never a second derivation.
     4. A category absent from one period is a ZERO in that column, not a
        shifted row: the columns are positional and a short row would slide
        every later month one to the left, in a table that still parses.
     5. `remaining` is READ off the row (money-flow.js's budgetRowStatus), and
        a subtotal's is the same rule over the summed operands — never
        `budget - actual` by hand, which tests/period-figures.test.cjs forbids
        outside the owners.
     6. CSV amounts are raw numbers and text cells go through csvCell — the
        two halves of exporter.js's own rule. A category named "=Rent" must
        not execute; -250.5 must not become "'-250.50".
     7. Workbook amounts are NUMBERS (typeof 'number'), never formatted
        strings: a SUM over text silently returns zero.
     8. The PDF document carries the caveats the screen prints beside the
        figure — other-currency rows held out, the in-progress period, the
        category filter — because the document outlives the app that made it.
     9. More than twelve periods do not fit across a page, so the PDF summary
        drops to Total / Average / Budgeted and SAYS where the month columns
        went. The workbook and the CSV keep every month.
    10. File names are built from a period name the household controls, so
        they are sanitised per segment and a traversal folder cannot escape.

   Pure — no DOM, no obsidian, no vault.
     node tests/budget-export.test.cjs */

const assert = require('assert');
const path = require('path');
const bx = require(path.join(__dirname, '..', 'src', 'budget-export.js'));
const { budgetRowStatus } = require(path.join(__dirname, '..', 'src', 'money-flow.js'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- fixtures: rows in the exact shape figures.js's budgetVsActualRows hands over ---- */
const row = (cat, type, budget, actual, extra) => ({
  cat, type, budget, actual, notes: '', assumed: false,
  ...budgetRowStatus({ budget, actual, type }), ...(extra || {}),
});
const tx = (date, desc, label, cat, amount, extra) => ({ date, desc, label, cat, amount, excluded: false, note: '', split: '', ...(extra || {}) });

const P = [
  {
    key: '2026-06', name: 'June 2026', title: 'May 23 – Jun 22, 2026', start: '2026-05-23', end: '2026-06-22',
    rows: [row('Salary', 'income', 30000, 30000), row('Groceries', 'expense', 6000, 5200.5), row('Fuel', 'expense', 0, 900)],
    summary: { income: 30000, spend: 6300.5, uncatSpend: 200, foreign: { count: 0, labels: [], symbols: [] } },
    txs: [tx('2026-06-01', 'PnP', 'Cheque', 'Groceries', -5200.5), tx('2026-06-03', 'Shell', 'Cheque', 'Fuel', -900)],
  },
  {
    key: '2026-07', name: 'July 2026', title: 'Jun 23 – Jul 22, 2026', start: '2026-06-23', end: '2026-07-22',
    rows: [row('Salary', 'income', 30000, 31000), row('Groceries', 'expense', 6000, 6400), row('=Rent', 'expense', 9000, 9000)],
    summary: { income: 31000, spend: 15400, uncatSpend: 0, foreign: { count: 1, labels: ['Euro Savings'], symbols: ['€'] } },
    txs: [tx('2026-07-02', 'PnP', 'Cheque', 'Groceries', -6400), tx('2026-07-01', '=Rent July', 'Cheque', '=Rent', -9000),
      tx('2026-07-05', 'Move to savings', 'Cheque', '', -1000, { excluded: true })],
  },
];

/* =============================== 1. range walk =============================== */
{
  const shift = (p, d) => {
    let [y, m] = p.split('-').map(Number); m += d;
    while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
    return `${y}-${String(m).padStart(2, '0')}`;
  };
  const base = { anchor: '2026-09', shiftPeriod: shift, periodsForMonths: n => n, periodEndMonth: p => p, earliest: '2026-01' };
  eq(bx.RANGE_KEYS, ['1', '2', '3', '6', '12', 'all'], 'the six ranges the dialog offers');
  eq(bx.exportPeriods({ ...base, range: '3', includeCurrent: true }), ['2026-07', '2026-08', '2026-09'], 'last 3 including the in-progress period');
  eq(bx.exportPeriods({ ...base, range: '3', includeCurrent: false }), ['2026-06', '2026-07', '2026-08'], 'last 3 FINISHED periods — three, not two and a hole');
  eq(bx.exportPeriods({ ...base, range: '1', includeCurrent: false }), ['2026-08'], '"last month" with current off is the last finished period');
  eq(bx.exportPeriods({ ...base, range: '12', includeCurrent: true }).length, 9, 'a vault younger than the range reports what it has (Jan–Sep), no invented months');
  eq(bx.exportPeriods({ ...base, range: 'all', includeCurrent: true })[0], '2026-01', '"all" reaches the earliest month with data and stops');
  eq(bx.exportPeriods({ ...base, range: 'all', includeCurrent: false }).slice(-1), ['2026-08'], '"all" with current off ends at the last finished period');
  eq(bx.exportPeriods({ ...base, earliest: null, range: '6', includeCurrent: true }), ['2026-09'], 'an empty vault keeps the current period only — no six invented zero-months');
  eq(bx.exportPeriods({ ...base, earliest: null, range: '6', includeCurrent: false }), [], 'an empty vault with current off has nothing to export, and says so by being empty');
  eq(bx.exportPeriods({ ...base, range: 'nonsense', includeCurrent: true }), ['2026-09'], 'an unknown range key falls back to one period rather than throwing or walking forever');
  // a weekly pay cycle: "3 months" is ~13 periods, the count comes from periodsForMonths
  eq(bx.exportPeriods({ ...base, earliest: '2020-01', periodsForMonths: n => n * 4, range: '3', includeCurrent: true }).length, 12, 'the range names a span of time; the period count is periodsForMonths\'s');
}

/* ================================ 2–5. the model ============================== */
const META = { generated: '2026-09-17 10:30', currency: 'R', inProgress: null };
{
  const m = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: true, ...META });
  eq(m.periods.map(p => p.key), ['2026-06', '2026-07'], 'periods oldest first, as handed in');
  eq(m.rangeLabel, 'June 2026 to July 2026', 'range label spans first to last');
  eq(m.filtered, false, 'no category filter');

  const g = m.summary.rows.find(r => r.cat === 'Groceries');
  eq(g.byPeriod, [5200.5, 6400], 'each month column is that period\'s own actual');
  eq(g.total, 11600.5, 'Total is the sum of the cells beside it');
  eq(g.average, 5800.25, 'Average is over the periods exported');
  eq(g.budget, 12000, 'Budgeted sums the period budgets');

  const fuel = m.summary.rows.find(r => r.cat === 'Fuel');
  eq(fuel.byPeriod, [900, 0], 'a category absent from a period is a ZERO in that column, not a short row');
  const rent = m.summary.rows.find(r => r.cat === '=Rent');
  eq(rent.byPeriod, [0, 9000], 'and a category that first appears later is zero before it');
  ok(m.summary.rows.every(r => r.byPeriod.length === 2), 'every summary row is exactly as wide as the period list');

  eq(m.summary.rows.map(r => r.cat), ['Salary', 'Groceries', 'Fuel', '=Rent'], 'first-seen order, which is figures.js\'s own type-then-name order');
  const sub = m.summary.subtotals.find(s => s.type === 'expense');
  eq(sub.byPeriod, [6100.5, 15400], 'expense subtotal per period');
  eq(sub.total, 21500.5, 'expense subtotal total');
  eq(m.summary.subtotals.map(s => s.type), ['income', 'expense'], 'one subtotal per type, never income and expense mixed into one figure');

  eq(m.budgets.length, 2, 'full content: one budget table per period');
  eq(m.budgets[0].rows.map(r => r.cat), ['Salary', 'Groceries', 'Fuel'], 'a period table is that period\'s rows, untouched');
  const jul = m.budgets[1];
  const julExp = jul.subtotals.find(s => s.type === 'expense');
  eq([julExp.budget, julExp.actual], [15000, 15400], 'period subtotal sums the rows shown');
  eq(julExp.remaining, budgetRowStatus({ budget: 15000, actual: 15400, type: 'expense' }).remaining, 'subtotal remaining is budgetRowStatus\'s rule, not a second one');
  eq(m.budgets[0].rows[1].remaining, P[0].rows[1].remaining, 'a row\'s remaining is read off the row');

  eq(m.transactions.length, 5, 'every row in range is listed — excluded ones included, as exporter.js argues');
  eq(m.foreignSymbols, ['€'], 'other currencies that were held out are named once');
}
{
  const m = bx.buildModel({ periods: P, content: 'summary', categories: null, includeTx: false, ...META });
  eq(m.budgets, [], 'summary content carries no per-period tables');
  eq(m.transactions, null, 'and no transactions unless asked');
  ok(m.summary.rows.length === 4, 'the summary itself is the same one');
}
{
  const m = bx.buildModel({ periods: P, content: 'full', categories: ['Groceries', 'Fuel'], includeTx: true, ...META });
  eq(m.filtered, true, 'a category list is a filter');
  eq(m.summary.rows.map(r => r.cat), ['Groceries', 'Fuel'], 'summary narrowed');
  eq(m.budgets[1].rows.map(r => r.cat), ['Groceries'], 'every period table narrowed');
  eq(m.budgets[1].subtotals.find(s => s.type === 'expense').actual, 6400, 'subtotals cover ONLY the rows the reader can see');
  ok(!m.summary.subtotals.some(s => s.type === 'income'), 'a type with no rows left has no subtotal line');
  eq(m.transactions.map(t => t.desc), ['PnP', 'Shell', 'PnP'], 'transactions narrowed to the same categories — the excluded uncategorised move is out');
  eq(m.categories, ['Groceries', 'Fuel'], 'the filter is recorded on the model so every rendering can state it');
  const none = bx.buildModel({ periods: P, content: 'full', categories: [], includeTx: true, ...META });
  eq(none.summary.rows, [], 'an EMPTY list is "none selected", not "no filter" — the dialog must refuse it, the model must not widen it');
}

/* ================================== 6. CSV =================================== */
{
  const m = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: true, ...META });
  const files = bx.modelToCsv(m, { symbolFor: () => 'R' });
  eq(files.map(f => f.kind), ['summary', 'budget', 'transactions'], 'three files for full + transactions');
  const sum = files[0].text.split('\n');
  eq(sum[0], 'Category,Type,Currency,June 2026,July 2026,Total,Average,Budgeted', 'summary header carries one column per period');
  ok(sum.includes('Groceries,expense,R,5200.50,6400.00,11600.50,5800.25,12000.00'), 'amounts are raw two-decimal numbers a spreadsheet can add');
  ok(sum.some(l => l.startsWith(`"'=Rent",`)), 'a category beginning = is defused by csvCell');
  ok(!/'-\d/.test(files[0].text) && !/'-\d/.test(files[1].text), 'and no AMOUNT ever is — a quoted negative is text, and SUM skips it');
  ok(!sum.some(l => /^Total|^Subtotal/i.test(l)), 'no subtotal rows in the CSV: it is pivot-table input, and a total row double-counts under SUM');
  const bud = files[1].text.split('\n');
  eq(bud[0], 'Period,From,To,Category,Type,Currency,Budget,Actual,Remaining,Notes', 'budget CSV is long format — one row per period per category');
  ok(bud.includes('June 2026,2026-05-23,2026-06-22,Fuel,expense,R,0.00,900.00,-900.00,'), 'a long-format row, remaining negative and unquoted');
  eq(bud.filter(Boolean).length, 1 + 6, 'header + three rows per period');
  ok(files[2].text.startsWith('Date,Description,Account,Category,Currency,Amount'), 'transactions reuse exporter.js\'s own column order');
  ok(files.every(f => f.text.endsWith('\n')), 'every file ends with a newline');

  const s = bx.buildModel({ periods: P, content: 'summary', categories: null, includeTx: false, ...META });
  eq(bx.modelToCsv(s, {}).map(f => f.kind), ['summary'], 'summary content is one CSV');
}

/* ================================ 7. workbook ================================ */
{
  const m = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: true, ...META });
  const sheets = bx.modelToSheets(m, { symbolFor: () => 'R' });
  eq(sheets.map(s => s.name), ['Summary', 'Budget', 'Transactions', 'About'], 'sheet order');
  const val = c => (c && typeof c === 'object' ? c.v : c);
  const sumSheet = sheets[0];
  eq(sumSheet.rows[0].map(val), ['Category', 'Type', 'June 2026', 'July 2026', 'Total', 'Average', 'Budgeted'], 'summary header');
  eq(sumSheet.freezeRows, 1, 'header frozen');
  const gro = sumSheet.rows.find(r => val(r[0]) === 'Groceries');
  ok(gro.slice(2).every(c => typeof val(c) === 'number'), 'every amount is a NUMBER — a SUM over text silently returns zero');
  eq(val(gro[2]), 5200.5, 'unformatted');
  {
    // 0.1 + 0.2: the sum a category reaches across three periods must land in
    // the cell as 0.3, not 0.30000000000000004 — the cell is a number a person
    // will click on, and the formula bar shows all seventeen digits.
    const drift = ['a', 'b', 'c'].map((k, i) => ({ ...P[0], key: k, name: k, rows: [row('Drift', 'expense', 0, [0.1, 0.2, 0.3][i])], txs: [] }));
    const dm = bx.buildModel({ periods: drift, content: 'summary', categories: null, includeTx: false, ...META });
    const cells = bx.modelToSheets(dm, {})[0].rows[1].slice(2).map(val);
    eq(cells.slice(0, 5), [0.1, 0.2, 0.3, 0.6, 0.2], 'workbook amounts are rounded to cents — total 0.6 and average 0.2, not 0.6000000000000001 and 0.20000000000000004');
  }
  ok(sumSheet.rows.some(r => /expense/i.test(String(val(r[0]))) && r[0].s === 'bold'), 'the workbook DOES carry subtotal rows, bold — it is for a person');
  const txSheet = sheets[2];
  const rentRow = txSheet.rows.find(r => val(r[1]) === '=Rent July');
  ok(rentRow, 'a description beginning = goes in verbatim — an inline string is never evaluated, so no quote prefix');
  eq(typeof val(rentRow[5]), 'number', 'transaction amount is numeric');
  const about = sheets[3].rows.map(r => r.map(val).join(' | ')).join('\n');
  ok(/2026-09-17 10:30/.test(about) && /June 2026 to July 2026/.test(about), 'About states when and what');
  ok(/€/.test(about), 'About names the currency that was held out');
  ok(sheets.every(s => s.rows.every(r => Array.isArray(r))), 'rows are arrays');
}

/* ================================= 8–9. PDF ================================== */
{
  const money = v => 'R ' + Number(v).toFixed(2);
  const m = bx.buildModel({ periods: P, content: 'full', categories: ['Groceries', '=Rent'], includeTx: true, ...META, inProgress: '2026-07' });
  const doc = bx.modelToDoc(m, { money, rowMoney: (v) => money(v) });
  ok(/Budget/.test(doc.title), 'a title');
  ok(doc.subtitle.includes('June 2026 to July 2026') && doc.subtitle.includes('2026-09-17 10:30'), 'subtitle states range and generated time');
  const notes = doc.blocks.filter(b => b.type === 'note').map(b => b.text).join('\n');
  ok(/Groceries/.test(notes) && /=Rent/.test(notes), 'the category filter is stated');
  ok(/€/.test(notes), 'held-out currency is stated');
  ok(/July 2026/.test(notes) && /in progress|not finished/i.test(notes), 'the in-progress period is stated — its column is a part-month beside whole ones');
  const tables = doc.blocks.filter(b => b.type === 'table');
  eq(tables[0].head, ['Category', 'June 2026', 'July 2026', 'Total', 'Average', 'Budgeted'], 'summary table');
  ok(tables[0].rows.every(r => r.length === tables[0].head.length), 'every PDF row is as wide as its header (exporter.test item 11\'s failure, not repeated here)');
  eq(tables[0].align.slice(1).every(a => a === 'right'), true, 'amount columns right-aligned');
  ok(tables[0].boldRows.length >= 1, 'subtotal rows are marked bold');
  ok(tables[0].rows.some(r => r.includes('R 5200.50')), 'amounts are formatted by the injected money()');
  eq(tables.length, 1 + 2 + 1, 'summary + one table per period + transactions');
  const headings = doc.blocks.filter(b => b.type === 'heading').map(b => b.text);
  ok(headings.some(h => h.includes('June 2026') && h.includes('May 23')), 'a period heading carries its exact dates');
  ok(doc.landscape === false, 'two periods fit a portrait page');

  // twelve+ periods
  const many = Array.from({ length: 14 }, (_, i) => ({ ...P[0], key: `p${i}`, name: `Period ${i + 1}` }));
  const big = bx.modelToDoc(bx.buildModel({ periods: many, content: 'summary', categories: null, includeTx: false, ...META }), { money });
  const t0 = big.blocks.find(b => b.type === 'table');
  eq(t0.head, ['Category', 'Total', 'Average', 'Budgeted'], 'past twelve periods the PDF summary drops the month columns');
  ok(big.blocks.some(b => b.type === 'note' && /Excel|CSV/i.test(b.text)), 'and says where they went');
  const six = bx.modelToDoc(bx.buildModel({ periods: many.slice(0, 6), content: 'summary', categories: null, includeTx: false, ...META }), { money });
  eq(six.landscape, true, 'six month columns want a landscape page');

  // labels are injectable, so the view can hand translated ones in
  const af = bx.modelToDoc(m, { money, labels: { category: 'Kategorie', total: 'Totaal' } });
  const h = af.blocks.find(b => b.type === 'table').head;
  ok(h[0] === 'Kategorie' && h.includes('Totaal') && h.includes('Average'), 'a partial label table overrides only what it names');
}

/* ================================ 10. file names ============================= */
{
  const m = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: true, ...META });
  const p = bx.budgetExportPaths(m, 'Admin/Tax 2026');
  eq(p.dir, 'Admin/Tax 2026', 'a nested destination survives');
  eq(p.pdf, 'Admin/Tax 2026/Budget June 2026 to July 2026.pdf', 'named by what is in it, so re-exporting overwrites rather than accumulating copies');
  eq(p.xlsx, 'Admin/Tax 2026/Budget June 2026 to July 2026.xlsx', 'workbook');
  eq(p.csv.transactions, 'Admin/Tax 2026/Budget June 2026 to July 2026 - Transactions.csv', 'each CSV names its table');
  const s = bx.buildModel({ periods: P.slice(0, 1), content: 'summary', categories: ['Fuel'], includeTx: false, ...META });
  eq(bx.budgetExportPaths(s, '').pdf, 'Exports/Budget summary June 2026 (Fuel).pdf', 'content and filter are part of the name — a filtered export must not overwrite the full one');
  const two = bx.buildModel({ periods: P.slice(0, 1), content: 'summary', categories: ['Groceries'], includeTx: false, ...META });
  ok(bx.budgetExportPaths(two, '').pdf !== bx.budgetExportPaths(s, '').pdf, 'nor may one filtered export overwrite a DIFFERENT filtered one: the name says which categories');
  const many = bx.buildModel({ periods: P, content: 'full', categories: ['Salary', 'Groceries', 'Fuel', '=Rent'], includeTx: false, ...META });
  eq(bx.budgetExportPaths(many, '').pdf, 'Exports/Budget June 2026 to July 2026 (4 categories).pdf', 'past three, the name counts them rather than growing without bound');
  eq(bx.budgetExportPaths(m, '../../secrets').dir, 'secrets', 'a traversal folder resolves to the folder actually named');
  const evil = bx.buildModel({ periods: [{ ...P[0], name: 'Pay/day: *June*' }], content: 'summary', categories: null, includeTx: false, ...META });
  ok(!/[\\:*?"<>|]/.test(bx.budgetExportPaths(evil, 'Exports').pdf.split('/').pop()), 'a period name cannot put a path character in the file name');
  eq(bx.budgetExportPaths(evil, 'Exports').pdf.split('/').length, 2, 'or a folder separator');
}

console.log(`PASS budget-export — ${checks} checks`);
