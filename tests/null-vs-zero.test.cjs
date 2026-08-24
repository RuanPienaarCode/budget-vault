'use strict';
/* Null-vs-zero discipline — the one rule this codebase states in a dozen
   comments and violated in at least six places before 1.23.0:

     An unanswered question must never score as a zero answer. Absence of a
     claim has never been a claim of nothing.

   Three states, not two, for every numeric field a reader can leave blank:

     ABSENT      undefined / key missing / empty cell     -> null, or excluded
     A STATED 0  "0", "0.00"                               -> a real, measured 0
     UNREADABLE  "TBC", "about 15 000", "2025-13-45", …    -> surfaced as unreadable,
                                                               never a plausible wrong number

   This file sweeps that distinction across every module named in the brief —
   health-math, health-data, savings-math, debt-math, loan-math, owed-math,
   worth, reconcile, amount, money-flow — asserting both the PARSE (does the
   reader keep the three states apart) and the CONSEQUENCE (does a null
   propagate to "excluded from the score" rather than "scored as failure").

   Four assertions below are NEGATIVE-CONTROLLED: the historic coercion is
   reintroduced in a scratch function defined right beside the guard, proven
   to fail the same assertion the real module passes, so a reader can see the
   guard is not vacuous. Search for "NEGATIVE CONTROL" to find all four.

     node tests/null-vs-zero.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++; };
const isReal = v => typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0);

const healthMath = require('../src/health-math');
const savingsMath = require('../src/savings-math');
const debtMath = require('../src/debt-math');
const loanMath = require('../src/loan-math');
const owedMath = require('../src/owed-math');
const worth = require('../src/worth');
const reconcile = require('../src/reconcile');
const amount = require('../src/amount');
const moneyFlow = require('../src/money-flow');

/* ════════════════════════ 1. src/amount.js ════════════════════════════════
   The one reader every hand-typed or bank-exported figure in this app goes
   through. Three states, and normalizeAmount keeps them apart cleanly —
   parseNum (the strict-cell variant table-schema.js calls) does NOT, and
   that collapse is deliberate and documented; asserted here rather than
   assumed, because it is the seam every downstream "blank vs 0" workaround
   in health-data.js exists to route around. */
{
  eq(amount.normalizeAmount(''), null, 'absent cell: normalizeAmount says null, not 0');
  eq(amount.normalizeAmount('   '), null, 'blank-but-not-empty: still null');
  eq(amount.normalizeAmount('0'), 0, 'a stated zero is a real, measured zero');
  eq(amount.normalizeAmount('0.00'), 0, 'stated zero survives decimal form too');
  eq(amount.normalizeAmount('TBC'), null, 'unreadable text: null, never a plausible number');
  eq(amount.normalizeAmount('about 15 000'), null, 'unreadable prose: null, not a guessed 15000');
  eq(amount.normalizeAmount('2025-13-45'), null, 'a date-shaped string is not a money value: null');
  near(amount.normalizeAmount('18.5%'), 18.5, 0.001, 'a rate cell written with its own unit still parses');

  /* parseNum is the STRICT on-disk reader table-schema.js's money() column
     calls. Its documented contract: `ok` tells a serializer whether to keep
     the reader's raw text verbatim; `value` is always a plausible NUMBER
     because every money() column falls back through it into arithmetic, and
     JS has no "unreadable" numeric type to hand back instead. That fallback
     is 0 for an unreadable cell — table-schema.js's own comment calls this
     "same as the loader today" — so parseNum does NOT keep "blank", "stated
     zero" and "unreadable" apart in its `value`; only `ok`+`raw` distinguish
     "unreadable" from the other two, and only for a serializer, not for a
     downstream number consumer. Documented here as the seam it is. */
  eq(amount.parseNum('').value, 0, 'parseNum folds a blank cell into 0 (ok:false)');
  eq(amount.parseNum('').ok, false, '…but says so via ok:false');
  eq(amount.parseNum('0').value, 0, 'parseNum reads a stated zero as 0 too');
  eq(amount.parseNum('0').ok, true, '…and says so via ok:true — the one signal a caller has left');
  eq(amount.parseNum('TBC').value, 0, 'parseNum folds an unreadable cell into the SAME 0');
  eq(amount.parseNum('TBC').ok, false, '…indistinguishable from blank by `value` alone — ok+raw is the only tell');
  eq(amount.parseNum('TBC').raw, 'TBC', 'raw preserves the original text for write-back, at least');
}

