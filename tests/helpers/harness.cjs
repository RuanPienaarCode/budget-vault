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
        // slashes, collapsed and trimmed slashes, NFC. See src/vault-path.js safeSeg
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
    /* Obsidian's trash takes a TAbstractFile, and trashing a FOLDER takes
       everything under it with it. Deleting only the exact path left the month
       files sitting in the store while the code under test believed them
       gone — so a test could assert that deleting an account's Transactions/
       folder "worked" against a vault that still held every row. */
    async trash(f) {
      for (const p of [...store.keys()]) {
        if (p === f.path || p.startsWith(f.path + '/')) store.delete(p);
      }
      rebuild();
    },
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
  const saveButtons = [];
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
    // A no-op by default so a view calling plugin.saveSettings() (the chart
    // range pills, the export-folder setting, …) does not throw "not a
    // function" in a test that never means to exercise the failure path.
    // Tests that DO want to force a rejection reassign this property
    // directly — it is a plain object, not a class method, so `ctx.plugin
    // .saveSettings = async () => { throw … }` is all that is needed.
    plugin: { settings: { budgetFolder }, _lastWrite: 0, saveSettings: async () => {} },
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
    /* Mirrors controller.js: a view registers the Save button it owns and gets
       back the disable() it calls after a save. Tracked here so _saveButtons
       can assert that every editable view registered one — that list is what
       reloadFromDisk clears, and the whole point of the factory is that it can
       no longer fall behind the views. */
    registerSaveButton(sel) {
      saveButtons.push(sel);
      return () => { const b = ctx.$(sel); if (b) b.disabled = true; };
    },
    dirtyFlag(stateKey, saveSel) {
      const disable = ctx.registerSaveButton(saveSel);
      dirtyChecks.push(() => !!ctx.S[stateKey]);
      return {
        mark: () => { ctx.S[stateKey] = true; const b = ctx.$(saveSel); if (b) b.disabled = false; },
        clear: () => { ctx.S[stateKey] = false; disable(); },
      };
    },
    provide(obj) {
      for (const k of Object.keys(obj)) {
        if (k in ctx) throw new Error(`ctx.${k} already defined`);
      }
      Object.assign(ctx, obj);
    },
    _toasts: toasts,
    _dirty: () => dirtyChecks.some(fn => fn()),
    _saveButtons: saveButtons,
  };
  return ctx;
}

/* Registers io + period + load + notes onto a ctx and runs the real loadVault.

   views/notes.js is in the list because it is not only a page: it publishes
   noteButton(), the chip five OTHER views render beside an account, debt,
   asset, service or owed name. Leaving it out made every test that renders one
   of those pages throw "ctx.noteButton is not a function" — the right failure
   for a real wiring break, and the wrong one for a test that never meant to
   opt out of it. Registering it here lets those call sites stay direct
   (`ctx.noteButton(...)`) rather than defensive, so a genuine break in the app
   still fails loudly. */
async function loadInto(ctx) {
  require('../../src/io')(ctx);
  require('../../src/period')(ctx);
  // After period (whose helpers it destructures at register time), before the
  // views — the same slot controller.js gives it. The dashboard's trend chart
  // and comparison column read these off ctx.
  require('../../src/trend-math')(ctx);
  require('../../src/load')(ctx);
  require('../../src/views/notes')(ctx);
  await ctx.loadVault();
  return ctx.S;
}

module.exports = { stubObsidian, makeVault, makeCtx, loadInto, TFile, TFolder };
