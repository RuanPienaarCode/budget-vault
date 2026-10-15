'use strict';
/* "Total income" named two different numbers on two pages (2026-10-14 audit,
   L2a-N11): the Dashboard hero's is what has ARRIVED this period, the Budget
   page's is what the plan PROMISES. For a period with no income row the Budget
   page printed "Total income R 0" beside a Dashboard printing the full salary.
   The Budget tile is now "Planned income"; the Dashboard keeps "Total income".
   The Budget tile's note ("R x received so far") still discloses the received
   figure beside the planned one, and tests/vocabulary.test.cjs TERM 3 pins
   that the bindings did not move.

     node tests/budget-planned-income-label.test.cjs */
const assert = require('assert');
const { B, tx, base, account, textOf, renderDash, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const files = {
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '5000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n| Groceries | expense | 5000.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-01', 'Salary', 'Salary', 31000], ['2026-09-05', 'Checkers', 'Groceries', -900]]),
};

(async () => {
  const dash = await renderDash(files, { today: '2026-09-20', period: '2026-09' });
  ok(/Total income R 31 000/.test(dash.t('#heroCard')), `the Dashboard still says Total income (what arrived) — got: ${dash.t('#heroCard')}`);

  const unpin = pinClock('2026-09-20');
  try {
    const M = await mountFor(files, { period: '2026-09' });
    M.ctx.switchView = () => {};
    M.ctx.renderBudgets();
    const tiles = textOf(M.nodes.get('#budTotalsTop'));
    ok(/Planned income R 30 000 R 31 000 received so far/.test(tiles),
      `the Budget tile says Planned income, and discloses what arrived beside it — got: ${tiles}`);
    ok(!/Total income/.test(tiles), 'and no longer calls the plan "Total income"');
  } finally { unpin(); }

  /* A translated label: the key moved in all twelve files, not just English. */
  for (const lang of ['af', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'pt', 'xh', 'zh', 'zu']) {
    i18n.setLanguage(lang);
    const plan = i18n.t('bud.total.income'), arrived = i18n.t('dash.stat.income');
    ok(plan && plan !== 'bud.total.income' && plan !== arrived,
      `${lang}: the Budget tile's label (${plan}) is not the Dashboard's (${arrived})`);
  }
  i18n.setLanguage('en');

  console.log(`PASS budget-planned-income-label — the Budget page calls the plan's income "Planned income" and the Dashboard keeps "Total income" for what arrived, in all twelve languages (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
