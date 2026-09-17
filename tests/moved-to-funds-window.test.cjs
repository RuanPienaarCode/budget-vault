'use strict';
/* movedToFunds and savingContribution close their window at the same today.

   ISSUE 87. Both ask savedFromOutside() the identical question — how much
   reached the household's own funds from outside them — and until now closed
   the window two different ways: movedToFunds stopped at today for a period
   containing it, savingContribution took the whole period regardless. The
   Score's flow card reads savingContribution for the RUNNING period, so on
   the `BudgetAudit` seed at its own audit date (2026-09-02), with a R5 000
   gift dated 28 September, the Dashboard read R2 000 moved and the Score
   read R7 000 behind it — one fact, two windows, no disclosure on either.

   Fixed by both functions reading the one `periodWindowAsOf(p, todayArg)`
   (period.js), pinned here rather than only in the (already-passing)
   moved-to-funds-currency suite, because that file's job is currency, not
   the window, and a negative control belongs beside the fix that needs one.

     node tests/moved-to-funds-window.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { SEED, TODAY, PERIOD, B, atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

async function vault(files) {
  const ctx = makeCtx(files, { budgetFolder: B });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  return ctx;
}

atAuditDate(async () => {
  /* ---- 1. the reproduction: a gift dated later this period ---------------
     R2 000 to the emergency fund (transfer, already landed) plus a R5 000
     family gift dated 28 September — five days after the pinned audit date
     of 2026-09-02, so it has not happened yet from the reader's seat. */
  {
    const ctx = await vault(SEED);
    eq(ctx.movedToFunds(PERIOD), 2000,
      'movedToFunds already closed at today: the gift has not landed yet');
    eq(ctx.savingContribution(PERIOD), 2000,
      'FIX: savingContribution now closes at the same today — before the fix this read 7000, '
      + 'counting a gift five days before it exists');
  }

  /* ---- 2. negative control: the whole-period reading is still reachable --
     Handing today explicitly as the period's own end proves the function can
     still answer "the whole period", so ISSUE 87 was the DEFAULT, not the
     capability — a caller that genuinely wants the plan (not yet built) is
     not blocked by this fix. */
  {
    const ctx = await vault(SEED);
    eq(ctx.savingContribution(PERIOD, '2026-09-30'), 7000,
      'asked explicitly for the whole period, savingContribution still counts the gift');
    eq(ctx.movedToFunds(PERIOD, '2026-09-30'), 7000,
      'and movedToFunds answers identically when asked the same way — one window, two callers');
  }

  /* ---- 3. a finished period is untouched -------------------------------
     August has no rows after its own end, so the as-of-today clip is a
     no-op whichever function asks — the six trailing periods healthSnapshot
     averages must not move because of this fix. */
  {
    const ctx = await vault(SEED);
    eq(ctx.savingContribution('2026-08'), 0, 'August holds no saving rows in this seed');
    eq(ctx.movedToFunds('2026-08'), 0, 'and movedToFunds agrees — both read a finished period the same way');
  }

  /* ---- 4. a period that has not started yet moves nothing --------------- */
  {
    const ctx = await vault(SEED);
    eq(ctx.savingContribution('2026-10'), 0, 'a period after today has moved nothing yet');
    eq(ctx.movedToFunds('2026-10'), 0, 'movedToFunds already answered this the same way');
  }

  console.log(`PASS moved-to-funds-window (${checks} checks)`);
}, TODAY).catch(e => { console.error(e); process.exit(1); });
