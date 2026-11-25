'use strict';
/* Deleting a category must say what it will do to the figures (2026-11-25
   audit, BUD-1, the honest-dialog half).

   A transaction's kind (income / transfer / spending) is looked up from its
   category's NOTE (ledger.js reads the category's `type`), so a category file
   that is trashed takes the kind of every row filed under it with it, in EVERY
   period. The confirm used to say "Past budget files are not changed", which is
   true of the budget files and says nothing of the thing that changes: a
   deleted income category's money stopped counting as income, a deleted
   transfer category's rows became uncategorised spending. It also said nothing
   of the categorisation rules that name the category: they keep filing new
   imports under the deleted name (RUL-9), which is how the same rows come back
   after the reader has tidied them.

   What is pinned here is the dialog, not the remedy. Whether a category that
   is in use should be archived, or refused, is the owner's call and is not
   built: the delete stays possible. The strings are i18n keys (cat.delete.*),
   so the test reads them through the same i18n.t the dialog does.

   Also (BUD-10a): a saved budget row whose category note no longer exists has
   no category left to delete, and the trash icon beside it did nothing and said
   nothing. It is no longer offered; Clear (the row's own button) is how the row
   leaves the budget.

   Real loader, real categories module, real i18n. The confirm dialog is
   answered at the module loader, which records what it was asked.
   Synthetic files only.
     node tests/category-delete-says-what-changes.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

let asked = null;
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null,
      askRulesCleanup: async () => false,
      confirmModal: async (_app, o) => { asked = o; return false; },   // declining: this test reads the words only
    };
  }
  return realLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const registerCategories = require('../src/categories');
const i18n = require('../src/i18n');

const B = 'Budget';
const TX_HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const cat = type => `---\ntype: ${type}\ncolor: "#888888"\n---\n`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: cat('income'),
  [`${B}/Categories/Groceries.md`]: cat('expense'),
  [`${B}/Categories/Move to savings.md`]: cat('transfer'),
  [`${B}/Categories/Unused.md`]: cat('expense'),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: TX_HEAD
    + '| 2026-08-25 | Acme payroll | Salary | 20000.00 |  |  |  |\n'
    + '| 2026-08-26 | Checkers | Groceries | -300.00 |  |  |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: TX_HEAD
    + '| 2026-09-25 | Acme payroll | Salary | 20000.00 |  |  |  |\n'
    + '| 2026-09-02 | To savings | Move to savings | -1000.00 |  |  |  |\n',
  [`${B}/Data/Categorisation Rules.csv`]: 'pattern,category\nacme,Salary\npayroll,Salary\ncheckers,Groceries\n',
};

async function boot(files = FILES) {
  const ctx = makeCtx(files, { budgetFolder: B });
  await loadInto(ctx);
  registerCategories(ctx);
  return ctx;
}
const messageFor = async (ctx, name) => { asked = null; await ctx.promptDeleteCategory(name); return asked; };

(async () => {
  const ctx = await boot();
  eq(ctx.S.rules.filter(r => r.category === 'Salary').length, 2, 'fixture: two rules name Salary');

  /* ---- an income category in use: the figure change and the rule count ---- */
  {
    const a = await messageFor(ctx, 'Salary');
    ok(a, 'the confirm was opened');
    const m = a.message;
    ok(m.includes('"Salary"'), 'it names the category');
    ok(/2 transactions/.test(m), 'it says how many transactions are filed under it');
    ok(m.includes('Income'), 'it names the kind that is lost');
    ok(/stops counting as income/.test(m), 'it says the figure that changes: that money stops counting as income');
    ok(/every period, past ones included/.test(m), 'and that this reaches every period, past ones included');
    ok(/re-categorised/.test(m), 'until the rows are re-categorised');
    ok(/2 categorisation rules/.test(m), 'it counts the rules that name the category');
    ok(/keep doing so/.test(m), 'and says they keep filing new imports under the deleted name');
    ok(!/Past budget files are not changed/.test(m), 'the sentence that hid the change is gone from the in-use dialog');
    ok(/vault trash/.test(m), 'the trash promise stays');
    eq(a.title, i18n.t('cat.delete.title'), 'the title is an i18n key');
    eq(a.confirmText, i18n.t('cat.delete.confirm'), 'so is the button');
  }

  /* ---- a transfer category: the rows become spending ---- */
  {
    const m = (await messageFor(ctx, 'Move to savings')).message;
    ok(/1 transaction is/.test(m), 'singular count');
    ok(m.includes('Transfers'), 'names the transfer kind');
    ok(/stops being a transfer/.test(m) && /uncategorised spending/.test(m), 'transfer rows become uncategorised spending');
    ok(!/categorisation rule/.test(m), 'no rule names it, so no rule sentence');
  }

  /* ---- an ordinary spending category with one rule ---- */
  {
    const m = (await messageFor(ctx, 'Groceries')).message;
    ok(/1 transaction is/.test(m), 'one transaction');
    ok(/uncategorised spending in every period, past ones included/.test(m), 'counts as uncategorised spending in every period');
    ok(/1 categorisation rule still files/.test(m), 'singular rule sentence');
  }

  /* ---- unused: nothing changes in the figures, and it says so ---- */
  {
    const m = (await messageFor(ctx, 'Unused')).message;
    ok(/No transaction uses it/.test(m), 'says nothing uses it');
    ok(!/uncategorised spending/.test(m) && !/categorisation rule/.test(m), 'and does not invent a consequence');
    ok(/Past budget files are not changed/.test(m), 'the original reassurance is true here and stays');
  }

  /* ---- the words come from the language table ---- */
  {
    i18n.setLanguage('de');
    try {
      const m = (await messageFor(ctx, 'Salary')).message;
      ok(!/stops counting as income/.test(m), 'in German the English sentence is not used');
      ok(m.includes('2'), 'the count still reaches the sentence');
    } finally { i18n.setLanguage('en'); }
  }

  /* ---- BUD-10a: a budget row whose category note is gone offers no dead trash button ---- */
  {
    const { mountFor, pinClock } = require('./helpers/figures.cjs');
    const { find, hasClass } = require('./helpers/dash-audit.cjs');
    const unpin = pinClock('2026-09-10');
    try {
      const files = {
        ...FILES,
        [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
          + '| Groceries | expense | 3000.00 |  |\n| Old category | expense | 500.00 |  |\n',
      };
      const M = await mountFor(files, { period: '2026-09' });
      M.ctx.renderBudgets();
      const rows = find(M.ctx.$('#budTable'), n => n.tagName === 'TR' && n.attrs && n.attrs['data-focus-key']);
      const rowOf = name => rows.find(r => find(r, n => n.attrs && n.attrs['aria-label'] === `Budget amount for ${name}`).length);
      const del = r => find(r, n => n.tagName === 'BUTTON' && hasClass(n, 'bud-act-delete'));
      const clr = r => find(r, n => n.tagName === 'BUTTON' && hasClass(n, 'bud-act-clear'));
      const groceries = rowOf('Groceries'), old = rowOf('Old category');
      ok(groceries && old, 'both rows are on the page');
      eq(del(groceries).length, 1, 'a category that exists keeps its Delete button');
      eq(del(old).length, 0, 'a category with no note has no Delete button that does nothing');
      eq(clr(old).length, 1, 'Clear stays: it is how the row leaves this period\'s budget');
    } finally { unpin(); }
  }

  console.log(`PASS category-delete-says-what-changes (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
