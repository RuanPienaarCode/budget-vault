'use strict';
/* The plan figures: one snapshot of "what this budget plans", read by three pages.

   On 1.41.1 "whole plan" (spend + set-aside envelopes), "allocated of
   income", the income it is measured against and "over-budgeted" were
   assembled separately on the Dashboard hero, the Budget page's totals strip
   and the Report — money-flow.js owned the RULE (allocatedShare,
   incomeBaseFor) but each surface gathered the operands itself, and the
   Budget page carried a comment admitting it mirrored the hero's denominator
   logic by hand. ADR-0006 said views render a snapshot and walk no rows;
   these were the last three walkers.

   planFigures(p, { rows }) owns the assembly. `rows` is for the Budget page,
   whose strip moves with the unsaved draft; every other reader takes the
   saved file through periodFigures(p).plan. Expected values below are worked
   by hand from the fixture, never from the code.

   Runs in bare node against the REAL loader, period, figures and views.
     node tests/plan-figures.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${m} (got ${a}, want ${b})`); checks++; };

const B = 'Budget';
const TX = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r} |`).join('\n') + '\n';
const BUDGET = rows => '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
  + rows.map(r => `| ${r} |`).join('\n') + '\n';

/* The worked example, August 2026 (month_start_day 1):
     plan:    Salary (income) 15 000 · Groceries 10 000 · Emergency (savings-typed) 2 000
     actual:  salary arrived 14 000 · groceries so far 3 000
   whole plan 12 000 = 10 000 + 2 000; allocated 12 000 / 15 000 = 80%;
   left to budget 15 000 − 12 000 = 3 000; the plan's income (15 000) is not
   the income that arrived (14 000), so the hero must say which it divides by. */
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Categories/Emergency.md`]: '---\ntype: savings\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 10000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: TX([
    '2026-08-01 | Salary | Salary | 14000.00 | | | ',
    '2026-08-05 | Groceries | Groceries | -3000.00 | | | ',
  ]),
};
const WITH_INCOME = { ...BASE, [`${B}/Budgets/2026-08.md`]: BUDGET([
  'Salary | income | 15000.00 | ', 'Groceries | expense | 10000.00 | ', 'Emergency | savings | 2000.00 | ']) };
const NO_INCOME = { ...BASE, [`${B}/Budgets/2026-08.md`]: BUDGET([
  'Groceries | expense | 10000.00 | ', 'Emergency | savings | 2000.00 | ']) };

async function mount(files) {
  const ctx = makeCtx(files, { budgetFolder: B });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  return { ctx, S };
}
async function mountView(files, view) {
  const { ctx, S } = await mount(files);
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.typeBadge = type => { const { el } = require('../src/dom'); return el('span', {}, type); };
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  require(`../src/views/${view}`)(ctx);
  return { ctx, S, nodes, text: id => (nodes.get(`#${id}`) || { textContent: '' }).textContent };
}

