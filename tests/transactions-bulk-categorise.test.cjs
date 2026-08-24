'use strict';
/* Categorising is the single most-repeated step in the whole loop — 40
   uncategorised rows means 80 interactions even when a dozen share one
   merchant — and until now the only bulk action on the Transactions page was
   Delete (deleteFilteredTransactions). categoriseFilteredTransactions mirrors
   that pattern's filter-selection idiom exactly: filteredRows() IS the
   selection, and at least one filter must be set first.

   Drives the REAL registerTransactions(ctx) — categoriseFilteredTransactions
   is published on ctx for exactly this reason (like filteredRows and
   syncOptions before it). askFields/confirmModal are required directly by
   src/views/transactions.js (not injected via ctx, same as splitTransaction's
   askSplit), so they are intercepted at the module-loader level, the same way
   the shared obsidian stub already is.

     node tests/transactions-bulk-categorise.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- module loader stubs: obsidian, and modal.js's two prompts ---------- */
let nextAskFields = null;   // what askFields() resolves to on the next call
let nextConfirm = null;     // what confirmModal() resolves to on the next call
let askFieldsCalls = 0, confirmCalls = 0;

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') {
    return {
      setIcon() {}, Notice: class {}, Modal: class {}, Setting: class {},
      PluginSettingTab: class {}, ItemView: class {}, Plugin: class {},
      TFile: class {}, TFolder: class {},
      normalizePath: p => String(p),
    };
  }
  if (req === '../modal') {
    return {
      askFields: async () => { askFieldsCalls++; return nextAskFields; },
      askSplit: async () => null,
      confirmModal: async () => { confirmCalls++; return nextConfirm; },
    };
  }
  return origLoad.call(this, req, ...rest);
};

/* ------------------------------- fake DOM --------------------------------- */
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = []; this.attrs = {}; this.style = {}; this.parentNode = null;
    this._cls = new Set(); this._text = '';
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._cls.add(x)),
      remove: (...c) => c.forEach(x => self._cls.delete(x)),
      toggle: (c, on) => (on ? self._cls.add(c) : self._cls.delete(c)),
      contains: c => self._cls.has(c),
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get parentElement() { return this.parentNode; }
  // Only meaningful for a <select> stand-in — syncOptions() reads it.
  get options() { return this.children; }
  empty() { this.children = []; this._text = ''; }
  append(...kids) {
    for (const k of kids.flat()) {
      const n = (k && k.nodeType) ? k : document.createTextNode(k);
      n.parentNode = this;
      this.children.push(n);
    }
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref) {
    n.parentNode = this;
    const i = this.children.indexOf(ref);
    this.children.splice(i === -1 ? this.children.length : i, 0, n);
    return n;
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this._listeners ||= {})[type] = fn; }
  click() { if (this._listeners && this._listeners.click) this._listeners.click(); }
  focus() {}
}
global.document = {
  createElement: tag => new FakeEl(tag),
  createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; },
};

const registerTransactions = require('../src/views/transactions');

/* ---------------------------------- ctx ----------------------------------- */
function makeCtx() {
  const ROWS = [
    { date: '2026-07-01', desc: 'Woolworths', label: 'Cheque', cat: '', amount: -100, excluded: false, note: '', split: '' },
    { date: '2026-07-02', desc: 'Pick n Pay', label: 'Cheque', cat: '', amount: -200, excluded: false, note: '', split: '' },
    { date: '2026-07-03', desc: 'Salary', label: 'Cheque', cat: 'Income', amount: 5000, excluded: false, note: '', split: '' },
  ];
  const cheque = { label: 'Cheque', month: '2026-07', rows: ROWS, dirty: false };
  // A second, untouched account/month — proves the bulk action only touches
  // files that actually have a matching row, not every open file.
  const savings = { label: 'Savings', month: '2026-07', rows: [
    { date: '2026-07-05', desc: 'Interest', label: 'Savings', cat: '', amount: 10, excluded: false, note: '', split: '' },
  ], dirty: false };

  const dom = { '#txSave': new FakeEl('button'), '#txDeleteFiltered': new FakeEl('button') };
  dom['#txDeleteFiltered'].parentNode = new FakeEl('div');
  dom['#txDeleteFiltered'].parentNode.append(dom['#txDeleteFiltered']);
  dom['#txSave'].disabled = true;

  const toasts = [];
  const txAccount = new FakeEl('select'); txAccount.value = 'Cheque'; // a filter IS set
  const txCategory = new FakeEl('select'); txCategory.value = '';
  const txSearch = new FakeEl('input'); txSearch.value = '';
  const els = {
    '#txWholeHistory': { checked: true },
    '#txAccount': txAccount,
    '#txCategory': txCategory,
    '#txSearch': txSearch,
    '#txSave': dom['#txSave'],
    '#txDeleteFiltered': dom['#txDeleteFiltered'],
    '#txBulkCat': null,
    '#txSubNote': new FakeEl('div'),
    '#txUndoBar': new FakeEl('div'),
  };
  const S = {
    txFiles: { Cheque: cheque, Savings: savings },
    period: '2026-07', categories: [{ name: 'Groceries' }, { name: 'Income' }],
    lastImport: null,
  };
  // '#txBulkCat' is a LIVE query, not a static lookup: it does not exist
  // until ensureBulkCatButton() has inserted it, and the whole point of this
  // fixture is proving that guard actually works against the real function.
  const bulkCatHost = dom['#txDeleteFiltered'].parentNode;
  const $ = sel => {
    if (sel === '#txBulkCat') return bulkCatHost.children.find(c => c.attrs && c.attrs.id === 'txBulkCat') || null;
    return sel in els ? els[sel] : new FakeEl('div');
  };
  const ctx = {
    S,
    $,
    app: {}, plugin: {},
    money: v => String(v),
    toast: (msg, bad) => toasts.push({ msg, bad }),
    readFile: async () => '', writeFile: async () => {}, writeVaultFile: async () => {},
    periodTitle: () => 'x', periodMonthName: () => 'x',
    txInPeriod: () => [...ROWS, ...savings.rows].map(r => ({ ...r, label: r.label,
      _file: r.label === 'Cheque' ? cheque : savings, _row: r })),
    deferredCatSelect: () => new FakeEl('span'),
    learnRules: () => {},
    txSegment: s => s,
    registerSaveButton: () => () => {},
    registerDirty: () => {},
    provide(obj) { Object.assign(ctx, obj); },
    _toasts: toasts, _rows: ROWS, _cheque: cheque, _savings: savings,
  };
  return ctx;
}

