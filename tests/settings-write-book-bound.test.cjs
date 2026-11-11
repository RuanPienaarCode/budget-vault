'use strict';
/* A setting lands in the book it was typed for, or nowhere (2026-11-11 audit,
   task 3 — Low, traced).

   Two faces of one gap, both of the shape "the book was asked for twice":

   1. main.js updateBudgetSettingsMd resolved Settings.md through the open
      book, AWAITED a read of it, and then wrote `'Settings.md'` through an io
      that resolves the open book again. A switch landing inside that read
      wrote book A's whole Settings.md — household, period, currency and the
      one key being patched — into book B. This io is main.js's own and has no
      loadedBook, so io.js's book-changed refusal could not fire.

   2. the settings tab debounces ten text fields by 800 ms. hide() cleared
      eight timers by name and missed three (_emergencyTimer, _milesTimer,
      _codeTimer), and Remove on a book row cleared none: a value typed for A,
      followed inside 800 ms by a switch or a Remove, patched whichever book
      was open when the timer fired.

   Pinned over the REAL BudgetPlugin (its own io, its own book seam) and the
   real BudgetSettingTab, in an in-memory vault holding two books:

     1. a switch during the updater's read: the patch lands in the book it was
        called for; the other book's Settings.md is byte-identical. Negative
        control: with no switch it writes the open book, as it always has.
     2. hide() leaves no debounced write pending — every field typed into,
        none fires afterwards (three used to).
     3. a keystroke is bound to the book open when it was typed: the open book
        changes before the timer fires, and each field's value lands in the
        book it was typed for, the other book untouched.
     4. Remove on the open book's row drops what was pending: nothing is
        written into the home book the tab falls back to. Removing ANOTHER
        book, or a Remove that is refused, leaves the keystroke to save.
     5. a book at the vault root: its Settings.md is patched in place. This is
        the one write that reaches a root book (io.js withinBudget refuses the
        rest until the vault watcher can see such a book), and it is safe
        there for the reason it is exempt from the stale refusal everywhere:
        the updater re-reads the file and patches one key.

     node tests/settings-write-book-bound.test.cjs */

const assert = require('assert');
const Module = require('module');
const H = require('./helpers/harness.cjs');
const { TFile, TFolder } = H.stubObsidian();
const base = require('obsidian');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ------------------------------- stand-ins -------------------------------- */
/* Obsidian's Setting, as far as the tab reaches: each control remembers the
   handler it was given, keyed by the row's name, so a test can type into it. */
class FakeEl {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.attrs = {}; this.value = ''; this._text = ''; }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  setText(v) { this.textContent = v; }
  appendText() { return this; }
  empty() { this.children = []; this._text = ''; }
  createEl(tag, o = {}) { const n = new FakeEl(tag); if (o.text != null) n._text = String(o.text); this.children.push(n); return n; }
  createDiv() { return this.createEl('div'); }
  createSpan() { return this.createEl('span'); }
  appendChild(n) { this.children.push(n); return n; }
  addClass() {} removeClass() {} toggleClass() {} hasClass() { return false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
}
const NOTICES = [];
class Notice { constructor(m) { NOTICES.push(String(m)); } }
class Setting {
  constructor(container) {
    this.row = { name: '', controls: [] };
    this.descEl = new FakeEl('div');
    (container.rows = container.rows || []).push(this.row);
    const empty = container.empty.bind(container);
    container.empty = () => { container.rows = []; empty(); };
  }
  setName(v) { this.row.name = String(v); return this; }
  setDesc() { return this; }
  setHeading() { return this; }
  _control(kind, cb) {
    const el = new FakeEl('input');
    const c = { kind, inputEl: el, selectEl: el, toggleEl: el, buttonEl: el, text: '',
      setPlaceholder() { return c; }, setValue(v) { el.value = v == null ? '' : String(v); return c; }, addOption() { return c; },
      setButtonText(t) { c.text = t; return c; }, setCta() { return c; }, setWarning() { return c; },
      onChange(fn) { c.change = fn; return c; }, onClick(fn) { c.click = fn; return c; } };
    this.row.controls.push(c);
    cb(c);
    return this;
  }
  addText(cb) { return this._control('text', cb); }
  addDropdown(cb) { return this._control('dropdown', cb); }
  addToggle(cb) { return this._control('toggle', cb); }
  addButton(cb) { return this._control('button', cb); }
}
class Plugin {
  constructor() { this.saved = []; this.stored = {}; }
  async loadData() { return JSON.parse(JSON.stringify(this.stored)); }
  async saveData(d) { const copy = JSON.parse(JSON.stringify(d)); this.saved.push(copy); this.stored = copy; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new FakeEl('div'); } }
