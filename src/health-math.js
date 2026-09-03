'use strict';
/* Financial-health arithmetic — emergency-fund cover, savings rate, the
   debt-interest share of income and the composite score built from them.
   Pure on purpose: no DOM, no `require('obsidian')`, every "when" arrives as
   an input, so a guard test drives every branch from bare node. Everything
   is normalised to MONTHLY scale before any ratio is taken; DAYS_PER_MONTH
   = 30.44 is trend-math.js's constant too. ADR-0007 · health-math.js — purpose. */

const { monthlyInterest } = require('./debt-math');
const { activeDebts } = require('./worth');
const { isForeign } = require('./currency');
const { largestRemainder } = require('./share-percents');

const DAYS_PER_MONTH = 30.44;

/* ADR-0007 · Non-essential category types. Income and transfer are listed
   although dropped upstream, so no other upstream can count a transfer as
   an essential bill. */
/* Owned by vocabulary.js since Phase 1 of ADR-0006; re-exported below because
   settings-tab.js reads it from here. */
const { NON_ESSENTIAL_TYPES } = require('./vocabulary');

/* Sum the essential slice of one period's per-category spend map (the `whole`
   shape periodSpend returns). An unknown or blank type counts as essential
   deliberately: an uncategorised debit is far more likely a bill than a treat,
   and guessing the other way would report more months of cover than the
   household may actually have. */
function essentialTotal(byCategory, typeOf, alsoNonEssential) {
  /* `alsoNonEssential` is the vault's own nonessential_groups list
     (src/groups.js): it can only ADD to the built-in set, so a setting can
     make the cover figure read fewer months, never more. */
  const extra = alsoNonEssential instanceof Set ? alsoNonEssential : new Set(alsoNonEssential || []);
  let sum = 0;
  for (const [cat, amt] of Object.entries(byCategory || {})) {
    const type = typeOf ? typeOf(cat) : null;
    if (type && (NON_ESSENTIAL_TYPES.has(type) || extra.has(type))) { continue; }
    sum += amt;
  }
  return sum;
}

/* ADR-0007 · Earmarks are capped at what the account holds. `true` is the
   whole balance, a number is min(number, balance); capped accounts come back
   on `over` for the view to say so; `any` is not `total`. */
function resolveEarmarks(accounts) {
  let total = 0, any = false;
  const over = [];
  for (const a of accounts || []) {
    const ef = a && a.emergency_fund;
    if (ef !== true && !(typeof ef === 'number' && ef > 0)) { continue; }
    any = true;
    const held = Math.max(0, a.balance || 0);
    if (ef === true) { total += held; continue; }
    total += Math.min(ef, held);
    if (ef > held) { over.push({ name: a.name, earmark: ef, held }); }
  }
  return { total, any, over };
}

/* This month's cost of carrying the active debts — the same "price of doing
   nothing" figure the Debts view leads with, summed across the book. Paid-off
   rows are skipped by the same activeDebts filter that view uses, so the two
   pages cannot disagree about which debts still cost anything. */
/* ADR-0007 · Monthly debt interest is null when debts are listed but no rate
   is stated (a measured zero once scored full marks on R250 000 of debt). */
/* ADR-0007 · Foreign debts are held out of the interest bill (ISSUE 28/30),
   BEFORE the all-blank-rates test. `household` absent means every debt. */
/* ADR-0007 · One derivation of monthly interest, and one slice it is derived
   from. Never re-spell the reduce in a view: on 2026-09-02 two pages printed
   R0,00 beside this function's null. */
function ratedDebtSlice(debts, household) {
  const active = activeDebts(debts).filter(d => !household || !isForeign(d, household));
  return { active, stated: active.filter(d => (Number(d.rate) || 0) > 0) };
}

function debtInterestMonthly(debts, household) {
  const { active, stated } = ratedDebtSlice(debts, household);
  /* KEEP THIS LINE EXACTLY AS IT READS — tests/degenerate-vaults.test.cjs's NC2
     negative control deletes it from a copy by literal text match. ADR-0007 ·
     The null guard line is a negative-control fixture. */
  if (active.length && !stated.length) { return null; }
  return active.reduce((sum, d) => sum + monthlyInterest(d.balance, d.rate), 0);
}

/* ADR-0007 · Interest coverage is disclosed, and a zero rate counts as
   unknown. `monthly` is debtInterestMonthly's own return; `shown` counts
   rates above zero. */
function debtInterestCoverage(debts, household) {
  const { active, stated } = ratedDebtSlice(debts, household);
  return {
    monthly: debtInterestMonthly(debts, household),
    shown: stated.length,
    total: active.length,
    missing: active.length - stated.length,
  };
}

