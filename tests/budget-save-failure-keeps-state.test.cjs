'use strict';
/* A FAILED BUDGET SAVE MUST NOT LEAVE UNSAVED FIGURES IN MEMORY AS IF SAVED.

   saveBudget used to assign S.budgets[S.period] (and flip every draft row's
   inFile flag) BEFORE the write. When the write threw (an iCloud conflict, a
   locked file) the catch toasted and returned, but the shared state kept the
   unsaved rows: the Dashboard and Report printed them as saved, and a later
   "Discard & switch" rebuilt the draft from those same rows, so the edit came
   back looking saved, Save disabled, with nothing on disk.

   Pinned here, on the REAL Budgets view and the REAL loader:
     1. a rejected write leaves S.budgets, S.budgetMeta and the draft's inFile
        flags exactly as they were; the draft keeps the typed amount, stays
        dirty and Save stays enabled;
     2. the same click, retried against a working write, saves: the state is
        the new rows and the file on disk holds them;
     3. discard after a FAILED save rebuilds the draft from the ORIGINAL rows.

     node tests/budget-save-failure-keeps-state.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const clone = v => JSON.parse(JSON.stringify(v));

const B = 'Budget';
const files = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#aa8833"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4000.00 | |\n| Salary | income | 10000.00 | |\n',
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

  /* The write the view will use: the real one, unless told to fail once. The
     view destructures ctx.writeFile at registration, so wrap before that. */
  const realWrite = ctx.writeFile;
  const writes = [];
  const mode = { fail: false };
  ctx.writeFile = async (rel, text, ...rest) => {
    writes.push(rel);
    if (mode.fail) throw new Error('iCloud conflict');
    if (mode.hold) await mode.hold;
    return realWrite(rel, text, ...rest);
  };
  require('../src/categories')(ctx);
  for (const v of ['dashboard', 'transactions', 'budgets']) require(`../src/views/${v}`)(ctx);

  const rows = () => descend($('#root')).concat(descend($('#budTable')));
  const field = cat => rows().find(e => e.attrs && e.attrs['aria-label'] === `Budget amount for ${cat}`);
  const type = (cat, amount) => {
    ctx.renderBudgets();
    const f = field(cat);
    ok(f, `the ${cat} amount field is rendered`);
    f._fire('change', { target: { value: String(amount) } });
  };
  const draftAmount = cat => { ctx.renderBudgets(); const f = field(cat); return f && f.attrs.value; };
  /* A row's Clear button exists only for a row the period file holds (inFile),
     so it reads the draft's inFile flag back off the page. */
  const inFile = cat => {
    ctx.renderBudgets();
    return rows().some(e => e.attrs && e.attrs['aria-label'] === `Clear budget for ${cat}`);
  };
  return { ctx, S, $, mode, writes, type, draftAmount, inFile, realWrite };
}

