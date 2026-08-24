'use strict';
/* A learned rule could never be corrected from inside the app.

   categories.js's learnRules has a deliberate "an established rule is never
   silently overwritten" guard (have.has(key) -> continue) — sound on its
   own, but paired with NO correction path: no rules list, no editor, no "this
   came from a rule". Miscategorise a merchant once and every future charge
   from it arrives wrong forever, fixable only by hand-editing
   Data/Categorisation Rules.csv, which the app never even names.

   Fix, split across two owner files:

     - categories.js: governingRule(desc) names the rule CURRENTLY governing a
       description (reusing matchRule, not a second hand-rolled tie-break —
       "two figures derived by different rules" is this repo's own recurring
       bug shape). correctRule(rule, newCat) repoints an EXISTING rule and is
       the one place that touches rule.category outside learnRules.
     - views/transactions.js: a recategorisation that disagrees with the
       description's governing rule is now ASKED "also change the rule for
       {pattern} from {old} to {new}?" — never applied silently, and never
       offered at all for a FIRST-time pick (that half stays exactly what it
       was: silent learning, scoped by the sibling fix in
       tests/transactions-scoped-learning.test.cjs).

   Drives the REAL registerCategories(ctx) + registerTransactions(ctx) end to
   end, over a real in-memory writeFile so correctRule's CSV write is
   observed, not asserted on trust. askFields/confirmModal/askRulesCleanup are
   intercepted at the module loader (categories.js requires them as './modal',
   transactions.js as '../modal' — both stubbed identically) the same way
   tests/transactions-bulk-categorise.test.cjs already does for transactions.js
   alone.

     node tests/transactions-rule-correction.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- module loader stubs: obsidian, and modal.js's three prompts -------- */
let nextConfirm = null;
const confirmCalls = [];

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
  if (req === './modal' || req === '../modal') {
    return {
      askFields: async () => null,
      askRulesCleanup: async () => false,
      confirmModal: async (app, opts) => { confirmCalls.push(opts); return nextConfirm; },
    };
  }
  return origLoad.call(this, req, ...rest);
};

/* ------------------------------- fake DOM --------------------------------- */
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

const registerCategories = require('../src/categories');
const registerTransactions = require('../src/views/transactions');

/* ---------------------------------- ctx ----------------------------------- */
function makeCtx(rows) {
  const cheque = { label: 'Cheque', month: '2026-07', rows, dirty: false };
  const writes = {};
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

  const catCallbacks = {};
  const S = {
    txFiles: { Cheque: cheque }, period: '2026-07',
    categories: [{ name: 'Groceries' }, { name: 'Dining' }],
    rules: [{ pattern: 'woolworths', category: 'Groceries' }],
  };
  const ctx = {
    S, $, app: {}, plugin: {}, vault: {},
    money: v => String(v),
    toast: () => {},
    readFile: async () => '', writeVaultFile: async () => {},
    writeFile: async (path, content) => { writes[path] = content; },
    fileAt: () => null, mdFilesIn: () => [],
    periodTitle: () => 'x', periodMonthName: () => 'x',
    txInPeriod: () => [],
    // NOT deferredCatSelect: registerCategories(ctx) provides the real one,
    // and it must go in BEFORE this capturing stub overwrites it — see
    // registerAll below. Setting it here too would just get clobbered the
    // moment registerCategories runs.
    txSegment: s => s,
    registerSaveButton: () => () => {},
    registerDirty: () => {},
    provide(obj) { Object.assign(ctx, obj); },
    _writes: writes, _cheque: cheque,
  };
  return { ctx, catCallbacks };
}

/* registerCategories(ctx) is what actually PROVIDES ctx.governingRule,
   ctx.correctRule and the real ctx.deferredCatSelect (categories.js) — it has
   to run before registerTransactions(ctx) destructures those off ctx, same
   ordering controller.js itself uses (registerCategories before
   registerTransactions). The capturing stub is installed AFTER, or
   registerCategories' own real deferredCatSelect would overwrite it instead
   of the other way round. */
function registerAll(ctx, catCallbacks) {
  registerCategories(ctx);
  ctx.deferredCatSelect = (cur, onchange, label) => { catCallbacks[label] = onchange; return new FakeEl('span'); };
  registerTransactions(ctx);
}

