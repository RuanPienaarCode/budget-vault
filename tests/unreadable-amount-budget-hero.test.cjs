'use strict';
/* An amount cell the loader cannot read counted as 0 and said nothing
   (2026-10-14 audit, L8-02, Budget page and Dashboard hero; the Transactions
   row is another lane's).

   The loader reads "7000.00.00" as 0 and keeps the typed text in `amountRaw`
   so a save writes it back. Everything downstream saw 0: on the vault this was
   found against, the Budget field showed blank, the hero's remaining figure
   fell by exactly the typed amount, and no page said an amount had been typed.
   The Accounts page already argues the same case for a balance
   ('Could not read "{raw}" — click to fix'); this is that pattern for a budget
   row, plus one sentence on the hero for any budget amount or in-period
   transaction amount that is counting as 0.

   Readable-but-not-canonical cells ("7 000,00") are real money and must stay
   silent: that is the control.

     node tests/unreadable-amount-budget-hero.test.cjs */
const assert = require('assert');
const { B, tx, base, account, textOf, find, hasClass, renderDash, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const { amountUnreadable } = require('../src/figures');
const { heroQualifiers } = require('../src/views/dashboard');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the one test ---- */
eq(amountUnreadable({ amount: 0, amountRaw: '7000.00.00' }), true, 'a cell with no number is unreadable');
eq(amountUnreadable({ amount: 7000, amountRaw: '7 000,00' }), false, 'a grouped decimal-comma cell is real money');
eq(amountUnreadable({ amount: 100, amountRaw: null }), false, 'a canonical cell keeps no raw');
eq(amountUnreadable({ amount: 100 }), false, 'a row minted in memory has none either');
eq(amountUnreadable(null), false, 'no row, no verdict');

const BUDGET = amount => '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + `| Salary | income | 30000.00 |  |\n| Groceries | expense | ${amount} |  |\n`;
const vault = ({ budgetCell = '5000.00', rows = [] } = {}) => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '5000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: BUDGET(budgetCell),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-01', 'Salary', 'Salary', 30000], ...rows]),
});
/* tx() formats the amount with toFixed, so an unreadable cell is spliced in afterwards. */
const withBadTx = (files, rawCell) => {
  const k = `${B}/Transactions/Cheque/2026-09.md`;
  files[k] = files[k].replace(/\| -?\d+\.00 \|/, `| ${rawCell} |`);
  return files;
};

async function budgetPage(files) {
  const unpin = pinClock('2026-09-20');
  try {
    const M = await mountFor(files, { period: '2026-09' });
    M.ctx.switchView = () => {};
    M.ctx.renderBudgets();
    return M;
  } finally { unpin(); }
}

(async () => {
  /* ---- Budget page ---- */
  {
    const M = await budgetPage(vault({ budgetCell: '7000.00.00' }));
    const table = M.nodes.get('#budTable');
    const inputs = find(table, n => (n.attrs || {})['aria-invalid'] === 'true');
    eq(inputs.length, 1, 'exactly the one unreadable row gets the text field');
    eq(inputs[0].attrs.value, '7000.00.00', 'it shows what was typed, not a blank');
    const row = textOf(table);
    ok(/Could not read/.test(row), `the row says it could not read it — got: ${row}`);
    ok(/Could not read "7000\.00\.00" — it counts as 0/.test(row), 'and the detail names the text and what happens to it');
    ok(find(table, n => hasClass(n, 'caveat-chip-btn')).length === 1, 'as a real button chip (tap-reachable, not a hover title)');
  }
  /* Retyping it repairs the row and the sentence goes. */
  {
    const M = await budgetPage(vault({ budgetCell: '7000.00.00' }));
    const input = find(M.nodes.get('#budTable'), n => (n.attrs || {})['aria-invalid'] === 'true')[0];
    input.value = '4000';
    input._fire('change');
    const after = textOf(M.nodes.get('#budTable'));
    ok(!/Could not read/.test(after), `a valid retype clears the chip — got: ${after}`);
    ok(/Total budgeted R 4 000 /.test(textOf(M.nodes.get('#budTotalsTop'))),
      `and the typed amount now counts in the plan — got: ${textOf(M.nodes.get('#budTotalsTop'))}`);
  }
  /* Control: readable but not canonical stays silent. */
  {
    const M = await budgetPage(vault({ budgetCell: '5 000,00' }));
    const t = textOf(M.nodes.get('#budTable'));
    ok(!/Could not read/.test(t), `control: "5 000,00" is money, not an error — got: ${t}`);
    eq(find(M.nodes.get('#budTable'), n => (n.attrs || {})['aria-invalid'] === 'true').length, 0, 'control: no text field swap either');
  }

  /* ---- Dashboard hero ---- */
  {
    const one = await renderDash(vault({ budgetCell: '7000.00.00' }), { today: '2026-09-20', period: '2026-09' });
    ok(/1 amount could not be read and counts as 0/.test(one.t('#heroCard')), `one budget cell, singular — got: ${one.t('#heroCard')}`);

    const two = await renderDash(withBadTx(vault({ budgetCell: '7000.00.00', rows: [['2026-09-05', 'Checkers', 'Groceries', -250]] }), '-2x0.00'),
      { today: '2026-09-20', period: '2026-09' });
    /* The salary row is first in the file, so the splice hits it: the point is that a TRANSACTION cell is counted too. */
    ok(/2 amounts could not be read and count as 0/.test(two.t('#heroCard')), `a budget cell and a transaction cell, plural — got: ${two.t('#heroCard')}`);

    const none = await renderDash(vault({ budgetCell: '5 000,00' }), { today: '2026-09-20', period: '2026-09' });
    ok(!/could not be read/.test(none.t('#heroCard')), 'control: a readable cell adds no sentence');

    /* A bad cell in ANOTHER period, and one on an excluded row, are not this figure's. */
    const other = vault();
    other[`${B}/Transactions/Cheque/2026-08.md`] = tx([['2026-08-05', 'Old', 'Groceries', -10]]).replace(/\| -10\.00 \|/, '| ??? |');
    other[`${B}/Transactions/Cheque/2026-09.md`] += '| 2026-09-06 | Vetoed | Groceries | ?!? | yes |  |  |\n';
    const quiet = await renderDash(other, { today: '2026-09-20', period: '2026-09' });
    ok(!/could not be read/.test(quiet.t('#heroCard')), `an earlier period's cell and an excluded row are not this period's — got: ${quiet.t('#heroCard')}`);
  }

  /* ---- the qualifier builder (what the API hands Vista) ---- */
  {
    const money = (v, d) => `R ${Number(v).toFixed(d)}`;
    const q = heroQualifiers({ used: {}, summary: {}, gap: {}, unreadable: { budget: 1, tx: 2, count: 3 } }, money);
    eq(q.map(x => [x.key, x.line, x.count]), [['unreadable', 'spent', 3]], 'one qualifier, on the spent line, carrying the count');
    eq(heroQualifiers({ used: {}, summary: {}, gap: {}, unreadable: { budget: 0, tx: 0, count: 0 } }, money), [], 'none when nothing is unreadable');
  }

  console.log(`PASS unreadable-amount-budget-hero — a budget cell the loader cannot read shows its text with a tap-reachable reason, and the hero counts every unreadable amount in the period's figures (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
