'use strict';
/* Guard tests for src/money-flow.js — the arithmetic behind the Score page's
   "Where the money went" card and its segmented rail.

   Five invariants, each one a way the flow card could quietly start lying:

     1. the four bands sum to income
     2. committed is at least as large as its own named sub-parts, nested
        correctly (committed >= repayments >= interest — interest is a
        SUBSET of the repayment cash flow, never an addend on top of it; see
        the note in money-flow.js on why the literal sum is the wrong check)
     3. the two "lefts" reconcile: budget-left + never-budgeted ==
        income-not-spent (income - spentTotal), unconditionally
     4. zero-income and no-budget inputs do not throw or divide by zero
     5. rail segment widths sum to 100 and fills sum to the score

     node tests/money-flow.test.cjs
*/

const assert = require('assert');
const { periodFlow, railSegments } = require('../src/money-flow');
const { PILLARS, scoreBreakdown, healthMetrics } = require('../src/health-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const close = (a, b, m, eps = 0.01) => { ok(Math.abs(a - b) < eps, `${m} (got ${a}, want ~${b})`); };

/* ---- fixture matching the mockup's own reference numbers ---- */
const catType = cat => ({
  Rent: 'housing', Medical: 'insurance', Groceries: 'expense', 'Card Repayment': 'debt',
}[cat] || null);
const fixedCats = new Set(['Rent', 'Medical', 'Card Repayment']);
const spendByCat = {
  Rent: 4410, Medical: 2850, 'Card Repayment': 7140, Groceries: 11460,
};
const debts = [{ status: 'active', balance: 100000, rate: 24.18 }]; // -> ~R2015/mo interest

const base = {
  income: 45000, spentTotal: 25859.95, budgeted: 33100,
  spendByCat, fixedCats, catType, savingContribution: 0, debts,
};

/* ---- 1. bands sum to income ---- */
{
  const f = periodFlow(base);
  const sum = f.bands.committed + f.bands.living + f.bands.saving + f.bands.notYetSpent;
  close(sum, f.income, 'the four bands sum to income');
  close(f.bands.committed, 14400, 'committed matches the mockup reference');
  close(f.bands.living, 11459.95, 'living matches the mockup reference');
  close(f.bands.notYetSpent, 19140.05, 'not-yet-spent matches the mockup reference');
}

/* ---- 1b. bands still sum to income once saving is non-zero ---- */
{
  const f = periodFlow({ ...base, savingContribution: 5000, spentTotal: 20859.95 });
  const sum = f.bands.committed + f.bands.living + f.bands.saving + f.bands.notYetSpent;
  close(sum, f.income, 'bands still sum to income with real saving');
  ok(f.bands.saving === 5000, 'saving is carried through unchanged');
}

/* ---- 2. committed nests its own sub-parts correctly ---- */
{
  const f = periodFlow(base);
  const d = f.committedDetail;
  close(d.debtRepayments, 7140, 'debt repayments read off the fixed debt category');
  close(d.housing, 4410, 'housing & utilities read off the fixed housing category');
  close(d.other, 0, 'nothing left unexplained in this fixture');
  ok(f.bands.committed >= d.debtRepayments, 'committed contains the whole repayment line');
  ok(d.debtRepayments >= d.interest, 'the repayment line contains its own interest, not the other way round');
  ok(d.debtRepayments + d.housing + d.subscriptions + d.other <= f.bands.committed + 0.01,
    'the four sub-chips never add up to more than committed itself');
}

/* ---- 3. the two lefts reconcile, unconditionally ---- */
{
  for (const extra of [{}, { savingContribution: 9000 }, { budgeted: 50000 }, { budgeted: 0 }]) {
    const f = periodFlow({ ...base, ...extra });
    close(f.lefts.leftInBudget + f.lefts.neverBudgeted, f.income - f.budget.spentTotal,
      'budget-left + never-budgeted == income-not-spent');
  }
}

/* ---- 4. zero-income and no-budget inputs do not throw ---- */
{
  const empties = [
    {}, { income: 0, spentTotal: 0, budgeted: 0 },
    { income: 0, spentTotal: 500, budgeted: 0, spendByCat: {}, fixedCats: new Set(), debts: [] },
    { income: 45000, spentTotal: 0, budgeted: 0, debts: null, spendByCat: null, fixedCats: null },
  ];
  for (const e of empties) {
    let f;
    assert.doesNotThrow(() => { f = periodFlow(e); }, 'periodFlow never throws on a thin vault');
    ok(Number.isFinite(f.bands.committed) && Number.isFinite(f.bands.living)
      && Number.isFinite(f.bands.saving) && Number.isFinite(f.bands.notYetSpent),
      'every band is a real number, never NaN');
    ok(f.budget.allocatedOfIncome === null || Number.isFinite(f.budget.allocatedOfIncome),
      'allocatedOfIncome is null rather than a division by zero');
    ok(f.budget.budgetUsed === null || Number.isFinite(f.budget.budgetUsed),
      'budgetUsed is null rather than a division by zero');
  }
  checks++;
}

/* ---- 5. rail segment widths sum to 100 and fills sum to the score ---- */
{
  /* A real breakdown, built the same way health-data.js builds one — six
     periods, a mix of pillars answerable and not. */
  const periods = [];
  for (let i = 0; i < 6; i++) {
    periods.push({ income: 45000, essential: 20000, savings: 0, consumption: 25860, fixed: 14400, budgeted: 33100, counted: true });
  }
  const m = healthMetrics({
    periods, monthsPerPeriod: 1,
    earmarks: { total: 55000, any: true, over: [] }, targetMonths: 6,
    debtInterest: 2015, debtInstalments: 7140, netWorth: 1836000, hasFixed: true,
  });
  const breakdown = scoreBreakdown(m, 6);
  const rail = railSegments(breakdown);

  ok(rail.length > 0, 'the rail has segments');
  const widthSum = rail.reduce((s, seg) => s + seg.width, 0);
  const fillSum = rail.reduce((s, seg) => s + seg.fill, 0);
  close(widthSum, 100, 'segment widths sum to 100');
  close(fillSum, breakdown.total, 'segment fills sum to the score');

  /* Segments run in PILLARS' own weight order, not the gap-sorted order
     breakdown.pillars itself carries. */
  const keysInOrder = rail.map(s => s.key);
  const expected = PILLARS.map(p => p.key).filter(k => keysInOrder.includes(k));
  assert.deepStrictEqual(keysInOrder, expected, 'the rail reads pillars in weight order, not gap order');

  /* `at` is the UNROUNDED fraction the ring's arc geometry draws — a full-
     marks segment reads exactly 1, and every segment's `at` has to agree with
     its own rounded shownPoints/shownMax pair to within the rounding that
     produced them (never more than one whole point of slack). A segment
     drawing a visibly different angle than the number printed beside it is
     the exact bug this guards. */
  for (const seg of rail) {
    ok(typeof seg.at === 'number' && seg.at >= 0 && seg.at <= 1, `${seg.key}'s at is a real fraction in [0,1]`);
    if (seg.width > 0) {
      close(seg.at * seg.width, seg.fill, `${seg.key}'s at matches its own rounded fill/width pair`, 1.01);
    }
  }
  const wealth = rail.find(s => s.key === 'wealth');
  close(wealth.at, 1, 'a full-marks pillar (wealth, net worth well past 3x income) reads at = 1');

  ok(railSegments(null).length === 0, 'a null breakdown yields no segments, not a throw');
  checks++;
}

console.log(`PASS  money-flow.test.cjs  (${checks} checks)`);