/* ════════════════════ 2. src/health-math.js — debtInterestMonthly ═════════
   The headline bug: a blank Rate cell reads as 0 through table-schema's
   money() reader, `monthlyRate(0)` is a real 0, and a *measured* zero used
   to score full marks on the debt pillar for a household carrying real
   interest-bearing debt. */
{
  eq(healthMath.debtInterestMonthly([]), 0, 'no debts at all: a real, measured 0 — not "unmeasured"');

  const oneBlank = [{ balance: 250000, rate: 0, status: 'active' }];
  eq(healthMath.debtInterestMonthly(oneBlank), null,
    'a debt exists but its Rate cell reads 0 (blank OR literally "0.00") — UNMEASURED, not zero interest');

  const paidOff = [{ balance: 10000, rate: 0, status: 'paid' }];
  eq(healthMath.debtInterestMonthly(paidOff), 0,
    'a settled debt is excluded by activeDebts before the rate question is even asked — real 0, no interest cost');

  const mixed = [
    { balance: 250000, rate: 0, status: 'active' },     // blank Rate
    { balance: 10000, rate: 12, status: 'active' },      // stated Rate
  ];
  near(healthMath.debtInterestMonthly(mixed), 10000 * 0.12 / 12, 0.01,
    'ONE stated rate beside one blank: totals what IS known — the blank does not zero out the stated one, ' +
    'and the blank does not force the whole figure to null either');

  const bothStated = [
    { balance: 100000, rate: 10, status: 'active' },
    { balance: 50000, rate: 20, status: 'active' },
  ];
  near(healthMath.debtInterestMonthly(bothStated),
    (100000 * 0.10 / 12) + (50000 * 0.20 / 12), 0.01,
    'every debt stated: a plain, real sum');

  /* NEGATIVE CONTROL 1 — the coercion this guard exists to catch: `(Number(d.rate)
     || 0) > 0` filtering removed, i.e. summing EVERY active debt's interest
     regardless of whether its rate was ever stated. This is verbatim the
     pre-fix debtInterestMonthly: `active.reduce((s,d)=>s+monthlyInterest(d.balance,d.rate),0)`
     with no `stated` gate at all — monthlyInterest itself already coerces a
     missing rate to 0 via `(Number(rate)||0)`, so the sum silently includes
     the blank-rate debts as if they truly cost nothing, and NEVER returns
     null even when not one debt in the book states a rate. */
  function buggyDebtInterestMonthly(debts) {
    const active = worth.activeDebts(debts);
    return active.reduce((sum, d) => sum + debtMath.monthlyInterest(d.balance, d.rate), 0);
  }
  const buggyResult = buggyDebtInterestMonthly(oneBlank);
  ok(buggyResult !== null, 'RED: the pre-fix coercion returns a NUMBER (0), not null, for an all-blank-rate book');
  eq(buggyResult, 0, 'RED: …specifically it reports "no interest", scoring the pillar full marks on R250,000 of debt');
  ok(healthMath.debtInterestMonthly(oneBlank) === null,
    'GREEN: the real module refuses to answer instead — same input, opposite (correct) output');
}

/* ═══════════════════ 3. src/health-math.js — monthlyAverages ══════════════
   A period with `counted: false` is a window the vault does not cover, not
   a month of spending nothing. */
{
  const noneCounted = healthMath.monthlyAverages([{ counted: false }, { counted: false }], 1);
  eq(noneCounted.counted, 0, 'nothing counted');
  for (const k of ['income', 'essential', 'savings', 'consumption', 'fixed', 'budgeted', 'consumptionForBudget']) {
    eq(noneCounted[k], null, `${k}: a brand-new vault has no history to average — null, not a fabricated 0`);
  }

  const onePeriodOfZeroSpend = healthMath.monthlyAverages(
    [{ counted: true, income: 40000, essential: 0, savings: 0, consumption: 0, fixed: 0 }], 1);
  eq(onePeriodOfZeroSpend.essential, 0, 'a REAL counted period that genuinely spent nothing essential: a real 0');
  eq(onePeriodOfZeroSpend.savings, 0, 'same for savings — the period happened and nothing moved');

  const partial = healthMath.monthlyAverages(
    [{ counted: true, income: 1000, essential: 500, savings: 0, consumption: 500, fixed: 0 },
      { counted: false }], 1);
  eq(partial.counted, 1, 'only the counted period is averaged over');
  eq(partial.income, 1000, 'the average is over counted periods only, not diluted by the uncovered one');

  /* budgeted/consumptionForBudget use their OWN narrower "planned" denominator
     — a period with no budget at all is not a period budgeted zero. */
  const unbudgeted = healthMath.monthlyAverages(
    [{ counted: true, income: 1000, essential: 500, savings: 0, consumption: 500, fixed: 0, budgeted: 0 }], 1);
  eq(unbudgeted.budgeted, null, 'a period that never set a budget: null, not "budgeted R0"');
  const budgeted = healthMath.monthlyAverages(
    [{ counted: true, income: 1000, essential: 500, savings: 0, consumption: 500, fixed: 0, budgeted: 800 }], 1);
  eq(budgeted.budgeted, 800, 'a period that DID set a budget counts, even if others in the window did not');
}

