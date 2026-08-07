'use strict';
/* Debt payoff maths.

   The Debt view tells a reader when they will be out of debt and what a method
   saves them. Those are the two numbers a person makes a real decision on, so
   they get pinned against hand-computable cases rather than eyeballed in the
   UI. src/debt-math.js has no DOM and no obsidian import, so this runs in bare
   node with no stub at all.

     node tests/debt-math.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths } = require('../src/debt-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++; };

/* ---- 1. interest-free debt is plain division ---- */
{
  const a = amortise(1200, 0, 100);
  eq(a.months, 12, '1200 at 0% paying 100 clears in exactly 12 months');
  eq(a.interest, 0, 'no rate means no interest');
  ok(a.settled, 'and it settles');
}

/* ---- 2. an interest-bearing debt against the closed-form answer ----
   10 000 at 12% a year (1%/month) paying 500: the standard annuity formula
   gives n = -ln(1 - 0.01*10000/500) / ln(1.01) = 22.4 → 23 payments, the last
   one partial. Interest paid ≈ total paid − principal. */
{
  const a = amortise(10000, 12, 500);
  eq(a.months, 23, '10k at 12% paying 500 takes 23 months');
  ok(a.settled, 'it settles');
  near(a.interest, 1197, 30, 'interest over the life is a bit under 1 200');
}

/* ---- 3. the case a closed-form formula returns NaN for ----
   A payment at or below the monthly interest never touches principal. This is
   the single most important thing on the page to get right: it is the reader
   in actual trouble, and a blank or NaN cell is exactly when they need words. */
{
  const interestOnly = monthlyInterest(10000, 24);   // 200/month
  eq(interestOnly, 200, 'monthly interest on 10k at 24% is 200');
  const a = amortise(10000, 24, 200);
  ok(!a.settled, 'paying exactly the interest never settles');
  const b = amortise(10000, 24, 150);
  ok(!b.settled, 'paying less than the interest never settles either');
  const c = amortise(10000, 24, 0);
  ok(!c.settled, 'paying nothing never settles');
  eq(c.interest, 0, 'and a zero payment reports no interest rather than infinity');
}

/* ---- 4. a debt already at zero is settled, not a one-month plan ---- */
{
  const a = amortise(0, 18, 500);
  eq(a.months, 0, 'a cleared debt takes no months');
  ok(a.settled, 'and counts as settled');
}

/* ---- 5. attack order — the ONLY thing separating the two methods ---- */
{
  const debts = [
    { name: 'Card', balance: 8000, rate: 22, payment: 400 },
    { name: 'Car', balance: 60000, rate: 11, payment: 1500 },
    { name: 'Store', balance: 2000, rate: 25, payment: 200 },
  ];
  eq(priorityOrder(debts.map(d => ({ ...d })), 'avalanche').map(d => d.name),
    ['Store', 'Card', 'Car'], 'avalanche targets the highest rate first');
  eq(priorityOrder(debts.map(d => ({ ...d })), 'snowball').map(d => d.name),
    ['Store', 'Card', 'Car'], 'snowball targets the smallest balance first');

  // A case where the two genuinely disagree — the expensive debt is the big one.
  const split = [
    { name: 'Big expensive', balance: 50000, rate: 24, payment: 1000 },
    { name: 'Small cheap', balance: 3000, rate: 5, payment: 200 },
  ];
  eq(priorityOrder(split.map(d => ({ ...d })), 'avalanche')[0].name, 'Big expensive',
    'avalanche goes for the rate');
  eq(priorityOrder(split.map(d => ({ ...d })), 'snowball')[0].name, 'Small cheap',
    'snowball goes for the balance');
}

/* ---- 6. a lone debt simulates identically to amortising it ---- */
{
  const solo = [{ name: 'Only', balance: 10000, rate: 12, payment: 500, extra: 0 }];
  const direct = amortise(10000, 12, 500);
  const sim = simulate(solo, { strategy: 'minimum' });
  eq(sim.months, direct.months, 'one debt on its own must agree with amortise()');
  near(sim.interest, direct.interest, 0.01, 'and so must its interest');
  eq(sim.payoff[0], direct.months, 'the payoff month is recorded against the debt\'s key');
}

