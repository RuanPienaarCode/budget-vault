'use strict';
/* The bulk-delete log puts every value under its own column, whatever shape
   the log already has.

   Deleting what the filters select first appends the doomed rows to
   Data/Deleted transactions.csv — the way back, since the vault trash cannot
   undo a row removed from a file. It appended them in transactionsCsv's
   CURRENT column layout under whatever header the log already carried
   (2026-10-07 audit, L4a). A log started before the Currency column existed
   has eight columns; nine-cell rows under it put every Amount under
   "Currency", every Excluded under "Amount", and so on — the one record of
   what was deleted, unreadable from the moment the layout moved, and read back
   by the importer (which matches columns by NAME) as the wrong figures.

   Now the new rows are written under the log's OWN header, mapped by name. A
   column the log lacks is appended at the END of its header, so no existing
   column moves and every earlier row keeps its meaning (it reads blank in the
   new column). One log is kept, rather than a second file started whenever
   the layout differs: the way back stays in the one place the delete's own
   dialog names. A log already in today's layout is appended to exactly as
   before.

   Pinned on exporter.js's appendTransactionsLog, then end to end through the
   REAL deleteFilteredTransactions over the REAL loader.
     node tests/transactions-delete-log-header.test.cjs */

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

const ROW = { date: '2026-09-02', desc: 'Corner Cafe', label: 'Cheque', cat: 'Food', amount: -35, excluded: false, note: 'dup', split: '' };
const OLD_HEAD = 'Date,Description,Account,Category,Amount,Excluded,Note,Split';
const OLD_ROW = '2026-08-01,Bakery,Cheque,Food,-20.00,,,';
const byName = (text) => {
  const [head, ...rows] = parseCsv(text);
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
};

(async () => {
  ok(typeof appendTransactionsLog === 'function', 'exporter.js publishes appendTransactionsLog');

  /* ---- 1. no log yet, and a log already in today's layout ---------------- */
  eq(appendTransactionsLog(null, [ROW]), transactionsCsv([ROW]), 'no log: the file starts as a transactions export');
  eq(appendTransactionsLog('', [ROW]), transactionsCsv([ROW]), 'an empty log likewise');
  const current = transactionsCsv([{ ...ROW, desc: 'Earlier' }]);
  eq(appendTransactionsLog(current, [ROW], () => 'R'), current + transactionsCsv([ROW], () => 'R').split('\n').slice(1).join('\n'),
    'a log in today\'s layout is appended to byte for byte as before');

  /* ---- 2. an older layout: mapped by name, missing columns at the end ------ */
  {
    const old = `${OLD_HEAD}\n${OLD_ROW}\n`;
    const out = appendTransactionsLog(old, [ROW], () => 'R');
    const lines = out.split('\n');
    eq(lines[0], `${OLD_HEAD},Currency`, 'the column the log lacks is added at the END of its header — no existing column moves');
    eq(lines[1], OLD_ROW, 'the earlier row is untouched');
    const rows = byName(out);
    eq(rows[0].Amount, '-20.00', 'and still reads its own Amount under "Amount"');
    eq(rows[0].Currency, '', 'blank in the column it never had');
    eq([rows[1].Date, rows[1].Description, rows[1].Amount, rows[1].Currency, rows[1].Note], ['2026-09-02', 'Corner Cafe', '-35.00', 'R', 'dup'],
      'the new row\'s values sit under their own names (before: Amount under "Currency")');
    eq(parseCsv(out).every(r => r.length <= lines[0].split(',').length), true, 'no row is wider than the header');
  }
  {
    const shuffled = 'Amount,Date,Description,Account,Category,Currency,Excluded,Note,Split\n-20.00,2026-08-01,Bakery,Cheque,Food,R,,,\n';
    const rows = byName(appendTransactionsLog(shuffled, [ROW], () => 'R'));
    eq([rows[1].Amount, rows[1].Date, rows[1].Currency], ['-35.00', '2026-09-02', 'R'], 'a reordered header is followed, column by column');
  }

  /* ---- 3. end to end through the real bulk delete -------------------------- */
  const B = 'Budget';
  const LOG = `${B}/Data/Deleted transactions.csv`;
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
    [`${B}/Transactions/Cheque/2026-09.md`]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
      + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
      + '| 2026-09-02 | Corner Cafe | Food | -35.00 |  | dup |\n| 2026-09-03 | Bakery | Food | -20.00 |  |  |\n',
    [LOG]: `${OLD_HEAD}\n${OLD_ROW}\n`,
  };
  const unpin = pinClock('2026-10-07');
  try {
    const { ctx } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
    ctx.render = () => {};
    ctx.$('#txSearch').value = 'corner';
    await ctx.deleteFilteredTransactions();
    ok(!ctx.vault._store.get(`${B}/Transactions/Cheque/2026-09.md`).includes('Corner Cafe'), 'fixture: the row was deleted');
    const rows = byName(ctx.vault._store.get(LOG));
    eq(rows.length, 2, 'the log holds the earlier row and the new one');
    eq([rows[1].Description, rows[1].Amount, rows[1].Account], ['Corner Cafe', '-35.00', 'Cheque'],
      'the deleted row can be read back by name — its amount under Amount, ready to import again');
  } finally { unpin(); }

  console.log(`PASS transactions-delete-log-header — the delete log keeps every value under its own column (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
