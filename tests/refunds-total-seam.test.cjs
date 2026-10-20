'use strict';
/* "R X in refunds not taken off this figure" must name every refund.

   The Dashboard hero and the Budget strip print gross Total spent (ADR-0005)
   with a sentence beside it naming the refunds the figure does not subtract.
   That sentence read the donut's gap (categoryGap().netted), and the gap is a
   different quantity: the donut floors each category's net at zero, so a
   category whose refunds outran its own spend in the period contributes only
   its spend to the gap, never the refund above it. On the vault the
   2026-10-20 audit ran against, one month's sentence named about a third of
   the refunds that actually came in (audit M1-02), and the Report for the same
   month printed both numbers in one document.

   The fix is a field, not a second walk: tally() counts isRefund() rows over
   the very rows its lens kept, and summaryInRange hands it on as `refunds`.
   Pinned here:

     1. tally(BUDGET).refunds is the sum of isRefund() over the kept rows,
        recomputed independently from the rows;
     2. a refund larger than its category's spend is counted in full, so the
        total exceeds the donut gap's `netted` exactly by the overflow;
     3. Excluded refunds, income, transfers and uncategorised inflows are not
        refunds;
     4. summaryInRange (periodSummary's window) carries the same figure.

     node tests/refunds-total-seam.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { tally, LENSES, isRefund } = require('../src/ledger');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const cents = v => Math.round(v * 100);
const eqMoney = (a, b, m) => { assert.strictEqual(cents(a), cents(b), `${m} (got ${a}, want ${b})`); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |  |\n`).join('')}`;

const files = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ninput_mode: manual\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Clothing.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Move.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-08-31\n---\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
    ['2026-08-01', 'Pay', 'Salary', 5000],
    ['2026-08-03', 'Shop', 'Groceries', -400],
    ['2026-08-05', 'Shop refund', 'Groceries', 60],
    // a refund for a purchase made in an earlier period: bigger than this
    // period's own Clothing spend
    ['2026-08-07', 'Jacket', 'Clothing', -100],
    ['2026-08-09', 'Coat returned', 'Clothing', 900],
    ['2026-08-11', 'Excluded refund', 'Groceries', 70, 'yes'],
    ['2026-08-13', 'Card payment', 'Move', 300],
    ['2026-08-15', 'Mystery money', '', 45],
  ]),
};

(async () => {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';

  const t = tally(ctx.ledger('2026-08-01', '2026-08-31'), LENSES.BUDGET);
  const oracle = t.kept.filter(isRefund).reduce((s, r) => s + r.amount, 0);

  // 1. the field exists and is the isRefund sum over the kept rows
  ok(Number.isFinite(t.refunds), 'tally() returns a numeric `refunds`');
  eqMoney(t.refunds, oracle, 'tally(BUDGET).refunds = sum of isRefund over kept rows');
  // 2. both refunds in full: 60 + 900
  eqMoney(t.refunds, 960, 'a refund bigger than its category spend counts in full');
  const gap = ctx.categoryGap('2026-08');
  // the donut floors Clothing at zero: its gap share is the 100 spent, not the 900 back
  eqMoney(gap.netted, 160, 'the donut gap nets only up to each category spend');
  ok(t.refunds > gap.netted, 'the refunds total exceeds the donut gap by the overflow');
  // 3. none of these is a refund
  eqMoney(t.refunds - 960, 0, 'Excluded refund, transfer, income and uncategorised inflow left out');
  // 4. the period seam carries it
  const sum = ctx.summaryInRange('2026-08-01', '2026-08-31');
  eqMoney(sum.refunds, t.refunds, 'summaryInRange.refunds === tally(BUDGET).refunds');
  eqMoney(ctx.periodSummary('2026-08').refunds, t.refunds, 'periodSummary carries refunds');

  console.log(`PASS — refunds total seam (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
