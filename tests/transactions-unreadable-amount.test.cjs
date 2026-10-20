'use strict';
/* A transaction amount the loader cannot read is shown as what it is, not as a
   zero (2026-10-14 audit, L8-02).

   Month files are the household's own, and an amount cell is one hand-edit
   from "-13 038,0O" (a letter O for the zero) or "250.00.00". The loader's
   money parse keeps the text in `amountRaw` and hands the row a fabricated
   0 (amount.js warns that a fallback "must not be a plausible wrong number")
   — and the Transactions page printed that 0 as "R 0,00" with nothing to say
   the cell had not been read. The Accounts page already refuses to do this to
   a balance (acct.balance.unreadable); this is the same rule for a row.

   Only a cell normalizeAmount ALSO cannot read is "unreadable": "1 234,56" and
   "R1,234.56" keep their text in amountRaw for a lossless write-back, but they
   are read correctly, and calling them unreadable would un-fix a value the
   app already gets right (figures.js balanceReadable draws the same line).

   Driven through the REAL loader and the REAL renderTransactions.
     node tests/transactions-unreadable-amount.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const TX = `${B}/Transactions/Cheque/2026-09.md`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [TX]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD
    + '| 2026-09-02 | Flat rent | Rent | -13 038,0O |  |  |\n'
    + '| 2026-09-03 | Garage rent | Rent | 250.00.00 |  |  |\n'
    + '| 2026-09-04 | Water | Rent | -1 234,56 |  |  |\n'
    + '| 2026-09-05 | Pay | Salary | 20000.00 |  |  |\n',
};

const rowsOf = node => {
  const out = [];
  (function walk(n) { if (n.tagName === 'TR') out.push(n); (n.children || []).forEach(walk); })(node);
  return out;
};
const cellsOf = tr => (tr.children || []).filter(c => c.tagName === 'TD');
const hasClass = (n, c) => n.classList.contains(c);

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const { ctx, S, nodes } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
    const rows = Object.values(S.txFiles).flatMap(f => f.rows);
    const flat = rows.find(r => r.desc === 'Flat rent');
    eq([flat.amount, flat.amountRaw], [0, '-13 038,0O'], 'fixture: the loader holds a fabricated 0 and the cell\'s own text');
    ctx.renderTransactions();
    const table = ctx.$('#txTable');
    const byDesc = d => {
      const tr = rowsOf(table).find(r => cellsOf(r).some(c => c.textContent === d));
      assert.ok(tr, `row ${d} rendered`);
      return cellsOf(tr);
    };
    const AMOUNT = 4;
    const zero = ctx.money(0);

    const flatCells = byDesc('Flat rent');
    ok(flatCells[AMOUNT].textContent.includes('-13 038,0O'), 'an unreadable amount prints the text that is in the file');
    ok(!flatCells[AMOUNT].textContent.includes(zero), `and not the fabricated ${zero}`);
    ok(/could not read/i.test(flatCells[AMOUNT].textContent), 'and says in words that it could not be read');
    ok(hasClass(flatCells[AMOUNT], 'num') && flatCells[AMOUNT].className.split(' ')[0] === 'num', '`num` stays the cell\'s first class (the figures harness addresses td.num[4])');
    ok(hasClass(flatCells[AMOUNT], 'text-warning'), 'the cell is drawn as a warning, like an unreadable balance');

    const garage = byDesc('Garage rent');
    ok(garage[AMOUNT].textContent.includes('250.00.00') && /could not read/i.test(garage[AMOUNT].textContent), 'a second kind of unreadable cell is shown the same way');

    /* A readable amount prints as the flow it is, the sign before the symbol
       (2026-10-20 audit, D2-04; tests/transactions-amount-flow-sign.test.cjs). */
    const water = byDesc('Water');
    eq(water[AMOUNT].textContent, '−' + ctx.money(1234.56), 'a decimal-comma cell that IS readable prints its amount, no chip');
    ok(!/could not read/i.test(water[AMOUNT].textContent) && !hasClass(water[AMOUNT], 'text-warning'), 'and is not drawn as a warning');
    const pay = byDesc('Pay');
    eq(pay[AMOUNT].textContent, '+' + ctx.money(20000), 'a plain amount is untouched');
    ok(hasClass(pay[AMOUNT], 'text-success'), 'an income row keeps its colour');

    /* The page still saves what it read: the raw text goes back verbatim. */
    const out = ctx.serializeTxFile(S.txFiles['Cheque/2026-09']);
    ok(out.includes('| -13 038,0O |') && out.includes('| 250.00.00 |'), 'saving writes the unreadable cells back as they were');
    void nodes;
  } finally { unpin(); }
  console.log(`PASS transactions-unreadable-amount — an amount the app cannot read says so instead of printing a zero (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
