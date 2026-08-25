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
/* The same split-parent guard splitFlows applies, from the same module, so the
   saving-rate walk below and the Savings page's own flows cannot disagree
   about which rows are real. */
const { supersededBySplit } = require('./tx-role');
const { daysBetween } = require('./dates');

/* Account types that make up the savings pool, and the category types that
   mark a movement WITHIN it. One set, used for both, because they are the same
   idea seen from two sides: an account of this type holds saved money, and a
   category of this type names a vehicle it moved into. */
const POOL_TYPES = new Set(['savings', 'investment']);

/* How far apart the two legs of one transfer may be dated and still be read as
   the same movement. Banks settle an internal transfer same-day or next-day,
   and a reader typing both sides from a statement can be a day out either way;
   three days is generous enough for a weekend and far too short to pair a
   deposit with an unrelated withdrawal a fortnight later. */
const TRANSFER_DAYS = 3;
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
       parent, so no raw-row reading happens here.

       Case-folded and trimmed against the account's own type, not compared
       raw — the same trap views/savings.js's own `typeIs` documents (and
       worth.js:122-141 names by name): `load.js` only defaults `type` when
       the key is ABSENT, so `type: Savings` or `type: ' savings '` reached
       here exactly as written and dropped straight out of the saving-rate
       pillar while worth() still counted the same balance toward net worth
       elsewhere on the same score. Kept as its own copy here rather than a
       shared helper — health-data.js and views/savings.js are siblings, not
       a shared module, and each carries this comment for a reader who lands
       in only one of them. */
    const savers = S.accounts.filter(a =>
      POOL_TYPES.has(String((a && a.type) || '').trim().toLowerCase()));

    const periods = [];
    for (let i = 1; i <= want; i++) {
      const p = shiftPeriod(cur, -i);
      const spend = periodSpend(p, null);
      const { start, end } = periodRange(p);
      let savings = 0;
      /* Gathered across the WHOLE pool before anything is counted, because an
         internal transfer is only recognisable from both of its legs at once —
         see the matching step below. */
      const inflows = [], outflows = [];
      for (const a of savers) {
        for (const r of ((idx.get(a) || {}).rows || [])) {
          if (!r || typeof r.amount !== 'number' || !r.amount) { continue; }
          if (supersededBySplit(r)) { continue; }   // its parts are in this same list
          if (r.date < start || r.date > end) { continue; }
          (r.amount > 0 ? inflows : outflows).push({ acct: a, row: r });
        }
      }
      const spent = new Set();
      for (const { acct, row } of inflows) {
        /* MONEY THAT CROSSED INTO THE SAVINGS POOL FROM OUTSIDE IT. Not gross
           inflow, and not net-of-everything — both of those shipped, and both
           were wrong in opposite directions.

           Gross contributions (to 1.23.0) counted a rand moved from one
           savings account to another as fresh saving in the receiving account,
           with nothing taken off the sending one. On a real vault that
           overstated the rate by R1 250 a month.

           Netting ALL outflows (1.23.1) fixed that and broke something worse:
           it treated a sinking fund doing its job as dis-saving. A household
           that had been paying into a Baby Fund and a Car Fund for months, and
           then bought the pram and serviced the car, was told it was saving
           NOTHING — R12 022 a month of "Subaru maintenance", "Private room &
           pram" and "Baby carrier" came straight off a real R12 224 a month of
           saving and drove the whole pillar to zero. Spending a fund you built
           on purpose is the fund working, not a failure to save; the STOCK
           going down is a different statement from the RATE going negative,
           and the Savings page already tells that first story properly.

           So: count what arrives from outside the pool, and ignore movement
           WITHIN it in both directions. The vault distinguishes them cleanly
           without guessing — an internal transfer carries a savings- or
           investment-typed category (the receiving vehicle's own name), while
           spending a fund carries a real expense category. Both legs of an
           internal move are skipped, so a transfer can neither inflate the
           rate on the way in nor deflate it on the way out.

           Read off the rows directly rather than through splitFlows' buckets:
           classifyRow sorts a positive row into `growth` purely because its
           category is income-typed, which is right for the Savings page's
           growth chart and wrong here — a salary or a UIF reimbursement paid
           into a savings account is exactly the household putting money aside.
           supersededBySplit is the same split-parent guard splitFlows applies,
           imported from the same module so the two cannot drift.

           KNOWN LIMIT, stated rather than hidden: money paid in and spent
           straight back out within the window still counts in full, because
           nothing in the data separates "spending what I just put in" from
           "drawing on a fund I built last year" — both are an expense-typed
           row leaving a savings account. This is the conventional reading of a
           savings RATE (what share of income was set aside) and it is the one
           that does not punish a sinking fund, which is the shape real
           households actually use. The other story — the balance itself going
           down — is not lost: the Savings page's growth chart and its
           per-account "in / out" lines tell it directly, and tell it better
           than a single ratio could. */
        /* THE OTHER LEG is the only honest signal for an internal move, and
           deliberately the ONLY test applied here.

           A first attempt also skipped any inflow whose CATEGORY was
           savings-typed, reasoning that such a category names the vehicle the
           money came out of. On one real vault it did. In general it does not,
           and a guard fixture caught it: a household moving R10 000 a month
           from its CHEQUE account into Investments categorises that
           `Investing` — a savings-typed category naming the DESTINATION, which
           is the ordinary way people label it. That is new saving from outside
           the pool, and the category rule silently threw it away, taking a
           genuinely strong vault out of its band.

           So the pairing does the work instead: an equal and opposite row, in
           a DIFFERENT savings account, within a few days. Matched legs cancel
           and neither counts; each outflow can only cancel one inflow, so two
           genuine deposits are never swallowed by one withdrawal. A
           sinking-fund purchase has no such counterpart — the money went to a
           shop, not to another account of yours — so it never matches and
           never reduces the rate. And money arriving from a cheque account has
           no counterpart in the pool either, so it counts, whatever it is
           called. */
        const j = outflows.findIndex((o, i) => !spent.has(i)
          && o.acct !== acct
          && Math.abs(-o.row.amount - row.amount) < 0.005
          && Math.abs(daysBetween(o.row.date, row.date)) <= TRANSFER_DAYS);
        if (j !== -1) { spent.add(j); continue; }

        savings += row.amount;
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
