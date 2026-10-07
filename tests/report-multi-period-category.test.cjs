'use strict';
/* One category, one total, in one multi-period Report.

   "Spend by Category" used to be built by adding up each period's donut rows
   (categorySpendRows). That function drops a category from any period in
   which its refunds outweighed its charges — right for one period's donut,
   where a net-positive category has nothing to draw — so a refund landing in
   a LATER period than the purchase never netted at all. "Budget vs Actual",
   two sections down, adds each period's signed actual and does net it. The
   same document then stated two totals for one category: on the vault this
   was found on, a 12-month report did it for five categories, one of them at
   roughly twice its Budget-vs-Actual figure.

   The owner's decision (2026-10-07): a multi-period report nets refunds across the
   WHOLE selection. Each period's signed per-category figure is summed first,
   and only a category that is still an outflow over the selection becomes a
   row — the Budget-vs-Actual rule. The "refunds netted" sentence is then the
   one gap identity (money-flow.js categoryGap) over the merged rows, so the
   refund the merge now nets is the amount it reports.

   Pinned here, over the committed household plus one category bought in
   August and partly refunded in September, through the REAL loader and views:

     1. both tables state the same Gifts total, in Markdown and in JSON;
     2. CONTROL: the old per-period merge gives a different total on this very
        fixture, so the assertion above cannot pass by coincidence;
     3. the refund the merge nets is the refund the document names, and gross
        spend = the table + uncategorised + netted, to the cent;
     4. a single-period report is unchanged: its rows and its gap are the
        donut's own (categorySpendRows / categoryGap);
     5. the pure merge, unit by unit.

     node tests/report-multi-period-category.test.cjs */

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
  [`${B}/Categories/Gifts.md`]: '---\ntype: expense\ncolor: "#aa66aa"\n---\n',
  [AUG]: SEED[AUG] + '| 2026-08-15 | Gift shop | Gifts | -1000.00 |  |  |  |\n',
  [SEP]: SEED[SEP] + '| 2026-09-01 | Gift shop refund | Gifts | 600.00 |  |  |  |\n',
});

async function run(f, pill) {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(f, { period: PERIOD, budgetFolder: B });
    const out = await createReport(M, { pill });
    return { M, ...out, i18n: require('../src/i18n'), report: require('../src/report') };
  } finally { unpin(); }
}
const cellsOf = (md, heading, cat) => {
  const line = (section(md, heading) || '').split('\n').find(l => l.startsWith(`| ${cat} |`));
  return line ? line.split(' | ').map(c => c.replace(/^\| |\s*\|$/g, '').trim()) : null;
};

