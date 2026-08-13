'use strict';
/* Deleting things, and taking an import back.

   Every other destructive path in this app was already pinned — the rules
   tidy cannot delete without a backup, a split parent is never deleted at
   all — and these are the paths that arrived with the delete controls:

     1. a transaction row leaves memory and is only written on Save
     2. deleting a SPLIT PARENT takes its parts with it, so no row is left
        marked `part` describing a line that no longer exists
     3. a cancelled dialog changes nothing (the whole point of the dialog)
     4. deleting an account KEEPS its transactions folder unless asked, and
        the rows stay countable — the orphan-folder state CONTEXT.md names
     5. deleting it WITH the folder takes the month files and the S.txFiles
        entries together, so memory never models rows the disk no longer has
     6. an import can be undone, exactly and only the rows it added
     7. a vault re-read takes the undo offer away rather than leaving one that
        would silently remove nothing

   Drives the REAL views over the shared harness, with src/modal.js swapped for
   a programmable stub — the dialogs are where the decisions are taken, so a
   test that could not answer them could not reach any of this.

     node tests/delete-and-undo.test.cjs */

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- the dialogs, made answerable ---------------------------------------
   Injected into the require cache before any view is loaded, so the views get
   this instead of src/modal.js. `answers` is set per case; `seen` records what
   the user was actually shown, which is how the folder question below is
   checked to have been asked at all. */
