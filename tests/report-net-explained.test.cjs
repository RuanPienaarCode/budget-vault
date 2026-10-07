'use strict';
/* Income, Spend and Net add up — or the Report says why they do not.

   The Income & Spend table prints three figures one above the other, and a
   reader subtracts. They were never meant to subtract: Income is the rows
   under income-typed categories, Spend is every outflow gross (refunds not
   taken off), and Net is the sum of EVERY counted row — so money back into a
   spending category and money in with no recognised category land in Net
   and in neither of the other two. On the vault this was found on, a
   12-month report's Net sat more than a whole month's income away from
   Income − Spend — about two fifths of the gap uncategorised money in, the
   rest refunds — and nothing in the document said why.

   Fixed by naming both parts under the table, in Markdown and as JSON data.
   Pinned here, through the REAL loader and views:

     1. the two parts are named, and Net = Income − Spend + refunds +
        money in without a category, to the cent;
     2. the refunds figure equals an INDEPENDENT count — ledger.js's own
        isRefund() over the very rows the period's tally kept — and the
        uncategorised part is periodFigures().uncountedIncome, the figure the
        Dashboard hero's "not counted as income" line reads;
     3. the Markdown prints the JSON's figures;
     4. a period with neither prints neither sentence (and JSON says 0);
     5. several periods sum part by part, and the identity still closes;
     6. prepareReportData leaves the fact absent when its operand is absent.

     node tests/report-net-explained.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport, section } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`);

const AUG = `${B}/Transactions/Cheque/2026-08.md`;
const SEP = `${B}/Transactions/Cheque/2026-09.md`;
const files = () => ({
  ...SEED,
  [SEP]: SEED[SEP]
    + '| 2026-09-02 | Corner shop refund | Groceries | 300.00 |  |  |  |\n'
    + '| 2026-09-02 | EFT from a friend |  | 1000.00 |  |  |  |\n',
});

async function run(f, pill = 'current') {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(f, { period: PERIOD, budgetFolder: B });
    const out = await createReport(M, { pill });
    return { M, ...out, i18n: require('../src/i18n') };
  } finally { unpin(); }
}
/* The independent count: every row the BUDGET lens kept in the window, put
   through ledger.js's own definition of a refund. Not the subtraction the
   Report states — the rows themselves. */
function refundsOracle(ctx, start, end) {
  const { isRefund } = require('../src/ledger');
  return ctx.tally(ctx.ledger(start, end), ctx.LENSES.BUDGET).kept
    .filter(isRefund).reduce((t, s) => t + s.amount, 0);
}

(async () => {
  /* ---- 1-3. one period with a refund and an uncategorised deposit -------- */
  {
    const r = await run(files());
    const { ctx } = r.M;
    const iv = r.json.income_vs_spend;
    ok(iv.net_includes && typeof iv.net_includes === 'object', 'JSON income_vs_spend carries a net_includes fact');
    const { refunds, uncategorised_in: uncat } = iv.net_includes;

    const { start } = ctx.periodRange(PERIOD);
    eq(refunds, refundsOracle(ctx, start, TODAY), 'refunds are exactly the rows ledger.isRefund() names in the window');
    eq(refunds, 300, 'fixture: the R300 grocery refund');
    eq(uncat, ctx.periodFigures(PERIOD).uncountedIncome, 'the uncategorised part is periodFigures().uncountedIncome');
    eq(uncat, 1000, 'fixture: the R1 000 deposit nobody categorised');
    near(iv.net, iv.income - iv.spend + refunds + uncat, 'Net = Income − Spend + refunds + money in without a category');
    ok(Math.abs(iv.net - (iv.income - iv.spend)) >= 1, 'CONTROL: on this fixture Income − Spend is NOT Net — there is a gap to explain');

    const sec = section(r.md, r.i18n.t('report.section.incomeSpend'));
    ok(r.i18n.t('report.net.refunds', { amount: 'X' }) !== 'report.net.refunds', 'the refunds sentence exists in English');
    ok(r.i18n.t('report.net.uncounted', { amount: 'X' }) !== 'report.net.uncounted', 'the uncategorised sentence exists in English');
    ok(sec.includes(r.i18n.t('report.net.refunds', { amount: ctx.money(refunds) })), 'the Markdown names the refunds, at the JSON figure');
    ok(sec.includes(r.i18n.t('report.net.uncounted', { amount: ctx.money(uncat) })), 'and the money in without a category, at the JSON figure');
  }

  /* ---- 4. nothing to explain, nothing said ------------------------------- */
  {
    const r = await run({ ...SEED });
    const iv = r.json.income_vs_spend;
    eq(iv.net_includes, { refunds: 0, uncategorised_in: 0 }, 'JSON states both parts as zeroes');
    near(iv.net, iv.income - iv.spend, 'fixture: here Income − Spend IS Net');
    const sec = section(r.md, r.i18n.t('report.section.incomeSpend'));
    ok(!sec.includes(r.i18n.t('report.net.refunds', { amount: r.M.ctx.money(0) })), 'no refunds sentence');
    ok(!sec.includes(r.i18n.t('report.net.uncounted', { amount: r.M.ctx.money(0) })), 'no uncategorised sentence');
  }

  /* ---- 5. several periods ------------------------------------------------ */
  {
    const f = files();
    f[AUG] = SEED[AUG] + '| 2026-08-20 | Gym refund | Gym | 250.00 |  |  |  |\n';
    const r = await run(f, '3m');
    const { ctx } = r.M;
    eq(r.json.period_count, 2, 'fixture: August and September');
    const iv = r.json.income_vs_spend;
    const aug = ctx.periodRange('2026-08');
    const want = refundsOracle(ctx, aug.start, aug.end) + refundsOracle(ctx, ctx.periodRange(PERIOD).start, TODAY);
    eq(iv.net_includes.refunds, want, 'refunds summed over the selection, period by period');
    eq(iv.net_includes.refunds, 550, 'fixture: R250 in August and R300 in September');
    near(iv.net, iv.income - iv.spend + iv.net_includes.refunds + iv.net_includes.uncategorised_in, 'the identity closes over the selection');
  }

  /* ---- 6. absent operand, absent fact ------------------------------------ */
  {
    const { prepareReportData, financialReportJson } = require('../src/report');
    const base = { income: 100, spend: 60, net: 70, spendByCategory: [] };
    eq(prepareReportData({ ...base, uncountedIncome: 20 }).netIncludes, { refunds: 10, uncounted: 20 },
      'Net 70 = 100 − 60 + 10 refunds + 20 uncategorised');
    eq(prepareReportData(base).netIncludes, null, 'no uncountedIncome operand → no decomposition, rather than a guess');
    const json = JSON.parse(financialReportJson({
      ...base, generated: 'x', periodLabel: 'x', rangeNote: 'x', detail: 'summary', categories: [],
      netWorth: { net: 0, assets: 0, liabilities: 0 },
    }));
    eq(json.income_vs_spend.net_includes, null, 'and JSON says null — unknown, not zero');
  }

  console.log(`PASS report-net-explained (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
