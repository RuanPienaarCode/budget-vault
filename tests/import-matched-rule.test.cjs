'use strict';
/* The import review shows only a COUNT of auto-categorised rows ("180
   auto-categorised"), never WHICH rule fired on any one of them — even though
   matchRule (src/rules.js) already returns the winning rule, and
   rule-cleanup.js already uses that return value to name the rule covering a
   redundant one. When a rule is wrong the reader could not even name the
   thing they would need to open Data/Categorisation Rules.csv and fix.

   Fix: the import loop now calls matchRule directly (not autoCategorise,
   which only returns the category and throws the rule away), stashes the
   winning pattern on the item as `matchedPattern`, and renderImportReview
   prints it as a muted hint under the category cell — dropped once the
   reader has typed their own category over it (it.manual).

   Drives the REAL registerImport(ctx) — same minimal FakeEl/obsidian harness
   as tests/import-sign.test.cjs. Assertions read S.pendingImport.items
   directly for the parse-time half, and walk the FakeEl tree renderImport
   builds for the render-time half — the hint is real DOM the reader would
   actually see, not an internal field asserted on in isolation.

     node tests/import-matched-rule.test.cjs
*/

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

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

/* ------------------------------- fake DOM --------------------------------- */
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
  querySelectorAll(sel) {
    // Just enough for a flat '.cls' lookup over the tree — nothing here needs
    // more than that.
    const out = [];
    const cls = sel.replace('.', '');
    const walk = n => { if (n._cls && n._cls.has(cls)) out.push(n); (n.children || []).forEach(walk); };
    (this.children || []).forEach(walk);
    return out;
  }
  querySelector() { return null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  focus() {}
}
global.document = {
  createElement: tag => new FakeEl(tag),
  // Must actually CARRY the text — src/dom.js's el() wraps every plain-string
  // child in one of these, so an empty stand-in here makes every cell in the
  // fake table read as '' regardless of what was rendered into it.
  createTextNode: t => { const n = new FakeEl('#text'); n.textContent = t; return n; },
};

const registerImport = require('../src/views/import');
const { PROFILES } = require('../src/locale');

function makeCtx() {
  const stub = () => new FakeEl('div');
  const els = {}; // per-selector table so renderImportReview's many $() calls resolve to distinct nodes
  const $ = sel => (els[sel] ||= new FakeEl('div'));
  const S = {
    accounts: [], txFiles: {}, pendingImport: null,
    rules: [{ pattern: 'woolworths', category: 'Groceries' }],
  };
  const ctx = {
    S,
    $,
    app: {},
    money: v => String(v),
    toast: () => {},
    currentPeriod: () => '2026-01',
    periodRange: () => ({ start: '2026-01-01', end: '2026-01-31' }),
    periodTitle: () => 'January 2026',
    deferredCatSelect: (cur, onchange) => {
      const sel = new FakeEl('span');
      sel._cls.add('deferred-cat-select');
      sel.onchange = onchange;
      return sel;
    },
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
  const csv = 'Date,Description,Amount\n2026-01-05,WOOLWORTHS SANDTON,-249.99\n2026-01-06,UNKNOWN MERCHANT XYZ,-10.00\n';

  const ctx = makeCtx();
  registerImport(ctx);
  await ctx.handleStatementFile(makeFile(csv));
  const p = ctx.S.pendingImport;
  ok(p, 'the file parsed into a pending import');

  /* ---- parse-time: matchRule's winning pattern survives onto the item ---- */
  const woolies = p.items.find(i => i.desc.includes('WOOLWORTHS'));
  const unknown = p.items.find(i => i.desc.includes('UNKNOWN'));
  eq(woolies.cat, 'Groceries', 'the rule still resolves the category, same as autoCategorise would');
  eq(woolies.matchedPattern, 'woolworths', 'and the WINNING pattern is stashed on the item, not thrown away');
  eq(unknown.cat, '', 'a row with no matching rule gets no category');
  eq(unknown.matchedPattern, '', 'and carries no pattern to show either');

  /* ---- render-time: the hint is real DOM under the category cell ---- */
  ctx.renderImportReview();
  const table = ctx.$('#impTable');
  const rows = table.children.find(c => c.tagName === 'TBODY').children;
  const wooliesRow = rows.find(r => r.children.some(td => td.textContent.includes('WOOLWORTHS')));
  ok(wooliesRow, 'the Woolworths row rendered');
  const catCell = wooliesRow.children[4]; // Import|Date|Description|Amount|Category|Excl.
  ok(/matched/i.test(catCell.textContent) && catCell.textContent.includes('woolworths'),
    'the category cell names the rule that fired, so a wrong rule is findable from the review screen');

  const unknownRow = rows.find(r => r.children.some(td => td.textContent.includes('UNKNOWN')));
  const unknownCatCell = unknownRow.children[4];
  ok(!/matched/i.test(unknownCatCell.textContent), 'a row with no rule shows no hint');

  /* ---- the hint drops once the reader has typed their own category over it ---- */
  woolies.manual = true;
  ctx.renderImportReview();
  const rows2 = ctx.$('#impTable').children.find(c => c.tagName === 'TBODY').children;
  const wooliesRow2 = rows2.find(r => r.children.some(td => td.textContent.includes('WOOLWORTHS')));
  ok(!/matched/i.test(wooliesRow2.children[4].textContent),
    'once manually recategorised the hint no longer claims a rule explains the cell');

  console.log(`import-matched-rule.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