/* ADR-0007 · Trailing averages skip uncovered periods and return null when
   nothing was counted. `periods` is [{ income, essential, savings,
   consumption, fixed, budgeted, consumptionBudget, counted }]. */
function monthlyAverages(periods, monthsPerPeriod) {
  const mpp = monthsPerPeriod > 0 ? monthsPerPeriod : 1;
  const KEYS = ['income', 'essential', 'savings', 'consumption', 'fixed'];
  const sums = {}; for (const k of KEYS) { sums[k] = 0; }
  let counted = 0;
  /* ADR-0007 · Budgeted spend averages over planned periods only ("budget
     used" once read 273% for a household 9% under budget). */
  let planned = 0, plannedBudgeted = 0, plannedConsumption = 0;
  for (const p of periods || []) {
    if (!p || !p.counted) { continue; }
    counted++;
    for (const k of KEYS) { sums[k] += p[k] || 0; }
    if (p.budgeted > 0) {
      planned++;
      plannedBudgeted += p.budgeted;
      /* ADR-0007 · Budget used pairs consumptionBudget with budgeted over the same
         window; falls back to `consumption` for a caller passing the old shape. */
      plannedConsumption += (p.consumptionBudget !== undefined
        ? p.consumptionBudget : p.consumption) || 0;
    }
  }
  const out = { counted, planned };
  for (const k of KEYS) { out[k] = counted ? sums[k] / counted / mpp : null; }
  out.budgeted = planned ? plannedBudgeted / planned / mpp : null;
  out.consumptionForBudget = planned ? plannedConsumption / planned / mpp : null;
  return out;
}

/* The bands the score is read in. One definition because the tile's colour, the
   tile's one-word verdict and the explanation popup all have to agree: the
   thresholds used to be inlined twice in the view, which is two places to
   change and one to forget. */
const SCORE_BANDS = { strong: 80, steady: 50 };
const scoreBand = value => (value >= SCORE_BANDS.strong ? 'strong'
  : value >= SCORE_BANDS.steady ? 'steady' : 'attention');

/* ADR-0007 · Five pillars, a debt-free household earns the debt pillar,
   weights are one literal. Reserves leads, wealth trails; healthSnapshot's
   debtsRecorded says when the debt pillar is an assumption. */
/* ADR-0007 · A score needs half its weight live. Four pillars are
   income-gated; without this bar, losing your income raised your score. */
const PILLARS = [
  { key: 'reserves', weight: 25, parts: [{ key: 'cover', weight: 25 }] },
  { key: 'saving', weight: 20, parts: [{ key: 'rate', weight: 20 }] },
  { key: 'debt', weight: 20, parts: [{ key: 'interest', weight: 12 }, { key: 'instalments', weight: 8 }] },
  { key: 'spending', weight: 20, parts: [{ key: 'fixed', weight: 8 }, { key: 'consumption', weight: 7 }, { key: 'budget', weight: 5 }] },
  { key: 'wealth', weight: 15, parts: [{ key: 'networth', weight: 15 }] },
];
const TOTAL_WEIGHT = PILLARS.reduce((t, p) => t + p.weight, 0);
/* Derived, not typed, so re-weighting the pillars cannot silently move the bar. */
const MIN_LIVE_WEIGHT = TOTAL_WEIGHT / 2;

/* ADR-0007 · Where each measure earns full marks. Conventions, not
   derivations: 20% saving, 35% instalment ceiling, 35–60% fixed, 70–100%
   consumption, 120% of budget, 3× annual income. */
const FULL_MARKS = {
  savingsRate: 0.20,
  interestShare: 0.10,
  instalmentShare: 0.35,
  fixedFloor: 0.35, fixedCeiling: 0.60,
  consumptionFloor: 0.70, consumptionCeiling: 1.00,
  budgetCeiling: 1.20,
  netWorthMultiple: 3,
};

/* A ratio where LESS is better, mapped to 0..1 between a floor (full marks at
   or below it) and a ceiling (nothing at or above it). Null in, null out — the
   vault could not measure it, which is not the same as measuring badly. */
function scoreDown(value, floor, ceiling) {
  if (value === null || value === undefined) { return null; }
  if (value <= floor) { return 1; }
  if (value >= ceiling) { return 0; }
  return (ceiling - value) / (ceiling - floor);
}

/* A ratio where MORE is better, capped at full marks. Over-achieving is real
   prudence but the score measures readiness, not accumulation. */
function scoreUp(value, target) {
  if (value === null || value === undefined || !(target > 0)) { return null; }
  return Math.min(1, Math.max(0, value) / target);
}

/* Every measure the score reads, as a fraction of its own full marks. Null for
   anything this vault cannot answer — that is what lets a pillar shrink to the
   measures it can see, or drop out entirely. */
