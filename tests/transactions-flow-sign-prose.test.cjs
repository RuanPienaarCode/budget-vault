'use strict';
/* Every place the Transactions page prints a ROW amount prints it as the flow
   it is, in the one signed form (2026-10-20 audit, D2-04, D1-12, MT-02).

   tests/transactions-amount-flow-sign.test.cjs pins the table. The same row
   amount is also printed in four sentences the page writes, and a reader who
   sees "−R 50,00" in the table and then "R -50,00" in the dialog that is
   about to delete that very row is reading two forms of one figure:

     • the delete confirmation          (tx.delete.msg {amount})
     • the un-split confirmation        (tx.unsplit.msg {amount})
     • the toast after Add transaction  (tx.add.done {amount})
     • the split dialog, which prints the line it is splitting and the running
       remainder through the formatter the page hands it (askSplit `money`)

   The split dialog also used to get the HOUSEHOLD formatter for a row on a
   foreign account, so a €900 line was offered for splitting as "R -900.00" —
   the exact assertion the top of views/transactions.js says a row on another
   account must never make. It gets the row's own symbol now.

   Deliberately NOT changed: the shortfall on a split parent's chip
   (tx.split.chipGap). It is a MAGNITUDE by design — the parent's own amount,
   printed with its direction one cell to the left, carries the sign — and
   views/transactions.js explains why a minus there would read as a direction
   the sentence does not need.

   Drives the REAL view over the shared harness, with src/modal.js swapped for
   a stub that records what each dialog was shown. The figures are formatted by
   the REAL currency.js (formatSigned) under the harness's za locale, whatever
   the harness's money() stub says, because that is the formatter the page now
   prints a flow with.

     node tests/transactions-flow-sign-prose.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend, readable } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const answers = { confirm: false, fields: null };
const seen = { confirms: [], splits: [] };
const modalPath = require.resolve('../src/modal.js');
require.cache[modalPath] = {
  id: modalPath, filename: modalPath, loaded: true, exports: {
    async confirmModal(app, opts) { seen.confirms.push(opts); return answers.confirm; },
    async askFields() { return answers.fields; },
    async askSplit(app, opts) { seen.splits.push(opts); return null; },
    async askRulesCleanup() { return false; },
    SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
    async askBudgetReslice() { return null; },
  },
};

const MINUS = '−';
const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
/* Every figure is made up. */
const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Travel Euro.md`]: '---\ntype: savings\ncurrency: "€"\nbalance: 500.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Transactions/Cheque/2026-07.md`]: `---\naccount: "Cheque"\nmonth: 2026-07\n---\n\n${HEAD}`
    + '| 2026-07-01 | Pay | Salary | 41000.00 |  |  |  |\n'
    + '| 2026-07-02 | Corner shop | Groceries | -1250.50 |  |  |  |\n'
    + '| 2026-07-05 | Big shop | Groceries | -1200.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-05 | Big shop | Groceries | -800.00 |  |  | part |\n'
    + '| 2026-07-05 | Big shop | Salary | -400.00 |  |  | part |\n',
  [`${B}/Transactions/Travel Euro/2026-07.md`]: `---\naccount: "Travel Euro"\nmonth: 2026-07\n---\n\n${HEAD}`
    + '| 2026-07-06 | Hotel | Groceries | -900.00 |  |  |  |\n',
});

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
  for (const f of ['dashboard', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  ctx.render = () => {};
  ctx.switchView = () => {};
  ctx.reloadFromDisk = async () => {};
  return { ctx, S };
}

const itemOf = (S, label, match) => {
  const f = Object.values(S.txFiles).find(x => x.label === label);
  return { label, _file: f, _row: f.rows.find(match) };
};
const lastConfirm = () => readable(seen.confirms[seen.confirms.length - 1].message);
const noBalanceForm = (s, what) => ok(!/(R|€) -\d/.test(s), `${what} does not print the BALANCE form "R -…" for a row amount (got "${s}")`);

(async () => {
  /* ---- the delete confirmation ---- */
  {
    const { ctx, S } = await mount();
    ctx.renderTransactions();
    answers.confirm = false;
    await ctx.deleteTransaction(itemOf(S, 'Cheque', r => r.desc === 'Corner shop'));
    ok(lastConfirm().includes(`${MINUS}R 1 250,50`), `deleting a spend names it as the flow it is, "${MINUS}R 1 250,50" (got "${lastConfirm()}")`);
    noBalanceForm(lastConfirm(), 'the delete confirmation');
    await ctx.deleteTransaction(itemOf(S, 'Cheque', r => r.desc === 'Pay'));
    ok(lastConfirm().includes('+R 41 000,00'), `deleting income names it with its plus, "+R 41 000,00" (got "${lastConfirm()}")`);
    await ctx.deleteTransaction(itemOf(S, 'Travel Euro', r => r.desc === 'Hotel'));
    ok(lastConfirm().includes(`${MINUS}€ 900,00`), `a row on a foreign account keeps its own symbol in the same form (got "${lastConfirm()}")`);
  }

  /* ---- the un-split confirmation, reached through the chip ---- */
  {
    const { ctx } = await mount();
    ctx.renderTransactions();
    answers.confirm = false;
    const chip = descend(ctx.$('#txTable')).find(n => n.tagName === 'BUTTON' && /caveat-chip-btn/.test(n.className));
    ok(!!chip, 'the split parent renders its chip');
    chip.click();
    await new Promise(r => setImmediate(r));
    ok(lastConfirm().includes(`${MINUS}R 1 200,00`), `the un-split names the line it puts back as a flow (got "${lastConfirm()}")`);
    noBalanceForm(lastConfirm(), 'the un-split confirmation');
  }

  /* ---- the split dialog's formatter ---- */
  {
    const { ctx, S } = await mount();
    ctx.renderTransactions();
    await ctx.splitTransaction(itemOf(S, 'Cheque', r => r.desc === 'Corner shop'));
    const home = seen.splits[seen.splits.length - 1];
    eq(readable(home.money(-1250.5)), `${MINUS}R 1 250,50`, 'the split dialog prints the line it is splitting as a flow');
    eq(readable(home.money(-0.004)), 'R 0,00', 'and a remainder that rounds to nothing as plain zero — no stray sign');
    await ctx.splitTransaction(itemOf(S, 'Travel Euro', r => r.desc === 'Hotel'));
    const euro = seen.splits[seen.splits.length - 1];
    eq(readable(euro.money(-900)), `${MINUS}€ 900,00`, 'a row on a euro account is offered for splitting in euro, not as rand');
  }

  /* ---- the toast after Add transaction ---- */
  {
    const { ctx } = await mount();
    ctx.renderTransactions();
    answers.fields = { date: '2026-07-20', desc: 'Market', label: 'Cheque', dir: 'out', amount: '75', cat: '', note: '' };
    await ctx.addTransaction();
    const toast = readable((ctx._toasts[ctx._toasts.length - 1] || {}).msg || '');
    ok(toast.includes(`${MINUS}R 75,00`), `the confirmation names the row just added as a flow (got "${toast}")`);
    noBalanceForm(toast, 'the add toast');
    answers.fields = { date: '2026-07-21', desc: 'Refund', label: 'Cheque', dir: 'in', amount: '20', cat: '', note: '' };
    await ctx.addTransaction();
    const toastIn = readable((ctx._toasts[ctx._toasts.length - 1] || {}).msg || '');
    ok(toastIn.includes('+R 20,00'), `and money in with its plus (got "${toastIn}")`);
  }

  console.log(`PASS transactions-flow-sign-prose — the delete, un-split and split dialogs and the add toast print a row amount as a flow (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
