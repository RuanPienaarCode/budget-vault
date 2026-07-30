'use strict';
/* Shared bare-node test harness.

   Two things live here:

     stubObsidian()  — swaps the `obsidian` module for a stub before any src/
                       file is required. src/ imports it for setIcon, TFile,
                       TFolder, normalizePath and the Modal/View base classes.

     makeCtx(files)  — an in-memory vault plus the slice of `ctx` that the
                       register* modules actually consume, so a test can run
                       the REAL registerLoad / registerTransactions / … instead
                       of a hand-written mirror of them.

   Why this exists: the round-trip tests used to drive the real serializer but
   parse with a copy of the loader pasted into the test file. That guards the
   serializer against a COPY of the loader, not against the loader — change a
   column in load.js alone and every test still passes while every save
   silently corrupts data. Driving the real loadVault closes that gap for
   every file type at once.

   The vault is a plain { 'path/to/file.md': 'contents' } map. Paths are
   relative to the vault root, and the budget folder defaults to 'Budget'. */

const Module = require('module');
const path = require('path');

/* ------------------------------ obsidian stub ---------------------------- */
class TFile {
  constructor(p, vault) {
    this.path = p;
    this.vault = vault;
    const base = p.split('/').pop();
    const dot = base.lastIndexOf('.');
    this.basename = dot > 0 ? base.slice(0, dot) : base;
    this.extension = dot > 0 ? base.slice(dot + 1) : '';
    this.name = base;
  }
}
class TFolder {
  constructor(p) {
    this.path = p;
    this.name = p.split('/').pop();
    this.children = [];
  }
}

let stubbed = false;
function stubObsidian() {
  if (stubbed) return { TFile, TFolder };
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'obsidian') {
      return {
        setIcon() {},
        // Mirrors the real one closely enough for path tests: backslashes to
        // slashes, collapsed and trimmed slashes, NFC. See src/util.js safeSeg
        // for why the NFC step matters.
        normalizePath: p => String(p).replace(/\\/g, '/').replace(/\/+/g, '/')
          .replace(/^\/|\/$/g, '').normalize('NFC'),
        Notice: class {},
        Modal: class {},
        Setting: class {},
        PluginSettingTab: class {},
        ItemView: class {},
        Plugin: class {},
        TFile,
        TFolder,
      };
    }
    return origLoad.call(this, request, ...rest);
  };
  stubbed = true;
  return { TFile, TFolder };
}

/* ------------------------------ fake vault ------------------------------- */
function makeVault(files) {
  const store = new Map(Object.entries(files));
  const nodes = new Map();   // path -> TFile | TFolder

  const vault = {
    /* Mirrors Obsidian: cachedRead and read return the same thing here. */
    async cachedRead(f) { return store.get(f.path); },
    async read(f) { return store.get(f.path); },
    async modify(f, content) { store.set(f.path, content); },
    async create(p, content) { store.set(p, content); rebuild(); return nodes.get(p); },
    async createFolder(p) { store.set(p + '/.folder', ''); rebuild(); },
    async modifyBinary(f, data) { store.set(f.path, data); },
    async createBinary(p, data) { store.set(p, data); rebuild(); },
    async trash(f) { store.delete(f.path); rebuild(); },
    getAbstractFileByPath(p) { return nodes.get(p) || null; },
    // Typed getters (Obsidian 1.5+) — src/ prefers these over the
    // getAbstractFileByPath + instanceof dance. Same null-on-miss contract,
    // plus null when something of the OTHER kind sits at the path.
    getFileByPath(p) { const n = nodes.get(p); return n instanceof TFile ? n : null; },
    getFolderByPath(p) { const n = nodes.get(p); return n instanceof TFolder ? n : null; },
    _store: store,
  };

  function rebuild() {
    nodes.clear();
    const folders = new Map();
    const ensureFolder = p => {
      if (!p) return null;
      if (!folders.has(p)) {
        const fo = new TFolder(p);
        folders.set(p, fo);
        nodes.set(p, fo);
        const parent = ensureFolder(p.split('/').slice(0, -1).join('/'));
        if (parent) parent.children.push(fo);
      }
      return folders.get(p);
    };
    for (const p of store.keys()) {
      const dir = p.split('/').slice(0, -1).join('/');
      const parent = ensureFolder(dir);
      if (p.endsWith('/.folder')) continue;   // folder marker, not a real file
      const f = new TFile(p, vault);
      nodes.set(p, f);
      if (parent) parent.children.push(f);
    }
  }
  rebuild();
  return vault;
}

/* --------------------------------- ctx ----------------------------------- */
/* Builds the ctx a register* module sees, wired to an in-memory vault. Pass
   `files` as { 'Budget/Categories/Food.md': '...' }. Returns the ctx; call
   registerIo/registerPeriod/registerLoad/... on it in the same order
   controller.js does. */
function makeCtx(files = {}, { budgetFolder = 'Budget', settings = {} } = {}) {
  const vault = makeVault(files);
  const dirtyChecks = [];
  const toasts = [];

  // $ / $$ return inert stand-ins: the register* functions only touch the DOM
  // inside render*/save* handlers, which these tests do not call.
  // empty() is Obsidian's own Element augmentation, which src/ now uses in
  // place of `innerHTML = ''` — stub it so a render path reaching this element
  // fails loudly on real logic rather than on a missing DOM helper.
  const stubEl = { disabled: false, textContent: '', value: '', checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    empty() {}, append() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, focus() {} };

  const ctx = {
    vault,
    app: { vault },
    plugin: { settings: { budgetFolder }, _lastWrite: 0 },
    S: {
      settings: { month_start_day: 23, currency: 'R', country: 'za', ...settings },
      categories: [], accounts: [], budgets: {}, budgetMeta: {}, txFiles: {},
      rules: [], owed: [], services: [], tax: {}, taxYear: null, period: null,
    },
    $: () => stubEl,
    $$: () => [],
    toast: (msg, bad) => toasts.push({ msg, bad }),
    money: v => String(v),
    locale: () => require('../../src/locale').PROFILES.za,
    registerDirty: fn => dirtyChecks.push(fn),
    provide(obj) {
      for (const k of Object.keys(obj)) {
        if (k in ctx) throw new Error(`ctx.${k} already defined`);
      }
      Object.assign(ctx, obj);
    },
    _toasts: toasts,
    _dirty: () => dirtyChecks.some(fn => fn()),
  };
  return ctx;
}

/* Registers io + period + load onto a ctx and runs the real loadVault. */
async function loadInto(ctx) {
  require('../../src/io')(ctx);
  require('../../src/period')(ctx);
  require('../../src/load')(ctx);
  await ctx.loadVault();
  return ctx.S;
}

module.exports = { stubObsidian, makeVault, makeCtx, loadInto, TFile, TFolder };
