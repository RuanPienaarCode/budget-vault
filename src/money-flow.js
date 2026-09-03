'use strict';
/* Where the money went, this period — the arithmetic behind the Score page's
   "Where the money went" card and the segmented rail beneath "Why it is N".

   Pure on purpose: no DOM, no `require('obsidian')`; views/score.js
   assembles the raw material from the ctx helpers (periodSummary,
   periodSpend, budgetTotals, splitFlows) and this module only does
   arithmetic on it. THE ONE RULE THIS FILE EXISTS TO ENFORCE: every figure
   on the flow card already has a home elsewhere in the app, and this module
   may not invent a second way of computing any of them — where a new
   judgement call is unavoidable it is written down, not silently made.
   ADR-0007 · money-flow.js — purpose records each band's source. */

const { activeDebts } = require('./worth');
const { monthlyInterest } = require('./debt-math');
const { isForeign } = require('./currency');
const { largestRemainder } = require('./share-percents');
const { isSetAsideType } = require('./vocabulary');
const { PILLARS } = require('./health-math');

/* Category TYPES (not the household's custom groups) that fall inside the two
   named sub-buckets of "committed". Both are TYPE_ORDER entries, so a custom
   group added in Settings.md can never accidentally join either — only the
   two built-ins landing in a category's own `type:` frontmatter do. */
const HOUSING_TYPES = new Set(['housing', 'utilities']);
const SUBSCRIPTION_TYPES = new Set(['insurance', 'services']);

/* ADR-0007 · periodFlow inputs. Each argument's source (periodSummary,
   budgetTotals, periodSpend, S.categories, splitFlows, S.debts) is recorded
   there; every argument defaults safely so a new vault returns zeroed bands. */
/* ADR-0007 · Income base for "allocated". The budget's own income figure is
   the denominator; actual income stands in only with no budgeted income AND a
   finished period (mid-period the Dashboard read 100% and the Score 102%). */
function incomeBaseFor({ budgetIncome, actualIncome, periodFinished } = {}) {
  const planned = Number(budgetIncome) || 0;
  if (planned > 0) { return planned; }
  if (!periodFinished) { return 0; }
  return Math.max(0, Number(actualIncome) || 0);
}

/* ADR-0007 · Allocated share is the whole answer, so the two cards cannot
   diverge on the edges: zero budget is 0%, a real budget with no income base
   yet is null. */
function allocatedShare({ budgeted, budgetIncome, actualIncome, periodFinished } = {}) {
  const bud = Math.max(0, Number(budgeted) || 0);
  const base = incomeBaseFor({ budgetIncome, actualIncome, periodFinished });
  if (!bud) {
    /* ADR-0007 · Zero budget reads 0% only beside income; a vault with neither
       is not a finding and gets null (tests/null-vs-zero.test.cjs). */
    return (base > 0 || (Number(actualIncome) || 0) > 0) ? 0 : null;
  }
  return base > 0 ? bud / base : null;
}

/* ADR-0007 · One budget, two denominators (ISSUE 40). `budgetSetAside` joins
   "share of income budgeted" and stays out of "budget used"; 1.36.0 printed
   41% vs 30% and 45% vs 32% for one household until it did. */
/* ADR-0007 · Budget used is one rule (ADR-0005): (spend − setAside + assumed)
   / budgeted, null with no plan. Every surface reads this directly or via
   period.js's budgetUsed(p); tests/budget-used-one-rule.test.cjs keeps it so. */
function budgetUsedShare({ spend, setAside, assumed, budgeted } = {}) {
  const bud = Number(budgeted) || 0;
  if (!(bud > 0)) { return null; }
  return budgetSpent({ spend, setAside, assumed }) / bud;
}

/* The numerator of that rule, on its own, because every surface prints the
   rand figure beside the percentage and the two must be one reading:
   gross spend, less set-aside, plus the assume-spent provision. */
function budgetSpent({ spend, setAside, assumed } = {}) {
  return Math.max(0, (Number(spend) || 0) - (Number(setAside) || 0)) + Math.max(0, Number(assumed) || 0);
}

/* ADR-0007 · Assume-spent Actual: the larger of budgeted and what really
   moved. One function for the Budget page, Dashboard, Report and exports. */
function assumedActual(budgeted, realSpend) {
  const b = Number(budgeted) || 0;
  const r = Number(realSpend) || 0;
  return Math.max(b, r);
}

/* ADR-0007 · Assume-spent provision: per row, Actual less the real spend it
   already covers, clamped; `realSpendOf` is the caller's because only it
   knows which ledger (saved file or unsaved draft) the rows were measured on. */
