'use strict';
/* One rule for "actual" on the Budget page and the Dashboard table.

   Until this audit the Budget page's Actual column read its own rule: it asked
   catAssumeSpent(category) with NO category-type guard, where figures.js and
   period.js both require `type !== 'income' && type !== 'transfer'`. An income
   category carrying assume_spent: true (a hand-edited file — the toggle is
   never offered on income) printed "R 30 000,00 / no transaction expected /
   already spent" on the Budget page while the Dashboard table beside it read
   the R 34 000 that really arrived. Two pages, one category, two figures.

   The fix is consolidation, not a second copy of the guard: the Budget page now
   renders budgetVsActualRows(p, { rows: draft }) — the rows the Dashboard
   draws, over the unsaved draft — so it has no actual/remaining rule of its own.

   This suite is synthetic (no real statement data). The household carries every
   shape that has made the two tables disagree: an assume-spent expense with no
   transaction, one with a smaller real spend, an assume-spent INCOME row, a
   refund, a split parent + its parts, an excluded row, and an income row that
   is under its plan. It asserts the two pages print the same actual and the
   same remaining, that both go through budgetVsActualRows, that typing an
   amount moves the row live, and (item 2) that an income row never prints a
   negative "left".

     node tests/budget-audit-actual-one-rule.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`;
const line = r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} | ${r[4] || ''} |  | ${r[5] || ''} |\n`;

const files = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
  /* Salary is INCOME and flagged assume_spent: the hand-edited contradiction. */
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\nassume_spent: true\n---\n',
  [`${B}/Categories/Side.md`]: '---\ntype: income\ncolor: "#33aa88"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Gym.md`]: '---\ntype: expense\ncolor: "#3366aa"\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: expense\ncolor: "#aa3366"\nassume_spent: true\n---\n',
  [`${B}/Categories/Carry.md`]: '---\ntype: expense\ncolor: "#aa6633"\nassume_spent: true\n---\n',
  [`${B}/Categories/Fun.md`]: '---\ntype: expense\ncolor: "#aa33aa"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 | |\n| Side | income | 1000.00 | |\n| Groceries | expense | 3000.00 | |\n'
    + '| Gym | expense | 500.00 | |\n| Rent | expense | 9000.00 | |\n| Carry | expense | 500.00 | |\n| Fun | expense | 200.00 | |\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: HEAD + [
    ['2026-07-01', 'Payroll', 'Salary', 34000],
    ['2026-07-03', 'Freelance', 'Side', 400],
    ['2026-07-02', 'Checkers', 'Groceries', -2500],
    ['2026-07-04', 'Checkers refund', 'Groceries', 300],
    /* The split: parent excluded by construction, parts carry the money. */
    ['2026-07-05', 'Takealot', 'Groceries', -600, 'yes', 'parent'],
    ['2026-07-05', 'Takealot', 'Groceries', -400, '', 'part'],
    ['2026-07-05', 'Takealot', 'Gym', -200, '', 'part'],
    ['2026-07-06', 'Petrol for Carry', 'Carry', -300],
    /* Excluded from the budget totals: must not reach any Actual. */
    ['2026-07-07', 'Refunded gift', 'Fun', -400, 'yes'],
  ].map(line).join(''),
});

async function mount() {
  const ctx = makeCtx(files());
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
  /* Count the callers of the rows seam BEFORE the views destructure it. */
  const calls = [];
  const real = ctx.budgetVsActualRows;
  ctx.budgetVsActualRows = (...a) => { calls.push(a); return real(...a); };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'transactions', 'budgets']) require(`../src/views/${f}`)(ctx);
  return { ctx, S, $, calls, real };
}

const catOf = tr => tr.children[0].children[0].textContent;
const trs = table => table.querySelectorAll('TR').filter(tr => tr.children.length > 1);
const amountIn = s => { const m = /R -?\d+\.\d\d/.exec(s); return m ? m[0] : null; };
const num = s => Number(/-?\d+\.\d\d/.exec(s)[0]);

