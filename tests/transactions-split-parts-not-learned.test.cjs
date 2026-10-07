'use strict';
/* A split PART never teaches the auto-categoriser, and never asks to change a
   rule — and the rule question offers its safe answer as the default.

   A part is the reader's own slice of one bank line, categorised by them in
   the split dialog. No rule filed it, and every part of one line shares that
   line's description, each with a different category. splitTransaction
   already said so ("Deliberately NOT fed to pendingLearns") — but a part left
   uncategorised in the dialog and categorised later in the table WAS learned
   on Save, as a rule for the whole merchant; and changing a part's category
   asked "Update the matching rule too?", offering to refile every future
   import of that merchant to one slice's category (2026-10-07 audit,
   carry-overs from the Phase 1 rule-fix work). tx-role.js isSplitPart is the
   one door to "is this a part".

   And the rule question itself: "Just this row" is its safe answer (Escape and
   tapping outside resolve there too), so it now carries the call-to-action
   style and "Update the rule" is plain — confirmModal's `primary: 'cancel'`
   (tests/modal-confirm-primary.test.cjs).

   Drives the REAL registerTransactions with a fake category control that
   captures each row's onchange, the shape transactions-scoped-learning uses.
     node tests/transactions-split-parts-not-learned.test.cjs */

const assert = require('assert');
const Module = require('module');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const confirms = [];
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') {
    return { setIcon() {}, Notice: class {}, Modal: class {}, Setting: class {}, PluginSettingTab: class {},
      ItemView: class {}, Plugin: class {}, TFile: class {}, TFolder: class {}, normalizePath: p => String(p) };
  }
  if (req === './modal' || req === '../modal') {
    return { askFields: async () => null, askSplit: async () => null, askRulesCleanup: async () => false,
      confirmModal: async (app, opts) => { confirms.push(opts); return false; } };
  }
  return origLoad.call(this, req, ...rest);
};

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.nodeType = 1;
    this.children = []; this.attrs = {}; this.parentNode = null; this._cls = new Set(); this._text = '';
    const self = this;
    this.classList = { add: (...c) => c.forEach(x => self._cls.add(x)), remove: (...c) => c.forEach(x => self._cls.delete(x)),
      toggle: (c, on) => (on ? self._cls.add(c) : self._cls.delete(c)), contains: c => self._cls.has(c) };
  }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get options() { return this.children; }
  empty() { this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids.flat()) { const n = k && k.nodeType ? k : new FakeEl('span'); n.parentNode = this; this.children.push(n); } }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n) { n.parentNode = this; this.children.push(n); return n; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
global.document = { createElement: tag => new FakeEl(tag), createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; } };

const registerTransactions = require('../src/views/transactions');
const tick = () => new Promise(r => setTimeout(r, 0));

function mount() {
  const row = (desc, cat, amount, split, excluded = false) => ({ date: '2026-07-05', desc, label: 'Cheque', cat, amount, excluded, note: '', split });
  const rows = [
    row('Big shop', 'Groceries', -1000, 'parent', true),
    row('Big shop', 'Groceries', -600, 'part'),            // categorised in the split dialog
    row('Big shop', '', -400, 'part'),                      // left at "— none —" there
    row('Corner Cafe', '', -35, ''),                         // an ordinary uncategorised row
    row('Fuel Station', 'Groceries', -500, ''),              // an ordinary row a rule filed wrong
  ];
  const cheque = { label: 'Cheque', month: '2026-07', rows, dirty: false };
  const S = { txFiles: { 'Cheque/2026-07': cheque }, period: '2026-07', rules: [],
    categories: [{ name: 'Groceries' }, { name: 'Household' }, { name: 'Dining' }, { name: 'Fuel' }] };
  const del = new FakeEl('button'); const bar = new FakeEl('div'); bar.append(del);
  const els = { '#txWholeHistory': { checked: true }, '#txAccount': new FakeEl('select'), '#txCategory': new FakeEl('select'),
    '#txSearch': Object.assign(new FakeEl('input'), { value: '' }), '#txSave': new FakeEl('button'), '#txDeleteFiltered': del,
    '#txSubNote': new FakeEl('div'), '#txUndoBar': new FakeEl('div'), '#txTable': new FakeEl('table') };
  els['#txAccount'].value = ''; els['#txCategory'].value = '';
  const handlers = [];
  const learned = [];
  /* Every description is governed by one rule here, filing it as Groceries —
     so any category change on any row disagrees with "its" rule. */
  const rule = desc => ({ pattern: desc.toLowerCase(), category: 'Groceries' });
  const ctx = {
    S, $: sel => (sel in els ? els[sel] : new FakeEl('div')), app: {}, plugin: {},
    money: v => String(v), toast: () => {},
    readFile: async () => '', writeFile: async () => {}, writeVaultFile: async () => {},
    periodTitle: () => 'x', periodMonthName: () => 'x', txInPeriod: () => [],
    deferredCatSelect: (cur, onchange) => { handlers.push(onchange); return new FakeEl('span'); },
    learnRules: async items => { learned.push(...items); return items.length; },
    governingRule: desc => rule(desc), correctRule: async () => true,
    txSegment: s => s, txFileRel: (l, m) => `Transactions/${l}/${m}.md`,
    registerSaveButton: () => () => {}, registerDirty: () => {},
    provide(obj) { Object.assign(ctx, obj); },
  };
  registerTransactions(ctx);
  ctx.renderTransactions();
  /* filteredRows sorts by date only, so same-day rows keep file order: the
     handlers line up with `rows`. */
  return { ctx, rows, pick: (i, v) => handlers[i](v), learned };
}

(async () => {
  /* ---- a part is never learned, and never asks about the rule ------------ */
  {
    const { ctx, rows, pick, learned } = mount();
    pick(2, 'Household');                 // the part left uncategorised in the split dialog
    pick(1, 'Dining');                    // a part that already had a category
    await tick();
    eq(rows[2].cat, 'Household', 'the part still takes the category on screen');
    eq(rows[1].cat, 'Dining', 'both of them');
    eq(confirms.length, 0, 'changing a part\'s category does not offer to repoint the merchant\'s rule');
    await ctx.saveTransactions();
    eq(learned, [], 'and categorising a part teaches the auto-categoriser nothing — every part shares one description');
  }

  /* ---- controls: an ordinary row still learns, and still asks ------------ */
  {
    confirms.length = 0;
    const { ctx, pick, learned } = mount();
    pick(3, 'Dining');                    // ordinary, arrived uncategorised: learned, as before
    pick(4, 'Fuel');                      // ordinary, a correction of the rule's pick: asked
    await tick();
    eq(confirms.length, 1, 'control: a correction on an ordinary row still asks about its rule');
    eq(confirms[0].cancelText, 'Just this row', 'the safe answer is the cancel side');
    eq(confirms[0].primary, 'cancel', 'and it is the one drawn as the call to action, with "Update the rule" plain');
    await ctx.saveTransactions();
    eq(learned, [{ desc: 'Corner Cafe', cat: 'Dining' }], 'control: a first pick on an ordinary row is still learned');
  }

  ok(true, 'done');
  console.log(`PASS transactions-split-parts-not-learned — a split part is never a rule, and the rule question defaults to "Just this row" (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