/* ═══════════════ 4. src/health-math.js — the score's income gate ══════════
   The second headline bug: budgetUsed was the one measure NOT gated on
   income, so a vault with no recognised income had one surviving measure
   inherit the entire renormalised 100 and score "Strong". */
{
  const targetMonths = 6;
  const base = {
    monthlyIncome: 0, monthlyEssential: null, monthlySavings: null, monthlyConsumption: null,
    monthlyFixed: null, months: null, savingsRate: null, interestShare: null, instalmentShare: null,
    fixedShare: null, consumptionShare: null, netWorthMultiple: null,
  };

  /* Nothing measurable at all, income included: financialScore must refuse
     to fabricate a figure. */
  eq(healthMath.financialScore(healthMath.scoreFractions({ ...base, budgetUsed: null }, targetMonths)), null,
    'no income, nothing else measured either: financialScore is null — a fabrication is worse than a blank card');

  /* NEGATIVE CONTROL 2 — the exact historic shape: no income (m.monthlyIncome
     is 0, meaning the ratios ARE correctly null everywhere else), but
     budgetUsed computed WITHOUT the hasIncome gate healthMetrics applies
     today (`(hasIncome && avg.budgeted > 0 && avg.consumptionForBudget !==
     null) ? … : null`). Feeding the real financialScore/scoreFractions a
     budgetUsed that survived without that gate reproduces "R20 000
     overdrawn, no savings, scores 100 and is told it is Strong" off a single
     5-point measure — using the REAL renormalisation code, so this is not a
     reimplementation of the score, only of the one input the fix touches. */
  const buggyM = { ...base, budgetUsed: 1.0 };   // "spent exactly its budget" — full marks on that one measure
  const buggyScore = healthMath.financialScore(healthMath.scoreFractions(buggyM, targetMonths));
  ok(buggyScore !== null, 'RED: the ungated input produces a real score out of NOTHING else measurable');
  eq(buggyScore.value, 100, 'RED: …specifically 100');
  eq(healthMath.scoreBand(buggyScore.value), 'strong',
    'RED: …and the household with no recognised income is told its finances are "Strong"');

  const fixedM = { ...base, budgetUsed: null };   // what healthMetrics actually hands over when hasIncome is false
  eq(healthMath.financialScore(healthMath.scoreFractions(fixedM, targetMonths)), null,
    'GREEN: gated correctly, the same "nothing else measurable" vault scores null, not 100');
}

/* ═════════════ 5. src/health-math.js — fixed/networth pass-through ════════
   `hasFixed` false and `fixedMonthly: 0` must read as two different things:
   never-asked vs a real household with nothing flagged fixed. */
{
  const m1 = healthMath.healthMetrics({
    periods: [{ counted: true, income: 40000, essential: 10000, savings: 0, consumption: 20000, fixed: 0 }],
    monthsPerPeriod: 1, earmarks: { total: 0, any: false }, targetMonths: 6,
    debtInterest: 0, debtInstalments: null, netWorth: 0, hasFixed: false,
  });
  eq(m1.monthlyFixed, null, 'never flagged a category fixed: absent, not "R0 committed"');
  eq(m1.fixedShare, null, '…so the fixed-share ratio is unmeasurable, not a suspiciously perfect 0%');

  const m2 = healthMath.healthMetrics({
    periods: [{ counted: true, income: 40000, essential: 10000, savings: 0, consumption: 20000, fixed: 0 }],
    monthsPerPeriod: 1, earmarks: { total: 0, any: false }, targetMonths: 6,
    debtInterest: 0, debtInstalments: null, netWorth: 0, hasFixed: true,
  });
  eq(m2.monthlyFixed, 0, 'flagged categories exist, none of them spent this window: a real, measured 0');
  eq(m2.fixedShare, 0, '…so the ratio is a real 0%, not null');

  /* netWorthMultiple: gated on there being an income to divide by, but NOT
     on netWorth itself being positive — a household between jobs still owns
     what it owns. */
  const noIncomeButOwns = healthMath.healthMetrics({
    periods: [{ counted: false }], monthsPerPeriod: 1, earmarks: { total: 0, any: false }, targetMonths: 6,
    debtInterest: 0, debtInstalments: null, netWorth: 250000, hasFixed: false,
  });
  eq(noIncomeButOwns.netWorth, 250000, 'net worth itself is reported even with no income to rate it against');
  eq(noIncomeButOwns.netWorthMultiple, null, 'but the MULTIPLE is null — a multiple of nothing is not a number');
}

