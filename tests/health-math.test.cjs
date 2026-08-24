'use strict';
/* Financial-health arithmetic.

   The health card leads with four figures a household plans around — months of
   emergency cover, the savings rate, the interest share of income, and the
   composite score — so each is pinned against hand-computable cases here
   rather than eyeballed on the Dashboard. src/health-math.js is pure (its two
   imports, debt-math and worth, are pure too), so this runs in bare node with
   no stub at all.

     node tests/health-math.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const {
  essentialTotal, resolveEarmarks, debtInterestMonthly, monthlyAverages,
  financialScore, scoreFractions, healthMetrics, scoreBand, scoreBreakdown, PILLARS, FULL_MARKS,
} = require('../src/health-math');
const { emergencyTarget, EMERGENCY_TARGET_DEFAULT, EMERGENCY_TARGET_MAX } = require('../src/constants');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++; };

/* ---- 1. essentialTotal keeps the bills and drops the rest ---- */
{
  const types = { Groceries: 'expense', Rent: 'services', Coffee: 'luxuries', Tithe: 'giving', TFSA: 'savings' };
  const typeOf = c => types[c] || null;
  const spend = { Groceries: 4000, Rent: 9000, Coffee: 800, Tithe: 1500, TFSA: 2000 };
  eq(essentialTotal(spend, typeOf), 13000, 'expense + services count; luxuries, giving and savings do not');
  /* An uncategorised debit is more likely a bill than a treat — it counts, so
     the cover figure errs toward fewer months, never more. */
  eq(essentialTotal({ Mystery: 500 }, typeOf), 500, 'unknown category type counts as essential');
  eq(essentialTotal({}, typeOf), 0, 'no spend, no essentials');
}

/* ---- 2. earmarks: whole account, partial, and the over-claim ---- */
{
  const r = resolveEarmarks([
    { name: 'Emergency Savings', balance: 42000, emergency_fund: true },
    { name: 'Cheque', balance: 12000 },
  ]);
  eq(r.total, 42000, 'emergency_fund: true earmarks the whole balance');
  ok(r.any, 'an earmark exists');
  eq(r.over, [], 'nothing over-claimed');
}
{
  const r = resolveEarmarks([{ name: 'Fixed Deposit', balance: 80000, emergency_fund: 30000 }]);
  eq(r.total, 30000, 'a numeric earmark takes only that slice of the balance');
}
{
  /* The claim exceeds the money. The figure caps at what is really there —
     inflating cover is the one failure this card must never have — but the
     claim is surfaced, not corrected: the app argues. */
  const r = resolveEarmarks([{ name: 'Emergency Savings', balance: 20000, emergency_fund: 50000 }]);
  eq(r.total, 20000, 'earmark capped at the held balance');
  eq(r.over.length, 1, 'and the over-claim is reported');
  eq(r.over[0].name, 'Emergency Savings', 'by name, so the view can say which account');
}
{
  const r = resolveEarmarks([{ name: 'Cheque', balance: 9000 }]);
  ok(!r.any, 'no key anywhere means the reader has never been asked');
  eq(r.total, 0, 'and nothing is earmarked');
  /* A negative balance holds nothing — an earmarked overdraft is zero cover,
     not negative cover eating the other accounts' earmarks. */
  eq(resolveEarmarks([{ name: 'OD', balance: -5000, emergency_fund: true }]).total, 0,
    'an overdrawn earmarked account contributes zero');
}

/* ---- 3. debt interest: active rows only, straight from debt-math ---- */
{
  const debts = [
    { name: 'Card', balance: 12000, rate: 24, status: 'active' },   // 12000 × 2%/mo = 240
    { name: 'Loan', balance: 100000, rate: 12, status: 'active' },  // 100000 × 1%/mo = 1000
    { name: 'Old car', balance: 90000, rate: 13, status: 'paid' },  // settled — costs nothing
  ];
  near(debtInterestMonthly(debts), 1240, 0.01, 'active debts only, at their monthly rates');
  eq(debtInterestMonthly([]), 0, 'no debts, no interest');
}

