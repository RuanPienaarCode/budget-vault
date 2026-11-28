'use strict';
/* The bulk-delete log keeps a deleted row's subcategory (follow-up to #188,
   after #184-#187).

   Data/Deleted transactions.csv is the way back from a bulk delete: the vault
   trash cannot undo a row removed from a month file, so the rows are appended
   to the log first and the log can be imported again. It wrote the nine
   columns of the day it was written and nothing else, so a row deleted with
   "Fuel" under "Car" came back, if it came back, as plain "Car" -- the label
   gone with no sign that it had been there.

   CONTRACT. appendTransactionsLog(existing, rows, symbolFor) keeps its
   signature and its rule that every value goes under ITS OWN column name:

     - NEEDED. A Subcategory column is added only when a row being logged
       carries one (subcategoryOf, so a stale cell on an uncategorised row is
       none, as it is in every figure). A log that never saw a subcategory
       keeps the header and the bytes it always had.
     - AT THE END. The column is appended after every column the log already
       has, never inserted, so no column moves and every earlier row keeps its
       meaning -- it reads blank in the new one, the way a log begun before the
       Currency column reads blank there.
     - ALREADY THERE. A log that already has a Subcategory column (ours, or one
       the reader's own tool added, wherever they put it) takes the value under
       that header by name, and a row with none writes a blank under it.
     - THE SAME ESCAPE as every other text cell (csvCell: commas, quotes, the
       formula guard).

   The "no subcategory" expectations are literals of the bytes the function
   produced before this change, so "unchanged" is checked against what shipped.

     node tests/transactions-delete-log-subcategory.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null, askSplit: async () => null, confirmModal: async () => true,
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { transactionsCsv, appendTransactionsLog } = require('../src/exporter');
const { parseCsv } = require('../src/csv');

const HEAD9 = 'Date,Description,Account,Category,Currency,Amount,Excluded,Note,Split';
const HEAD8 = 'Date,Description,Account,Category,Amount,Excluded,Note,Split';
const OLD9 = '2026-08-01,Bakery,Cheque,Food,R,-20.00,,,';
const OLD8 = '2026-08-01,Bakery,Cheque,Food,-20.00,,,';
const PLAIN = { date: '2026-09-03', desc: 'Corner Cafe', label: 'Cheque', cat: 'Food', amount: -35, excluded: false, note: '', split: '' };
const FUEL = { date: '2026-09-02', desc: 'Engen', label: 'Cheque', cat: 'Car', amount: -500, excluded: false, note: 'n', split: '', subcategory: 'Fuel' };
const sym = () => 'R';
const byName = text => {
  const [head, ...rows] = parseCsv(text);
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
};

(async () => {
  /* ---- 1. no log yet --------------------------------------------------- */
  {
    const out = appendTransactionsLog(null, [FUEL, PLAIN], sym);
    eq(out.split('\n')[0], `${HEAD9},Subcategory`, 'a first log with a subcategory in it ends its header with Subcategory');
    const rows = byName(out);
    eq([rows[0].Description, rows[0].Category, rows[0].Subcategory], ['Engen', 'Car', 'Fuel'], 'the deleted row\'s subcategory is under Subcategory');
    eq(rows[1].Subcategory, '', 'a row with none is blank in it');
    eq(rows[1].Amount, '-35.00', 'and its other values are where they were');
    eq(appendTransactionsLog(null, [PLAIN], sym), `${HEAD9}\n2026-09-03,Corner Cafe,Cheque,Food,R,-35.00,,,\n`,
      'a first log with no subcategory in it is the nine columns it always was, byte for byte');
    eq(appendTransactionsLog('', [PLAIN], sym), transactionsCsv([PLAIN], sym), 'an empty log likewise');
  }

  /* ---- 2. a log in today's nine columns --------------------------------- */
  {
    const log = `${HEAD9}\n${OLD9}\n`;
    eq(appendTransactionsLog(log, [PLAIN], sym), `${log}2026-09-03,Corner Cafe,Cheque,Food,R,-35.00,,,\n`,
      'no subcategory among the new rows: appended byte for byte as before');
    const out = appendTransactionsLog(log, [FUEL], sym);
    const lines = out.split('\n');
    eq(lines[0], `${HEAD9},Subcategory`, 'a subcategory grows the header at the END, nothing before it moves');
    eq(lines[1], OLD9, 'the earlier row is untouched');
    eq(lines[2], '2026-09-02,Engen,Cheque,Car,R,-500.00,,n,,Fuel', 'the new row has the value in the last column and a blank Split before it');
    const rows = byName(out);
    eq([rows[0].Amount, rows[0].Subcategory], ['-20.00', ''], 'the earlier row still reads its own Amount and is blank in the new column');
    eq(parseCsv(out).every(r => r.length <= 10), true, 'no row is wider than the header');
  }

  /* ---- 3. a log older than the Currency column --------------------------- */
  {
    const out = appendTransactionsLog(`${HEAD8}\n${OLD8}\n`, [FUEL], sym);
    const lines = out.split('\n');
    eq(lines[0], `${HEAD8},Currency,Subcategory`, 'both missing columns are appended, in the file\'s own column order, after what the log has');
    eq(lines[1], OLD8, 'the earlier row is untouched');
    const rows = byName(out);
    eq([rows[1].Amount, rows[1].Currency, rows[1].Subcategory], ['-500.00', 'R', 'Fuel'], 'each value of the new row sits under its own name');
    eq(rows[0].Amount, '-20.00', 'and the old row still reads its Amount under Amount');
  }

  /* ---- 4. a log that already has the column, wherever it sits ------------- */
  {
    const withIt = `${HEAD9},Subcategory\n${OLD9},\n2026-08-02,Engen,Cheque,Car,R,-90.00,,,,Fuel\n`;
    const out = appendTransactionsLog(withIt, [PLAIN, FUEL], sym);
    eq(out.split('\n')[0], `${HEAD9},Subcategory`, 'the header is left exactly as the log has it');
    const rows = byName(out);
    eq(rows.map(r => r.Subcategory), ['', 'Fuel', '', 'Fuel'], 'old rows keep theirs, new rows write theirs, a row with none is blank');
    const noneAtAll = appendTransactionsLog(withIt, [PLAIN], sym);
    eq(byName(noneAtAll).map(r => r.Description), ['Bakery', 'Engen', 'Corner Cafe'], 'a log with the column takes rows that have none too');
    eq(parseCsv(noneAtAll).slice(1).every(r => r.length <= 10), true, 'and stays within its width');

    const shuffled = 'Subcategory,Amount,Date,Description,Account,Category,Currency,Excluded,Note,Split\nFuel,-90.00,2026-08-02,Engen,Cheque,Car,R,,,\n';
    const s = byName(appendTransactionsLog(shuffled, [FUEL], sym));
    eq([s[1].Subcategory, s[1].Amount, s[1].Date, s[1].Category], ['Fuel', '-500.00', '2026-09-02', 'Car'],
      'a Subcategory column the reader put first is followed by name, not by position');
  }

  /* ---- 5. what counts as "has one" and how it is written ----------------- */
  {
    const stale = { ...PLAIN, cat: '', subcategory: 'Ghost' };
    eq(appendTransactionsLog(`${HEAD9}\n${OLD9}\n`, [stale], sym), `${HEAD9}\n${OLD9}\n2026-09-03,Corner Cafe,Cheque,,R,-35.00,,,\n`,
      'a subcategory on a row with no category is none (ADR-0010 section 1): no column is added for it');
    const odd = byName(appendTransactionsLog(null, [{ ...FUEL, subcategory: ' Tolls, e-tag ' }, { ...FUEL, subcategory: '=SUM(A1)' }], sym));
    eq(odd[0].Subcategory, 'Tolls, e-tag', 'trimmed, and a comma is quoted so it stays one cell');
    ok(odd[1].Subcategory.startsWith("'="), 'and the formula guard applies as it does to every text cell');
  }

  /* ---- 6. end to end through the real bulk delete over the real loader ---- */
  {
    const B = 'Budget';
    const LOG = `${B}/Data/Deleted transactions.csv`;
    const MONTH = `${B}/Transactions/Cheque/2026-09.md`;
    const FILES = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#888888"\nsubcategories: "Fuel, Services"\n---\n',
      [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
      [MONTH]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
        + '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n|------|-------------|----------|-------:|----------|------|-------------|\n'
        + '| 2026-09-02 | Engen | Car | -500.00 |  | tank | Fuel |\n'
        + '| 2026-09-03 | Corner Cafe | Food | -35.00 |  |  |  |\n',
      [LOG]: `${HEAD9}\n${OLD9}\n`,
    };
    const unpin = pinClock('2026-10-07');
    try {
      const { ctx } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
      ctx.render = () => {};
      ctx.$('#txSearch').value = 'engen';
      await ctx.deleteFilteredTransactions();
      ok(!ctx.vault._store.get(MONTH).includes('Engen'), 'fixture: the Fuel row was deleted');
      let rows = byName(ctx.vault._store.get(LOG));
      eq(rows.length, 2, 'the log holds the earlier row and the deleted one');
      eq([rows[1].Description, rows[1].Category, rows[1].Subcategory, rows[1].Amount], ['Engen', 'Car', 'Fuel', '-500.00'],
        'the row\'s subcategory survived the delete, in the log, under its own column');
      eq(ctx.vault._store.get(LOG).split('\n')[0], `${HEAD9},Subcategory`, 'and the log grew its column at the end');
      eq(rows[0].Subcategory, '', 'the earlier row reads blank in it');

      ctx.$('#txSearch').value = 'corner';
      await ctx.deleteFilteredTransactions();
      rows = byName(ctx.vault._store.get(LOG));
      eq(rows.map(r => [r.Description, r.Subcategory]), [['Bakery', ''], ['Engen', 'Fuel'], ['Corner Cafe', '']],
        'a later delete of a row with none is blank under the column the log now has, and the earlier values stay put');
    } finally { unpin(); }
  }

  console.log(`PASS transactions-delete-log-subcategory -- the delete log keeps a deleted row's subcategory (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
