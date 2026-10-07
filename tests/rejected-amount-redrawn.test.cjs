'use strict';
/* A rejected amount puts the stored figure back in the field.

   On the Owed Money and Debt pages, an amount normalizeAmount cannot read — an
   emptied field, which is also what a plain number input reports when an
   SA-locale keypad writes "15 000 000,00" into it — toasts "… must be a
   number" and keeps the stored figure, correctly. But the field was left
   showing nothing: debts.js's comment promised to "redraw so the field shows
   what is actually saved", and the redraw it called refreshed the derived
   cells, not the input. So the reader saw a blank Amount while the old figure
   was the one the next save wrote — the screen and the file disagreeing about
   a number the reader had just tried to change. The Assets page has always
   redrawn here (views/assets.js) and is the control.

   The Debt page also marked itself unsaved on a rejected edit, lighting
   "Save" for a change that never happened; nothing changed, so nothing is
   marked now.

     node tests/rejected-amount-redrawn.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const OWED = '---\nkind: owed\n---\n\n# owed\n\n| Person | Amount | Description | Due date | Status |\n| --- | --- | --- | --- | --- |\n'
  + '| Dad | 1500 | Tickets | 2026-08-30 | outstanding |\n'
  + '| Sam | -450 | Typed below zero |  | outstanding |\n';
const DEBTS = '---\nkind: debts\n---\n\n# debts\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
  + '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
  + '| Store card | Shop A | store account | 3200 | 3200 | 25.5 | 250 | 0 | 2025-06-01 |  | active |  |\n';

async function mount(view, files) {
  const ctx = makeCtx({ 'Budget/Settings.md': SETTINGS, ...files });
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => []; ctx.root = $('#root');
  require(`../src/views/${view}`)(ctx);
  return { ctx, S, $ };
}
const reject = (input, value = '') => { input.value = value; input._fire('change', { target: input }); };

(async () => {
  /* ---- Owed Money ---- */
  {
    const { ctx, S, $ } = await mount('owed', { 'Budget/Owed Money.md': OWED });
    ctx.renderOwed();
    const dad = $('#owedTable').querySelector('[aria-label="Amount for Dad"]');
    reject(dad);
    eq(ctx._toasts.map(t => t.msg), ['Amount must be a number'], 'the rejection is said');
    eq(S.owed[0].amount, 1500, 'the stored figure is kept');
    eq(dad.value, '1500', 'and the field shows it again, not a blank');
    const sam = $('#owedTable').querySelector('[aria-label="Amount for Sam"]');
    reject(sam, 'abc');
    eq(sam.value, '-450', 'a kept negative is put back as itself');
    eq(S.owedDirty, false, 'nothing changed, so nothing is waiting to be saved');
  }

  /* ---- Debts: all four money fields ---- */
  {
    const { ctx, S, $ } = await mount('debts', { 'Budget/Debts.md': DEBTS });
    $('#debtExtra').value = ''; $('#debtStrategy').value = 'avalanche';
    ctx.renderDebts();
    const cases = [
      ['Balance owed on', 'Balance', 'balance', '3200'],
      ['Annual interest rate on', 'Rate', 'rate', '25.5'],
      ['Monthly payment on', 'Payment', 'payment', '250'],
      ['Extra paid each month on', 'Extra', 'extra', ''],   // a stored 0 shows as the empty field it was drawn as
    ];
    for (const [aria, label, key, shown] of cases) {
      const input = $('#debtTable').querySelector(`[aria-label="${aria} Store card"]`);
      const before = S.debts[0][key];
      reject(input);
      eq(ctx._toasts.map(t => t.msg).pop(), `${label} must be a number`, `${label}: the rejection is said`);
      eq(S.debts[0][key], before, `${label}: the stored figure is kept`);
      eq(input.value, shown, `${label}: and the field shows it again`);
    }
    eq(S.debtsDirty, false, 'four rejected edits leave nothing waiting to be saved');
    ok(!ctx._toasts.some(t => /^Saved/.test(t.msg)), 'and nothing was written');
  }

  /* ---- control: Assets has always redrawn ---- */
  {
    const A = '---\nkind: assets\n---\n\n# Assets\n\n| Item | Kind | Value | Valued | Notes |\n| --- | --- | --- | --- | --- |\n'
      + '| Gold coins | precious metals | 96000 |  |  |\n';
    const { ctx, $ } = await mount('assets', { 'Budget/Assets.md': A });
    ctx.renderAssets();
    reject($('#assetTable').querySelector('[aria-label="Value of Gold coins"]'));
    eq($('#assetTable').querySelector('[aria-label="Value of Gold coins"]').attrs.value, '96000',
      'Assets redraws the row, so its field shows the kept value');
  }
  console.log(`PASS rejected-amount-redrawn (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
