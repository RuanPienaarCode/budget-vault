'use strict';
/* The seven ship-blockers a 13-agent audit found in v1.22.7, pinned.

   Every one of these shipped GREEN through all 78 existing guard suites, so
   the point of this file is not that the maths is hard — it is that nothing
   was asking these particular questions. Each block names the figure a reader
   actually saw and what it should have said instead.

   Only the pure modules are exercised here; the two findings that live in view
   geometry (the savings growth chart's y-scale, and the Sankey's band layout)
   are pinned indirectly, through the contracts their callers depend on.

     node tests/audit-criticals.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const H = require('../src/health-math');
const { normalizeAmount } = require('../src/amount');
const { reconcile, stalenessSummary } = require('../src/reconcile');
const { whatsLeft } = require('../src/committed');
const { largestRemainder, sharePercents } = require('../src/share-percents');
const { periodFlow } = require('../src/money-flow');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); checks++; };

/* ---- C1. A household with no recognised income scored 100 / "Strong" ----

   `budgetUsed` was the one measure not gated on income. Every sibling went
   null, the outer renormalisation handed the whole 100 to that single
   5-point measure, and a household with a typo'd income category and an
   overdrawn cheque account was congratulated. Reachable without exotic data:
   income filed under a category whose file does not exist, all income landing
   in a `budget: false` account, or a manual vault with no income category. */
{
  const periods = income => Array.from({ length: 6 }, () => ({
    income, essential: 12000, savings: 0, consumption: 12000,
    fixed: 0, budgeted: 15000, counted: true,
  }));
  const metrics = income => H.healthMetrics({
    periods: periods(income), monthsPerPeriod: 1,
    earmarks: { any: false, total: 0 }, targetMonths: 6,
    debtInterest: 0, debtInstalments: null, netWorth: -20000, hasFixed: false,
  });

  const broke = metrics(0);
  eq(broke.budgetUsed, null, 'budget adherence is unmeasurable without income, not a free 100');
  eq(H.financialScore(H.scoreFractions(broke)), null,
    'nothing measurable means NO score — a fabrication is worse than a blank');

  const earning = metrics(30000);
  ok(earning.budgetUsed !== null, 'a household that does earn is still scored on its plan');
  const score = H.financialScore(H.scoreFractions(earning));
  ok(score && score.value > 0 && score.value <= 100, 'and gets a real score in range');
}

/* ---- C2. A blank Rate earned full marks on the debt pillar ----

   table-schema's money() reader turns an empty `Rate` cell into 0, and
   monthlyRate(0) is 0 — so R250 000 of debt produced a MEASURED zero cost and
   scoreDown(0, 0, 0.10) returned full marks, under the sentence "Nothing is
   lost to interest." This is the same null-vs-zero rule health-data already
   applied to `payment`, which had been fixed and never rippled to `rate`. */
{
  const active = (balance, rate) => ({ status: 'active', balance, rate, type: 'credit card' });

  eq(H.debtInterestMonthly([active(250000, 0)]), null,
    'debts listed but no rate stated is UNMEASURED, not a cost of zero');
  eq(H.debtInterestMonthly([]), 0,
    'an empty book really is no interest — a claim about the household, not a gap');
  near(H.debtInterestMonthly([active(250000, 18.5)]), 3854.17, 0.01,
    'a stated rate still costs what it costs');
  /* Some known, some blank still totals what IS known: understating a burden
     is the safe direction, and a partial figure moves the score toward the
     truth where null would leave it untouched. Same argument health-data.js
     makes for a partially-stated set of payments. */
  near(H.debtInterestMonthly([active(250000, 0), active(100000, 12)]), 1000, 0.01,
    'a partially-rated book totals the part it can measure');
}

/* ---- C2b. "18.5%" under a column header named Rate read as ZERO ----

   normalizeAmount strips a currency PREFIX but had no idea about a percent
   SUFFIX, so the value failed the decimal test, came back null, and parseNum
   served 0. The file's own prose calls this column "the annual interest rate
   as a percentage", so typing the percent sign is the obvious hand-edit. */
{
  eq(normalizeAmount('18.5%'), 18.5, 'a trailing percent is a unit, not a parse failure');
  eq(normalizeAmount('18,5%'), 18.5, 'and the decimal-comma convention still applies under it');
  eq(normalizeAmount('18.5 %'), 18.5, 'spaced the same way a person would type it');
  eq(normalizeAmount('18.5'), 18.5, 'a bare rate is unaffected');
  eq(normalizeAmount('R150.00'), 150, 'the currency prefix still strips');
  eq(normalizeAmount('%'), null, 'a lone percent sign is still not a number');
  eq(normalizeAmount('12%%'), null, 'and neither is a doubled one');
}

