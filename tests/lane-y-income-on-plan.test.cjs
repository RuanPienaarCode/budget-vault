'use strict';
/* An income row that arrived in full read "R 0,00 still to come" (2026-09-29
   totals audit, lane Y item 1).

   Two states were worded and three exist. `remaining < 0` was "more than
   planned", and everything else - including exactly zero - fell into "still to
   come", so the one moment an income line was complete was the one moment its
   caption said something was missing. The third state is "received as
   planned".

   "Exactly" is to the cent. Amounts here are sums of floats: a remaining of
   4e-10 is not R 0,00 still to come, it is on plan; a genuine one-cent gap
   still reads as one.

   The sentence lives in one exported function (views/budgets.js
   incomeRemainingText) because the Dashboard's budget table words the same row
   and must not word it differently.

   Synthetic household.
     node tests/lane-y-income-on-plan.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, mountFor, pinClock } = require('./helpers/dash-audit.cjs');
const { incomeRemainingText } = require('../src/views/budgets');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the sentence, on its own ---------------------------------------------- */
const money = v => `R ${Number(v).toFixed(2)}`;
eq(incomeRemainingText(0, money), 'received as planned', 'exactly on plan');
eq(incomeRemainingText(4e-10, money), 'received as planned', 'float residue above zero is on plan');
eq(incomeRemainingText(-4e-10, money), 'received as planned', 'float residue below zero is on plan');
eq(incomeRemainingText(0.004, money), 'received as planned', 'under half a cent is on plan');
eq(incomeRemainingText(0.01, money), 'R 0.01 still to come', 'one cent short is still short');
eq(incomeRemainingText(-0.01, money), 'R 0.01 more than planned', 'one cent over is still over');
eq(incomeRemainingText(5000, money), 'R 5000.00 still to come', 'short of plan is unchanged');
eq(incomeRemainingText(-1000, money), 'R 1000.00 more than planned', 'past plan is unchanged');
ok(!/0[.,]00 still to come/.test(incomeRemainingText(0, money)), 'and never a zero amount still to come');

/* Every language has the new sentence, distinct from the "still to come" one. */
for (const lang of ['en', 'af', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'pt', 'xh', 'zh', 'zu']) {
  i18n.setLanguage(lang);
  const s = i18n.t('bud.remaining.incomeAsPlanned');
  ok(s && s !== 'bud.remaining.incomeAsPlanned', `${lang}: the key resolves`);
  ok(s !== i18n.t('bud.remaining.incomeToCome', { amount: 'X' }), `${lang}: and is not the "still to come" sentence`);
  ok(!/\{amount\}/.test(s), `${lang}: it carries no amount to fill`);
}
i18n.setLanguage('en');

/* ---- on the Budget page, over a real render --------------------------------- */
const budget = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + '| Salary | income | 20000.00 |  |\n| Groceries | expense | 3000.00 |  |\n';
const mk = salary => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '30000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: budget,
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', salary],
    ['2026-09-03', 'Checkers', 'Groceries', -1000],
  ]),
});
const salaryRow = nodes => find(nodes.get('#budTable'), n => n.tagName === 'TR'
  && find(n, m => m.tagName === 'TD' && textOf(m) === 'Salary').length)[0];
const remainingOf = nodes => textOf(find(salaryRow(nodes), n => hasClass(n, 'bud-remaining'))[0]);

(async () => {
  const page = async salary => {
    const unpin = pinClock('2026-09-20');
    try {
      const M = await mountFor(mk(salary), { period: '2026-09' });
      M.ctx.renderBudgets();
      return remainingOf(M.nodes);
    } finally { unpin(); }
  };
  eq(await page(20000), 'received as planned', 'the Budget page: salary of exactly the plan');
  ok(/R[\s  ]?0[.,]01 still to come/.test(await page(19999.99)), 'a cent short still reads as short');
  ok(/R[\s  ]?1[\s  ]?000[.,]00 more than planned/.test(await page(21000)), 'past plan is unchanged');
  ok(/R[\s  ]?5[\s  ]?000[.,]00 still to come/.test(await page(15000)), 'short of plan is unchanged');
  console.log(`PASS lane-y-income-on-plan (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
