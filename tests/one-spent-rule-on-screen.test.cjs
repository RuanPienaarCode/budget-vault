'use strict';
/* The one "budget used" rule, as the SCREEN prints it.

   tests/budget-used-one-rule.test.cjs pins the rule at the seam: budgetUsed(),
   the Score chip's inputs, the ring's numerator. It passed all the while the
   Dashboard hero printed a different rand figure two lines under its own
   headline, because it never read a rendered card.

   The 2026-09-06 audit measured that gap. On the committed fixture household
   the hero said "R 3 400 remaining" above "R 13 600,00 spent of R 15 500,00
   budgeted" — a sub-line implying R 1 900 — and a "Total spent" stat of
   R 13 600 beside a "78% used" tag whose numerator was R 12 100. The 78%
   survived review because 12 100/15 500 and 13 600/17 500 both round to 78%.
   On Ruan's real vault the same card read "Over budget R 6 161" above
   "R 47 054,27 spent of R 36 814,00 budgeted", which implies R 10 240.

   So this file asserts the FIGURES A READER SEES, at the addresses the numbers
   ledger names them by, and it asserts them against each other: a card whose
   headline, sub-line, stat and meter are all built from budgetUsed(p).spent
   cannot print two answers to one question no matter which of them is right.

     node tests/one-spent-rule-on-screen.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock, dispatchedViews, leaves, ownText } = require('./helpers/figures.cjs');
const { SEED, PERIOD, TODAY } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}\n    wanted: ${needle}\n    in:     ${hay}`);
const hasNot = (hay, needle, m) => ok(!hay.includes(needle), `${m}\n    must NOT contain: ${needle}\n    in: ${hay}`);

/* Every leaf's own text, in document order — the same collection rule the
   ledger harvests figures with, so an assertion here and a line there cannot
   disagree about what the card says. */
const textOf = el => (el ? leaves(el).map(ownText).filter(Boolean).join(' ') : '');

const dashboardView = () => {
  const v = dispatchedViews().find(x => x.view === 'dashboard');
  assert.ok(v, 'the dashboard view is dispatched');
  return v;
};

async function renderDash(files, { period = PERIOD, today = TODAY } = {}) {
  const unpin = pinClock(today);
  try {
    const { ctx, nodes } = await mountFor(files, { period });
    ctx[dashboardView().fn]();
    return { ctx, nodes, t: sel => textOf(nodes.get(sel)) };
  } finally { unpin(); }
}