/* ---- C3. Reconciliation contract ---- */
{
  const T = '2026-08-24';

  /* Rows that net to nothing have not moved the balance. Read as a drift, the
     card printed "2 transactions imply R1 000,00, NOT R1 000,00" and sorted
     itself above genuinely stale accounts. */
  const wash = reconcile({ balance: 1000, balance_updated: '2026-08-01' },
    [{ date: '2026-08-10', amount: -2000 }, { date: '2026-08-10', amount: 2000 }], T);
  eq(wash.state, 'clean', 'money out and straight back is not a disagreement');
  eq(wash.count, 2, 'but the rows are still counted, so the date can still be confirmed');

  /* A confirmation dated in the FUTURE is a typo, and used to be the most
     effective way to silence an account completely: a year slip put every real
     row behind the window, the pill went green, and the account dropped out of
     the queue AND the attention count over unaccounted spending. */
  const typo = reconcile({ balance: -500, balance_updated: '2027-08-01' },
    [{ date: '2026-08-05', amount: -2100 }], T);
  eq(typo.state, 'no-date', 'a date the vault has not reached places no window');

  /* A real drift still drifts — and now carries the rows that caused it, so a
     view can show WHICH ones rather than reporting a delta and leaving the
     reader to hunt. */
  const drift = reconcile({ balance: 1000, balance_updated: '2026-08-01' },
    [{ date: '2026-08-10', amount: -250 }, { date: '2026-08-20', amount: -100 }], T);
  eq(drift.state, 'drift', 'a real disagreement is still reported');
  eq(drift.delta, -350, 'with its arithmetic intact');
  eq(drift.implied, 650, 'and the figure it implies');
  ok(Array.isArray(drift.since) && drift.since.length === 2,
    'and the rows behind it, so the delta can be explained rather than just stated');

  /* stalenessSummary read a future stamp as a NEGATIVE age, which dragged
     `oldest` to -1 and printed "oldest: none" for a vault where every balance
     carried a date. */
  const s = stalenessSummary([{ balance_updated: '2026-08-19' }, { balance_updated: '2027-08-01' }], T);
  eq(s.oldestDays, 5, 'a future stamp is no age at all, so it cannot become the oldest');
  eq(s.stale, 1, 'and it counts as unconfirmed rather than as freshly confirmed');
  eq(s.dated, 1, 'only the one real date is a date');
}

/* ---- C5. "Incoming" double-spent the salary the card band had already claimed ----

   `incoming` and `cycle.settling` are the SAME credit. Inside a settlement
   cycle `free` already excludes cardDue on the grounds that the card is
   handled by its own band below — and that band is funded by exactly this
   salary. Adding it back to `free` spent it twice, overstating the one figure
   on the card that answers "what is safe to spend" by the whole card balance.

   Invisible on a payday-anchored month, because the salary lands in the next
   period and `incoming` is null. Every month_start_day: 1 vault hit it. */
{
  const incomeRows = ['2026-05-25', '2026-06-25', '2026-07-25']
    .map(date => ({ date, amount: 20000, desc: 'Salary', cat: 'Salary' }));
  const L = whatsLeft({
    accounts: [
      { name: 'Cheque', implied: 13000, dated: true, inBudget: true, type: 'checking' },
      { name: 'Visa', implied: -18000, dated: true, inBudget: true, type: 'credit_card', settle_monthly: true },
    ],
    services: [], debts: [], rows: [], incomeRows,
    cardRows: [{ date: '2026-08-03', amount: -18000 }],
    periodStart: '2026-08-01', periodEnd: '2026-08-31', today: '2026-08-20',
  });

  eq(L.free, 13000, 'free excludes the card while its own band is handling it');
  eq(L.cardDue, 18000, 'and the card is genuinely due');
  ok(L.cycle && L.incoming, 'this is the shape where both bands are live at once');
  eq(L.afterIncoming, 15000,
    'the salary funds the card ONCE: 13000 + 20000 - 18000, not 33000');
  ok(L.afterIncoming !== L.free + L.incoming.amount,
    'and specifically not the naive sum the view used to print');
}
{
  /* Outside a settlement cycle there is nothing to net out, and the figure is
     the plain sum again — the fix must not quietly subtract a card that is not
     being settled. */
  const incomeRows = ['2026-05-25', '2026-06-25', '2026-07-25']
    .map(date => ({ date, amount: 20000, desc: 'Salary', cat: 'Salary' }));
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 13000, dated: true, inBudget: true, type: 'checking' }],
    services: [], debts: [], rows: [], incomeRows, cardRows: [],
    periodStart: '2026-08-01', periodEnd: '2026-08-31', today: '2026-08-20',
  });
  eq(L.cycle, null, 'no settle-monthly card, no cycle');
  eq(L.afterIncoming, L.free + L.incoming.amount, 'so the plain sum is the right answer');
}
{
  /* Nothing arriving means no sentence to render, rather than a sentence
     about zero. */
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 13000, dated: true, inBudget: true, type: 'checking' }],
    services: [], debts: [], rows: [], incomeRows: [], cardRows: [],
    periodStart: '2026-08-01', periodEnd: '2026-08-31', today: '2026-08-20',
  });
  eq(L.incoming, null, 'no recurring credit found');
  eq(L.afterIncoming, null, 'and so no "after payday" figure to state');
}

