'use strict';
/* What an empty Debt page — and an empty Payment cell — are allowed to mean.

   Both questions are answered by a COERCION rather than by a rule, which is why
   they need a test that drives the real loader rather than the pure module:

     • `debtInterestMonthly([])` returns a real 0, and a `?? 0` in healthMetrics
       used to turn a caller's null into that same 0 — so "no debts" and "cannot
       measure" scored identically while meaning opposite things.
     • The Debts table reads a BLANK `Payment` cell as 0 (table-schema.js's
       money() reader), so a household that listed its debts and left that
       column empty scored full marks on instalments — indistinguishable from a
       household with no repayments at all.

   The second was a real over-score: a household with debt was told it had none
   of the burden. The first is a deliberate choice, documented in health-math's
   PILLARS block — no debts recorded EARNS the pillar, because refusing to
   credit it leaves a genuinely debt-free household unscored on the one thing it
   has finished — and the assumption is disclosed through `debtsRecorded` rather
   than asserted silently.

     node tests/debt-scoring.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const TX = m => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + `| ${m}-01 | Salary | Salary | 40000.00 | | | |\n`
  + `| ${m}-05 | Food | Groceries | -20000.00 | | | |\n`;

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
};
for (const m of MONTHS) { BASE[`${B}/Transactions/Cheque/${m}.md`] = TX(m); }

const HEAD = '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n';
const row = payment =>
  `| Card | Bank | credit card | 50000.00 | 50000.00 | 20.00 | ${payment} | | 2024-01-01 | | active | |\n`;

async function snap(debtsFile) {
  const files = { ...BASE };
  if (debtsFile) { files[`${B}/Debts.md`] = debtsFile; }
  const ctx = makeCtx(files, { budgetFolder: B });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  require('../src/categories')(ctx);
  return ctx.healthSnapshot();
}

(async () => {
  /* ---- 1. no Debt page: credited, and disclosed ---- */
  {
    const s = await snap(null);
    eq(s.debtsRecorded, false, 'nothing recorded, and the snapshot says so');
    eq(s.metrics.interestShare, 0, 'no interest is a measured zero');
    eq(s.metrics.instalmentShare, null, 'and nothing states a repayment');
    const debt = s.metrics.score.pillars.find(p => p.key === 'debt');
    ok(!!debt && debt.at === 1, 'the pillar is earned in full — the documented choice');
  }

  /* ---- 2. debts listed, Payment BLANK: the over-score this fixes ----
     Previously the blank cell read as 0 and scored full marks on instalments,
     telling a household carrying debt that it carried no burden. */
  {
    const s = await snap(HEAD + row(''));
    eq(s.debtsRecorded, true, 'a listed debt is recorded');
    ok(s.metrics.interestShare > 0, 'its interest is real and measured from balance and rate');
    eq(s.metrics.instalmentShare, null,
      'but a blank Payment is UNMEASURED, not a repayment of zero');
    const debt = s.metrics.score.pillars.find(p => p.key === 'debt');
    ok(debt.at < 1, `so the pillar is no longer full (${debt.at.toFixed(2)})`);
  }

  /* ---- 3. an explicit 0 reads the same as blank ----
     A debt repaid at nothing states no commitment either way, so there is
     nothing the two could mean differently for this measure. */
  {
    const s = await snap(HEAD + row('0.00'));
    eq(s.metrics.instalmentShare, null, 'a stated zero is treated as unstated');
  }

  /* ---- 4. Payment stated: both measures live ---- */
  {
    const s = await snap(HEAD + row('3000.00'));
    ok(s.metrics.instalmentShare > 0, 'a stated payment is measured');
    eq(Math.round(s.metrics.instalmentShare * 1000) / 1000, 0.075, '3 000 of 40 000 income');
  }

  /* ---- 5. partial knowledge counts what is known ----
     Understating a burden is the safe direction; refusing to answer leaves the
     score untouched, which is further from the truth. */
  {
    const s = await snap(HEAD + row('3000.00') + row('').replace('Card', 'Loan'));
    ok(s.metrics.instalmentShare > 0,
      'one stated payment beside one blank still reports the stated one');
  }

  /* ---- 6. a paid-off debt costs nothing ---- */
  {
    const paid = HEAD + '| Old | Bank | vehicle | 0.00 | 90000.00 | 13.00 | 2000.00 | | 2020-01-01 | | paid | |\n';
    const s = await snap(paid);
    eq(s.metrics.instalmentShare, null, 'a settled debt states no live repayment');
    eq(s.metrics.interestShare, 0, 'and costs no interest');
  }

  console.log(`PASS — debt scoring: an empty Debt page is credited and disclosed, a blank Payment is unmeasured rather than zero (${checks} assertions).`);
})().catch(e => { console.error('FAIL —', e.message); process.exit(1); });
