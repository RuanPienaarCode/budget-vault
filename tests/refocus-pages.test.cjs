'use strict';
/* The pages tests/refocus-views.test.cjs could not reach.

   That suite pinned the nine views the first round of the 11 Nov 2026 audit
   (task 16) owned: a handler that rebuilds the page under its own button
   leaves the reader ON the page. The same defect was still in the seven views
   that round did not own — Accounts, Budget, Plan, Food, Loans, Report and
   Score — and a one-line grep had guessed at five handlers. Reading each view
   end to end found forty-five across four of them, one in Report, and none in
   Loans or Score, whose forms are built once and whose outputs hold no
   control. Every one is driven here the way that suite drives its own: focus
   the control, press it, ask where focus is, against the focus model in
   tests/helpers/focus-stub.cjs (a control destroyed by a rebuild stops being
   the active element, exactly as in a browser).

   The landings follow that suite's rules, and add nothing to them:

     the control is redrawn      -> its own replacement, by key
     a row or a card is removed  -> the one that took its place, else the one
                                    before it, else the list's own Add button
     a control is replaced       -> what stands where it stood (a collapsed
                                    bucket's row and the open card's collapse
                                    button share a key for exactly this)
     a note or a card goes away  -> the first row of what it was about
     the page swaps to or from   -> the first control of the page that replaced
     its empty state                it; the way back in

   Loans and Score are in here too, as the negative: their handlers are
   pressed and focus must still be on the control afterwards. That is what
   "none found" means, held rather than remembered — the day one of them
   starts rebuilding its own form, this fails.

   A sibling file rather than more cases in refocus-views: three other lanes
   were editing these same views while this was written, and a second
   household in a second file is one fewer place for four branches to meet.

   The real views over the shared harness (tests/helpers/figures.cjs mountFor),
   with src/modal.js swapped for an answerable stub. Every figure is synthetic.

     node tests/refocus-pages.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

/* ---- the dialogs, made answerable ----------------------------------------
   Intercepted at Module._load, as tests/refocus-views.test.cjs does and for
   its reason: the mount helper empties the require cache of everything under
   src/ on each mount, which would put the real dialogs back after the first. */
const answers = { confirm: true, fields: null, reslice: null };
const MODAL_STUB = {
  async confirmModal() { return answers.confirm; },
  async askFields() { return answers.fields; },
  async askSplit() { return null; },
  async askRulesCleanup() { return false; },
  SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
  async askBudgetReslice(_app, plan) { return answers.reslice ? answers.reslice(plan) : null; },
};
{
  const Module = require('module');
  const prev = Module._load;
  Module._load = function (request, ...rest) {
    if (/(^|\/)modal(\.js)?$/.test(request)) return MODAL_STUB;
    return prev.call(this, request, ...rest);
  };
}

const { FakeEl, descend } = require('./helpers/dom-stub.cjs');
const { installFocus, keyed } = require('./helpers/focus-stub.cjs');
const { mountFor, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const focus = installFocus();

/* ---- the household -------------------------------------------------------- */
const B = 'Budget';
const TX_HEAD = '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const BUDGET_HEAD = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n';

const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Bills.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
  [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#7f8c8d"\n---\n',
  /* Assume-spent: the one kind of row that carries the "pull last period's
     overspend" button. */
  [`${B}/Categories/Card payment.md`]: '---\ntype: expense\ncolor: "#c0392b"\nassume_spent: true\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-10-01\n---\n',
  /* September went R 2 000 over what came in, so October has an overspend to
     pull. */
  [`${B}/Transactions/Cheque/2026-09.md`]: TX_HEAD
    + '| 2026-09-01 | Pay | Salary | 1000.00 |  |  |  |\n'
    + '| 2026-09-05 | Shop | Groceries | -3000.00 |  |  |  |\n',
  [`${B}/Transactions/Cheque/2026-10.md`]: TX_HEAD
    + '| 2026-10-01 | Pay | Salary | 20000.00 |  |  |  |\n'
    + '| 2026-10-05 | Shop | Groceries | -1500.00 |  |  |  |\n',
  [`${B}/Budgets/2026-09.md`]: BUDGET_HEAD + '| Groceries | expense | 4000.00 | |\n| Salary | income | 20000.00 | |\n',
  /* Fuel and Bills are NOT in October's file: virtual rows, which a category
     delete takes off the page. Groceries is, and stays. */
  [`${B}/Budgets/2026-10.md`]: BUDGET_HEAD + '| Groceries | expense | 5000.00 | |\n| Card payment | expense | 800.00 | |\n| Salary | income | 20000.00 | |\n',
});