/* ---- 4. monthly averages: counted periods only, monthly-normalised ---- */
{
  const per = [
    { income: 45000, essential: 20000, savings: 6000, counted: true },
    { income: 45000, essential: 24000, savings: 8000, counted: true },
    { income: 0, essential: 0, savings: 0, counted: false },   // a window the vault does not cover
  ];
  const a = monthlyAverages(per, 1);
  eq(a.counted, 2, 'the uncovered period is not averaged in');
  eq(a.income, 45000, 'income averages over counted periods only');
  eq(a.essential, 22000, 'so does essential spend');
  eq(a.savings, 7000, 'and contributions');
}
{
  /* A 14-day pay cycle: a period is 14/30.44 of a month, so a per-period
     figure restates to a LARGER monthly one. */
  const a = monthlyAverages([{ income: 20000, essential: 10000, savings: 2000, counted: true }], 14 / 30.44);
  near(a.income, 20000 * 30.44 / 14, 0.01, 'interval periods restate to monthly scale');
}
{
  const a = monthlyAverages([{ income: 1, essential: 1, savings: 1, counted: false }], 1);
  eq(a.income, null, 'no counted history averages to null, never to zero');
  eq(a.counted, 0, 'and says so');
}

/* ---- 5. the score: two rounds of renormalisation ----
   Pillars share the 100 between the ones that can be answered; the measures
   inside a pillar share that pillar's weight. Both have to hold, or the popup's
   figures stop adding up to the headline above them. */
{
  const all = {};
  for (const p of PILLARS) { for (const q of p.parts) { all[q.key] = 1; } }
  const s = financialScore(all);
  eq(s.value, 100, 'every measure at full marks scores 100');
  near(s.pillars.reduce((t, p) => t + p.max, 0), 100, 0.001, 'and the pillar maxima sum to 100');
  eq(s.pillars.length, PILLARS.length, 'with every pillar present');
}
{
  /* One pillar wholly unanswerable — no debt page at all. Its weight goes to
     the others rather than being scored zero against the household. */
  const f = {};
  for (const p of PILLARS) { for (const q of p.parts) { f[q.key] = p.key === 'debt' ? null : 1; } }
  const s = financialScore(f);
  eq(s.value, 100, 'an absent pillar is unscored, never scored zero');
  eq(s.pillars.length, PILLARS.length - 1, 'and drops out of the breakdown');
  near(s.pillars.reduce((t, p) => t + p.max, 0), 100, 0.001, 'while the rest still sum to 100');
  ok(!s.pillars.some(p => p.key === 'debt'), 'the debt pillar is genuinely gone');
}
{
  /* HALF a pillar: one measure inside `spending` is unanswerable. The pillar
     keeps its full weight and the measures that remain share it — otherwise a
     household that has flagged no fixed costs would quietly lose points it was
     never asked about. */
  const f = {};
  for (const p of PILLARS) { for (const q of p.parts) { f[q.key] = 1; } }
  f.fixed = null;
  const s = financialScore(f);
  eq(s.value, 100, 'a missing measure inside a pillar costs nothing');
  const spending = s.pillars.find(p => p.key === 'spending');
  near(spending.max, PILLARS.find(p => p.key === 'spending').weight, 0.001,
    'and the pillar keeps its whole weight');
  eq(spending.parts.length, 2, 'shared between the measures that survive');
}
{
  const f = {};
  for (const p of PILLARS) { for (const q of p.parts) { f[q.key] = null; } }
  eq(financialScore(f), null, 'nothing measurable means no score, not a fabricated one');
}

/* ---- 6. the thresholds, at their two endpoints ---- */
{
  const base = {};
  for (const p of PILLARS) { for (const q of p.parts) { base[q.key] = null; } }
  const only = (key, val) => financialScore({ ...base, [key]: val }).value;
  eq(only('cover', 1), 100, 'a lone measure at full marks scores the whole 100');
  eq(only('cover', 0), 0, 'and at nothing, zero');
  eq(only('cover', 0.5), 50, 'linear in between');
}
{
  const m = {
    monthlyIncome: 50000, months: 3, savingsRate: 0.10, interestShare: 0.05,
    instalmentShare: 0.175, fixedShare: 0.475, consumptionShare: 0.85, budgetUsed: 1.10,
    netWorthMultiple: 1.5,
  };
  const f = scoreFractions(m, 6);
  near(f.cover, 0.5, 0.001, '3 of 6 months is half the cover marks');
  near(f.rate, 0.5, 0.001, '10% saved is half of the 20% benchmark');
  near(f.interest, 0.5, 0.001, '5% to interest is halfway to the 10% ceiling');
  near(f.instalments, 0.5, 0.001, 'and 17.5% of income in instalments halfway to 35%');
  near(f.fixed, 0.5, 0.001, '47.5% committed sits midway between the 35% floor and 60% ceiling');
  near(f.consumption, 0.5, 0.001, 'living costs at 85% sit midway between 70% and 100%');
  near(f.budget, 0.5, 0.001, '10% over budget is halfway to the 20% ceiling');
  near(f.networth, 0.5, 0.001, 'and 1.5x annual income is half the 3x mark');
}
{
  /* Absence has to survive the mapping — a null measure must not become 0. */
  const f = scoreFractions({ monthlyIncome: null, months: null }, 6);
  eq(f.cover, null, 'no cover figure maps to null, not to zero');
  eq(f.rate, null, 'and no income means no savings rate');
  eq(f.networth, null, 'nor a net-worth multiple');
}