(async () => {
  /* ---- 1. the fixture's four figures, stated once ---------------------- */
  const { ctx, t } = await renderDash(SEED);
  const used = ctx.budgetUsed(PERIOD);
  const sum = ctx.periodSummary(PERIOD);
  const bud = ctx.budgetTotals(PERIOD);

  ok(Math.abs(sum.spend - 13600) < 1e-9, `fixture check: gross spend is 13 600 (got ${sum.spend})`);
  ok(Math.abs(used.spent - 12100) < 1e-9, `fixture check: the one numerator is 12 100 (got ${used.spent})`);
  ok(Math.abs(bud.spend - 15500) < 1e-9, `fixture check: the spend envelopes are 15 500 (got ${bud.spend})`);
  ok(Math.abs(used.setAside - 2000) < 1e-9, `fixture check: 2 000 set aside (got ${used.setAside})`);
  ok(Math.abs(used.assumed - 500) < 1e-9, `fixture check: a 500 assume-spent provision (got ${used.assumed})`);
  ok(sum.spend !== used.spent, 'fixture check: the two rules DISAGREE here, so these assertions can fail');

  /* ---- 2. the hero prints the one numerator, everywhere it prints one --- */
  const hero = t('#heroCard');
  has(hero, 'R 12 100,00 spent of R 15 500,00 budgeted',
    'hero sub-line: the one numerator against the spend envelopes');
  hasNot(hero, 'R 13 600,00 spent',
    'hero sub-line: gross spend is not what "spent" means on this card');
  /* The headline renders its currency symbol as its own element, so the
     figure's own text is the bare amount. */
  has(hero, '3 400', 'hero headline: budgeted less that same numerator');
  has(hero, '78% used', 'hero tag: the share built from the same two figures');

  /* The stat under "Total spent". Read by address rather than by scanning the
     whole card, because 12 100 also appears in the sub-line above it. */
  const statSpent = t('#heroCard').match(/R 12 100,00/g) || [];
  ok(statSpent.length >= 2,
    `hero: BOTH the sub-line and the "Total spent" stat print the numerator (found ${statSpent.length})`);

  /* ---- 3. and it says what it left out and what it added in ------------ */
  has(hero, 'R 2 000', 'hero: the set-aside held out of the numerator is named');
  has(hero, 'R 500', 'hero: the assume-spent provision added into it is named');

  /* ---- 4. the card cannot contradict itself ---------------------------- */
  /* The arithmetic a reader does in their head: budgeted − spent = remaining.
     Before the fix this failed on the printed figures (15 500 − 13 600 = 1 900
     against a headline of 3 400) while every individual figure was defensible
     on its own. */
  ok(Math.abs((bud.spend - used.spent) - 3400) < 1e-9,
    'the printed sub-line subtracts to the printed headline');

  /* ---- 5. the Score page's second "remaining" rule --------------------- */
  const { periodFlow } = require('../src/money-flow');
  const spend = ctx.periodSpend(PERIOD, null);
  const flow = periodFlow({
    income: sum.income, spentTotal: sum.spend, setAsideSpent: sum.setAside, assumedSpent: used.assumed,
    budgeted: bud.spend, budgetSetAside: bud.setAside,
    spendByCat: spend.whole, fixedCats: new Set(), catType: ctx.catType,
    savingContribution: 0, debts: [], household: 'R', budgetIncome: bud.income, periodFinished: false,
  });
  ok(Math.abs(flow.lefts.leftInBudget - 3400) < 1e-9,
    `Score "Left in the budget" is the hero's remaining, not budgeted less gross (got ${flow.lefts.leftInBudget})`);
  ok(Math.abs((flow.lefts.leftInBudget + flow.lefts.neverBudgeted) - (flow.income - flow.budget.spent)) < 1e-9,
    'and the two lefts still reconcile — against the one numerator now');

  /* ---- 6. the trend chart compares like with like ---------------------- */
  const trend = t('#trendChart');
  has(trend, 'R 12 100,00',
    'trend chart: the running bar plots the same numerator the hero prints');
  hasNot(trend, 'R 13 600,00',
    'trend chart: not gross spend against spend-only envelopes');

  /* ---- 7. the donut says what its slices include ----------------------- */
  const split = t('#dashSplit');
  has(split, 'R 2 000',
    'donut: the set-aside slice inside "categorised spending" is disclosed, not silently a slice');

  /* ---- 8. a position figure "as things stand today" is the implied one -- */
  const pos = t('#dashPositionKpis');
  has(pos, 'R 14 500',
    'Savings & investments tile: the implied balance, the one net worth beside it uses');
  hasNot(pos, 'R 15 000',
    'Savings & investments tile: not the stated balance nobody else on the card uses');

  /* ---- 9. refunds netted inside the period are disclosed on the hero ---- */
  /* P1 on Ruan's vault: an R 11 377,86 repair refunded three days later is
     counted as spend in full by the BUDGET lens (gross, by design) while the
     per-category table nets it to R −0,14. The hero was the one surface that
     printed neither the refund nor a word about it. */
  const REFUNDED = {
    ...SEED,
    [`Budget/Transactions/Cheque/${PERIOD}.md`]:
      SEED[`Budget/Transactions/Cheque/${PERIOD}.md`]
      + '| 2026-09-02 | Mechanic | Groceries | -3000.00 |  |  |  |\n'
      + '| 2026-09-02 | Mechanic refund | Groceries | 3000.00 |  |  |  |\n',
  };
  const refunded = await renderDash(REFUNDED);
  has(refunded.t('#heroCard'), 'R 3 000',
    'hero: a refund netted off inside the period is named, the way the Budget page already names it');

  console.log(`one-spent-rule-on-screen — ${checks} checks OK`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
