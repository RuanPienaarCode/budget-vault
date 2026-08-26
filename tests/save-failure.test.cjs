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
const i18n = require('../src/i18n');

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
  // A savings account with a reconciliation drift, for the C1 case below —
  // Savings' own acceptImplied, reached through the "Use this" button rather
  // than a Save button, needs an account reconcile() actually disagrees with.
  [`${B}/Accounts/Fund.md`]: '---\ntype: savings\nbalance: 5000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Transactions/Fund/2026-07.md`]: `---\n${TX_FM}\n---\n\n${HEAD}`
    + '| 2026-07-15 | Interest | Salary | 200.00 |  |  |  |\n',
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
  // dashboard is here only for its two chart-range pills (cases 15-16 below)
  // — every other case in this file never touches it.
  for (const f of ['dashboard', 'transactions', 'budgets', 'plan', 'accounts', 'assets', 'debts', 'owed', 'services', 'tax', 'savings']) {
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

/* Lets a click handler's own async work settle before assertions run. click()
   invokes the listener synchronously (see dom-stub.cjs), but the listener
   itself is `() => acceptImplied(a, rec.implied)` — fired, not awaited — so
   its promise is not handed back to the caller. One macrotask tick is enough:
   everything acceptImplied awaits (saveAccount, patchFile, vault.modify) is
   native promise chaining underneath, which drains on the microtask queue
   ahead of any timer. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

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

  /* ---- 11: Savings' own reconcile-accept — the reviewer's C1, now reached
     through ctx.acceptImplied (accounts.js publishes the one implementation;
     savings.js's "Use this" button calls straight into it — see
     views/accounts.js's acceptImplied). It was missing the guard its accounts.js
     call site already had: a failed write still re-rendered the implied
     balance and toasted success for a figure that never landed. Reached
     through the real rendered DOM, not a direct function call. ---- */
  {
    const { ctx, S, $ } = await mount();
    // Stand-in for controller.js's render(), which dispatches on S.view —
    // acceptImplied (views/accounts.js) calls ctx.render() rather than
    // renderSavings()/renderAccounts() directly so the SAME function is
    // correct from either page (see its header comment).
    ctx.render = () => ctx.renderSavings();
    const fail = withFailingWrite(ctx);
    ctx.renderSavings();
    // Selector engine here is intentionally minimal (see dom-stub.cjs) and
    // matches a single class, not a compound selector — '.v' alone is
    // renderSections' own editable-balance button class, unique on this page.
    const bal = $('#savingsSections').querySelectorAll('.v')[0];
    const btn = $('#savingsSections').querySelectorAll('.acct-recon-btn')[0];
    ok(!!bal && !!btn, 'Savings: the seeded Fund account renders both a balance button and a reconcile offer');
    const beforeText = bal.textContent;
    const acct = S.accounts.find(a => a.name === 'Fund');
    // Captured before the click so the guard below proves the in-memory model
    // itself is left untouched by a failed write — not merely that the screen
    // didn't repaint. A prior version of this fix stamped a.balance,
    // a.balanceRaw and a.balance_updated to the implied figure BEFORE the
    // write, and never backed them out on failure: the DOM stayed correct
    // (no re-render happened) but the very next render of this account —
    // triggered by anything else on the page — would have shown the implied
    // balance stamped "updated today" over a file that never changed.
    const priorBalance = acct.balance, priorBalanceRaw = acct.balanceRaw, priorUpdated = acct.balance_updated;
    fail.failOn(`${B}/Accounts/Fund.md`);

    await assert.doesNotReject(async () => { btn.click(); await flush(); },
      'Savings: a rejected write inside acceptImplied must not escape as an unhandled rejection');
    checks++;
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true, 'Savings: a failed reconcile reports an error toast (from saveAccount)');
    ok(!ctx._toasts.some(t => /matches your transactions/.test(t.msg || '')),
      'Savings: a failed reconcile never reports the "matches your transactions" success toast');
    ok($('#savingsSections').querySelectorAll('.v')[0].textContent === beforeText,
      'Savings: a failed reconcile does not re-render — the old balance stays on screen, not the implied one');
    ok(acct.balance === priorBalance, 'Savings: a failed reconcile backs a.balance out to its prior value');
    ok(acct.balanceRaw === priorBalanceRaw, 'Savings: a failed reconcile backs a.balanceRaw out to its prior value');
    ok(acct.balance_updated === priorUpdated, 'Savings: a failed reconcile backs a.balance_updated out to its prior value');

    // Retry: let the write through. Same button, same click.
    fail.clear();
    btn.click(); await flush();
    lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad !== true && /matches your transactions/.test(lastToast.msg || ''),
      'Savings: a retried reconcile that succeeds reports the "matches your transactions" toast');
    ok($('#savingsSections').querySelectorAll('.v')[0].textContent !== beforeText,
      'Savings: a retried reconcile that succeeds re-renders the new figure');
    ok(acct.balance !== priorBalance, 'Savings: a retried reconcile that succeeds actually updates a.balance');
    ok(acct.balance_updated !== priorUpdated, 'Savings: a retried reconcile that succeeds stamps a.balance_updated');
  }

  /* ---- 12 + 13: startTax and newTaxYear — the reviewer's S3. Both seed a
     phantom tax year into S.tax and switch S.taxYear to it BEFORE saveTax()
     confirms the write landed; this path never calls mark(), so a failed
     write used to leave a Tax page on screen backed by no file and no lit
     Save button to retry with. Fixed by backing the phantom year out on
     failure, matching the addAccount precedent (case 10). ---- */
  {
    const { ctx, S } = await mount();
    S.tax = {}; S.taxYear = null;   // the empty state startTax() actually fires from
    const fail = withFailingWrite(ctx);
    fail.failOn(`${B}/Tax/2026.md`);

    await assert.doesNotReject(() => ctx.startTax(), 'startTax: a rejected write must not escape as an unhandled rejection');
    checks++;
    ok(S.tax['2026'] === undefined, 'startTax: a failed save backs the phantom tax year out of S.tax');
    ok(S.taxYear === null, 'startTax: a failed save reverts S.taxYear to what it was before');

    fail.clear();
    await ctx.startTax();
    ok(!!S.tax['2026'], 'startTax: a retried save that succeeds seeds the tax year for real');
    ok(S.taxYear === '2026', 'startTax: a retried save that succeeds switches to it');
  }
  {
    const { ctx, S } = await mount();
    S.tax = { '2025': { fmRaw: '', steps: [], docs: [], figures: [] } };
    S.taxYear = '2025';
    const fail = withFailingWrite(ctx);
    fail.failOn(`${B}/Tax/2026.md`);
    answers.fields = { year: '2026' };

    await assert.doesNotReject(() => ctx.newTaxYear(), 'newTaxYear: a rejected write must not escape as an unhandled rejection');
    checks++;
    ok(S.tax['2026'] === undefined, 'newTaxYear: a failed save backs the phantom tax year out of S.tax');
    ok(S.taxYear === '2025', 'newTaxYear: a failed save reverts S.taxYear to the year the reader was actually on');

    fail.clear();
    await ctx.newTaxYear();
    ok(!!S.tax['2026'], 'newTaxYear: a retried save that succeeds seeds the tax year for real');
    ok(S.taxYear === '2026', 'newTaxYear: a retried save that succeeds switches to it');
    answers.fields = null;
  }

  /* ---- 14: handleTaxFile — the sharpest of the five, per the reviewer: the
     binary lands on disk (writeBinary is a different vault call, untouched by
     withFailingWrite here) while the markdown row pointing at it fails to
     save. Unlike startTax/newTaxYear, nothing here is backed out — the file
     really was written, so mark() is the fix: light the Save button so the
     drifted metadata can be retried without re-uploading. ---- */
  {
    const { ctx, S, $ } = await mount();
    S.taxYear = '2026';
    const fail = withFailingWrite(ctx);
    S.taxDirty = false;
    $('#taxSave').disabled = true;
    fail.failOn(`${B}/Tax/2026.md`);
    // The seeded IRP5 row has no file yet, so it is the one open row —
    // askFields' stubbed answer picks it by index, same as the "Attach to"
    // dropdown would.
    answers.fields = { to: '0' };
    const file = { name: 'IRP5.pdf', arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4 test certificate').buffer };

    await assert.doesNotReject(() => ctx.handleTaxFile(file), 'handleTaxFile: a rejected markdown write must not escape as an unhandled rejection');
    checks++;
    ok(S.taxDirty === true, 'handleTaxFile: a failed internal save marks the page dirty, so the Save button has something to retry');
    ok($('#taxSave').disabled === false, 'handleTaxFile: a failed internal save lights the Save button');
    ok(S.tax['2026'].docs.find(d => d.name === 'IRP5').status === 'uploaded',
      'handleTaxFile: the uploaded file is not un-linked over a markdown write failure — the binary really is on disk');
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true, 'handleTaxFile: a failed internal save reports an error toast');

    // Retry via the now-lit Save button.
    fail.clear();
    await ctx.saveTax();
    ok(S.taxDirty === false, 'handleTaxFile: a retried save (via the lit Save button) clears taxDirty');
    ok($('#taxSave').disabled === true, 'handleTaxFile: a retried save disables the Save button');
    answers.fields = null;
  }

  /* ---- 15-17: plugin.saveSettings() — the same shape as every write above,
     but writing plugin data (data.json) rather than a vault file, and reached
     from views that never went through the nine-save-path sweep: the
     dashboard's two chart-range pills and the export-folder setting
     transactions.js remembers after a successful export. All three call
     plugin.saveSettings() from inside an async click/onPick handler that is
     itself fired-and-forgotten by the DOM (rangePills' onclick, txExport's
     click listener) — same "fire and forget" shape as Savings' acceptImplied
     above, so the same flush() pattern applies. Unlike a vault write, there is
     no dirty flag or Save button riding on this: the setting is already real
     in memory the moment it's assigned, and the whole point of the guard is
     that a failed data.json write must not stop the screen it drives (the
     chart still needs to redraw against the range just picked; the export
     that already landed must still say so) from finishing its job. ---- */
  {
    const { ctx, $ } = await mount();
    ctx.renderDashboard();
    const pills = $('#trendRange').querySelectorAll('.chart-range-btn');
    const target = pills.find(b => b.attrs['aria-pressed'] !== 'true');
    ok(!!target, 'Dashboard trend: at least one non-active range pill is rendered to click');
    ctx.plugin.saveSettings = async () => { throw new Error('simulated disk error'); };

    await assert.doesNotReject(async () => { target.click(); await flush(); },
      'Dashboard trend range: a rejected saveSettings() must not escape as an unhandled rejection');
    checks++;
    ok(ctx.plugin.settings.chartTrendRange != null,
      'Dashboard trend range: the picked range is still real in memory even though the write failed');
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true && lastToast.msg === i18n.t('settings.err.save', { error: 'simulated disk error' }),
      `Dashboard trend range: a failed saveSettings() reports the shared settings-save error toast, got ${JSON.stringify(lastToast)}`);
    // The chart still redrew over the failed write — the picked range is not
    // stuck showing the old one just because it could not be remembered.
    ok($('#trendRange').querySelectorAll('.chart-range-btn').some(b => b.attrs['aria-pressed'] === 'true'),
      'Dashboard trend range: the pill row re-rendered with an active pill after the failed save');

    ctx.plugin.saveSettings = async () => {};
  }
  {
    const { ctx, $ } = await mount();
    ctx.renderDashboard();
    const pills = $('#splitRange').querySelectorAll('.chart-range-btn');
    const target = pills.find(b => b.attrs['aria-pressed'] !== 'true');
    ok(!!target, 'Dashboard split: at least one non-active range pill is rendered to click');
    ctx.plugin.saveSettings = async () => { throw new Error('simulated disk error'); };

    await assert.doesNotReject(async () => { target.click(); await flush(); },
      'Dashboard split range: a rejected saveSettings() must not escape as an unhandled rejection');
    checks++;
    ok(ctx.plugin.settings.splitCompareRange != null,
      'Dashboard split range: the picked range is still real in memory even though the write failed');
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    ok(lastToast && lastToast.bad === true && lastToast.msg === i18n.t('settings.err.save', { error: 'simulated disk error' }),
      'Dashboard split range: a failed saveSettings() reports the shared settings-save error toast');

    ctx.plugin.saveSettings = async () => {};
  }
  {
    const { ctx } = await mount();
    ctx.plugin.settings.exportFolder = '';
    answers.fields = { folder: 'MyExports' };
    ctx.plugin.saveSettings = async () => { throw new Error('simulated disk error'); };

    await assert.doesNotReject(() => ctx.exportTransactions(),
      'exportTransactions: a rejected saveSettings() for the remembered folder must not escape as an unhandled rejection');
    checks++;
    let lastToast = ctx._toasts[ctx._toasts.length - 1];
    // The export itself landed (four real vault writes, all left unforced) —
    // only remembering the folder for next time failed. The export's own
    // success toast must still be the LAST word on screen, not buried under
    // an error about a detail the reader never asked to see mid-export.
    ok(lastToast && lastToast.bad !== true,
      `exportTransactions: the export's own success toast still fires after a failed remembered-folder save, got ${JSON.stringify(lastToast)}`);
    ok(ctx._toasts.some(t => t.bad === true && t.msg === i18n.t('settings.err.save', { error: 'simulated disk error' })),
      'exportTransactions: the failed remembered-folder save still reports its own error toast');
    ok(ctx.plugin.settings.exportFolder !== '',
      'exportTransactions: the folder just typed is still real in memory even though it could not be remembered to disk');

    ctx.plugin.saveSettings = async () => {};
    answers.fields = null;
  }

  console.log(`PASS — save paths fail out loud (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
