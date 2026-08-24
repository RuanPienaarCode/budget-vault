'use strict';
/* Guard: money-flow.js's `budgetUsed` numerator excludes savings/investment-
   typed spend — the SAME exclusion rule health-math.js's score-facing
   `budgetUsed` (avg.consumptionForBudget / avg.budgeted) has always applied
   via health-data.js's `consumption` loop.

   This closes GAP A in tests/vocabulary.test.cjs ("Budget used", twice, on
   one page): before this fix, money-flow.js divided the RAW
   `periodSummary().spend` — which money-flow.js's own header comment already
   documents as including the outgoing leg of a savings/investment-typed
   category — while health-math.js's figure, one card up on the same Score
   page, excluded that same leg. A household funding an investment inside a
   budgeted category read two different "Budget used" percentages under one
   word on one screen.

   The two figures are still allowed to differ in WINDOW (this period here,
   a six-period trailing average in health-math.js) — that is argued as a
   real, disclosed distinction, not a second occurrence of the bug this file
   guards against. What this test pins is narrower and non-negotiable: a
   rand of savings-typed spend must be excluded from BOTH numerators, or
   neither.

     node tests/budget-used-numerator.test.cjs
*/

const assert = require('assert');
const { periodFlow } = require('../src/money-flow');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const close = (a, b, m, eps = 0.01) => { ok(Math.abs(a - b) < eps, `${m} (got ${a}, want ~${b})`); };

/* ---- fixture: a period with committed AND non-committed savings-typed
   spend, alongside ordinary living spend ---- */
const catType = cat => ({
  'RA Contribution': 'savings',        // fixed-flagged — a committed savings transfer
  'Emergency Fund Transfer': 'investment', // NOT fixed-flagged — a one-off saving move
  Groceries: 'expense',
}[cat] || null);
const fixedCats = new Set(['RA Contribution']);
const spendByCat = {
  'RA Contribution': 3000,
  'Emergency Fund Transfer': 5000,
  Groceries: 12000,
};
const income = 45000;
const spentTotal = 20000; // 3000 + 5000 + 12000
const budgeted = 20000;

const base = { income, spentTotal, budgeted, spendByCat, fixedCats, catType, savingContribution: 0, debts: [] };

/* ---- 1. budgetUsed excludes ALL savings/investment-typed spend, not just
   the non-committed remainder `living` nets off ---- */
{
  const f = periodFlow(base);
  // consumptionThisPeriod = 20000 - (3000 + 5000) = 12000; budgetUsed = 12000/20000
  close(f.budget.budgetUsed, 0.6, 'budgetUsed divides consumption (savings-typed spend excluded), not raw spend');

  // Negative control: the OLD, buggy shape this test would have caught —
  // budgetUsed as spent/bud unadjusted. If the fix regresses to that shape,
  // this assertion fails.
  const oldShapeValue = spentTotal / budgeted; // 1.0
  ok(Math.abs(f.budget.budgetUsed - oldShapeValue) > 0.1,
    'control: the new figure must actually differ from the old, unadjusted spent/budgeted ratio for this fixture');
}

/* ---- 2. the exclusion does not care whether the savings-typed spend is
   fixed-flagged — health-math.js's own `consumption` loop excludes type
   savings/investment regardless of `fixed`, and budgetUsed must match that,
   not the narrower "non-committed only" adjustment `living` applies ---- */
{
  // All savings-typed spend fixed-flagged (committed)...
  const allFixed = periodFlow({ ...base, fixedCats: new Set(['RA Contribution', 'Emergency Fund Transfer']) });
  // ...none of it fixed-flagged...
  const noneFixed = periodFlow({ ...base, fixedCats: new Set() });
  close(allFixed.budget.budgetUsed, 0.6, 'budgetUsed unaffected by the savings category being fixed-flagged');
  close(noneFixed.budget.budgetUsed, 0.6, 'budgetUsed unaffected by the savings category NOT being fixed-flagged');
  close(allFixed.budget.budgetUsed, noneFixed.budget.budgetUsed,
    'the fixed flag must not change which rand of savings-typed spend the numerator excludes');
}

/* ---- 3. ordinary vaults with no savings-typed spend are unaffected ---- */
{
  const plain = periodFlow({
    income: 45000, spentTotal: 25859.95, budgeted: 33100,
    spendByCat: { Rent: 4410, Medical: 2850, 'Card Repayment': 7140, Groceries: 11460 },
    fixedCats: new Set(['Rent', 'Medical', 'Card Repayment']),
    catType: cat => ({ Rent: 'housing', Medical: 'insurance', Groceries: 'expense', 'Card Repayment': 'debt' }[cat] || null),
    savingContribution: 0, debts: [],
  });
  close(plain.budget.budgetUsed, 25859.95 / 33100, 'with no savings-typed spend, budgetUsed is unchanged from spent/budgeted');
}

/* ---- 4. still null-safe with no budget ---- */
{
  const f = periodFlow({ ...base, budgeted: 0 });
  ok(f.budget.budgetUsed === null, 'budgetUsed stays null rather than dividing by zero');
}

console.log(`PASS — budget-used-numerator (${checks} checks)`);