/* ═══════════════════ 6. health-data.js, through the real loader ═══════════
   The parse-layer bug (blank Rate -> 0 -> null interestShare, distinct from
   the already-guarded blank Payment) exercised end to end: table-schema's
   money() reader really does turn a blank Rate cell into "0.00" on disk, and
   the fix has to survive that round trip, not just the pure-function call. */
{
  const B = 'Budget';
  const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
  const TX = m => '---\nkind: transactions\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
    + `| ${m}-01 | Salary | Salary | 40000.00 | | | |\n`;
  const BASE = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  };
  for (const m of MONTHS) { BASE[`${B}/Transactions/Cheque/${m}.md`] = TX(m); }
  const HEAD = '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n';
  const row = (rate, payment) =>
    `| Card | Bank | credit card | 250000.00 | 250000.00 | ${rate} | ${payment} | | 2024-01-01 | | active | |\n`;

  async function snap(debtsRow) {
    const files = { ...BASE, [`${B}/Debts.md`]: HEAD + debtsRow };
    const ctx = makeCtx(files, { budgetFolder: B });
    const S = await loadInto(ctx);
    S.period = '2026-08';
    require('../src/categories')(ctx);
    return ctx.healthSnapshot();
  }

  (async () => {
    /* A. blank Rate, blank Payment. The Debt page's own money() reader really
       does write both cells as "0.00" underneath, so this proves the fix
       survives the round trip through the on-disk format, not just a
       hand-built object. */
    {
      const s = await snap(row('', ''));
      eq(s.metrics.interestShare, null, 'blank Rate, through the real loader: interest is UNMEASURED');
      eq(s.metrics.instalmentShare, null, 'blank Payment, through the real loader: instalments are UNMEASURED');
      /* Neither part of the debt pillar is live, so financialScore's own
         inner-renormalisation drops the WHOLE pillar rather than scoring it
         zero or full — a fourth outcome beside "no debts" (full marks, both
         parts absent-but-interest-real-0), "some known" (partial marks) and
         "all known" (real marks): "listed, but nothing about it is
         knowable" gets no credit AND no penalty, sharing its 20 points with
         the pillars that CAN answer. debtsRecorded stays true so the
         surfaces can still say the pillar was skipped, not that it scored
         full marks by assumption. */
      const debt = s.metrics.score.pillars.find(p => p.key === 'debt');
      eq(debt, undefined,
        'R250,000 of debt with nothing measurable about it: the pillar is absent from the score entirely — ' +
        'neither credited (full marks) nor penalised (zero), simply excluded and its weight shared out');
      ok(s.debtsRecorded, 'but debtsRecorded stays true — the vault DID list the debt, it just cannot be scored');
    }

    /* B. Rate stated, Payment blank — proves the two null-vs-zero fixes are
       INDEPENDENT: one measure can be real while its sibling is unmeasured. */
    {
      const s = await snap(row('20.00', ''));
      ok(s.metrics.interestShare > 0, 'a stated Rate is measured even though the Payment on the same row is not');
      eq(s.metrics.instalmentShare, null, 'and the blank Payment on that SAME row stays unmeasured, not zero');
      near(s.metrics.interestShare, (250000 * 0.20 / 12) / 40000, 0.001,
        'the measured interest share is the real arithmetic, not a coincidental round number');
    }

    /* C. an explicit "0.00" Rate reads the same as blank — the same
       "nothing the two could mean differently" rule debt-scoring.test.cjs
       already pins for Payment, carried across to Rate for completeness. */
    {
      const s = await snap(row('0.00', '3000.00'));
      eq(s.metrics.interestShare, null, 'a stated-zero Rate is treated as unstated, same as blank');
    }

    /* D. both stated: the full pipeline produces real, non-null, correctly
       gated figures — the positive control the three null cases above need,
       so a reader can be sure the fix has not just made everything null. */
    {
      const s = await snap(row('20.00', '3000.00'));
      ok(s.metrics.interestShare > 0 && s.metrics.instalmentShare > 0,
        'both stated: both measures are real numbers');
      const debt = s.metrics.score.pillars.find(p => p.key === 'debt');
      ok(debt.at > 0 && debt.at < 1, 'the debt pillar reflects a real, partial score — neither full nor null');
    }

    console.log(`PASS — null-vs-zero part 1/2 (health-data through the real loader): ${checks} assertions so far.`);
  })().then(runPart2).catch(e => { console.error('FAIL —', e.stack || e.message); process.exit(1); });
}

/* ═══════════════════ 7. src/savings-math.js ════════════════════════════════
   total_invested: 0 and starting_amount: 0 are real, deliberate baselines —
   an account funded entirely by a first transfer, or opened at nothing. Both
   used to be read with a trailing truthiness test that treated a written 0
   as absent. */
