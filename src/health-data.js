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
const { activeDebts } = require('./worth');
const { splitFlows } = require('./savings-math');
const { worth } = require('./worth');

/* How far back the averages reach. Six months is long enough to absorb a bonus
   month or a double rent payment, and short enough that a household still
   recognises the answer as its own. */
const TRAILING_MONTHS = 6;

module.exports = function registerHealthData(ctx) {
  const {
    S, periodSpend, periodSummary, budgetTotals, accountIndex, catType,
    periodsForMonths, shiftPeriod, periodRange, currentPeriod, txInPeriod,
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
        const flow = splitFlows(rows, catType, { from: start, to: end });
        /* Contributions ALONE double-counted two real cases: a rand moved
           from one savings account to another read as fresh saving in the
           receiving account with nothing netted off the sending one, and a
           deposit reversed the same month (or an ordinary withdrawal) still
           added its gross inflow with the money that then left never taken
           back off. `withdrawals` is the same field splitFlows already
           reports for the account's own story on the Savings page, so
           netting it here is not a new judgement about what counts as a
           withdrawal — it is applying one that already exists. Growth
           (interest, dividends) is deliberately NOT added in alongside
           contributions: the rate answers what the household itself put
           aside, not what the market did for it, the same distinction
           accountFlows' own 'basis' field draws for the Savings page. */
        savings += flow.contributions - flow.withdrawals;
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
      /* The emergency fund's DIVISOR, built from every account rather than
         periodSpend's budget-scoped map. `essential` answers "what must the
         HOUSEHOLD keep paying with no income", and periodSpend deliberately
         drops `excluded` rows and `budget: false` accounts — the right rule
         for a BUDGET total, the wrong one here: rent paid from a joint
         account the household marked out of the budget is still a bill the
         fund has to cover the month income stops. The numerator already
         reads every account (resolveEarmarks walks S.accounts unfiltered),
         so a divisor built from the narrower budget-only set is the exact
         "two figures derived by different rules" shape this app keeps
         tripping on — proven on a real vault as R48,000 of real essential
         spend measured against an R8,000 divisor, "6 months covered" where
         the truth was 2.

         The net-then-flip transform below is periodSpend's own `spendOf`
         (trend-math.js), reproduced rather than reused: periodSpend cannot be
         called without ALSO pulling in the excluded/budget-scoped row filter
         this fix exists to bypass, so the two shapes have to be built
         separately even though the arithmetic is identical. Net first, THEN
         drop income-typed and net-positive categories (a refund month nets a
         category positive and it must not invert into essential spend) and
         flip the negative remainder to a positive rand figure — essentialTotal
         expects spend as positive amounts, the same shape periodSpend's
         `whole` already handed it. Transfers drop out before the net is
         built, the one exclusion periodSpend itself applies before anything
         else can. */
      const householdNet = Object.create(null);
      for (const t of txInPeriod(p)) {
        if (catType(t.cat) === 'transfer') { continue; }
        const k = t.cat || '';
        householdNet[k] = (householdNet[k] || 0) + t.amount;
      }
      const householdSpend = Object.create(null);
      for (const [cat, amt] of Object.entries(householdNet)) {
        const type = catType(cat);
        if (!cat || type === 'income' || type === 'transfer' || amt >= 0) { continue; }
        householdSpend[cat] = -amt;
      }
      periods.push({
        income: periodSummary(p).income,
        essential: essentialTotal(householdSpend, catType, S.settings.nonessential_groups),
        savings, consumption, fixed,
        budgeted: budgetTotals(p).spend,
        /* Household coverage, not budget coverage: a period whose only real
           activity sat in an excluded or non-budget account is still a period
           that happened, and dropping it from the trailing average would
           silently understate the very essential figure this fix exists to
           correct. Read off `householdNet` (before the income/transfer drop
           and the sign flip) rather than `householdSpend`, since a period
           that held only income transactions is still a real period too. */
        counted: spend.count > 0 || Object.keys(householdNet).length > 0,
      });
    }

    const earmarks = resolveEarmarks(S.accounts);
    const target = S.settings.emergency_target_months || 6;
    /* Once, not per consumer: the score, the debt tile's own figure and the
       "this is costing you" line are the same monthly interest bill, and
       computing it separately is how two of them disagree after someone
       changes the filter in only one place. */
    const debtInterest = debtInterestMonthly(S.debts);

    /* What the household is committed to repaying each month — or null when
       nothing says.

       The Debts table reads a blank `Payment` cell as 0 (see table-schema.js's
       money() reader), so a household that listed its debts and left that
       column empty produced instalments of 0 — full marks, and indistinguishable
       from a household with no repayments at all. A stated 0 is treated the
       same as a blank here deliberately: a debt you repay nothing on states no
       commitment either way, so there is nothing the two could mean differently
       for this measure.

       Some payments known and others blank still totals what IS known rather
       than refusing to answer: understating a burden is the safe direction, and
       a partial figure moves the score toward the truth where null leaves it
       untouched. */
    const active = activeDebts(S.debts);
    const stated = active.filter(d => (d.payment || 0) > 0);
    const instalments = stated.length ? stated.reduce((t, d) => t + d.payment, 0) : null;

    const metrics = healthMetrics({
      periods,
      monthsPerPeriod: (Number(S.settings.period_days) || 0) ? S.settings.period_days / DAYS_PER_MONTH : 1,
      earmarks,
      targetMonths: target,
      debtInterest,
      /* Null, not zero, when the Debt page does not exist: a vault that has
         never listed a debt has not declared it has none, and full marks for
         an unanswered question is the one thing this must not hand out. */
      debtInstalments: instalments,
      netWorth: worth(S.accounts, S.debts, S.assets).net,
      hasFixed: fixedCats.size > 0,
    });

    return {
      metrics, earmarks, target, debtInterest,
      hasFixed: fixedCats.size > 0,
      /* Whether the debt score rests on anything the household actually wrote.
         False means the pillar's full marks are an ASSUMPTION — see the note in
         health-math's PILLARS block — and the surfaces say so rather than
         letting a reader believe the vault checked. */
      debtsRecorded: active.length > 0,
      breakdown: scoreBreakdown(metrics, target),
      /* Nothing honest to say: no fund to measure and nothing computable from
         history. A week-old vault gets no card rather than a row of dashes. */
      empty: !earmarks.any && !metrics.score,
    };
  }

  ctx.provide({ healthSnapshot });
};
