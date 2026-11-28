'use strict';
/* Subcategories on the pages a household types entries into (ADR-0010, issue
   #184, slice 1): the Transactions table and filter, the Add dialog, the
   category's own Subcategories dialog on the Budget page, and the rule that
   nothing appears until the open book uses one.

   The REAL views, wired the way controller.js wires them (src/wiring.js), over
   the real loader and an in-memory vault, read through the DOM stub. Only the
   dialogs are scripted — askFields, confirmModal and askSubcategories open
   Obsidian modals, so each is replaced at the module loader, and what the view
   asked the dialog for is recorded and asserted. The dialogs themselves are
   driven for real in tests/subcategory-dialogs.test.cjs.

   Every expectation is a literal: a name on screen, a line in a file.

     node tests/subcategory-views.test.cjs */

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the dialogs, scripted ---------------------------------------------- */
const script = { askFields: [], confirm: [], askSubcategories: [] };
const asked = { askFields: [], askSubcategories: [] };
const fakeModal = {
  askFields: async (app, title, fields, opts) => {
    asked.askFields.push({ title, fields, opts });
    if (!script.askFields.length) throw new Error(`unscripted askFields: ${title}`);
    return script.askFields.shift();
  },
  confirmModal: async () => {
    if (!script.confirm.length) throw new Error('unscripted confirmModal');
    return script.confirm.shift();
  },
  askSubcategories: async (app, opts) => { asked.askSubcategories.push(opts); return undefined; },
  askSplit: async () => null,
  askRulesCleanup: async () => null,
  askBudgetReslice: async () => null,
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '../modal' || req === './modal') return fakeModal;
  return origLoad.call(this, req, ...rest);
};
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, hasClass, textOf } = require('./helpers/dash-audit.cjs');
const { NO_SUBCATEGORY } = require('../src/subcategories');

const B = 'Budget';
const TODAY = '2026-09-15';
const PERIOD = '2026-09';
const settle = () => new Promise(r => setTimeout(r, 25));

const HEAD = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n|---|---|---|---:|---|---|---|\n';
const TX_USING = HEAD
  + '| 2026-09-01 | Engen | Car | -500.00 |  |  | Fuel |\n'
  + '| 2026-09-02 | Servicing | Car | -900.00 |  |  |  |\n'
  + '| 2026-09-03 | Gauteng e-tag | Car | -65.00 |  |  | Tolls |\n'      // in use, not on the list
  + '| 2026-09-04 | Checkers | Groceries | -250.00 |  |  | Fresh |\n'     // a category with no list at all
  + '| 2026-09-05 | Rates | Home | -700.00 |  |  |  |\n'
  + '| 2026-09-06 | Cash | Car | -50.00 |  |  |  |\n';
const TX_PLAIN = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n'
  + '| 2026-09-01 | Engen | Car | -500.00 |  |  |\n'
  + '| 2026-09-04 | Checkers | Groceries | -250.00 |  |  |\n';

