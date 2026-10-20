'use strict';
/* A multi-period Report compares like with like: only the periods that HAVE a
   budget feed "budget used", Budget vs Actual and "saved so far", and the
   periods left out are named.

   buildReportData summed the spend of EVERY period in the selection and the
   budget of only the periods that held one. On the vault this was found on, a
   12-month report read "165% of spending budget used" against a like-for-like
   109%; Food's Remaining had the wrong sign (twelve months of actual against
   ten months of budget); and "saved so far" counted what moved into funds in
   periods the plan never covered (2026-10-14 audit, L2b-01). The committed
   household reproduces it: 168% against a true 78%.

   The owner's decision: LIKE FOR LIKE. The numerator, the actuals, what moved
   to funds and the set-aside the plan holds are taken only from periods whose
   spending budget is above zero (`periodFigures(p).used.budgeted > 0`), and the
   document says which periods were left out and that Income and Spend above
   cover them all. A selection in which NO period has a budget has nothing to
   compare against, so nothing is left out and the tables show actuals only —
   what a single unbudgeted period always did.

   Worked BY HAND from the household, August (no budget file) and September
   (budgeted) — the 3-month report covers both:

     September   spending envelopes   Groceries 5 000 + Rent 9 000 + Gym 1 000
                                      + Carry 500 (assume-spent)  = 15 500
                 spent                13 600 gross - 2 000 set aside + 500 = 12 100
                 used                 12 100 / 15 500 = 78.06%
                 per category actual  Groceries 2 400 (Checkers 2 000 + split
                                      part 400), Rent 9 000, Gym 200
                 saved                1 000 moved of the 2 000 the plan sets aside
     August      no budget; 14 000 out (Rent 9 000, Groceries 4 000, Gym 1 000)
                 and a 700 transfer into the emergency fund added for this test

     OLD, all periods in the numerator:  (27 600 - 2 000 + 500) / 15 500 = 168%
     Groceries as printed:               actual 6 400 against budget 5 000

     node tests/report-like-for-like-periods.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport, section } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const report = require('../src/report');
/* Sentences spelled through t() are compared in reading form — see
   readingI18n in tests/helpers/dom-stub.cjs (U+00A0 glue, 20 Oct 2026). */
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => ok(Math.abs(a - b) < 0.01, `${m} (got ${a}, want ${b})`);

const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const files = (over) => ({
  ...SEED,
  [`${B}/Transactions/Cheque/2026-08.md`]: SEED[`${B}/Transactions/Cheque/2026-08.md`] + '| 2026-08-10 | To emergency fund | Transfer | -700.00 |  |  |  |\n',
  [`${B}/Transactions/Emergency fund/2026-08.md`]: HEAD + '| 2026-08-10 | From cheque | Transfer | 700.00 |  |  |  |\n',
  ...(over || {}),
});

async function run(f, pill) {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(f, { period: PERIOD, budgetFolder: B });
    const out = await createReport(M, { pill });
    return { M, ...out };
  } finally { unpin(); }
}
const row = (json, cat) => json.budgets_vs_actuals.find(r => r.category === cat);