class Modal { constructor(app) { this.app = app; this.contentEl = new FakeEl('div'); this.titleEl = new FakeEl('div'); } open() {} close() {} }
const prevLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { ...base, Notice, Modal, Setting, Plugin, PluginSettingTab, TFile, TFolder };
  return prevLoad.call(this, req, ...rest);
};
global.document = { createElement: tag => new FakeEl(tag) };
global.window = { matchMedia: () => ({ matches: false }), open() {} };

const i18n = require('../src/i18n');
i18n.setLanguage('en');
const BudgetPlugin = require('../src/main');
const { BudgetSettingTab } = require('../src/settings-tab');

/* ------------------------------ the clock --------------------------------- */
/* The tab's debounce is 800 ms. Timers that long are held here and fired by
   hand; anything shorter (io.js closes its write window on a 0 ms timer) is
   the real clock's, so the code under test runs as it does in the app. */
const realSet = global.setTimeout, realClear = global.clearTimeout;
const held = new Map();
let nextId = 1;
global.setTimeout = (fn, ms, ...a) => {
  if (!(ms >= 100)) return realSet(fn, ms, ...a);
  const id = { held: nextId++ };
  held.set(id, fn);
  return id;
};
global.clearTimeout = id => { if (id && typeof id === 'object' && 'held' in id) held.delete(id); else realClear(id); };
const tick = () => new Promise(r => realSet(r, 0));
/* Run every held timer and let what it started finish. */
async function fire() {
  const fns = [...held.values()];
  held.clear();
  for (const fn of fns) await fn();
  await tick();
}

/* ------------------------------- the vault -------------------------------- */
const HOME = 'Budget', BETA = 'Clients/Beta', ACME = 'Clients/Acme';
const LIST = [{ folder: HOME, label: 'Household' }, { folder: BETA, label: 'Beta' }, { folder: ACME, label: 'Acme' }];
const SETTINGS = name => `---\nmonth_start_day: 25\nperiod_days: 14\nperiod_anchor: 2026-08-07\ncurrency: "R"\ncountry: za\nhousehold: "${name}"\n---\n\n# Budget Settings\n`;
const FILES = () => ({
  [`${HOME}/Settings.md`]: SETTINGS('The Smiths'),
  [`${HOME}/Categories/Groceries.md`]: '---\ntype: food\n---\n',
  [`${BETA}/Settings.md`]: SETTINGS('Beta Ltd'),
  [`${BETA}/Categories/Consulting.md`]: '---\ntype: income\n---\n',
  [`${ACME}/Settings.md`]: SETTINGS('Acme Ltd'),
  [`${ACME}/Categories/Software.md`]: '---\ntype: expense\n---\n',
});
const OPEN_BOOK_KEY = require('../src/books').OPEN_BOOK_KEY;

/* A real plugin on one device. `open(folder)` is the per-device choice moving
   by any route — the top bar, a sibling plugin's setActiveBook, a sync — and
   nothing else: no reload, as in the window the audit traced. */
async function world(openFolder = null, { home = HOME, list = LIST, files = FILES() } = {}) {
  const vault = H.makeVault(files);
  vault.configDir = '.obsidian';
  const kv = {};
  const p = new BudgetPlugin();
  p.stored = { budgetFolder: home, onboarded: true, books: list.map(b => ({ ...b })) };
  p.budgetUnlocked = true;
  p.app = {
    vault,
    workspace: { getLeavesOfType: () => [] },
    loadLocalStorage: k => (k in kv ? kv[k] : null),
    saveLocalStorage: (k, v) => { if (v === null) delete kv[k]; else kv[k] = v; },
    metadataCache: { getFileCache: () => null },
  };
  p.forEachView = fn => fn({ hasDirty: () => false, reload: async () => {}, applyBooks() {}, applyLanguage() {} });
  await p.loadSettings();
  const open = folder => { if (folder === null) delete kv[OPEN_BOOK_KEY]; else kv[OPEN_BOOK_KEY] = folder; };
  if (openFolder) open(openFolder);
  const text = folder => vault._store.get(`${folder}/Settings.md`);
  return { p, vault, open, text };
}
/* The tab, drawn, with its Settings.md half read (renderMdSettings is async
   and display() does not wait for it). `type(name, value)` is a keystroke
   settling in the field of the row called `name`. */
