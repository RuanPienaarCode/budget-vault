'use strict';
/* Where the money went, this period — the arithmetic behind the Score page's
   "Where the money went" card and the segmented rail beneath "Why it is N".

   Pure on purpose, per the house rule: no DOM, no `require('obsidian')`. The
   view (views/score.js) assembles the raw material from the ctx helpers that
   already exist — periodSummary, periodSpend, budgetTotals, splitFlows — the
   same way health-data.js assembles for health-math.js, and this module only
   does arithmetic on it.

   THE ONE RULE THIS FILE EXISTS TO ENFORCE: every figure on the flow card
   already has a home somewhere else in the app (the Dashboard hero, the Score
   breakdown, the Debts page), and this module is not allowed to invent a
   second way of computing any of them. Where a figure cannot be assembled
   from an existing source without a NEW judgement call, that judgement is
   written down here rather than silently made:

     `spentTotal` is periodSummary(cur).spend, unmodified — the exact figure
     the Dashboard hero's "Total Spent" tile shows. `committed` is the SAME
     "categories flagged fixed" rule health-data.js already applies to its
     six-period average (S.categories filter c.fixed), read for one period
     instead of six. `living` is arithmetic on those two — spent minus
     committed — so nothing about "what counts as living" is decided twice.

     `saving` is the six-period-average module's own per-period building
     block: contributions into savings/investment ACCOUNTS, detected by
     splitFlows the same way health-data.js detects them for the score's
     saving pillar. It is deliberately NOT "spend categorised as type savings"
     — health-math's own consumption figure already excludes that from spend
     for the same reason (a household funding its own investments must not
     read as overspending), and accounts, not category labels, are what
     splitFlows actually measures money landing in.

     `notYetSpent` is what is left of income after the other three are taken
     off — floored at zero. A period that spent or saved MORE than it earned
     is a real deficit (periodDeficit already argues about that on the
     Dashboard); this card only refuses to draw a negative slice of income.

     THE TWO LEFTS are a separate identity from the four bands above, and are
     allowed to disagree with the "not yet spent" band's own width whenever
     saving is non-zero — see the comment on `lefts` below for why that is
     correct rather than a bug. */

const { activeDebts } = require('./worth');
const { monthlyInterest } = require('./debt-math');
const { largestRemainder } = require('./share-percents');
const { PILLARS } = require('./health-math');

/* Category TYPES (not the household's custom groups) that fall inside the two
   named sub-buckets of "committed". Both are TYPE_ORDER entries, so a custom
   group added in Settings.md can never accidentally join either — only the
   two built-ins landing in a category's own `type:` frontmatter do. */
const HOUSING_TYPES = new Set(['housing', 'utilities']);
const SUBSCRIPTION_TYPES = new Set(['insurance', 'services']);

/* One period's income split four ways: committed & fixed bills, living
   costs, saving, and what is not yet spent.

     income              periodSummary(cur).income
     spentTotal          periodSummary(cur).spend — the Dashboard hero figure
     budgeted            budgetTotals(cur).spend
     spendByCat          periodSpend(cur, null).whole — {category: posAmount}
     fixedCats           Set of category NAMES flagged fixed (S.categories)
     catType             ctx.catType — name -> type string or null
     savingContribution  this period's splitFlows total across savings/
                          investment accounts (the score's own saving signal)
     debts               S.debts, raw

   Every argument defaults safely, so a brand-new vault (no income, no budget,
   no debts) returns zeroed bands rather than throwing or dividing by zero. */
