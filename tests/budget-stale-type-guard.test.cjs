'use strict';
/* A budget row's sign now follows the CATEGORY's current type, not the
   stored Type cell in Budgets/<period>.md.

   The period file's Type column is written once, on save, and then only
   re-written when the row is saved again — there is no re-type UI, so
   correcting a category's type means hand-editing the category file, and
   every row already saved under the old type goes stale until its OWN next
   save. Reading `d.type` for sign/bucket meant a category corrected to
   `income` rendered NEGATIVE here (still bucketed as an expense) while the
   Dashboard, reading catType(cat) fresh every render, showed the same money
   POSITIVE — a category note edit that visibly disagreed with itself across
   two pages of the same plugin, on the same period, with no save in
   between.

   The fix reads `catType(d.category) ?? d.type` everywhere sign or grouping
   is decided on this page: the row's own Actual, the remaining line, which
   group bar the row sits under, and the totals strip. `d.type` only stands
   in when catType has no answer — a category with no file at all.

   Runs in bare node against the REAL loader and the REAL budgets view over
   the shared DOM stub. Wired into ./build.sh.
     node tests/budget-stale-type-guard.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';

/* Bonus is now typed `income` in its category file, but the July budget row
   was saved back when it was `expense` — its stored Type cell still says so. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Bonus.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Bonus | expense | 5000.00 | |\n| Salary | income | 10000.00 | |\n',
};

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
  const { ctx, $ } = await mount(FILES);
  ok(ctx.catType('Bonus') === 'income', 'sanity: the category file itself now says income');

  ctx.renderBudgets();
  const totals = $('#budTotalsTop').textContent;
  /* Total income should be Salary (10000) + Bonus (5000) = 15000, budgeted
     against nothing (no expense-typed rows once Bonus is read correctly) —
     the stale-type bug bucketed Bonus into "Total budgeted" (expense) and
     left "Total income" at 10000, understating income by exactly Bonus's
     amount. */
  ok(totals.includes('R 15000.00'),
    'Total income counts Bonus once catType overrides the stale stored Type cell — 10000 Salary + 5000 Bonus');

  /* Checked structurally, not by substring: the Type BADGE column deliberately
     keeps showing the raw stored cell (see the comment at that column in
     budgets.js) as the staleness signal, so "expense" legitimately still
     appears in Bonus's own row. What must NOT happen is a SECOND group bar
     for it — Bonus has to land inside the one 'income' bar alongside Salary. */
  const groupBars = $('#budTable').querySelectorAll('.type-row').map(r => r.textContent);
  ok(groupBars.length === 1 && groupBars[0] === 'income',
    `exactly one group bar, labelled income — got ${JSON.stringify(groupBars)}`);

  console.log(`PASS — a budget row's sign and grouping follow the category's CURRENT type, not the stale stored cell (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
