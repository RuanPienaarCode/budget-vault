'use strict';
/* The Transactions search box finds a row by its Note as well as its
   Description.

   A note is where a reader writes what the bank's description does not say
   ("Angi", "F12 ticket Christine", "#car-repairs"), and a search that could
   not see it sent them scrolling. This shipped first as a hand edit to a
   deployed main.js (1 Nov 2026) with no source behind it, so the next deploy
   would have quietly taken it away again; it lives in filteredRows() now,
   the one selection the table, the export and the bulk actions share.

   Driven through the REAL filteredRows over the REAL loader.
     node tests/transactions-search-note.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Gifts.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD
    + '| 2026-09-05 | Computicket Pty | Gifts | -250.00 |  | Miks |\n'
    + '| 2026-09-05 | Computicket Pty | Gifts | -250.00 |  | Angi |\n'
    + '| 2026-09-06 | Angi Florist | Gifts | -120.00 |  |  |\n'
    + '| 2026-09-07 | Corner Cafe | Gifts | -35.00 |  |  |\n',
};

(async () => {
  const unpin = pinClock('2026-09-30');
  try {
    const { ctx } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
    ctx.render = () => {};
    const search = q => { ctx.$('#txSearch').value = q; return ctx.filteredRows().rows.map(r => `${r.desc}/${r.note || ''}`).sort(); };

    eq(search('miks'), ['Computicket Pty/Miks'], 'a word only in the Note finds its row');
    eq(search('ANGI'), ['Angi Florist/', 'Computicket Pty/Angi'], 'one search matches the Description of one row and the Note of another, case folded');
    eq(search('computicket'), ['Computicket Pty/Angi', 'Computicket Pty/Miks'], 'the Description still matches as before');
    eq(search('nothing like it'), [], 'and a search that matches neither finds nothing');
    eq(search('').length, 4, 'an empty search keeps every row');
  } finally { unpin(); }
  console.log(`PASS — the Transactions search reads the Note as well as the Description (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
