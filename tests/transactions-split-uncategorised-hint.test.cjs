'use strict';
/* A split can produce uncategorised parts, and until now nothing said so.

   The split MODAL (src/modal.js — not an owner file for this fix) gates its
   OK button on the remainder being zero and every part being POSITIVE, not on
   every part having a category — each part's select defaults to "— none —"
   and the footer does not care. A 60/40 split can be committed with the 40
   left uncategorised, silently INCREASING the uncategorised count the reader
   was trying to reduce by splitting in the first place.

   Fix, scoped to what views/transactions.js can reach: once the parts are
   already written into item._file.rows (the modal has already resolved by
   then — src/modal.js is out of reach from splitTransaction), the toast names
   how many of the new parts still need a category. This does not gate
   anything and cannot — only the modal's own footer could refuse the split,
   and that file is not this fix's to touch.

   Drives the REAL registerTransactions(ctx) — askSplit is required directly
   by src/views/transactions.js as '../modal' (not injected via ctx, same as
   askFields/confirmModal in the other transactions-*.test.cjs files here), so
   it is intercepted at the module loader and made to resolve with parts the
   test controls.

     node tests/transactions-split-uncategorised-hint.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

let nextParts = null;
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
      askFields: async () => null,
      askSplit: async () => nextParts,
      confirmModal: async () => false,
    };
  }
  return origLoad.call(this, req, ...rest);
};

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = []; this.attrs = {};
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
  get options() { return this.children; }
  empty() { this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids.flat()) this.children.push(k && k.nodeType ? k : new FakeEl('span')); }
  appendChild(n) { this.children.push(n); return n; }
  insertBefore(n, ref) { const i = this.children.indexOf(ref); this.children.splice(i === -1 ? this.children.length : i, 0, n); return n; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
global.document = { createElement: tag => new FakeEl(tag), createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; } };

const registerTransactions = require('../src/views/transactions');

function makeCtx(row) {
  const cheque = { label: 'Cheque', month: '2026-07', rows: [row], dirty: false };
  const txAccount = new FakeEl('select'); txAccount.value = '';
  const txCategory = new FakeEl('select'); txCategory.value = '';
  const els = {
    '#txWholeHistory': { checked: true }, '#txAccount': txAccount, '#txCategory': txCategory, '#txSearch': { value: '' },
    '#txSave': new FakeEl('button'), '#txDeleteFiltered': new FakeEl('button'),
  };
  const toasts = [];
  const S = { txFiles: { Cheque: cheque }, period: '2026-07', categories: [{ name: 'Groceries' }] };
  const ctx = {
    S, $: sel => (sel in els ? els[sel] : new FakeEl('div')),
    app: {}, plugin: {},
    money: v => String(v),
    toast: (msg, bad) => toasts.push({ msg, bad }),
    readFile: async () => '', writeFile: async () => {}, writeVaultFile: async () => {},
    periodTitle: () => 'x', periodMonthName: () => 'x',
    txInPeriod: () => [],
    deferredCatSelect: () => new FakeEl('span'),
    learnRules: () => {},
    governingRule: () => null, correctRule: async () => false,
    txSegment: s => s,
    registerSaveButton: () => () => {},
    registerDirty: () => {},
    provide(obj) { Object.assign(ctx, obj); },
    _toasts: toasts, _cheque: cheque,
  };
  const item = { label: 'Cheque', _file: cheque, _row: row };
  return { ctx, item };
}

async function main() {
  /* ---- a split that leaves a part uncategorised is named in the toast ---- */
  {
    const row = { date: '2026-07-01', desc: 'Big shop', label: 'Cheque', cat: 'Groceries', amount: -100, excluded: false, note: '', split: '' };
    const { ctx, item } = makeCtx(row);
    registerTransactions(ctx);
    nextParts = [{ amount: 60, cat: 'Groceries', note: '' }, { amount: 40, cat: '', note: '' }];
    await ctx.splitTransaction(item);

    const parts = ctx._cheque.rows.filter(r => r.split === 'part');
    eq(parts.length, 2, 'both parts were written');
    const last = ctx._toasts.at(-1);
    ok(!last.bad, 'a completed split is not reported as an error');
    ok(/1 of the new parts still need a category/.test(last.msg),
      'the toast names how many of the new parts are still uncategorised');
  }

  /* ---- a fully-categorised split says nothing extra ---- */
  {
    const row = { date: '2026-07-01', desc: 'Big shop', label: 'Cheque', cat: 'Groceries', amount: -100, excluded: false, note: '', split: '' };
    const { ctx, item } = makeCtx(row);
    registerTransactions(ctx);
    nextParts = [{ amount: 60, cat: 'Groceries', note: '' }, { amount: 40, cat: 'Groceries', note: '' }];
    await ctx.splitTransaction(item);

    const last = ctx._toasts.at(-1);
    ok(!/still need a category/.test(last.msg), 'nothing extra is said when every part already has a category');
  }

  console.log(`transactions-split-uncategorised-hint.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