(async () => {
  /* ---- 1. the seam, on a running period with an income row ---------------- */
  {
    const unpin = pinClock('2026-08-20');
    try {
      const { ctx } = await mount(WITH_INCOME);
      const plan = ctx.planFigures('2026-08');
      eq({ total: plan.total, spend: plan.spend, setAside: plan.setAside, income: plan.income, hasIncomeRow: plan.hasIncomeRow,
        actualIncome: plan.actualIncome, periodFinished: plan.periodFinished, incomeBase: plan.incomeBase, baseDiffers: plan.baseDiffers, unallocated: plan.unallocated },
      { total: 12000, spend: 10000, setAside: 2000, income: 15000, hasIncomeRow: true,
        actualIncome: 14000, periodFinished: false, incomeBase: 15000, baseDiffers: true, unallocated: 3000 },
      'the whole plan, its income, the base it is measured against, and what is left to budget');
      near(plan.allocated, 0.8, 'allocated = whole plan / the income the plan states');
      eq(ctx.periodFigures('2026-08').plan, plan, 'periodFigures(p).plan is the same snapshot');
    } finally { unpin(); }
  }

  /* ---- 2. no income row, period still running: nothing honest to divide by */
  {
    const unpin = pinClock('2026-08-20');
    try {
      const { ctx } = await mount(NO_INCOME);
      const plan = ctx.planFigures('2026-08');
      eq({ income: plan.income, hasIncomeRow: plan.hasIncomeRow, incomeBase: plan.incomeBase, allocated: plan.allocated, unallocated: plan.unallocated, baseDiffers: plan.baseDiffers },
        { income: 0, hasIncomeRow: false, incomeBase: 0, allocated: null, unallocated: null, baseDiffers: false },
        'mid-period with no income row there is no share and no "left to budget" — a part-period income is not a base');
    } finally { unpin(); }
  }

  /* ---- 3. no income row, period finished: actual income stands in -------- */
  {
    const unpin = pinClock('2026-09-05');
    try {
      const { ctx } = await mount(NO_INCOME);
      const plan = ctx.planFigures('2026-08');
      eq({ periodFinished: plan.periodFinished, incomeBase: plan.incomeBase, unallocated: plan.unallocated, baseDiffers: plan.baseDiffers },
        { periodFinished: true, incomeBase: 14000, unallocated: 2000, baseDiffers: false },
        'once the period is finished the settled actual income is the base, and it IS the income that arrived');
      near(plan.allocated, 12000 / 14000, 'allocated against the income that arrived');
    } finally { unpin(); }
  }

  /* ---- 4. an unsaved draft: the Budget page's rows, inFile respected ------ */
  {
    const unpin = pinClock('2026-08-20');
    try {
      const { ctx } = await mount(WITH_INCOME);
      const draft = [
        { category: 'Groceries', type: 'expense', amount: 4000, inFile: true },
        { category: 'Salary', type: 'income', amount: 0, inFile: false },   // seeded, never asked
      ];
      const plan = ctx.planFigures('2026-08', { rows: draft });
      eq({ total: plan.total, income: plan.income, hasIncomeRow: plan.hasIncomeRow, unallocated: plan.unallocated },
        { total: 4000, income: 0, hasIncomeRow: false, unallocated: null },
        'a seeded zero income row is not an income row');
      draft[1].inFile = true;
      const touched = ctx.planFigures('2026-08', { rows: draft });
      eq({ hasIncomeRow: touched.hasIncomeRow, unallocated: touched.unallocated, allocated: touched.allocated },
        { hasIncomeRow: true, unallocated: -4000, allocated: null },
        'an income row deliberately set to 0 is a row: the whole plan is over-budgeted, and there is still no share');
    } finally { unpin(); }
  }

  /* ---- 5. the Dashboard hero prints the snapshot ------------------------- */
  {
    const unpin = pinClock('2026-08-20');
    try {
      const { ctx, text } = await mountView(WITH_INCOME, 'dashboard');
      ctx.renderDashboard();
      const hero = text('heroCard');
      ok(hero.includes('R 12000.00'), `hero "Budgeted" is the whole plan (got: ${hero.slice(0, 240)})`);
      ok(hero.includes('80% of the R 15000 income this budget plans for'),
        'and names the plan\'s own income as the base, because it is not the income that arrived');
    } finally { unpin(); }
  }

  /* ---- 6. the Budget page's totals strip prints the same snapshot -------- */
  {
    const unpin = pinClock('2026-08-20');
    try {
      const { ctx, text } = await mountView(WITH_INCOME, 'budgets');
      ctx.renderBudgets();
      const strip = text('budTotalsTop');
      ok(strip.includes('R 12000.00'), `strip "Total budgeted" is the whole plan (got: ${strip.slice(0, 300)})`);
      ok(strip.includes('80% of budgeted income'), 'and its share of the plan\'s income');
      ok(strip.includes('Left to budget') && strip.includes('R 3000.00'), 'and what is left to budget');
    } finally { unpin(); }
    const unpin2 = pinClock('2026-09-05');
    try {
      const { ctx, text } = await mountView(NO_INCOME, 'budgets');
      ctx.renderBudgets();
      const strip = text('budTotalsTop');
      ok(strip.includes('Left to budget') && strip.includes('R 2000.00'),
        'finished period, no income row: the settled actual income stands in, as the hero\'s rule says');
      ok(/% of budgeted income/.test(strip),
        'and the share is stated by the same rule the hero uses — it used to be blank here alone');
    } finally { unpin2(); }
  }

  /* ---- 7. the gate: no page assembles the plan itself ------------------- */
  {
    const SRC = path.join(__dirname, '..', 'src');
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'lang') walk(p); } else if (e.name.endsWith('.js')) files.push(p); } })(SRC);
    const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const OWNERS = new Set(['figures.js', 'money-flow.js']);
    const RULES = [
      [/allocatedShare\(/, 'a page computing the allocated share itself (figures.js planFigures owns the operands)'],
      [/incomeBaseFor\(/, 'a page choosing the income base itself'],
      [/\.spend \+ \(\w+\.setAside \|\| 0\)/, 'a page adding the whole plan itself'],
      [/\bincome - budgeted\b/, 'a page computing "left to budget" itself'],
      [/budgeted \/ income\b/, 'a page dividing the plan by income itself'],
    ];
    const hits = [];
    for (const fp of files) {
      const rel = path.relative(SRC, fp);
      if (OWNERS.has(rel)) continue;
      code(fs.readFileSync(fp, 'utf8')).split('\n').forEach((line, i) => {
        for (const [re, why] of RULES) if (re.test(line)) hits.push(`${rel}:${i + 1} ${why}: ${line.trim()}`);
      });
    }
    eq(hits, [], 'every page reads the plan snapshot');
  }

  console.log(`PASS — plan figures: one snapshot of the plan, read by the hero, the strip and the report (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
