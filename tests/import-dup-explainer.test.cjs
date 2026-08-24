'use strict';
/* Exact duplicates are the ONE decision on the import review screen the
   reader cannot override — a `dup` badge instead of a checkbox, with the
   stats line only ever giving a bare count ("3 duplicates skipped") and no
   explanation. For a statement the reader chose on purpose, a row that
   silently doesn't show up reads as data loss, not as the plugin correctly
   recognising rows it already has.

   Fix: when dupes > 0, the stats line says the skipped rows are already in
   the vault and points at the Transactions page — nothing about the dedupe
   DECISION changes (an exact duplicate still cannot be ticked; that gate is
   sound, see tests/import-dedupe.test.cjs), only whether the reader is told
   why.

   Drives the REAL registerImport(ctx): a fixture Transactions file is
   pre-seeded with a row an incoming statement line exactly matches (same
   date/desc/amount/account — src/dedupe.js's txKey), so flagItems marks it
   `dup` for real, not by asserting on a mocked return value.

     node tests/import-dup-explainer.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

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
  createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; },
};

const registerImport = require('../src/views/import');
const { PROFILES } = require('../src/locale');

function makeCtx(existingRow) {
  const els = {};
  const $ = sel => (els[sel] ||= new FakeEl('div'));
  const cheque = { label: 'Cheque', month: '2026-01', rows: existingRow ? [existingRow] : [] };
  const S = { accounts: [], txFiles: { Cheque: cheque }, pendingImport: null, rules: [] };
  const ctx = {
    S,
    $,
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

async function main() {
  const csv = 'Date,Description,Amount\n2026-01-05,WOOLWORTHS SANDTON,-249.99\n2026-01-06,NEW MERCHANT XYZ,-10.00\n';

  /* ---- one row is an exact duplicate of what's already on disk ---- */
  {
    const ctx = makeCtx({ date: '2026-01-05', desc: 'WOOLWORTHS SANDTON', amount: -249.99, cat: '', excluded: false, note: '' });
    registerImport(ctx);
    await ctx.handleStatementFile(makeFile(csv));
    // Forced to the account the fixture row lives under — the review's own
    // account <select> has no real DOM behind it in this harness (see
    // makeCtx), so its default selection can't be trusted the way commitImport's
    // own real one is; renderImportReview re-evaluates flagItems fresh either way.
    ctx.S.pendingImport.label = 'Cheque';
    ctx.renderImportReview();

    const woolies = ctx.S.pendingImport.items.find(i => i.desc.includes('WOOLWORTHS'));
    ok(woolies.dup, 'the fixture row IS recognised as an exact duplicate — proves the rest of this test means something');

    const stats = ctx.$('#impStats').textContent;
    ok(/1 duplicates? skipped/.test(stats), 'the bare count is still there');
    ok(/already in the vault/i.test(stats), 'and now says WHY: the row already exists');
    ok(/Transactions/.test(stats), 'and points at where to go look for it');
  }

  /* ---- nothing duplicate: no explanatory clause, no false claim ---- */
  {
    const ctx = makeCtx(null);
    registerImport(ctx);
    await ctx.handleStatementFile(makeFile(csv));
    ctx.S.pendingImport.label = 'Cheque';
    ctx.renderImportReview();

    const stats = ctx.$('#impStats').textContent;
    ok(/0 duplicates skipped/.test(stats), 'nothing collided this time');
    ok(!/already in the vault/i.test(stats), 'so the explanatory clause is not printed when it would not apply');
  }

  console.log(`import-dup-explainer.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
