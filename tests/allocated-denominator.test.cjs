'use strict';
/* ISSUE 36 — "Total income R40 000" and "41% of income budgeted", on one card,
   about two different incomes.

   THE DEFECT, reproduced on 2026-09-02 against the `BudgetAudit` household
   (tests/_audit-seed.cjs):

     hero "Total income"                 R40 000   (R35 000 salary + a R5 000 gift)
     hero "Budgeted"                     R14 500
     the line under it                   "41% of income budgeted"
     14 500 / 40 000                     36%
     14 500 / 35 000                     41%   <- what was printed

   The percentage is of the income the BUDGET states; the figure beside it is
   the income that actually landed. Both are legitimate and the card said
   "income" for each.

   THE DENOMINATOR IS NOT THE BUG. incomeBaseFor() prefers `budgetIncome` on
   purpose — "of income budgeted" measures a plan against the income the plan
   was built on — and money-flow.js owns that rule precisely so the Dashboard
   and the Score page cannot answer it differently (they once printed 100% and
   102% off the same vault). Switching the base to actual income would move the
   defect rather than fix it, and would make the line jump about as income
   arrives through the month.

   THE UNNAMED BASE IS THE BUG, and it is the same failure as ISSUE 45 one card
   over: a figure resting on an assumption the reader cannot see. So the line
   names its own denominator whenever that denominator is not the number
   printed beside it.

   WHAT IS PINNED

     1. The percentage itself is unchanged — still budget income, still the
        one shared derivation.
     2. The card names the base when the two incomes differ.
     3. And does NOT when they agree: a clause qualifying nothing is noise,
        and noise is how a real disclosure stops being read.
     4. The wording is reached through i18n.t(), so a translation lands as a
        translation rather than as a red test.

     node tests/allocated-denominator.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');
const { SEED, PERIOD, B, tx, atAuditDate } = require('./_audit-seed.cjs');
const { allocatedShare, incomeBaseFor } = require('../src/money-flow');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub', 'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

async function heroOf(files) {
  const { FakeEl } = makeDom();
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();
  return { ctx, S, text: nodes.get('heroCard').textContent };
}

/* Every rendered assertion below runs on 2026-09-02, the day of the audit —
   see atAuditDate's own note for why the real clock would make this file
   stop testing anything in October. */
atAuditDate(async () => {
  /* ------------ 1. the household, with its two different incomes ---------
     The gift is moved from the 28th to the 2nd. ISSUE 35's clamp closes the
     period window at today, so the late gift is `scheduled` and no longer in
     the displayed income at all — which fixes the audit's particular R40 000
     and leaves THIS defect untouched, because it was never about that row. A
     bonus that has actually landed reproduces it exactly: two real incomes,
     both inside the window, one word for both. */
  {
    const LANDED = { ...SEED };
    LANDED[`${B}/Transactions/Emergency fund/2026-09.md`] = tx([
      ['2026-09-01', 'From cheque', 'Transfer', 2000],
      ['2026-09-02', 'Family gift', 'Gift', 5000],
    ]);
    const { ctx, text } = await heroOf(LANDED);
    const sum = ctx.periodSummary(PERIOD);
    const bud = ctx.budgetTotals(PERIOD);
    eq(sum.income, 40000, 'the hero really does display R40 000 of income');
    eq(sum.scheduled.income, 0, 'all of it inside the as-of window, so ISSUE 35 is not what is being measured here');
    eq(bud.income, 35000, 'while the budget plans against R35 000');
    eq(incomeBaseFor({ budgetIncome: bud.income, actualIncome: sum.income, periodFinished: false }), 35000,
      'and the percentage is taken against the budget figure — the rule this fix keeps');
    /* ISSUE 40 split budgetTotals into spend and set-aside envelopes, and this
       figure deliberately takes BOTH: "how much of my income have I allocated"
       is a question about the whole plan — a rand into the emergency fund is
       every bit as allocated as a rand of groceries. The hero's REMAINING
       figure takes the spend half alone. That asymmetry is intentional and is
       pinned here so a later tidy-up cannot quietly make the two agree. */
    eq(bud.setAside, 4000, 'the household budgets R4 000 into its own funds');
    eq(Math.round(allocatedShare({
      budgeted: bud.spend + bud.setAside, budgetIncome: bud.income, actualIncome: sum.income,
      periodFinished: false,
    }) * 100), 41, 'so the printed 41% is arithmetically right, and always was');

    const named = i18n.t('dash.stat.allocatedOf', { pct: '41', amount: 'R 35000' });
    ok(text.includes(named),
      `the card names the income that 41% is of — wanted "${named}", got: ${text}`);
    ok(!text.includes(i18n.t('dash.stat.allocated', { pct: '41' })),
      'and does not also print the bare, ambiguous form');
  }

  /* ---------- 2. and stays quiet when there is nothing to explain -------- */
  {
    /* The same household with the late gift removed, so the income that
       landed and the income the budget plans for are the same R35 000. */
    const AGREES = { ...SEED };
    AGREES[`${B}/Transactions/Emergency fund/2026-09.md`] = tx([
      ['2026-09-01', 'From cheque', 'Transfer', 2000],
    ]);
    const { ctx, text } = await heroOf(AGREES);
    const sum = ctx.periodSummary(PERIOD);
    const bud = ctx.budgetTotals(PERIOD);
    eq(sum.income, 35000, 'income landed matches the plan');
    eq(bud.income, 35000, 'on both sides');

    ok(text.includes(i18n.t('dash.stat.allocated', { pct: '41' })),
      `the ordinary card keeps the wording it always had — got: ${text}`);
    ok(!text.includes(i18n.t('dash.stat.allocatedOf', { pct: '41', amount: 'R 35000' })),
      'and gains no clause qualifying a difference that does not exist');
  }

  console.log(`PASS allocated-denominator (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