/* ---- 6b. two debts sharing a name keep separate payoff months ----
   "Credit card" once per bank is an ordinary household, not an edge case. The
   payoff map used to be keyed by name, so the second one silently overwrote
   the first and the attack-order list showed both clearing on the same date —
   the later one, so the reader was told the small card takes as long as the
   big one. */
{
  const twins = [
    { name: 'Credit card', balance: 2000, rate: 20, payment: 500, extra: 0 },
    { name: 'Credit card', balance: 40000, rate: 20, payment: 900, extra: 0 },
  ];
  const sim = simulate(twins, { strategy: 'minimum' });
  eq(Object.keys(sim.payoff).length, 2, 'both same-named debts get their own payoff entry');
  ok(sim.payoff[0] < sim.payoff[1], 'the small one clears first, and says so');

  // A caller supplying its own keys (the view does) must have them honoured.
  const keyed = simulate(twins.map((d, i) => ({ ...d, key: `d${i}` })), { strategy: 'minimum' });
  eq(Object.keys(keyed.payoff).sort(), ['d0', 'd1'], 'caller-supplied keys are used verbatim');
}

/* ---- 7. rollover is what makes snowball/avalanche beat the baseline ----
   With no extra at all, the two methods still finish sooner than "minimum
   only", purely because a closed debt's payment moves to the next one. If this
   ever stops being true the plan card is lying about its own premise. */
{
  const debts = [
    { name: 'Store', balance: 2000, rate: 25, payment: 200, extra: 0 },
    { name: 'Card', balance: 8000, rate: 22, payment: 400, extra: 0 },
    { name: 'Car', balance: 60000, rate: 11, payment: 1500, extra: 0 },
  ];
  const base = simulate(debts, { strategy: 'minimum' });
  const ava = simulate(debts, { strategy: 'avalanche', extra: 0 });
  const sno = simulate(debts, { strategy: 'snowball', extra: 0 });
  ok(base.settled && ava.settled && sno.settled, 'all three plans settle');
  ok(ava.months < base.months, 'avalanche clears sooner than minimum-only through rollover alone');
  ok(sno.months < base.months, 'so does snowball');
  ok(ava.interest < base.interest, 'and costs less interest');
  // Avalanche is the mathematically cheapest ordering, by definition.
  ok(ava.interest <= sno.interest + 0.01, 'avalanche never costs more interest than snowball');

  /* Extra money strictly improves things — a plan that ignored the input would
     return the same figures here and nobody would notice in the UI. */
  const withExtra = simulate(debts, { strategy: 'avalanche', extra: 1000 });
  ok(withExtra.months < ava.months, 'an extra 1 000 a month clears the debt sooner');
  ok(withExtra.interest < ava.interest, 'and cuts the interest');
}

/* ---- 8. simulate() does not mutate the caller's debts ----
   S.debts is passed straight in from the view and re-simulated on every
   keystroke in the extra field. Mutating it would drain the reader's real
   balances to zero as they typed. */
{
  const debts = [{ name: 'Card', balance: 8000, rate: 22, payment: 400, extra: 0 }];
  simulate(debts, { strategy: 'avalanche', extra: 500 });
  eq(debts[0].balance, 8000, 'the caller\'s balance must be untouched');
}

/* ---- 9. a stalled debt is named, not silently dropped ---- */
{
  const debts = [
    { name: 'Fine', balance: 1000, rate: 0, payment: 500, extra: 0 },
    { name: 'Drowning', balance: 20000, rate: 30, payment: 100, extra: 0 },
  ];
  const base = simulate(debts, { strategy: 'minimum' });
  ok(!base.settled, 'the plan does not claim to settle');
  eq(base.stalled, ['Drowning'], 'and names exactly the debt that never clears');
  // Enough extra, and even that one clears — the pool must reach it.
  const rescued = simulate(debts, { strategy: 'avalanche', extra: 900 });
  ok(rescued.settled, 'a large enough extra payment rescues it');
}

