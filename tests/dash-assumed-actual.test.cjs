'use strict';
/* One assume-spent category, two pages, two different Actuals.

   `assume_spent` says "this category's money was already committed in an
   earlier period, so no transaction here will match it". The toggle's own
   tooltip merely ASSERTS that no transaction will land in it, and a reader can
   always contradict that by paying the bill from a tracked account anyway.
   Both pages once read the assumption as gospel and doubled the category; both
   were fixed, but only ONE of them was fixed correctly:

     Budget page (views/budgets.js)      actual = max(budgeted, realSpend)
     Dashboard table (views/dashboard.js) actual = budgeted, real spend DROPPED

   dashboard.js seeded the row with `actual: assumed ? b.amount : 0` and then
   `if (existing && existing.assumed) continue;` skipped the transaction pass
   for it — citing views/budgets.js's own older `assumed ? d.amount : …`, which
   by then had become the max(). So a Carry category budgeted R2 500 against a
   real R4 000 payment read:

     Budget page      Actual R4 000, red, over budget
     Dashboard table  Actual R2 500, on budget
     Report + export  R2 500 — budgetVsActualRows is the ONE source both read

   The reader is over by R1 500 and three of the four surfaces say they are
   fine. This repo's recurring bug shape, in its exact classic form: two
   figures for one quantity, derived by two rules.

   Pinned by mounting BOTH real views on ONE ctx — the same registration order
   controller.js uses — and comparing what each actually renders for the same
   category in the same period. A test that called one function twice would
   have stayed green through the whole defect.
     node tests/dash-assumed-actual.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const txFile = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n`
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |\n`).join('');

/* Carry carries the flag; Groceries is the ordinary control beside it, so a
   fix that flattened every row to its budget would fail here too. */
function vaultWith(carrySpend) {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Carry.md`]: '---\ntype: expense\ncolor: "#c0392b"\nassume_spent: true\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000\nbalance_updated: 2026-08-01\n---\n',
    [`${B}/Budgets/2026-08.md`]:
      '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Carry | expense | 2500.00 |  |\n| Groceries | expense | 1000.00 |  |\n',
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ...(carrySpend ? [['2026-08-06', 'Landlord', 'Carry', -carrySpend]] : []),
      ['2026-08-09', 'Shop', 'Groceries', -400],
    ]),
  };
}

async function mount(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  // dashboard before budgets, the order controller.js registers them in.
  require('../src/views/dashboard')(ctx);
  require('../src/views/budgets')(ctx);
  return { ctx, $ };
}

const moneyFrom = text => {
  const m = /R\s*(-?[\d.]+)/.exec(String(text || ''));
  return m ? Number(m[1]) : NaN;
};

/* The Actual cell the BUDGET page renders for one category, read off the row
   rather than recomputed — the whole point is what reaches the screen. */
function budgetActual($, cat) {
  const table = $('#budTable');
  for (const tr of descend(table).filter(n => n.tagName === 'TR')) {
    if (tr._cls.has('type-row')) continue;
    const cells = tr.children.filter(c => c.tagName === 'TD');
    if (cells.length < 4) continue;
    if (!String(cells[0].textContent || '').startsWith(cat)) continue;
    return { value: moneyFrom(cells[3].textContent), over: cells[3]._cls.has('text-danger') };
  }
  return null;
}

(async () => {
  /* ---- 1. real spend past the assumption: both pages must say R4 000 ---- */
  {
    const { ctx, $ } = await mount(vaultWith(4000));
    ctx.renderBudgets();
    const rows = ctx.budgetVsActualRows('2026-08');
    const dashCarry = rows.find(r => r.cat === 'Carry');
    const budCarry = budgetActual($, 'Carry');

    ok(dashCarry, 'the Dashboard table has a row for the assume-spent category');
    ok(budCarry, 'and so does the Budget page');
    eq(budCarry.value, 4000,
      'the Budget page shows the real payment, which overran the assumption');
    eq(dashCarry.actual, 4000,
      `the Dashboard shows the SAME figure — it is the source the Report and both exports read too (got ${dashCarry.actual})`);
    ok(budCarry.over, 'the Budget page calls R4 000 against a R2 500 budget over');
    ok(dashCarry.actual > dashCarry.budget,
      'and the Dashboard row is over its budget by the same arithmetic, not "on budget"');
  }

  /* ---- 2. the assumption still stands when nothing really moved ----
     The flag's whole purpose. A fix that simply deleted the seed would pass
     test 1 and break this, which is the regression that made the seed
     necessary in the first place. */
  {
    const { ctx, $ } = await mount(vaultWith(0));
    ctx.renderBudgets();
    const dashCarry = ctx.budgetVsActualRows('2026-08').find(r => r.cat === 'Carry');
    eq(budgetActual($, 'Carry').value, 2500, 'no transaction: the Budget page stands on the assumption');
    eq(dashCarry.actual, 2500, 'and so does the Dashboard');
    ok(dashCarry.assumed, 'the row still knows it is an assumption, so the table can label it');
  }

  /* ---- 3. real spend UNDER the assumption does not accumulate ----
     The original doubling bug: R2 500 assumed plus R900 really paid must not
     read R3 400 anywhere. max(), not +. */
  {
    const { ctx, $ } = await mount(vaultWith(900));
    ctx.renderBudgets();
    const dashCarry = ctx.budgetVsActualRows('2026-08').find(r => r.cat === 'Carry');
    eq(budgetActual($, 'Carry').value, 2500, 'the Budget page holds at the assumption');
    eq(dashCarry.actual, 2500,
      `the Dashboard does not pile the real payment on top of the seed (got ${dashCarry.actual})`);
  }

  /* ---- 4. the ordinary row beside it is untouched ---- */
  {
    const { ctx, $ } = await mount(vaultWith(4000));
    ctx.renderBudgets();
    const dashFood = ctx.budgetVsActualRows('2026-08').find(r => r.cat === 'Groceries');
    eq(budgetActual($, 'Groceries').value, 400, 'an ordinary category reads its own net spend');
    eq(dashFood.actual, 400, 'on both pages');
  }

  console.log(`PASS — an assume-spent category reads the same Actual on the Budget page, the Dashboard table, the Report and the exports (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
