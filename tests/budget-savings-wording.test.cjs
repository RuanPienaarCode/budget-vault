'use strict';
/* One wording, one figure: "{amount} for savings" is the set-aside PAID.

   The Dashboard hero and the Report print "{amount} for savings" with the
   set-aside the household actually PAID this period (budgetUsed's setAside,
   held out of "spent"). The Budget page's Budgeted tile printed the same words
   — through its own key, bud.total.ofWhichSetAside — with the set-aside the
   PLAN holds (planFigures' setAside), so a household that planned R2 000 and
   had paid R500 read "R 2 000 for savings" here and "R 500 for savings" one
   screen away (2026-10-07 audit, two rules behind one wording).

   The tile keeps the PLANNED figure: it exists to break the plan total down
   (Total budgeted less the set-aside is the spending budget the % used is
   measured against), and the page's own "R X of R Y saved so far" sentence
   already names that same Y as the plan's. So it changes its words instead —
   a new key, "{amount} planned for savings" — and the paid wording stays the
   hero's alone.

   Synthetic household.
     node tests/budget-savings-wording.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, textOf } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const cat = type => `---\ntype: ${type}\ncolor: "#888888"\n---\n`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nlanguage: en\n---\n',
  [`${B}/Categories/Salary.md`]: cat('income'),
  [`${B}/Categories/Food.md`]: cat('expense'),
  [`${B}/Categories/Emergency fund.md`]: cat('savings'),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-10-06\n---\n',
  [`${B}/Transactions/Cheque/2026-10.md`]: '---\naccount: "Cheque"\nmonth: 2026-10\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
    + '| 2026-10-01 | Pay | Salary | 30000.00 |  |  |\n| 2026-10-02 | Shop | Food | -1500.00 |  |  |\n'
    + '| 2026-10-03 | To the fund | Emergency fund | -500.00 |  |  |\n',
  [`${B}/Budgets/2026-10.md`]: '---\nperiod: 2026-10\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n| Food | expense | 4000.00 |  |\n| Emergency fund | savings | 2000.00 |  |\n',
};

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const M = await mountFor(FILES, { period: '2026-10' });
    const { ctx } = M;
    const planned = ctx.planFigures('2026-10').setAside;
    const paid = ctx.budgetUsed('2026-10').setAside;
    eq([planned, paid], [2000, 500], 'the fixture separates the two figures: R2 000 planned, R500 paid');

    ctx.renderBudgets();
    const strip = M.nodes.get('#budTotalsTop');
    const frag = find(strip, n => n.attrs && n.attrs['data-fig'] === 'bud-budgeted-setaside')[0];
    ok(frag, 'the Budgeted tile names its set-aside fragment');
    const words = i18n.t('bud.total.setAsidePlanned', { amount: ctx.money(planned) });
    ok(words !== 'bud.total.setAsidePlanned' && /planned for savings/.test(words),
      `the tile has a wording of its own that says the figure is planned: ${words}`);
    eq(textOf(frag).replace(/^ · /, ''), words, 'and it prints the PLANNED figure under it');
    ok(textOf(frag) !== i18n.t('dash.stat.setAside', { amount: ctx.money(planned) }),
      'not the hero\'s paid wording any more');

    /* The page's own sentence names the same Y — the tile and the sentence now
       agree in words as well as in figure. */
    const saved = find(strip, n => n.attrs && n.attrs['data-fig'] === 'bud-note-setaside')[0];
    ok(saved && textOf(saved).includes(ctx.money(planned, 0)), `"saved so far" is measured against the same planned R2 000: ${textOf(saved)}`);
  } finally { unpin(); }

  console.log(`PASS budget-savings-wording (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
