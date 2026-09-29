'use strict';
/* An income row that beat its plan was printed as a red signed shortfall on
   the Dashboard's budget table (2026-09-29 totals audit follow-up).

   budgetRowStatus() reports `over` and a negative `remaining` for ANY row whose
   actual exceeds its budget, income included, and the Dashboard printed that
   as "R -1 000" in the danger colour under the Remaining column - a good month
   drawn as an overspend. The Budget page already says "R 1 000 more than
   planned" (neutral) for an income row that beat its plan and "R 5 000 still to
   come" for one that has not yet reached it (keys bud.remaining.incomeMore /
   incomeToCome). The Dashboard now reads the same two keys and never colours
   income red, so one row reads one way on both pages.

   Synthetic household; the figures are invented.

     node tests/dashboard-audit-income-row.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, renderDash } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const budget = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + '| Salary | income | 20000.00 |  |\n| Groceries | expense | 3000.00 |  |\n';
const mk = (salary, groceries) => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '30000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: budget,
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', salary],
    ['2026-09-03', 'Checkers', 'Groceries', -groceries],
  ]),
});
const rowFor = (nodes, name) => find(nodes.get('#dashBudget'), n => n.tagName === 'TR'
  && find(n, m => m.tagName === 'TD' && textOf(m) === name).length)[0];
const remainingCell = row => find(row, n => n.tagName === 'TD' && hasClass(n, 'num')).pop();

(async () => {
  /* ---- an income row that beat its plan ------------------------------------ */
  {
    const { nodes } = await renderDash(mk(21000, 3500), { today: '2026-09-20' });
    const cell = remainingCell(rowFor(nodes, 'Salary'));
    ok(/R[\s  ]?1[\s  ]?000[,.]?\d* more than planned/.test(textOf(cell)), `income above plan: ${textOf(cell)}`);
    ok(!/-|−/.test(textOf(cell)), 'with no minus sign');
    ok(!hasClass(cell, 'text-danger'), 'and not in the danger colour');
    /* Control: a spending row over its plan is still the red signed figure. */
    const g = remainingCell(rowFor(nodes, 'Groceries'));
    ok(hasClass(g, 'text-danger') && /500/.test(textOf(g)), `an overspent expense row is still red: ${textOf(g)}`);
  }
  /* ---- an income row that has not yet reached its plan ---------------------- */
  {
    const { nodes } = await renderDash(mk(15000, 1000), { today: '2026-09-20' });
    const cell = remainingCell(rowFor(nodes, 'Salary'));
    ok(/R[\s  ]?5[\s  ]?000[,.]?\d* still to come/.test(textOf(cell)), `income short of plan: ${textOf(cell)}`);
    ok(!hasClass(cell, 'text-danger'), 'not red either');
  }
  /* ---- an income row exactly on plan: the Budget page's words, not "R 0,00 still to come" */
  {
    const { nodes } = await renderDash(mk(20000, 1000), { today: '2026-09-20' });
    const cell = remainingCell(rowFor(nodes, 'Salary'));
    ok(/received as planned/.test(textOf(cell)), `income exactly on plan: ${textOf(cell)}`);
    ok(!/still to come/.test(textOf(cell)), 'not "still to come" with nothing to come');
  }
  /* ---- the Budget page says the same words for the same row ------------------- */
  {
    const { mountFor, pinClock } = require('./helpers/dash-audit.cjs');
    const unpin = pinClock('2026-09-20');
    let M;
    try { M = await mountFor(mk(21000, 3500), { period: '2026-09' }); M.ctx.renderBudgets(); } finally { unpin(); }
    const page = textOf(M.nodes.get('#budTable'));
    ok(/more than planned/.test(page), 'the Budget page reads "more than planned" for the same row');
    eq((page.match(/more than planned/g) || []).length, 1, 'once');
  }
  console.log(`PASS dashboard-audit-income-row (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