(async () => {
  const m = await mount();
  const { ctx, S, $ } = m;
  ctx.renderBudgets();
  eq(m.inFile('Groceries'), true, 'control: Groceries is a row of the period file');
  eq(m.inFile('Fuel'), false, 'control: Fuel is a seeded zero row, not in the file');

  m.type('Groceries', 4321);
  m.type('Fuel', 650);
  ok(ctx.budgetDirty(), 'typing marks the draft dirty');

  const rowsBefore = clone(S.budgets['2026-07']);
  const metaBefore = clone(S.budgetMeta);
  const onDiskBefore = await ctx.readFile('Budgets/2026-07.md');

  /* ---- 1. a rejected write ---- */
  m.mode.fail = true;
  await ctx.saveBudget();
  eq(m.writes.length, 1, 'the save attempted exactly one write');
  eq(ctx._toasts[ctx._toasts.length - 1].bad, true, 'the failure is toasted');
  eq(clone(S.budgets['2026-07']), rowsBefore, 'S.budgets[period] is exactly what it was before Save');
  eq(clone(S.budgetMeta), metaBefore, 'S.budgetMeta is exactly what it was before Save');
  eq(await ctx.readFile('Budgets/2026-07.md'), onDiskBefore, 'and nothing reached the disk');
  eq(m.draftAmount('Groceries'), '4321', 'the draft keeps the typed Groceries amount');
  eq(m.draftAmount('Fuel'), '650', 'the draft keeps the typed Fuel amount');
  eq(m.inFile('Fuel'), false, 'the typed zero row is still not "in the file" (inFile flag restored)');
  eq(m.inFile('Groceries'), true, 'and Groceries still is');
  ok(ctx.budgetDirty(), 'the draft is still dirty');
  eq($('#budSave').disabled, false, 'Save is still enabled, so the same click retries');

  /* ---- 3. discard after the FAILED save rebuilds from the original rows ---- */
  {
    ctx.invalidateBudgetDraft();
    eq(m.draftAmount('Groceries'), '4000', 'discard after a failed save: Groceries is the original 4000, not the typed 4321');
    eq(Number(m.draftAmount('Fuel') || 0), 0, 'discard after a failed save: Fuel is back to zero (a zero row shows an empty field)');
    ok(!ctx.budgetDirty(), 'and the rebuilt draft is clean');
    eq($('#budSave').disabled, true, 'with Save disabled — and honestly, since nothing was saved');
  }

  /* ---- 2. retry on a working write succeeds ---- */
  m.type('Groceries', 4321);
  m.type('Fuel', 650);
  m.mode.fail = true;
  await ctx.saveBudget();
  eq(clone(S.budgets['2026-07']), rowsBefore, 'second failure: still the original rows');
  m.mode.fail = false;
  await ctx.saveBudget();
  const after = S.budgets['2026-07'];
  eq(after.find(r => r.category === 'Groceries').amount, 4321, 'the retry saved: Groceries in shared state is 4321');
  eq(after.find(r => r.category === 'Fuel').amount, 650, 'the retry saved: the typed zero row joined the period');
  ok(after.every(r => r.inFile === true), 'every saved row is marked as in the file');
  const disk = await ctx.readFile('Budgets/2026-07.md');
  ok(/Groceries \| expense \| 4321\.00/.test(disk) && /Fuel \| expense \| 650\.00/.test(disk), 'the file on disk holds the new rows');
  ok(!ctx.budgetDirty(), 'a successful save leaves the draft clean');
  eq($('#budSave').disabled, true, 'and Save disabled');
  eq(m.inFile('Fuel'), true, 'Fuel is now a row of the file');
  eq(m.draftAmount('Groceries'), '4321', 'the draft shows the saved amount');
  eq(ctx._toasts[ctx._toasts.length - 1].bad, undefined, 'the last toast is the success one');

  /* ---- 4. the period moves while the write is in flight ----
     Setting the shared state AFTER the write means it is set after an await,
     and the header pill can move S.period in that gap. The rows belong to the
     period Save was pressed on, wherever the pill has gone since. */
  {
    m.type('Groceries', 4555);
    let release;
    m.mode.hold = new Promise(r => { release = r; });
    const saving = ctx.saveBudget();
    S.period = '2026-08';                  // the pill moved mid-write
    release();
    await saving;
    m.mode.hold = null;
    eq(S.budgets['2026-07'].find(r => r.category === 'Groceries').amount, 4555, 'the rows landed under the period Save was pressed on');
    eq(S.budgets['2026-08'], undefined, 'and not under the period the pill moved to');
    ok(/Groceries \| expense \| 4555\.00/.test(await ctx.readFile('Budgets/2026-07.md')), 'the file written is that period\'s');
    /* "Clean" is a fact about the draft that was saved. The page is on another
       period now, so its dirty state and Save button are not this save's to
       clear. */
    ok(ctx.budgetDirty(), 'the save does not mark the page clean once the pill has moved on');
    eq($('#budSave').disabled, false, 'nor disable its Save button');
    S.period = '2026-07';
  }

  console.log(`PASS budget-save-failure-keeps-state — a rejected budget write leaves shared state, draft flags and dirty state as they were; a retry saves (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
