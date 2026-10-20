'use strict';
/* "R X in refunds netted off" printed beside a figure that has NOT had them
   netted off (2026-10-14 audit, L2b-02 = L2a-N03).

   The Dashboard hero's spent line and the Budget page's Total spent tile both
   print budgetUsed().spent, which ADR-0005 keeps GROSS: every outgoing row,
   less set-aside, refunds not taken off. Beside it they printed "R X in
   refunds netted off", which says the opposite — a reader subtracts nothing
   from a figure told it already had something taken off. On the vault this
   was found against, the per-category table under the hero was smaller than
   the hero by the refunds for exactly that reason, and the Report's own sentence ("Net
   includes R X in refunds, which Spend above does not take off") said so
   in the opposite direction to the hero.

   The donut's subtitle is the one place the sentence is TRUE (its slices are
   net per category), so its wording must not move: that is the control here.

   Synthetic household: R 3 000 out and R 3 000 back in one grocery category.

     node tests/refunds-wording-gross-figure.test.cjs */
const assert = require('assert');
const { B, tx, base, account, textOf, renderDash, pinClock, mountFor } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');
const { heroQualifiers } = require('../src/views/dashboard');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const BUDGET = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + '| Salary | income | 30000.00 |  |\n| Groceries | expense | 5000.00 |  |\n';
const files = {
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '40000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: BUDGET,
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 30000],
    ['2026-09-02', 'Mechanic', 'Groceries', -3000],
    ['2026-09-04', 'Mechanic refund', 'Groceries', 3000],
    ['2026-09-05', 'Checkers', 'Groceries', -1000],
  ]),
};

(async () => {
  const dash = await renderDash(files, { today: '2026-09-20', period: '2026-09' });
  const hero = dash.t('#heroCard');
  ok(/R 3 000 in refunds not taken off this figure/.test(hero),
    `the hero names the refunds as NOT taken off its spent figure — got: ${hero}`);
  ok(!/netted off/.test(hero), `and never says they were netted off — got: ${hero}`);
  /* The figure it sits beside is the gross one: 3 000 + 1 000 out, no refund term. */
  ok(/R 4 000 spent of R 5 000/.test(hero), `the spent figure is gross, as ADR-0005 keeps it — got: ${hero}`);

  /* The same sentence on the Budget page's Total spent tile. */
  const unpin = pinClock('2026-09-20');
  let tile;
  try {
    const M = await mountFor(files, { period: '2026-09' });
    M.ctx.switchView = () => {};
    M.ctx.renderBudgets();
    tile = textOf(M.nodes.get('#budTotalsTop'));
  } finally { unpin(); }
  ok(/R 3 000 in refunds not taken off this figure/.test(tile),
    `the Total spent tile names them as not taken off too — got: ${tile}`);
  ok(!/netted off/.test(tile), `and never says netted off — got: ${tile}`);

  /* Control: the donut's slices ARE net per category, and its subtitle keeps saying so. */
  const sub = dash.t('#dashSplitSub');
  ok(/R 3 000 in refunds netted off/.test(sub), `the donut keeps its true sentence (in whole rands, like its centre, since the 2026-10-20 audit) — got: ${sub}`);

  /* The API reads the hero's own builder, so the reworded sentence reaches Vista from the same key. */
  i18n.setLanguage('en');
  const money = (v, d) => `R ${Number(v).toFixed(d)}`;
  /* summary.refunds — every refund, in full — since the 2026-10-20 audit
     (M1-02); the donut's gap is not what this sentence names. */
  const q = heroQualifiers({ used: {}, summary: { refunds: 250 }, gap: { netted: 0 } }, money);
  ok(q.length === 1 && q[0].key === 'netted' && /not taken off this figure/.test(q[0].text),
    `heroQualifiers hands the API the same reworded sentence — got: ${JSON.stringify(q)}`);

  /* The same key reaches the Vista dashboard through src/api.js, where there is
     no "table below" to point at: a sentence that refers to the page's layout
     is meaningless (and mis-leading) on another plugin's card, so the key says
     only what is true of the figure, in every language. */
  for (const lang of ['en', 'af', 'de', 'es', 'fr', 'hi', 'id', 'ja', 'pt', 'xh', 'zh', 'zu']) {
    i18n.setLanguage(lang);
    const line = i18n.t('dash.hero.nettedOff', { amount: 'AMT' });
    ok(line.includes('AMT') && !/[()（）]/.test(line),
      `${lang}: dash.hero.nettedOff makes no reference to a table elsewhere on the page — got: ${line}`);
  }
  i18n.setLanguage('en');
  ok(!/table/i.test(i18n.t('dash.hero.nettedOff', { amount: 'AMT' })),
    'en: the hero sentence never mentions a table (it is shown on cards that have none)');

  console.log(`PASS refunds-wording-gross-figure — the hero and the Budget tile say refunds are NOT taken off their gross spent figure, the donut keeps its true "netted off" (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