(async () => {
  const { ctx, S, $, calls, real } = await mount();
  const rows = real(S.period);
  const byCat = new Map(rows.map(r => [r.cat, r]));

  ctx.renderBudgets();
  ctx.renderDashboard();

  const budRows = new Map(trs($('#budTable')).map(tr => [catOf(tr), tr]));
  const dashRows = new Map(trs($('#dashBudget')).map(tr => [catOf(tr), tr]));

  /* ---- item 5: both tables read the same rows function ---- */
  ok(calls.some(a => a[1] && Array.isArray(a[1].rows)),
    'the Budget page asks budgetVsActualRows for the rows, handing it the unsaved draft');
  ok(calls.some(a => !a[1]), 'the Dashboard asks budgetVsActualRows for the saved rows');

  /* ---- item 5: identical actual + remaining, category by category ---- */
  const cats = ['Salary', 'Side', 'Groceries', 'Gym', 'Rent', 'Carry', 'Fun'];
  for (const cat of cats) {
    const r = byCat.get(cat);
    ok(r, `${cat} has a row`);
    const bud = budRows.get(cat), dash = dashRows.get(cat);
    ok(bud && dash, `${cat} is on both pages`);
    eq(amountIn(bud.children[3].textContent), `R ${r.actual.toFixed(2)}`, `${cat}: Budget page Actual is the row's actual`);
    eq(amountIn(dash.children[2].textContent), `R ${r.actual.toFixed(2)}`, `${cat}: Dashboard Actual is the row's actual`);
    eq(amountIn(bud.children[3].textContent), amountIn(dash.children[2].textContent), `${cat}: the two pages print one Actual`);
  }

  /* Values, so a wrong rows function cannot pass by agreeing with itself. */
  eq(byCat.get('Salary').actual, 34000, 'income actual is what arrived, flag or no flag');
  eq(byCat.get('Salary').assumed, false, 'an income row is never assumed');
  eq(byCat.get('Rent').actual, 9000, 'assume-spent expense with no transaction reads its budget');
  eq(byCat.get('Carry').actual, 500, 'assume-spent expense with less real spend reads its budget, not the sum');
  eq(byCat.get('Groceries').actual, 2600, 'refund nets and the split parts count once (2500 - 300 + 400)');
  eq(byCat.get('Gym').actual, 200, 'a split part lands in its own category');
  eq(byCat.get('Fun').actual, 0, 'an excluded row reaches no Actual');

  /* ---- item 1: the income+flag repro, before/after ---- */
  const salary = budRows.get('Salary');
  ok(!salary.textContent.includes(i18n.t('bud.assumed.note')), 'income row never says "no transaction expected"');
  ok(!salary.textContent.includes(i18n.t('bud.assumed.tag')), 'income row never carries the "already spent" tag');
  eq(amountIn(salary.children[3].textContent), 'R 34000.00', 'Budget page Salary Actual is 34000, was 30000');

  /* Assume-spent EXPENSE keeps its tag, its note and the pull button. */
  const rent = budRows.get('Rent');
  ok(rent.textContent.includes(i18n.t('bud.assumed.tag')), 'assume-spent expense keeps the "already spent" tag');
  ok(rent.textContent.includes(i18n.t('bud.assumed.note')), 'with nothing spent, it says no transaction expected');
  ok(rent.querySelector('.bud-pull'), 'Fill from overspend is still offered on an assume-spent expense');
  eq(rent.querySelector('.bud-remaining').textContent, i18n.t('bud.remaining.assumed'), 'and its remaining line still reads "already spent"');
  const carry = budRows.get('Carry');
  ok(!carry.textContent.includes(i18n.t('bud.assumed.note')), 'some real spend: no "no transaction expected"');

  /* ---- item 2: an income row never prints a negative "left" ---- */
  const remOf = tr => tr.querySelector('.bud-remaining');
  eq(remOf(salary).textContent, i18n.t('bud.remaining.incomeMore', { amount: 'R 4000.00' }),
    'income beating its plan reads as a positive surplus, was "R -4000.00 left"');
  ok(!remOf(salary).textContent.includes('-'), 'no minus sign on an income surplus');
  ok(!remOf(salary)._cls.has('over'), 'an income surplus is never red');
  const side = budRows.get('Side');
  eq(remOf(side).textContent, i18n.t('bud.remaining.incomeToCome', { amount: 'R 600.00' }),
    'income under its plan reads as still to come');
  /* Expense wording is untouched. */
  eq(remOf(budRows.get('Groceries')).textContent, i18n.t('bud.remaining.left', { amount: 'R 400.00' }), 'expense left is unchanged');
  eq(num(remOf(budRows.get('Groceries')).textContent), byCat.get('Groceries').remaining, 'and equals the row remaining');

  /* Remaining, both pages, every budgeted non-income row: same number. */
  for (const cat of ['Groceries', 'Gym', 'Fun']) {
    const r = byCat.get(cat);
    const bud = remOf(budRows.get(cat)).textContent;
    const dash = amountIn(dashRows.get(cat).children[4].textContent);
    eq(Math.abs(num(bud)), Math.abs(num(dash)), `${cat}: remaining magnitude agrees across pages`);
    eq(num(dash), r.remaining, `${cat}: Dashboard prints the row's remaining`);
  }
  /* An assume-spent row inside its provision prints words on the Budget page
     and the row's own remaining (budget - actual = 0) on the Dashboard. */
  eq(num(dashRows.get('Carry').children[4].textContent), byCat.get('Carry').remaining, 'Carry: Dashboard prints the row remaining');
  eq(byCat.get('Carry').remaining, 0, 'an assume-spent row inside its provision has nothing left to spend');

  /* ---- live edit: typing an amount moves the row and the strip at once ---- */
  {
    const tr = budRows.get('Groceries');
    const input = tr.querySelector('input');
    const stripBefore = $('#budTotalsTop').textContent;
    input.value = '2000';
    input._fire('change', { target: input });
    const after = new Map(trs($('#budTable')).map(t2 => [catOf(t2), t2]));
    eq(remOf(after.get('Groceries')).textContent, i18n.t('bud.remaining.over', { amount: 'R 600.00' }),
      'lowering the budget to 2000 turns the row over by 600 without a save');
    ok($('#budTotalsTop').textContent !== stripBefore, 'and the totals strip moved with it');
    eq(S.budgets['2026-07'].find(r => r.category === 'Groceries').amount, 3000, 'the saved budget is untouched until Save');
    /* The saved rows the Dashboard reads are unchanged by an unsaved edit. */
    eq(real(S.period).find(r => r.cat === 'Groceries').budget, 3000, 'Dashboard rows still read the saved file');
  }

  console.log(`PASS — Budget page and Dashboard print one Actual and one Remaining from budgetVsActualRows; income never reads negative "left" (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