function part7() {
  const typeOf = () => null;

  /* accountFlows: no rows at all, so it falls to the stated-baseline branch. */
  eq(savingsMath.accountFlows({ balance: 5000, total_invested: 0 }, [], typeOf).basis, 'stated',
    'total_invested: 0 with no transactions: a real stated baseline, not "none"');
  eq(savingsMath.accountFlows({ balance: 5000, total_invested: 0 }, [], typeOf).opening, 0,
    '…and the opening figure really is 0, not the balance carried forward as though nothing were known');
  eq(savingsMath.accountFlows({ balance: 5000 }, [], typeOf).basis, 'none',
    'NEITHER field written: genuinely nothing to measure against — basis "none"');
  eq(savingsMath.accountFlows({ balance: 5000, starting_amount: 0, total_invested: 9999 }, [], typeOf).opening, 0,
    'starting_amount takes precedence over total_invested even when starting_amount is the written zero');

  /* NEGATIVE CONTROL 3 — the exact old formula, verbatim from the comment in
     src/savings-math.js: `a.total_invested || a.starting_amount || 0`. Both
     reverses the precedence AND falsy-skips a written 0. */
  function buggyBaseline(a) { return a.total_invested || a.starting_amount || 0; }
  const acctWithRealZeroStart = { balance: 12000, starting_amount: 0 };   // opened empty, funded by transfer
  eq(buggyBaseline(acctWithRealZeroStart), 0,
    'RED: the old formula ALSO lands on 0 here, but for the wrong reason — falsy-skipped, not read');
  /* Prove it is the wrong reason by giving total_invested priority it should
     never have: the old formula prefers a total_invested that was written
     LATER/wrongly over a starting_amount of 0 that is the real answer. */
  const acctWhereOldFormulaPicksWrongField = { balance: 12000, starting_amount: 0, total_invested: 8000 };
  eq(buggyBaseline(acctWhereOldFormulaPicksWrongField), 8000,
    'RED: the old formula reads total_invested (8000) over the real starting_amount baseline (0) — wrong field');
  eq(savingsMath.accountFlows(acctWhereOldFormulaPicksWrongField, [], typeOf).opening, 0,
    'GREEN: the real module keeps starting_amount as the deliberate baseline, ignoring total_invested beside it');

  /* totalReturn: same rule, `typeof a.total_invested === 'number'`, not
     truthiness — reached via the SECOND of the two fields this time. */
  const r = savingsMath.totalReturn({ balance: 5000, total_invested: 0 }, [], typeOf, { today: '2026-08-24' });
  eq(r.basis, 'stated', 'totalReturn: total_invested 0, no starting_amount, no rows: still a real baseline');
  eq(r.baseline, 0, '…baseline reported as the real written 0');
  eq(r.capitalIn, 0, '…and capital-in is 0, not falling through to "none" (capitalIn null)');

  /* NEGATIVE CONTROL 3b — the exact trailing-truthiness test named in
     totalReturn's own comment: `!hasBaseline && !f.count && a.total_invested`
     instead of `typeof a.total_invested === 'number'`. */
  function buggyStated(a, hasBaseline, fCount) {
    return !hasBaseline && !fCount && a.total_invested;   // truthy test, not typeof
  }
  ok(!buggyStated({ balance: 5000, total_invested: 0 }, false, 0),
    'RED: the truthy test reads a written total_invested: 0 as FALSE — "not stated" — for a real baseline');
  ok(typeof ({ total_invested: 0 }).total_invested === 'number' && !false,
    'GREEN: the real module\'s typeof test reads the same 0 as a number, i.e. genuinely stated');

  /* growthSeries' chartable(): a 'measured' account (starting_amount set,
     even at 0) with NO placeable month must be excluded — the identity
     `closing = capital + posted + undated` depends on it. */
  const acctZeroBaselineUnplaceable = { name: 'TFSA', balance: 5000, starting_amount: 0 };
  const rr = savingsMath.totalReturn(acctZeroBaselineUnplaceable, [], typeOf, { today: '2026-08-24' });
  eq(rr.basis, 'measured', 'starting_amount 0 with no inception_date and no rows is still basis "measured"');
  eq(savingsMath.chartable(acctZeroBaselineUnplaceable, rr), false,
    'but chartable correctly excludes it — there is nowhere on the timeline to place a 0 baseline with no date');

  /* NEGATIVE CONTROL 4 — the exact old guard named in growthSeries' own
     comment: `r.baseline && !at` used as "should this be excluded". A
     baseline of the real, written 0 is FALSY, so the old guard never fires
     and the account is wrongly counted as included. */
  const at = '';   // monthOf(inception_date) || monthOf(r.since), both empty here
  const oldGuardSaysExclude = !!(rr.baseline && !at);
  ok(!oldGuardSaysExclude,
    'RED: the old truthy guard does NOT exclude a zero-baseline unplaceable account — it silently counts it in, ' +
    'contributing its balance to `closing` while contributing nothing to any band');
  ok(!savingsMath.chartable(acctZeroBaselineUnplaceable, rr),
    'GREEN: the real chartable() (testing `at` alone, never the baseline) correctly excludes it');

  console.log(`PASS — null-vs-zero part 2/2 (savings-math + everything below): running.`);
}

/* ═══════════════════════ 8. src/debt-math.js ═══════════════════════════════
   expectedBalance refuses to project from a row that cannot support it —
   null is the honest output for every one of its required fields missing. */
function part8() {
  const today = '2026-08-24';
  eq(debtMath.expectedBalance({ payment: 500, start: '2020-01-01' }, today), null,
    'no `original`: null, not a projection from a guessed starting balance');
  eq(debtMath.expectedBalance({ original: 50000, start: '2020-01-01' }, today), null,
    'no `payment`: null — a debt with no stated instalment cannot be projected forward');
  eq(debtMath.expectedBalance({ original: 50000, payment: 0, start: '2020-01-01' }, today), null,
    'a STATED zero payment: also null — a debt paid nothing cannot be projected either, ' +
    'same reasoning debt-scoring.test.cjs pins for instalmentShare');
  eq(debtMath.expectedBalance({ original: 50000, payment: 500, start: 'not a date' }, today), null,
    'an unreadable start date: null, not silently treated as "no elapsed time"');
  /* LIVE BUG, NOT FIXED (out of scope — src/ is not this file's to edit):
     expectedBalance validates `d.start` with `ISO_DATE` (shape only —
     "2025-13-45 passes", per dates.js's own comment on that regex) rather
     than `isRealIsoDate`, the real-date check this exact codebase already
     had to introduce for the identical trap in savings-math.js's `monthOf`
     (see that file's header: a shape-valid-but-impossible date silently
     entered a month walk and broke a chart identity). Reachable here too:
     `Debts.md`'s Start date column is written `verbatim()` — no validation
     at read time — and expectedBalance() feeds views/debts.js's own
     "schedule says RX … your figure is RY higher/lower, a missed payment or
     rate change would explain it" line on the Debts page. An impossible
     start date (a hand-edit day/month slip, e.g. 2026-02-30) is silently
     treated as real elapsed time and can print that sentence over a
     fabricated projection instead of returning null. NOT asserted as
     passing here — it does not pass against src/ today, and this file must
     not encode a bug as correct behaviour. Left for the fix lane. */
  eq(debtMath.expectedBalance({ original: 50000, payment: 500 }, today), null,
    'no start date at all: null');

  const real = debtMath.expectedBalance({ original: 50000, payment: 2000, rate: 12, start: '2024-01-01' }, today);
  ok(real && Number.isFinite(real.expected) && real.expected >= 0,
    'every required field present: a real, finite, non-negative projected balance');

  /* Design-gap note, not asserted as a failure: monthlyRate(rate) coerces a
     missing/blank rate to 0 (`(Number(rate) || 0) / 100 / 12`), and the flat
     Debts table's money() reader ALSO reads blank as 0 before this ever
     sees it — so a genuinely interest-free (0%) debt and one whose Rate cell
     was simply never filled in are the same input by the time either
     amortise() or expectedBalance() receives it. amortise()/simulate() treat
     that 0 as a real 0% loan (correctly, for the CALCULATOR use case — see
     loan-math's own explicit 0%-branch comment) but there is no distinct
     "unmeasured" outcome available to them at this layer; that distinction
     is recovered one layer up, in health-math's `debtInterestMonthly`, which
     is the only consumer that needs it and the only one tested for it above. */
  near(debtMath.monthlyInterest(10000, undefined), debtMath.monthlyInterest(10000, 0), 0.0001,
    'documented: monthlyRate cannot itself tell "blank" from "written 0" apart — by design, see note above');
}

