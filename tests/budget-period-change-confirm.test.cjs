'use strict';
/* Changing period with unsaved budget edits asks first, from EVERY page.

   The period pill is on every page but Report. Switching period rebuilds the
   Budget draft for the new period (views/budgets.js budgetDraft), which throws
   away whatever was typed and not saved. changePeriod used to confirm only when
   S.view was 'budgets', so: type an amount on Budgets, go to the Dashboard, tap
   the next-period arrow, come back — the edit was gone, Save was disabled, and
   no dialog had appeared.

   The question is about the DRAFT, not the page. Pinned here:

     1. with a dirty draft, a period change from ANY view shows the confirm;
     2. declining leaves S.period alone, the typed amount in the draft and Save
        still enabled when Budgets is shown again (REAL budgets view, REAL loader);
     3. accepting discards the draft, switches, and leaves the new period's
        draft clean — including Save disabled and ctx.budgetDirty() false, which
        is what the file watcher reads (a stuck "dirty" would defer every vault
        reload until the reader happened to visit Budgets);
     4. with a clean draft no dialog is shown, from any view;
     5. plain view switching asks nothing and the draft survives it;
     6. all three pill buttons go through the one changePeriod, and it is the only
        place controller.js assigns S.period.

   mountApp needs a DOMParser shell no bare-node test can build, so the guard
   is the exported makePeriodChanger (the closure's whole body) and a source
   check on the wiring.

     node tests/budget-period-change-confirm.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { makePeriodChanger } = require('../src/controller');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const files = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4000.00 | |\n| Salary | income | 10000.00 | |\n',
  [`${B}/Budgets/2026-08.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4500.00 | |\n| Salary | income | 10000.00 | |\n',
});

async function mount() {
  const ctx = makeCtx(files());
  const S = await loadInto(ctx);
  S.period = '2026-07';
  S.view = 'budgets';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root'); ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', {}, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const v of ['dashboard', 'transactions', 'budgets']) require(`../src/views/${v}`)(ctx);

  const asked = [];
  const answer = { go: true };
  const renders = [];
  const changePeriod = makePeriodChanger({
    S, ctx,
    confirm: async opts => { asked.push(opts); return answer.go; },
    render: () => renders.push(S.view),
  });
  /* The reader types into Groceries' amount field on the real page. */
  const type = amount => {
    ctx.renderBudgets();
    const field = descend($('#root')).concat(descend($('#budTable'))).find(e => e.attrs && e.attrs['aria-label'] === 'Budget amount for Groceries');
    ok(field, 'the Groceries amount field is rendered');
    field._fire('change', { target: { value: String(amount) } });
  };
  return { ctx, S, $, asked, answer, renders, changePeriod, type };
}

const draftAmount = (ctx, cat) => {
  // Read back through the page itself: the draft is the view's own state.
  ctx.renderBudgets();
  const field = descend(ctx.$('#root')).concat(descend(ctx.$('#budTable'))).find(e => e.attrs && e.attrs['aria-label'] === `Budget amount for ${cat}`);
  return field && field.attrs.value;
};

(async () => {
  /* ---- 1+2. dirty draft, another page showing: ask; decline keeps everything ---- */
  for (const view of ['dashboard', 'transactions', 'accounts', 'budgets']) {
    const m = await mount();
    m.type(4321);
    ok(m.ctx.budgetDirty(), `${view}: typing marks the draft dirty`);
    m.S.view = view;
    m.answer.go = false;
    await m.changePeriod('2026-08');
    eq(m.asked.length, 1, `${view}: a period change with a dirty draft asks once`);
    eq(m.asked[0].confirmText, 'Discard & switch', `${view}: it is the existing dialog`);
    eq(m.S.period, '2026-07', `${view}: declining leaves the period unchanged`);
    eq(m.renders.length, 0, `${view}: declining repaints nothing`);
    ok(m.ctx.budgetDirty(), `${view}: the draft is still dirty after declining`);
    m.S.view = 'budgets';
    eq(draftAmount(m.ctx, 'Groceries'), '4321', `${view}: back on Budgets the typed amount is still there`);
    ok(m.$('#budSave').disabled === false, `${view}: and Save is still enabled`);
  }

  /* ---- 3. dirty draft, accept ---- */
  for (const view of ['dashboard', 'budgets']) {
    const m = await mount();
    m.type(4321);
    m.S.view = view;
    m.answer.go = true;
    await m.changePeriod('2026-08');
    eq(m.asked.length, 1, `${view}: accepting asked once`);
    eq(m.S.period, '2026-08', `${view}: accepting switches the period`);
    eq(m.renders.length, 1, `${view}: and repaints`);
    ok(!m.ctx.budgetDirty(), `${view}: nothing is dirty after the discard (the watcher reads this)`);
    ok(m.$('#budSave').disabled === true, `${view}: Save is disabled — the discarded edit is not savable`);
    m.S.view = 'budgets';
    eq(draftAmount(m.ctx, 'Groceries'), '4500', `${view}: the new period's draft is its own file's amount, not the typed one`);
    ok(!m.ctx.budgetDirty() && m.$('#budSave').disabled === true, `${view}: and that draft is clean`);
  }

  /* ---- 4. clean draft: no dialog from any view ---- */
  for (const view of ['dashboard', 'transactions', 'budgets', 'report']) {
    const m = await mount();
    m.ctx.renderBudgets();
    m.S.view = view;
    ok(!m.ctx.budgetDirty(), `${view}: control: a freshly shown draft is clean`);
    await m.changePeriod('2026-08');
    eq(m.asked.length, 0, `${view}: a clean draft changes period without a dialog`);
    eq(m.S.period, '2026-08', `${view}: and the period moves`);
  }

  /* ---- 5. view switching asks nothing and the draft survives it ---- */
  {
    const m = await mount();
    m.type(777);
    m.S.view = 'dashboard';
    m.S.view = 'budgets';
    eq(m.asked.length, 0, 'switching view asks nothing');
    eq(draftAmount(m.ctx, 'Groceries'), '777', 'the draft survives a trip to another page');
    ok(m.ctx.budgetDirty(), 'and is still dirty');
  }

  /* ---- 6. the wiring: one changePeriod, the only S.period write ---- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
    for (const [id, delta] of [['prevPeriod', '-1'], ['nextPeriod', '1']]) {
      ok(new RegExp(`\\$\\('#${id}'\\)\\.addEventListener\\('click', \\(\\) => changePeriod\\(ctx\\.shiftPeriod\\(S\\.period, ${delta}\\)\\)\\)`).test(src), `#${id} goes through changePeriod`);
    }
    ok(/\$\('#currentPeriod'\)\.addEventListener\('click', \(\) => changePeriod\(ctx\.currentPeriod\(\)\)\)/.test(src), '#currentPeriod goes through changePeriod');
    const writes = [...src.matchAll(/\bS\.period\s*=[^=]/g)];
    eq(writes.length, 1, 'controller.js assigns S.period in exactly one place');
    ok(src.slice(src.indexOf('function makePeriodChanger'), src.indexOf('function mountApp')).includes('S.period = next'), 'and that place is makePeriodChanger');
  }

  console.log(`PASS budget-period-change-confirm — a dirty budget draft is confirmed on every page, declining keeps it, accepting leaves nothing dirty (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
