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
const { poolAccounts, isSetAsideType } = require('./vocabulary');
const { splitFlows, savedFromOutside } = require('./savings-math');
/* The same split-parent guard splitFlows applies, from the same module, so the
   saving-rate walk below and the Savings page's own flows cannot disagree
   about which rows are real. */
const { supersededBySplit } = require('./tx-role');
const { daysBetween } = require('./dates');

/* Account types that make up the savings pool, and the category types that
   mark a movement WITHIN it. One set, used for both, because they are the same
   idea seen from two sides: an account of this type holds saved money, and a
   category of this type names a vehicle it moved into. */

/* How far apart the two legs of one transfer may be dated and still be read as
   the same movement. Banks settle an internal transfer same-day or next-day,
   and a reader typing both sides from a statement can be a day out either way;
   three days is generous enough for a weekend and far too short to pair a
   deposit with an unrelated withdrawal a fortnight later. */

/* Which row is which, for pairing. `label` is the transactions folder the row
   was read from, so it identifies the ACCOUNT without needing the account
   object — and two legs of one movement always sit in different ones. */
const rowKey = r => `${r.label}|${r.date}|${(r.amount || 0).toFixed(2)}|${r.desc || ''}`;

/* EXCLUDED ROWS THAT PAIR OFF AGAINST EACH OTHER — the two legs of one
   movement, found by their own arithmetic rather than trusted from the flag.

   `excluded` is overloaded, and that is the whole problem this solves. A
   reader uses it for two different things:

     · the second leg of money already counted once — settling a credit card,
       moving between own accounts, a reimbursement passing through
     · a bill that genuinely left the household but sits outside the budget
       for some unrelated reason

   Treating every excluded row as spending double-counted a real vault by
   R10 453 a month and told it it had 2.2 months of emergency cover instead of
   2.7. Treating none of them as spending threw away real reimbursed bills, and
   a guard test rightly pins that case. Neither blanket answer is right, so
   neither is used: a row is dropped only when an equal and opposite excluded
   row sits in a DIFFERENT account within a few days, which is what a transfer
   actually looks like once both sides are written down.

   Same account never pairs. On a real vault the credit card holds both the
   R11 514.04 purchase and the R11 514.00 that later settles it, and those are
   two different events — the purchase is real spending and must survive. Its
   partner is the R11 514.00 leaving the savings account, which is where the
   money actually came from. */
/* WITHIN THE PERIOD, not within three days. The window used to be three days
   and the number decided real figures: a household whose bank settled a card
   in four days counted the same rand twice in its spending, and read a lower
   emergency cover than the identical household on an instant transfer. Two
   people doing the same thing got different answers because of their bank.

   Every caller already hands this one period's rows, so the period IS the
   window and nothing here needs a calendar. Checked against a real vault
   before widening: it finds one more genuine pair (a plumber paid on a card on
   the 21st, reimbursed from the transaction account on the 29th — 22 days, and
   invisible to a three-day rule) and no false ones.

   Description agreement was tried as a stricter test and rejected on the same
   data: it threw away four real pairs, because the two sides of one movement
   are written by two different banks — "Discovery Bank account...6397" against
   "Notice savings account payout", "VITALITY TRAVEL" against "CAPITEC D
   COLENBRANDER". Equal and opposite, in two different accounts, once each, is
   the signal that actually holds. */
function passthroughPairs(rows) {
  const drop = new Set();
  const ex = (rows || []).filter(r => r && r.excluded
    && typeof r.amount === 'number' && r.amount);
  const used = new Array(ex.length).fill(false);
  for (let i = 0; i < ex.length; i++) {
    if (used[i]) { continue; }
    for (let j = i + 1; j < ex.length; j++) {
      if (used[j]) { continue; }
      const a = ex[i], b = ex[j];
      if (a.label === b.label) { continue; }
      if (Math.abs(a.amount + b.amount) > 0.005) { continue; }
      used[i] = true; used[j] = true;
      drop.add(rowKey(a)); drop.add(rowKey(b));
      break;
    }
  }
  return drop;
}
const { worth, otherCurrencyNet } = require('./worth');
const { splitByCurrency, isForeign } = require('./currency');

/* How far back the averages reach. Six months is long enough to absorb a bonus
   month or a double rent payment, and short enough that a household still
   recognises the answer as its own. */
const TRAILING_MONTHS = 6;