async function main() {
  /* ---- gate 1: no filter set -> refused, no prompt shown ---- */
  {
    const ctx = makeCtx();
    registerTransactions(ctx);
    ctx.$('#txAccount').value = ''; // undo the filter makeCtx set
    askFieldsCalls = 0; confirmCalls = 0;
    await ctx.categoriseFilteredTransactions();
    eq(askFieldsCalls, 0, 'the category picker never opens without a filter');
    eq(ctx._toasts.at(-1).bad, true, 'refusal is reported as an error');
    eq(ctx._rows.every(r => r.cat === '' || r.cat === 'Income'), true, 'nothing was recategorised');
  }

  /* ---- gate 2: filter set, nothing matches -> refused ---- */
  {
    const ctx = makeCtx();
    registerTransactions(ctx);
    ctx.$('#txAccount').value = 'Nonexistent';
    askFieldsCalls = 0;
    await ctx.categoriseFilteredTransactions();
    eq(askFieldsCalls, 0, 'no rows selected means no prompt either');
  }

  /* ---- cancelling the picker changes nothing ---- */
  {
    const ctx = makeCtx();
    registerTransactions(ctx);
    nextAskFields = null; // "Cancel"
    await ctx.categoriseFilteredTransactions();
    eq(ctx._rows.map(r => r.cat), ['', '', 'Income'], 'a cancelled picker leaves every category untouched');
    eq(ctx._cheque.dirty, false, 'and marks nothing dirty');
  }

  /* ---- cancelling the confirm changes nothing either ---- */
  {
    const ctx = makeCtx();
    registerTransactions(ctx);
    nextAskFields = { cat: 'Groceries' };
    nextConfirm = false;
    await ctx.categoriseFilteredTransactions();
    eq(ctx._rows.map(r => r.cat), ['', '', 'Income'], 'a declined confirmation leaves every category untouched');
  }

  /* ---- the real path: filter set, category chosen and confirmed ---- */
  {
    const ctx = makeCtx();
    registerTransactions(ctx);
    nextAskFields = { cat: 'Groceries' };
    nextConfirm = true;
    await ctx.categoriseFilteredTransactions();
    eq(ctx._rows.map(r => r.cat), ['Groceries', 'Groceries', 'Groceries'],
      'every row the filter selected is recategorised, including the one that already had a category');
    eq(ctx._cheque.dirty, true, 'the touched file is marked dirty');
    eq(ctx._savings.dirty, false, 'a file with no matching row is left alone');
    eq(ctx.$('#txSave').disabled, false, 'Save lights up — nothing is written to disk on its own');
    ok(!ctx._toasts.at(-1).bad, 'success is reported, not as an error');
  }

  /* ---- the button is inserted once, beside Delete, and not duplicated ----
     No `#txBulkCat` id to query by — src/views/transactions.js deliberately
     avoids one (tests/shell-contract.test.cjs pins that every `$('#id')` in
     src/ must resolve to a real id in shell.js, which this button cannot
     have). Found here the same way a real reader would: it is the extra
     BUTTON sitting in Delete's own parent. */
  {
    const ctx = makeCtx();
    registerTransactions(ctx);
    ctx.renderTransactions();
    ctx.renderTransactions();
    const delBtn = ctx.$('#txDeleteFiltered');
    const host = delBtn.parentNode;
    const bulkBtns = host.children.filter(c => c !== delBtn && c.tagName === 'BUTTON');
    eq(bulkBtns.length, 1, 'exactly one bulk-categorise button after two renders, not one per render');
    const delIdx = host.children.indexOf(ctx.$('#txDeleteFiltered'));
    const btnIdx = host.children.indexOf(bulkBtns[0]);
    ok(btnIdx < delIdx, 'inserted BEFORE Delete, i.e. beside it in the toolbar');
  }

  console.log(`transactions-bulk-categorise.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