async function main() {
  /* ---- categories.js: governingRule / correctRule, in isolation --------- */
  {
    const { ctx } = makeCtx([]);
    registerCategories(ctx);
    const rule = ctx.governingRule('WOOLWORTHS SANDTON');
    ok(rule, 'the rule governing a matching description is found');
    eq(rule.pattern, 'woolworths', 'and it is the ORIGINAL entry (case preserved), not the lowercased matcher copy');
    eq(ctx.governingRule('SOME OTHER MERCHANT'), null, 'no rule governs an unmatched description');

    const changed = await ctx.correctRule(rule, 'Dining');
    ok(changed, 'correctRule reports the change');
    eq(rule.category, 'Dining', 'and repoints the SAME object the caller passed in');
    eq(ctx.S.rules[0].category, 'Dining', 'which is the live rule in S.rules — not a copy');
    ok(ctx._writes['Data/Categorisation Rules.csv'].includes('Dining'),
      'and the rules CSV is rewritten to match');

    const noop = await ctx.correctRule(rule, 'Dining');
    eq(noop, false, 'repointing a rule at the category it already has is a no-op, not a write');
  }

  /* ---- transactions.js: a CORRECTION offers to fix the governing rule --- */
  {
    const rows = [{ date: '2026-07-05', desc: 'WOOLWORTHS SANDTON', label: 'Cheque', cat: 'Groceries', amount: -80, excluded: false, note: '', split: '' }];
    const { ctx, catCallbacks } = makeCtx(rows);
    registerAll(ctx, catCallbacks);
    ctx.renderTransactions();

    const label = Object.keys(catCallbacks).find(l => l.includes('WOOLWORTHS'));
    ok(label, 'the row built a category control');

    confirmCalls.length = 0;
    nextConfirm = true;
    catCallbacks[label]('Dining');
    // offerRuleCorrection is fired-and-forgotten from a synchronous onchange;
    // its own await points (confirmModal, then correctRule) resolve on
    // already-queued microtasks, so draining them is enough to observe both.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    eq(rows[0].cat, 'Dining', "the row's own category changes regardless of the rule question");
    eq(confirmCalls.length, 1, 'the reader is asked, once, about the rule');
    const msg = confirmCalls[0].message + ' ' + confirmCalls[0].title;
    ok(/woolworths/i.test(msg), 'the question names the PATTERN');
    ok(/Groceries/.test(msg) && /Dining/.test(msg), 'and both the old and new category');
    eq(ctx.S.rules[0].category, 'Dining', 'confirming updates the governing rule');
  }

  /* ---- declining leaves the rule untouched ---- */
  {
    const rows = [{ date: '2026-07-05', desc: 'WOOLWORTHS SANDTON', label: 'Cheque', cat: 'Groceries', amount: -80, excluded: false, note: '', split: '' }];
    const { ctx, catCallbacks } = makeCtx(rows);
    registerAll(ctx, catCallbacks);
    ctx.renderTransactions();
    const label = Object.keys(catCallbacks).find(l => l.includes('WOOLWORTHS'));

    nextConfirm = false;
    catCallbacks[label]('Dining');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    eq(rows[0].cat, 'Dining', "the row's own category still changes — declining is about the RULE only");
    eq(ctx.S.rules[0].category, 'Groceries', 'but a declined offer leaves the rule exactly as it was');
  }

  /* ---- a FIRST-time pick never asks — nothing to correct yet ------------ */
  {
    // Same governing rule (woolworths -> Groceries) exists, but this row
    // arrives UNCATEGORISED, so picking a category that disagrees with the
    // rule is a fresh choice, not a correction of one already made.
    const rows = [{ date: '2026-07-06', desc: 'WOOLWORTHS ROSEBANK', label: 'Cheque', cat: '', amount: -40, excluded: false, note: '', split: '' }];
    const { ctx, catCallbacks } = makeCtx(rows);
    registerAll(ctx, catCallbacks);
    ctx.renderTransactions();
    const label = Object.keys(catCallbacks).find(l => l.includes('WOOLWORTHS'));

    confirmCalls.length = 0;
    catCallbacks[label]('Dining');
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    eq(confirmCalls.length, 0, 'a first-time pick is never treated as a correction, even if a rule would have disagreed');
    eq(ctx.S.rules[0].category, 'Groceries', 'so the existing rule is left alone');
  }

  console.log(`transactions-rule-correction.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
