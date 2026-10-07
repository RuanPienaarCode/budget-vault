'use strict';
/* Uncategorised money the household spent counts as essential spend, and as
   living costs, on the Score — the rule health-math.js has always stated and
   the HOUSEHOLD tally never applied (2026-10-07 audit, L2a-05).

   essentialTotal() says "an unknown or blank type counts as essential
   deliberately: an uncategorised debit is far more likely a bill than a treat,
   and guessing the other way would report more months of cover than the
   household may actually have". Its own test only ever handed it a NAMED
   category with no file. A row with a BLANK category never reached it: the
   tally's net reading skipped the blank bucket (`if (!cat || …) continue`), so
   every uncategorised outgoing left the essential average and the living-costs
   share, and the cover figure read more months than the documented rule gives.
   On the vault the audit measured, every uncategorised household outgoing in
   six trailing periods was dropped.

   The decision ("go with the defaults"): the blank category is one more
   bucket in the HOUSEHOLD reading, netted like any named one, and it is
   essential spend and consumption. HOUSEHOLD keeps Excluded rows and accounts
   outside the budget, so an uncategorised purchase paid from a sinking fund and
   marked Excluded counts too; a pass-through pair (the two Excluded legs of one
   movement) is still dropped first. The other lenses keep the blank bucket out
   of their category maps, as before — the trend chart and the donut name
   categories and disclose uncategorised spend beside them.

   Driven through the REAL loader, stamp(), tally() and healthSnapshot(), with
   the clock pinned. Synthetic household.

     node tests/household-essential-counts-uncategorised.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { atAuditDate } = require('./_audit-seed.cjs');
const { tally, LENSES } = require('../src/ledger');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m, tol = 0.005) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b})`); checks++; };

const B = 'Budget';
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const table = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |  |`).join('\n') + '\n';

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 50000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  /* Outside the budget: a joint account the household still pays from. */
  [`${B}/Accounts/Joint.md`]: '---\ntype: checking\nbalance: 4000.00\nbalance_updated: 2026-08-01\ntx_label: "Joint"\nbudget: false\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\nbalance: 0.00\nbalance_updated: 2026-08-01\ntx_label: "Card"\n---\n',
  [`${B}/Accounts/Emergency Fund.md`]: '---\ntype: savings\nbalance: 26500.00\nbalance_updated: 2026-08-01\nemergency_fund: true\ntx_label: "Emergency Fund"\n---\n',
};

/* withBlank: the uncategorised rows are present. Each month:
     Cheque  Groceries −4 000           (named, essential)
     Cheque  blank     −1 000           (a plumber nobody categorised yet)
     Cheque  blank       +200           (an uncategorised refund — nets the bucket)
     Joint   blank       −500 Excluded  (a sinking-fund purchase kept out of the budget)
     Cheque  blank     −2 000 Excluded  } the two legs of one card settlement:
     Card    blank     +2 000 Excluded  } a pass-through pair, dropped
   so the blank bucket nets −1 300 and essential spend is 4 000 + 1 300. */
function vault(withBlank) {
  const files = { ...BASE };
  for (const m of MONTHS) {
    const cheque = [[`${m}-01`, 'Salary', 'Salary', 45000], [`${m}-05`, 'Checkers', 'Groceries', -4000]];
    if (withBlank) {
      cheque.push([`${m}-09`, 'Plumber', '', -1000], [`${m}-12`, 'Hardware refund', '', 200],
        [`${m}-14`, 'Card settle', '', -2000, 'yes']);
      files[`${B}/Transactions/Joint/${m}.md`] = table([[`${m}-11`, 'Tyres from the car fund', '', -500, 'yes']]);
      files[`${B}/Transactions/Card/${m}.md`] = table([[`${m}-14`, 'Payment received', '', 2000, 'yes']]);
    }
    files[`${B}/Transactions/Cheque/${m}.md`] = table(cheque);
  }
  return files;
}

async function mount(files) {
  const ctx = makeCtx(files, { budgetFolder: B, settings: { month_start_day: 1, currency: 'R', country: 'za' } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  return ctx;
}

atAuditDate(async () => {
  /* ---- 1. the tally: the blank bucket is one more HOUSEHOLD bucket ------ */
  const ctx = await mount(vault(true));
  const st = ctx.ledger('2026-07-01', '2026-07-31');
  const h = tally(st, LENSES.HOUSEHOLD);
  near(h.byCat[''], -1300, 'fixture check: the blank bucket nets −1 000 + 200 − 500 (the settle pair is dropped first)');
  near(h.spendByCat[''] || 0, 1300, 'HOUSEHOLD: the blank bucket\'s net outflow is in the spending map, as its own bucket');
  near(h.consumption, 4000 + 1300, 'HOUSEHOLD: and in consumption (living costs)');
  near(h.fixed, 0, 'nothing is flagged fixed, and a blank category can never be');
  eq(st.filter(s => s.passthrough).length, 2, 'the two Excluded legs of the card settlement are still paired and dropped');

  /* The other lenses are unchanged: the trend chart's and the donut's maps name
     categories, and disclose uncategorised spend beside them. */
  ok(!('' in tally(st, LENSES.TREND).spendByCat), 'TREND: no blank bucket in the trend chart\'s category map');
  ok(!('' in tally(st, LENSES.BUDGET).spendByCat), 'BUDGET: none in its net reading either');
  near(tally(st, LENSES.BUDGET).uncatSpend, 1000, 'BUDGET still discloses the in-budget uncategorised outgoing gross');

  /* ---- 2. the snapshot the Score and the Dashboard health card read ------ */
  const H = ctx.healthSnapshot().metrics;
  near(H.monthlyEssential, 5300, 'essential spend averages Groceries + the uncategorised bucket');
  near(H.monthlyConsumption, 5300, 'and so do living costs');
  near(H.months, 26500 / 5300, 'so the fund covers 5.0 months, not the 6.6 the dropped rows read');
  near(H.consumptionShare, 5300 / 45000, 'living costs share of household income carries the bucket too');

  /* ---- 3. negative control: the rows are what moved the figure ---------- */
  const H0 = (await mount(vault(false))).healthSnapshot().metrics;
  near(H0.monthlyEssential, 4000, 'negative control: without the uncategorised rows essential is Groceries alone');
  near(H.monthlyEssential - H0.monthlyEssential, 1300, 'and the difference is exactly the netted blank bucket, nothing else');
  /* The old reading, by data: a lens with HOUSEHOLD's vetoes and sign rule but
     no say about the blank bucket reproduces the defect exactly. */
  const bare = { name: 'HOUSEHOLD_WITHOUT_BLANK', drop: LENSES.HOUSEHOLD.drop, sign: LENSES.HOUSEHOLD.sign };
  near(tally(st, bare).consumption, 4000, 'negative control: the pre-fix lens drops the blank bucket from consumption');
  ok(!('' in tally(st, bare).spendByCat), 'and from the map essentialTotal reads');

  console.log(`PASS household-essential-counts-uncategorised (${checks} checks)`);
}, '2026-08-15').catch(e => { console.error(e); process.exit(1); });
