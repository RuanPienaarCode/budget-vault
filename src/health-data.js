'use strict';
/* The Financial-health inputs, assembled once for every surface that shows them.

   The Dashboard's health card and the Score page ask the same five questions of
   the same six periods. Assembling that twice is how the two end up disagreeing:
   the figure a reader sees on the card and the figure behind the breakdown they
   opened to explain it would drift the moment one copy learned something the
   other did not. So the assembly lives here and both call it.

   Registered like trend-math.js rather than exported as a plain function,
   because every input is reached through a ctx helper — periodSpend,
   periodSummary, accountIndex, budgetTotals — and re-deriving those would be
   the same duplication one level down.

   Pure of the DOM, but not of ctx: the arithmetic it feeds is in
   health-math.js, which IS pure and is where the rules live. This module only
   gathers. */

const {
  healthMetrics, resolveEarmarks, debtInterestMonthly, essentialTotal,
  scoreBreakdown, DAYS_PER_MONTH,
} = require('./health-math');
const { splitFlows } = require('./savings-math');
const { worth } = require('./worth');

/* How far back the averages reach. Six months is long enough to absorb a bonus
   month or a double rent payment, and short enough that a household still
   recognises the answer as its own. */
const TRAILING_MONTHS = 6;

module.exports = function registerHealthData(ctx) {
  const {
    S, periodSpend, periodSummary, budgetTotals, accountIndex, catType,
    periodsForMonths, shiftPeriod, periodRange, currentPeriod,
  } = ctx;

  function healthSnapshot() {
    /* Which categories the household has declared it cannot stop paying. A Set
       of NAMES because that is what a transaction row carries; the flag lives
       on the category file (see load.js for why it is a flag, not a type
       test). */
    const fixedCats = new Set(S.categories.filter(c => c.fixed).map(c => c.name));

    const cur = currentPeriod();
    const want = periodsForMonths(TRAILING_MONTHS);
    const idx = accountIndex();
    /* Contributions into savings AND investment accounts both count as saving —
       the rate measures money the household kept, not which wrapper it kept it
       in. splitFlows already knows a contribution from growth and from a split
       parent, so no raw-row reading happens here. */
    const savers = S.accounts.filter(a => a.type === 'savings' || a.type === 'investment');

    const periods = [];
    for (let i = 1; i <= want; i++) {
      const p = shiftPeriod(cur, -i);
      const spend = periodSpend(p, null);
      const { start, end } = periodRange(p);
      let savings = 0;
      for (const a of savers) {
        const rows = (idx.get(a) || {}).rows || [];
        savings += splitFlows(rows, catType, { from: start, to: end }).contributions;
      }
      /* Three slices of one period, because they answer three questions.
         `essential` is what must be paid with no income — the emergency
         divisor. `consumption` is what living cost: everything except money
         moved into the household's own funds, without which funding an
         investment reads as overspending. `fixed` is the part that cannot be
         stopped this month. */
      let consumption = 0, fixed = 0;
      for (const [cat, amt] of Object.entries(spend.whole)) {
        const type = catType(cat);
        if (type !== 'savings' && type !== 'investment') { consumption += amt; }
        if (fixedCats.has(cat)) { fixed += amt; }
      }
      periods.push({
        income: periodSummary(p).income,
        essential: essentialTotal(spend.whole, catType),
        savings, consumption, fixed,
        budgeted: budgetTotals(p).spend,
        counted: spend.count > 0,
      });
    }

    const earmarks = resolveEarmarks(S.accounts);
    const target = S.settings.emergency_target_months || 6;
    /* Once, not per consumer: the score, the debt tile's own figure and the
       "this is costing you" line are the same monthly interest bill, and
       computing it separately is how two of them disagree after someone
       changes the filter in only one place. */
    const debtInterest = debtInterestMonthly(S.debts);

    const metrics = healthMetrics({
      periods,
      monthsPerPeriod: (Number(S.settings.period_days) || 0) ? S.settings.period_days / DAYS_PER_MONTH : 1,
      earmarks,
      targetMonths: target,
      debtInterest,
      /* Null, not zero, when the Debt page does not exist: a vault that has
         never listed a debt has not declared it has none, and full marks for
         an unanswered question is the one thing this must not hand out. */
      debtInstalments: S.debts.length ? S.debts.reduce((t, d) => t + (d.payment || 0), 0) : null,
      netWorth: worth(S.accounts, S.debts, S.assets).net,
      hasFixed: fixedCats.size > 0,
    });

    return {
      metrics, earmarks, target, debtInterest,
      hasFixed: fixedCats.size > 0,
      breakdown: scoreBreakdown(metrics, target),
      /* Nothing honest to say: no fund to measure and nothing computable from
         history. A week-old vault gets no card rather than a row of dashes. */
      empty: !earmarks.any && !metrics.score,
    };
  }

  ctx.provide({ healthSnapshot });
};