/* ---- 7. healthMetrics end to end, and the consumption trap ---- */
{
  const P = { income: 50435, essential: 40648, savings: 10610, consumption: 49352,
    fixed: 22392, budgeted: 54391, counted: true };
  const H = healthMetrics({
    periods: [P, P, P, P, P, P], monthsPerPeriod: 1,
    earmarks: { any: true, total: 107132, over: [] }, targetMonths: 6,
    debtInterest: 0, debtInstalments: null, netWorth: 915031, hasFixed: true,
  });
  near(H.months, 107132 / 40648, 0.001, 'cover is the earmark over essential spend');
  near(H.savingsRate, 10610 / 50435, 0.0001, 'the savings rate is what reached the funds');
  near(H.fixedShare, 22392 / 50435, 0.0001, 'the fixed share counts the flagged categories');
  near(H.consumptionShare, 49352 / 50435, 0.0001, 'consumption is measured against income');
  near(H.budgetUsed, 49352 / 54391, 0.0001, 'budget adherence against the plan, not income');
  near(H.netWorthMultiple, 915031 / (50435 * 12), 0.0001, 'net worth as a multiple of annual income');
  eq(H.instalmentShare, null, 'no debt page means no instalment claim either way');
  ok(H.score.value > 0 && H.score.value < 100, 'and it scores somewhere in between');
}
{
  /* THE CONSUMPTION TRAP. Total outflow includes money moved into the
     household's own funds, so a saver reads as an overspender. Consumption is
     passed in already net of that; this pins that the two are not the same
     number and that the ratio uses the smaller one. */
  const P = { income: 50000, essential: 40000, savings: 10000, consumption: 45000,
    fixed: 0, budgeted: 0, counted: true };
  const H = healthMetrics({
    periods: [P], monthsPerPeriod: 1, earmarks: { any: false, total: 0, over: [] },
    targetMonths: 6, debtInterest: 0, debtInstalments: null, netWorth: 0, hasFixed: false,
  });
  eq(H.consumptionShare, 0.9, 'living cost 90% of income — the saving is not counted as spending');
  eq(H.fixedShare, null, 'a household that has flagged nothing fixed is unscored on it, not full marks');
  eq(H.budgetUsed, null, 'and an absent budget is not adherence of zero');
}

