'use strict';
/* Financial-health arithmetic — the numbers behind the Dashboard's health card:
   emergency-fund coverage, savings rate, the debt-interest share of income, and
   the composite score built from the three.

   Pure on purpose, per the house rule: no DOM, no `require('obsidian')`, and
   every figure that depends on "when" arrives as an input. The view assembles
   the per-period raw material (income, essential spend, contributions) from the
   ctx helpers that already exist — periodSpend, periodSummary, splitFlows — and
   this module only does arithmetic on it, so a guard test can drive every
   branch from bare node.

   Everything is normalised to MONTHLY scale before any ratio is taken. A vault
   on a 14-day pay cycle measures its periods in fortnights, and "3.1 periods of
   cover" is not a sentence anyone plans an emergency around — while a target of
   "6 months" is how every reader already thinks about this. 30.44 is the mean
   Gregorian month, the same constant trend-math.js uses to turn months into
   periods, so the two modules cannot disagree about how long a month is. */

const { monthlyInterest } = require('./debt-math');
const { activeDebts } = require('./worth');
const { isForeign } = require('./currency');
const { largestRemainder } = require('./share-percents');

const DAYS_PER_MONTH = 30.44;

/* Category types that fall OUT of "essential" spending. The emergency question
   is what the household must keep paying with no income, and by then the
   luxuries are cut, the giving pauses, and nobody is contributing to savings —
   so counting those inflates the divisor and understates the cover the fund
   really gives. Income and transfer never reach this filter (periodSpend drops
   them upstream), but they are listed anyway so a caller with a different
   upstream cannot quietly count a transfer as an essential bill. */
const NON_ESSENTIAL_TYPES = new Set(['luxuries', 'giving', 'savings', 'investment', 'income', 'transfer']);

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

/* Which money is the emergency fund, read off the accounts' own frontmatter.

     emergency_fund: true      — this whole account is the fund
     emergency_fund: 50000     — only this much of it is

   The earmark that COUNTS is capped at what the account actually holds: a
   claim of R50,000 on a balance of R30,000 is R30,000 of real cover, and
   reporting the claim would inflate the one figure this card exists to keep
   honest. The claim itself is not corrected or rewritten — the app argues, it
   does not correct — so each capped account comes back on the `over` list for
   the view to say so out loud.

   `any` is separate from `total` because they answer different questions:
   an earmarked account holding nothing is a fund at zero (show 0.0 months),
   while NO earmark anywhere means the reader has never been asked (show the
   setup hint, and keep the fund out of the score entirely). */
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
/* Null — not zero — when debts ARE listed but not one of them states a rate.
   This is the same null-vs-zero rule health-data.js already applies to
   `payment`, and it was missing here for exactly as long: table-schema's
   money() reader turns a blank `Rate` cell into 0, monthlyRate(0) is 0, and a
   *measured* zero scored full marks on the debt pillar for a household
   carrying R250 000. Some rates known and others blank still totals what IS
   known, for the reason the payment rule gives: understating a burden is the
   safe direction, and a partial figure moves the score toward the truth where
   null leaves it untouched. An empty book stays 0 — no debts really is no
   interest, and that is a claim about the household, not a gap in it. */
/* ISSUE 28/30. `household` is the same OPTIONAL symbol worth() and
   owedSummary() already take, with the same contract: absent means "add every
   debt", which is exactly how this function always behaved and is the right
   answer for a vault whose Debts.md states no currency — which is all of them
   until someone sets one.

   Supplied, foreign debts are held out, because this figure is a rand bill
   and a euro mortgage's interest is not one. It had to be: worth() eight
   lines below this function's own call site in health-data.js already filtered
   them (worth.js's `fromDebts`), and so did views/debts.js's KPI — so a
   household that recorded a euro bond saw the Debt page print R333,33 a month
   while the Score page's debt pillar divided R1 000,00 by the same income,
   moving interestShare from 0.83% to 2.5% off a liability net worth had
   already declined to count. Three readers of one ledger, two rules — this
   repository's most-repeated bug shape, and the third occurrence of it on
   this exact figure.

   Held out BEFORE the all-blank-rates test, so a book of one rand debt with
   no rate and one euro debt with a rate still returns null rather than
   reporting the foreign rate as the household's whole interest bill. */
