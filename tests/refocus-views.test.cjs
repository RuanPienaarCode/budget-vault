'use strict';
/* A handler that rebuilds the page under its own button leaves the reader ON
   the page.

   The helper is pinned in tests/dom-refocus.test.cjs. This is the other half:
   that every handler in the views this lane owns actually calls it, with a key
   that lands somewhere sensible. Each case below does what a keyboard reader
   does — focus the control, press it — and then asks where focus is, against
   the focus model in tests/helpers/focus-stub.cjs (a control destroyed by a
   rebuild stops being the active element, exactly as in a browser).

   Before this, focus was on <body> after every one of these presses except the
   eight that four views restored by hand (audit of 11 Nov 2026, task 16): the
   status pills on Tax, Debt and Owed, the Owed lent date and repayment, the
   Assets kind and valued date. Those eight are in here too, so the move onto
   the shared helper is pinned as like-for-like.

   Where a press removes the thing pressed, the landing is the next thing a
   reader would act on, never the top of the page:

     a deleted row      -> the row that moved up into its place, else the one
                           above, else the page's Add button
     "Show more"        -> the first row the press revealed
     a bar that closes  -> the first row of the table it was about
     a control replaced -> what took its place in the same cell

   The real views over the shared harness (tests/helpers/figures.cjs mountFor),
   with src/modal.js swapped for an answerable stub. Every figure is synthetic.

     node tests/refocus-views.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();

/* ---- the dialogs, made answerable ----------------------------------------
   Intercepted at Module._load rather than planted in require.cache: the shared
   mount helper below empties the cache of everything under src/ on each mount
   (so every mount gets fresh modules), which would put the real dialogs back
   after the first one. */
const answers = { confirm: true, fields: null, split: null };
const MODAL_STUB = {
  async confirmModal() { return answers.confirm; },
  async askFields() { return answers.fields; },
  async askSplit() { return answers.split; },
  async askRulesCleanup() { return false; },
  SplitModal: class {}, RulesCleanupModal: class {}, BudgetResliceModal: class {},
  async askBudgetReslice() { return null; },
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
/* 130 ordinary rows, so the table windows at its page of 100 and "Show more"
   exists; one split parent with its two parts, dated last so it sorts first. */
const txRows = [];
for (let i = 1; i <= 130; i++) {
  const day = String(1 + (i % 20)).padStart(2, '0');
  txRows.push(`| 2026-10-${day} | Shop ${String(i).padStart(3, '0')} | Groceries | -${i}.00 |  |  |  |`);
}
txRows.push('| 2026-10-28 | Big shop | Groceries | -900.00 | yes | Split into 2 | parent |');
txRows.push('| 2026-10-28 | Big shop | Groceries | -500.00 |  |  | part |');
txRows.push('| 2026-10-28 | Big shop | Bills | -400.00 |  |  | part |');
txRows.push('| 2026-10-27 | To split | Groceries | -300.00 |  |  |  |');

const FILES = () => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Bills.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-10-01\n---\n',
  [`${B}/Transactions/Cheque/2026-10.md`]: TX_HEAD + txRows.join('\n') + '\n',
  /* An account the household keeps out of the budget, with one Groceries row:
     what the in-budget scope holds back, and so what earns the scope note. */
  [`${B}/Accounts/Side.md`]: '---\ntype: checking\ntx_label: "Side"\nbalance: 100.00\nbalance_updated: 2026-10-01\nbudget: false\n---\n',
  [`${B}/Transactions/Side/2026-10.md`]: TX_HEAD + '| 2026-10-09 | Side shop | Groceries | -50.00 |  |  |  |\n',
  /* STREAMCO is charged on the 2nd of three months running and its row has no
     next-billing date, so the page offers one (svcNextHint). */
  [`${B}/Transactions/Cheque/2026-09.md`]: TX_HEAD + '| 2026-09-02 | STREAMCO | Bills | -199.00 |  |  |  |\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: TX_HEAD + '| 2026-08-02 | STREAMCO | Bills | -199.00 |  |  |  |\n',
  [`${B}/Services.md`]: '---\nkind: services\n---\n\n'
    + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n'
    + '| Streaming | STREAMCO | 199.00 | monthly |  | Bills | yes | |\n'
    + '| Domain | Provider B | 250.00 | annual | 2027-01-01 | Bills | yes | |\n'
    + '| Gym | Provider C | 400.00 | monthly | 2026-11-01 | Bills | yes | |\n',
  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n'
    + '| Sam | 250.00 | lunch | 2026-12-01 | outstanding | |\n| Lee | 400.00 | tools | | outstanding | |\n| Kim | 90.00 | cab | | outstanding | |\n',
  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card debt | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | | active | |\n'
    + '| Vehicle | Bank B | vehicle | 150000.00 | 200000.00 | 11.25 | 3500.00 | 0.00 | 2023-01-15 | | active | |\n'
    + '| Store card | Shop | store | 900.00 | 900.00 | 18.00 | 100.00 | 0.00 | 2025-01-15 | | active | |\n',
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n'
    + '| House | property | 1500000.00 | 2026-03-01 | |\n| Car | vehicle | 180000.00 | | |\n| Bike | vehicle | 9000.00 | | |\n',
  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n# Tax Year 2026\n\n## Progress\n\n'
    + '| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-12-01 | |\n| Submit | todo | | |\n| File away | todo | | |\n\n'
    + '## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | needed | | |\n| IT3b | Bank A | needed | | |\n| Medical | Scheme | needed | | |\n\n'
    + '## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Local interest | Bank A | 15000.00 |\n| 3601 | Income | Employer | 400000.00 |\n| 4005 | Medical | Scheme | 12000.00 |\n',
});

