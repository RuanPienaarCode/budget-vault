'use strict';
/* The Transactions page must not silently teach the auto-categoriser from
   every category edit — only from a row that arrived UNCATEGORISED.

   The bug: every category change on this page — a first-time pick AND a
   CORRECTION of a category a rule (or a person) got wrong — was pushed into
   pendingLearns and flushed into a global rule on Save, with no
   confirmation and no visible opt-out. The import review only ever offers to
   learn behind its own labelled checkbox (#impRemember); a page whose whole
   purpose is fixing mistakes was quieter about teaching them than the page
   that only ever adds new ones. Given rule-learning has no correction path
   once written (categories.js's learnRules: an established rule is never
   silently overwritten), a wrong rule taught from a CORRECTION here could
   only be fixed by hand-editing Data/Categorisation Rules.csv.

   Fix: learning is scoped to rows whose on-disk category was EMPTY before
   this edit (captured once per render as `origCat`, not re-read from r.cat
   inside the onchange, which would already hold an earlier in-session edit
   and wrongly exempt a second edit to the same row).

   Drives the REAL registerTransactions(ctx) end to end: a fake
   deferredCatSelect captures each row's onchange handler (keyed by its aria
   label, which encodes date+desc and is therefore unique per row) so the
   test can simulate a reader's pick exactly the way the real control would
   invoke it, then calls the REAL saveTransactions() and inspects what
   actually reached learnRules.

     node tests/transactions-scoped-learning.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

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
  return origLoad.call(this, req, ...rest);
};

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = []; this.attrs = {}; this.parentNode = null;
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
  append(...kids) { for (const k of kids.flat()) { const n = k && k.nodeType ? k : new FakeEl('span'); n.parentNode = this; this.children.push(n); } }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref) { n.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i === -1 ? this.children.length : i, 0, n); return n; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
global.document = { createElement: tag => new FakeEl(tag), createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; } };

const registerTransactions = require('../src/views/transactions');

function makeCtx() {
  const rows = [
    // Arrives with NO category — a first-time pick here must still teach the rule.
    { date: '2026-07-01', desc: 'Woolworths', label: 'Cheque', cat: '', amount: -100, excluded: false, note: '', split: '' },
    // Arrives ALREADY categorised — editing this one is a CORRECTION, and must not.
    { date: '2026-07-02', desc: 'Takealot', label: 'Cheque', cat: 'Shopping', amount: -50, excluded: false, note: '', split: '' },
  ];
  const cheque = { label: 'Cheque', month: '2026-07', rows, dirty: false };
  const S = { txFiles: { Cheque: cheque }, period: '2026-07', categories: [{ name: 'Groceries' }, { name: 'Shopping' }, { name: 'Dining' }] };

  const dom = { '#txDeleteFiltered': new FakeEl('button') };
  dom['#txDeleteFiltered'].parentNode = new FakeEl('div');
  dom['#txDeleteFiltered'].parentNode.append(dom['#txDeleteFiltered']);
  const txSave = new FakeEl('button'); txSave.disabled = true;
  const txAccount = new FakeEl('select'); txAccount.value = '';
  const txCategory = new FakeEl('select'); txCategory.value = '';
  const txSearch = new FakeEl('input'); txSearch.value = '';
  const els = {
    '#txWholeHistory': { checked: true },
    '#txAccount': txAccount, '#txCategory': txCategory, '#txSearch': txSearch,
    '#txSave': txSave,
    '#txDeleteFiltered': dom['#txDeleteFiltered'],
    '#txSubNote': new FakeEl('div'), '#txUndoBar': new FakeEl('div'),
    '#txTable': new FakeEl('table'),
  };
  const $ = sel => (sel in els ? els[sel] : new FakeEl('div'));

  const catCallbacks = {}; // aria label -> onchange, captured per row build
  const learnCalls = [];
  const ctx = {
    S,
    $,
    app: {}, plugin: {},
    money: v => String(v),
    toast: () => {},
    readFile: async () => '', writeFile: async () => {}, writeVaultFile: async () => {},
    periodTitle: () => 'x', periodMonthName: () => 'x',
    txInPeriod: () => [],
    deferredCatSelect: (cur, onchange, label) => { catCallbacks[label] = onchange; return new FakeEl('span'); },
    learnRules: async items => { learnCalls.push(items); return items.length; },
    // Fix 7's rule-correction offer (categories.js) is out of scope for THIS
    // file — no rule governs either fixture description, so it never fires;
    // see tests/transactions-rule-correction.test.cjs for that path.
    governingRule: () => null,
    correctRule: async () => false,
    txSegment: s => s,
    registerSaveButton: () => () => {},
    registerDirty: () => {},
    provide(obj) { Object.assign(ctx, obj); },
    _learnCalls: learnCalls, _cheque: cheque,
  };
  return { ctx, catCallbacks };
}

async function main() {
  const { ctx, catCallbacks } = makeCtx();
  registerTransactions(ctx);
  ctx.renderTransactions();

  const wooliesLabel = Object.keys(catCallbacks).find(l => l.includes('Woolworths'));
  const takealotLabel = Object.keys(catCallbacks).find(l => l.includes('Takealot'));
  assert.ok(wooliesLabel && takealotLabel, 'both rows built a category control');

  /* A first-time pick on the row that arrived uncategorised. */
  catCallbacks[wooliesLabel]('Groceries');
  /* A CORRECTION on the row that already had a category. */
  catCallbacks[takealotLabel]('Dining');

  eq(ctx._cheque.rows[0].cat, 'Groceries', 'the in-memory row is still updated either way');
  eq(ctx._cheque.rows[1].cat, 'Dining', 'both edits take effect on screen');

  await ctx.saveTransactions();
  eq(ctx._learnCalls.length, 1, 'learnRules is called once, at Save');
  eq(ctx._learnCalls[0], [{ desc: 'Woolworths', cat: 'Groceries' }],
    'only the row that arrived UNCATEGORISED teaches the auto-categoriser — the correction does not');

  console.log(`transactions-scoped-learning.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
