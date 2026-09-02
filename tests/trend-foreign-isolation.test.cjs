'use strict';
/* periodSpend() and a second currency — the last unfiltered walk left over
   from ISSUE 28.

   src/period.js's summaryInRange() has held foreign rows out of income and
   spend since that audit, and src/health-data.js's healthSnapshot() was
   taught the same predicate (`foreignLabels()`) in the pass after it. What
   neither pass reached was src/trend-math.js's periodSpend(), which applied
   only the per-row veto (`excluded`) and the per-account one
   (`nonBudgetLabels`) and then added every remaining row into one per-category
   rand map. Three surfaces read that map:

     · the Dashboard's TREND CHART — one point per period, drawn in rand
     · the Dashboard's COMPARISON COLUMN — this period against the last N,
       per category, printed as "up R 3 000 on Groceries"
     · the SCORE's `budgetUsed` pillar, via health-data.js's
       `consumptionBudget` (and its `counted` flag, via `spend.count`)

   So a single rupiah holiday account put a Rp 3 000 000 market trip into the
   rand Groceries bar, and health-data — which had *just* narrowed every one
   of its own walks to the household's currency — divided that number by a
   rand budget. Measured on tests/score-currency-isolation.test.cjs's own
   fixture with budget files added: budgetUsed 97% against the rand vault's
   102 954%. That file's part 1 deliberately carried no `Budgets/` at all and
   said so in a comment, because the defect was not its to fix and a fixture
   that carried a budget could only have pinned the wrong number as expected.

   THE SHAPE OF EVERY ASSERTION HERE is the one that file already uses, for
   the same reason: build one rand vault, then the SAME vault with a foreign
   account added, and require the figure to be IDENTICAL. It needs no expected
   constant, so nothing about it can be tuned to whatever the code happens to
   do.

   Driven through the REAL loader and the REAL trend-math registration — the
   whole defect is in which rows reach the arithmetic, which a pure test of
   the arithmetic cannot see.

     node tests/trend-foreign-isolation.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---|---:|---|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n\n${HEAD}`
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |  |\n`).join('');

/* Two periods, so `compareTotals` has a completed baseline to build from and
   the comparison column is a live surface rather than a null. */
const MONTHS = ['2026-07', '2026-08'];

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fun.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-08-01\n---\n',
};

function randVault() {
  const files = { ...BASE };
  for (const m of MONTHS) {
    files[`${B}/Transactions/Cheque/${m}.md`] = txFile([
      [`${m}-01`, 'Salary', 'Salary', 30000],
      [`${m}-05`, 'Grocer', 'Groceries', -4000],
      [`${m}-11`, 'Cinema', 'Fun', -600],
      // a refund inside a category that stays net-negative, so `spendOf`'s
      // netting is exercised on both vaults rather than only on the sum.
      [`${m}-14`, 'Refund', 'Groceries', 150],
    ]);
  }
  return files;
}

/* The SAME vault plus one small rupiah holiday account. Small in rupiah terms
   is enormous in rand terms, which is the entire point: nothing about the
   figure is wrong except that it is being added to rands. The categories it
   spends under are the household's own, so a leak lands INSIDE an existing
   bar rather than adding a new one — the shape that reads as a real month of
   overspending rather than as an obvious foreign row. */
function plusForeignAccount() {
  const files = randVault();
  files[`${B}/Accounts/Holiday.md`] =
    '---\ntype: checking\ncurrency: "Rp"\ntx_label: "Holiday"\nbalance: 5000000.00\nbalance_updated: 2026-08-01\n---\n';
  for (const m of MONTHS) {
    files[`${B}/Transactions/Holiday/${m}.md`] = txFile([
      [`${m}-02`, 'Freelance', 'Salary', 20000000],
      [`${m}-08`, 'Market', 'Groceries', -3000000],
      [`${m}-09`, 'Villa', 'Fun', -15000000],
    ]);
  }
  return files;
}

async function load(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  return ctx;
}

(async () => {

/* ---- 1. the per-category map, whole and part ---------------------------- */
{
  const home = await load(randVault());
  const mixed = await load(plusForeignAccount());

  const hw = home.periodSpend('2026-08', null);
  const mw = mixed.periodSpend('2026-08', null);

  ok(Object.keys(hw.whole).length > 0,
    'the rand fixture actually spends something — an empty map would satisfy every comparison below vacuously');

  eq(mw.whole, hw.whole,
    'periodSpend\'s per-category map is the household\'s own currency only — a rupiah market trip is not rand groceries');

  /* `count` feeds two decisions: compareTotals skips a period with none, and
     health-data's `counted` flag drops it out of the trailing average. A
     count that includes foreign rows says the vault covers a period it covers
     only in another currency. */
  eq(mw.count, hw.count,
    'and so is the row count that decides whether a period is covered at all');

  /* The capped window, which the comparison column reads for its baseline.
     Same filter, or the "vs last period" figure is measured by different
     rules than the figure it is subtracted from. */
  const hp = home.periodSpend('2026-07', 20);
  const mp = mixed.periodSpend('2026-07', 20);
  eq(mp.part, hp.part, 'the part-period window is filtered the same way as the whole');
  eq(mp.whole, hp.whole, 'and the whole period beside it');
}

/* ---- 2. the comparison baseline built on top of it ---------------------- */
{
  const home = await load(randVault());
  const mixed = await load(plusForeignAccount());

  const hc = home.compareTotals(1, null);
  const mc = mixed.compareTotals(1, null);
  ok(hc && hc.counted === 1, 'the rand fixture has exactly one completed period to compare against');
  eq(mc, hc, 'compareTotals — totals, full and counted — is unchanged by a foreign account');
}

/* ---- 3. and the hero it is printed beside -------------------------------
   periodSummary() has filtered foreign rows since ISSUE 28. The whole point
   of narrowing periodSpend is that the two now agree about which ROWS are
   household money; asserting on the DIFFERENCE between them (rather than on
   either alone) is what makes this a seam test rather than a second copy of
   the assertions above.

   The two figures are still ALLOWED to differ, and do: the hero is GROSS
   outgoings and the comparison column is NET per category, so the R150
   refund inside Groceries is subtracted from one and not the other. That gap
   is a design decision the donut's own note states out loud (and
   tests/cross-page-consistency.test.cjs pins in general). What must not
   survive is any OTHER difference — a foreign leak into either side shows up
   here as millions, not as a refund. */
{
  const REFUND = 150;   // the one row in this fixture that nets a category off
  const mixed = await load(plusForeignAccount());
  const sum = mixed.periodSummary('2026-08');
  const whole = mixed.periodSpend('2026-08', null).whole;
  const trendTotal = Object.values(whole).reduce((t, v) => t + v, 0);

  eq(sum.uncatSpend, 0, 'the fixture holds no uncategorised spend, so netting is the only gap to account for');
  eq(Math.round(trendTotal * 100), Math.round((sum.spend - REFUND) * 100),
    'the comparison column and the hero differ by the refund and by nothing else — neither has read a rupiah row');
}

console.log(`PASS  trend-foreign-isolation.test.cjs  (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