(async () => {
  /* ---- 1-3. three months, a refund a period after the purchase ----------- */
  {
    const r = await run(files(), '3m');
    const { ctx } = r.M;
    const periods = ['2026-08', PERIOD];
    eq(r.json.period_count, periods.length, 'fixture: the report covers August and September');
    eq(ctx.periodSummary('2026-08').byCat.Gifts, -1000, 'fixture: R1 000 of gifts in August');
    eq(ctx.periodSummary(PERIOD).byCat.Gifts, 600, 'fixture: R600 refunded in September');

    const jSpend = r.json.categories.find(c => c.category === 'Gifts');
    const jBva = r.json.budgets_vs_actuals.find(c => c.category === 'Gifts');
    ok(jSpend && jBva, 'Gifts is a row in both tables');
    eq(jSpend.amount, 400, 'Spend by Category nets the refund across the selection (JSON)');
    eq(jSpend.amount, jBva.actual, 'and states the SAME total Budget vs Actual states');

    const spendCells = cellsOf(r.md, r.i18n.t('report.section.category'), 'Gifts');
    const bvaCells = cellsOf(r.md, r.i18n.t('report.section.budgetActual'), 'Gifts');
    eq(spendCells && spendCells[1], ctx.money(400), 'the Markdown Spend-by-Category row prints the netted R400');
    eq(bvaCells && bvaCells[3], ctx.money(400), 'and the Budget-vs-Actual row prints the same figure');

    /* 2. CONTROL — the rule this replaced, run on the same mount. */
    const old = r.report.mergeCategoryRows(periods.map(p => ctx.categorySpendRows(p)), ['amount']).find(x => x.cat === 'Gifts');
    eq(old && old.amount, 1000, 'CONTROL: summing each period\'s donut rows gives R1 000 here — the figure the document used to print');
    ok(old.amount !== jSpend.amount, 'so the assertion above discriminates the two rules');

    /* 3. the gap names the refund the merge netted, and the identity closes. */
    const gap = r.json.category_gap;
    eq(gap.netted, 600, 'the R600 refund is the netted figure (it used to be R0 — the refund was never netted)');
    ok(r.md.includes(r.i18n.t('report.category.netted', { amount: ctx.money(600) })), 'and the Markdown names it');
    const grossSpend = periods.reduce((t, p) => t + ctx.periodSummary(p).spend, 0);
    const tableTotal = r.json.categories.reduce((t, c) => t + c.amount, 0);
    near(tableTotal + gap.uncategorised + gap.netted, grossSpend, 'gross spend = the table + uncategorised + netted, over the whole selection');
    eq(r.json.categories.reduce((t, c) => t + c.percent, 0), 100, 'the % column still sums to 100');
  }

  /* ---- 4. a single period is the donut, unchanged ------------------------- */
  {
    const r = await run(files(), 'current');
    const { ctx } = r.M;
    eq(r.json.period_count, 1, 'fixture: one period');
    eq(r.json.categories.map(c => ({ cat: c.category, amount: c.amount })), ctx.categorySpendRows(PERIOD),
      'a one-period report lists exactly the donut\'s rows, in its order');
    const g = ctx.categoryGap(PERIOD);
    eq([r.json.category_gap.uncategorised, r.json.category_gap.netted], [g.uncat, g.netted], 'and states exactly the donut\'s gap');
    ok(!r.json.categories.some(c => c.category === 'Gifts'), 'a category that only received a refund this period has no row, as on the donut');
  }

  /* ---- 5. the pure merge ---------------------------------------------------- */
  {
    const { mergeSpendByCategory } = require('../src/report');
    const merged = mergeSpendByCategory([
      { split: [{ cat: 'A', amount: 100 }, { cat: 'B', amount: 50 }], byCat: { A: -100, B: -50, Pay: 900 }, spend: 150, uncatSpend: 0 },
      { split: [{ cat: 'C', amount: 30 }], byCat: { A: 40, B: 60, C: -30 }, spend: 30, uncatSpend: 0 },
    ]);
    eq(merged.rows, [{ cat: 'A', amount: 60 }, { cat: 'C', amount: 30 }],
      'signed figures summed first; B (net refund over the selection) has no row; largest first');
    eq(merged.gap, { uncat: 0, netted: 90 }, 'the gap is the identity over the merged rows: 180 − 90 = 90 netted');

    /* R10,00 bought, refunded as R1,13 and R8,87 in two later periods. */
    ok(((-10 + 1.13) + 8.87) < 0, 'fixture: float addition of these cents leaves a NEGATIVE residue (-1.8e-15)');
    const cents = mergeSpendByCategory([
      { split: [{ cat: 'A', amount: 10 }], byCat: { A: -10 }, spend: 10, uncatSpend: 0 },
      { split: [], byCat: { A: 1.13 }, spend: 0, uncatSpend: 0 },
      { split: [], byCat: { A: 8.87 }, spend: 0, uncatSpend: 0 },
    ]);
    eq(cents.rows, [], 'a charge refunded to the cent across periods leaves no "R 0,00" row behind float residue');

    eq(mergeSpendByCategory([]), { rows: [], gap: { uncat: 0, netted: 0 } }, 'no periods, nothing');
    const uncat = mergeSpendByCategory([{ split: [{ cat: 'A', amount: 70 }], byCat: { A: -70, '': -30 }, spend: 100, uncatSpend: 30 }]);
    eq(uncat.gap, { uncat: 30, netted: 0 }, 'uncategorised spend is the uncategorised part of the gap, not a refund');
  }

  console.log(`PASS report-multi-period-category (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