function periodFlow({
  income, spentTotal, budgeted, spendByCat, fixedCats, catType,
  savingContribution, debts,
} = {}) {
  const inc = Number(income) > 0 ? Number(income) : 0;
  const spent = Math.max(0, Number(spentTotal) || 0);
  const bud = Math.max(0, Number(budgeted) || 0);
  const saving = Math.max(0, Number(savingContribution) || 0);
  const fixed = fixedCats instanceof Set ? fixedCats : new Set(fixedCats || []);
  const byCat = spendByCat || {};

  let committed = 0, debtRepayments = 0, housing = 0, subscriptions = 0;
  for (const [cat, amt] of Object.entries(byCat)) {
    if (!cat || !fixed.has(cat) || !(amt > 0)) { continue; }
    committed += amt;
    const type = catType ? catType(cat) : null;
    if (type === 'debt') { debtRepayments += amt; }
    else if (HOUSING_TYPES.has(type)) { housing += amt; }
    else if (SUBSCRIPTION_TYPES.has(type)) { subscriptions += amt; }
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

  /* This month's interest bill on the active book — the SAME figure
     health-data.js hands the score's debt pillar (debtInterestMonthly). It
     is a subset of `debtRepayments`, never an addend on top of it: an
     instalment already covers interest before principal, so "of which
     interest" is capped at the repayment line it sits under rather than
     ever printing larger than its own parent. */
  const interestRaw = activeDebts(debts).reduce((s, d) => s + monthlyInterest(d.balance, d.rate), 0);
  const interest = Math.min(interestRaw, debtRepayments);

  const living = Math.max(0, spent - committed);
  const notYetSpent = Math.max(0, inc - committed - living - saving);

  /* THE TWO LEFTS. Genuinely different questions, both real:

       leftInBudget   what the household's OWN PLAN still allows (budgeted
                      minus spent — can be negative, meaning over budget).
       neverBudgeted  income the plan never claimed at all (income minus
                      budgeted — can be negative, meaning over-allocated).
       together       leftInBudget + neverBudgeted, which is ALWAYS exactly
                      income - spentTotal (the budgeted term cancels), so
                      this identity holds unconditionally and needs no
                      clamping to stay true.

     `together` is allowed to read LARGER than the `notYetSpent` BAND above
     whenever `saving` is non-zero: notYetSpent has saving taken off it
     first (it is its own band), while `together` has not, because a budget
     total is a plan for SPENDING and says nothing about what left the
     household through a savings transfer. The honest reading is that
     `together` splits further into `saving` + `notYetSpent` — not that the
     two numbers must render as the same width. */
  const leftInBudget = bud - spent;
  const neverBudgeted = inc - bud;
  const together = leftInBudget + neverBudgeted;

  const allocatedOfIncome = inc > 0 ? bud / inc : null;
  const budgetUsed = bud > 0 ? spent / bud : null;

  const bandAmounts = [committed, living, saving, notYetSpent];
  const bandPercents = inc > 0
    ? largestRemainder(bandAmounts.map(a => (a / inc) * 100), 100)
    : bandAmounts.map(() => 0);

  return {
    income: inc,
    bands: {
      committed, living, saving, notYetSpent,
      percents: {
        committed: bandPercents[0], living: bandPercents[1],
        saving: bandPercents[2], notYetSpent: bandPercents[3],
      },
    },
    committedDetail: { debtRepayments, interest, housing, subscriptions, other },
    budget: { budgeted: bud, spentTotal: spent, allocatedOfIncome, budgetUsed },
    lefts: { leftInBudget, neverBudgeted, together },
  };
}

/* The score's segmented picture — one set of five weighted shares of 100,
   read in PILLARS' own weight order rather than breakdown.pillars' gap-sorted
   order. Was drawn as a bar under the hero number; is now the arithmetic
   behind the hero's ring (views/score.js's buildScoreRing) and nothing else
   reads it as a rail any more, but the shape of the data has not changed and
   neither has its guarantee.

   Each segment's WIDTH is the pillar's own share of 100 (`shownMax`, already
   renormalised and integer-allocated by health-math's scoreBreakdown so the
   widths sum to exactly 100), and FILL is the points actually earned
   (`shownPoints`) — the two rounded figures a reader sees printed. `at` rides
   alongside them UNROUNDED (health-math's own continuous fraction, 0..1): a
   ring segment's fill ARC is `at` of that segment's own track length, not
   `shownPoints / shownMax` of it — using the rounded pair there would draw a
   visibly different angle than the exact fraction scoreBreakdown actually
   computed, for no reason but that two integers happened to be handy. The
   printed "16 of 25" and the arc's own sweep are allowed to be the same
   fraction told two ways, not two roundings of it.

   A pillar the vault cannot answer is simply absent from breakdown.pillars
   already (health-math drops it and lets the rest share its weight), so
   filtering PILLARS down to the keys breakdown actually has keeps the two in
   step without a pillar ever appearing at width zero. */
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

module.exports = { periodFlow, railSegments, HOUSING_TYPES, SUBSCRIPTION_TYPES };
