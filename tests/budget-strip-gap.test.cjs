'use strict';
/* ISSUE 96. The Budget strip's spent tile computed its own gap by hand
   (grossGap / gapUncat / gapNetted in views/budgets.js) with no seam any
   other reader could check it against — so when the reconciliation wanted to
   pin it, the only global on offer was figures.js's categoryGap(), which is
   the DONUT's gap, over a different row population:

     - the donut sums categorySpendRows(), which iterates sum.byCat and so
       shows a spend row for a category with no .md file (any non-income,
       non-transfer category is shown, known type or not);
     - the strip sums budgetDraft(), which seeds a row only for a category
       the budget file names or the vault has a Categories/*.md file for, and
       so never seeds one for that money.

   Both gaps are honest. They are different numbers. money-flow.js's
   categoryGap() cannot answer for the strip, which is why ISSUE 96 gave it
   its own seam, budgetStripGap() — same identity, decomposed over the
   strip's own population — and views/budgets.js's budgetSpendGap() supplies
   the operands (namedNetSpend) off the live draft the same way the tile
   itself does.

     node tests/budget-strip-gap.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { budgetStripGap } = require('../src/money-flow');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const c = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };
const eqMoney = (a, b, m) => eq(c(a), c(b), `${m} (got ${a}, want ${b})`);

/* ---- 1. the pure rule, same shape as categoryGap's own pins ------------- */
{
  eq(budgetStripGap({ spend: 1000, namedNetSpend: 800, uncatSpend: 150, unknownSpend: 0 }),
    { total: 800, notShown: 200, uncat: 150, netted: 50 }, 'gap = gross − the draft\'s own total, uncategorised first, the rest is netting');
  eq(budgetStripGap({ spend: 700, namedNetSpend: 0, uncatSpend: 0, unknownSpend: 700 }),
    { total: 0, notShown: 700, uncat: 700, netted: 0 }, 'a category with no seeded row at all: the whole amount is uncategorised, not netted');
  eq(budgetStripGap({ spend: 500, namedNetSpend: 600, uncatSpend: 0, unknownSpend: 0 }).notShown, 0,
    'a draft total larger than gross spend (rounding) is a zero gap, never negative');
  eq(budgetStripGap({ spend: 700, namedNetSpend: 0, uncatSpend: 500, unknownSpend: 500 }).uncat, 700,
    'uncategorised + unknown is clamped to the gap it can explain');
}

/* ---- 2. the issue's own demonstration ----------------------------------- */
const B = 'Budget';
const P = '2026-07';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const txFile = rows => `---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |\n`).join('')}`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-31\n---\n',
  [`${B}/Budgets/${P}.md`]: '---\ntags: [finance, finance/budget]\n---\n\n| Category | Type | Amount |\n|---|---|---:|\n| Salary | income | 10000.00 |\n| Groceries | expense | 3000.00 |\n',
  [`${B}/Transactions/Cheque/${P}.md`]: txFile([
    ['2026-07-01', 'Salary', 'Salary', 10000],
    ['2026-07-03', 'Shop', 'Groceries', -2000],
    // The demonstration: a category with real spend and NO Categories/*.md
    // file — declared nowhere, so budgetDraft() never seeds a row for it.
    ['2026-07-10', 'Mystery charge', 'Mystery', -700],
  ]),
};

(async () => {
  const ctx = makeCtx(FILES, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  require('../src/views/budgets')(ctx);
  ctx.S.period = P;

  const donutGap = ctx.periodFigures(P).gap;
  const stripGap = ctx.budgetSpendGap();

  ok(donutGap.notShown < 0.01, `donut: categorySpendRows shows Mystery's 700 as a split row, so nothing is missing (got ${donutGap.notShown})`);
  eqMoney(stripGap.uncat, 700, "strip: budgetDraft() never seeds Mystery a row, so its whole spend falls into the strip's own uncategorised gap");
  eqMoney(stripGap.netted, 0, 'strip: nothing netted in this fixture');
  ok(donutGap.notShown !== stripGap.notShown,
    `the two gaps are genuinely different numbers over the same period (donut ${donutGap.notShown}, strip ${stripGap.notShown}) — one seam cannot answer for both`);
})().then(() => console.log(`PASS — budget strip gap (ISSUE 96): ${checks} checks`))
  .catch(e => { console.error(e); process.exit(1); });