/* ---- 7b. THE DEBT PILLAR, and what an empty Debt page is allowed to mean ----
   Two readings of an empty Debt page are defensible and they score oppositely,
   so the choice is pinned rather than left to whichever coercion happened to
   be in the way. It used to be the latter: a `?? 0` made the "cannot measure"
   branch unreachable, so a caller passing null and a caller passing zero got
   identical scores while meaning opposite things. */
{
  /* CHOSEN: no debts recorded EARNS the pillar. Refusing to credit it would
     leave a genuinely debt-free household unscored on the one thing it has
     actually finished. The surfaces disclose the assumption — see the
     debtsRecorded flag — but the arithmetic rewards it. */
  const P = { income: 40000, essential: 20000, savings: 0, consumption: 20000, fixed: 0, budgeted: 0, counted: true };
  const H = healthMetrics({
    periods: [P], monthsPerPeriod: 1, earmarks: { any: false, total: 0, over: [] },
    targetMonths: 6, debtInterest: 0, debtInstalments: null, netWorth: 0, hasFixed: false,
  });
  eq(H.interestShare, 0, 'no interest is a measured zero, and scores');
  eq(H.instalmentShare, null, 'while unstated instalments stay unmeasured');
  const debt = H.score.pillars.find(p => p.key === 'debt');
  ok(!!debt, 'the debt pillar is present for a debt-free household');
  eq(debt.at, 1, 'and earns full marks');
}
{
  /* And the branch that WAS unreachable: a caller that genuinely cannot measure
     interest must not be scored as if it measured zero. */
  const P = { income: 40000, essential: 20000, savings: 0, consumption: 20000, fixed: 0, budgeted: 0, counted: true };
  const H = healthMetrics({
    periods: [P], monthsPerPeriod: 1, earmarks: { any: false, total: 0, over: [] },
    targetMonths: 6, debtInterest: null, debtInstalments: null, netWorth: 0, hasFixed: false,
  });
  eq(H.interestShare, null, 'null in, null out — no longer coerced to a measured zero');
  ok(!H.score.pillars.some(p => p.key === 'debt'),
    'and with neither measure answerable the pillar drops out entirely');
}
{
  /* A household carrying real debt is scored on it, and hard. */
  const P = { income: 40000, essential: 20000, savings: 0, consumption: 20000, fixed: 0, budgeted: 0, counted: true };
  const H = healthMetrics({
    periods: [P], monthsPerPeriod: 1, earmarks: { any: false, total: 0, over: [] },
    targetMonths: 6, debtInterest: 4000, debtInstalments: 14000, netWorth: 0, hasFixed: false,
  });
  eq(H.interestShare, 0.1, '10% of income to interest');
  eq(H.instalmentShare, 0.35, 'and 35% to instalments');
  const debt = H.score.pillars.find(p => p.key === 'debt');
  eq(debt.at, 0, 'both at their ceilings scores the pillar nothing');
}

/* ---- 8. the bands, shared by the tile's colour and the popup ---- */
{
  eq(scoreBand(100), 'strong', '100 is strong');
  eq(scoreBand(80), 'strong', 'and 80 is the boundary, inclusive');
  eq(scoreBand(79), 'steady', 'just under it is steady');
  eq(scoreBand(50), 'steady', 'down to 50, inclusive');
  eq(scoreBand(49), 'attention', 'and below that needs attention');
  eq(scoreBand(0), 'attention', 'including zero');
}

/* ---- 9. the target clamp, which the loader and the settings tab share ----
   Two callers apply this to the same hand-editable line — one reading the file,
   one writing it — so a disagreement between them shows up as a settings screen
   displaying a target the card is not measuring against. The split below is the
   convention overspendLag already set: an UNREADABLE value falls back to the
   default, while a readable one that is merely out of range is clamped to the
   nearest bound. (overspendLag's own default happens to equal its minimum,
   which hides the distinction there; here they differ, so it is pinned.) */
{
  eq(emergencyTarget(undefined), EMERGENCY_TARGET_DEFAULT, 'an absent target falls back to the default');
  eq(emergencyTarget(''), EMERGENCY_TARGET_DEFAULT, 'so does a blank one');
  eq(emergencyTarget('abc'), EMERGENCY_TARGET_DEFAULT, 'and an unreadable one — NOT the minimum');
  eq(emergencyTarget(0), 1, 'a readable 0 is out of range, so it clamps rather than defaulting');
  eq(emergencyTarget(-5), 1, 'and so does a negative');
  eq(emergencyTarget(99), EMERGENCY_TARGET_MAX, 'past the ceiling clamps down to it');
  eq(emergencyTarget('3'), 3, 'a string of digits is read as the number it spells');
  eq(emergencyTarget(' 12 '), 12, 'surrounding whitespace is not a parse failure');
}

/* ---- 10. budgetUsed's denominator is periods that carried a PLAN, not
   every counted period — a household that only started budgeting partway
   through the trailing window must not have its plan diluted by the months
   before it existed ---- */
{
  const noPlan = { income: 20000, essential: 10000, savings: 0, consumption: 20000, fixed: 0, budgeted: 0, counted: true };
  const planned = { ...noPlan, budgeted: 22000 };
  const H = healthMetrics({
    periods: [noPlan, noPlan, noPlan, noPlan, planned, planned], monthsPerPeriod: 1,
    earmarks: { any: false, total: 0, over: [] }, targetMonths: 6,
    debtInterest: 0, debtInstalments: null, netWorth: 0, hasFixed: false,
  });
  near(H.budgetUsed, 20000 / 22000, 0.0001,
    'budgetUsed averages consumption/budgeted over the PLANNED periods only (2 of 6), not diluted by the 4 with no plan');
  ok(H.budgetUsed < 1, 'a household 9% UNDER budget must read as under, not as 273% over it');
}

