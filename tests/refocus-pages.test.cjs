'use strict';
/* The pages tests/refocus-views.test.cjs could not reach.

   That suite pinned the nine views the first round of the 11 Nov 2026 audit
   (task 16) owned: a handler that rebuilds the page under its own button
   leaves the reader ON the page. The same defect was still in the seven views
   that round did not own — Accounts, Budget, Plan, Food, Loans, Report and
   Score — and a one-line grep had guessed at five handlers. Reading each view
   end to end found forty-five: sixteen on Plan, fourteen on Accounts, nine on
   Budget, five on Food, one on Report — and none on Loans or Score, whose
   controls are built once and repainted in place. Every one is driven here the way that suite drives its own: focus
   the control, press it, ask where focus is, against the focus model in
   tests/helpers/focus-stub.cjs (a control destroyed by a rebuild stops being
   the active element, exactly as in a browser).

   The landings follow that suite's rules, with one thing said out loud that
   they left implicit (the review of this change found it twice): the landing
   on a row that took another's place is that row's QUIET control — its name,
   its edit button — wherever the control pressed commits without asking. The
   next source's ✕ under an Enter held down, or the next product's category
   select under an arrow key, would act on a row the reader never chose.

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

/* A plan with three of everything, so "the one that moved up", "the one
   before" and "the list's Add button" are each a different landing. */
const planFile = (name, sources, envelopes, items = []) => [
  '---', 'kind: plan', `plan: "${name}"`, 'started: "2026-08-01"', 'status: active', '---', '',
  `# ${name}`, '', '## Money in', '',
  '| Source | Kind | Amount | Date | Status | Notes |', '|--------|------|-------:|------|--------|-------|',
  ...sources.map(([n, a]) => `| ${n} | Other | ${a} | 2026-08-03 | received |  |`), '',
  '## Envelopes', '', '| Envelope | Amount | Note | Tint |', '|----------|-------:|------|------|',
  ...envelopes.map(([n, a]) => `| ${n} | ${a} |  |  |`), '',
  '## Items', '', '| Item | Envelope | Amount | Spent | Status | Category | Notes |',
  '|------|----------|-------:|------:|--------|----------|-------|',
  ...items.map(([n, e, a]) => `| ${n} | ${e} | ${a} | 0.00 | planned |  |  |`), '',
].join('\n');
const PLAN_FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Plans/Alpha.md`]: planFile('Alpha',
    [['Payout', '20000.00'], ['Refund', '3000.00'], ['Bonus', '2000.00']],
    [['Settle up', '11600.00'], ['Coming up', '4500.00'], ['For us', '1200.00']],
    [['Dinner out', 'For us', '400.00'], ['Cinema', 'For us', '300.00'], ['Weekend', 'For us', '500.00']]),
  [`${B}/Plans/Beta.md`]: planFile('Beta', [['Gift', '5000.00']], [['First of Beta', '3000.00']]),
});

/* Two till slips in October, written by the app's own serializer so the
   fixture is in the format the loader reads. Two products under "Dairy &
   eggs", so filtering to it and re-filing one leaves the category standing. */
const RECEIPT_FILES = () => {
  const { serializeReceipt, receiptPath } = require('../src/receipt-file');
  const line = (name, amount, category) => ({ barcode: '', name, amount, discount: 0, category, healthy: false });
  const slips = [
    { store: 'Grocer One', date: '2026-10-03', time: '10:15', total: 115,
      items: [line('Milk 2L', 40, 'Dairy & eggs'), line('Brown bread', 30, 'Bakery'), line('Apples', 25, 'Fruit & veg'), line('Yoghurt', 20, 'Dairy & eggs')] },
    { store: 'Grocer Two', date: '2026-10-09', time: '17:40', total: 125,
      items: [line('Milk 2L', 45, 'Dairy & eggs'), line('Cheddar', 80, 'Cheese')] },
  ];
  const out = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };
  for (const r of slips) out[`${B}/${receiptPath(r)}`] = serializeReceipt(r);
  return out;
};

/* Six accounts across two owners and nobody. Cheque, Joint and Second each
   have a row dated after their balance was confirmed, so each DRIFTS and the
   inspector offers the implied figure; Card has never been confirmed; Wallet
   and Pot are quiet. Pot also has a row dated ON its confirmation day, which
   earns the inspector's same-day line. */
const ACCOUNT_FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nowner: Sam\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Joint.md`]: '---\ntype: checking\nowner: Lee\ntx_label: "Joint"\nbalance: 8000.00\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Second.md`]: '---\ntype: checking\nowner: Lee\ntx_label: "Second"\nbalance: 6000.00\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\nowner: Sam\ntx_label: "Card"\nbalance: -4000.00\n---\n',
  [`${B}/Accounts/Pot.md`]: '---\ntype: savings\nowner: Lee\ntx_label: "Pot"\nbalance: 5000.00\nbalance_updated: 2026-10-14\n---\n',
  [`${B}/Accounts/Wallet.md`]: '---\ntype: cash\nbalance: 300.00\nbalance_updated: 2026-10-14\n---\n',
  [`${B}/Transactions/Cheque/2026-10.md`]: TX_HEAD + '| 2026-10-05 | Shop | Groceries | -500.00 |  |  |  |\n',
  [`${B}/Transactions/Joint/2026-10.md`]: TX_HEAD + '| 2026-10-06 | Shop | Groceries | -250.00 |  |  |  |\n',
  [`${B}/Transactions/Second/2026-10.md`]: TX_HEAD + '| 2026-10-07 | Shop | Groceries | -75.00 |  |  |  |\n',
  [`${B}/Transactions/Card/2026-10.md`]: TX_HEAD + '| 2026-10-02 | Shop | Groceries | -100.00 |  |  |  |\n',
  [`${B}/Transactions/Wallet/2026-10.md`]: TX_HEAD + '| 2026-10-02 | Kiosk | Groceries | -20.00 |  |  |  |\n',
  [`${B}/Transactions/Pot/2026-10.md`]: TX_HEAD + '| 2026-10-03 | Move | Groceries | 100.00 |  |  |  |\n| 2026-10-14 | Move | Groceries | 60.00 |  |  |  |\n',
});

