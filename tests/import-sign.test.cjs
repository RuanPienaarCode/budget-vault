'use strict';
/* Statement import — an explicit sign in a Debit/Credit cell must survive.

   The bug: a negative value in the Credit ("money in") column was Math.abs'd
   unconditionally, so a reversal-of-a-refund posted as -30.00 in the Credit
   column imported as +30.00 — a R30 refund reversal booked as income instead
   of the outflow it actually was.

   Date,Description,Debit,Credit
   2026-01-02,REFUND REVERSAL,,-30.00     ->  actual +30 (bug), expected -30

   Drives the REAL registerImport(ctx) — handleStatementFile through to
   S.pendingImport — over a minimal FakeEl DOM (same shape as
   rule-cleanup-modal.test.cjs) so the review render path (which calls el()
   internally) does not need a real Obsidian/browser.

   Pinned alongside it: an ordinary positive Credit cell (must stay +) and an
   ordinary positive Debit cell (must stay -) — the fix must not perturb the
   two cases that already worked.

     node tests/import-sign.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* --------------------------------- DOM ----------------------------------
   Minimal FakeEl, same shape as tests/rule-cleanup-modal.test.cjs — enough for
   src/dom.js's el() and the plain classList/append/textContent calls
   src/views/import.js makes while building the review screen. Nothing here
   is asserted on directly; only S.pendingImport is. */
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.children = []; this.attrs = {}; this.style = {};
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
  empty() { this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids.flat()) this.children.push(k && k.nodeType ? k : new FakeEl('span')); }
  appendChild(n) { this.children.push(n); return n; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
global.document = {
  createElement: tag => new FakeEl(tag),
  createTextNode: t => new FakeEl('span'),
};

/* ------------------------------ obsidian --------------------------------- */
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

const registerImport = require('../src/views/import');
const { PROFILES } = require('../src/locale');

/* ---------------------------------- ctx ----------------------------------
   Only the ctx surface registerImport actually reads on the path this test
   drives (handleStatementFile -> runImport -> renderImportReview). writeFile
   / learnRules / serializeTxFile are only reached from commitImport, which
   this test never calls, so they are deliberately left undefined. */
function makeCtx() {
  const stub = () => new FakeEl('div');
  const S = { accounts: [], txFiles: {}, rules: [], pendingImport: null };
  const ctx = {
    S,
    $: stub,
    app: {},
    money: v => String(v),
    toast: () => {},
    currentPeriod: () => '2026-01',
    periodRange: () => ({ start: '2026-01-01', end: '2026-01-31' }),
    periodTitle: () => 'January 2026',
    deferredCatSelect: () => new FakeEl('span'),
    locale: () => PROFILES.za,
    txSegment: s => s,
    accountForLabel: () => null,
    provide(obj) { Object.assign(ctx, obj); },
  };
  return ctx;
}

function makeFile(text, name = 'statement.csv') {
  return { name, async arrayBuffer() { return new TextEncoder().encode(text).buffer; } };
}

async function importCsv(csv) {
  const ctx = makeCtx();
  registerImport(ctx);
  await ctx.handleStatementFile(makeFile(csv));
  return ctx.S.pendingImport;
}

async function main() {
  /* ========================================================== the defect */
  {
    const csv = 'Date,Description,Debit,Credit\n2026-01-02,REFUND REVERSAL,,-30.00\n';
    const p = await importCsv(csv);
    ok(p, 'the file parsed into a pending import');
    eq(p.items.length, 1, 'one row');
    eq(p.items[0].amount, -30, 'an explicit negative sign in the Credit column is honoured, not abs-ed away');
  }

  /* ================================================== the cases that must
     keep working — an ordinary statement has no signed cells at all */
  {
    const csv = 'Date,Description,Debit,Credit\n2026-01-03,SALARY,,1500.00\n2026-01-04,GROCER,250.00,\n';
    const p = await importCsv(csv);
    eq(p.items.length, 2, 'two rows');
    eq(p.items[0].amount, 1500, 'an ordinary positive Credit cell still imports as money in');
    eq(p.items[1].amount, -250, 'an ordinary positive Debit cell still imports as money out');
  }

  Module._load = origLoad;
  console.log(`import-sign.test.cjs — ${checks} checks OK`);
}

main().catch(err => { Module._load = origLoad; console.error(err); process.exit(1); });