/* ---- 11. gapFor refuses an income-relative gap without an income, even
   for a pillar whose fraction somehow survived without one — belt and
   suspenders alongside the pillars' own hasIncome gates upstream. `reserves`
   is deliberately exempt: it is earmarks over ESSENTIAL SPEND, never an
   income-relative question. ---- */
{
  const f = {};
  for (const p of PILLARS) { for (const q of p.parts) { f[q.key] = 0.3; } }
  const m = {
    score: financialScore(f), monthlyIncome: 0, monthlySavings: 0,
    monthlyConsumption: 50000, netWorth: -10000, monthlyEssential: 5000,
  };
  const bd = scoreBreakdown(m, 6);
  const byKey = k => bd.pillars.find(p => p.key === k);
  eq(byKey('saving').gap, null, 'no income means no monthly-saving gap, not "save 20% of R0"');
  eq(byKey('spending').gap, null, 'no income means no trim gap, not "trim your entire living cost"');
  eq(byKey('wealth').gap, null, 'no income means no net-worth-build gap either');
  ok(byKey('reserves').gap !== null, 'reserves is unaffected — an income-free household can still be told to fund its cover');
}

/* ---- 12. the popup's INTEGER allocation never prints a pillar above its
   own rounded ceiling, and is independent of which pillar the shortfall
   sort puts first ----

   With `reserves` absent (no `emergency_fund` set anywhere), the remaining
   four live pillars' weights give saving, debt and spending an IDENTICAL
   26.667-point max apiece (20/75 of 100) — a genuine three-way
   largest-remainder tie, with two whole points to hand out. Before the fix,
   shownMax/shownPoints were allocated over the SHORTFALL-sorted array, so
   which two of the three tied pillars got the spare point depended on which
   pillar happened to be worst that day. `worstSaving` and `worstSpending`
   below share every weight and differ only in WHICH pillar is worst — under
   the old order-dependent allocation these printed different winners
   (`{saving 27, debt 27, spending 26}` vs `{spending 27, saving 27, debt
   26}`); allocating over PILLARS' own declaration order instead makes the
   answer identical either way. */
{
  const worstSaving = { rate: 0, interest: 1, instalments: 1, fixed: 1, consumption: 1, budget: 1, networth: 1 };
  const worstSpending = { rate: 1, interest: 1, instalments: 1, fixed: 0, consumption: 0, budget: 0, networth: 1 };
  for (const f of [worstSaving, worstSpending]) {
    const bd = scoreBreakdown({ score: financialScore(f) }, 6);
    const byKey = k => bd.pillars.find(p => p.key === k);
    ok(!byKey('reserves'), 'reserves is genuinely absent — no cover fraction supplied');
    eq(byKey('saving').shownMax, 27, 'saving carries the tie-break point regardless of which pillar is worst');
    eq(byKey('debt').shownMax, 27, 'debt carries the tie-break point too — declaration order, not shortfall order');
    eq(byKey('spending').shownMax, 26, 'spending does NOT, in EITHER shortfall order');
    for (const p of bd.pillars) {
      ok(p.shownPoints <= p.shownMax, `${p.key}'s shown points never exceed its own shown ceiling`);
      ok(p.shownLost >= 0, `${p.key}'s shown-lost is never negative`);
    }
  }
  // And a wider sweep: no random score vector should ever print a pillar
  // above its own ceiling, the shape of the "saving 27 of 26, lost -1" bug.
  const keys = PILLARS.flatMap(p => p.parts.map(q => q.key));
  for (let n = 0; n < 500; n++) {
    const rf = {}; for (const k of keys) { rf[k] = Math.random(); }
    const bd = scoreBreakdown({ score: financialScore(rf) }, 6);
    for (const p of bd.pillars) {
      ok(p.shownPoints <= p.shownMax, `random vector ${n}: ${p.key}'s shown points never exceed its own ceiling`);
    }
  }
  checks++;
}

console.log(`PASS health-math (${checks} checks)`);