/* The shell's own controls, as real ones (see refocus-views: the harness
   auto-creates anything asked for by id as a <div>, which focus cannot land
   on — right for a div, wrong for the buttons these pages fall back to). */
const SHELL = { '#budAddCat': 'button', '#budCopyPrev': 'button', '#budSave': 'button',
  '#planStart': 'button', '#planNew': 'button', '#planDelete': 'button',
  '#planAddSource': 'button', '#planAddEnvelope': 'button', '#foodAdd': 'button', '#acctAdd': 'button' };

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
  /* The two halves of the Plan page, nested the way the shell nests them, so
     hiding a card hides what is in it. */
  M.ctx.$('#planEmptyCard').append(M.ctx.$('#planStart'));
  M.ctx.$('#planContent').append(M.ctx.$('#planNew'), M.ctx.$('#planDelete'), M.ctx.$('#planAddSource'), M.ctx.$('#planAddEnvelope'));
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

    /* ================= Plan =============================================== */
    {
      const M = await mount(PLAN_FILES());
      M.view = 'Plan';
      const $ = M.ctx.$;
      const picker = $('#planPicker'), sources = $('#planSources'), envs = $('#planEnvelopes'), free = $('#planFree');
      M.ctx.renderPlan();
      const cls = c => focus.at()._cls.has(c);

      // The picker (before anything is edited: it refuses while the plan is dirty).
      await press(need(picker, 'plan:Beta'));
      landed('plan:Beta', 'switching plan lands on the plan that was chosen');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');
      await press(need(picker, 'plan:Alpha'));
      landed('plan:Alpha', 'and back');

      // Sources: an edit, then removals from the top, the bottom, and the last.
      const source = { name: 'Payout', kind: 'Other', amount: '21000', date: '2026-08-03', status: 'received', notes: '', remove: [] };
      answers.fields = source;
      await press(need(sources, 'src:0'));
      landed('src:0', 'editing a source lands back on that source');
      ok(/21/.test(focus.at().parentElement.textContent), 'on the rebuilt row, showing the new amount');
      /* On the row, not on its ✕: the ✕ asks nothing, and Enter held down
         repeats — a landing on the next ✕ would empty the list in one press. */
      const second = M.S.plans.Alpha.sources[1].name;
      await press(need(sources, 'srcdel:0'));
      landed('src:0', 'removing a source lands on the one that moved up');
      ok(focus.at()._cls.has('src2-main') && new RegExp(second).test(focus.at().textContent), 'on that source\'s own button, never its ✕');
      await press(need(sources, 'srcdel:1'));
      landed('src:0', 'removing the last source lands on the one above');
      answers.fields = { ...source, remove: ['yes'] };
      await press(need(sources, 'src:0'));
      eq(M.S.plans.Alpha.sources.length, 0, 'the edit sheet removed the only source');
      eq(focus.at(), $('#planAddSource'), 'and the reader is on Add a source');

      // The accordion: a collapsed row and the open card's Collapse are one control.
      await press(need(envs, 'env:1'));
      landed('env:1', 'opening a bucket lands on the same key');
      ok(cls('env-collapse'), 'which is now that bucket\'s Collapse button');
      await press(focus.at());
      landed('env:1', 'collapsing it lands on the same key again');
      ok(cls('env-sum'), 'which is its collapsed row');
      await press(need(envs, 'env:2'));
      ok(cls('env-collapse'), 'the third bucket is open');

      // Inside the open card.
      await change(need(envs, 'slider:2'), n => { n.value = '1500'; });
      landed('slider:2', 'a step on the slider lands back on the slider');
      eq(M.S.plans.Alpha.envelopes[2].amount, 1500, 'with the step taken');
      answers.fields = { amount: '1600' };
      await press(need(envs, 'amt:2'));
      landed('amt:2', 'typing the amount lands back on the figure');
      answers.fields = { name: 'For us two', note: '' };
      await press(need(envs, 'rename:2'));
      landed('rename:2', 'renaming a bucket lands back on its name');
      ok(/For us two/.test(focus.at().textContent), 'which is the new name');
      answers.fields = { name: 'Picnic', amount: '100', category: '' };
      await press(need(envs, 'additem:2'));
      landed('additem:2', 'adding an item lands back on "+ item"');
      await press(need(envs, 'tick:1'));
      landed('tick:1', 'advancing an item lands back on its tick');
      ok(cls('part'), 'which shows the new state');

      // An item: edited in place, removed, moved to another bucket, the last one.
      const item = n => ({ name: n, amount: '300', spent: '0', envelope: 'For us two', category: '', notes: '', remove: [] });
      answers.fields = item('Cinema');
      await press(need(envs, 'item:1'));
      landed('item:1', 'editing an item lands back on that item');
      answers.fields = { ...item('Dinner out'), remove: ['yes'] };
      await press(need(envs, 'item:0'));
      landed('item:0', 'removing an item lands on the one that moved up');
      ok(/Cinema/.test(focus.at().textContent), 'which is the next item');
      eq(keysOf(envs, 'item:').length, 3, 'three items are left in the bucket');
      answers.fields = { ...item('Picnic'), envelope: 'Coming up' };
      await press(need(envs, 'item:2'));
      landed('item:1', 'moving the last item to another bucket lands on the one above');
      for (const name of ['Cinema', 'Weekend']) {
        answers.fields = { ...item(name), remove: ['yes'] };
        await press(need(envs, 'item:0'));
      }
      landed('additem:2', 'removing the only item lands on the bucket\'s "+ item"');

      // Removing a bucket.
      answers.confirm = false;
      await press(need(envs, 'envdel:2'));
      landed('envdel:2', 'a removal that was cancelled leaves the reader on the delete');
      answers.confirm = true;
      await press(need(envs, 'envdel:2'));
      landed('env:1', 'removing the last bucket lands on the one before it');
      ok(cls('env-sum'), 'its row — not the delete of whichever bucket the accordion opened instead');
      await press(need(envs, 'envdel:0'));
      landed('env:0', 'removing a bucket lands on the one that took its place');
      ok(cls('env-collapse'), 'which the accordion has opened');
      await press(need(envs, 'envdel:0'));
      eq(M.S.plans.Alpha.envelopes.length, 0, 'no bucket is left');
      eq(focus.at(), $('#planAddEnvelope'), 'removing the only bucket lands on Add a spending bucket');

      // The loud card. Nothing funds the plan and nothing is placed: no card.
      ok(free._cls.has('hidden'), 'an empty plan has no loud card');
      M.S.plans.Alpha.sources.push({ name: 'Payout', kind: 'Other', amount: 1000, date: '2026-08-03', status: 'received', notes: '' });
      M.ctx.renderPlan();
      ok(!free._cls.has('hidden'), 'money in no bucket brings the card up');
      answers.fields = { name: 'Extra', kind: 'Other', amount: '500', date: '' };
      await press(need(free, 'free:source'));
      landed('free:source', 'adding a source from the card lands back on that button while the card stands');
      answers.fields = { name: 'First', amount: '400', note: '' };
      await press(need(free, 'free:place'));
      landed('free:place', 'placing some of it lands back on the offer, which still stands');
      answers.fields = { name: 'Rest', amount: '1100', note: '' };
      await press(need(free, 'free:place'));
      ok(free._cls.has('hidden'), 'placing all of it takes the card away');
      landed('env:1', 'and the reader is on the bucket the press made');
      ok(cls('env-collapse') && /Rest/.test(focus.at().parentElement.textContent), 'which the accordion has opened');
      // Over-placed: only the source offer is left, and a source that covers it
      // takes the card away with the button in it.
      M.S.plans.Alpha.envelopes[1].amount = 1600;
      M.ctx.renderPlan();
      ok(!free._cls.has('hidden') && !keyed(free, 'free:place'), 'an over-placed plan shows the card with the one offer');
      answers.fields = { name: 'Cover', kind: 'Other', amount: '500', date: '' };
      await press(need(free, 'free:source'));
      ok(free._cls.has('hidden'), 'a source that covers the gap takes the card away');
      eq(focus.at(), $('#planAddSource'), 'and the reader is on the page\'s own Add a source');

      // Deleting a plan with another still standing: the button is still there.
      const del = $('#planDelete');
      focus.on(del);
      await M.ctx.deletePlan();
      await settle();
      eq(Object.keys(M.S.plans), ['Beta'], 'one plan is left');
      eq(focus.at(), del, 'deleting one of two plans leaves focus on Delete plan, which is still on the page');
      // Deleting the last one swaps the page for its empty state.
      await M.ctx.deletePlan();
      await settle();
      eq(Object.keys(M.S.plans).length, 0, 'no plan is left');
      eq(focus.at(), $('#planStart'), 'deleting the last plan lands on Start a plan, the way back in');
      // ...and Start swaps it back.
      answers.fields = { name: 'Fresh' };
      focus.on($('#planStart'));
      await M.ctx.newPlan();
      await settle();
      ok(M.S.plans.Fresh, 'a plan was started');
      eq(focus.at(), $('#planAddSource'), 'starting a plan lands on Add a source, the first thing a new plan asks for');
      answers.fields = null;
    }

    /* ================= Food =============================================== */
    {
      const M = await mount(RECEIPT_FILES());
      M.view = 'Food';
      const $ = M.ctx.$;
      const cats = $('#foodCats'), items = $('#foodItemsBody'), slips = $('#foodReceiptsBody');
      /* A re-file reads and rewrites every receipt carrying the product. */
      const written = async () => { for (let i = 0; i < 6; i++) await settle(); };
      M.ctx.renderFood();
      eq(M.S.receipts.length, 2, 'both slips loaded');
      const keyFor = (prefix, name) => {
        const row = descend(items).find(e => e.tagName === 'TR' && byClass(e, 'food-item-name').some(b => b.textContent === name));
        ok(row, `${name} is in the Items table`);
        return descend(row).map(e => e.getAttribute('data-focus-key')).find(k => k && k.startsWith(prefix + ':'));
      };

      // The category list: a press filters the table and redraws the page.
      await press(need(cats, 'cat:Bakery'));
      landed('cat:Bakery', 'filtering by a category lands back on that category');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');
      eq(keysOf(items, 'item:').length, 1, 'and the table is filtered to it');
      await press(focus.at());
      landed('cat:Bakery', 'and so does taking the filter off');
      eq(keysOf(items, 'item:').length, 5, 'with every product back');

      // A row's three controls.
      const milk = keyFor('item', 'Milk 2L');
      await press(need(items, milk));
      landed(milk, 'opening a product\'s price chart lands back on its name');
      eq(focus.at().getAttribute('aria-expanded'), 'true', 'which now reads expanded');
      const healthy = keyFor('healthy', 'Apples');
      await change(need(items, healthy), n => { n.checked = true; });
      await written();
      landed(healthy, 'ticking Healthy lands back on that tick, once the receipts are rewritten');
      ok(M.S.receipts.some(r => r.items.some(it => it.name === 'Apples' && it.healthy)), 'and the re-file really happened');
      const bread = keyFor('filed', 'Brown bread');
      await change(need(items, bread), n => { n.value = 'Pantry'; });
      await written();
      landed(bread, 're-filing a product lands back on its category select');
      eq(focus.at().value, 'Pantry', 'which shows where it is filed now');

      // Re-filing under the category filter takes the row off the page.
      M.S.foodFilter.cat = 'Dairy & eggs';
      M.ctx.renderFood();
      eq(keysOf(items, 'filed:'), [keyFor('filed', 'Milk 2L'), keyFor('filed', 'Yoghurt')], 'the filter shows the two dairy products');
      const yoghurt = keyFor('filed', 'Yoghurt');
      await change(need(items, keyFor('filed', 'Milk 2L')), n => { n.value = 'Drinks'; });
      await written();
      eq(keysOf(items, 'filed:'), [yoghurt], 'the re-filed product has left the filtered list');
      /* On its NAME, not its category select: an arrow key on a closed select
         is a `change` on Windows and Linux, and the next press would re-file
         a product the reader never chose. */
      landed(keyFor('item', 'Yoghurt'), 'and the reader is on the row that moved up into its place');
      ok(focus.at()._cls.has('food-item-name'), 'on the product\'s name, never its category select');
      // ...and the only row left under a filter AND a search: the filter itself.
      // A second product is filed under Drinks first, so the category outlives
      // the re-file: the page drops a filter that names no category.
      M.S.foodFilter.cat = '';
      M.ctx.renderFood();
      await change(need(items, keyFor('filed', 'Cheddar')), n => { n.value = 'Drinks'; });
      await written();
      M.S.foodFilter.cat = 'Drinks';
      M.S.foodFilter.q = 'milk';
      M.ctx.renderFood();
      eq(keysOf(items, 'filed:').length, 1, 'one product matches the filter and the search');
      await change(need(items, keyFor('filed', 'Milk 2L')), n => { n.value = 'Pantry'; });
      await written();
      eq(keysOf(items, 'filed:').length, 0, 'and re-filing it leaves nothing on the page');
      eq(focus.at(), $('#foodCatFilter'), 'so the reader is on the category filter that is hiding it');
      M.S.foodFilter.cat = '';
      M.S.foodFilter.q = '';

      // A receipt that vanished from the vault under the page.
      M.ctx.renderFood();
      eq(keysOf(slips, 'open:'), ['open:0', 'open:1'], 'both receipts are listed');
      const gone = async rel => M.ctx.vault.trash(M.ctx.vault.getFileByPath(`${B}/${rel}`));
      await gone(M.S.receipts.find(r => r.store === 'Grocer One').rel);
      const firstRow = descend(slips).find(e => e.tagName === 'TR' && /Grocer One/.test(e.textContent));
      await press(descend(firstRow).find(e => /^open:/.test(e.getAttribute('data-focus-key') || '')));
      await written();
      eq(keysOf(slips, 'open:'), ['open:0'], 'the vanished receipt is no longer listed');
      landed('open:0', 'and the reader is on the receipt that took its place');
      ok(/Grocer Two/.test(focus.at().parentElement.parentElement.textContent), 'which is the other slip');
      await gone(M.S.receipts[0].rel);
      await press(need(slips, 'open:0'));
      await written();
      eq(focus.at(), $('#foodAdd'), 'opening the only receipt, gone too, lands on Add receipt');
    }

    /* ================= Report ============================================= */
    {
      const M = await mount();
      M.view = 'Report';
      const $ = M.ctx.$;
      M.ctx.renderReport();
      // Period and detail are chart.js range pills, restored there; held here
      // for the page all the same.
      await press(need($('#reportPeriodPills'), 'range:3m'));
      landed('range:3m', 'picking a report period lands on the pill that was pressed');
      await press(need($('#reportDetailPills'), 'range:detail'));
      landed('range:detail', 'and so does picking the level of detail');
      // Format is the page's own group: a multi-select, so not a range pill.
      const formats = $('#reportFormatPills');
      await press(need(formats, 'format:json'));
      landed('format:json', 'turning a format on lands back on that format');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');
      await press(focus.at());
      landed('format:json', 'and so does turning it off again');
      eq(focus.at().getAttribute('aria-pressed'), 'false', 'which is no longer pressed');
      // The last format standing cannot be turned off, so nothing is redrawn.
      const md = need(formats, 'format:md');
      await press(md);
      eq(focus.at(), md, 'pressing the only selected format redraws nothing and leaves focus where it was');
    }

    /* ================= Loans (the negative) =============================== */
    /* Both forms are built once and only the output boxes are redrawn, none of
       which holds a control. So every field keeps focus through its own edit —
       no landing to restore, and this is what says so. */
    {
      const M = await mount();
      M.view = 'Loans';
      const $ = M.ctx.$;
      /* The tabs are wired when the view registers, so they are made real
         buttons in place instead of being swapped for new ones. */
      for (const id of ['#loanTabHome', '#loanTabCar']) $(id).tagName = 'BUTTON';
      M.ctx.renderLoans();
      const stays = async (node, type, set, what) => {
        focus.on(node);
        eq(focus.at(), node, `precondition: ${what} can take focus`);
        set(node); node._fire(type); await settle();
        eq(focus.at(), node, `${what} keeps focus through its own edit`);
      };
      const fields = root => descend(root).filter(e => /^(INPUT|SELECT)$/.test(e.tagName));
      const home = fields($('#loanHomeForm'));
      ok(home.length >= 4, 'the home-loan form is drawn');
      const outBefore = $('#loanHomeOut').children[0];
      for (const f of home) {
        const type = f.tagName === 'SELECT' || f.getAttribute('type') === 'checkbox' ? 'change' : 'input';
        await stays(f, type, n => { if (n.getAttribute('type') === 'checkbox') n.checked = true; else n.value = '12'; },
          `a home-loan ${f.getAttribute('type') || 'select'} field`);
      }
      ok($('#loanHomeOut').children[0] !== outBefore, 'while the result under it WAS redrawn');
      await press($('#loanTabCar'));
      eq(focus.at(), $('#loanTabCar'), 'switching calculator leaves focus on the tab that was pressed');
      const car = fields($('#loanCarForm'));
      ok(car.length >= 5, 'the car-finance form is drawn');
      for (const f of car) {
        const type = f.tagName === 'SELECT' || f.getAttribute('type') === 'checkbox' ? 'change' : 'input';
        await stays(f, type, n => { if (n.getAttribute('type') === 'checkbox') n.checked = true; else n.value = '12'; },
          `a car-finance ${f.getAttribute('type') || 'select'} field`);
      }
    }

    /* ================= Score (the negative) =============================== */
    /* The ring's legend and its centre repaint IN PLACE: a press dims the
       other segments and swaps the figure inside the centre button, and no
       container above either control is emptied. The one button that leaves
       the page ("go to Accounts") goes through switchView, which puts focus
       on the new page's heading itself. */
    {
      const M = await mount();
      M.view = 'Score';
      const $ = M.ctx.$;
      M.ctx.renderScore();
      const hero = $('#scoreHero');
      const rows = byClass(hero, 'score-ring-row');
      const mid = byClass(hero, 'score-ring-mid')[0];
      ok(rows.length >= 2 && mid, 'the ring is drawn with its legend and its centre');
      await press(rows[1]);
      eq(focus.at(), rows[1], 'focusing a part of the score leaves focus on that part\'s row');
      eq(rows[1].getAttribute('aria-pressed'), 'true', 'which now reads pressed');
      await press(mid);
      eq(focus.at(), mid, 'and the centre keeps focus when it clears the part');
      eq(rows[1].getAttribute('aria-pressed'), 'false', 'having cleared it');
    }

    /* ================= Accounts =========================================== */
    {
      const M = await mount(ACCOUNT_FILES());
      M.view = 'Accounts';
      const $ = M.ctx.$;
      const summary = $('#acctSummary'), deck = $('#acctDeck'), owners = $('#acctOwners'),
        filters = $('#acctFilters'), table = $('#acctTable'), insp = $('#acctInspector');
      const v = () => M.S.acctView;
      const saved = async () => { for (let i = 0; i < 4; i++) await settle(); };
      const show = (open, filter = 'all') => { v().open = open; v().filter = filter; M.ctx.renderAccounts(); focus.reset(); };
      const shownName = () => byClass(insp, 'acct-insp-name')[0].textContent;
      M.ctx.renderAccounts();

      // The figure cut by owner: a press filters the list and redraws the page.
      await press(need(summary, 'ownerrow:sam'));
      landed('ownerrow:sam', 'filtering by an owner in the summary lands back on that owner');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');
      await press(focus.at());
      landed('ownerrow:sam', 'and so does taking the filter off');

      // The two chip rows.
      await press(need(owners, 'owner:is:lee'));
      landed('owner:is:lee', 'an owner chip lands back on itself');
      await press(need(owners, 'owner:is:'));
      landed('owner:is:', 'the "nobody\'s" chip is its own key, apart from "everyone"');
      await press(need(owners, 'owner:all'));
      landed('owner:all', 'and "everyone" lands on itself');
      await press(need(filters, 'filter:acct.group.savings'));
      landed('filter:acct.group.savings', 'a kind chip lands back on itself');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');
      await press(need(filters, 'filter:all'));
      landed('filter:all', 'and so does All');

      // A sort header: redrawn with the table, so the second press had nowhere to land.
      await press(need(table, 'sort:name'));
      landed('sort:name', 'sorting lands back on the column sorted by');
      const first = keysOf(table, 'bal:')[0];
      await press(focus.at());
      landed('sort:name', 'and a second press, which flips the direction, lands there too');
      ok(keysOf(table, 'bal:')[0] !== first, 'with the list really reversed');

      // "Show them": a door into the list.
      await press(need(deck, 'deck:show'));
      eq(v().filter, 'flag', 'the list is filtered to the accounts that want a look');
      landed('row:0', 'Show them lands on the first account it showed');
      eq(focus.at().tagName, 'TR', 'which is the row itself');

      // A row's balance.
      show(null);
      answers.fields = { balance: '310', as_at: '2026-10-15' };
      await press(need(table, 'bal:Wallet'));
      await saved();
      landed('bal:Wallet', 'saving a balance from the row lands back on that account\'s balance');
      ok(/310/.test(focus.at().textContent), 'which shows the figure just typed');

      // The inspector, on a quiet account: every action lands on itself.
      show('Wallet');
      eq(shownName(), 'Wallet', 'the inspector shows the chosen account');
      answers.fields = { balance: '320', as_at: '2026-10-15' };
      await press(need(insp, 'insp:editBalance'));
      await saved();
      landed('insp:editBalance', 'editing the balance from the inspector lands back on Edit balance');
      await press(need(insp, 'insp:budget'));
      await saved();
      landed('insp:budget', 'leaving an account out of the budget lands back on that button');
      ok(M.S.accounts.find(a => a.name === 'Wallet').in_budget === false, 'which really flipped');
      answers.fields = { type: 'cash', institution: 'Tin', owner: '', account_number: '', tx_label: '', currency: '', currency_code: '', ignore_warnings: [], budget: 'no' };
      await press(need(insp, 'insp:edit'));
      await saved();
      eq(M.S.accounts.find(a => a.name === 'Wallet').institution, 'Tin', 'the edit was saved');
      landed('insp:edit', 'editing an account lands back on Edit');
      // An action that leaves the page is left alone: no redraw, no landing.
      M.ctx.app.workspace = { getLeaf: () => ({ openFile: async () => {} }) };
      const note = need(insp, 'insp:note');
      await press(note);
      eq(focus.at(), note, 'Open note redraws nothing and is not followed by a landing');

      // The same-day line: its button goes once the figure is re-dated.
      show('Pot');
      answers.fields = { balance: '5160', as_at: '2026-10-15' };
      await press(need(insp, 'insp:sameday'));
      await saved();
      eq(keyed(insp, 'insp:sameday'), null, 'the same-day line is gone once the balance is dated after its rows');
      landed('insp:transactions', 'and the reader is on the action that stood after it');
      eq(shownName(), 'Pot', 'in the same account\'s inspector');

      // A flagged account whose answer takes the pressed button away.
      show('Cheque');
      await press(need(insp, 'insp:ignore'));
      await saved();
      eq(keyed(insp, 'insp:ignore'), null, 'an ignored warning has no Ignore');
      eq(shownName(), 'Cheque', 'the inspector still shows the account');
      landed('insp:editBalance', 'ignoring a warning lands on the action that stood after it');
      show('Joint');
      await press(need(insp, 'insp:answer'));
      await saved();
      eq(keyed(insp, 'insp:answer'), null, 'an accepted figure has no offer left');
      eq(shownName(), 'Joint', 'the inspector still shows the account');
      landed('insp:transactions', 'accepting the implied figure lands on the action that stood after it');

      // THE ONE THAT MATTERS: the inspector moves on to another account.
      // Filtered to "Needs a look" with nothing chosen, it shows the first
      // flagged account; accepting its figure takes it off the list, and the
      // inspector fills with the next — whose primary button has the same key.
      show(null, 'flag');
      const flagged = keysOf(table, 'bal:').map(k => k.slice(4));
      ok(flagged.length >= 2, 'two accounts still want a look');
      const was = shownName();
      await press(need(insp, 'insp:answer'));
      await saved();
      ok(shownName() !== was, 'the inspector now shows a different account');
      ok(keyed(insp, 'insp:answer'), 'which has an answer button of its own');
      ok(!insp.contains(focus.at()), 'and focus is NOT in that other account\'s inspector');
      eq(focus.at().tagName, 'TR', 'it is on a row of the list');
      ok(/^row:/.test(focus.key()), 'the one that took the accepted account\'s place');

      // An account still in the list while the inspector shows another. With
      // every account on show and nothing chosen, the inspector picks the one
      // flagged account left; once that is answered nothing is flagged, and it
      // falls back to the first row of the list — a different account.
      v().sort = 'name'; v().dir = -1;
      show(null);
      eq(shownName(), 'Card', 'the inspector picked the one account that still wants a look');
      answers.fields = { balance: '-4100', as_at: '2026-10-15' };
      await press(need(insp, 'insp:answer'));
      await saved();
      ok(shownName() !== 'Card', 'answered, it is no longer the inspector\'s pick');
      ok(!insp.contains(focus.at()), 'so focus is not in the other account\'s inspector');
      eq(focus.at().tagName, 'TR', 'the reader is on a row of the list');
      ok(/Card/.test(focus.at().textContent), 'the answered account\'s own row, which is still there');

      // Deleting: the account is gone, so the landing is in the list.
      show('Wallet');
      const rows = () => keysOf(table, 'row:');
      const at = descend(table).filter(e => e.tagName === 'TR' && e.getAttribute('data-focus-key')).findIndex(e => /Wallet/.test(e.textContent));
      ok(at >= 0 && at < rows().length - 1, 'Wallet is in the list with a row after it');
      const nextName = descend(table).filter(e => e.tagName === 'TR' && e.getAttribute('data-focus-key'))[at + 1].textContent;
      answers.confirm = false;
      await press(need(insp, 'insp:delete'));
      await saved();
      landed('insp:delete', 'a delete that was cancelled leaves the reader on Delete');
      answers.confirm = true;
      answers.fields = { folder: 'keep' };
      await press(need(insp, 'insp:delete'));
      await saved();
      ok(!M.S.accounts.some(a => a.name === 'Wallet'), 'the account is deleted');
      landed(`row:${at}`, 'deleting an account lands on the row that took its place');
      eq(focus.at().textContent, nextName, 'which is the next account');
      // The last row of the list: the one above.
      {
        const trs = descend(table).filter(e => e.tagName === 'TR' && e.getAttribute('data-focus-key'));
        const last = trs[trs.length - 1];
        const name = byClass(last, 'acct-name-btn')[0].textContent;
        show(name);
        await press(need(insp, 'insp:delete'));
        await saved();
        landed(`row:${trs.length - 2}`, 'deleting the last account in the list lands on the one above');
      }
      // The only account: Add account.
      while (M.S.accounts.length > 1) M.S.accounts.pop();
      show(M.S.accounts[0].name);
      await press(need(insp, 'insp:delete'));
      await saved();
      eq(M.S.accounts.length, 0, 'no account is left');
      eq(focus.at(), $('#acctAdd'), 'deleting the only account lands on Add account');
      answers.fields = null;
    }
  } finally {
    unpin();
  }

  console.log(`PASS refocus-pages — the remaining pages keep the reader on the page after a rebuild (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
