'use strict';
/* Assume-spent overlap — a category that carries `assume_spent: true` AND
   actually transacts in the period.

   catAssumeSpent is offered on every non-income, non-transfer row, and its
   tooltip only ASSERTS no transaction will arrive for it — nothing stops a
   real one landing anyway. Before this fix, "Total spent" added the WHOLE
   budgeted amount on top of periodSummary's real spend regardless: a
   category budgeted R4 000, assumed spent, that also spent R3 000 for real
   read R7 000 (175% of budget used) when only R3 000 had actually moved. The
   row's own Actual cell had the same shape of bug, always reading the raw
   budgeted amount no matter what periodSummary already knew.

   The fix: the assumed OVERLAY is only the SHORTFALL beyond what already
   happened — max(0, amount - realSpend) — and a row's own Actual is
   max(amount, realSpend), so real spend that overruns the assumption shows
   up as overspending rather than disappearing into a flat "already spent".

   Two invariants, pinned so a category with both a flag AND real
   transactions can never double-count itself again:

     1. real spend UNDER the assumed amount: "Total spent" == real spend +
        shortfall == the budgeted amount, not real spend + the WHOLE amount
     2. real spend OVER the assumed amount: the assumption contributes
        NOTHING extra — "Total spent" == real spend exactly, and the row
        itself is flagged over

   Runs in bare node against the REAL loader and the REAL budgets view over
   the shared DOM stub. Wired into ./build.sh.
     node tests/budget-assume-spent-overlap-guard.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';

function filesWith(realSpend) {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\nassume_spent: true\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Groceries | expense | 4000.00 | |\n| Salary | income | 10000.00 | |\n',
    [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-07-01 | Salary | Salary | 10000.00 |  |  |  |\n'
      + `| 2026-07-06 | Grocer | Groceries | -${realSpend.toFixed(2)} |  |  |  |\n`,
  };
}

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'transactions', 'budgets']) require(`../src/views/${f}`)(ctx);
  return { ctx, S, $ };
}

(async () => {
  /* ---- 1. real spend UNDER the assumed amount ---- */
  {
    const { ctx, $ } = await mount(filesWith(3000));
    ctx.renderBudgets();
    const totals = $('#budTotalsTop').textContent;
    ok(totals.includes('R 4000.00'),
      'Total spent = 3000 real (already in periodSummary) + 1000 shortfall = 4000, the budgeted figure — not 7000');
    ok(!totals.includes('R 7000.00'), 'never the naive real-spend-plus-whole-amount double count');

    const rowText = $('#budTable').textContent;
    ok(rowText.includes('R 4000.00'),
      'the row\'s own Actual agrees with the tile: also 4000, not the untouched budgeted figure read blind of real spend');
  }

  /* ---- 2. real spend OVER the assumed amount ---- */
  {
    const { ctx, $ } = await mount(filesWith(5500));
    ctx.renderBudgets();
    const totals = $('#budTotalsTop').textContent;
    ok(totals.includes('R 5500.00'),
      'real spend already overran the assumption, so the overlay contributes nothing extra: Total spent == real spend exactly');
    ok(!totals.includes('R 9500.00'), 'never 4000 (assumed) stacked on top of 5500 (real)');

    const rowText = $('#budTable').textContent;
    ok(rowText.includes('R 5500.00'), 'the row\'s Actual also reads the real, larger figure');
  }

  console.log(`PASS — an assume-spent category that also transacts is never double-counted (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