const baseFiles = tx => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-08-31\n---\n',
  [`${B}/Categories/Home.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Budgets/${PERIOD}.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Car | expense | 2000.00 |  |\n| Groceries | expense | 3000.00 |  |\n| Home | expense | 1000.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: tx,
});
const USING = () => ({
  ...baseFiles(TX_USING),
  [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\nsubcategories: "Services, Fuel"\n---\n\n# Car\n',
});
const PLAIN = () => ({
  ...baseFiles(TX_PLAIN),
  [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\n---\n\n# Car\n',
});

/* The stub's <select> has no `options` that read an <option>'s value attribute,
   which syncOptions needs to keep a chosen filter across a re-render — the
   shape tests/lane-int-drill-vetoes.test.cjs gives the category filter. */
function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}
async function open(files) {
  const unpin = pinClock(TODAY);
  const M = await mountFor(files, { period: PERIOD });
  M.unpin = unpin;
  M.ctx.$('#txWholeHistory').checked = false;
  realSelect(M.ctx.$('#txCategory'));
  realSelect(M.ctx.$('#txSubcategory'));
  return M;
}
const store = M => M.ctx.vault._store;
const tbody = M => find(M.ctx.$('#txTable'), n => n.tagName === 'TBODY')[0];
const trs = M => (tbody(M) ? tbody(M).children.filter(n => n.tagName === 'TR') : []);
const descOf = tr => textOf(tr.children[1]);
const rowFor = (M, desc) => trs(M).find(tr => descOf(tr) === desc);
const catTd = tr => tr.children[3];
const subCell = tr => find(catTd(tr), n => hasClass(n, 'sub-cell'))[0] || null;
const subBtn = tr => { const c = subCell(tr); return c ? find(c, n => n.tagName === 'BUTTON')[0] : null; };
const subSelect = tr => { const c = subCell(tr); return c ? find(c, n => n.tagName === 'SELECT')[0] : null; };
const optionsOf = sel => sel.children.filter(n => n.tagName === 'OPTION').map(o => [o.attrs.value ?? o.value, textOf(o)]);
const fileRow = (M, desc) => M.S.txFiles['Cheque/2026-09'].rows.find(r => r.desc === desc);

(async () => {
  /* ---- Transactions: the dropdown inside the category cell ------------- */
  {
    const M = await open(USING());
    M.ctx.renderTransactions();
    ok(trs(M).length === 6, 'all six rows are listed');

    eq(Object.fromEntries(trs(M).map(tr => [descOf(tr), !!subCell(tr)])),
      { Engen: true, Servicing: true, 'Gauteng e-tag': true, Checkers: true, Rates: false, Cash: true },
      'a sub-dropdown on every row whose category has subcategories (listed or in use); none on Home, which has none');
    ok(hasClass(subCell(rowFor(M, 'Engen')), 'sub-cell'), 'it sits inside the category cell itself');
    eq(M.ctx.$('#txTable').querySelectorAll('th').length, 8, 'and adds no column to the table: the same eight it always had');

    eq(textOf(subBtn(rowFor(M, 'Engen'))), 'Fuel', 'a row shows the subcategory it carries');
    eq(textOf(subBtn(rowFor(M, 'Servicing'))), '— none —', 'a row with none says so');

    /* The offered names: the listed ones in the order written, then the ones
       rows carry that the list does not, then the way to make a new one. */
    subBtn(rowFor(M, 'Servicing')).click();
    eq(optionsOf(subSelect(rowFor(M, 'Servicing'))),
      [['', '— none —'], ['Services', 'Services'], ['Fuel', 'Fuel'], ['Tolls', 'Tolls'], ['__new__', '＋ New subcategory…']],
      'Car offers its listed names in written order, then Tolls (in use, unlisted), ending in "＋ New subcategory…"');
    subBtn(rowFor(M, 'Checkers')).click();
    eq(optionsOf(subSelect(rowFor(M, 'Checkers'))).map(o => o[0]), ['', 'Fresh', '__new__'],
      'a category whose note lists nothing still offers what its rows use');

    /* Choosing one marks the file dirty and changes the row, and what is saved. */
    M.ctx.$('#txSave').disabled = true;
    ok(!M.S.txFiles['Cheque/2026-09'].dirty, 'nothing unsaved yet');
    const sel = subSelect(rowFor(M, 'Servicing'));
    sel.value = 'Services';
    sel._fire('change');
    eq(fileRow(M, 'Servicing').subcategory, 'Services', 'the row now carries the subcategory');
    eq(M.ctx.$('#txSave').disabled, false, 'and Save is lit');
    ok(M.S.txFiles['Cheque/2026-09'].dirty, 'the month is marked unsaved');
    ok(M.ctx.serializeTxFile(M.S.txFiles['Cheque/2026-09']).includes('| 2026-09-02 | Servicing | Car | -900.00 |  |  | Services |\n'),
      'and saving writes it into the Subcategory column');
    sel.value = '';
    sel._fire('change');
    ok(!('subcategory' in fileRow(M, 'Servicing')), 'choosing none takes it off again, leaving no empty field behind');
    M.unpin();
  }

  /* ---- "＋ New subcategory…" saves to the category note straight away --- */
  {
    const M = await open(USING());
    M.ctx.renderTransactions();
    const before = store(M).get(`${B}/Transactions/Cheque/2026-09.md`);
    subBtn(rowFor(M, 'Servicing')).click();
    const sel = subSelect(rowFor(M, 'Servicing'));
    script.askFields.push({ name: '  Parking ' });
    sel.value = '__new__';
    sel._fire('change');
    await settle();
    const dlg = asked.askFields.at(-1);
    eq(dlg.fields.map(f => f.key), ['name'], 'it asks for a name and nothing else');
    ok(typeof dlg.opts.validate === 'function', 'and refuses a bad one inside the dialog');
    eq(dlg.opts.validate({ name: ' ' }).field, 'name', 'blank is refused, naming the field');
    eq(dlg.opts.validate({ name: 'Fuel' }).field, 'name', 'a name already listed is refused');
    eq(dlg.opts.validate({ name: 'a, b' }).field, 'name', 'a comma is refused');
    eq(dlg.opts.validate({ name: 'Parking' }), null, 'a fresh name passes');
    ok(/subcategories: "Services, Fuel, Parking"\n/.test(store(M).get(`${B}/Categories/Car.md`)),
      'the category note was written straight away, the new name last');
    ok(store(M).get(`${B}/Categories/Car.md`).includes('# Car\n'), 'and the note\'s body was left alone');
    eq(M.S.categories.find(c => c.name === 'Car').subcategories, ['Services', 'Fuel', 'Parking'], 'the open book knows it without a reload');
    eq(fileRow(M, 'Servicing').subcategory, 'Parking', 'and the row it was made on carries it');
    eq(store(M).get(`${B}/Transactions/Cheque/2026-09.md`), before, 'the month file itself is not written until Save');

    /* Cancelling the dialog changes nothing and puts the dropdown back. */
    subBtn(rowFor(M, 'Rates')); // Home has none: no control to cancel from
    const sel2 = subSelect(rowFor(M, 'Engen')) || (subBtn(rowFor(M, 'Engen')).click(), subSelect(rowFor(M, 'Engen')));
    const noteBefore = store(M).get(`${B}/Categories/Car.md`);
    script.askFields.push(null);
    sel2.value = '__new__';
    sel2._fire('change');
    await settle();
    eq(sel2.value, 'Fuel', 'cancelling puts the dropdown back on what the row carries');
    eq(store(M).get(`${B}/Categories/Car.md`), noteBefore, 'and writes nothing');
    eq(fileRow(M, 'Engen').subcategory, 'Fuel', 'and the row is as it was');
    M.unpin();
  }

  /* ---- a failed note write is said, and nothing changes ---------------- */
  {
    const M = await open(USING());
    M.ctx.renderTransactions();
    subBtn(rowFor(M, 'Servicing')).click();
    const sel = subSelect(rowFor(M, 'Servicing'));
    const realWrite = M.ctx.vault.modify;
    M.ctx.vault.modify = async () => { throw new Error('disk full'); };
    script.askFields.push({ name: 'Parking' });
    sel.value = '__new__';
    sel._fire('change');
    await settle();
    M.ctx.vault.modify = realWrite;
    ok(M.ctx._toasts.some(t => t.bad && /disk full/.test(t.msg)), 'the failure is said');
    ok(!('subcategory' in fileRow(M, 'Servicing')), 'the row did not take a name that was never saved');
    eq(M.S.categories.find(c => c.name === 'Car').subcategories, ['Services', 'Fuel'], 'nor did the open book');
    M.unpin();
  }

  /* ---- out of sight until used ------------------------------------------ */
  {
    const M = await open(PLAIN());
    M.ctx.renderTransactions();
    eq(trs(M).length, 2, 'the rows are listed');
    ok(trs(M).every(tr => !subCell(tr)), 'no sub-dropdown on any row of a book with no subcategory');
    ok(hasClass(M.ctx.$('#txSubcategory'), 'hidden'), 'the filter is hidden');
    eq(optionsOf(M.ctx.$('#txSubcategory')), [], 'and offers nothing');
    script.askFields.push(null);
    await M.ctx.addTransaction();
    eq(asked.askFields.at(-1).fields.map(f => f.key), ['date', 'desc', 'label', 'dir', 'amount', 'cat', 'note'],
      'Add transaction has no subcategory field');
    /* The page's own figures and shape are as they were: the cell holds only
       the category control. */
    eq(find(catTd(trs(M)[0]), n => n.tagName === 'SPAN' && hasClass(n, 'cat-cell')).length, 1, 'the category cell holds the category control alone');
    M.unpin();
  }

  /* ---- the Add transaction dialog --------------------------------------- */
  {
    const M = await open(USING());
    M.ctx.renderTransactions();
    script.askFields.push(null);
    await M.ctx.addTransaction();
    const fields = asked.askFields.at(-1).fields;
    eq(fields.map(f => f.key), ['date', 'desc', 'label', 'dir', 'amount', 'cat', 'subcategory', 'note'], 'a subcategory field sits directly under Category');
    const f = fields.find(x => x.key === 'subcategory');
    eq(f.type, 'select', 'a dropdown');
    eq(f.follows, 'cat', 'that follows the category field');
    eq(f.label, 'Subcategory', 'labelled');
    eq(f.optionsFor(''), [{ value: '', label: '— none —' }], 'with no category chosen it offers only "none" — which the dialog shows disabled');
    eq(f.optionsFor('Home'), [{ value: '', label: '— none —' }], 'a category with no subcategories offers only "none" too');
    eq(f.optionsFor('Car'), [{ value: '', label: '— none —' }, { value: 'Services', label: 'Services' },
      { value: 'Fuel', label: 'Fuel' }, { value: 'Tolls', label: 'Tolls' }], 'a category that has them offers them, listed first');
    eq(f.value, '', 'and starts empty');

    /* What it saves. */
    script.askFields.push({ date: '2026-09-10', desc: 'Engen N3', label: 'Cheque', dir: 'out', amount: '320', cat: 'Car', subcategory: 'Fuel', note: '' });
    await M.ctx.addTransaction();
    let file = store(M).get(`${B}/Transactions/Cheque/2026-09.md`);
    ok(file.includes('| 2026-09-10 | Engen N3 | Car | -320.00 |  |  | Fuel |\n'), 'the new row is written with its subcategory');
    ok(file.includes('| 2026-09-01 | Engen | Car | -500.00 |  |  | Fuel |\n'), 'and the file\'s other rows are as they were');
    script.askFields.push({ date: '2026-09-11', desc: 'No category', label: 'Cheque', dir: 'out', amount: '10', cat: '', subcategory: 'Fuel', note: '' });
    await M.ctx.addTransaction();
    file = store(M).get(`${B}/Transactions/Cheque/2026-09.md`);
    ok(file.includes('| 2026-09-11 | No category |  | -10.00 |  |  |  |\n'), 'a subcategory with no category is never written: a row with none cannot have one');
    M.unpin();
  }

  /* ---- the filter and the search ---------------------------------------- */
  {
    const M = await open(USING());
    M.ctx.renderTransactions();
    const sf = M.ctx.$('#txSubcategory');
    ok(!hasClass(sf, 'hidden'), 'the filter shows once the book uses subcategories');
    eq(optionsOf(sf), [['', 'All subcategories'], [NO_SUBCATEGORY, 'No subcategory'], ['Fresh', 'Fresh'], ['Fuel', 'Fuel'],
      ['Services', 'Services'], ['Tolls', 'Tolls']],
    'it offers all, "No subcategory", then every name in the book');

    sf.value = 'Fuel'; M.ctx.renderTransactions();
    eq(trs(M).map(descOf), ['Engen'], 'a name keeps the rows that carry it');
    sf.value = NO_SUBCATEGORY; M.ctx.renderTransactions();
    eq(trs(M).map(descOf).sort(), ['Cash', 'Rates', 'Servicing'], '"No subcategory" keeps the rows with none');
    sf.value = ''; M.ctx.renderTransactions();
    eq(trs(M).length, 6, 'all keeps every row');

    /* With a category chosen the filter offers that category's names. */
    M.ctx.$('#txCategory').value = 'Car';
    M.ctx.renderTransactions();
    eq(optionsOf(sf).map(o => o[0]), ['', NO_SUBCATEGORY, 'Services', 'Fuel', 'Tolls'], 'under a category filter it offers that category\'s names, in its order');
    M.ctx.$('#txCategory').value = '';
    sf.value = 'Tolls'; M.ctx.renderTransactions();
    const f = M.ctx.filteredRows();
    eq(f.filters, ['subcategory: Tolls'], 'the filter is named in the export\'s filter list');
    eq(f.labels, ['subcategory: Tolls'], 'and in the confirmation a bulk action shows');
    eq(f.names, ['subcategory Tolls'], 'and in an export\'s file name');
    sf.value = NO_SUBCATEGORY;
    eq(M.ctx.filteredRows().filters, ['subcategory: none'], '"No subcategory" is named too');
    sf.value = '';

    /* Search matches subcategory names. */
    M.ctx.$('#txSearch').value = 'tolls'; M.ctx.renderTransactions();
    eq(trs(M).map(descOf), ['Gauteng e-tag'], 'search finds a row by its subcategory, not only its description');
    M.ctx.$('#txSearch').value = 'FUEL'; M.ctx.renderTransactions();
    eq(trs(M).map(descOf), ['Engen'], 'case-insensitively — and not a row whose hand-edited cell has no category to belong to');
    M.ctx.$('#txSearch').value = '';
    M.unpin();
  }
  {
    /* A hand-edited subcategory on an uncategorised row is not searchable. */
    const files = USING();
    files[`${B}/Transactions/Cheque/2026-09.md`] = TX_USING + '| 2026-09-07 | Mystery |  | -5.00 |  |  | Fuel |\n';
    const M = await open(files);
    M.ctx.$('#txSearch').value = 'fuel'; M.ctx.renderTransactions();
    eq(trs(M).map(descOf), ['Engen'], 'a row with no category cannot be found by a subcategory it cannot have');
    M.unpin();
  }

  /* ---- changing a row's category clears its subcategory ---------------- */
  {
    const M = await open(USING());
    M.ctx.renderTransactions();
    const tr = rowFor(M, 'Engen');
    const btn = find(catTd(tr), n => hasClass(n, 'cat-cell-btn') && !hasClass(n, 'sub-cell-btn'))[0];
    btn.click();
    const catSel = find(catTd(tr), n => n.tagName === 'SELECT' && hasClass(n, 'category-select') && !hasClass(n, 'sub-select'))[0];
    catSel.value = 'Home';
    catSel._fire('change');
    ok(!('subcategory' in fileRow(M, 'Engen')), 'changing the category singly clears the subcategory');
    eq(fileRow(M, 'Engen').cat, 'Home', 'and sets the category');
    ok(!subCell(tr), 'and the row\'s sub-dropdown is gone, Home having none');
    ok(!M.ctx.serializeTxFile(M.S.txFiles['Cheque/2026-09']).includes('| Fuel |'), 'so Save writes no stale label');

    /* Back to a category with subcategories: a fresh dropdown, on none. */
    catSel.value = 'Car';
    catSel._fire('change');
    ok(subCell(tr), 'a category that has subcategories brings the dropdown back');
    eq(textOf(subBtn(tr)), '— none —', 'on none — the old label did not come back');
    M.unpin();
  }
  {
    /* In bulk. */
    const M = await open(USING());
    M.ctx.renderTransactions();
    M.ctx.$('#txCategory').value = 'Car';
    script.askFields.push({ cat: 'Home' });
    script.confirm.push(true);
    await M.ctx.categoriseFilteredTransactions();
    const rows = M.S.txFiles['Cheque/2026-09'].rows;
    eq(rows.filter(r => r.cat === 'Home').length, 5, 'the four Car rows moved to Home, joining the one already there');
    ok(rows.every(r => !('subcategory' in r) || r.cat !== 'Home'), 'and none of them kept a Car subcategory');
    eq(rows.find(r => r.desc === 'Checkers').subcategory, 'Fresh', 'a row the bulk action did not touch keeps its own');

    /* Setting the category a row already has is not a change. */
    const N = await open(USING());
    N.ctx.renderTransactions();
    N.ctx.$('#txCategory').value = 'Car';
    script.askFields.push({ cat: 'Car' });
    script.confirm.push(true);
    await N.ctx.categoriseFilteredTransactions();
    eq(N.S.txFiles['Cheque/2026-09'].rows.find(r => r.desc === 'Engen').subcategory, 'Fuel',
      'a bulk action that sets the category a row already has leaves its subcategory alone');
    M.unpin(); N.unpin();
  }

  /* ---- each part of a split has its own --------------------------------- */
  {
    const files = USING();
    files[`${B}/Categories/Groceries.md`] = '---\ntype: expense\ncolor: "#888888"\nsubcategories: Fresh, Pantry\n---\n';
    files[`${B}/Transactions/Cheque/2026-09.md`] = HEAD.replace('| Note | Subcategory |', '| Note | Split | Subcategory |').replace('|---|---|---|---:|---|---|---|', '|---|---|---|---:|---|---|---|---|')
      + '| 2026-09-01 | Engen | Car | -500.00 | yes |  | parent | Fuel |\n'
      + '| 2026-09-01 | Engen | Car | -300.00 |  |  | part | Fuel |\n'
      + '| 2026-09-01 | Engen | Groceries | -200.00 |  |  | part |  |\n';
    const M = await open(files);
    M.ctx.renderTransactions();
    const parts = trs(M).filter(tr => descOf(tr) === 'Engen');
    eq(parts.length, 3, 'the parent and both parts are listed');
    ok(parts.every(tr => subCell(tr)), 'every row of a split whose category has subcategories carries its own dropdown');
    const part = M.S.txFiles['Cheque/2026-09'].rows[2];
    const tr = trs(M).find(x => x._parent === tbody(M) && descOf(x) === 'Engen' && textOf(x.children[4]).includes('200'));
    ok(tr, 'found the Groceries part');
    subBtn(tr).click();
    subSelect(tr).value = 'Fresh';
    subSelect(tr)._fire('change');
    eq(part.subcategory, 'Fresh', 'a part is given its own subcategory in the table');
    eq(M.S.txFiles['Cheque/2026-09'].rows[1].subcategory, 'Fuel', 'without touching the part beside it');
    ok(M.ctx.serializeTxFile(M.S.txFiles['Cheque/2026-09']).includes('| 2026-09-01 | Engen | Groceries | -200.00 |  |  | part | Fresh |\n'),
      'and it is saved in that part\'s row');
    M.unpin();
  }

  /* ---- the Budget page: a Subcategories dialog per category ------------- */
  for (const [label, files] of [['a book that uses subcategories', USING()], ['a book with none', PLAIN()]]) {
    const M = await open(files);
    M.ctx.renderBudgets();
    const table = M.ctx.$('#budTable');
    const rowsB = find(table, n => n.tagName === 'TR' && find(n, b => hasClass(b, 'bud-act-delete')).length);
    ok(rowsB.length >= 3, `${label}: the Budget page lists its categories`);
    for (const tr of rowsB) {
      const del = find(tr, n => hasClass(n, 'bud-act-delete'))[0];
      const sub = find(tr, n => hasClass(n, 'bud-act-subcats'))[0];
      ok(sub, `${label}: every category has a Subcategories button`);
      const sibs = del._parent.children;
      eq(sibs[sibs.indexOf(del) - 1], sub, `${label}: and it sits beside Delete, directly before it`);
      eq(sub.getAttribute('aria-label').startsWith('Subcategories of '), true, `${label}: named for its category`);
    }
    M.unpin();
  }
  {
    const M = await open(USING());
    M.ctx.renderBudgets();
    const rowOf = name => find(M.ctx.$('#budTable'), n => n.tagName === 'TR'
      && find(n, b => hasClass(b, 'bud-act-subcats') && (b.getAttribute('aria-label') || '').endsWith(name)).length)[0];
    find(rowOf('Car'), n => hasClass(n, 'bud-act-subcats'))[0].click();
    await settle();
    const dlg = asked.askSubcategories.at(-1);
    eq(dlg.category, 'Car', 'the dialog is opened for the category the button belongs to');
    eq(dlg.names, ['Services', 'Fuel'], 'with its listed names in order');
    eq(dlg.inUse, ['Fuel', 'Tolls'], 'and every name its transactions carry, listed or not');

    const txBefore = store(M).get(`${B}/Transactions/Cheque/2026-09.md`);
    const rowsBefore = JSON.stringify(M.S.txFiles['Cheque/2026-09'].rows);
    eq(await dlg.save(['Services', 'Fuel', 'Parking']), true, 'adding a name saves');
    ok(/subcategories: "Services, Fuel, Parking"\n/.test(store(M).get(`${B}/Categories/Car.md`)), 'to the category note');
    eq(M.S.categories.find(c => c.name === 'Car').subcategories, ['Services', 'Fuel', 'Parking'], 'and the open book');

    eq(await dlg.save(['Services']), true, 'removing names saves too');
    ok(/subcategories: "Services"\n/.test(store(M).get(`${B}/Categories/Car.md`)), 'the note holds what is left');
    eq(store(M).get(`${B}/Transactions/Cheque/2026-09.md`), txBefore, 'removing a name rewrites no transaction file');
    eq(JSON.stringify(M.S.txFiles['Cheque/2026-09'].rows), rowsBefore, 'and no row in memory changed');
    ok(!M.S.txFiles['Cheque/2026-09'].dirty, 'nor is anything left unsaved');
    M.ctx.renderTransactions();
    subBtn(rowFor(M, 'Servicing')).click();
    eq(optionsOf(subSelect(rowFor(M, 'Servicing'))).map(o => o[0]), ['', 'Services', 'Fuel', 'Tolls', '__new__'],
      'a removed name stops being offered only if no row uses it: Fuel stays while Engen carries it');

    eq(await dlg.save([]), true, 'emptying the list saves');
    ok(!/subcategories/.test(store(M).get(`${B}/Categories/Car.md`)), 'by removing the key, as a note that never had one');
    ok(store(M).get(`${B}/Categories/Car.md`).includes('color: "#123456"'), 'and nothing else in the note moved');
    M.unpin();
  }
  {
    /* The first subcategory is created here, in a book that has none. */
    const M = await open(PLAIN());
    M.ctx.renderBudgets();
    const btn = find(M.ctx.$('#budTable'), n => hasClass(n, 'bud-act-subcats') && (n.getAttribute('aria-label') || '').endsWith('Car'))[0];
    btn.click();
    await settle();
    const dlg = asked.askSubcategories.at(-1);
    eq([dlg.names, dlg.inUse], [[], []], 'an empty dialog for a category with none');
    eq(await dlg.save(['Fuel']), true, 'the first name is saved');
    ok(/subcategories: "Fuel"\n/.test(store(M).get(`${B}/Categories/Car.md`)), 'into the category note');
    M.ctx.renderTransactions();
    ok(trs(M).some(tr => subCell(tr)), 'and the dropdowns appear: the book now uses subcategories');
    ok(!hasClass(M.ctx.$('#txSubcategory'), 'hidden'), 'along with the filter');
    M.unpin();
  }
  {
    /* A category with no note cannot hold a list, and says so. */
    const files = PLAIN();
    const M = await open(files);
    M.S.categories.find(c => c.name === 'Car').rel = undefined;
    M.ctx.renderBudgets();
    find(M.ctx.$('#budTable'), n => hasClass(n, 'bud-act-subcats') && (n.getAttribute('aria-label') || '').endsWith('Car'))[0].click();
    await settle();
    const dlg = asked.askSubcategories.at(-1);
    eq(await dlg.save(['Fuel']), false, 'a category with no note to write into refuses');
    ok(M.ctx._toasts.some(t => t.bad), 'and says so');
    M.unpin();
  }

  console.log(`subcategory-views.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
