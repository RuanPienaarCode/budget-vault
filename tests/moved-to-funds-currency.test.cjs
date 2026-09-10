'use strict';
/* movedToFunds() is household currency, both directions.

   ISSUE 28's shape, found again on 2026-09-09. `movedToFunds()` and
   `savingContribution()` ask one question — how much reached the household's
   own funds from outside them — through the same `savedFromOutside()`. One of
   them filtered currency and one did not, so the Dashboard hero, the Budget
   strip and the Report printed a figure the Score page would not recognise.

   Measured on the BudgetAudit household plus one euro fund, whole period
   (today = 2026-09-30) so both functions see the same rows. The truth is
   R7 000: R2 000 moved to the emergency fund and a R5 000 family gift into it.

     inflow   EUR 5 000 arriving read as R12 000 — a euro added to a rand
     outflow  EUR 2 000 leaving read as R5 000 — a euro cancelling a rand

   Held out, not converted: there is no rate in this vault and the app never
   invents one. Held out is not silent either — foreignLabels() is the same set
   summaryInRange discloses through `foreign`, and every surface that prints
   this figure prints that disclosure beside it.

     node tests/moved-to-funds-currency.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { SEED, PERIOD, B, tx, atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The whole period, so the as-of-today window holds nothing back and the two
   functions are answering over exactly the same rows. */
const TODAY = '2026-09-30';
const TRUTH = 7000;

/* type savings + a goal is a pool account AND an earmarked one, so
   movedToFunds() reaches this folder by either test; `currency: EUR` against
   the household's "R" is what isForeign() reads. */
const EUR_FUND = '---\ntype: savings\ntx_label: "Euro fund"\ncurrency: "EUR"\n'
  + 'goal_amount: 50000.00\nbalance: 12000.00\nbalance_updated: 2026-09-01\n---\n';
/* The same account in the household's own currency — the negative control. */
const RAND_FUND = '---\ntype: savings\ntx_label: "Euro fund"\n'
  + 'goal_amount: 50000.00\nbalance: 12000.00\nbalance_updated: 2026-09-01\n---\n';

async function vault(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = PERIOD;
  return ctx;
}
const withFund = (account, rows) => {
  const files = { ...SEED };
  files[`${B}/Accounts/Euro fund.md`] = account;
  files[`${B}/Transactions/Euro fund/2026-09.md`] = tx(rows);
  return files;
};

atAuditDate(async () => {
  /* ---------------- the household as it stands, rand only --------------- */
  {
    const ctx = await vault(SEED);
    eq(ctx.movedToFunds(PERIOD, TODAY), TRUTH,
      'R2 000 to the emergency fund plus a R5 000 gift into it is R7 000 moved');
    eq(ctx.savingContribution(PERIOD), TRUTH,
      'and the Score reads the same R7 000 off the same pairing');
  }

  /* ---------------- a foreign arrival must not inflate ------------------ */
  {
    const ctx = await vault(withFund(EUR_FUND, [['2026-09-15', 'Salary EUR', 'Salary', 5000]]));
    eq([...ctx.foreignLabels().keys()], ['Euro fund'],
      'the euro fund is a foreign folder, which is what every other period figure filters on');
    eq(ctx.movedToFunds(PERIOD, TODAY), TRUTH,
      'EUR 5 000 arriving in a euro fund is not R5 000 moved — there is no rate to add it with');
    eq(ctx.savingContribution(PERIOD), TRUTH,
      'and the two functions still agree, which is the whole point of the fix');
  }

  /* ---------------- a foreign outflow must not cancel ------------------- */
  {
    const ctx = await vault(withFund(EUR_FUND, [['2026-09-01', 'Euro withdrawal', 'Transfer', -2000]]));
    eq(ctx.movedToFunds(PERIOD, TODAY), TRUTH,
      'EUR 2 000 leaving a euro fund cannot pair with — and delete — a real R2 000 contribution');
    eq(ctx.savingContribution(PERIOD), TRUTH,
      'the Score was never fooled by this leg either');
  }

  /* -------- and the pairing itself is untouched in home currency -------- */
  {
    /* The negative control that proves the filter narrowed by CURRENCY and not
       by anything else: the identical rows in the household's own currency
       still pair, so a rand shuffle between two funds is still not saving. */
    const ctx = await vault(withFund(RAND_FUND, [['2026-09-01', 'Withdrawal', 'Transfer', -2000]]));
    eq(ctx.movedToFunds(PERIOD, TODAY), 5000,
      'a rand fund-to-fund shuffle still cancels: R7 000 less the R2 000 that only moved between pockets');
    eq(ctx.savingContribution(PERIOD), 5000,
      'and the Score reads that same R5 000');
  }

  console.log(`PASS moved-to-funds-currency (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