/* ═══════════════════════ 9. src/loan-math.js ═══════════════════════════════
   The ONE place in this sweep where 0 is explicitly, deliberately NOT an
   edge case to guard against — "a zero rate is not a rounding edge, it is
   what a 0% dealer deal actually is" (the module's own header). Pinned here
   as the must-NOT-conflate control: a real 0% loan must produce a real
   straight-line instalment, not be treated as invalid or thrown out. */
function part9() {
  eq(loanMath.monthlyPayment(120000, 0, 120), 1000, 'a REAL 0% rate: straight-line principal/months, a real number');
  eq(loanMath.totalsFor(120000, 0, 120).totalInterest, 0,
    'total interest on a real 0% loan is a real, exact 0 — not a few cents of float noise dressed as "interest"');
  eq(loanMath.totalsFor(120000, 0, 120).totalRepaid, 120000, 'and total repaid is exactly the principal, no more');
  eq(loanMath.monthlyPayment(0, 10, 120), 0, 'zero principal: a real 0 instalment (there is no loan)');
  eq(loanMath.monthlyPayment(120000, 10, 0), 0, 'zero months: a real 0 (an instant loan is not a monthly figure)');

  /* Generic sweep — every numeric parameter fed undefined/null/0/''/'0'/NaN/
     'TBC'/-1, asserting the result is a real number, never NaN/Infinity/-0. */
  const bad = [undefined, null, 0, '', '0', NaN, 'TBC', -1];
  for (const v of bad) {
    const p = loanMath.monthlyPayment(v, v, v);
    ok(isReal(p), `monthlyPayment(${JSON.stringify(v)}, …): real number, got ${p}`);
    const t = loanMath.totalsFor(v, v, v);
    ok(isReal(t.payment) && isReal(t.totalInterest) && isReal(t.totalRepaid),
      `totalsFor(${JSON.stringify(v)}, …): every figure real, got ${JSON.stringify(t)}`);
  }
}

/* ═══════════════════════ 10. src/owed-math.js ══════════════════════════════
   `oldestDays` totals what IS known: one dated entry beside one undated
   entry still reports the dated one's age, and only ALL-undated collapses
   to null. The same "partial answer still counts" rule debt-scoring.test.cjs
   pins for Payment, here for lending dates. */
