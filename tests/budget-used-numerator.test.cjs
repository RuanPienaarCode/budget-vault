'use strict';
/* Guard: money-flow.js's `budgetUsed` is budgetUsedShare() — the ONE rule
   ADR-0005 names — fed by what the CALLER says was set aside, never by what
   periodFlow can find for itself in the category map.

   History, because the shape of the old bug is the thing to keep out:
   this file used to pin the OPPOSITE contract. The chip's numerator excluded
   savings/investment-typed spend by scanning `spendByCat` (periodSpend()'s
   NET-by-category map) for savings-typed entries. That map only shows a
   savings-typed outflow when the receiving account is out of the budget — a
   contribution into a fund INSIDE the budget has both legs in the map and
   nets to zero — so the same rows read 51% or 38% depending on an account
   flag with nothing to do with the question. The Dashboard hero, subtracting
   periodSummary().setAside directly, read 38% either way.
   tests/budget-used-one-rule.test.cjs pins that whole story end to end
   through the real loader; this file pins the pure function's contract.

     node tests/budget-used-numerator.test.cjs
*/
const assert = require('assert');
const { periodFlow, budgetUsedShare } = require('../src/money-flow');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const close = (a, b, m, eps = 1e-9) => { ok(a !== null && Math.abs(a - b) < eps, `${m} (got ${a}, want ~${b})`); };

/* ---- 1. the rule itself ------------------------------------------------ */
{
  close(budgetUsedShare({ spend: 20000, setAside: 8000, budgeted: 20000 }), 0.6,
    '(spend − setAside) / budgeted');
  close(budgetUsedShare({ spend: 25859.95, setAside: 0, budgeted: 33100 }), 25859.95 / 33100,
    'with nothing set aside, spend over budget');
  eq(budgetUsedShare({ spend: 5000, setAside: 0, budgeted: 0 }), null,
    'no budget: null, never a division by zero');
  eq(budgetUsedShare({ spend: 5000, setAside: 0, budgeted: -1 }), null,
    'a negative budget is no budget');
  close(budgetUsedShare({ spend: 1000, setAside: 4000, budgeted: 20000 }), 0,
    'set-aside larger than spend floors the numerator at zero rather than reporting negative use');
  close(budgetUsedShare({ spend: 'x', setAside: undefined, budgeted: '20000' }), 0,
    'unreadable inputs read as zero, the same coercion periodFlow applies to every other figure');
  close(budgetUsedShare({ spend: 20000, setAside: 8000, assumed: 2000, budgeted: 20000 }), 0.7,
    'the assume-spent provision is added after set-aside comes out');
}

/* ---- 2. periodFlow hands the caller's set-aside to that rule ------------ */
const catType = cat => ({
  'RA Contribution': 'savings',
  'Emergency Fund Transfer': 'investment',
  Groceries: 'expense',
}[cat] || null);
const base = {
  income: 45000, spentTotal: 20000, setAsideSpent: 8000, budgeted: 20000,
  // The category map is deliberately EMPTY of the savings-typed entries: the
  // old rule found its numerator here; the new one must not need it.
  spendByCat: { Groceries: 12000 },
  fixedCats: new Set(['RA Contribution']), catType, savingContribution: 0, debts: [],
};
{
  const f = periodFlow(base);
  close(f.budget.budgetUsed, 0.6, 'budgetUsed = (20 000 − 8 000) / 20 000 from setAsideSpent alone');
  // Negative control: the pre-ADR shape. With the savings entries absent from
  // the map it would have read 1.0; with them present it would have read 0.6
  // only by luck of account configuration.
  ok(Math.abs(f.budget.budgetUsed - 1.0) > 0.1, 'control: not the unadjusted spent/budgeted');
}
{
  // The map DOES carry savings-typed entries (fund account out of budget):
  // budgetUsed must be unchanged — the map is not consulted for it.
  const withMapIn = { ...base, spendByCat: { ...base.spendByCat, 'RA Contribution': 3000, 'Emergency Fund Transfer': 5000 } };
  const withMap = periodFlow(withMapIn);
  close(withMap.budget.budgetUsed, 0.6, 'the category map neither adds to nor subtracts from budgetUsed');
  const allFixed = periodFlow({ ...withMapIn, fixedCats: new Set(['RA Contribution', 'Emergency Fund Transfer']) });
  close(allFixed.budget.budgetUsed, 0.6, 'nor does the fixed flag');
}
{
  // A caller that does not say what was set aside gets gross over budget —
  // an honest overstatement, never an inference.
  const silent = periodFlow({ ...base, setAsideSpent: undefined });
  close(silent.budget.budgetUsed, 1.0, 'no setAsideSpent: spent / budgeted, not a guess from the map');
}

/* ---- 3. ordinary vaults with no savings-typed spend are unaffected ------ */
{
  const plain = periodFlow({
    income: 45000, spentTotal: 25859.95, setAsideSpent: 0, budgeted: 33100,
    spendByCat: { Rent: 4410, Medical: 2850, 'Card Repayment': 7140, Groceries: 11460 },
    fixedCats: new Set(['Rent', 'Medical', 'Card Repayment']),
    catType: cat => ({ Rent: 'housing', Medical: 'insurance', Groceries: 'expense', 'Card Repayment': 'debt' }[cat] || null),
    savingContribution: 0, debts: [],
  });
  close(plain.budget.budgetUsed, 25859.95 / 33100, 'with nothing set aside, budgetUsed is spent/budgeted');
}

/* ---- 4. still null-safe with no budget ---------------------------------- */
{
  const f = periodFlow({ ...base, budgeted: 0 });
  eq(f.budget.budgetUsed, null, 'budgetUsed stays null rather than dividing by zero');
}

console.log(`PASS — budget-used-numerator (${checks} checks)`);