(async () => {
  /* ---- the pure rule ---------------------------------------------------------- */
  {
    const c = report.budgetComparison([{ name: 'A', budgeted: 0 }, { name: 'B', budgeted: 100 }, { name: 'C', budgeted: 0 }, { name: 'D', budgeted: 50 }]);
    eq([c.total, c.use, c.leftOut], [4, [1, 3], ['A', 'C']], 'periods with a spending budget are compared; the rest are named');
    const none = report.budgetComparison([{ name: 'A', budgeted: 0 }, { name: 'B', budgeted: 0 }]);
    eq([none.use, none.leftOut], [[0, 1], []], 'with no budget anywhere there is nothing to compare against, so nothing is left out');
    eq(report.budgetComparison([{ name: 'A', budgeted: 10 }]).leftOut, [], 'one budgeted period leaves nothing out');
    eq(report.budgetComparison([]).use, [], 'an empty selection is empty');
  }

  /* ---- three months: August has no budget ------------------------------------- */
  {
    const r = await run(files(), '3m');
    const { ctx } = r.M;
    eq(r.json.period_count, 2, 'fixture: the 3-month report covers August and September');
    ok(ctx.movedToFunds('2026-08') > 0, 'fixture: August moved something into the funds, so an all-periods sum would show it');

    const bu = r.json.income_vs_spend.budget_used;
    eq([bu.spent, bu.budgeted], [12100, 15500], 'budget used is September\'s own: 12 100 spent of 15 500');
    near(bu.used_pct, 12100 / 15500 * 100, 'the share is 78.06%, not 168%');
    eq([bu.set_aside_planned, bu.set_aside_moved], [2000, 1000], 'saved so far: 1 000 of the 2 000 the plan sets aside — August\'s 700 is not in it');
    const want = i18n.t('dash.hero.sub', { spent: ctx.money(12100), budgeted: ctx.money(15500) });
    ok(r.md.includes(want), `the sentence prints the like-for-like pair — expected "${want}"`);
    ok(r.md.includes('78%'), 'and its 78%');
    ok(!/16\d%/.test(r.md), 'and no 16x% anywhere');

    /* Budget vs Actual: September against September. */
    const g = row(r.json, 'Groceries');
    eq([g.budget, g.actual, g.remaining], [5000, 2400, 2600], 'Groceries: 2 400 of 5 000, remaining 2 600 (not 6 400 and -1 400)');
    eq([row(r.json, 'Rent').actual, row(r.json, 'Rent').remaining], [9000, 0], 'Rent: 9 000 of 9 000');
    eq(row(r.json, 'Salary').actual, 30000, 'Salary: one month of pay against one month of plan');

    /* The plain totals stay over every period, and say so. */
    eq([r.json.income_vs_spend.income, r.json.income_vs_spend.spend], [60000, 27600], 'Income and Spend cover both periods, as labelled');
    const bp = r.json.income_vs_spend.budget_periods;
    eq(bp, { compared: 1, total: 2, left_out: ['August 2026'] }, 'the JSON says how many periods the budget figures cover, and which were left out');
    const note = i18n.t('report.budget.leftOut', { count: 1, total: 2, names: 'August 2026' });
    ok(r.md.includes(note), `the document names the period left out — expected "${note}"`);
    ok(/not compared/.test(note) && /income and spend above cover all 2/.test(note), 'in words that also say what the plain totals cover');
    ok(section(r.md, i18n.t('report.section.incomeSpend')).includes(note), 'under the section the figures are in');
  }

  /* ---- a single period, and a selection with no budget at all ------------------- */
  {
    const one = await run(files(), 'current');
    eq([one.json.income_vs_spend.budget_used.spent, one.json.income_vs_spend.budget_used.budgeted], [12100, 15500], 'the current month is unchanged');
    eq(one.json.income_vs_spend.budget_periods, { compared: 1, total: 1, left_out: [] }, 'one period, none left out');
    ok(!one.md.includes(i18n.t('report.budget.leftOut', { count: 1, total: 1, names: '' })) && !/not compared/.test(one.md), 'and no sentence about it');

    const bare = files();
    delete bare[`${B}/Budgets/2026-09.md`];
    const none = await run(bare, '3m');
    eq(none.json.income_vs_spend.budget_periods, { compared: 0, total: 2, left_out: [] }, 'no budget anywhere: nothing compared, nothing left out');
    ok(!/not compared/.test(none.md), 'no sentence to write');
    ok(none.json.budgets_vs_actuals.length > 0, 'and Budget vs Actual still lists what was spent, as a single unbudgeted period always did');
    eq(row(none.json, 'Groceries').actual, 6400, 'over every period: 4 000 + 2 400');
  }

  console.log(`PASS report-like-for-like-periods (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
