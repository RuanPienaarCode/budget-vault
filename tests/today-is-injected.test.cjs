'use strict';
/* THE CLOCK IS AN ARGUMENT, NOT AN AMBIENT FACT.

   CLAUDE.md states this codebase's rule plainly — "`today` injected rather
   than read off the clock, so it runs in bare node under a guard test" — and
   src/committed.js honours it: whatsLeft, serviceCommitments and
   debtCommitments all take `today` from the caller.

   periodSummary() did not. When it gained its as-of boundary it read
   todayIso() directly, and movedToFunds() and impliedAccounts() followed. The
   cost was invisible because every test written around that boundary worked
   around it the same way: monkeypatching the GLOBAL Date constructor
   (`atAuditDate` in tests/_audit-seed.cjs, which says so in its own comment —
   "currentPeriod() and todayIso() both read `new Date()`"). Faking the clock
   proves the arithmetic and never the seam, and there was no seam to prove.

   THIS FILE PATCHES NOTHING. It is the negative control on every other test in
   the audit suite: if `today` ever stops being an argument, every assertion
   below collapses to whatever day it happens to be run on, and the file goes
   red on a real calendar rather than passing on a faked one.

   WHAT IS PINNED

     1. The boundary MOVES with the argument — the same vault read on three
        different days gives three different, correct answers.
     2. The default is still the clock, so no existing caller changed.
     3. A junk or absent argument falls back to the clock rather than being
        parsed into a wrong date.
     4. movedToFunds and impliedAccounts take it too, since both carry an
        as-of and both were reading the clock.

     node tests/today-is-injected.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { SEED, PERIOD } = require('./_audit-seed.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* No atAuditDate, no global Date override, deliberately. */
(async () => {
  const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;

  /* ---- 1. the boundary moves with the argument ---- */
  /* September's ledger, read on three different days. The rows are fixed; only
     the day changes. Salary and the medical debit land on the 1st, Checkers on
     the 2nd, the gym on the 3rd/10th/17th/24th, Woolworths on the 12th, and a
     R5 000 family gift on the 28th. */
  const on = d => ctx.periodSummary(PERIOD, d);

  const d1 = on('2026-09-01');
  eq(d1.asOf, '2026-09-01', 'read on the 1st, the window closes on the 1st');
  eq(d1.income, 35000, 'the salary has landed');
  eq(d1.spend, 3500, 'and only the medical debit has gone out');
  /* 1 200 Checkers + 4 x 250 gym + 890 Woolworths. NOT the R5 000 pram: that
     left an earmarked fund and is reported as `fundedFromSavings`, on every
     one of these readings, whatever the day. */
  eq(d1.scheduled.spend, 3090, 'everything else is still ahead');
  eq(d1.fundedFromSavings.spend, 5000, 'and the fund purchase is named on every reading');

  const d2 = on('2026-09-02');
  eq(d2.spend, 4700, 'a day later the Checkers shop is in');
  ok(d2.spend > d1.spend, 'the figure moved because the DAY moved, not because the ledger did');

  const d20 = on('2026-09-20');
  eq(d20.income, 35000, 'on the 20th the late gift is still ahead');
  eq(d20.scheduled.income, 5000, 'and still disclosed');
  eq(d20.spend, 6340, 'while three gym charges and Woolworths have now gone');

  const d30 = on('2026-09-30');
  eq(d30.scheduled, { income: 0, spend: 0, count: 0, from: null },
    'on the last day nothing is ahead, and the period reads whole');
  eq(d30.income + 0, 40000, 'the gift is income by then');
  eq(d1.spend + d1.scheduled.spend, d30.spend,
    'and every reading of the same period accounts for the same money — only the boundary moved');

  /* ---- 2. the default is still the clock ---- */
  {
    const bare = ctx.periodSummary(PERIOD);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(bare.asOf),
      'called with no argument it still answers, off the real day');
  }

  /* ---- 3. junk falls back rather than being parsed ---- */
  {
    const junk = ctx.periodSummary(PERIOD, 'yesterday please');
    const bare = ctx.periodSummary(PERIOD);
    eq(junk.asOf, bare.asOf,
      'an unparseable date is not a date — it falls back to the clock rather than to some coerced day');
    eq(ctx.periodSummary(PERIOD, '').asOf, bare.asOf, 'and so does an empty string');
  }

  /* ---- 4. the other two as-of functions take it as well ---- */
  {
    eq(ctx.movedToFunds(PERIOD, '2026-08-31'), 0,
      'nothing had moved into the funds before September');
    eq(ctx.movedToFunds(PERIOD, '2026-09-02'), 2000,
      'and R2 000 had by the 2nd — driven by the argument, not by today');

    const early = ctx.impliedAccounts('2026-09-01').find(a => a.name === 'Cheque');
    const later = ctx.impliedAccounts('2026-09-02').find(a => a.name === 'Cheque');
    eq(early.balance, 20000, 'on its confirmation day the cheque account reads what was confirmed');
    eq(later.balance, 18800, 'and a day later it carries the R1 200 shop — the as-of is the caller\'s');
  }

  console.log(`PASS today-is-injected (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