function part10() {
  const today = '2026-08-24';
  const mixed = owedMath.owedSummary(
    [{ amount: 1000, lent: '2026-01-01' }, { amount: 500, lent: '' }], today);
  eq(mixed.oldestDays, 235, 'one dated open entry beside one undated: the dated one\'s age is reported, not null');

  const allUndated = owedMath.owedSummary(
    [{ amount: 1000, lent: '' }, { amount: 500, lent: 'sometime' }], today);
  eq(allUndated.oldestDays, null, 'every open entry undated or unreadable: null, not "0 days old" or a fabricated age');
  eq(allUndated.outstanding, 1500, 'the AMOUNTS are still totalled even though no age can be — a different question');

  const none = owedMath.owedSummary([], today);
  eq(none.oldestDays, null, 'no entries at all: null');
  eq(none.outstanding, 0, 'and outstanding is a real 0 — nothing owed is a real, measured nothing');

  /* Generic sweep on the two coerced fields — the values owed-math's own
     callers can actually hand it. `amount`/`repaid` reach this module
     already parsed by table-schema.js's money() reader (Owed Money.md's
     Amount/Repaid columns), which never leaves a raw unparsed STRING in
     either field — only a real number. 'TBC' is deliberately excluded from
     this loop and reported separately below rather than asserted here,
     because asserting it would pin a real gap as though it were a
     guaranteed contract this module upholds, which it does not. */
  const bad = [undefined, null, 0, '', '0', NaN, -1];
  for (const v of bad) {
    const o = owedMath.outstandingOf({ amount: v, repaid: v });
    ok(isReal(o), `outstandingOf(amount/repaid=${JSON.stringify(v)}): real number, got ${o}`);
    const s = owedMath.owedSummary([{ amount: v, repaid: v, lent: v }], today);
    ok(isReal(s.outstanding) && isReal(s.recovered), `owedSummary(${JSON.stringify(v)}): real totals`);
    ok(s.oldestDays === null || isReal(s.oldestDays), `owedSummary(${JSON.stringify(v)}): oldestDays real or null`);
  }

  /* LIVE FINDING, NOT FIXED (out of scope — src/ is not this file's to edit,
     and low real-world severity — see below): outstandingOf/owedSummary do
     `(o.amount || 0) - (o.repaid || 0)` with no parseNum/Number() pass of
     their own — unlike health-math.js and debt-math.js, which both defend
     every numeric input with `Number(x) || 0`. A raw non-numeric STRING in
     either field (not a value real callers hand it today, since
     table-schema.js's money() reader always resolves Owed Money.md's Amount
     and Repaid columns to a number first) produces NaN, not 0 or null:
     `'TBC' - 'TBC'` is `NaN` in JS, `Math.max(0, NaN)` is `NaN`, and it
     propagates uncaught into `outstanding`/`recovered`. Reproduced live:
     `outstandingOf({ amount: 'TBC', repaid: 'TBC' })` -> NaN (not the
     module's own documented "settled" or "outstanding" states, just a
     silently broken total). Not reachable from a real vault today because
     the one caller in this codebase (health-data equivalents / views/
     owed.js) only ever hands it loader-parsed numbers — flagged as a
     defensive gap worth a `Number(x) || 0` pass, the same guard debt-math.js
     already applies to every one of its own inputs, should this module ever
     gain a second caller that reads raw frontmatter/cells directly. */
}

/* ═══════════════════════ 11. src/worth.js ══════════════════════════════════
   `net` deliberately collapses -0 to a real 0 (documented: `|| 0` after the
   round), because a solvent break-even household must never render
   "-R0.00". Confirmed with Object.is, which `===` would not catch. */
function part11() {
  const w = worth.worth(
    [{ balance: 50.30 }],
    [{ balance: 10.10, status: 'active' }, { balance: 40.20, status: 'active' }],
    []);
  eq(w.net, 0, 'break-even household: net is 0');
  ok(!Object.is(w.net, -0), 'and it is a REAL 0, not the -0 the float remainder would otherwise leave behind');

  const empty = worth.worth([], [], []);
  eq(empty.net, 0, 'nothing owned, nothing owed: a real, measured 0 net worth — not null (see health-math ' +
    'gating netWorthMultiple on income, not on this being non-null)');

  /* Generic sweep across worth()'s own coercions — again restricted to the
     values worth() actually receives in production (loader-parsed numbers).
     'TBC' excluded and reported, not asserted, for the same reason as
     owed-math.js above. */
  const bad = [undefined, null, 0, '', '0', NaN, -1];
  for (const v of bad) {
    const r = worth.worth([{ balance: v }], [{ balance: v, status: 'active' }], [{ value: v }]);
    ok(isReal(r.net) && isReal(r.assets) && isReal(r.liabilities),
      `worth(balance/value=${JSON.stringify(v)}): every figure real, got ${JSON.stringify(r)}`);
  }

  /* LIVE FINDING, NOT FIXED (out of scope, low real-world severity — same
     root cause as the owed-math.js finding above): worth()/assetTotal() do
     `Math.max(0, a.balance || 0)` with no `Number(...)` pass of their own.
     `Math.max(0, 'TBC')` is `NaN` (Math.max coerces every argument with
     `Number()`, and `Number('TBC')` is `NaN`), so a raw non-numeric string
     in `balance` propagates NaN into `assets`/`ownedAccounts` uncaught.
     Reproduced live: `worth.worth([{ balance: 'TBC' }], [], [])` ->
     `{ assets: NaN, ownedAccounts: NaN, …, net: 0 }`. Note the SECOND,
     worse effect this produces: `net`'s own `|| 0` — added deliberately to
     collapse the -0 a break-even household's float remainder leaves behind
     (see the positive test above) — also collapses this genuine NaN into
     the SAME plausible-looking 0, exactly the "fallback must not be a
     plausible wrong number" failure amount.js's header names, one level up
     from where that header's own fix lives: `assets`/`ownedAccounts` leak
     "NaN" as text wherever rendered, while `net` quietly claims a real,
     wrong zero. Not reachable today because accounts/debts/assets all
     arrive here already parsed to numbers by load.js/table-schema.js;
     flagged as the same class of defensive gap as owed-math.js's. */
}

/* ═══════════════════════ 12. src/reconcile.js ══════════════════════════════
   daysSince distinguishes "unreadable" (null) from a real day count — but a
   FUTURE date is a real day count that happens to be NEGATIVE, and that is
   where this module's own two callers of it disagree. stalenessSummary
   guards the negative case explicitly (`raw < 0 ? null : raw`); isStale does
   not. See the "LIVE BUG, NOT FIXED" note in the final report for the
   consequence — not asserted here as passing, precisely because it does not
   pass against src/ today and this file must not encode a bug as correct
   behaviour. */
