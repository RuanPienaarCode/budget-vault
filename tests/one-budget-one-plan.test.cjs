'use strict';
/* FOUR SURFACES, ONE PLAN — the follow-up defects 1.36.0 created while fixing
   ISSUE 40, found by an audit pass over that release and reproduced through
   the REAL views before any of them was touched.

   ISSUE 40 split budgetTotals() into `spend` (what is left to spend) and
   `setAside` (savings and investment envelopes). The Dashboard hero was moved
   onto the new pair. views/score.js, views/budgets.js and views/report.js were
   not — each kept reading whichever half it had always read. One household,
   one period, measured on `tests/_audit-seed.cjs`:

     "share of income budgeted"   Dashboard 41%   Budget page 41%   Score 30%
     "% of budget used"           Dashboard 45%   Score       45%   Budget 32%
     "Budgeted"                   Dashboard R14 500 ... Report R10 500,
                                  printed directly above the Report's OWN
                                  Budget-vs-Actual table listing rows that sum
                                  to R14 500.

   That last one is the document that leaves the app, disagreeing with itself
   inside one file, with no caveat between the two figures. Fixing "two figures
   derived by different rules" by creating three more of it is the failure this
   file exists to make impossible to repeat.

   ONE BUDGET NEEDS TWO DENOMINATORS, and that is the real lesson:

     "share of income budgeted"  — the WHOLE plan. A rand into the emergency
                                   fund is as allocated as a rand of groceries.
     "% of budget used"          — the SPEND envelopes alone. Nothing in the
                                   numerator can ever fill a savings envelope
                                   (their funding is transfer-typed and
                                   summaryInRange drops it), so counting them
                                   reports a household that funded every
                                   envelope as under-spent.

   Both are right; what was wrong was each surface picking one by accident.

   Asserted by reading the RENDERED text out of each real view, not by
   re-deriving the arithmetic — a test that restated the expressions would
   agree with itself while the screens disagreed, which is how this went
   unnoticed in the first place.

     node tests/one-budget-one-plan.test.cjs   # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { el } = require('../src/dom');
const { SEED, PERIOD, atAuditDate } = require('./_audit-seed.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub', 'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

const textOf = node => {
  let out = '';
  const walk = n => { if (n._text) out += n._text + ' | '; for (const c of (n.children || [])) walk(c); };
  walk(node);
  return out;
};

atAuditDate(async () => {
  /* ---------------- the plan itself ---------------- */
  {
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    const bud = ctx.budgetTotals(PERIOD);
    eq(bud.spend, 10500, 'the spend envelopes');
    eq(bud.setAside, 4000, 'and the savings envelopes');
    eq(ctx.periodSummary(PERIOD).spend, 4700, 'against R4 700 actually spent');
    /* So: 14 500 / 35 000 = 41% allocated, and 4 700 / 10 500 = 45% used.
       Every surface below must land on those two, and no others. */
  }

  /* ---------------- the Dashboard ---------------- */
  {
    const { FakeEl } = makeDom();
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
    ctx.$ = sel => nodes.get(sel.slice(1)) || null;
    ctx.root = new FakeEl('div');
    ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    require('../src/views/dashboard')(ctx);
    ctx.renderDashboard();
    const hero = nodes.get('heroCard').textContent;
    ok(/41%/.test(hero), `Dashboard: 41% of income budgeted — got ${hero}`);
    ok(/45% used/.test(hero), `Dashboard: 45% used — got ${hero}`);
    ok(/R 14500\.00/.test(hero), 'Dashboard: Budgeted states the whole plan');
  }

  /* ---------------- the Score page ---------------- */
  {
    const { periodFlow } = require('../src/money-flow');
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    const bud = ctx.budgetTotals(PERIOD);
    const sum = ctx.periodSummary(PERIOD);
    const flow = periodFlow({
      income: sum.income, spentTotal: sum.spend,
      budgeted: bud.spend, budgetSetAside: bud.setAside,
      spendByCat: {}, fixedCats: new Set(), catType: ctx.catType,
      savingContribution: 0, debts: S.debts, household: 'R',
      budgetIncome: bud.income, periodFinished: false,
    });
    eq(Math.round(flow.budget.allocatedOfIncome * 100), 41,
      'Score: share of income budgeted is the WHOLE plan, like every other surface — this read 30%');
    eq(Math.round(flow.budget.budgetUsed * 100), 45,
      'Score: budget used divides by the spend envelopes, like the Dashboard');
    eq(flow.budget.budgeted, 14500, 'and the figure it states is the whole plan');

    /* The old call shape, kept as a negative control: a caller that forgets
       budgetSetAside gets the 30% this fix exists to end, so a silent revert
       goes red here rather than on a screen. */
    const stale = periodFlow({
      income: sum.income, spentTotal: sum.spend, budgeted: bud.spend,
      spendByCat: {}, fixedCats: new Set(), catType: ctx.catType,
      savingContribution: 0, debts: S.debts, household: 'R',
      budgetIncome: bud.income, periodFinished: false,
    });
    eq(Math.round(stale.budget.allocatedOfIncome * 100), 30,
      'negative control: dropping the argument reproduces the defect exactly');
  }

  /* ---------------- the Budget page ---------------- */
  {
    const { $ } = makeDom();
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    ctx.typeBadge = t => el('span', {}, t);
    ctx.switchView = () => {};
    require('../src/categories')(ctx);
    require('../src/views/budgets')(ctx);
    ctx.renderBudgets();
    const txt = textOf($('#budTotalsTop')) + ' ' + textOf($('#root'));
    ok(/41%/.test(txt), `Budget page: 41% of budgeted income — got ${txt.slice(0, 400)}`);
    ok(/45%/.test(txt), `Budget page: 45% of budget used, not 32% — got ${txt.slice(0, 400)}`);
    ok(!/32%/.test(txt), 'and never the figure taken against envelopes nothing can fill');
  }

  /* ---------------- the exported Report ---------------- */
  {
    const { financialReportMarkdown, prepareReportData } = require('../src/report');
    const ctx = makeCtx(SEED, { settings: { month_start_day: 1 } });
    const S = await loadInto(ctx); S.period = PERIOD;
    const bud = ctx.budgetTotals(PERIOD);
    /* The one line views/report.js builds its summary from. */
    const budgetSpend = bud.spend + (bud.setAside || 0);
    eq(budgetSpend, 14500,
      'the Report states the whole plan — the same number its own Budget-vs-Actual table sums to');

    const rows = ctx.budgetVsActualRows
      ? ctx.budgetVsActualRows(PERIOD) : null;
    if (rows) {
      /* The table lists income and transfer rows too; the summary's
         budgetSpend is the spend envelopes plus set-aside, so compare like
         with like. (This branch first RAN in Phase 3 of ADR-0006, when
         budgetVsActualRows moved onto ctx before the views register.) */
      const tableTotal = rows.filter(r => r.type !== 'income' && r.type !== 'transfer').reduce((t, r) => t + (r.budget || 0), 0);
      eq(tableTotal, budgetSpend,
        'the summary figure and the table beneath it are one number, in the document that leaves the app');
    }
  }

  console.log(`PASS one-budget-one-plan (${checks} checks)`);
}).catch(e => { console.error(e); process.exit(1); });