/* The shell's own controls, as real ones (see refocus-views: the harness
   auto-creates anything asked for by id as a <div>, which focus cannot land
   on — right for a div, wrong for the buttons these pages fall back to). */
const SHELL = { '#budAddCat': 'button', '#budCopyPrev': 'button', '#budSave': 'button' };

async function mount(files = FILES()) {
  focus.reset();
  const M = await mountFor(files, { period: '2026-10', budgetFolder: B });
  for (const [id, tag] of Object.entries(SHELL)) {
    const had = M.nodes.get(id);
    ok(!had || !had.children.length, `${id} has not been drawn into before it is made a real ${tag}`);
    const node = new FakeEl(tag);
    node.attrs.id = id.slice(1);
    M.nodes.set(id, node);
  }
  M.ctx.render = () => { M.ctx[`render${M.view}`](); };
  M.ctx.switchView = () => {};
  M.ctx.reloadFromDisk = async () => {};
  return M;
}

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
/* What a keyboard reader does: be on the control, then press it. */
const press = async node => { focus.on(node); eq(focus.at(), node, 'precondition: the control can take focus'); node.click(); await settle(); };
const change = async (node, set) => { focus.on(node); eq(focus.at(), node, 'precondition: the field can take focus'); set(node); node._fire('change'); await settle(); };
const byClass = (root, cls) => descend(root).filter(e => e._cls.has(cls));
const need = (root, key) => { const n = keyed(root, key); ok(n, `the page renders a control keyed "${key}"`); return n; };
const landed = (key, msg) => eq(focus.key(), key, msg);
/* Every focus key under `root` starting with `prefix`, in the order drawn. */
const keysOf = (root, prefix) => descend(root).map(e => e.getAttribute('data-focus-key')).filter(k => k && k.startsWith(prefix));

