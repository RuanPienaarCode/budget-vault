'use strict';
/* The drop zone accepts any file; only the file picker's `accept` attribute
   filtered. src/controller.js's wireDropZone hands e.dataTransfer.files[0]
   straight to ctx.handleStatementFile with no extension or MIME check, so
   dropping a bank statement PDF — the single most likely wrong file, since it
   sits right next to the CSV in Downloads — used to reach decodeStatement,
   fail column detection, and land the user on the manual mapper with a
   message ("this export isn't one the importer recognises") that is
   confidently wrong about what actually happened.

   handleStatementFile is the ONE function both the file picker and the drop
   zone funnel through (src/controller.js:900,749), so the check lives there.

   Drives the REAL registerImport(ctx) — same minimal FakeEl/obsidian harness
   as tests/import-sign.test.cjs.

     node tests/import-file-extension.test.cjs
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

const registerImport = require('../src/views/import');
const { PROFILES } = require('../src/locale');

function makeCtx() {
  const stub = () => new FakeEl('div');
  const S = { accounts: [], txFiles: {}, rules: [], pendingImport: null };
  const toasts = [];
  const ctx = {
    S,
    $: stub,
    app: {},
    money: v => String(v),
    toast: (msg, bad) => toasts.push({ msg, bad }),
    currentPeriod: () => '2026-01',
    periodRange: () => ({ start: '2026-01-01', end: '2026-01-31' }),
    periodTitle: () => 'January 2026',
    deferredCatSelect: () => new FakeEl('span'),
    locale: () => PROFILES.za,
    txSegment: s => s,
    accountForLabel: () => null,
    provide(obj) { Object.assign(ctx, obj); },
    _toasts: toasts,
  };
  return ctx;
}

function fakeFile(bytes, name) {
  return { name, async arrayBuffer() { return bytes; } };
}

async function main() {
  const CSV = 'Date,Description,Amount\n2026-01-02,Coffee,-30.00\n';
  const csvBytes = new TextEncoder().encode(CSV).buffer;

  /* ---- a non-statement file is refused, and clearly ---- */
  {
    const ctx = makeCtx();
    registerImport(ctx);
    // %PDF header bytes — not valid CSV/TSV text either way, but the point
    // is the REJECTION never even reaches decodeStatement/parseStatement.
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).buffer;
    await ctx.handleStatementFile(fakeFile(pdfBytes, 'FNB Statement.pdf'));
    eq(ctx.S.pendingImport, null, 'a PDF never reaches the review screen');
    eq(ctx._toasts.length, 1, 'exactly one toast — the rejection, not a downstream parse failure');
    ok(ctx._toasts[0].bad, 'and it is flagged as an error');
    ok(/CSV, TSV or TXT/.test(ctx._toasts[0].msg), 'the message says what IS accepted');
    ok(!/point it at the right columns/i.test(ctx._toasts[0].msg),
      'and is not the column-mapper message, which would be confidently wrong about what happened');
  }

  /* ---- an ordinary CSV still imports (the check is not overzealous) ---- */
  {
    const ctx = makeCtx();
    registerImport(ctx);
    await ctx.handleStatementFile(fakeFile(csvBytes, 'account_statement_2026.csv'));
    ok(ctx.S.pendingImport, 'a real CSV still reaches the review screen');
  }

  /* ---- TSV and TXT are accepted too, matching #fileInput's own accept list
     (src/shell.js) ---- */
  {
    for (const ext of ['tsv', 'txt']) {
      const ctx = makeCtx();
      registerImport(ctx);
      await ctx.handleStatementFile(fakeFile(csvBytes, `statement.${ext}`));
      ok(ctx.S.pendingImport, `.${ext} is accepted, same as the file picker advertises`);
    }
  }

  /* ---- case-insensitive, and a bare uppercase extension still counts ---- */
  {
    const ctx = makeCtx();
    registerImport(ctx);
    await ctx.handleStatementFile(fakeFile(csvBytes, 'Statement.CSV'));
    ok(ctx.S.pendingImport, 'an uppercase .CSV extension is still accepted');
  }

  console.log(`import-file-extension.test.cjs — ${checks} checks OK`);
}

main().catch(e => { console.error(e); process.exit(1); });
