'use strict';
/* A category pick on the Transactions page becomes a rule on Save only while a
   live row still stands behind it.

   The bug (2026-11-16 audit, T1): pendingLearns (description -> category) was
   written when the reader picked a category and cleared only by Save, so a pick
   the reader later threw away still taught the auto-categoriser on the NEXT
   Save, and the next statement import filed that merchant under it:
     - "Reload from disk" after a pick (the row is uncategorised again);
     - a bulk re-categorise of the search over a row picked by hand (the row
       says Household, the rule said Groceries);
     - a row deleted before Save.
   Fix: at Save, a pair is sent to learnRules only if some row in S.txFiles has
   that description AND currently holds that category.

   Drives the REAL registerTransactions(ctx), the real saveTransactions,
   categoriseFilteredTransactions and deleteTransaction. A fake
   deferredCatSelect captures each row's onchange (keyed by its aria label,
   which encodes date + description) so a reader's pick is simulated the way the
   real control invokes it.

     node tests/tx-learn-only-what-still-stands.test.cjs
*/
const assert = require('assert');
const path = require('path');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') {
    return {
      setIcon() {}, Notice: class {}, Modal: class {}, Setting: class {},
      PluginSettingTab: class {}, ItemView: class {}, Plugin: class {},
      TFile: class {}, TFolder: class {}, normalizePath: p => String(p),
    };
  }
  return origLoad.call(this, req, ...rest);
};

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.nodeType = 1;
    this.children = []; this.attrs = {}; this.parentNode = null; this._cls = new Set(); this._text = '';
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
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
global.document = { createElement: tag => new FakeEl(tag), createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; } };

const root = path.resolve(__dirname, '..');
// modal.js is destructured at require time by the view, so stub before requiring it.
const modal = require(path.join(root, 'src/modal'));
let bulkPick = 'Household';
modal.askFields = async () => ({ cat: bulkPick });
modal.confirmModal = async () => true;
const registerTransactions = require(path.join(root, 'src/views/transactions'));

const row = (date, desc, cat, amount = -100) =>
  ({ date, desc, label: 'Cheque', cat, amount, excluded: false, note: '', split: '' });

function harness(rows, search = '') {
  const file = () => ({ label: 'Cheque', month: '2026-07', rows, dirty: false });
  const S = { txFiles: { 'Cheque/2026-07': file() }, period: '2026-07',
    categories: ['Groceries', 'Household', 'Liquor', 'Shopping'].map(name => ({ name })) };
  const els = { '#txWholeHistory': { checked: true }, '#txAccount': Object.assign(new FakeEl('select'), { value: '' }),
    '#txCategory': Object.assign(new FakeEl('select'), { value: '' }), '#txSearch': Object.assign(new FakeEl('input'), { value: search }),
    '#txSave': new FakeEl('button'), '#txTable': new FakeEl('table') };
  const $ = s => (s in els ? els[s] : new FakeEl('div'));
  const cbs = {}; const learned = [];
  const ctx = { S, $, app: {}, plugin: {}, money: String, toast: () => {}, readFile: async () => '',
    writeFile: async () => {}, writeVaultFile: async () => {}, periodTitle: () => 'x', periodMonthName: () => 'x',
    txInPeriod: () => [], deferredCatSelect: (c, on, l) => { cbs[l] = on; return new FakeEl('span'); },
    learnRules: async items => { learned.push(items); return items.length; }, governingRule: () => null, correctRule: async () => false,
    txSegment: s => s, txFileRel: (l, m) => `Transactions/${l}/${m}.md`, registerSaveButton: () => () => {}, registerDirty: () => {},
    provide(o) { Object.assign(ctx, o); } };
  registerTransactions(ctx);
  ctx.renderTransactions();
  const pick = (desc, cat) => cbs[Object.keys(cbs).reverse().find(l => l.includes(desc))](cat);
  return { S, ctx, pick, learned, file };
}
const flat = learned => learned.flat().map(x => `${x.desc} -> ${x.cat}`);

(async () => {
  // (a) a pick undone by "Reload from disk" is not taught by a later Save.
  {
    const h = harness([row('2026-07-01', 'Woolworths', ''), row('2026-07-02', 'Takealot', 'Shopping', -50)]);
    h.pick('Woolworths', 'Liquor');
    h.S.txFiles = { 'Cheque/2026-07': h.file() };            // loadVault: fresh, clean objects
    const fresh = [row('2026-07-01', 'Woolworths', ''), row('2026-07-02', 'Takealot', 'Shopping', -50)];
    h.S.txFiles['Cheque/2026-07'].rows = fresh;
    h.ctx.renderTransactions();
    fresh[1].note = 'gift'; h.S.txFiles['Cheque/2026-07'].dirty = true;
    await h.ctx.saveTransactions();
    eq(flat(h.learned), [], '(a) reloaded pick must not become a rule');
  }
  // (b) a pick overwritten by a bulk re-categorise is not taught.
  {
    const rows = [row('2026-07-01', 'SPAR 123', '')];
    const h = harness(rows, 'spar');
    h.pick('SPAR 123', 'Groceries');
    h.S.txFiles['Cheque/2026-07'].dirty = false;             // bulk refuses over unsaved edits
    await h.ctx.categoriseFilteredTransactions();
    eq(rows[0].cat, 'Household', '(b) precondition: bulk moved the row');
    await h.ctx.saveTransactions();
    eq(flat(h.learned), [], '(b) overwritten pick must not become a rule');
  }
  // (c) the ordinary case still teaches.
  {
    const rows = [row('2026-07-01', 'Woolworths', ''), row('2026-07-02', 'Takealot', 'Shopping', -50)];
    const h = harness(rows);
    h.pick('Woolworths', 'Groceries');
    await h.ctx.saveTransactions();
    eq(flat(h.learned), ['Woolworths -> Groceries'], '(c) ordinary pick is learned');
  }
  // (d) a pick on a row deleted before Save is not taught.
  {
    const rows = [row('2026-07-01', 'Woolworths', ''), row('2026-07-02', 'Takealot', 'Shopping', -50)];
    const h = harness(rows);
    h.pick('Woolworths', 'Groceries');
    const f = h.S.txFiles['Cheque/2026-07'];
    await h.ctx.deleteTransaction({ ...rows[0], label: 'Cheque', _file: f, _row: rows[0] }, 0);
    eq(f.rows.length, 1, '(d) precondition: row deleted');
    await h.ctx.saveTransactions();
    eq(flat(h.learned), [], '(d) deleted row must not teach');
  }
  // (e) two rows share a description; one set by hand, the other still empty.
  {
    const rows = [row('2026-07-01', 'Woolworths', ''), row('2026-07-09', 'Woolworths', '')];
    const h = harness(rows);
    h.pick('2026-07-01', 'Groceries');
    await h.ctx.saveTransactions();
    eq(flat(h.learned), ['Woolworths -> Groceries'], '(e) a live row holds the pick');
    eq(rows[1].cat, '', '(e) the other row is untouched');
  }
  // (f) a good pair is kept when a bad one is dropped in the same Save.
  {
    const rows = [row('2026-07-01', 'Woolworths', ''), row('2026-07-02', 'Engen', '')];
    const h = harness(rows);
    h.pick('Woolworths', 'Groceries'); h.pick('Engen', 'Liquor');
    rows[1].cat = '';                                        // as if reloaded
    await h.ctx.saveTransactions();
    eq(flat(h.learned), ['Woolworths -> Groceries'], '(f) only the standing pair is sent');
  }
  console.log(`PASS tx-learn-only-what-still-stands (${checks} checks)`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