async function tabOn(w) {
  const tab = new BudgetSettingTab(w.p.app, w.p);
  tab.display();
  await tick(); await tick();
  const rows = () => {
    const out = [];
    const walk = el => { for (const r of el.rows || []) out.push(r); for (const c of el.children || []) walk(c); };
    walk(tab.containerEl);
    return out;
  };
  const control = (name, kind) => {
    const row = rows().find(r => r.name === name);
    assert.ok(row, `the tab draws a "${name}" row`);
    const c = row.controls.find(x => x.kind === kind);
    assert.ok(c, `…with a ${kind}`);
    return c;
  };
  return { tab, rows, type: (name, value) => control(name, 'text').change(value), control };
}

const HOUSEHOLD = i18n.t('settings.household.name');
/* Every debounced text field: the row's name, what is typed, and the line the
   write leaves in Settings.md. */
const FIELDS = [
  [i18n.t('settings.household.name'), 'Typed', 'household: "Typed"'],
  ['Household members', 'Alex, Sam', 'owners: "Alex, Sam"'],
  ['Category groups', 'treats', 'groups: "treats"'],
  [i18n.t('settings.monthStart.name'), '3', 'month_start_day: 3'],
  ['Overspend lag', '4', 'overspend_lag: 4'],
  ['Emergency fund target', '7', 'emergency_target_months: 7'],
  [i18n.t('settings.milesRate.name'), '0.25', 'miles_rate: 0.25'],
  [i18n.t('settings.anchor.name'), '2026-08-21', 'period_anchor: 2026-08-21'],
  [i18n.t('settings.currency.name'), '€', 'currency: "€"'],
  [i18n.t('settings.currencyCode.name'), 'eur', 'currency_code: "EUR"'],
];