const answers = { confirm: true, fields: null };
const seen = { confirms: [], fields: [] };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return answers.confirm; },
    async askFields(app, title, fields) { seen.fields.push({ title, fields }); return answers.fields; },
    async askSplit() { return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

/* ---- a vault with a split, two accounts and a folder --------------------
   Every figure is synthetic. Never put real statement data in this repo. */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\nbalance: -4000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n${HEAD}`
    + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n'
    + '| 2026-07-03 | Grocer | Groceries | -1200.00 |  |  |  |\n'
    + '| 2026-07-05 | Big shop | Groceries | -900.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-05 | Big shop | Groceries | -500.00 |  |  | part |\n'
    + '| 2026-07-05 | Big shop | Salary | -400.00 |  |  | part |\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: `---\n${TX_FM}\n---\n\n${HEAD}`
    + '| 2026-08-02 | Grocer | Groceries | -700.00 |  |  |  |\n',
});

async function mount(files = FILES()) {
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
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  // Assigned in controller.js rather than published by a module, so makeCtx
  // does not know about them and the delete paths would throw on the render
  // they end with — which reads like an app bug and is not one.
  ctx.render = () => {};
  ctx.switchView = () => {};
  ctx.reloadFromDisk = async () => {};
  return { ctx, S };
}

/* One transaction item as the table hands it to the delete: the row object
   itself, plus the file it lives in. Same shape filteredRows() builds. */
const itemFor = (S, key, match) => {
  const f = S.txFiles[key];
  const row = f.rows.find(match);
  return { label: f.label, _file: f, _row: row };
};
const rowsIn = (S, key) => S.txFiles[key].rows.length;

(async () => {
/* ---- 1. a row leaves memory, and only reaches disk on Save ---- */
{
  const { ctx, S } = await mount();
  answers.confirm = true;
  const before = ctx.vault._store.get(`${B}/Transactions/Cheque/2026-07.md`);
  await ctx.deleteTransaction(itemFor(S, 'Cheque/2026-07', r => r.desc === 'Grocer'));
  eq(rowsIn(S, 'Cheque/2026-07'), 4, 'the row is gone from the file model');
  ok(!S.txFiles['Cheque/2026-07'].rows.some(r => r.desc === 'Grocer'), 'and it is the right row');
  ok(S.txFiles['Cheque/2026-07'].dirty, 'the file is marked dirty so Save lights up');
  eq(ctx.vault._store.get(`${B}/Transactions/Cheque/2026-07.md`), before,
    'nothing is written to disk — serializeTxFile writes the WHOLE file, so an ' +
    'immediate write would flush every unsaved edit in the same month too');

  // …and the page's own Save is what actually writes it.
  await ctx.saveTransactions();
  const after = ctx.vault._store.get(`${B}/Transactions/Cheque/2026-07.md`);
  ok(!after.includes('| Grocer |'), 'after Save the row is gone from the file');
  ok(after.includes('| Salary |'), 'and the rows around it are not');
}

/* ---- 2. a split parent takes its parts with it ---- */
{
  const { ctx, S } = await mount();
  answers.confirm = true;
  await ctx.deleteTransaction(itemFor(S, 'Cheque/2026-07', r => r.split === 'parent'));
  eq(rowsIn(S, 'Cheque/2026-07'), 2, 'parent and both parts go together');
  ok(!S.txFiles['Cheque/2026-07'].rows.some(r => r.desc === 'Big shop'),
    'no row is left marked `part` describing a line that no longer exists');
  const msg = seen.confirms[seen.confirms.length - 1].message;
  ok(/2/.test(msg), 'and the dialog said how many parts were going with it');
}

/* ---- 3. cancelling changes nothing ---- */
{
  const { ctx, S } = await mount();
  answers.confirm = false;
  await ctx.deleteTransaction(itemFor(S, 'Cheque/2026-07', r => r.desc === 'Grocer'));
  eq(rowsIn(S, 'Cheque/2026-07'), 5, 'a declined dialog removes nothing');
  ok(!S.txFiles['Cheque/2026-07'].dirty, 'and leaves the file clean');
}

/* ---- 4. an account, keeping its transactions folder ---- */
{
  const { ctx, S } = await mount();
  answers.confirm = true;
  answers.fields = { folder: 'keep' };
  const acct = S.accounts.find(a => a.name === 'Cheque');
  await ctx.deleteAccount(acct);
  eq(ctx.vault._store.has(`${B}/Accounts/Cheque.md`), false, 'the account file is trashed');
  ok(!S.accounts.some(a => a.name === 'Cheque'), 'and dropped from the model');
  ok(ctx.vault._store.has(`${B}/Transactions/Cheque/2026-07.md`),
    'the transactions folder is KEPT — it was not asked for');
  eq(rowsIn(S, 'Cheque/2026-07'), 5,
    'and its rows stay countable: an orphan folder still contributes to period totals');
  const asked = seen.fields[seen.fields.length - 1];
  ok(/6/.test(asked.fields[0].desc), 'the folder question stated the row count (6 across both months)');
  ok(/2/.test(asked.fields[0].desc), 'and the number of monthly files');
}

/* ---- 5. an account, folder and all ---- */
{
  const { ctx, S } = await mount();
  answers.confirm = true;
  answers.fields = { folder: 'drop' };
  await ctx.deleteAccount(S.accounts.find(a => a.name === 'Cheque'));
  eq(ctx.vault._store.has(`${B}/Transactions/Cheque/2026-07.md`), false, 'the month files go too');
  eq(ctx.vault._store.has(`${B}/Transactions/Cheque/2026-08.md`), false, 'every one of them');
  eq(Object.keys(S.txFiles).filter(k => k.startsWith('Cheque/')).length, 0,
    'and the model drops them in the same breath — memory never models rows the disk lacks');
  eq((S.txFolders || []).includes('Cheque'), false, 'the folder leaves S.txFolders as well');
}

/* ---- 6. an import, undone ---- */
{
  const { ctx, S } = await mount();
  const { buildIndex } = require('../src/dedupe');
  // The review screen's state, built by hand: handleStatementFile needs a real
  // CSV and a File object, and neither is what this is testing.
  S.pendingImport = {
    label: 'Card', filename: 'card-july.csv', index: buildIndex(S.txFiles),
    items: [
      { date: '2026-07-11', desc: 'Fuel', cat: 'Groceries', amount: -800, excluded: false, include: true, dup: false },
      { date: '2026-07-12', desc: 'Coffee', cat: 'Groceries', amount: -60, excluded: false, include: true, dup: false },
      { date: '2026-08-03', desc: 'Books', cat: 'Groceries', amount: -240, excluded: false, include: true, dup: false },
    ],
  };
  await ctx.commitImport();
  eq(rowsIn(S, 'Card/2026-07'), 2, 'the July rows landed');
  eq(rowsIn(S, 'Card/2026-08'), 1, 'and the August one landed in its own month');
  ok(ctx.vault._store.get(`${B}/Transactions/Card/2026-07.md`).includes('| Fuel |'), 'on disk, not only in memory');
  eq(S.lastImport.count, 3, 'the receipt counts what landed');
  eq(S.lastImport.label, 'Card', 'and names where it went');
  eq(S.lastImport.files.length, 2, 'one entry per month file touched');

  // A row deleted by hand between the import and the undo: the undo must
  // report what it actually removes, not what the receipt remembers.
  await ctx.deleteTransaction(itemFor(S, 'Card/2026-08', r => r.desc === 'Books'));
  await ctx.saveTransactions();

  answers.confirm = true;
  await ctx.undoImport();
  eq(rowsIn(S, 'Card/2026-07'), 0, 'the imported rows are gone from the model');
  ok(!ctx.vault._store.get(`${B}/Transactions/Card/2026-07.md`).includes('| Fuel |'),
    'and from the file — an undo of a write has to be a write');
  eq(S.lastImport, null, 'the offer is spent');
  eq(rowsIn(S, 'Cheque/2026-07'), 5, 'nothing outside the import was touched');
  const msg = seen.confirms[seen.confirms.length - 1].message;
  ok(/\b2\b/.test(msg) && !/\b3\b/.test(msg),
    'the dialog offered the 2 rows still there, not the 3 the receipt remembers');
}

/* ---- 7. a vault re-read takes the offer away ---- */
{
  const { ctx, S } = await mount();
  S.lastImport = { label: 'Card', filename: 'x.csv', at: '10:00', count: 1, files: [] };
  await ctx.loadVault();
  eq(S.lastImport, null,
    'loadVault rebuilds every row object, so a receipt holding the old ones could ' +
    'only ever remove nothing — an undo button that quietly does nothing is worse than none');
}

console.log(`\nPASS — deletes remove exactly what was agreed, and an import can be taken back (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