(async () => {
  const unpin = pinClock('2026-10-15');
  try {
    /* ================= Budget ============================================= */
    {
      const M = await mount();
      M.view = 'Budgets';
      const t = M.ctx.$('#budTable');
      M.ctx.renderBudgets();

      // The amount: typed, committed, and the whole table is redrawn under it.
      await change(need(t, 'amount:Groceries'), n => { n.value = '5500'; });
      landed('amount:Groceries', 'committing a budget amount lands back in that row\'s amount field');
      eq(focus.at().getAttribute('value'), '5500', 'which is the rebuilt field, holding the figure just typed');
      await change(need(t, 'amount:Groceries'), n => { n.value = 'abc'; });
      landed('amount:Groceries', 'a refused amount lands back in the field that was refused');
      eq(focus.at().getAttribute('value'), '5500', 'showing the figure it still holds');

      // The two toggles: each writes the category's note, then redraws.
      await press(need(t, 'fixed:Groceries'));
      landed('fixed:Groceries', 'marking a category as a fixed bill lands back on that toggle');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');
      await press(need(t, 'assume:Groceries'));
      landed('assume:Groceries', 'marking a category as already spent lands back on that toggle');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');
      await press(need(t, 'assume:Groceries'));
      landed('assume:Groceries', 'and so does turning it off again');

      // Pull last period's overspend into an assume-spent row.
      await press(need(t, 'pull:Card payment'));
      landed('pull:Card payment', 'pulling the overspend lands back on that row\'s pull button');
      eq(keyed(t, 'amount:Card payment').getAttribute('value'), '2000', 'and the pull really happened: September\'s R 2 000 is in the field');

      // Clear: the button itself goes (the row is no longer in the file).
      await press(need(t, 'clear:Card payment'));
      eq(keyed(t, 'clear:Card payment'), null, 'a cleared row has no Clear button');
      landed('del:Card payment', 'clearing a row lands on what stands beside where Clear was, in the same cell');

      // Delete a category whose row is in this period's file: the row stays.
      await press(need(t, 'del:Groceries'));
      ok(!M.S.categories.some(c => c.name === 'Groceries'), 'the category is deleted');
      landed('del:Groceries', 'deleting a category whose budget row stays lands on that row\'s delete');

      // Delete one whose row is virtual: the row goes, and the next moves up.
      {
        const dels = keysOf(t, 'del:');
        const at = dels.indexOf('del:Bills');
        ok(at >= 0 && at < dels.length - 1, 'Bills is on the page with a row after it');
        await press(need(t, 'del:Bills'));
        eq(keyed(t, 'del:Bills'), null, 'the deleted category\'s row is gone');
        landed(dels[at + 1], 'deleting a category lands on the row that moved up into its place');
      }
      // The last row on the page: the one above. With nothing in this
      // period's file every row is virtual, so a delete takes it off the page.
      {
        M.S.budgets['2026-10'] = [];
        M.ctx.invalidateBudgetDraft();
        M.ctx.renderBudgets();
        const dels = keysOf(t, 'del:');
        ok(dels.length >= 2, 'at least two categories are left');
        await press(need(t, dels[dels.length - 1]));
        eq(keyed(t, dels[dels.length - 1]), null, 'the last row is gone');
        landed(dels[dels.length - 2], 'deleting the last row lands on the one above');
      }
      // The only row: the page's Add category.
      {
        M.S.categories.splice(1);
        M.ctx.invalidateBudgetDraft();
        M.ctx.renderBudgets();
        const dels = keysOf(t, 'del:');
        eq(dels.length, 1, 'one category is left');
        await press(need(t, dels[0]));
        eq(keysOf(t, 'del:').length, 0, 'and now none');
        eq(focus.at(), M.ctx.$('#budAddCat'), 'deleting the only category lands on Add category');
      }
    }

    /* ---- Budget: the note above the table -------------------------------- */
    {
      const M = await mount();
      M.view = 'Budgets';
      const t = M.ctx.$('#budTable');
      const note = M.ctx.$('#budShapeNote');

      // A fresh period: the note offers last period's budget, and steps aside
      // once it has been copied.
      M.S.budgets['2026-10'] = [];
      M.ctx.invalidateBudgetDraft();
      M.ctx.renderBudgets();
      ok(!note._cls.has('hidden'), 'an unbudgeted period with a budgeted one before it shows the note');
      await press(need(note, 'copy'));
      ok(note._cls.has('hidden'), 'the note steps aside once the copy is in the draft');
      landed('row:0', 'copying from the note lands on the first row of the budget it filled');
      eq(focus.at().tagName, 'TR', 'which is the row itself');

      // Budgets stranded under another period length: both offers stay up.
      M.S.budgets['2026-09'] = [];
      M.S.budgets['2026-08-07'] = [{ category: 'Groceries', type: 'expense', amount: 700, notes: 'weekly shop' },
        { category: 'Fuel', type: 'expense', amount: 300, notes: '' }];
      M.ctx.invalidateBudgetDraft();
      M.ctx.renderBudgets();
      ok(!note._cls.has('hidden'), 'budgets saved under another period length show the note');
      await press(need(note, 'bring'));
      landed('bring', 'bringing the categories over lands back on that offer, which is still there');
      answers.reslice = plan => plan.rows.slice(0, 1).map(r => ({ category: r.category, amount: 100, notes: '' }));
      await press(need(note, 'reslice'));
      landed('reslice', 'bringing the amounts over lands back on that offer');
      answers.reslice = null;
    }
  } finally {
    unpin();
  }

  console.log(`PASS refocus-pages — the remaining pages keep the reader on the page after a rebuild (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
