'use strict';
/* Save paths fail out loud — the guard for the nine primary Save functions
   (Transactions, Budget, Debt, Assets, Services, Tax, Plan, Owed, Accounts).

   Before this suite, every one of these wrote straight to vault.modify /
   vault.create with no try/catch. A rejected write — a locked file, a full
   disk, a sync conflict — became an unhandled promise rejection: no toast, the
   Save button dark over data that was never written (several of these clear
   the dirty flag in the same breath as the write), and nothing on screen to
   say a save had failed at all. saveTransactions' per-file loop had the worst
   version of this: files written before the one that failed already had
   dirty:false, so a retry would silently skip re-saving them right alongside
   the one that actually needed it.

   Each case below forces exactly ONE write to reject, calls the real save
   function over the harness's in-memory vault, and proves three things —

     1. the call resolves — it does not throw or reject up to the caller
     2. an error toast fires
     3. the dirty flag / Save button STAYS set, so a retry is still offered

   — then lets the write through and proves the retry actually saves.

   Drives the REAL views over the shared harness. writeFile / patchFile both
   funnel through vault.modify (existing file) or vault.create (new file), the
   same two calls every write in the app uses — forging a rejection there is
   forging exactly the failure a full disk or a sync lock produces, not a
   hand-rolled substitute for one.

     node tests/save-failure.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the dialogs, made answerable — only accounts.addAccount goes through
   askFields in this suite. Injected into the require cache before any view is
   loaded, same pattern as tests/delete-and-undo.test.cjs. ---- */
