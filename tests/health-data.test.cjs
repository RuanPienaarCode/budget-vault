'use strict';
/* health-data.js — the ctx assembly behind health-math's pure arithmetic.

   Driven through the REAL loader and the REAL healthSnapshot (tests/helpers/
   harness.cjs), because the two bugs pinned here both live in the gap between
   "what health-math computes" and "what health-data hands it" — a pure test of
   health-math alone cannot see either one.

     1. THE DIVISOR MATCHES THE NUMERATOR. resolveEarmarks (health-math.js)
        reads every account unfiltered; the essential-spend divisor used to
        come from periodSpend, which drops `excluded` rows and `budget: false`
        accounts — the right rule for a BUDGET total, the wrong one for "what
        must the household keep paying with no income". A real bill paid from
        a joint account marked out of the budget, or an essential bill marked
        Excluded for some unrelated reason, still has to be covered by the
        fund the month income stops.

     2. THE SAVINGS RATE NETS WITHDRAWALS. A rand moved from one savings
        account to another used to read as fresh saving in the receiving
        account with nothing taken off the sending one — an internal transfer
        inflating the rate exactly the way a savings-to-savings move should
        not.

     node tests/health-data.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++; };

const B = 'Budget';
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const TX_FM = '---\nkind: transactions\n---';
const table = rows =>
  `${TX_FM}\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n${rows.join('\n')}\n`;

/* ---- 1. the emergency divisor reads the WHOLE household, not just the
   budget-scoped, non-excluded slice periodSpend hands everything else ---- */
(async () => {
  const SETTINGS = { month_start_day: 1, currency: 'R', country: 'za' };
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
    [`${B}/Categories/Rent.md`]: '---\ntype: housing\n---\n',

    // In the budget — the account periodSpend already covers correctly.
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 100000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
    // Out of the budget — a real joint account the household still pays rent
    // from. The numerator (resolveEarmarks) never filters by this flag; the
    // divisor must not either.
    [`${B}/Accounts/Joint.md`]:
      '---\ntype: checking\nbalance: 5000.00\nbalance_updated: 2026-08-01\ntx_label: "Joint"\nbudget: false\n---\n',
    [`${B}/Accounts/Emergency Fund.md`]:
      '---\ntype: savings\nbalance: 13000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\n---\n',
  };
  for (const m of MONTHS) {
    FILES[`${B}/Transactions/Cheque/${m}.md`] = table([
      `| ${m}-01 | Salary | Salary | 45000.00 | | | |`,
      `| ${m}-05 | Groceries | Groceries | -4000.00 | | | |`,
      // An essential bill EXCLUDED from the budget for an unrelated reason
      // (reimbursed, say) — still money that left the household.
      `| ${m}-10 | Rent top-up | Rent | -1000.00 | yes | | |`,
    ]);
    FILES[`${B}/Transactions/Joint/${m}.md`] = table([
      `| ${m}-02 | Rent | Rent | -8000.00 | | | |`,
    ]);
  }

  const ctx = makeCtx(FILES, { budgetFolder: B, settings: SETTINGS });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  const snap = ctx.healthSnapshot();
  const H = snap.metrics;

  // Household essential = 4000 (Groceries, in-budget) + 8000 (Rent, non-budget
  // account) + 1000 (Rent top-up, excluded row) = 13000/mo.
  near(H.monthlyEssential, 13000, 0.01, 'essential spend counts the non-budget account AND the excluded row');
  near(H.months, 13000 / 13000, 0.01, 'so a R13,000 fund reads as exactly one month of real cover');
  ok(Math.abs(H.months - 13000 / 4000) > 1,
    'and NOT the budget-only, non-excluded figure the bug used to divide by (which would read ~3.25 months)');

  console.log(`PASS  health-data.test.cjs / part 1  (${checks} checks)`);
})();

/* ---- 2. the savings rate nets withdrawals — an internal transfer between
   two savings accounts must not read as fresh saving ---- */
(async () => {
  const SETTINGS = { month_start_day: 1, currency: 'R', country: 'za' };
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
    [`${B}/Categories/Move.md`]: '---\ntype: expense\n---\n',

    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 100000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
    [`${B}/Accounts/Save A.md`]:
      '---\ntype: savings\nbalance: 20000.00\nbalance_updated: 2026-08-01\ntx_label: "Save A"\n---\n',
    [`${B}/Accounts/Save B.md`]:
      '---\ntype: savings\nbalance: 20000.00\nbalance_updated: 2026-08-01\ntx_label: "Save B"\n---\n',
  };
  for (const m of MONTHS) {
    FILES[`${B}/Transactions/Cheque/${m}.md`] = table([
      `| ${m}-01 | Salary | Salary | 45000.00 | | | |`,
      `| ${m}-05 | Groceries | Groceries | -30000.00 | | | |`,
    ]);
    // R5,000 moved from Save A into Save B, every period — nothing new saved.
    FILES[`${B}/Transactions/Save A/${m}.md`] = table([
      `| ${m}-15 | Move to Save B | Move | -5000.00 | | | |`,
    ]);
    FILES[`${B}/Transactions/Save B/${m}.md`] = table([
      `| ${m}-15 | From Save A | Move | 5000.00 | | | |`,
    ]);
  }

  const ctx = makeCtx(FILES, { budgetFolder: B, settings: SETTINGS });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  const snap = ctx.healthSnapshot();
  const H = snap.metrics;

  near(H.monthlySavings, 0, 0.01,
    'a rand moved between two savings accounts nets to zero real saving, not R5,000 of it');
  eq(H.savingsRate, 0, 'so the savings rate reads 0%, not 11% off a transfer the household never made');

  console.log(`PASS  health-data.test.cjs / part 2  (${checks} checks)`);
})();