function scoreFractions(m, targetMonths) {
  const hasIncome = m.monthlyIncome !== null && m.monthlyIncome > 0;
  return {
    cover: m.months === null ? null : scoreUp(m.months, targetMonths),
    rate: scoreUp(m.savingsRate, FULL_MARKS.savingsRate),
    interest: scoreDown(m.interestShare, 0, FULL_MARKS.interestShare),
    instalments: scoreDown(m.instalmentShare, 0, FULL_MARKS.instalmentShare),
    fixed: scoreDown(m.fixedShare, FULL_MARKS.fixedFloor, FULL_MARKS.fixedCeiling),
    consumption: scoreDown(m.consumptionShare, FULL_MARKS.consumptionFloor, FULL_MARKS.consumptionCeiling),
    budget: scoreDown(m.budgetUsed, 1, FULL_MARKS.budgetCeiling),
    /* Deliberately not gated on income being positive the way the ratios are —
       a household between jobs still owns what it owns, and reporting its net
       worth as unmeasurable would be the one moment the figure matters most.
       It IS gated on there being an income to divide by, because a multiple of
       nothing is not a number. */
    networth: hasIncome ? scoreUp(m.netWorthMultiple, FULL_MARKS.netWorthMultiple) : null,
  };
}

/* ADR-0007 · Two rounds of renormalisation, inner then outer; null below
   MIN_LIVE_WEIGHT — absence of a claim has never been a claim of nothing. */
function financialScore(fractions) {
  const live = [];
  for (const pillar of PILLARS) {
    const parts = pillar.parts.filter(p => fractions[p.key] !== null && fractions[p.key] !== undefined);
    if (!parts.length) { continue; }
    const inner = parts.reduce((t, p) => t + p.weight, 0);
    const at = parts.reduce((t, p) => t + (p.weight / inner) * fractions[p.key], 0);
    live.push({ key: pillar.key, weight: pillar.weight, at, parts, inner });
  }
  if (!live.length) { return null; }
  const outer = live.reduce((t, p) => t + p.weight, 0);
  if (outer < MIN_LIVE_WEIGHT) { return null; }
  const total = live.reduce((t, p) => t + (p.weight / outer) * p.at, 0);
  return {
    value: Math.round(total * 100),
    pillars: live.map(p => ({
      key: p.key,
      max: (p.weight / outer) * 100,
      at: p.at,
      parts: p.parts.map(q => ({
        key: q.key,
        max: (q.weight / p.inner) * (p.weight / outer) * 100,
        at: fractions[q.key],
      })),
    })),
  };
}

/* ADR-0007 · Ratios only where their denominator exists, and consumption is
   not total spend (R55,744 out against R50,435 in once read as overspending). */
function healthMetrics({
  periods, monthsPerPeriod, earmarks, targetMonths,
  debtInterest, debtInstalments, netWorth, hasFixed,
}) {
  const avg = monthlyAverages(periods, monthsPerPeriod);
  const hasIncome = avg.income !== null && avg.income > 0;
  const share = v => (hasIncome && v !== null && v !== undefined ? v / avg.income : null);

  const months = (earmarks && earmarks.any && avg.essential !== null && avg.essential > 0)
    ? earmarks.total / avg.essential
    : null;

  /* Absent, not zero, when the household has flagged nothing as fixed: a
     vault that has never been asked has not answered "none", and scoring it
     full marks for having no commitments would reward not filling in the
     form. */
  const fixedMonthly = hasFixed ? avg.fixed : null;

  const m = {
    monthlyIncome: avg.income,
    monthlyEssential: avg.essential,
    monthlySavings: avg.savings,
    monthlyConsumption: avg.consumption,
    monthlyFixed: fixedMonthly,
    countedPeriods: avg.counted,
    months,
    savingsRate: hasIncome && avg.savings !== null ? avg.savings / avg.income : null,
    /* Passed straight through, NOT coerced. `?? 0` here made the null branch
       unreachable: a caller saying "I cannot measure this" got the same score
       as one saying "this is zero", and the two mean opposite things. */
    interestShare: share(debtInterest),
    /* Null rather than zero when nothing states a repayment. A vault whose
       debts carry no `Payment` has told us it HAS debt but not what it costs
       to service, and "0% of income to instalments" would be full marks for an
       unanswered question. health-data.js decides when that is the case. */
    instalmentShare: share(debtInstalments),
    fixedShare: share(fixedMonthly),
    consumptionShare: share(avg.consumption),
    /* Budget adherence is the one ratio NOT taken against income — it is spend
       against the household's own plan. Null when nothing was budgeted, because
       dividing by an absent plan measures the absence, not the household. */
    /* ADR-0007 · Budget used is gated on income like every sibling measure — it
       was the one part that survived a no-income vault and scored it 100. */
    budgetUsed: (hasIncome && avg.budgeted > 0 && avg.consumptionForBudget !== null)
      ? avg.consumptionForBudget / avg.budgeted
      : null,
    netWorth: netWorth ?? null,
    netWorthMultiple: (hasIncome && netWorth !== null && netWorth !== undefined)
      ? netWorth / (avg.income * 12)
      : null,
  };

  m.score = financialScore(scoreFractions(m, targetMonths));
  return m;
}