/* ---- C7. Percentages that legitimately exceed 100 ----

   largestRemainder computes `left = target - sum(floors)` and tops up while
   `left > 0`. When the values ALREADY exceed the target that goes negative,
   the loop never runs, and it returns bare floors summing to anything — which
   the Sankey then laid out as if they summed to 100, walking real bands off
   the bottom of a 280-unit viewBox. The percentages themselves are honest: in
   an overspent period living costs really can be 180% of income. So the
   allocation is used only where it applies, and the LAYOUT scales by the sum. */
{
  eq(largestRemainder([33.3, 33.3, 33.4], 100).reduce((a, b) => a + b, 0), 100,
    'a genuine partition still lands on exactly the target');
  eq(sharePercents([1000.5, 1000.5, 1000.5, 1000.5]).reduce((a, b) => a + b, 0), 100,
    'and sharePercents normalises first, so it is always a partition');

  /* The deficit shape: spend and saving together exceed income. */
  const flow = periodFlow({
    income: 40000, spentTotal: 45000, budgeted: 36000,
    fixedTotal: 15000, savingContribution: 5000, debts: [],
  });
  const p = flow.bands.percents;
  const sum = p.committed + p.living + p.saving + p.notYetSpent;
  ok(sum > 100, 'an overspent period legitimately reports more than 100% of income');
  ok(Object.values(p).every(v => Number.isFinite(v)), 'and every band is still a real number');
  /* The bug was never the arithmetic — it was a consumer dividing by a hard
     100. Anything laying these out must scale by their own sum. */
  const pctSpan = Math.max(100, sum);
  const innerH = 228;
  const heights = [p.committed, p.living, p.saving, p.notYetSpent]
    .map(v => Math.max(0, v / pctSpan) * innerH);
  ok(heights.reduce((a, b) => a + b, 0) <= innerH + 0.001,
    'scaled by their own sum, the bands fit the plot they are drawn in');
  ok(heights.every(h => h >= 0), 'and none of them is drawn backwards');
}


/* ---- HOTFIX 1.23.1. The savings rate was unfair in both directions ----

   1.23.0 netted withdrawals off CONTRIBUTIONS, which sounds symmetric and is
   not: classifyRow sorts a positive row into `growth` whenever its category is
   income-typed, while a negative row is a `withdrawal` unconditionally. So an
   inflow can be dropped from the very figure the outflow is then subtracted
   from.

   Caught on a real vault: a R40 000 UIF reimbursement landing in a savings
   account under an income-typed "Reimbursements" category was classified as
   growth and excluded, while every rand that later left counted in full. The
   household was told it had saved -19% of its income. The rows below are that
   month, unchanged. */
{
  const { splitFlows } = require('../src/savings-math');
  const rows = [
    { date: '2026-08-07', desc: 'UIF', cat: 'Reimbursements', amount: 40000 },
    { date: '2026-08-11', desc: 'demand savings', cat: 'Discovery 32 Day', amount: 4300 },
    { date: '2026-08-11', desc: 'Subaru maintenance', cat: 'Car maintenance', amount: -11514 },
    { date: '2026-08-23', desc: 'Emergency savings', cat: 'Discovery 32 Day', amount: -4270 },
    { date: '2026-08-23', desc: 'settling up', cat: 'Settle Credit Card', amount: -5200 },
  ];
  const catType = c => (c === 'Reimbursements' || c === 'Interest income' ? 'income' : 'expense');
  const f = splitFlows(rows, catType, {});

  eq(f.growth, 40000, 'the reimbursement is classified as growth — that is the trap, not the bug');
  eq(f.withdrawals, 20984, 'and every outflow counts in full');
  ok(f.contributions - f.withdrawals < 0,
    'so contributions-minus-withdrawals reports a LOSS on a month that gained R23 316');
  eq(f.net, 23316, 'net is the symmetric figure: everything in, less everything out');
  ok(f.net > 0, 'and it gets the direction right, which is the whole point');

  /* The asymmetry itself, stated as an invariant rather than as one example:
     a positive row may leave `contributions`, but no row ever leaves
     `withdrawals`, so any figure built on contributions alone is biased down
     by exactly the growth-classified inflows. */
  eq(f.contributions + f.growth - f.withdrawals, f.net,
    'net accounts for every classified row, in both directions');
}
console.log(`audit-criticals.test.cjs — ${checks} checks OK`);
