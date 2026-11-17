'use strict';
/* A SAVINGS ROW MARKED "ASSUME SPENT" NO LONGER READS "ALREADY SPENT" ON THE
   PER-ROW TABLE.

   period.js budgetBucket(type) is the one answer to "which total does a budget
   row go into", and budgetUsed already takes its assume-spent rows from the
   'spend' bucket only, so an unpaid savings row inflates nothing in the strip.
   figures.js rowsFrom still spelled the old test (not income, not transfer),
   so the same row, on the table under that strip, printed Actual = its whole
   budget with the "already spent" tag and disagreed with it. rowsFrom now asks
   budgetBucket (published on ctx) too.

   And because the flag then feeds nothing for a set-aside category (budgetUsed
   and rowsFrom were its only readers), the Budgets page stops offering the
   toggle there, by the same predicate. A category file that already carries the
   flag is left alone and is harmless.

   REAL loader, REAL figures seam, REAL budgets view over the DOM stub.
     node tests/rows-assume-spent-set-aside.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';

function files({ fundType = 'savings', fundPaid = false, fundFlag = true, groceriesFlag = true } = {}) {
  return {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
    [`${B}/Categories/Groceries.md`]: `---\ntype: expense\ncolor: "#888888"\n${groceriesFlag ? 'assume_spent: true\n' : ''}---\n`,
    [`${B}/Categories/Emergency Fund.md`]: `---\ntype: ${fundType}\ncolor: "#888888"\n${fundFlag ? 'assume_spent: true\n' : ''}---\n`,
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Groceries | expense | 4000.00 | |\n'
      + `| Emergency Fund | ${fundType} | 2000.00 | |\n| Salary | income | 10000.00 | |\n`,
    [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-07-01 | Salary | Salary | 10000.00 |  |  |  |\n'
      + '| 2026-07-06 | Grocer | Groceries | -1500.00 |  |  |  |\n'
      + (fundPaid ? '| 2026-07-07 | To fund | Emergency Fund | -1200.00 |  |  |  |\n' : ''),
  };
}

async function mount(f) {
  const ctx = makeCtx(f);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', {}, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const v of ['dashboard', 'transactions', 'budgets']) require(`../src/views/${v}`)(ctx);
  return { ctx, S, $ };
}
const rowOf = (ctx, cat) => ctx.budgetVsActualRows('2026-07').find(r => r.cat === cat);
const page = ({ ctx, $ }) => { ctx.renderBudgets(); return descend($('#root')).concat(descend($('#budTable'))); };
const hasLabel = (els, label) => els.some(e => e.attrs && e.attrs['aria-label'] === label);
const ASSUME = c => `Count the budget for ${c} as already spent`;

(async () => {
  ok(typeof (await mount(files())).ctx.budgetBucket === 'function', 'period.js publishes budgetBucket on ctx');

  for (const type of ['savings', 'investment']) {
    /* ---- the set-aside row: its real movement, no tag ---- */
    const before = await mount(files({ fundType: type, fundPaid: false }));
    let r = rowOf(before.ctx, 'Emergency Fund');
    eq([r.actual, r.assumed], [0, false], `${type}, no transfer yet: Actual is 0 and the row is not assumed`);
    eq(r.realSpend, undefined, `${type}: and it carries no assume-spent bookkeeping`);

    const after = await mount(files({ fundType: type, fundPaid: true }));
    r = rowOf(after.ctx, 'Emergency Fund');
    eq([r.actual, r.assumed], [1200, false], `${type}, after the transfer: Actual is the transfer (1200), not the budget`);

    /* ---- the page agrees: no tag, and no toggle for the category ---- */
    const els = page(before);
    const tags = els.filter(e => e._cls && e._cls.has('bud-assumed-tag'));
    eq(tags.map(e => e.textContent), ['already spent'], `${type}: exactly one "already spent" tag on the page — Groceries'`);
    const tagged = els.filter(e => e.tagName === 'TD' && e.children.some(c => tags.includes(c)));
    ok(tagged.length === 1 && /^Groceries/.test(tagged[0].textContent), `${type}: and it sits on the Groceries row`);
    ok(!hasLabel(els, ASSUME('Emergency Fund')), `${type}: the assume-spent toggle is not offered for the set-aside category`);
    ok(hasLabel(els, ASSUME('Groceries')), `${type}: control: it is still offered for a spending category`);
  }

  /* ---- a spending row with the flag: unchanged ---- */
  {
    const m = await mount(files({ fundFlag: false }));
    const r = rowOf(m.ctx, 'Groceries');
    eq([r.assumed, r.actual, r.realSpend], [true, 4000, 1500], 'spending row with assume_spent: Actual is the larger of plan and real (4000), real spend kept');
    const none = await mount(files({ fundFlag: false, groceriesFlag: false }));
    eq(rowOf(none.ctx, 'Groceries').actual, 1500, 'control: without the flag the same row is its real spend');
    ok(hasLabel(page(m), ASSUME('Groceries')), 'the toggle is offered for the spending row');
  }

  /* ---- a category file that already carries the flag is left untouched ---- */
  {
    const f = files();
    const m = await mount(f);
    ok(m.S.categories.find(c => c.name === 'Emergency Fund').assumeSpent === true, 'the loader still reads the flag on the set-aside category');
    page(m);
    ok(/assume_spent: true/.test(await m.ctx.readFile('Categories/Emergency Fund.md')), 'and rendering the page does not touch the file');
  }

  /* ---- the rule is spelled once ---- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'figures.js'), 'utf8');
    ok(!/type !== 'income' && type !== 'transfer' && catAssumeSpent/.test(src), "figures.js no longer spells the old type list");
    ok(/budgetBucket\(type\) === 'spend' && catAssumeSpent/.test(src), 'figures.js asks budgetBucket');
  }

  console.log(`PASS rows-assume-spent-set-aside — a set-aside row marked assume-spent shows its real movement and no tag, the toggle is not offered there, spending rows unchanged (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