/* ADR-0007 · The breakdown is derived from the score, and each gap is a
   different quantity. Points renormalised as financialScore renormalises;
   gap is null at full marks. */
function scoreBreakdown(m, targetMonths) {
  if (!m || !m.score) { return null; }
  const score = m.score;

  const gapFor = key => {
    const pillar = score.pillars.find(p => p.key === key);
    if (!pillar || pillar.at >= 0.999) { return null; }
    if (key === 'reserves') {
      const need = targetMonths * (m.monthlyEssential || 0) - ((m.months || 0) * (m.monthlyEssential || 0));
      return need > 0 ? { kind: 'fund', amount: need } : null;
    }
    /* ADR-0007 · Income-relative gaps refuse to answer without income;
       `reserves` is exempt (earmarks over ESSENTIAL SPEND). */
    if (key === 'saving') {
      if (!m.monthlyIncome) { return null; }
      const need = FULL_MARKS.savingsRate * m.monthlyIncome - (m.monthlySavings || 0);
      return need > 0 ? { kind: 'monthly', amount: need } : null;
    }
    if (key === 'debt') {
      return m.monthlyIncome && (m.interestShare || 0) > 0
        ? { kind: 'interest', amount: (m.interestShare || 0) * m.monthlyIncome }
        : null;
    }
    if (key === 'spending') {
      if (!m.monthlyIncome) { return null; }
      /* The cheapest of the three to move is whichever is furthest from its
         floor, but the honest single figure is what living costs would have to
         come down by to clear the consumption ceiling — the one a reader can
         act on this month without renegotiating a contract. */
      const target = FULL_MARKS.consumptionFloor * m.monthlyIncome;
      const need = (m.monthlyConsumption || 0) - target;
      return need > 0 ? { kind: 'trim', amount: need } : null;
    }
    if (!m.monthlyIncome) { return null; }
    const want = FULL_MARKS.netWorthMultiple * m.monthlyIncome * 12;
    const need = want - (m.netWorth || 0);
    return need > 0 ? { kind: 'build', amount: need } : null;
  };

  /* score.pillars is already in PILLARS' own declaration order (financialScore
     built it by walking PILLARS), and the two allocations below run over THAT
     order rather than the shortfall order the popup displays in — see the
     comment above the sort a few lines down for why the order an allocation
     runs in is not merely cosmetic. */
  const pillars = score.pillars.map(p => ({
    key: p.key, max: p.max, points: p.max * p.at, lost: p.max * (1 - p.at), at: p.at,
    gap: gapFor(p.key),
    parts: p.parts,
  }));

  /* ADR-0007 · The popup's integers are allocated so they add up: shownMax
     first, shownPoints over at * shownMax, shownLost derived — otherwise
     "saving 27 of 26, lost -1". */
  const shownMax = largestRemainder(pillars.map(p => p.max), 100);
  const shownPoints = largestRemainder(pillars.map((p, i) => p.at * shownMax[i]), score.value);
  pillars.forEach((p, i) => {
    p.shownPoints = shownPoints[i];
    p.shownMax = shownMax[i];
    p.shownLost = shownMax[i] - shownPoints[i];
  });

  /* ADR-0007 · Allocate in declaration order, then sort by shortfall —
     largestRemainder breaks ties by original index. Ties here go to the
     heavier pillar. */
  pillars.sort((a, b) => b.lost - a.lost || b.max - a.max);

  return {
    total: score.value,
    band: scoreBand(score.value),
    pillars,
    /* What to fix first, or null when every measurable pillar is already full —
       the popup swaps its closing line for congratulations rather than naming a
       "biggest drag" that is costing nothing. */
    drag: pillars.length && pillars[0].lost > 0.05 ? pillars[0] : null,
  };
}

module.exports = {
  essentialTotal, resolveEarmarks, debtInterestMonthly, debtInterestCoverage, monthlyAverages,
  financialScore, scoreFractions, healthMetrics, scoreBand, scoreBreakdown,
  NON_ESSENTIAL_TYPES, DAYS_PER_MONTH, SCORE_BANDS, PILLARS, FULL_MARKS,
};