/* The shell's own controls, as real ones. The harness auto-creates anything
   asked for by id as a <div> unless the id's suffix says otherwise, and a
   <div> is not something focus can land on — which is the right answer for a
   div and the wrong one for the Add buttons these pages fall back to. */
const SHELL = { '#txAdd': 'button', '#owedAdd': 'button', '#svcAdd': 'button', '#debtAdd': 'button',
  '#assetAdd': 'button', '#noteAdd': 'button', '#taxAddStep': 'button', '#taxAddDoc': 'button',
  '#taxAddFigure': 'button', '#taxYearSel': 'select', '#taxStart': 'button', '#taxDeleteYear': 'button' };

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
  /* The two halves of the Tax page, nested the way the shell nests them, so
     hiding a card hides what is in it. */
  M.ctx.$('#taxEmptyCard').append(M.ctx.$('#taxStart'));
  M.ctx.$('#taxContent').append(M.ctx.$('#taxYearSel'), M.ctx.$('#taxDeleteYear'));
  M.ctx.render = () => { M.ctx.renderTransactions(); };
  M.ctx.switchView = () => {};
  M.ctx.reloadFromDisk = async () => {};
  return M;
}

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
/* What a keyboard reader does: be on the control, then press it. */
const press = async node => { focus.on(node); eq(focus.at(), node, 'precondition: the control can take focus'); node.click(); await settle(); };
const change = async (node, set) => { focus.on(node); set(node); node._fire('change'); await settle(); };
const byClass = (root, cls) => descend(root).filter(e => e._cls.has(cls));
const need = (root, key) => { const n = keyed(root, key); ok(n, `the page renders a control keyed "${key}"`); return n; };
const landed = (key, msg) => eq(focus.key(), key, msg);

