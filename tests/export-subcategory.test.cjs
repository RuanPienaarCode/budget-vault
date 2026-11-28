'use strict';
/* Transaction exports carry the subcategory (ADR-0010 section 6, issue #187,
   slice 4 of 4).

   CONTRACT, in the reader's terms:

     - WHEN. A Subcategory column exists only when the open BOOK uses
       subcategories (a name on a category note, or on any categorised row of any
       loaded month) -- not when the exported rows happen to carry one. A book
       with none exports exactly the bytes it exported before this slice.
     - WHERE. In the transactions CSV and Markdown it is the LAST column, after
       Split: no existing column moves, which is also what lets the bulk-delete
       log (appended by header name) take it at the end. In the budget export's
       workbook it sits directly after Category. In the Report's JSON rows it is a
       `subcategory` field directly after `category`.
     - WHICH. The budget export's CSV transactions file goes through the same
       exporter.transactionsCsv, so it takes the column too. The PDF does not, and
       neither does the Report's Markdown detail table (it shares the row template
       with the export, so the template's new column is opt-in).
     - WHAT. The cell is subcategoryOf(row): trimmed, and blank on a row with no
       category (ADR-0010 section 1). Text goes through the same escape as every
       other text cell: csvCell in CSV (comma quoting, formula guard), escMdText in
       Markdown.
     - NAMED. The header is translated where the other budget-export headers are
       (bx.doc.*), in all twelve languages. CSV and Markdown headers are the
       schema's English, like every other column of those two files.

   The no-subcategory expectations below are literals captured from the code as it
   stood before this slice (214814f), so "byte-identical" is checked against what
   shipped and not against the new code run twice.

     node tests/export-subcategory.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const folders = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => (folders.length ? { folder: folders.shift() } : null),
      askSplit: async () => null, confirmModal: async () => true,
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { createReport } = require('./helpers/report-page.cjs');
const F = require('./helpers/export-subcategory-fixture.cjs');
const ex = require('../src/exporter');
const bx = require('../src/budget-export');
const { budgetRowStatus } = require('../src/money-flow');
const { financialReportJson, financialReportMarkdown } = require('../src/report');
const { parseCsv } = require('../src/csv');
const { parseMdTable } = require('../src/markdown');
const { bookUsesSubcategories, bookUsesSubcategoriesIn } = require('../src/subcategories');
const i18n = require('../src/i18n');

const cellsOfMd = text => parseMdTable(text).slice(1);

(async () => {
  /* ======================================================================
     1. exporter.js, pure
     ====================================================================== */
  const PLAIN = F.withoutSubcategories(F.ROWS);

  /* -- a book with none: the bytes shipped in 1.61.0 -- */
  const OLD_CSV = 'Date,Description,Account,Category,Currency,Amount,Excluded,Note,Split\n'
    + '2026-09-01,Engen,Cheque,Car,R,-500.00,,,\n'
    + '2026-09-02,"\'=SUM(A1)",Cheque,Car,R,-65.50,,,\n'
    + '2026-09-03,Servicing | full,Cheque,Car,R,-900.00,,a|b,\n'
    + '2026-09-04,Cash,Cheque,,R,-300.00,,,\n'
    + '2026-09-05,Rent Berlin,Euro Savings,Home,€,-900.00,yes,moved,\n'
    + '2026-09-06,Takealot,Cheque,Home,R,-300.00,,,parent\n'
    + '2026-09-06,Takealot kettle,Cheque,Home,R,-200.00,,,part\n'
    + '2026-09-06,Takealot lamp,Cheque,Home,R,-100.00,,,part\n';
  const OLD_MD_TABLE = '| Date | Description | Account | Category | Currency | Amount | Excluded | Note | Split |\n'
    + '|------|-------------|---------|----------|----------|-------:|----------|------|-------|\n'
    + '| 2026-09-01 | Engen | Cheque | Car | R | R -500.00 |  |  |  |\n'
    + '| 2026-09-02 | =SUM(A1) | Cheque | Car | R | R -65.50 |  |  |  |\n'
    + '| 2026-09-03 | Servicing &#124; full | Cheque | Car | R | R -900.00 |  | a&#124;b |  |\n'
    + '| 2026-09-04 | Cash | Cheque |  | R | R -300.00 |  |  |  |\n'
    + '| 2026-09-05 | Rent Berlin | Euro Savings | Home | € | € -900.00 | yes | moved |  |\n'
    + '| 2026-09-06 | Takealot | Cheque | Home | R | R -300.00 |  |  | parent |\n'
    + '| 2026-09-06 | Takealot kettle | Cheque | Home | R | R -200.00 |  |  | part |\n'
    + '| 2026-09-06 | Takealot lamp | Cheque | Home | R | R -100.00 |  |  | part |\n';
  const tableOf = md => md.slice(md.indexOf('| Date'));

  eq(ex.transactionsCsv(PLAIN, F.symbolFor), OLD_CSV, 'no option: the CSV is the 1.61.0 bytes');
  eq(ex.transactionsCsv(PLAIN, F.symbolFor, { subcategory: false }), OLD_CSV, 'option off: the same bytes');
  eq(ex.transactionsCsv(F.ROWS, F.symbolFor), OLD_CSV, 'rows that carry a subcategory, option off: still the same bytes (the book decides, not the rows)');
  eq(tableOf(ex.transactionsMarkdown(PLAIN, F.META, F.money, F.symbolFor)), OLD_MD_TABLE, 'no option: the Markdown table is the 1.61.0 bytes');
  eq(tableOf(ex.transactionsMarkdown(F.ROWS, { ...F.META, subcategory: false }, F.money, F.symbolFor)), OLD_MD_TABLE, 'option off, rows carrying one: the same bytes');
  eq(ex.txHeaderLines()[0], '| Date | Description | Account | Category | Currency | Amount | Excluded | Note | Split |', 'txHeaderLines() with no argument is unchanged (the Report detail table draws through it)');
  eq(ex.transactionRow(F.ROWS[0], F.money, F.symbolFor), '| 2026-09-01 | Engen | Cheque | Car | R | R -500.00 |  |  |  |', 'transactionRow() with no flag is unchanged');

  /* -- a book with some: the column, last -- */
  const csv = ex.transactionsCsv(F.ROWS, F.symbolFor, { subcategory: true });
  const grid = parseCsv(csv);
  eq(grid[0], ['Date', 'Description', 'Account', 'Category', 'Currency', 'Amount', 'Excluded', 'Note', 'Split', 'Subcategory'], 'CSV: Subcategory is appended after Split');
  eq(grid[0].slice(0, 9), parseCsv(OLD_CSV)[0], 'and the nine existing headers keep their order');
  const oldGrid = parseCsv(OLD_CSV);
  eq(grid.map(r => r.slice(0, 9)), oldGrid, 'every existing cell of every row is where it was');
  eq(grid.slice(1).map(r => r[9]), ['Fuel', 'Tolls, e-tag', '', '', "'@levy", '', 'Kitchen', ''],
    'the cell is the row\'s subcategory (a formula-leading one behind csvCell\'s guard, as a Description is); blank for none and for the row with no category');
  ok(csv.includes('"Tolls, e-tag"'), 'a comma in a name is quoted by csvCell');
  ok(csv.includes("\"'@levy\""), 'and a name opening with a formula character gets the same guard as any other text cell');
  ok(grid.every(r => r.length === 10), 'every row is as wide as the header');

  const md = ex.transactionsMarkdown(F.ROWS, { ...F.META, subcategory: true }, F.money, F.symbolFor);
  const table = parseMdTable(tableOf(md));
  eq(table[0], ['Date', 'Description', 'Account', 'Category', 'Currency', 'Amount', 'Excluded', 'Note', 'Split', 'Subcategory'], 'Markdown: Subcategory is appended after Split');
  eq(ex.txHeaderLines(true)[1].split('|').length, 12, 'the separator row has the same width');
  ok(table.slice(1).every(r => r.length === 10), 'every Markdown row is as wide as the header');
  eq(table.slice(1).map(r => r[9]), ['Fuel', 'Tolls, e-tag', '', '', '@levy', '', 'Kitchen', ''],
    'cells carry the name');
  ok(ex.transactionRow({ ...F.ROWS[0], subcategory: 'Fuel | ![x](https://attacker.example/p.png)' }, F.money, F.symbolFor, true).endsWith(`| ${require('../src/markdown').escMdText('Fuel | ![x](https://attacker.example/p.png)')} |`),
    'and, escaped as every Markdown text cell is, a name cannot split a cell or fetch an image');
  ok(tableOf(md).split('\n').slice(2).every((line, i) => line.startsWith(OLD_MD_TABLE.split('\n')[i + 2].slice(0, -1))),
    'each Markdown row begins with exactly the bytes it had before');
  eq(ex.txHeaderLines(true)[1].split('|').slice(-3, -1).join('|'), '-------|-------------', 'the separator row sizes the new column to its header');
  ok(md.includes('Money in **R 0.00**'), 'the totals line is unchanged');

  /* the bulk-delete log is appended by header name and is not part of this slice */
  eq(ex.appendTransactionsLog('', F.ROWS, F.symbolFor), OLD_CSV, 'the delete log still writes today\'s nine columns');

  /* a row with no category cannot carry one, whatever the cell says */
  eq(parseCsv(ex.transactionsCsv([{ ...F.ROWS[3] }], F.symbolFor, { subcategory: true }))[1][9], '', 'a stray subcategory on an uncategorised row reads blank');
  eq(parseCsv(ex.transactionsCsv([{ ...F.ROWS[0], subcategory: '  Fuel  ' }], F.symbolFor, { subcategory: true }))[1][9], 'Fuel', 'and a padded one is trimmed');

  /* ======================================================================
     2. the book question
     ====================================================================== */
  ok(bookUsesSubcategoriesIn({ categories: [], txFiles: { a: { rows: [{ cat: 'Car', subcategory: 'Fuel' }] } } }), 'a categorised row with one, in any loaded month');
  ok(bookUsesSubcategoriesIn({ categories: [{ name: 'Car', subcategories: ['Fuel'] }], txFiles: {} }), 'a name on a category note');
  ok(!bookUsesSubcategoriesIn({ categories: [{ name: 'Car' }], txFiles: { a: { rows: [{ cat: '', subcategory: 'Ghost' }, { cat: 'Car' }] } } }), 'none, and a stray cell on an uncategorised row does not count');
  ok(!bookUsesSubcategoriesIn({}), 'an empty state is a book with none, not an error');
  eq(bookUsesSubcategoriesIn({ categories: [{ name: 'Car' }], txFiles: { a: { rows: [{ cat: 'Car', subcategory: 'Fuel' }] }, b: { rows: [] } } }),
    bookUsesSubcategories([{ name: 'Car' }], [{ cat: 'Car', subcategory: 'Fuel' }]), 'it asks the same question the Transactions page asks');

  /* ======================================================================
     3. the budget export, pure
     ====================================================================== */
  const row = (cat, type, budget, actual) => ({ cat, type, budget, actual, notes: '', assumed: false, ...budgetRowStatus({ budget, actual, type }) });
  const periods = txs => [{ key: '2026-09', name: 'September 2026', title: '', start: '2026-09-01', end: '2026-09-30',
    rows: [row('Car', 'expense', 2000, 1465.5), row('Home', 'expense', 1000, 600)], summary: null, txs }];
  const model = (txs, subcategories) => bx.buildModel({ periods: periods(txs), content: 'full', categories: null, includeTx: true,
    generated: '2026-10-01 12:00', currency: 'R', ...(subcategories === undefined ? {} : { subcategories }) });
  const L = bx.LABELS;
  const sheetOf = (m, labels) => bx.modelToSheets(m, { symbolFor: F.symbolFor, labels }).find(s => s.name === 'Transactions');

  const OLD_HEAD = ['Date', 'Description', 'Account', 'Category', 'Currency', 'Amount', 'Flag', 'Notes'];
  const plainSheet = sheetOf(model(PLAIN));
  eq(plainSheet.rows[0].map(c => (c && c.v) || c), OLD_HEAD, 'workbook, no subcategory: the eight headers it always had');
  eq(plainSheet.widths, [12, 40, 18, 22, 9, 14, 14, 30], 'and the widths');
  eq(plainSheet.rows[1], ['2026-09-01', 'Engen', 'Cheque', 'Car', 'R', { s: 'money', v: -500 }, '', ''], 'and a row of the same eight cells');
  eq(sheetOf(model(F.ROWS, false)), plainSheet, 'subcategory off, rows carrying one: the sheet is identical');
  eq(sheetOf(model(F.ROWS)), plainSheet, 'flag absent: identical');

  const subSheet = sheetOf(model(F.ROWS, true));
  eq(subSheet.rows[0].map(c => (c && c.v) || c), ['Date', 'Description', 'Account', 'Category', 'Subcategory', 'Currency', 'Amount', 'Flag', 'Notes'],
    'workbook, with subcategories: Subcategory sits directly after Category');
  eq(subSheet.widths.length, 9, 'one width per column');
  eq(subSheet.widths.slice(0, 4), [12, 40, 18, 22], 'the columns before it keep theirs');
  eq(subSheet.widths.slice(5), [9, 14, 14, 30], 'and the columns after it keep theirs');
  eq(subSheet.rows.slice(1).map(r => r[4]), ['Fuel', 'Tolls, e-tag', '', '', '@levy', '', 'Kitchen', ''], 'the cells are the subcategories, blank for none and for an uncategorised row');
  eq(subSheet.rows.slice(1).map(r => r.slice(0, 4).concat(r.slice(5))), plainSheet.rows.slice(1), 'every other cell of every row is where it was');
  eq(subSheet.rows[0][4].s, plainSheet.rows[0][3].s, 'the header cell is styled like its neighbours');
  eq(sheetOf(model(F.ROWS, true), { subcategory: 'Sous-catégorie' }).rows[0][4].v, 'Sous-catégorie', 'the header is the translated label when one is handed in');
  ok(typeof L.subcategory === 'string' && L.subcategory === 'Subcategory', 'and the English default is Subcategory');

  const csvKinds = m => Object.fromEntries(bx.modelToCsv(m, { symbolFor: F.symbolFor }).map(f => [f.kind, f.text]));
  eq(csvKinds(model(PLAIN)).transactions, OLD_CSV, 'budget export CSV, no subcategory: the 1.61.0 bytes');
  eq(csvKinds(model(F.ROWS, false)).transactions, OLD_CSV, 'off, rows carrying one: the same bytes');
  eq(csvKinds(model(F.ROWS, true)).transactions, csv, 'with subcategories: the transactions CSV, Subcategory last, as the export\'s own');

  /* The PDF is the same document whatever the book holds. */
  const doc = m => bx.modelToDoc(m, { money: v => `R ${Number(v).toFixed(2)}`, rowMoney: (v, r) => F.money(v, r), plainMoney: v => String(v), labels: {}, decimal: '.' });
  eq(doc(model(F.ROWS, true)), doc(model(PLAIN)), 'the PDF document is identical with and without subcategories, in the rows or in the book');
  eq(doc(model(F.ROWS, false)), doc(model(PLAIN)), 'and with the flag off');
  const pdfTable = doc(model(F.ROWS, true)).blocks.find(b => b.type === 'table' && b.head.includes('Flag'));
  eq(pdfTable.head, ['Date', 'Description', 'Account', 'Category', 'Amount', 'Flag'], 'its transaction table is still six columns');

  /* ======================================================================
     4. the Report's JSON rows, pure
     ====================================================================== */
  const DATA = {
    generated: '2026-10-01 12:00', periodLabel: 'September 2026', rangeNote: '1-30 Sep 2026', detail: 'detail', currency: 'R',
    income: 0, spend: 2365.5, net: -2365.5, budgetIncome: 0, budgetSpend: 3000,
    categories: [], spendByCategory: [], categoryGap: { uncat: 0, netted: 0 },
    savings: null, debts: null, netWorth: { net: 0, assets: 0, liabilities: 0 }, health: null,
    transactions: F.ROWS.map(r => ({ ...r, currency: F.symbolFor(r) })),
  };
  const jsonRows = d => JSON.parse(financialReportJson(d)).transactions;
  const OLD_KEYS = ['date', 'description', 'account', 'category', 'currency', 'amount', 'excluded', 'note', 'split'];
  eq(Object.keys(jsonRows(DATA)[0]), OLD_KEYS, 'JSON rows, flag absent: the nine fields they always had');
  eq(Object.keys(jsonRows({ ...DATA, subcategories: false })[0]), OLD_KEYS, 'flag off, rows carrying one: the same nine');
  const withSub = jsonRows({ ...DATA, subcategories: true });
  eq(Object.keys(withSub[0]), ['date', 'description', 'account', 'category', 'subcategory', 'currency', 'amount', 'excluded', 'note', 'split'],
    'JSON rows, with subcategories: a `subcategory` field directly after `category`');
  eq(withSub.map(r => r.subcategory), ['Fuel', 'Tolls, e-tag', '', '', '@levy', '', 'Kitchen', ''], 'holding the name, an empty string for none (as `category` does) and for an uncategorised row');
  eq(withSub.map(r => { const { subcategory, ...rest } = r; return rest; }), jsonRows(DATA), 'and nothing else in any row changed');
  ok(!financialReportMarkdown({ ...DATA, subcategories: true }, v => `R ${v}`).includes('Subcategory'), 'the Report\'s Markdown detail table is not part of this slice');

  /* ======================================================================
     5. translated where the other headers are
     ====================================================================== */
  {
    const { TABLES } = i18n;
    const langs = Object.keys(TABLES);
    eq(langs.length, 12, 'twelve languages');
    for (const code of langs) {
      const v = TABLES[code]['bx.doc.subcategory'];
      ok(typeof v === 'string' && v.trim() !== '', `${code}: bx.doc.subcategory is there`);
      eq(v, TABLES[code]['tx.field.subcategory'], `${code}: and is the word the Transactions page already uses for it`);
    }
  }

  /* ======================================================================
     6. end to end, over the real loader and views
     ====================================================================== */
  const B = 'Budget';
  const FM = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n';
  const HEAD7 = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
  const HEAD8 = '| Date | Description | Category | Amount | Excluded | Note | Split | Subcategory |\n|---|---|---|---:|---|---|---|---|\n';
  const book = withSubs => ({
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-08-31\n---\n',
    [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Car | expense | 2000.00 | |\n| Groceries | expense | 1000.00 | |\n',
    [`${B}/Transactions/Cheque/2026-09.md`]: FM + (withSubs
      ? HEAD8 + '| 2026-09-01 | Engen | Car | -500.00 |  |  |  | Fuel |\n| 2026-09-02 | Servicing | Car | -900.00 |  |  |  |  |\n| 2026-09-03 | Checkers | Groceries | -250.00 |  |  |  |  |\n'
      : HEAD7 + '| 2026-09-01 | Engen | Car | -500.00 |  |  |  |\n| 2026-09-02 | Servicing | Car | -900.00 |  |  |  |\n| 2026-09-03 | Checkers | Groceries | -250.00 |  |  |  |\n'),
  });
  const ANSWER = { mode: 'months', range: '1', includeCurrent: true, content: 'full', categories: null, includeTx: true, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };
  const lines = text => text.replace(/\n$/, '').split('\n');

  async function run(files, { lang = 'en' } = {}) {
    const unpin = pinClock('2026-09-10');
    try {
      /* The language is the book's own (Settings.md `language:`): load.js applies it on
         every read, so setting it on i18n before the mount would be undone. */
      const f = lang === 'en' ? files : { ...files, [`${B}/Settings.md`]: files[`${B}/Settings.md`].replace('---\n', `---\nlanguage: ${lang}\n`) };
      const M = await mountFor(f, { period: '2026-09', budgetFolder: B });
      const { ctx } = M;
      const store = ctx.vault._store;
      const out = {};
      folders.push('Exports');
      await ctx.exportTransactions();
      const key = ext => [...store.keys()].find(k => k.startsWith('Exports/Transactions') && k.endsWith(ext));
      out.txCsv = store.get(key('.csv'));
      out.txMd = store.get(key('.md'));
      const { written } = await ctx.runBudgetExport(ANSWER);
      out.written = written;
      out.pdf = store.get(written.find(p => p.endsWith('.pdf')));
      out.xlsx = store.get(written.find(p => p.endsWith('.xlsx')));
      out.bxCsv = store.get(written.find(p => /Transactions\.csv$/.test(p)));
      /* A category filter that leaves no row carrying a subcategory, in a book that has some. */
      const only = await ctx.runBudgetExport({ ...ANSWER, categories: ['Groceries'], formats: ['xlsx', 'csv'] });
      out.onlyCsv = store.get(only.written.find(p => /Transactions\.csv$/.test(p)));
      out.onlyXlsx = store.get(only.written.find(p => p.endsWith('.xlsx')));
      out.report = (await createReport(M, { detail: 'detail', json: true }));
      out.described = ctx.describeBudgetExport(ANSWER).files;
      return out;
    } finally { i18n.setLanguage('en'); unpin(); }
  }
  const asText = v => (typeof v === 'string' ? v : new TextDecoder('latin1').decode(new Uint8Array(v)));

  const plain = await run(book(false));
  const subs = await run(book(true));

  /* -- a book with none -- */
  eq(lines(plain.txCsv)[0], 'Date,Description,Account,Category,Currency,Amount,Excluded,Note,Split', 'no subcategory: the transactions CSV header is today\'s');
  ok(!plain.txMd.includes('Subcategory'), 'the transactions Markdown has no such column');
  ok(!asText(plain.xlsx).includes('Subcategory'), 'the workbook has no such column');
  eq(lines(plain.bxCsv)[0], 'Date,Description,Account,Category,Currency,Amount,Excluded,Note,Split', 'nor the budget export\'s CSV');
  ok(!('subcategory' in plain.report.json.transactions[0]), 'nor the Report JSON');
  eq(plain.report.json.transactions.length, 3, 'Report JSON still lists the rows');

  /* -- a book with subcategories -- */
  eq(lines(subs.txCsv)[0], 'Date,Description,Account,Category,Currency,Amount,Excluded,Note,Split,Subcategory', 'transactions CSV: the column is last');
  const subOfDesc = grid => Object.fromEntries(grid.slice(1).map(r => [r[1], r[9]]));
  eq(subOfDesc(parseCsv(subs.txCsv)), { Engen: 'Fuel', Servicing: '', Checkers: '' }, 'carrying the name from the month file, through the real loader');
  eq(lines(subs.txCsv).map(l => l.split(',').slice(0, 9).join(',')), lines(plain.txCsv), 'and every other cell is what the book without subcategories exports');
  ok(/\| Split \| Subcategory \|\n/.test(subs.txMd), 'transactions Markdown: the column is last');
  eq(Object.fromEntries(cellsOfMd(subs.txMd.slice(subs.txMd.indexOf('| Date'))).map(r => [r[1], r[9]])), { Engen: 'Fuel', Servicing: '', Checkers: '' }, 'with the name');
  eq(lines(subs.bxCsv)[0], 'Date,Description,Account,Category,Currency,Amount,Excluded,Note,Split,Subcategory', 'budget export CSV: last, as in the transactions export');
  ok(asText(subs.xlsx).includes('Subcategory'), 'the workbook has the column, headed in English');
  eq(Object.keys(subs.report.json.transactions[0]).slice(3, 6), ['category', 'subcategory', 'currency'], 'Report JSON: directly after category');
  eq(Object.fromEntries(subs.report.json.transactions.map(r => [r.description, r.subcategory])), { Engen: 'Fuel', Servicing: '', Checkers: '' }, 'carrying the name');
  ok(!subs.report.md.includes('Subcategory'), 'the Report Markdown is not changed');

  /* -- the book decides, not the rows being exported -- */
  eq(parseCsv(subs.onlyCsv).map(r => r.length), [10, 10], 'filtered to a category whose rows carry none, a book with subcategories still exports the column (header plus the one row)');
  eq(parseCsv(subs.onlyCsv)[1][9], '', 'blank for that row');
  ok(asText(subs.onlyXlsx).includes('Subcategory'), 'and the workbook');
  eq(parseCsv(plain.onlyCsv).map(r => r.length), [9, 9], 'while a book without them, filtered the same way, exports today\'s nine');

  /* -- the PDF, byte for byte, whatever the book holds -- */
  ok(asText(subs.pdf).length > 1000, 'a PDF was written');
  /* The same rows and figures, once in a book with the Subcategory column and
     once in a book without: nothing but a subcategory could make them differ. */
  eq(asText(subs.pdf), asText(plain.pdf), 'the PDF is byte-identical for a book with subcategories and the same book without');

  /* -- the preview names the same files -- */
  eq(subs.described, subs.written, 'the preview names exactly the files the click wrote');
  eq(plain.described, plain.written, 'and for a book without');
  eq(subs.written, plain.written, 'a subcategory adds no file');

  /* -- translated -- */
  const fr = await run(book(true), { lang: 'fr' });
  ok(Buffer.from(asText(fr.xlsx), 'latin1').toString('utf8').includes(i18n.TABLES.fr['tx.field.subcategory']), 'the workbook header is in the household\'s language');
  eq(lines(fr.txCsv)[0].split(',').pop(), 'Subcategory', 'while the CSV header stays the schema\'s, like every other column of that file');

  console.log(`PASS export-subcategory (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