function assumedProvision(rows, realSpendOf) {
  let total = 0;
  for (const r of rows || []) {
    const real = Math.max(0, Number(realSpendOf(r)) || 0);
    total += assumedActual(r.amount, real) - real;
  }
  return total;
}

/* ADR-0007 · Budget-vs-actual row status (Phase 3 of ADR-0006). One rule for
   every page printing the table; an assume-spent row is never `unbudgeted`. */
function budgetRowStatus({ budget, actual, type, assumed } = {}) {
  const b = Number(budget) || 0;
  const a = Number(actual) || 0;
  const over = b > 0 && a > b;
  return {
    remaining: b - a,
    unbudgeted: type !== 'income' && !b && a > 0 && !assumed,
    over,
    near: !over && b > 0 && a / b >= 0.85,
    pct: b > 0 ? Math.min(100, (a / b) * 100) : (a > 0 ? 100 : 0),
  };
}

/* What a category split leaves out of gross spend, decomposed into the two
   parts the donut's note names: uncategorised outgoings, and refunds netted
   inside named categories. Clamped so rounding never invents a negative gap.
   tests/cross-page-consistency.test.cjs pins the identity this expresses. */
function categoryGap({ spend, uncatSpend, rows } = {}) {
  const total = (rows || []).reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const notShown = Math.max(0, (Number(spend) || 0) - total);
  const uncat = Math.min(Number(uncatSpend) || 0, notShown);
  return { total, notShown, uncat, netted: notShown - uncat };
}

