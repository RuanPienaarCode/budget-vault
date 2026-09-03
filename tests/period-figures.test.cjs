'use strict';
/* Period figures have one owner, and the views render them. Phase 3 of
   ADR-0006.

   Three arithmetic rules about a period's budget table and category split
   were written in three places on 1.38.0 — "remaining", the "unbudgeted"
   flag and the donut's gap into uncategorised and netted parts — and one of
   them had already drifted (the Dashboard's `unbudgeted` excluded
   assume-spent rows; the report serialiser's did not, so the same row could
   be "unbudgeted" in the Markdown and on budget on screen). They now live in
   money-flow.js (budgetRowStatus, categoryGap) and reach every page through
   src/figures.js.

   What this suite pins:
     1. the two pure rules, including the case that had drifted;
     2. periodFigures(p) is one object with the summary, the budget, the
        rows WITH their status, the split and the gap, and the gap satisfies
        its identity against the summary;
     3. the Dashboard's table and donut note, the Report page's data and the
        serialiser's Markdown all print the snapshot's figures, through the
        real views over the DOM stub;
     4. a grep gate: the old arithmetic exists nowhere in src/ outside the
        two owners.

     node tests/period-figures.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { budgetRowStatus, categoryGap } = require('../src/money-flow');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const c = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };
const eqMoney = (a, b, m) => eq(c(a), c(b), `${m} (got ${a}, want ${b})`);

/* ---- 1. the pure rules -------------------------------------------------- */
{
  eq(budgetRowStatus({ budget: 1000, actual: 400, type: 'expense' }),
    { remaining: 600, unbudgeted: false, over: false, near: false, pct: 40 }, 'an ordinary row');
  eq(budgetRowStatus({ budget: 1000, actual: 900, type: 'expense' }).near, true, 'near at 85%+');
  eq(budgetRowStatus({ budget: 1000, actual: 1200, type: 'expense' }),
    { remaining: -200, unbudgeted: false, over: true, near: false, pct: 100 }, 'over budget, bar capped at 100');
  eq(budgetRowStatus({ budget: 0, actual: 300, type: 'expense' }),
    { remaining: -300, unbudgeted: true, over: false, near: false, pct: 100 }, 'spend nobody budgeted');
  eq(budgetRowStatus({ budget: 0, actual: 300, type: 'income' }).unbudgeted, false, 'income is never "unbudgeted"');
  eq(budgetRowStatus({ budget: 0, actual: 300, type: 'expense', assumed: true }).unbudgeted, false,
    'an assume-spent row is consumed by construction, never unbudgeted — the rule the serialiser had lost');
  eq(budgetRowStatus({ budget: 0, actual: 0, type: 'expense' }).pct, 0, 'nothing budgeted, nothing spent: an empty bar');

  eq(categoryGap({ spend: 1000, uncatSpend: 150, rows: [{ amount: 600 }, { amount: 200 }] }),
    { total: 800, notShown: 200, uncat: 150, netted: 50 }, 'gap = gross − split, uncategorised first, the rest is netting');
  eq(categoryGap({ spend: 700, uncatSpend: 500, rows: [{ amount: 600 }] }),
    { total: 600, notShown: 100, uncat: 100, netted: 0 }, 'uncategorised is clamped to the gap it can explain');
  eq(categoryGap({ spend: 500, uncatSpend: 0, rows: [{ amount: 600 }] }).notShown, 0, 'a split larger than gross spend (rounding) is a zero gap, never negative');
}

