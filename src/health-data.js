'use strict';
/* The Financial-health inputs, assembled once for every surface that shows
   them — the Dashboard's health card and the Score page both read this one
   snapshot, so the card and the breakdown behind it cannot drift apart.
   Registered on ctx like trend-math.js because every input is a ctx helper.
   Pure of the DOM, not of ctx: the arithmetic lives in health-math.js, which
   IS pure and holds the rules. ADR-0007 · health-data.js — purpose. */

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
/* rowKey and passthroughPairs moved verbatim to src/ledger.js in Phase 2 of
   ADR-0006; the comments above them stay as the record of why pairing
   exists. */

/* ADR-0007 · Pass-through pairing: excluded rows that cancel each other. An
   excluded row is dropped only when an equal and opposite excluded row sits in
   a DIFFERENT account in the same period. Code now lives in ledger.js. */
/* ADR-0007 · The pairing window is the period, not three days. No day window
   and no description test — both were tried on a real vault and rejected. */
const { worth, otherCurrencyNet } = require('./worth');
const { splitByCurrency, isForeign } = require('./currency');

/* How far back the averages reach. Six months is long enough to absorb a bonus
   month or a double rent payment, and short enough that a household still
   recognises the answer as its own. */
const TRAILING_MONTHS = 6;

module.exports = function registerHealthData(ctx) {
  const {
    S, periodSpend, periodSummary, budgetTotals, budgetUsed, accountIndex, ledger, tally, LENSES, impliedAccounts, catType, declaredCatType,
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

    /* ADR-0007 · Household walks read household-currency rows only (ISSUE 28,
       second pass). Every ratio below divides rand by rand; what is held out is
       named on the page by otherCurrencies. */
    const foreign = foreignLabels();
    const homeRows = p => txInPeriod(p).filter(t => !foreign.has(t.label));
    /* ADR-0007 · The savings pool: savings and investment accounts, household
       currency only — the same boundary homeRows draws, so both legs of a
       transfer are seen. Type is case-folded inside poolAccounts. */
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
      /* ADR-0007 · Pool rows are household rows filtered by label. accountIndex's
         raw file rows carry no `label`, so a key built from one never matched. */
      const saverLabels = new Map();
      for (const a of savers) {
        for (const L of ((idx.get(a) || {}).labels || [])) { saverLabels.set(L, a); }
      }
      /* ISSUE 32 — catType, so a fund purchase can no longer be paired away
         as the leg of an internal move. */
      savings = savedFromOutside(householdRows, saverLabels, declaredCatType);
      /* ADR-0007 · Three spend slices per period, and one of them budget-scoped.
         essential / consumption / fixed are household-wide; consumptionBudget is
         budget-scoped and feeds "budget used" alone. */
      /* ADR-0005: the SAME numerator the Dashboard hero prints, so the ring's
         six-period average is an average of the figure the reader has already
         seen. This used to sum periodSpend()'s NET map with savings types
         dropped — refunds netted, uncategorised gone — and so differed from
         the hero even over a single counted period. */
      const consumptionBudget = budgetUsed(p).spent;
      /* ADR-0007 · The household walk is the HOUSEHOLD lens: every account, net
         then flip. Excluded and non-budget rows KEPT (R48,000 of essential spend
         was once divided by R8,000). Pinned by tests/ledger-lenses.test.cjs. */
      const h = tally(ledger(start, end), LENSES.HOUSEHOLD);
      const householdNet = h.byCat;
      const householdSpend = h.spendByCat;
      const consumption = h.consumption, fixed = h.fixed, income = h.netIncome;
      periods.push({
        income,
        essential: essentialTotal(householdSpend, catType, S.settings.nonessential_groups),
        savings, consumption, fixed, consumptionBudget,
        budgeted: budgetTotals(p).spend,
        /* ADR-0007 · A period counts if the household did anything in it. Read off
           householdNet, before the income/transfer drop and the sign flip. */
        counted: spend.count > 0 || Object.keys(householdNet).length > 0,
      });
    }

    /* ADR-0007 · Net worth and earmarks are measured on household-currency
       accounts, and the rest is named (ISSUE 28): a ratio over mixed currencies
       inverts the verdict — "0.0 months" printed where 6.7 was true. */
    const { primary: homeAccounts, others: scoreOthers } =
      splitByCurrency(impliedAccounts(), S.settings.currency);   // ISSUE 44 — one as-of across every net worth
    const earmarks = resolveEarmarks(homeAccounts);
    const target = S.settings.emergency_target_months || 6;
    /* Once, not per consumer: the score, the debt tile's own figure and the
       "this is costing you" line are the same monthly interest bill, and
       computing it separately is how two of them disagree after someone
       changes the filter in only one place. */
    const debtInterest = debtInterestMonthly(S.debts, S.settings.currency);

    /* ADR-0007 · Debt instalments: null when nothing states a payment, foreign
       debts held out. A blank Payment reads 0 upstream and would score full
       marks; a partial total moves toward the truth where null stays put. */
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
      /* ADR-0007 · otherCurrencies is ACCOUNTS ONLY — what homeRows removed from
         the RATIOS. A consumer stating a NET WORTH wants worthOtherCurrencies. */
      otherCurrencies: scoreOthers,
      /* ADR-0007 · The Score's net worth discloses every ledger it left out
         (ISSUE 56/57): accounts, assets, debts and receivables, one net per symbol. */
      worthOtherCurrencies: otherCurrencyNet(netWorthFull, scoreOthers),
      metrics, earmarks, target, debtInterest,
      hasFixed: fixedCats.size > 0,
      /* ADR-0007 · debtsRecorded reads the currency-filtered debts. False means the
         pillar's full marks are an ASSUMPTION, and the surfaces say so. */
      debtsRecorded: active.length > 0,
      breakdown: scoreBreakdown(metrics, target),
      /* Nothing honest to say: no fund to measure and nothing computable from
         history. A week-old vault gets no card rather than a row of dashes. */
      empty: !earmarks.any && !metrics.score,
    };
  }

  ctx.provide({ healthSnapshot });
};
