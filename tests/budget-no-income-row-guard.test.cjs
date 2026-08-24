'use strict';
/* "Over-budgeted · budgeted beyond income" must not fire on a vault that
   never named an income row at all.

   `income` in budgetTotalsStrip is BUDGETED income, summed off the draft. With
   no income-typed row present it is 0 by construction — not because nothing
   was earned, simply because nothing was ASKED. Before this fix, `unallocated
   = income - budgeted` then read as the whole spend budget, negative, and the
   tile asserted "Over-budgeted" in red on a vault that had budgeted
   perfectly reasonably and simply never filled in an income line. Five of
   this vault's eight budget files carry no income row in practice — this is
   the normal case, not the corner (see renderHero's incomeBase, dashboard.js,
   for the same fix on the same shape of denominator problem).

   Two invariants:

     1. running period, no income row: neither "Left to budget" nor
        "Over-budgeted" is shown at all — there is no honest number
     2. a FINISHED period with no income row falls back to actual income,
        exactly like renderHero's incomeBase does

   The "running period" key is derived from the real system clock the way
   currentPeriod() itself derives it (month_start_day: 1, so it is always
   this calendar month) — hard-coding a fixed month would eventually go
   stale and start exercising the "finished" branch by accident.

   Runs in bare node against the REAL loader and the REAL budgets view over
   the shared DOM stub. Wired into ./build.sh.
     node tests/budget-no-income-row-guard.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';

const now = new Date();
const RUNNING = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
// A period two calendar years back is finished under any month_start_day.
const FINISHED = `${now.getFullYear() - 2}-01`;

function filesFor(period) {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    // A real income-typed category exists — it is simply never given a row in
    // this period's BUDGET file, which is the whole point of the fixture.
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-06-01\n---\n',
    // No income-typed row anywhere in this budget file, on purpose.
    [`${B}/Budgets/${period}.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Groceries | expense | 4000.00 | |\n',
    [`${B}/Transactions/Cheque/${period}.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + `| ${period}-01 | Salary | Salary | 10000.00 |  |  |  |\n`
      + `| ${period}-06 | Grocer | Groceries | -3000.00 |  |  |  |\n`,
  };
}

async function mount(period) {
  const ctx = makeCtx(filesFor(period));
  const S = await loadInto(ctx);
  S.period = period;
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
  /* ---- 1. running period: neither tile fires ---- */
  {
    const { ctx, S, $ } = await mount(RUNNING);
    ok(S.period === ctx.currentPeriod(), 'sanity: this IS the running period');
    ctx.renderBudgets();
    const totals = $('#budTotalsTop').textContent;
    ok(!totals.includes('Over-budgeted'),
      'no income row and a running period: never asserts over-budgeted against a denominator nobody stated');
    ok(!totals.includes('Left to budget'),
      'and no false "left to budget" either — there is no honest income figure to measure against yet');
  }

  /* ---- 2. finished period: falls back to actual income ---- */
  {
    const { ctx, $ } = await mount(FINISHED);
    ok(FINISHED !== ctx.currentPeriod(), 'sanity: this is NOT the running period');
    ctx.renderBudgets();
    const totals = $('#budTotalsTop').textContent;
    // The fallback income here is the R10 000 Salary-named deposit — real,
    // settled, and known once the period is over, unlike a running period's
    // part-month figure.
    ok(totals.includes('Left to budget'),
      'a finished period falls back to actual income (10 000) against 4 000 budgeted -> 6 000 left, like renderHero\'s incomeBase');
  }

  console.log(`PASS — no false "over-budgeted" on a vault that never named an income row (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
