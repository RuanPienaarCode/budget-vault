'use strict';
/* budgetTotals() must bucket a budget row by the category's CURRENT type.

   Budgets/<period>.md carries a Type cell that was written the last time that
   row was saved, and there is no re-type UI — correcting a category's type
   means editing Categories/<name>.md, which leaves every row already on disk
   stating the old type until its own next save. serializeBudgetFile writes
   `r.type` back verbatim, so the stale cell never heals on its own.

   views/budgets.js already reads the live answer (`catType(d.category) ??
   d.type`, twice — the totals strip and the group bars; see
   tests/budget-stale-type-guard.test.cjs for why). budgetTotals() did not, so
   the two disagreed about the same file with no save in between — and
   budgetTotals is the one the rest of the app believes:

     - the Dashboard hero's "remaining" line (income − spend),
     - the trend chart's budget line,
     - money-flow's budgetUsed denominator,
     - health-data.js's budget pillar in the score,
     - the Report.

   Measured on the fixture below (Bonus retyped to income, its July row still
   saying expense): the Budget page's own tiles read income 15 000 / budgeted
   3 000, while budgetTotals said {income: 10 000, spend: 8 000} — so the
   Dashboard printed "R 6 800 remaining", R 5 000 too high, on the same period
   the Budget page had just described correctly.

   `?? `, not `||`: catType returns null both for "no such category file" and
   for "this row names nothing", and only in that case may the row's own
   stored cell stand in. A category whose file says `expense` must not be
   overridden by a stale cell saying anything else.

   Runs in bare node against the REAL loader (tests/helpers/harness.cjs) —
   no DOM, because budgetTotals is published on ctx by src/period.js.
     node tests/period-budget-totals-live-type.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';

/* Bonus is typed `income` in its category file today; its July budget row was
   saved back when it was `expense` and still says so. Transfers is typed
   `transfer`, which has never counted as spend. Ghost names a category with no
   file at all — the ONLY row whose stored cell is still the best answer. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Bonus.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Transfers.md`]: '---\ntype: transfer\ncolor: "#777777"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Bonus | expense | 5000.00 | retyped to income in its category file |\n'
    + '| Salary | income | 10000.00 | |\n'
    + '| Groceries | expense | 3000.00 | |\n'
    + '| Transfers | transfer | 2000.00 | never spend |\n'
    + '| Ghost | expense | 800.00 | no category file to ask |\n',
};

(async () => {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  S.period = '2026-07';

  /* The stored cells are untouched by the fix — this is what makes the bug
     permanent rather than self-healing, and asserting it here stops a future
     "fix" that quietly rewrites the file instead of reading past it. The app
     argues with the stale cell; it does not correct it behind the reader. */
  eq(S.budgets['2026-07'].map(r => r.type),
    ['expense', 'income', 'expense', 'transfer', 'expense'],
    'the Type cells on disk still say what they said — nothing rewrites them');

  eq(ctx.budgetTotals('2026-07'), { income: 15000, spend: 3800 },
    'a retyped category counts as income wherever budgetTotals is read — ' +
    'Bonus joins Salary, transfers stay out of spend, and only Ghost (no ' +
    'category file) is still bucketed by its own stored cell');

  /* The same predicate the Budget page renders with, asserted side by side:
     one file, one period, one answer. This is the disagreement the bug was. */
  const pageIncome = S.budgets['2026-07']
    .filter(d => (ctx.catType(d.category) ?? d.type) === 'income')
    .reduce((a, d) => a + d.amount, 0);
  eq(ctx.budgetTotals('2026-07').income, pageIncome,
    'budgetTotals and views/budgets.js must agree — they read the same rows through the same predicate');

  /* The fallback is a fallback, not a preference: correcting Bonus back to
     expense in its file must move it back, with no save of the budget file. */
  const ctx2 = makeCtx({ ...FILES, [`${B}/Categories/Bonus.md`]: '---\ntype: expense\ncolor: "#33aa66"\n---\n' });
  const S2 = await loadInto(ctx2);
  S2.period = '2026-07';
  eq(ctx2.budgetTotals('2026-07'), { income: 10000, spend: 8800 },
    'the live type is followed in BOTH directions — the category file is the answer, every render');

  /* A period with no budget file at all still totals to zeros rather than
     throwing on `undefined.filter` — the shape every caller assumes. */
  eq(ctx.budgetTotals('2026-06'), { income: 0, spend: 0 },
    'a period with no budget file totals to zeros');

  console.log(`period-budget-totals-live-type.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