function debtInterestMonthly(debts, household) {
  const active = activeDebts(debts).filter(d => !household || !isForeign(d, household));
  const stated = active.filter(d => (Number(d.rate) || 0) > 0);
  if (active.length && !stated.length) { return null; }
  return active.reduce((sum, d) => sum + monthlyInterest(d.balance, d.rate), 0);
}

/* Average a trailing window of per-period figures and restate them monthly.

   `periods` is [{ income, essential, savings, counted }]. A period with
   `counted: false` held no transactions at all — that is a window the vault
   does not cover, not a month of spending nothing, and averaging it in would
   halve every figure for a vault whose history starts mid-window (the same
   rule compareTotals applies, for the same reason).

   Returns nulls rather than zeroes when NOTHING was counted: a brand-new vault
   has no history to average, and 0 would read as "this household earns and
   spends nothing", which is a claim the data never made. */
function monthlyAverages(periods, monthsPerPeriod) {
  const mpp = monthsPerPeriod > 0 ? monthsPerPeriod : 1;
  const KEYS = ['income', 'essential', 'savings', 'consumption', 'fixed'];
  const sums = {}; for (const k of KEYS) { sums[k] = 0; }
  let counted = 0;
  /* `budgeted` — and the consumption figure PAIRED against it for budgetUsed —
     average over a narrower, different denominator: periods that actually
     carried a plan, not every counted period. Averaging budgeted spend the
     same way as income or essential punished a household that only started
     budgeting partway through the six-period window: six periods with a real
     R22,000 plan in the last two divided that total by six instead of two,
     "budget used" read 273% for a household that was 9% UNDER budget, and the
     figure moved further from the truth the longer its budgeting history ran.
     A period with no budget at all is not a period budgeted zero, for exactly
     the reason an uncovered period above is not a month spent nothing — this
     completes that same rule rather than inventing a new one. */
  let planned = 0, plannedBudgeted = 0, plannedConsumption = 0;
  for (const p of periods || []) {
    if (!p || !p.counted) { continue; }
    counted++;
    for (const k of KEYS) { sums[k] += p[k] || 0; }
    if (p.budgeted > 0) {
      planned++;
      plannedBudgeted += p.budgeted;
      /* `consumptionBudget`, not `consumption` — budget-scoped on both sides.
         "Budget used" asks how the spending compared to THE PLAN, and the plan
         only ever covered budget-scoped rows, so measuring a household-wide
         numerator against it would report a household spending far more of its
         budget than it agreed to simply because some of that spending was
         never in the budget. Every other share health-data reports is
         household-wide; this one figure is deliberately not, and takes its own
         field so the difference is impossible to miss. Falls back to
         `consumption` for a caller still passing the old shape. */
      plannedConsumption += (p.consumptionBudget !== undefined
        ? p.consumptionBudget : p.consumption) || 0;
    }
  }
  const out = { counted, planned };
  for (const k of KEYS) { out[k] = counted ? sums[k] / counted / mpp : null; }
  out.budgeted = planned ? plannedBudgeted / planned / mpp : null;
  /* NOT the same figure as `out.consumption` above — that one is the
     six-period trailing average the consumption PILLAR scores against income.
     This one is paired to the same narrower window as `budgeted` so
     budgetUsed compares consumption and its own plan over identical periods,
     the way monthlyAverages already promises for every other pair it hands
     back. */
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

/* ------------------------------ the score -------------------------------

   FIVE PILLARS, not one flat list of measures.

   The first version weighted three measures directly. Adding the rest of what a
   household actually turns on — what it owns, what its fixed obligations eat,
   whether it kept to its own budget — would have diluted every one of them: at
   eight equal-ish weights, funding an empty emergency account barely moves the
   number, and the one instruction the popup exists to give ("fix this first")
   degenerates into eight near-ties.

   Grouping fixes that. Each pillar keeps a weight worth caring about, and the
   measures inside it share that weight between them — so `debt` is worth 20
   whether the vault can see one aspect of it or both.

   A household with NO DEBTS keeps the pillar and earns it. That is a deliberate
   choice between two defensible readings of an empty Debt page: "unanswered",
   which would drop the pillar and give a genuinely debt-free household no
   credit for it, or "debt-free", which rewards them and flatters anyone whose
   debts are simply unrecorded. The second is chosen because the vault is the
   source of truth everywhere else in this app, and because refusing to credit
   the one thing many households have actually achieved reads as the score being
   broken. The assumption does not hide: healthSnapshot reports `debtsRecorded`
   so the surfaces say the score assumes no debts, rather than quietly
   asserting it. The app argues; it does not assume in silence.

   Weights are a judgement, not a derivation, and they are here in one literal
   so they can be argued with rather than hunted for. Reserves leads because
   running out of money is the failure that ends households; wealth trails
   because it is the slowest to move and the least actionable this month. */
/* A score is only a summary if enough of the household is actually in it.
   Renormalising over the live pillars is right when one genuinely does not
   apply — a vault with no debts should not carry a silent zero for debt. It is
   wrong when the pillar is dark because something is MISSING, and the two look
   identical from inside financialScore.

   The case that forced this: four of the five pillars are income-gated, so a
   household with no income has only `reserves` left, and a big pot against a
   small essential spend is full marks on it. The same household with the same
   R500 000 pot and the same R14 000 rent scored 70 while earning R40 000 a
   month and 100 while earning nothing. Losing your income raised your score.

   Rather than special-case income, require the live pillars to carry half the
   weight before any score is reported. No income leaves 25 of 100 live and
   returns null; no debt leaves 80 and scores exactly as it did. */
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

/* Where each measure earns full marks, and where it earns nothing. Every one is
   a documented convention rather than a derivation, so they live together where
   a reader can disagree with them:

     savings    20% of income is the long-standing planners' benchmark.
     interest   nothing to interest is the goal; a tenth of income going to it
                is a debt problem whatever else is true.
     instalments 35% of income in debt repayments is the classic lending
                ceiling — past it, lenders themselves stop saying yes.
     fixed      35% of income committed before any decision is comfortable;
                60% is a household one lost invoice from trouble.
     consumption living costs under 70% of income leaves room to save AND
                absorb a shock; at 100% every rand is already spent.
     budget     spending your budget is full marks — a budget is a plan, not a
                target to undercut. 20% over it is where the plan stopped
                describing the household.
     networth   three times annual income is a strong position; zero or
                negative earns nothing. This is where a house lands: bond and
                property arrive together, so the pillar moves as the bond is
                paid down rather than jumping on the day of purchase.  */
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

/* The composite, and the structure behind it.

   Two rounds of renormalisation, inner then outer: the measures a pillar can
   see share that pillar's weight, and the pillars that have anything to say
   share the whole 100. A vault with no debts is therefore scored out of 100 on
   the four pillars it can answer, rather than carrying a silent zero for the
   one it cannot — absence of a claim has never been a claim of nothing.

   Returns null when too little is measurable for a score to be a summary
   rather than a fabrication — see MIN_LIVE_WEIGHT. A score resting on one
   pillar out of five is as much an invention as one resting on none. */
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

/* Every figure the card shows, from the raw material the view hands over.

   Ratios only exist where their denominator does: an income of nothing (or no
   history at all) makes "percent of income" a division by zero wearing a
   percent sign, so those come back null and the card shows a dash with a reason
   rather than a number.

   CONSUMPTION IS NOT TOTAL SPEND, and the difference is the whole reason it is
   passed in separately. Moving money into a savings account leaves the cheque
   account as an ordinary debit, so a household saving a fifth of its income
   reads as spending 110% of it. Measured that way this vault reported R55,744
   going out against R50,435 coming in — a household "living beyond its means"
   whose real crime was funding its own investments. Consumption therefore
   excludes what was saved or invested; it is what living actually cost. */
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
    /* Gated on hasIncome like every sibling measure, and NOT because the
       ratio needs income — it does not, it is spend against the household's
       own plan. It is because this was the one measure that survived a vault
       with no recognised income, and the outer renormalisation then handed it
       the whole 100: a household with a typo'd income category, R20 000
       overdrawn and no savings scored 100 and was told it was "Strong", off a
       single 5-point measure. A score built on one surviving part is not a
       summary of anything, and this was the part that let it happen. */
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

/* Where the score's points went, pillar by pillar, and what closing each
   shortfall takes — the arithmetic behind the explanation popup.

   Points are RENORMALISED exactly as financialScore renormalises, so the
   figures in the popup always add up to the headline above them. A popup whose
   parts sum to 67 beside a headline of 67 is the whole reason this is derived
   from the score rather than re-weighted here.

   `gap` is the one concrete number a reader can act on, and it is deliberately
   a different quantity per pillar because the actions are different: money to
   add to a fund, money per month to redirect, money per month going nowhere.
   Null when a pillar is already at full marks — there is nothing to close, and
   printing "add R0" reads as a broken sentence. */
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
    /* `trim`, `monthly` and `build` all name a rand figure AS A SHARE OF
       INCOME, so each starts by refusing to answer without one — belt and
       suspenders alongside the pillars' own hasIncome gates upstream (every
       measure behind saving/spending/wealth already comes back null without
       income, which is what keeps this branch unreached today), rather than
       trusting that chain to hold forever. Without it, `m.monthlyIncome || 0`
       quietly turned "no income" into a target of R0 and reported the
       household's entire living cost as the amount to trim off nothing —
       "reserves" is deliberately exempt: it is earmarks over ESSENTIAL SPEND,
       which has never been an income-relative question. */
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

  /* The INTEGERS the popup prints, allocated so they add up to what is on
     screen above them — the exact figures already sum correctly, but rounding
     each one alone does not: an earlier build printed 0 + 26 + 17 beside a
     headline of 42. Largest-remainder is the same allocation the donut's
     percentage column uses, shared from share-percents.js rather than
     reimplemented.

     shownMax is allocated FIRST, and shownPoints is then allocated over
     `at * shownMax` — the pillar's own fraction of its OWN rounded ceiling —
     rather than over the continuous `points` independently rounded against
     100. Two independent largest-remainder allocations could round one
     pillar's ceiling down while rounding that SAME pillar's points up, and
     did: an ordinary vault with no `emergency_fund` set anywhere printed
     "saving 27 of 26, lost -1" — a pillar earning more than its own maximum.
     `at * shownMax[i]` can never exceed shownMax[i] (at is capped at 1), so
     its floor is at most shownMax[i] and largestRemainder's own +1 step can
     bring it to shownMax[i] exactly but never past it. `shownLost` is derived
     from the two rounded figures rather than rounded itself, so "26 of 40"
     and "costing you 14" cannot disagree. */
  const shownMax = largestRemainder(pillars.map(p => p.max), 100);
  const shownPoints = largestRemainder(pillars.map((p, i) => p.at * shownMax[i]), score.value);
  pillars.forEach((p, i) => {
    p.shownPoints = shownPoints[i];
    p.shownMax = shownMax[i];
    p.shownLost = shownMax[i] - shownPoints[i];
  });

  /* NOW sort for display, biggest shortfall first — the popup leads with what
     is costing the most, not with whichever pillar happens to be declared
     first, and not with whichever pillar happens to be worst today either:
     largestRemainder breaks a tied remainder by ORIGINAL INDEX (deliberately,
     per share-percents.js), so allocating AFTER this sort let the rounding
     point land on whichever pillar the shortfall order put first that day —
     the same four live pillars allocated {saving 27, debt 27, spending 26} in
     one order and {saving 26, debt 27, spending 27} in the reverse. Ties break
     on the heavier pillar, so closing the one with more weight behind it comes
     first: it moves the score further per rand. */
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
  essentialTotal, resolveEarmarks, debtInterestMonthly, monthlyAverages,
  financialScore, scoreFractions, healthMetrics, scoreBand, scoreBreakdown,
  NON_ESSENTIAL_TYPES, DAYS_PER_MONTH, SCORE_BANDS, PILLARS, FULL_MARKS,
};