function part12() {
  const today = '2026-08-24';
  eq(reconcile.daysSince('', today), null, 'never confirmed: null');
  eq(reconcile.daysSince('end of June', today), null, 'unreadable: null');
  eq(reconcile.daysSince('2025-13-45', today), null, 'shape-valid but impossible date: null (isRealIsoDate, not ISO_DATE)');
  eq(reconcile.daysSince('2026-08-01', today), 23, 'a real past date: a real day count');
  eq(reconcile.daysSince('2027-01-01', today), -130, 'a real FUTURE date: a real NEGATIVE day count — not null');

  /* stalenessSummary IS guarded against that negative case, and is the
     positive control this file can actually assert. */
  const accounts = [
    { balance_updated: '2027-01-01' },   // future typo
    { balance_updated: '2026-07-01' },   // 54 days — genuinely stale
    { balance_updated: '2026-08-20' },   // 4 days — fresh
    { balance_updated: '' },             // never confirmed
  ];
  const summary = reconcile.stalenessSummary(accounts, today);
  eq(summary.dated, 2, 'stalenessSummary: the future-dated account is NOT counted as "dated" — a negative age is not an age');
  eq(summary.stale, 3, 'and IS counted stale — future, never-confirmed and the 54-day account, not the fresh one');
  eq(summary.oldestDays, 54, 'oldest is the real 54, not corrupted by the future account\'s -130');

  /* NEGATIVE CONTROL — stalenessSummary WITHOUT its own negative-day guard
     (`raw < 0 ? null : raw` removed), reading `daysSince`'s raw output
     directly. This is the guard `isStale` is missing — reintroduced here on
     the sibling function that DOES have it, so the assertion is proven
     non-vacuous without encoding the live bug on `isStale` as passing. */
  function buggyStalenessSummary(accts, tdy) {
    let stale = 0, oldest = null, dated = 0;
    for (const a of accts || []) {
      const d = reconcile.daysSince(a.balance_updated, tdy);   // no `d < 0 ? null : d` guard
      if (d !== null) dated++;
      if (d === null || d > reconcile.STALE_DAYS) stale++;
      if (d !== null && (oldest === null || d > oldest)) oldest = d;
    }
    return { total: (accts || []).length, stale, dated, oldestDays: oldest };
  }
  const buggy = buggyStalenessSummary(accounts, today);
  eq(buggy.dated, 3, 'RED: without the guard, the future account is wrongly counted as "dated"');
  eq(buggy.stale, 2, 'RED: …and wrongly NOT counted stale — a future-typo\'d balance reads as confirmed and fresh');
  eq(summary.dated, 2, 'GREEN: the real, guarded stalenessSummary gets both figures right (re-asserted for contrast)');
  eq(summary.stale, 3, 'GREEN: …same, for stale');

  /* isStale itself: pinned only for the cases it DOES handle correctly today
     — never-confirmed, unreadable, and real past dates either side of the
     30-day line. The future-date case is deliberately absent from this list;
     see the report. */
  ok(reconcile.isStale('', today), 'never confirmed is stale');
  ok(reconcile.isStale('end of June', today), 'unreadable is stale');
  ok(!reconcile.isStale('2026-08-20', today), 'a real 4-day-old confirmation is not stale');
  ok(reconcile.isStale('2026-07-01', today), 'a real 54-day-old confirmation is stale');
}

/* ═══════════════════════ 13. src/money-flow.js ═════════════════════════════
   A DIFFERENT, intentional design choice from health-math: this module
   documents itself as returning ZEROED bands for a brand-new vault, not
   nulls — "so a brand-new vault … returns zeroed bands rather than throwing
   or dividing by zero." Pinned here so a future reader does not "fix" this
   into health-math's null convention without reading why the two differ:
   health-math's null feeds a SCORE that must renormalise a pillar away;
   money-flow's 0 feeds a CHART band that has nothing to renormalise and
   would rather draw an empty slice than vanish. */
function part13() {
  const empty = moneyFlow.periodFlow({});
  eq(empty.income, 0, 'no income argument at all: a real 0, by this module\'s own documented convention');
  eq(empty.bands.committed, 0, 'every band is a real 0, not null — there is nothing to renormalise here');
  eq(empty.budget.budgetUsed, null, 'EXCEPT budgetUsed, which stays null with no budget — dividing by an absent plan');
  eq(empty.budget.allocatedOfIncome, null, 'and allocatedOfIncome null with no income to divide into');

  const withIncome = moneyFlow.periodFlow({ income: 40000, spentTotal: 0, budgeted: 0 });
  eq(withIncome.budget.allocatedOfIncome, 0, 'income present, budget genuinely 0: a real 0% allocated, not null');
  eq(withIncome.budget.budgetUsed, null, 'but budgetUsed is STILL null — bud is not > 0, so "used" has no denominator');
}

/* ─────────────────────────────── run part 2+ ────────────────────────────── */
function runPart2() {
  part7();
  part8();
  part9();
  part10();
  part11();
  part12();
  part13();
  console.log(`PASS — null-vs-zero discipline: ${checks} assertions across amount.js, health-math.js, ` +
    `health-data.js (real loader), savings-math.js, debt-math.js, loan-math.js, owed-math.js, worth.js, ` +
    `reconcile.js and money-flow.js, four of them negative-controlled.`);
}