/* ---- fixture: every row shape the table and the split care about ------- */
const B = 'Budget';
const P = '2026-07';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |\n`).join('')}`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fuel.md`]: '---\ntype: transport\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Carry.md`]: '---\ntype: expense\ncolor: "#888888"\nassume_spent: true\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-31\n---\n',
  [`${B}/Budgets/${P}.md`]: '---\ntags: [finance, finance/budget]\n---\n\n| Category | Type | Amount |\n|---|---|---:|\n| Salary | income | 30000.00 |\n| Groceries | expense | 6000.00 |\n| Carry | expense | 2500.00 |\n',
  [`${B}/Transactions/Cheque/${P}.md`]: txFile([
    ['2026-07-01', 'Salary', 'Salary', 30000],
    ['2026-07-03', 'Shop', 'Groceries', -5200],
    ['2026-07-04', 'Refund', 'Groceries', 300],
    ['2026-07-05', 'Petrol', 'Fuel', -900],          // spent, never budgeted
    ['2026-07-07', 'Cash', '', -700],                 // uncategorised
  ]),
};

(async () => {
  const ctx = makeCtx(FILES, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = P;

  /* ---- 2. the snapshot ------------------------------------------------- */
  const f = ctx.periodFigures(P);
  eq(f.period, P, 'the snapshot names its period');
  eqMoney(f.summary.spend, 5200 + 900 + 700, 'summary: gross spend');
  eqMoney(f.budget.spend, 8500, 'budget: the spend envelopes (Groceries + Carry)');
  const byCat = Object.fromEntries(f.rows.map(r => [r.cat, r]));
  eqMoney(byCat.Groceries.actual, 4900, 'rows: Groceries nets its refund');
  eqMoney(byCat.Groceries.remaining, 1100, 'rows: remaining rides with the row');
  eq(byCat.Fuel.unbudgeted, true, 'rows: Fuel is spend nobody budgeted');
  eq(byCat.Carry.assumed, true, 'rows: the carry row is assume-spent');
  eqMoney(byCat.Carry.actual, 2500, 'rows: and consumed at its budget');
  eq(byCat.Carry.unbudgeted, false, 'rows: never "unbudgeted"');
  eq(f.split.map(r => r.cat), ['Groceries', 'Fuel'], 'split: named outflow categories, largest first');
  eqMoney(f.gap.total, 4900 + 900, 'gap: the split total');
  eqMoney(f.gap.notShown, f.summary.spend - f.gap.total, 'gap identity: gross − split');
  eqMoney(f.gap.uncat, 700, 'gap: the uncategorised cash');
  eqMoney(f.gap.netted, 300, 'gap: the refund netted inside Groceries');
  eqMoney(f.gap.uncat + f.gap.netted, f.gap.notShown, 'gap: the two parts are the whole gap');
  ok(f.used && typeof f.used.used === 'number', 'used: the one budget-used reading rides along');

  /* ---- 3. the pages print the snapshot --------------------------------- */
  {
    const dom = makeDom();
    const { el } = require('../src/dom');
    Object.assign(ctx, { $: dom.$, root: dom.root, el, money: v => `R ${Number(v).toFixed(2)}`, toast() {}, switchView() {}, fileAt() { return null; }, app: { workspace: { getLeaf() { return { openFile() {} }; } } } });
    require('../src/views/dashboard')(ctx);
    ctx.renderDashboard();
    const table = dom.$('#dashBudget').textContent;
    ok(table.includes('R 1100.00'), 'Dashboard table: Groceries remaining is the snapshot\'s 1 100');
    ok(table.includes('R -900.00'), 'Dashboard table: Fuel\'s unbudgeted spend prints its negative remaining');
    const note = dom.$('#dashSplitSub').textContent;
    ok(note.includes('R 700.00') && note.includes('R 300.00'), 'Dashboard donut note: uncategorised 700 and netted 300, from categoryGap()');
  }
  {
    const { financialReportMarkdown } = require('../src/report');
    const rows = f.rows.map(r => ({ cat: r.cat, type: r.type, budget: r.budget, actual: r.actual, assumed: r.assumed }));
    const md = financialReportMarkdown({
      generated: 'x', periodLabel: 'Jul', rangeNote: '', periodCount: 1, detail: false, currency: 'R', household: 'R',
      income: f.summary.income, spend: f.summary.spend, net: f.summary.net, budgetIncome: 30000, budgetSpend: 8500,
      categories: rows, spendByCategory: f.split, categoryGap: { uncat: f.gap.uncat, netted: f.gap.netted },
      fundedFromSavings: { spend: 0, count: 0 }, scheduled: { income: 0, spend: 0, count: 0 },
      savings: null, debts: { rows: [], total: 0, perMonth: 0, interest: 0 }, netWorth: { net: 0, assets: 0, liabilities: 0 },
      health: null, otherCurrencies: [], foreign: { count: 0, symbols: [] },
    }, v => `R ${Number(v).toFixed(2)}`);
    /* The budget table's rows carry five cells (the spend-by-category table
       below it also lists Fuel, with three). */
    const carryLine = md.split('\n').find(l => l.startsWith('| Carry | expense |')) || '';
    ok(/\| R 0\.00 \|\s*$/.test(carryLine), `serialiser: Carry's remaining is 0.00 — consumed at its budget (line: ${carryLine})`);
    const fuelLine = md.split('\n').find(l => l.startsWith('| Fuel | transport |')) || '';
    ok(/R -900\.00/.test(fuelLine), `serialiser: Fuel prints its negative remaining as unbudgeted, the same rule as the Dashboard (line: ${fuelLine})`);
  }

  /* ---- 3b. the book: one reconcile pass, read by every card ------------- */
  {
    const book = ctx.bookFigures();
    eq(book.reconciled.size, ctx.S.accounts.length, 'every account is reconciled exactly once per book');
    ok(book.reconciled.get(ctx.S.accounts[0]) && 'state' in book.reconciled.get(ctx.S.accounts[0]), 'and the verdict is the reconcile() result itself');
    eq(Object.keys(book.drift).sort(), ['drift', 'driftForeign', 'driftUnplaced'], 'the drift note reads three figures off it');
    eq(book.overdrawn, 0, 'no account is overdrawn in this fixture');
    ok(book.stale && typeof book.stale.total === 'number', 'the stale summary rides along');
  }

  /* ---- 4. the gate ----------------------------------------------------- */
  {
    const SRC = path.join(__dirname, '..', 'src');
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'lang') walk(p); } else if (e.name.endsWith('.js')) files.push(p); } })(SRC);
    const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const OWNERS = new Set(['money-flow.js', 'figures.js', 'committed.js', 'savings-math.js', 'currency.js']);
    const RULES = [
      [/\.budget\s*-\s*\w+\.actual/, 'remaining computed by hand'],
      [/Math\.max\(0,\s*\w+\.spend\s*-\s*total\)/, 'the split gap computed by hand'],
      [/!\w+\.budget\s*&&\s*\w+\.actual\s*>\s*0/, 'the unbudgeted predicate computed by hand'],
      [/\.payment\s*\|\|\s*0\)\s*\+\s*\(\w+\.extra/, 'a debt\'s monthly commitment computed by hand (committed.js owns debtMonthly)'],
      [/rateGrowth\s*\/\s*\w+\.rateCapital/, 'the growth rate computed by hand (savings-math.js owns growthRate)'],
      [/\broundedSum\b/, 'primaryTotal written out longhand'],
      [/^\s*const rec = reconcile\(/, 'a view reconciling accounts itself (figures.js owns bookFigures)', 'views/'],
    ];
    const hits = [];
    for (const fp of files) {
      const rel = path.relative(SRC, fp);
      if (OWNERS.has(rel)) continue;
      code(fs.readFileSync(fp, 'utf8')).split('\n').forEach((line, i) => {
        for (const [re, why, only] of RULES) if (re.test(line) && (!only || rel.startsWith(only))) hits.push(`${rel}:${i + 1} ${why}: ${line.trim()}`);
      });
    }
    eq(hits, [], 'no view or serialiser recomputes a period figure the snapshot already carries');
  }

  console.log(`PASS — period figures: one snapshot, one row rule, one gap, and the pages print them (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