function periodFlow({
  income, spentTotal, setAsideSpent, assumedSpent, budgeted, budgetSetAside, spendByCat, fixedCats, catType,
  savingContribution, debts, household, budgetIncome, periodFinished,
} = {}) {
  const inc = Number(income) > 0 ? Number(income) : 0;
  const spent = Math.max(0, Number(spentTotal) || 0);
  const bud = Math.max(0, Number(budgeted) || 0);
  const saving = Math.max(0, Number(savingContribution) || 0);
  const fixed = fixedCats instanceof Set ? fixedCats : new Set(fixedCats || []);
  const byCat = spendByCat || {};

  let committed = 0, debtRepayments = 0, housing = 0, subscriptions = 0, committedSavingsTyped = 0;
  /* ADR-0007 · Savings-typed spend tracked before living, fixed-flagged or
     not, so the fixed part can be told apart below. */
  let savingsTypedSpend = 0;
  for (const [cat, amt] of Object.entries(byCat)) {
    const type = catType ? catType(cat) : null;
    if (isSetAsideType(type) && amt > 0) { savingsTypedSpend += amt; }
    if (!cat || !fixed.has(cat) || !(amt > 0)) { continue; }
    committed += amt;
    if (type === 'debt') { debtRepayments += amt; }
    else if (HOUSING_TYPES.has(type)) { housing += amt; }
    else if (SUBSCRIPTION_TYPES.has(type)) { subscriptions += amt; }
    if (isSetAsideType(type)) { committedSavingsTyped += amt; }
  }
  /* A fixed-flagged category can never claim more than the period actually
     spent — a category that happened to net a refund this period must not
     invent money nobody paid out. */
  committed = Math.min(committed, spent);
  /* The remainder, by construction rather than by naming every possible
     type: whatever a fixed category carries that is not debt, housing,
     utilities, insurance or a service still belongs in "committed & fixed
     bills" — it just has no sub-chip of its own. */
  const other = Math.max(0, committed - debtRepayments - housing - subscriptions);

  /* ADR-0007 · Interest recomputed on the flow card: renderFlowCard() runs
     before healthSnapshot() exists. Must move with debtInterestMonthly's
     signature (ISSUE 28 second pass: R1 000 vs R333,33); capped at repayments. */
  const interestRaw = activeDebts(debts)
    .filter(d => !household || !isForeign(d, household))
    .reduce((s, d) => s + monthlyInterest(d.balance, d.rate), 0);
  const interest = Math.min(interestRaw, debtRepayments);

  /* ADR-0007 · Living excludes savings-typed spend once: the outgoing leg is
     inside `spent`, its incoming leg is already `saving`, and the fixed part
     already left via `committed`. */
  const nonCommittedSavingsTyped = Math.max(0, savingsTypedSpend - committedSavingsTyped);
  const living = Math.max(0, spent - committed - nonCommittedSavingsTyped);
  const notYetSpent = Math.max(0, inc - committed - living - saving);

  /* ADR-0007 · The two lefts. leftInBudget + neverBudgeted is always exactly
     income − spentTotal, and may read larger than the notYetSpent band
     whenever saving is non-zero — correct, not a bug. */
  const leftInBudget = bud - spent;
  const neverBudgeted = inc - bud;
  const together = leftInBudget + neverBudgeted;

  /* Against the income the PLAN states, via the shared rule above — NOT
     against `inc`, which is what has landed so far. Dividing by `inc` made
     this line disagree with the Dashboard's "N% allocated" on the same data,
     and drift a little every day as more income arrived. */
  /* ISSUE 40 follow-up: the WHOLE plan, so this agrees with the Dashboard hero
     and the Budget page. `budgetUsed` below keeps `bud` (spend envelopes
     alone) — see the header for why one budget needs two denominators. */
  const setAside = Math.max(0, Number(budgetSetAside) || 0);
  const allocatedOfIncome = allocatedShare({
    budgeted: bud + setAside, budgetIncome, actualIncome: inc, periodFinished,
  });
  /* ADR-0007 · Budget used numerator and window on the chip. Not spent/bud;
     the ADR-0005 numerator (vocabulary.test.cjs's GAP A), with only the
     window (one period vs the ring's six) deliberately different. */
  /* ADR-0007 · Set-aside comes from the caller, not byCat (ADR-0005): the net
     map hides an in-budget fund contribution — 51% here vs 38% on the hero. */
  const budgetUsed = budgetUsedShare({ spend: spent, setAside: setAsideSpent, assumed: assumedSpent, budgeted: bud });
  const spentByRule = budgetSpent({ spend: spent, setAside: setAsideSpent, assumed: assumedSpent });

  /* ADR-0007 · Percentages of income past 100. largestRemainder only while the
     bands share one whole; in a deficit period each band rounds alone. */
  const bandAmounts = [committed, living, saving, notYetSpent];
  const rawPercents = bandAmounts.map(a => (a / inc) * 100);
  const rawSum = rawPercents.reduce((s, v) => s + v, 0);
  /* ADR-0007 · The epsilon on the surplus branch is load-bearing: four
     quotients summed land one ULP over (100.00000000000001 measured). */
  const bandPercents = inc > 0
    ? (rawSum <= 100.0001 ? largestRemainder(rawPercents, 100) : rawPercents.map(v => Math.round(v)))
    : bandAmounts.map(() => 0);

  /* ADR-0007 · Display bands partition the headline: largest remainder against
     the rounded income, on the surplus branch only (R 40 241 under R 40 240
     before); `roundRand` mirrors formatMoney's sign-then-abs order. */
  const roundRand = v => (v < 0 ? -1 : 1) * Math.round(Math.abs(v));
  const displayBands = inc > 0 && rawSum <= 100.0001
    ? largestRemainder(bandAmounts, roundRand(inc))
    : bandAmounts.map(roundRand);

  /* ADR-0007 · Together is derived from the printed parts, so the chip's
     "38 730 − 653 = 38 078" adds up; the raw identity is untouched. */
  const displayLefts = {
    leftInBudget: roundRand(leftInBudget),
    neverBudgeted: roundRand(neverBudgeted),
  };
  displayLefts.together = displayLefts.leftInBudget + displayLefts.neverBudgeted;

  return {
    income: inc,
    bands: {
      committed, living, saving, notYetSpent,
      display: {
        committed: displayBands[0], living: displayBands[1],
        saving: displayBands[2], notYetSpent: displayBands[3],
      },
      percents: {
        committed: bandPercents[0], living: bandPercents[1],
        saving: bandPercents[2], notYetSpent: bandPercents[3],
      },
    },
    committedDetail: { debtRepayments, interest, housing, subscriptions, other },
    budget: { budgeted: bud + setAside, budgetSpend: bud, setAside, spentTotal: spent, spent: spentByRule, allocatedOfIncome, budgetUsed },
    lefts: { leftInBudget, neverBudgeted, together, display: displayLefts },
  };
}

/* ADR-0007 · Rail segments: PILLARS' weight order, width = shownMax, fill =
   shownPoints, `at` unrounded so the ring's arc is the exact fraction, and
   pillars absent from the breakdown are skipped. */
function railSegments(breakdown) {
  if (!breakdown || !breakdown.pillars || !breakdown.pillars.length) { return []; }
  const byKey = new Map(breakdown.pillars.map(p => [p.key, p]));
  const out = [];
  let x = 0;
  for (const def of PILLARS) {
    const p = byKey.get(def.key);
    if (!p) { continue; }
    out.push({ key: p.key, x, width: p.shownMax, fill: p.shownPoints, at: p.at });
    x += p.shownMax;
  }
  return out;
}

module.exports = {
  periodFlow, railSegments, incomeBaseFor, allocatedShare, budgetUsedShare, budgetSpent, assumedActual, assumedProvision,
  budgetRowStatus, categoryGap,
  HOUSING_TYPES, SUBSCRIPTION_TYPES,
};