(async () => {
  const unpin = pinClock('2026-10-15');
  try {
    /* ================= Transactions ======================================= */
    {
      const M = await mount();
      const t = M.ctx.$('#txTable');
      M.ctx.renderTransactions();

      // "Show more": the first row the press revealed.
      await press(need(t, 'more'));
      landed('row:100', 'Show more lands on the first newly revealed row');
      eq(focus.at().tagName, 'TR', 'which is the row itself, not a control that opens on focus');
      eq(focus.at().getAttribute('tabindex'), '-1', 'made focusable for the landing');
      eq(keyed(t, 'row:0').getAttribute('tabindex'), null, 'and no other row is made click-focusable for it');

      // Delete: the row that moved up.
      const before = keyed(t, 'del:5').getAttribute('aria-label');
      const after = keyed(t, 'del:6').getAttribute('aria-label');
      await press(need(t, 'del:5'));
      landed('del:5', 'deleting a row lands on the delete of the row that took its place');
      ok(focus.at().getAttribute('aria-label') === after && after !== before, 'and that is the NEXT transaction, not the deleted one');

      // Split: back on the parent's own split button.
      const splitRow = descend(t).find(e => e.tagName === 'TR' && /To split/.test(e.textContent));
      ok(splitRow, 'the row to split is on screen');
      const splitKey = byClass(splitRow, 'btn-ghost-sm')[0].getAttribute('data-focus-key');
      ok(/^split:\d+$/.test(splitKey), 'its split button carries a focus key');
      answers.split = [{ amount: -200, cat: 'Groceries', note: '' }, { amount: -100, cat: 'Bills', note: '' }];
      await press(keyed(t, splitKey));
      landed(splitKey, 'splitting a row lands back on its split button');

      // Un-split: the chip is replaced by a checkbox in the same cell.
      const chip = byClass(t, 'caveat-chip-btn').find(b => /^excl:/.test(b.getAttribute('data-focus-key') || ''));
      ok(chip, 'a split parent has its chip');
      const chipKey = chip.getAttribute('data-focus-key');
      await press(chip);
      landed(chipKey, 'un-splitting lands in the same cell');
      eq(focus.at().tagName, 'INPUT', 'on the checkbox that replaced the chip');

      // Delete with nothing left on screen: the Add button.
      M.ctx.$('#txSearch').value = 'Shop 077';
      M.ctx.renderTransactions();
      await press(need(t, 'del:0'));
      eq(focus.at(), M.ctx.$('#txAdd'), 'deleting the only row on screen lands on Add transaction');
      M.ctx.$('#txSearch').value = '';

      // The undo bar: dismiss, then a taken undo.
      const bar = M.ctx.$('#txUndoBar');
      M.S.lastImport = { count: 1, label: 'Cheque', at: '10:00', files: [] };
      M.ctx.renderTransactions();
      await press(byClass(bar, 'tx-undo-x')[0]);
      landed('row:0', 'dismissing the undo bar lands on the first row of the table');
      /* A receipt whose one row is no longer in the app: the undo finds
         nothing to take back, drops the receipt, and the bar goes. */
      M.S.lastImport = { count: 1, label: 'Cheque', at: '10:00', files: [{ key: 'Cheque/2026-10', rows: [{}] }] };
      M.ctx.renderTransactions();
      await press(byClass(bar, 'tx-undo-btn')[0]);
      ok(bar._cls.has('hidden') || !bar.children.length, 'the undo bar is gone');
      landed('row:0', 'and so does an undo that takes the bar away');

      // The scope note's "show them". The category select has to answer for
      // its options the way a real one does, or the page drops the filter the
      // scope rides on (the stub's <option> has no `value` of its own).
      const cat = M.ctx.$('#txCategory');
      Object.defineProperty(cat, 'options', { configurable: true,
        get() { return cat.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); } });
      M.ctx.renderTransactions();
      cat.value = 'Groceries';
      M.ctx.setTxInBudgetOnly('Groceries');
      M.ctx.renderTransactions();
      const note = M.ctx.$('#txScopeNote');
      const show = byClass(note, 'tx-undo-btn')[0];
      ok(show, 'the scope hid the off-budget row and offers it back');
      await press(show);
      ok(!byClass(note, 'tx-undo-btn').length, 'the note is gone once the rows are back');
      landed('row:0', 'giving the hidden rows back lands on the first row');
    }

    /* ================= chart range pills ================================== */
    {
      const { el } = require('../src/dom');
      const { rangePills } = require('../src/chart');
      const host = el('div', {});
      let value = '6m';
      const ranges = [{ key: '3m', label: '3M' }, { key: '6m', label: '6M' }, { key: '1y', label: '1Y' }];
      const draw = () => { host.empty(); host.append(rangePills({ ranges, value, label: 'Range', onPick })); };
      let onPick = k => { value = k; draw(); };
      focus.reset();
      draw();
      await press(need(host, 'range:3m'));
      landed('range:3m', 'picking a range lands on the new copy of the pill that was pressed');
      eq(focus.at().getAttribute('aria-pressed'), 'true', 'which is now the pressed one');

      // A caller that saves a setting before it redraws (the Dashboard, Food).
      onPick = async k => { await new Promise(r => setImmediate(r)); value = k; draw(); };
      draw();
      await press(need(host, 'range:1y'));
      landed('range:1y', 'and waits for a caller that redraws after an await');
    }

    /* ================= Import review ====================================== */
    {
      const M = await mount();
      const lines = ['Date,Description,Amount'];
      for (let i = 1; i <= 230; i++) lines.push(`2026-10-${String(1 + (i % 27)).padStart(2, '0')},Imported ${i},-${i}.00`);
      const bytes = new TextEncoder().encode(lines.join('\n') + '\n').buffer;
      await M.ctx.handleStatementFile({ name: 'statement.csv', arrayBuffer: async () => bytes });
      ok(M.S.pendingImport, 'the statement reached the review');
      M.S.pendingImport.label = 'Cheque';
      M.ctx.renderImportReview();
      const t = M.ctx.$('#impTable');
      await press(need(t, 'more'));
      landed('row:200', 'Show more on the import review lands on the first newly revealed row');
    }

    /* ================= Services =========================================== */
    {
      const M = await mount();
      const t = M.ctx.$('#svcTable');
      M.ctx.renderServices();
      const hint = byClass(t, 'svc-next-hint')[0];
      ok(hint, 'the fixture earns a next-billing hint');
      const hintKey = hint.getAttribute('data-focus-key');
      ok(/^hint:\d+$/.test(hintKey || ''), 'the hint carries a focus key');
      await press(hint);
      landed(hintKey.replace('hint', 'row'), 'taking the offered date lands on that service\'s row (the hint is gone)');

      await change(need(t, 'active:1'), n => { n.checked = false; });
      landed('active:1', 'unticking Active lands back on the same tick');

      const after = keyed(t, 'del:1').getAttribute('aria-label');
      await press(need(t, 'del:0'));
      landed('del:0', 'removing a service lands on the one that moved up');
      eq(focus.at().getAttribute('aria-label'), after, 'which is the next service');
      await press(need(t, 'del:1'));
      landed('del:0', 'removing the last row lands on the one above');
      await press(need(t, 'del:0'));
      eq(focus.at(), M.ctx.$('#svcAdd'), 'removing the only service lands on New service');
    }

    /* ================= Owed =============================================== */
    {
      const M = await mount();
      const t = M.ctx.$('#owedTable');
      M.ctx.renderOwed();
      await press(need(t, 'pill:1'));
      landed('pill:1', 'cycling a status lands back on that row\'s pill');
      const lent = descend(t).filter(e => e.tagName === 'INPUT' && /^Date lent to/.test(e.getAttribute('aria-label') || ''))[2];
      await change(lent, n => { n.value = '2026-09-01'; });
      landed('pill:2', 'editing a lent date lands on that row\'s pill, as it did');
      answers.fields = { amount: '10' };
      const repay = descend(t).filter(e => /^Record a repayment from/.test(e.getAttribute('aria-label') || ''))[0];
      await press(repay);
      landed('pill:0', 'recording a repayment lands on that row\'s pill, as it did');
      await press(need(t, 'del:2'));
      landed('del:1', 'removing the last entry lands on the one above');
      await press(need(t, 'del:0'));
      landed('del:0', 'removing an entry lands on the one that moved up');
      await press(need(t, 'del:0'));
      eq(focus.at(), M.ctx.$('#owedAdd'), 'removing the only entry lands on New entry');
    }

    /* ================= Debts ============================================== */
    {
      const M = await mount();
      const t = M.ctx.$('#debtTable');
      M.ctx.renderDebts();
      await press(need(t, 'pill:1'));
      landed('pill:1', 'settling a debt lands back on that row\'s pill');
      await press(need(t, 'del:0'));
      landed('del:0', 'removing a debt lands on the one that moved up');
      await press(need(t, 'del:1'));
      landed('del:0', 'removing the last debt lands on the one above');
      await press(need(t, 'del:0'));
      eq(focus.at(), M.ctx.$('#debtAdd'), 'removing the only debt lands on New debt');
    }

    /* ================= Assets ============================================= */
    {
      const M = await mount();
      const t = M.ctx.$('#assetTable');
      M.ctx.renderAssets();
      await change(need(t, 'kind:1'), n => { n.value = 'property'; });
      landed('kind:1', 'changing a kind lands back on that select');
      const valued = descend(t).filter(e => e.tagName === 'INPUT' && /was valued$/.test(e.getAttribute('aria-label') || ''))[2];
      await change(valued, n => { n.value = '2026-10-01'; });
      landed('kind:2', 'editing a valued date lands on that row\'s kind select, as it did');
      await change(need(t, 'value:0'), n => { n.value = 'abc'; });
      landed('value:0', 'a refused value lands back in the field that was refused');
      await press(need(t, 'del:0'));
      landed('del:0', 'removing an asset lands on the one that moved up');
      await press(need(t, 'del:1'));
      landed('del:0', 'removing the last asset lands on the one above');
      await press(need(t, 'del:0'));
      eq(focus.at(), M.ctx.$('#assetAdd'), 'removing the only asset lands on New asset');
    }

    /* ================= Tax ================================================ */
    {
      const M = await mount();
      M.S.taxYear = '2026';
      M.ctx.renderTax();
      const season = M.ctx.$('#taxSeasonBody');
      await change(need(season, 'taxpayer'), n => { n.value = 'salaried'; });
      landed('taxpayer', 'changing the taxpayer type lands back on that select');
      await change(need(season, 'assessment'), n => { n.value = 'assessed'; });
      landed('assessment', 'changing the assessment status lands back on that select');

      const steps = M.ctx.$('#taxStepsTable');
      await press(need(steps, 'pill:1'));
      landed('pill:1', 'cycling a step lands back on its pill');
      await press(need(steps, 'del:0'));
      landed('del:0', 'removing a step lands on the one that moved up');
      await press(need(steps, 'del:1'));
      landed('del:0', 'removing the last step lands on the one above');
      await press(need(steps, 'del:0'));
      eq(focus.at(), M.ctx.$('#taxAddStep'), 'removing the only step lands on Add step');

      const figs = M.ctx.$('#taxFiguresTable');
      await press(need(figs, 'del:0'));
      landed('del:0', 'removing a figure lands on the one that moved up');
      await press(need(figs, 'del:1'));
      landed('del:0', 'removing the last figure lands on the one above');
      await press(need(figs, 'del:0'));
      eq(focus.at(), M.ctx.$('#taxAddFigure'), 'removing the only figure lands on Add figure');

      const docs = M.ctx.$('#taxDocsTable');
      await press(need(docs, 'pill:2'));
      landed('pill:2', 'cycling a document status lands back on its pill');
      // Upload: the file picker returns, the table is redrawn, and the reader
      // is back on the button they pressed.
      focus.on(need(docs, 'upload:1'));
      keyed(docs, 'upload:1').click();
      const bytes = new TextEncoder().encode('%PDF-1.4 synthetic certificate').buffer;
      await M.ctx.handleTaxFile({ name: 'it3b.pdf', arrayBuffer: async () => bytes });
      await settle();
      landed('upload:1', 'an upload lands back on that row\'s upload button');
      await press(need(docs, 'del:0'));
      landed('del:0', 'removing a document lands on the one that moved up');
      await press(need(docs, 'del:1'));   // the row holding the uploaded file: confirmed, then removed
      landed('del:0', 'removing the last document lands on the one above');
      await press(need(docs, 'del:0'));
      eq(focus.at(), M.ctx.$('#taxAddDoc'), 'removing the only document lands on Add document');

      // A year folder with files and no page: its offer disappears once taken.
      M.S.taxOrphanYears = ['2025'];
      M.ctx.renderTax();
      const offer = descend(M.ctx.$('#taxSubNote')).find(e => e.tagName === 'BUTTON');
      ok(offer, 'the orphan year is offered');
      await press(offer);
      eq(focus.at(), M.ctx.$('#taxYearSel'), 'taking the offer lands on the year picker, now showing that year');

      // Deleting a year that is not the last: the button is still there.
      const del = M.ctx.$('#taxDeleteYear');
      focus.on(del);
      await M.ctx.deleteTaxYear();
      await settle();
      eq(focus.at(), del, 'deleting one of two years leaves focus on Delete year, which is still on the page');
      // Deleting the last one swaps the page for its empty state.
      await M.ctx.deleteTaxYear();
      await settle();
      eq(Object.keys(M.S.tax).length, 0, 'no tax year is left');
      eq(focus.at(), M.ctx.$('#taxStart'), 'deleting the last year lands on Start, the way back in');
      // ...and Start swaps it back.
      await M.ctx.startTax();
      await settle();
      eq(focus.at(), M.ctx.$('#taxYearSel'), 'starting a year lands on the year picker of the page that replaced the empty state');
    }

    /* ================= Notes ============================================== */
    {
      const M = await mount();
      const list = M.ctx.$('#notesList');
      for (const title of ['First', 'Second', 'Third']) {
        answers.fields = { title, about: 'general\u001F', body: 'x' };
        await M.ctx.addNote();
      }
      answers.fields = null;
      M.ctx.renderNotes();
      const cards = byClass(list, 'note-card');
      eq(cards.length, 3, 'three notes are listed');

      // Re-pointing: back on the same note's Change subject.
      const subj = descend(list).find(e => /^note-subject:/.test(e.getAttribute('data-focus-key') || ''));
      ok(subj, 'a note\'s Change subject button carries a focus key');
      const subjKey = subj.getAttribute('data-focus-key');
      const about = M.ctx.$('#noteAbout').options.map(o => o.attrs.value).find(v => /^account/.test(v));
      ok(about, 'there is an account to point the note at');
      answers.fields = { about };
      await press(subj);
      landed(subjKey, 're-pointing a note lands back on its Change subject button');
      ok(focus.at() !== subj, 'on the rebuilt card, not the old one');
      answers.fields = null;

      // A note that vanished from the vault under the page: opening it redraws
      // the list without it.
      const gone = M.S.notes[0];
      await M.ctx.vault.trash(M.ctx.vault.getFileByPath(`${B}/${gone.rel}`));
      await press(need(list, 'note-title:0'));
      eq(byClass(list, 'note-card').length, 2, 'the vanished note is no longer listed');
      landed('note-title:0', 'and the reader is on the note that moved up');
      answers.fields = { title: 'Fourth', about: 'general\u001F', body: 'x' };
      await M.ctx.addNote();
      answers.fields = null;

      await press(need(list, 'note-del:0'));
      landed('note-del:0', 'deleting a note lands on the one that moved up');
      await press(need(list, 'note-del:1'));
      landed('note-del:0', 'deleting the last note lands on the one above');
      await press(need(list, 'note-del:0'));
      eq(focus.at(), M.ctx.$('#noteAdd'), 'deleting the only note lands on New note');
    }
  } finally {
    unpin();
  }

  console.log(`PASS refocus-views — every in-page rebuild leaves focus on the page, at the next thing to act on (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