/* ---- 10. an empty list is a settled plan, not a crash ---- */
{
  const empty = simulate([], { strategy: 'avalanche', extra: 500 });
  eq(empty.months, 0, 'no debts means no months');
  ok(empty.settled, 'and a settled plan');
  eq(simulate(null).months, 0, 'a missing list is handled too');
  // Zero balances are filtered before the loop, so a fully-paid list behaves
  // the same as an empty one rather than looping to the cap.
  eq(simulate([{ name: 'Done', balance: 0, rate: 20, payment: 0 }]).months, 0,
    'a fully-paid list is settled');
}

/* ---- 11. a debt's own standing extra counts under every method ---- */
{
  const withOwn = [{ name: 'Card', balance: 8000, rate: 22, payment: 400, extra: 300 }];
  const without = [{ name: 'Card', balance: 8000, rate: 22, payment: 400, extra: 0 }];
  ok(simulate(withOwn, { strategy: 'minimum' }).months < simulate(without, { strategy: 'minimum' }).months,
    'a standing extra is committed money and must shorten even the baseline');
}

/* ---- 12. date + duration formatting ---- */
{
  const from = new Date(2026, 7, 15);           // Aug 2026
  eq(addMonths(0, from), '2026-08', 'zero months is this month');
  eq(addMonths(1, from), '2026-09', 'one month on');
  eq(addMonths(5, from), '2027-01', 'crossing the year boundary');
  eq(addMonths(29, from), '2029-01', 'crossing two years');
  eq(humanMonths(1), '1 month', 'singular');
  eq(humanMonths(7), '7 months', 'under a year stays in months');
  eq(humanMonths(12), '1 year', 'exactly a year');
  eq(humanMonths(24), '2 years', 'exact years plural');
  eq(humanMonths(38), '3 yr 2 mo', 'years and months');
  eq(humanMonths(0), '—', 'nothing to show');
  eq(humanMonths(Infinity), '—', 'and an unsettled plan has no duration');
}

console.log(`PASS — debt amortisation, strategy simulation and formatting (${checks} checks).`);

/* ---- expectedBalance: where a debt should be today ----
   Interest is applied BEFORE each payment. Subtracting instalments alone would
   report a debt shrinking faster than it is — the flattering direction, and so
   the dangerous one. */
{
  const { expectedBalance } = require('../src/debt-math');

  // Interest-free: 12 months of 100 off 1200 clears it exactly.
  const free = expectedBalance({ original: 1200, rate: 0, payment: 100, start: '2025-08-01' }, '2026-08-01');
  eq(free.months, 12, 'twelve months elapsed');
  ok(free.settled, 'and an interest-free debt is gone');

  // With interest, the same payments leave a balance behind.
  const withInt = expectedBalance({ original: 1200, rate: 24, payment: 100, start: '2025-08-01' }, '2026-08-01');
  ok(!withInt.settled, 'at 24% the same instalments do not clear it');
  ok(withInt.expected > 0, 'something is still owed');
  ok(withInt.interest > 0, 'because interest was charged along the way');
  ok(withInt.expected < 1200, 'but it did come down');

  // Extra payments count toward the instalment.
  const extra = expectedBalance({ original: 1200, rate: 0, payment: 50, extra: 50, start: '2025-08-01' }, '2026-08-01');
  ok(extra.settled, 'payment + extra is what actually leaves the account');

  // Rows that cannot support a projection say so rather than guessing.
  eq(expectedBalance({ original: 0, payment: 100, start: '2025-01-01' }, '2026-08-01'), null, 'no original');
  eq(expectedBalance({ original: 1000, payment: 0, start: '2025-01-01' }, '2026-08-01'), null, 'no instalment');
  eq(expectedBalance({ original: 1000, payment: 100, start: '' }, '2026-08-01'), null, 'no start date');
  eq(expectedBalance({ original: 1000, payment: 100, start: '2027-01-01' }, '2026-08-01'), null, 'starts in the future');
  eq(expectedBalance({ original: 1000, payment: 100, start: '2026-08-01' }, '2026-08-01'), null, 'no months elapsed yet');
  eq(expectedBalance(null, '2026-08-01'), null, 'missing debt does not throw');
}