const answers = { confirm: true, fields: null };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal() { return answers.confirm; },
    async askFields() { return answers.fields; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

/* ---- a vault with something to save on every page --------------------- */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | |\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n${HEAD}`
    + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: `---\n${TX_FM}\n---\n\n${HEAD}`
    + '| 2026-08-02 | Grocer | Groceries | -700.00 |  |  |  |\n',
  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card debt | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | | active | |\n',
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n| House | property | 1500000.00 | 2026-03-01 | |\n',
  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n| Sam | 250.00 | lunch | 2026-08-01 | outstanding | |\n',
  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Streaming | Provider A | 199.00 | monthly | 2026-08-05 | Groceries | yes | |\n',
  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-09-01 | |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | needed | | |\n\n## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Local interest | Bank A | 15000.00 |\n',
});

/* Mount every view this suite needs against one ctx, the way controller.js
   does — several read helpers off each other (categories.js's learnRules is
   what saveTransactions calls when rules are learned on save). */
async function mount() {
  const ctx = makeCtx(FILES());
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
  require('../src/categories')(ctx);
  for (const f of ['transactions', 'budgets', 'plan', 'accounts', 'assets', 'debts', 'owed', 'services', 'tax']) {
    require(`../src/views/${f}`)(ctx);
  }
  // A plan with nothing in it — savePlan only needs a current plan to exist,
  // not a Plans/ file on disk (this one is new, so its save takes the
  // vault.create path rather than vault.modify).
  ctx.S.plans = { Test: { file: 'Test', name: 'Test', fmRaw: '', started: '2026-08-01', status: 'active', sources: [], envelopes: [], items: [] } };
  ctx.S.planName = 'Test';
  return { ctx, S, $ };
}

/* A write that rejects for exactly one resolved path, and nothing else.
   Patches vault.modify/create in place — the same two calls writeFile and
   patchFile both funnel through — so this is indistinguishable from a real
   disk error to the code under test. */
function withFailingWrite(ctx) {
  const { vault } = ctx;
  const origModify = vault.modify.bind(vault);
  const origCreate = vault.create.bind(vault);
  let failPath = null;
  vault.modify = async (f, content) => {
    if (failPath && f.path === failPath) throw new Error('simulated disk error');
    return origModify(f, content);
  };
  vault.create = async (p, content) => {
    if (failPath && p === failPath) throw new Error('simulated disk error');
    return origCreate(p, content);
  };
  return { failOn: p => { failPath = p; }, clear: () => { failPath = null; } };
}

(async () => {
  /* ---- 1-6: the six dirtyFlag-backed single-file saves — Owed, Debts,
     Assets, Services, Tax, Plan. Same shape (try/catch around one writeFile,
     clearDirty() only on success), so one loop proves all six. ---- */
  const CASES = [
    { name: 'Owed', path: `${B}/Owed Money.md`, dirtyKey: 'owedDirty', btn: '#owedSave', fn: 'saveOwed' },
    { name: 'Debts', path: `${B}/Debts.md`, dirtyKey: 'debtsDirty', btn: '#debtSave', fn: 'saveDebts' },
    { name: 'Assets', path: `${B}/Assets.md`, dirtyKey: 'assetsDirty', btn: '#assetSave', fn: 'saveAssets' },
    { name: 'Services', path: `${B}/Services.md`, dirtyKey: 'servicesDirty', btn: '#svcSave', fn: 'saveServices' },
    { name: 'Tax', path: `${B}/Tax/2026.md`, dirtyKey: 'taxDirty', btn: '#taxSave', fn: 'saveTax',
      precond: ctx => { ctx.S.taxYear = '2026'; } },
    { name: 'Plan', path: `${B}/Plans/Test.md`, dirtyKey: 'planDirty', btn: '#planSave', fn: 'savePlan' },
  ];

  for (const c of CASES) {
    const { ctx, $ } = await mount();
    if (c.precond) c.precond(ctx);
    const fail = withFailingWrite(ctx);
    ctx.S[c.dirtyKey] = true;
    $(c.btn).disabled = false;
    fail.failOn(c.path);

    await assert.doesNotReject(() => ctx[c.fn](),
      `${c.name}: a rejected write must not escape ${c.fn} as an unhandled rejection`);
    checks++;
    ok(ctx.S[c.dirtyKey] === true, `${c.name}: dirty flag stays set after a failed save, so hasDirty() still protects the edit`);
    ok($(c.btn).disabled === false, `${c.name}: the Save button stays enabled after a failed save, so the reader can retry`);
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true, `${c.name}: a failed save reports an error toast`);

    // Retry: let the write through this time.
    fail.clear();
    await ctx[c.fn]();
    ok(ctx.S[c.dirtyKey] === false, `${c.name}: a retried save that succeeds clears the dirty flag`);
    ok($(c.btn).disabled === true, `${c.name}: a retried save that succeeds disables the Save button`);
    lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad !== true, `${c.name}: a retried save that succeeds reports a plain (non-error) toast`);
  }

  /* ---- 7: Budget — its dirty state is a closure var read through the
     published budgetDirty(), not an S key. ---- */
  {
    const { ctx, $ } = await mount();
    const fail = withFailingWrite(ctx);
    // budgetDraft() resets budDirty/#budSave to clean the FIRST time it builds
    // the draft for a period — which saveBudget's own call to it would do if
    // nothing had built the draft yet, wiping out the "dirty" precondition
    // below before the write is even attempted. Render once first, the way
    // opening the page would, so the draft already exists and marking dirty
    // afterwards sticks.
    ctx.renderBudgets();
    $('#budSave').disabled = false;
    fail.failOn(`${B}/Budgets/2026-07.md`);

    await assert.doesNotReject(() => ctx.saveBudget(), 'Budget: a rejected write must not escape saveBudget');
    checks++;
    ok(ctx.budgetDirty() === true, 'Budget: budgetDirty() still reports dirty after a failed save');
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true, 'Budget: a failed save reports an error toast');

    fail.clear();
    await ctx.saveBudget();
    ok(ctx.budgetDirty() === false, 'Budget: a retried save that succeeds clears budgetDirty()');
    lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad !== true, 'Budget: a retried save that succeeds reports a plain toast');
  }

  /* ---- 8: Transactions — the per-file loop must not clear dirty for a file
     that never landed, and must not lose the files that did. This is the case
     the mission called out by name: files saved before the failure used to
     read dirty:false forever, alongside the one that actually needed a
     retry. ---- */
  {
    const { ctx, S, $ } = await mount();
    const fail = withFailingWrite(ctx);
    const july = S.txFiles['Cheque/2026-07'];
    const august = S.txFiles['Cheque/2026-08'];
    july.dirty = true;
    august.dirty = true;
    $('#txSave').disabled = false;
    // Object.values() walks insertion order, and July loaded before August, so
    // failing August's write guarantees July gets its chance to land first.
    fail.failOn(`${B}/Transactions/Cheque/2026-08.md`);

    await assert.doesNotReject(() => ctx.saveTransactions(), 'Transactions: a rejected write must not escape saveTransactions');
    checks++;
    ok(july.dirty === false, 'Transactions: a file that DID write is marked clean');
    ok(august.dirty === true, 'Transactions: a file that did NOT write stays dirty — it must not be silently dropped');
    ok($('#txSave').disabled === false, 'Transactions: the Save button stays enabled while any file is still dirty');
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true, 'Transactions: a failed save reports an error toast');

    fail.clear();
    await ctx.saveTransactions();
    ok(august.dirty === false, 'Transactions: the retry saves the file that failed the first time');
    ok($('#txSave').disabled === true, 'Transactions: a fully-clean save disables the Save button');
    lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad !== true, 'Transactions: a retried save that succeeds reports a plain toast');
  }

  /* ---- 9: Accounts — saveAccount has no dirty flag or Save button of its
     own (accounts.js writes through immediately from five different
     callers), so the guarantee is different: the write must not throw, must
     toast, must return a falsy result so its five callers do not fall
     through to a false "saved" state, and a retry with the SAME in-memory
     model must still succeed once the write does. ---- */
  {
    const { ctx, S } = await mount();
    const fail = withFailingWrite(ctx);
    const acct = S.accounts.find(a => a.name === 'Cheque');
    acct.balance = 999;
    fail.failOn(`${B}/Accounts/Cheque.md`);

    let result;
    await assert.doesNotReject(async () => { result = await ctx.saveAccount(acct); },
      'Accounts: a rejected write must not escape saveAccount');
    checks++;
    ok(!result, 'Accounts: a failed save reports failure to its caller rather than pretending to succeed');
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true, 'Accounts: a failed save reports an error toast');

    fail.clear();
    const retried = await ctx.saveAccount(acct);
    ok(!!retried, 'Accounts: retrying with the same model succeeds once the write does');
  }

  /* ---- 10: addAccount must not add a phantom account when its underlying
     save fails — the whole point of saveAccount returning a signal instead of
     being trusted blindly. ---- */
  {
    const { ctx, S } = await mount();
    const fail = withFailingWrite(ctx);
    fail.failOn(`${B}/Accounts/New One.md`);
    answers.fields = {
      name: 'New One', type: 'checking', institution: '', account_number: '',
      owner: '', currency: '', balance: '0', goal_amount: '', total_invested: '', budget: 'yes',
    };
    const before = S.accounts.length;
    const created = await ctx.addAccount();
    ok(created === null, 'addAccount: a failed underlying save returns null, matching every other validation failure');
    ok(S.accounts.length === before, 'addAccount: a failed save does not add a phantom account to memory');
  }

  console.log(`PASS — save paths fail out loud (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