module.exports = function registerHealthData(ctx) {
  const {
    S, periodSpend, periodSummary, budgetTotals, budgetUsed, accountIndex, impliedAccounts, catType, declaredCatType,
    periodsForMonths, shiftPeriod, periodRange, currentPeriod, txInPeriod,
    foreignLabels,
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

    /* ISSUE 28, second pass. Every household walk below feeds a RATIO, and
       until this line each of them read `txInPeriod(p)` raw — so a vault with
       one rupiah holiday account divided rand by rupiah in every one of them
       while the block at the foot of this function narrowed only the ACCOUNTS
       and its comment claimed "the pool is narrowed to the household's own
       currency before any of it is divided". It was not, and the page said so
       out loud: "1 account in another currency (Rp) is not in these figures",
       printed beside figures that very much included it. Measured on the
       fixture in tests/score-currency-isolation.test.cjs: cover 3.5 months →
       0.003, saving rate 11.1% → 0.02%, the score 69 → 22. A wrong total at
       least looks like a number; a wrong percentage looks like a measurement.

       `foreignLabels()` (src/period.js) is the SAME predicate summaryInRange
       already filters by — a Map of transaction-folder label to symbol for
       every folder whose account states a currency that is not the
       household's — so the Dashboard's period summary and this snapshot
       cannot come to different conclusions about which rows are household
       money. Resolved once per snapshot rather than per period: it is a
       property of the accounts, and the six periods below cannot disagree
       about it.

       What is held out is NOT dropped silently. Because the predicate is the
       account's own `currency:`, the folders excluded here belong to exactly
       the accounts `splitByCurrency` hands back as `scoreOthers` at the foot
       of this function — so the disclosure the page already prints now names
       precisely what these walks left out, which is what it always claimed
       to be doing. currency.js:14 forbids the alternative. */
    const foreign = foreignLabels();
    const homeRows = p => txInPeriod(p).filter(t => !foreign.has(t.label));
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
    /* Household currency only, matching the rows the pairing below is handed
       (homeRows drops foreign folders). With the pool boundary drawn wider
       than the row set, a foreign savings account sat in saverLabels while
       none of its rows were present — so a transfer OUT of a euro savings
       account INTO a rand one lost its outflow leg and counted as fresh
       saving from outside the pool. Both sides of the pairing now see the
       same accounts. */
    const savers = poolAccounts(S.accounts).filter(a => !isForeign(a, S.settings.currency));

    const periods = [];
    for (let i = 1; i <= want; i++) {
      const p = shiftPeriod(cur, -i);
      const spend = periodSpend(p, null);
      const { start, end } = periodRange(p);
      let savings = 0;
      /* Pass-throughs are found across the WHOLE HOUSEHOLD, not just the pool:
         the R40 000 UIF landed in a savings account but its matching leg left
         a cheque account, so a pool-only search would never have seen it. */
      const householdRows = homeRows(p);
      /* Gathered across the WHOLE pool before anything is counted, because an
         internal transfer is only recognisable from both of its legs at once —
         see the matching step below. */
      /* Walked off the HOUSEHOLD rows, filtered down to the pool by label,
         rather than off accountIndex's per-account row lists. Those lists hold
         the raw file rows, which carry no `label` — so a key built from one
         could never match a key built from a household row, and the
         pass-through check below silently did nothing at all. Same rows either
         way; this is the shape that can be compared. */
      const saverLabels = new Map();
      for (const a of savers) {
        for (const L of ((idx.get(a) || {}).labels || [])) { saverLabels.set(L, a); }
      }
      /* ISSUE 32 — catType, so a fund purchase can no longer be paired away
         as the leg of an internal move. */
      savings = savedFromOutside(householdRows, saverLabels, declaredCatType);
      /* Three slices of one period, because they answer three questions.
         `essential` is what must be paid with no income — the emergency
         divisor. `consumption` is what living cost: everything except money
         moved into the household's own funds, without which funding an
         investment reads as overspending. `fixed` is the part that cannot be
         stopped this month. */
      /* BUDGET-SCOPED, and used for exactly one thing: "budget used". That
         question compares what was spent against THE PLAN, and a plan is
         budget-scoped by definition — measuring a household-wide numerator
         against a budget-only denominator would be the same mixing this whole
         block exists to end. Every other share below is household-wide, built
         from householdSpend further down. */
      /* ADR-0005: the SAME numerator the Dashboard hero prints, so the ring's
         six-period average is an average of the figure the reader has already
         seen. This used to sum periodSpend()'s NET map with savings types
         dropped — refunds netted, uncategorised gone — and so differed from
         the hero even over a single counted period. */
      const consumptionBudget = budgetUsed(p).spent;
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
      /* One filtered row list for both, so the pairing and the walk it feeds
         can never see different rows. `homeRows`, not `txInPeriod` — see the
         currency note above healthSnapshot's loop. */
      const netRows = homeRows(p);
      const householdPass = passthroughPairs(netRows);
      for (const t of netRows) {
        if (catType(t.cat) === 'transfer') { continue; }
        /* PAIRED excluded rows drop; lone ones stay. Dropping the `excluded`
           filter outright was a real bug, and so would restoring it be.

           The fix this block exists for was about ACCOUNTS: periodSpend drops
           `budget: false` accounts, and a bill paid from a joint account the
           household marked out of the budget is still a bill the emergency
           fund must cover. That argument stands. But the same edit also
           dropped the `excluded` filter, and a reader uses that flag for two
           different things — the second leg of already-counted money, and a
           real bill that sits outside the budget for an unrelated reason.

           Caught on a real vault: a R11 514 car service appeared as a card
           purchase AND as the savings withdrawal that settled the card, five
           days apart. Counting both put R63 293 a month of already-counted
           money into the divisor and reported 2.2 months of cover instead of
           2.7. Credit-card settlements, a UIF reimbursement passing through,
           and moves into other savings vehicles all landed the same way — and
           every one of them has a matching opposite leg in another account,
           which is exactly what passthroughPairs looks for. A genuinely
           reimbursed rent top-up has no such partner and still counts.

           CLAUDE.md's rule that anything measuring the ACCOUNT must not filter
           on `excluded` — reconcile, periodActivity, splitFlows — stands, and
           is a different question: the money did move. This measures SPENDING,
           and counting a rand twice because it moved twice is the thing the
           flag exists to prevent. */
        if (householdPass.has(rowKey(t))) { continue; }
        const k = t.cat || '';
        householdNet[k] = (householdNet[k] || 0) + t.amount;
      }
      const householdSpend = Object.create(null);
      for (const [cat, amt] of Object.entries(householdNet)) {
        const type = catType(cat);
        if (!cat || type === 'income' || type === 'transfer' || amt >= 0) { continue; }
        householdSpend[cat] = -amt;
      }

      /* ONE ROW POPULATION FOR EVERY SHARE OF INCOME.

         A ratio only means something when both halves are counted the same
         way, and this module had drifted into counting them two ways: income,
         consumption and fixed came from periodSpend (budget-scoped — excluded
         rows and non-budget accounts dropped), while essential and the saving
         rate were built household-wide with pass-throughs paired off. On a
         real vault those two views differ by about R16 000 a month, so the
         saving rate was a household numerator over a budget denominator and
         read 11.3% where the consistent answer either way is nearer 9%.

         Both views are legitimate — one answers "how did I do against my
         plan", the other "what actually moved through this household" — but a
         single ratio cannot straddle them. Everything below now lives in the
         household view, with `passthroughPairs` removing the second leg of
         money already counted once. `budgeted` and `consumptionBudget` stay
         budget-scoped on purpose: they answer the plan question. */
      let consumption = 0, fixed = 0;
      for (const [cat, amt] of Object.entries(householdSpend)) {
        const type = catType(cat);
        if (!isSetAsideType(type)) { consumption += amt; }
        if (fixedCats.has(cat)) { fixed += amt; }
      }
      let income = 0;
      for (const [cat, amt] of Object.entries(householdNet)) {
        if (catType(cat) === 'income' && amt > 0) { income += amt; }
      }

      periods.push({
        income,
        essential: essentialTotal(householdSpend, catType, S.settings.nonessential_groups),
        savings, consumption, fixed, consumptionBudget,
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

    /* ISSUE 28 (2026-08-29 audit). Every figure this snapshot feeds the score
       is a RATIO, and a ratio is the one shape where mixing currencies does
       more than overstate a total — it inverts the verdict. Measured on a
       two-currency vault: a rand emergency fund over a rupiah-polluted
       essential-spend average printed "0.0 months" in red where the true
       reading was 6.7 months in green, and the overall score fell 26 points.
       A wrong total at least looks like a number; a wrong percentage looks
       like a measurement.

       So the pool is narrowed to the household's own currency before any of
       it is divided. What that leaves out is counted and named on the page —
       currency.js:14 forbids excluding an account silently, and "left out of
       a score" is an exclusion however good the reason. */
    const { primary: homeAccounts, others: scoreOthers } =
      splitByCurrency(impliedAccounts(), S.settings.currency);   // ISSUE 44 — one as-of across every net worth
    const earmarks = resolveEarmarks(homeAccounts);
    const target = S.settings.emergency_target_months || 6;
    /* Once, not per consumer: the score, the debt tile's own figure and the
       "this is costing you" line are the same monthly interest bill, and
       computing it separately is how two of them disagree after someone
       changes the filter in only one place. */
    const debtInterest = debtInterestMonthly(S.debts, S.settings.currency);

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
    /* Foreign debts held out, the same way debtInterestMonthly above and
       worth() below already hold them out — and for the sharper reason. A
       €900 monthly repayment is not R900 of commitment, and instalmentShare
       divides this straight by rand income: on a two-currency book the score
       read a household as spending a quarter more of its income on debt than
       it does, against a Debt page six inches away still printing the
       rand-only total. `isForeign` through debtInterestMonthly's own
       argument would not reach here — this is a second figure off the same
       ledger, so it takes the same filter rather than trusting that one. */
    const active = activeDebts(S.debts)
      .filter(d => !isForeign(d, S.settings.currency));
    const stated = active.filter(d => (d.payment || 0) > 0);
    const instalments = stated.length ? stated.reduce((t, d) => t + d.payment, 0) : null;

    /* ISSUE 56/57. Kept whole rather than reduced to `.net` on the spot,
       because the disclosure below is built out of the very ledgers it held
       out. Same reason views/savings.js reads it high in its own function. */
    const netWorthFull = worth(homeAccounts, S.debts, S.assets, S.settings.currency, S.owed);

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
      /* ISSUE 39. Receivables passed, so the score's net worth is the same
         figure the Dashboard tile and the report print. The score divides this
         by income (netWorthMultiple), so a ledger missing from it here is a
         wrong RATIO, not just a wrong total — the shape health-data's own
         currency note calls the more dangerous of the two. */
      netWorth: netWorthFull.net,
      hasFixed: fixedCats.size > 0,
    });

    return {
      /* Handed to the page so the Score can SAY what it left out, rather than
         quietly scoring a household on part of its money.

         ACCOUNTS ONLY, and that is what it is for: `homeRows` narrows every
         period walk above by account, so this names what is missing from the
         RATIOS. Every consumer that states a NET WORTH wants the other list. */
      otherCurrencies: scoreOthers,
      /* ISSUE 56/57. What the net worth above left out, across all three of
         the ledgers worth() reads — accounts, assets, debts and receivables
         merged into one per-symbol net by otherCurrencyNet.

         The Score printed "1 account in another currency (EUR) is not in these
         figures", naming EUR 500, beside a net worth that had also silently
         dropped a EUR 200 000 flat, a EUR 100 000 loan and EUR 500 lent out —
         0.17% of what it excluded, on a figure the score divides by income.
         The Dashboard, the Savings page and the Report were all moved onto
         otherCurrencyNet when ISSUE 30 found exactly this; the Score and the
         exported report were the two surfaces that never were. */
      worthOtherCurrencies: otherCurrencyNet(netWorthFull, scoreOthers),
      metrics, earmarks, target, debtInterest,
      hasFixed: fixedCats.size > 0,
      /* Whether the debt score rests on anything the household actually wrote.
         False means the pillar's full marks are an ASSUMPTION — see the note in
         health-math's PILLARS block — and the surfaces say so rather than
         letting a reader believe the vault checked.

         Off the currency-filtered `active`, deliberately. A household whose
         only debt is a euro bond has written one down, but not one this score
         can measure — every figure the pillar reads is now the rand book —
         so full marks there ARE an assumption, and saying otherwise would be
         the pillar quietly claiming a check it did not perform. */
      debtsRecorded: active.length > 0,
      breakdown: scoreBreakdown(metrics, target),
      /* Nothing honest to say: no fund to measure and nothing computable from
         history. A week-old vault gets no card rather than a row of dashes. */
      empty: !earmarks.any && !metrics.score,
    };
  }

  ctx.provide({ healthSnapshot });
};