(async () => {
  /* ---- 1. the updater: a switch during its read ---- */
  {
    const w = await world();
    const beta = w.text(BETA);
    let release, reached;
    const gate = new Promise(r => { release = r; });
    const reading = new Promise(r => { reached = r; });
    const realRead = w.vault.read;
    w.vault.read = async f => { const t = await realRead(f); reached(); await gate; return t; };
    const writing = w.p.updateBudgetSettingsMd('household', '"Typed for home"');   // the household's book is open
    await reading;
    w.open(BETA);                                                                 // …and stops being, mid-read
    eq(w.p.activeFolder(), BETA, 'the open book moved while the updater was reading');
    release();
    await writing;
    eq(w.text(BETA), beta, 'T3: the other book\'s Settings.md is byte-identical — one book\'s settings are never written into another');
    ok(/household: "Typed for home"/.test(w.text(HOME)), 'T3: the patch landed in the book it was called for');
    ok(/month_start_day: 25/.test(w.text(HOME)) && /# Budget Settings/.test(w.text(HOME)), 'T3: …patched, not rebuilt');
  }
  {
    const w = await world(BETA);
    const home = w.text(HOME);
    await w.p.updateBudgetSettingsMd('household', '"Typed for Beta"');
    ok(/household: "Typed for Beta"/.test(w.text(BETA)), 'NEGATIVE CONTROL: with no folder named and no switch, the OPEN book is patched, as before');
    eq(w.text(HOME), home, '…and only that one');
    await w.p.updateBudgetSettingsMd('household', '"Named"', HOME);
    ok(/household: "Named"/.test(w.text(HOME)) && /household: "Typed for Beta"/.test(w.text(BETA)), 'a named folder still wins over the open book (the wizard\'s path)');
  }

  /* ---- 2. hide() leaves nothing pending ---- */
  {
    const w = await world();
    const before = [w.text(HOME), w.text(BETA)];
    const t = await tabOn(w);
    for (const [name, value] of FIELDS) t.type(name, value);
    eq(held.size, FIELDS.length, `every debounced field is waiting on its 800 ms (${FIELDS.length})`);
    t.tab.hide();
    eq(held.size, 0, 'T3: hide() cancels every one of them — none is left to fire against a closed tab');
    await fire();
    eq([w.text(HOME), w.text(BETA)], before, 'T3: and nothing is written after the tab has closed');
  }

  /* ---- 3. a keystroke belongs to the book that was open when it was typed ---- */
  for (const [name, value, line] of FIELDS) {
    const w = await world();
    const beta = w.text(BETA);
    const t = await tabOn(w);
    t.type(name, value);                 // typed for the household
    w.open(BETA);                        // the open book changes inside the 800 ms
    await fire();
    eq(w.text(BETA), beta, `T3: "${name}" typed for the household is not written into the book opened since`);
    ok(w.text(HOME).includes(line), `T3: …it lands in the household's Settings.md (${line})`);
    held.clear();
  }
  {
    /* Control: no switch, so the field writes the open book — and the debounce
       still collapses a run of keystrokes into the last one. */
    const w = await world(BETA);
    const home = w.text(HOME);
    const t = await tabOn(w);
    t.type(HOUSEHOLD, 'B');
    t.type(HOUSEHOLD, 'Be');
    t.type(HOUSEHOLD, 'Beta & Co');
    eq(held.size, 1, 'a run of keystrokes in one field is one pending write');
    await fire();
    ok(/household: "Beta & Co"/.test(w.text(BETA)), 'which writes the last value typed, into the open book');
    eq(w.text(HOME), home, 'and leaves the other alone');
    held.clear();
  }

  /* ---- 4. Remove on the open book's row ---- */
  {
    const w = await world(BETA);
    const home = w.text(HOME), beta = w.text(BETA);
    const t = await tabOn(w);
    t.type(i18n.t('settings.currencyCode.name'), 'usd');   // typed into Beta's tab
    t.type('Emergency fund target', '9');
    const remove = t.rows().find(r => r.name === 'Beta').controls.find(c => c.kind === 'button' && c.text === i18n.t('settings.books.remove'));
    ok(remove, 'the open book\'s row offers Remove');
    const r = await remove.click();
    eq(r && r.ok, true, 'the book is removed');
    eq(w.p.activeFolder(), HOME, '…and the home book is open in its place');
    eq(held.size, 0, 'T3: what was typed for the removed book is no longer pending');
    await fire();
    eq(w.text(HOME), home, 'T3: nothing typed for the removed book is written into the home book');
    eq(w.text(BETA), beta, 'and the removed book\'s own file is as it was — removing forgets the entry, it writes nothing');
  }
  {
    /* Another book's row: the book on screen stays open, so what was typed
       into its fields is still wanted — and still lands in it. */
    const w = await world(BETA);
    const home = w.text(HOME), acme = w.text(ACME);
    const t = await tabOn(w);
    t.type(HOUSEHOLD, 'Beta, renamed');
    const remove = t.rows().find(r => r.name === 'Acme').controls.find(c => c.kind === 'button' && c.text === i18n.t('settings.books.remove'));
    const r = await remove.click();
    eq(r && r.ok, true, 'another book is removed');
    eq(w.p.activeFolder(), BETA, '…and the book on screen is still open');
    eq(held.size, 1, 'T3: removing a book the reader was not typing into leaves the keystroke pending');
    await fire();
    ok(/household: "Beta, renamed"/.test(w.text(BETA)), 'T3: and it saves into the book it was typed for');
    eq([w.text(HOME), w.text(ACME)], [home, acme], 'the other two books untouched');
    held.clear();
  }
  {
    /* A refused Remove (a page has unsaved edits) changes no book, so what was
       typed is still wanted. */
    const w = await world(BETA);
    w.p.forEachView = fn => fn({ hasDirty: () => true, reload: async () => {}, applyBooks() {} });
    const t = await tabOn(w);
    t.type(HOUSEHOLD, 'Still Beta');
    const remove = t.rows().find(r => r.name === 'Beta').controls.find(c => c.kind === 'button' && c.text === i18n.t('settings.books.remove'));
    const r = await remove.click();
    eq(r && r.ok, false, 'a Remove refused over unsaved edits…');
    eq(held.size, 1, '…leaves the pending keystroke alone');
    await fire();
    ok(/household: "Still Beta"/.test(w.text(BETA)), 'which then saves into the book it was typed for');
    held.clear();
  }

  /* ---- 5. a book at the vault root ---- */
  {
    const w = await world(null, { home: '/', list: [], files: {
      'Settings.md': SETTINGS('At the root'),
      'Categories/Groceries.md': '---\ntype: food\n---\n',
    } });
    const before = [...w.vault._store.keys()].sort();
    await w.p.updateBudgetSettingsMd('household', '"Root, renamed"');
    ok(/household: "Root, renamed"/.test(w.vault._store.get('Settings.md')), 'T3: a root book\'s Settings.md is patched where it is');
    ok(/month_start_day: 25/.test(w.vault._store.get('Settings.md')), '…one key, the rest as it was');
    eq([...w.vault._store.keys()].sort(), before, '…and no second Settings.md appears anywhere');
    const t = await tabOn(w);
    t.type(i18n.t('settings.currencyCode.name'), 'zar');
    await fire();
    ok(/currency_code: "ZAR"/.test(w.vault._store.get('Settings.md')), 'T3: and the settings tab\'s fields save there too');
    eq([...w.vault._store.keys()].sort(), before, 'still one file');
    held.clear();
  }

  global.setTimeout = realSet; global.clearTimeout = realClear;
  console.log(`PASS settings-write-book-bound (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
