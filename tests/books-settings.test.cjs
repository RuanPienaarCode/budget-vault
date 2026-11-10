'use strict';
/* Settings → Books: add (through the setup wizard), relabel, remove — and the
   wrong-book trap in the wizard itself (ADR 0009 §5, issue #168).

   Every failure this file exists for writes one book's data into another
   book's files, or loses a book a reader is keeping, and none of them shows
   until two books exist on a real device. So it drives the REAL main.js
   (loadSettings, saveData, addBook, removeBook, switchBook, the real
   updateBudgetSettingsMd and its io writers) and the REAL OnboardingWizard
   over an in-memory vault, and pins:

     1. validateNewBook, case by case: empty, the vault root, "..", hidden and
        config folders, a duplicate in any spelling or case, a folder inside
        another book (the home book included, and every folder when the home
        book IS the root), a folder containing one — and NEGATIVE CONTROLS: a
        sibling, and a folder whose name merely starts like a book's;
     2. the pure list edits: the first add seeds the home book, an add appends,
        relabel touches the label only, remove refuses the home book, forgets
        nothing else, collapses to [] at the last non-home book, and none of
        them mutates the list it was handed;
     3. add round-trip through main.js: data.json holds the home book and the
        new one, budgetFolder unchanged; a fresh plugin loading that data.json
        has the list intact, and on this device the added book is still open;
     4. the wizard in add-a-book mode, with a CLIENT's book open on this device:
          - create: only the new folder is written; every byte of the home
            book and the open book is unchanged; budgetFolder byte-identical;
            the list gains the book; the device opens it;
          - an existing budget: one screen, no questions, and NOTHING is
            written — its Settings.md is byte-identical — then registered and
            opened;
          - cancelled: nothing added, nothing written, `onboarded` untouched;
          - an overlapping folder is refused before a single file is created;
     5. THE WRONG-BOOK TRAP, closed: the setup wizard (normal mode) run with a
        client's book open writes the folder it was GIVEN — X's Settings.md is
        patched, the open book's is byte-identical, budgetFolder becomes X, and
        the device switches to the home book it just set up. NEGATIVE CONTROL:
        updateBudgetSettingsMd() without a folder, same state, writes the OPEN
        book's file — the trap is real, and only the explicit folder avoids
        it. A source pin holds every wizard Settings.md write to passing it;
     6. remove: forgets the entry and calls NO vault API (a spy vault and a
        source grep); removing the open book switches this device to the home
        book first, clearing the stored choice; with unsaved edits it is
        refused and nothing moves; the home book cannot be removed; removing
        down to the home book leaves single-book mode and no `books` key;
     7. the settings tab's rows, on both halves: single-book shows the home
        book alone with no Relabel and no Remove; with a list, the home book
        has no Remove and every other book has both; the Add dialog refuses an
        overlapping folder inline and hands a good one to the wizard.

     node tests/books-settings.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const H = require('./helpers/harness.cjs');
const { TFile, TFolder } = H.stubObsidian();
const base = require('obsidian');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* --------------------------------- DOM ---------------------------------- */
/* Obsidian's element helpers, as far as the wizard, the settings tab and the
   two dialogs reach — the same shape tests/onboarding-render.test.cjs uses. */
class FakeEl {
  constructor(tag, o = {}) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this._cls = new Set();
    this._text = '';
    this.value = '';
    if (o.text != null) this._text = String(o.text);
    if (o.cls) for (const c of [].concat(o.cls)) String(c).split(/\s+/).filter(Boolean).forEach(x => this._cls.add(x));
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  setText(v) { this.textContent = v; }
  appendText(v) { this.children.push({ textContent: String(v), children: [] }); return this; }
  empty() { this.children = []; this._text = ''; }
  createEl(tag, o = {}) { const n = new FakeEl(tag, o); this.children.push(n); return n; }
  createDiv(o) { return this.createEl('div', typeof o === 'string' ? { cls: o } : (o || {})); }
  createSpan(o) { return this.createEl('span', typeof o === 'string' ? { cls: o } : (o || {})); }
  appendChild(n) { this.children.push(n); return n; }
  addClass(...c) { c.forEach(x => this._cls.add(x)); }
  removeClass(...c) { c.forEach(x => this._cls.delete(x)); }
  toggleClass(c, on) { if (on) this._cls.add(c); else this._cls.delete(c); }
  hasClass(c) { return this._cls.has(c); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener() {}
}
global.document = { createElement: tag => new FakeEl(tag) };
global.window = { matchMedia: () => ({ matches: false }), setTimeout: (fn, ms) => setTimeout(fn, ms) };
const all = (el, pred, out = []) => {
  for (const c of el.children || []) if (c instanceof FakeEl) { if (pred(c)) out.push(c); all(c, pred, out); }
  return out;
};
const byClass = (el, cls) => all(el, e => e.hasClass(cls));
const textOf = (el, cls) => byClass(el, cls).map(e => e.textContent).join(' | ');
const buttons = el => all(el, e => e.tagName === 'BUTTON');

/* ------------------------------ obsidian -------------------------------- */
const NOTICES = [];
class Notice { constructor(m) { NOTICES.push(String(m)); } }
class Modal {
  constructor(app) { this.app = app; this.contentEl = new FakeEl('div'); this.titleEl = new FakeEl('div'); this.closed = false; }
  open() { Modal.opened.push(this); this.onOpen(); }
  close() { this.closed = true; this.onClose(); }
}
Modal.opened = [];
class Setting {
  constructor(container) {
    this.settingEl = new FakeEl('div', { cls: 'setting-item' });
    this.nameEl = this.settingEl.createDiv({ cls: 'setting-item-name' });
    this.descEl = this.settingEl.createDiv({ cls: 'setting-item-description' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    container.appendChild(this.settingEl);
  }
  setName(v) { this.nameEl.setText(v); return this; }
  setDesc(v) { this.descEl.setText(v); return this; }
  setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
  addText(cb) {
    const el = this.controlEl.createEl('input');
    const c = {
      inputEl: el,
      setPlaceholder(v) { el.attrs.placeholder = v; return c; },
      setValue(v) { el.value = v == null ? '' : String(v); return c; },
      onChange(fn) { el._onChange = fn; return c; },
    };
    cb(c); return this;
  }
  addDropdown(cb) {
    const el = this.controlEl.createEl('select');
    const c = { selectEl: el, addOption() { return c; }, setValue(v) { el.value = String(v); return c; }, onChange(fn) { el._onChange = fn; return c; } };
    cb(c); return this;
  }
  addToggle(cb) {
    const el = this.controlEl.createEl('input');
    const c = { toggleEl: el, setValue() { return c; }, onChange(fn) { el._onChange = fn; return c; } };
    cb(c); return this;
  }
  addButton(cb) {
    const el = this.controlEl.createEl('button');
    const c = {
      buttonEl: el,
      setButtonText(t) { el.textContent = t; return c; },
      setCta() { el.addClass('mod-cta'); return c; },
      setWarning() { el.addClass('mod-warning'); return c; },
      onClick(fn) { el._onClick = fn; return c; },
    };
    cb(c); return this;
  }
}
class Plugin {
  constructor() { this.saved = []; this.stored = {}; }
  async loadData() { return JSON.parse(JSON.stringify(this.stored)); }
  async saveData(d) { const copy = JSON.parse(JSON.stringify(d)); this.saved.push(copy); this.stored = copy; }
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = new FakeEl('div'); } }
const prevLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { ...base, Notice, Modal, Setting, Plugin, PluginSettingTab, TFile, TFolder };
  return prevLoad.call(this, req, ...rest);
};

const i18n = require('../src/i18n');
i18n.setLanguage('en');
const books = require('../src/books');
const { validateNewBook, bookListAdd, bookListRelabel, bookListRemove, OPEN_BOOK_KEY } = books;
const BudgetPlugin = require('../src/main');
const { OnboardingWizard } = require('../src/onboarding');
const { BudgetSettingTab } = require('../src/settings-tab');
const { AddBookModal } = require('../src/book-settings');

const HOME = 'Budget';
const BETA = 'Clients/Beta';
const ACME = 'Clients/Acme';
const ZETA = 'Clients/Zeta';
const LIST = [{ folder: HOME, label: 'Household' }, { folder: BETA, label: 'Beta' }];

/* A real BudgetPlugin over an in-memory vault and a per-device store. `kv` is
   this device's local storage; hand the same object to a second plugin to be
   "the same device after a restart". The vault's destructive calls are spies:
   anything that reaches them is recorded, so section 6 can assert none did. */
function makeWorld(files, { stored, kv = {} } = {}) {
  const vault = H.makeVault(files);
  vault.configDir = '.obsidian';
  const destructive = [];
  const realTrash = vault.trash;
  vault.trash = async f => { destructive.push(['trash', f && f.path]); return realTrash(f); };
  vault.delete = async f => { destructive.push(['delete', f && f.path]); };
  vault.rename = async (f, to) => { destructive.push(['rename', f && f.path, to]); };
  vault.adapter = { remove: async p => { destructive.push(['adapter.remove', p]); }, rmdir: async p => { destructive.push(['adapter.rmdir', p]); } };
  const p = new BudgetPlugin();
  p.stored = JSON.parse(JSON.stringify(stored || {}));
  p.reloads = 0;
  p.dirty = false;
  /* The privacy splash is ON by default (constants.js) and switchBook refuses
     while it is up. A reader in Settings → Books has normally entered the
     budget, so the fixture starts unlocked; the locked cases set it back. */
  p.budgetUnlocked = true;
  p.activated = 0;
  p.app = {
    vault,
    workspace: { getLeavesOfType: () => [] },
    loadLocalStorage: k => (k in kv ? kv[k] : null),
    saveLocalStorage: (k, v) => { if (v === null) delete kv[k]; else kv[k] = v; },
    metadataCache: { getFileCache: () => null },
  };
  /* No views exist in bare node, so the two places switchBook reaches into
     them — "is any page dirty", "reload every page" — are answered here. */
  p.forEachView = fn => fn({ hasDirty: () => p.dirty, reload: async () => { p.reloads++; }, applyBooks() {} });
  p.activateView = async () => { p.activated++; };
  return { p, vault, kv, destructive, snap: () => new Map(vault._store) };
}
const SETTINGS = (extra = '') => `---\nmonth_start_day: 25\ncurrency: "R"\ncountry: za\n${extra}---\n\n# Budget Settings\n`;
const FILES = () => ({
  [`${HOME}/Settings.md`]: SETTINGS('household: "The Smiths"\n'),
  [`${HOME}/Categories/Groceries.md`]: '---\ntype: food\n---\n',
  [`${BETA}/Settings.md`]: SETTINGS('household: "Beta Ltd"\n'),
  [`${BETA}/Categories/Consulting.md`]: '---\ntype: income\n---\n',
});
/* Paths whose bytes changed, appeared or vanished between two snapshots. */
function changed(before, after) {
  const out = [];
  for (const [k, v] of after) if (!before.has(k) || before.get(k) !== v) out.push(k);
  for (const k of before.keys()) if (!after.has(k)) out.push('-' + k);
  return out.sort();
}
const under = (paths, folder) => paths.every(p => p.replace(/^-/, '').startsWith(folder + '/'));

(async () => {
  /* ---- 1. validateNewBook ------------------------------------------------- */
  {
    const v = (folder, over = {}) => validateNewBook({ books: LIST, homeFolder: HOME, folder, configDir: '.obsidian', ...over });
    eq(v(ACME), null, 'a sibling of the listed books is accepted');
    eq(v('Budget2'), null, 'NEGATIVE CONTROL: a folder whose name merely STARTS like the home book is not inside it');
    eq(v('Clients/Betamax'), null, '… nor one that starts like a listed book');
    eq(v(''), { reason: 'empty' }, 'nothing typed → empty');
    eq(v('   '), { reason: 'empty' }, 'whitespace → empty');
    eq(v(undefined), { reason: 'empty' }, 'no folder at all → empty, not a throw');
    eq(v('/'), { reason: 'root' }, 'the vault root → root');
    eq(v('Clients/../Budget'), { reason: 'traversal' }, '".." → traversal, never rebased onto where it would land');
    eq(v('.trash/Old'), { reason: 'hidden', folder: '.trash' }, 'a dot-folder → hidden, naming the segment');
    eq(v('Notes/.archive/Acme'), { reason: 'hidden', folder: '.archive' }, '… at any depth');
    eq(v('.obsidian/plugins'), { reason: 'hidden', folder: '.obsidian' }, 'the config folder → hidden');
    eq(v('Config/Books', { configDir: 'Config' }), { reason: 'hidden', folder: 'Config' }, 'a renamed config folder without a dot is still refused');
    eq(v(HOME), { reason: 'duplicate', folder: HOME }, 'the home book → duplicate');
    eq(v(BETA), { reason: 'duplicate', folder: BETA }, 'a listed book → duplicate');
    eq(v('clients/beta/'), { reason: 'duplicate', folder: BETA },
      'another CASE and a trailing slash → duplicate: one folder on APFS, iOS and Windows');
    eq(v('Clients\\Beta'), { reason: 'duplicate', folder: BETA }, 'backslashes → the same folder');
    eq(v('Budget/Acme'), { reason: 'nested', folder: HOME }, 'inside the HOME book → nested');
    eq(v('Clients/Beta/Sub'), { reason: 'nested', folder: BETA }, 'inside a listed book → nested');
    eq(v('Clients'), { reason: 'contains', folder: BETA }, 'a parent of a listed book → contains');
    eq(validateNewBook({ books: [], homeFolder: 'Finances/Budget', folder: 'Finances' }), { reason: 'contains', folder: 'Finances/Budget' },
      'single-book mode: a parent of the home book → contains');
    eq(validateNewBook({ books: [], homeFolder: '', folder: ACME }), { reason: 'nested', folder: '' },
      'a home book AT THE ROOT contains every folder, so every add is nested — the rule, not a corner case');
    eq(validateNewBook({ books: [], homeFolder: HOME, folder: ACME }), null, 'single-book mode accepts a sibling');
    eq(validateNewBook({ books: 'hand-edited', homeFolder: HOME, folder: ACME }), null, 'a non-array list is no books, not a throw');
    const nfd = 'Clients/Amélie', nfc = 'Clients/Amélie';
    eq(validateNewBook({ books: [{ folder: nfc }], homeFolder: HOME, folder: nfd }), { reason: 'duplicate', folder: nfc },
      'NFD and NFC spellings of one name are one folder');
  }

  /* ---- 2. the pure list edits --------------------------------------------- */
  {
    const empty = [];
    const a = bookListAdd({ books: empty, homeFolder: HOME, homeLabel: 'The Smiths', folder: ACME + '/', label: '  Acme  ' });
    eq(a, { ok: true, books: [{ folder: HOME, label: 'The Smiths' }, { folder: ACME, label: 'Acme' }], folder: ACME, label: 'Acme' },
      'the first add seeds the home book (named by its household) ahead of the new one, both normalised and trimmed');
    eq(empty, [], '… and the list it was handed is not mutated');
    eq(bookListAdd({ books: [], homeFolder: 'Finances/Our Budget', folder: ACME }).books[0].label, 'Our Budget',
      'no household name → the home book is named by its folder');
    eq(bookListAdd({ books: [], homeFolder: HOME, folder: ACME, label: '' }).label, 'Acme', 'a blank label → the folder\'s name');
    const b = bookListAdd({ books: LIST, homeFolder: HOME, folder: ZETA, label: 'Zeta' });
    eq(b.books, [...LIST, { folder: ZETA, label: 'Zeta' }], 'a later add appends, the home entry not seeded twice');
    eq(bookListAdd({ books: LIST, homeFolder: HOME, folder: 'Clients/Beta/Sub' }), { ok: false, reason: 'nested', folder: BETA },
      'an add re-validates: the caller cannot skip validateNewBook by calling the edit');

    const r = bookListRelabel({ books: LIST, homeFolder: HOME, folder: BETA, label: ' Beta (Pty) ' });
    eq(r.books, [LIST[0], { folder: BETA, label: 'Beta (Pty)' }], 'relabel changes the label only — the folder is identity');
    eq(LIST[1].label, 'Beta', '… without mutating the list');
    eq(bookListRelabel({ books: LIST, homeFolder: HOME, folder: BETA, label: '  ' }).books[1].label, 'Beta', 'a blank label → the folder\'s name');
    eq(bookListRelabel({ books: LIST, homeFolder: HOME, folder: ZETA, label: 'x' }), { ok: false, reason: 'unknown' }, 'an unlisted folder → unknown');
    eq(bookListRelabel({ books: [], homeFolder: HOME, folder: HOME, label: 'x' }), { ok: false, reason: 'unknown' },
      'no relabelling in single-book mode — there is nowhere for the label to show');
    eq(bookListRelabel({ books: [{ folder: BETA, label: 'Beta' }], homeFolder: HOME, folder: HOME, label: 'Ours' }).books,
      [{ folder: HOME, label: 'Ours' }, { folder: BETA, label: 'Beta' }], 'a hand-edited list without its home entry gets it back, at the front');

    eq(bookListRemove({ books: LIST, homeFolder: HOME, folder: HOME }), { ok: false, reason: 'home' }, 'the home book cannot be removed');
    eq(bookListRemove({ books: LIST, homeFolder: HOME, folder: ZETA }), { ok: false, reason: 'unknown' }, 'an unlisted folder → unknown');
    const three = [...LIST, { folder: ZETA, label: 'Zeta' }];
    eq(bookListRemove({ books: three, homeFolder: HOME, folder: 'Clients/Beta/' }).books, [LIST[0], three[2]],
      'remove forgets exactly that entry, in any spelling');
    eq(three.length, 3, '… without mutating the list');
    eq(bookListRemove({ books: LIST, homeFolder: HOME, folder: BETA }).books, [],
      'removing down to the home book collapses to [] — single-book mode, no switcher, no `books` key');
  }

  /* ---- 3. add round-trip through main.js ---------------------------------- */
  {
    const w = makeWorld(FILES(), { stored: { budgetFolder: HOME, onboarded: true, theme: 'dark' } });
    await w.p.loadSettings();
    w.p.app.metadataCache = { getFileCache: () => null };
    const r = await w.p.addBook({ folder: ACME, label: 'Acme' });
    eq(r, { ok: true, folder: ACME, label: 'Acme' }, 'addBook reports the stored folder and label');
    const disk = w.p.stored;
    eq(disk.books, [{ folder: HOME, label: 'The Smiths' }, { folder: ACME, label: 'Acme' }],
      'data.json holds the home book (labelled from ITS Settings.md household) and the added one');
    eq(disk.budgetFolder, HOME, '… and the home book is still the home book');
    eq(disk.theme, 'dark', '… and nothing else moved');
    eq(await w.p.addBook({ folder: 'clients/acme' }), { ok: false, reason: 'duplicate', folder: ACME }, 'adding it again is refused');
    eq(w.p.stored.books.length, 2, '… and data.json is unchanged');

    /* A failed write leaves no phantom book in memory. */
    const saveData = w.p.saveData;
    w.p.saveData = async () => { throw new Error('disk full'); };
    await assert.rejects(() => w.p.addBook({ folder: ZETA, label: 'Zeta' }), /disk full/); checks++;
    eq(w.p.settings.books.map(b => b.folder), [HOME, ACME], 'a refused data.json write puts the list in memory back');
    w.p.saveData = saveData;
  }

  /* ---- 4. the wizard in add-a-book mode, a client's book open ------------- */
  const openBeta = async (files = FILES(), extra = {}) => {
    const w = makeWorld(files, { stored: { budgetFolder: HOME, onboarded: true, books: LIST, ...extra }, kv: { [OPEN_BOOK_KEY]: BETA } });
    await w.p.loadSettings();
    eq(w.p.activeFolder(), BETA, 'fixture: a client\'s book (Beta) is open on this device');
    return w;
  };
  const answer = wz => Object.assign(wz.data, { name: 'Acme Ltd', payday: 1, periodDays: 0, inputMode: 'csv' });

  /* create */
  let restart;
  {
    const w = await openBeta();
    const before = w.snap();
    const budgetFolderBefore = JSON.stringify(w.p.settings.budgetFolder);
    const wz = new OnboardingWizard(w.p.app, w.p, { book: { folder: ACME, label: 'Acme' } });
    wz.open();
    eq(wz.mode, 'create', 'an empty folder → create');
    eq(wz.steps(), ['welcome', 'name', 'period', 'how', 'rates', 'categories', 'account', 'finish'], 'the full walk, as for any new budget');
    eq(wz.data.folder, ACME, 'the folder is the one the Add dialog gave, not the home book');
    eq(wz.data.name, 'Acme', 'the household name starts as the label');
    answer(wz);
    wz.goTo('finish');
    eq(all(wz.contentEl, e => e.tagName === 'INPUT').length, 0, 'the finish screen shows the folder; it does not offer to change it');
    await wz.next();
    ok(!NOTICES.some(n => /Setup failed/.test(n)), `apply() threw: ${NOTICES.join(' | ')}`);
    const diff = changed(before, w.snap());
    ok(diff.length > 5 && under(diff, ACME), `only ${ACME}/ was written (${diff.filter(p => !p.startsWith(ACME)).join(', ') || 'ok'})`);
    ok(diff.includes(`${ACME}/Settings.md`) && diff.includes(`${ACME}/Categories/Groceries.md`), '… and it is a real scaffold');
    eq(JSON.stringify(w.p.settings.budgetFolder), budgetFolderBefore, 'settings.budgetFolder is byte-identical');
    eq(w.p.stored.budgetFolder, HOME, '… in data.json too');
    eq(w.p.stored.books, [...LIST, { folder: ACME, label: 'Acme' }], 'the list gained the book, the home entry not seeded twice');
    eq(w.p.activeFolder(), ACME, 'and this device opened it, through switchBook');
    eq(w.kv[OPEN_BOOK_KEY], ACME, '… as a per-device choice');
    ok(w.p.reloads >= 1, '… which reloaded the views onto it');
    eq(w.p.settings.onboarded, true, '`onboarded` untouched');
    ok(!('firstSteps' in w.p.stored) || w.p.stored.firstSteps === undefined, 'the first-steps card is not switched on for a second book');
    ok(byClass(wz.contentEl, 'budget-onb-celebrate').length === 1, 'a created book ends on the celebration, as setup does');
    restart = { stored: w.p.stored, kv: w.kv, files: Object.fromEntries(w.vault._store) };
  }

  /* restart: same data.json, same device */
  {
    const w = makeWorld(restart.files, { stored: restart.stored, kv: restart.kv });
    await w.p.loadSettings();
    eq(w.p.settings.books, [...LIST, { folder: ACME, label: 'Acme' }], 'after a restart the list is intact');
    eq(w.p.activeFolder(), ACME, '… and on this device the added book is still the open one');
    const other = makeWorld(restart.files, { stored: restart.stored, kv: {} });
    await other.p.loadSettings();
    eq(other.p.activeFolder(), HOME, 'another device sharing that data.json opens the home book — the open book never synced');
  }

  /* an existing budget: register only */
  {
    const files = { ...FILES(), [`${ZETA}/Settings.md`]: SETTINGS('household: "Zeta & Sons"\nperiod_days: 14\nperiod_anchor: 2026-08-07\n') };
    const w = await openBeta(files);
    const before = w.snap();
    const wz = new OnboardingWizard(w.p.app, w.p, { book: { folder: ZETA, label: 'Zeta' } });
    wz.open();
    eq(wz.mode, 'connect', 'a folder with a Settings.md → connect');
    eq(wz.steps(), ['finish'], 'one screen: nothing is asked about a book that already says what it is');
    eq(textOf(wz.contentEl, 'budget-onb-step'), '', 'no "Step 0 of 0" over it');
    ok(/nothing in the folder is written/i.test(textOf(wz.contentEl, 'budget-onb-callout')), 'the screen says nothing will be written');
    eq(buttons(wz.contentEl).map(b => b.textContent).pop(), 'Add book', 'and the button says what it does');
    await wz.next();
    eq(changed(before, w.snap()), [], 'NOTHING was written — Zeta\'s Settings.md is byte-identical, and so is every other file');
    eq(w.p.stored.books.map(b => b.folder), [HOME, BETA, ZETA], 'it is registered');
    eq(w.p.stored.budgetFolder, HOME, 'budgetFolder unchanged');
    eq(w.p.activeFolder(), ZETA, 'and opened on this device');
    ok(wz.closed && NOTICES.some(n => /added "Zeta"/.test(n)), 'closing with a toast that names it');
  }

  /* cancelled */
  {
    const w = await openBeta();
    const before = w.snap();
    const saves = w.p.saved.length;
    const wz = new OnboardingWizard(w.p.app, w.p, { book: { folder: ACME, label: 'Acme' } });
    wz.open();
    wz.stepIdx = 3; wz.renderStep();
    wz.close();
    eq(w.p.saved.length, saves, 'cancelled past the welcome screen: no data.json write');
    eq(w.p.settings.books, LIST, '… nothing added');
    eq(changed(before, w.snap()), [], '… nothing written');
    eq(w.p.settings.onboarded, true, '… `onboarded` not this wizard\'s to touch');
    eq(w.p.activeFolder(), BETA, '… and the open book did not move');
  }

  /* refused at the write */
  {
    const w = await openBeta();
    const before = w.snap();
    const wz = new OnboardingWizard(w.p.app, w.p, { book: { folder: 'Clients/Beta/Sub', label: 'Sub' } });
    wz.open();
    answer(wz);
    wz.goTo('finish');
    await wz.next();
    eq(changed(before, w.snap()), [], 'an overlapping folder is refused before a single file is created');
    ok(/inside the book in "Clients\/Beta"/.test(textOf(wz.contentEl, 'budget-onb-error')), 'inline, naming the book it would share files with');
    eq(w.p.settings.books, LIST, 'nothing added');
  }

  /* locked: added, but not opened behind the splash */
  {
    const w = await openBeta();
    w.p.budgetUnlocked = false;
    NOTICES.length = 0;
    const files = { ...FILES(), [`${ZETA}/Settings.md`]: SETTINGS() };
    for (const [k, v] of Object.entries(files)) if (!w.vault._store.has(k)) await w.vault.create(k, v);
    const wz = new OnboardingWizard(w.p.app, w.p, { book: { folder: ZETA, label: 'Zeta' } });
    wz.open();
    await wz.next();
    eq(w.p.stored.books.map(b => b.folder), [HOME, BETA, ZETA], 'behind the privacy splash the book is still added');
    eq(w.p.activeFolder(), BETA, '… but not opened: a switch is refused while the splash is up');
    ok(NOTICES.some(n => /added "Zeta"/.test(n)) && NOTICES.some(n => /privacy screen/.test(n)),
      '… and the reader is told both — it is there, and why it is not open yet');
  }

  /* ---- 5. THE WRONG-BOOK TRAP ---------------------------------------------- */
  {
    const X = 'Household';
    const files = { ...FILES(), [`${X}/Settings.md`]: SETTINGS('household: "Old name"\n') };
    const w = await openBeta(files);
    const before = w.snap();
    const wz = new OnboardingWizard(w.p.app, w.p);
    wz.open();
    await wz.adoptFolder(X);
    eq(wz.mode, 'connect', 'fixture: the setup wizard, pointed at an existing budget in X');
    Object.assign(wz.data, { name: 'The Joneses', currency: '£', country: 'uk' });
    wz.touched.add('name');
    wz.goTo('finish');
    await wz.next();
    ok(!NOTICES.some(n => /Setup failed/.test(n)), `apply() threw: ${NOTICES.join(' | ')}`);
    const diff = changed(before, w.snap());
    eq(diff, [`${X}/Settings.md`], 'ONLY X\'s Settings.md was written — the open book\'s is byte-identical');
    ok(/household: "The Joneses"/.test(w.vault._store.get(`${X}/Settings.md`)), 'X carries the answers');
    eq(w.vault._store.get(`${BETA}/Settings.md`), files[`${BETA}/Settings.md`], 'Beta\'s Settings.md: not one byte changed');
    eq(w.p.settings.budgetFolder, X, 'normal mode still assigns budgetFolder — X is the home book now');
    eq(w.p.activeFolder(), X, 'and this device switched to it, so the screen shows the book the toast names');
    eq(w.kv[OPEN_BOOK_KEY], undefined, '… stored as "no choice" (the home book)');

    /* create, normal mode, same trap */
    const w2 = await openBeta();
    const before2 = w2.snap();
    const wz2 = new OnboardingWizard(w2.p.app, w2.p);
    wz2.open();
    await wz2.adoptFolder('NewHome');
    answer(wz2);
    wz2.goTo('finish');
    await wz2.next();
    const diff2 = changed(before2, w2.snap());
    ok(diff2.length > 5 && under(diff2, 'NewHome'), 'normal-mode create with a client open writes only the folder it was given');
    eq(w2.p.settings.budgetFolder, 'NewHome', '… and makes it the home book');

    /* NEGATIVE CONTROL: the trap is real without the explicit folder. */
    const w3 = await openBeta();
    await w3.p.updateBudgetSettingsMd('household', '"Wrong book"');
    ok(/Wrong book/.test(w3.vault._store.get(`${BETA}/Settings.md`)),
      'NEGATIVE CONTROL: with no folder, updateBudgetSettingsMd writes the OPEN book — exactly what the wizard used to do');
    await w3.p.updateBudgetSettingsMd('household', '"Right book"', HOME);
    ok(/Right book/.test(w3.vault._store.get(`${HOME}/Settings.md`)) && !/Right book/.test(w3.vault._store.get(`${BETA}/Settings.md`)),
      'with a folder it writes that folder, whatever is open');

    /* Source pin: every wizard Settings.md write names its folder. */
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'onboarding.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const calls = src.match(/updateBudgetSettingsMd\([^;]*\);/g) || [];
    ok(calls.length >= 10, `fixture: the wizard's Settings.md writes were found (${calls.length})`);
    eq(calls.filter(c => !/, folder\);$/.test(c)), [], 'every updateBudgetSettingsMd call in onboarding.js passes the wizard\'s own folder');
  }

  /* ---- 6. remove ------------------------------------------------------------ */
  {
    const three = [...LIST, { folder: ACME, label: 'Acme' }];
    const files = { ...FILES(), [`${ACME}/Settings.md`]: SETTINGS() };

    /* not the open book */
    const w = await openBeta(files, { books: three });
    const before = w.snap();
    eq(await w.p.removeBook(ACME), { ok: true }, 'removing a book that is not open');
    eq(w.p.stored.books, LIST, 'forgets the entry');
    eq(changed(before, w.snap()), [], 'and touches no file — Acme\'s folder is all still there');
    eq(w.destructive, [], 'no trash, delete, rename or adapter call was made');
    eq(w.p.activeFolder(), BETA, 'the open book did not move');

    /* the open book, with unsaved edits */
    w.p.dirty = true;
    eq(await w.p.removeBook(BETA), { ok: false, reason: 'dirty' }, 'removing the open book with unsaved edits is refused');
    eq(w.p.settings.books, LIST, '… the list unchanged');
    eq(w.kv[OPEN_BOOK_KEY], BETA, '… the stored choice unchanged');
    eq(w.p.activeFolder(), BETA, '… and the unsaved row still belongs to the book it was typed in');

    /* the open book, clean */
    w.p.dirty = false;
    const reloads = w.p.reloads;
    eq(await w.p.removeBook(BETA), { ok: true }, 'removing the open book once it is clean');
    eq(w.p.activeFolder(), HOME, 'falls back to the home book');
    eq(w.kv[OPEN_BOOK_KEY], undefined, 'the stored choice is cleared');
    ok(w.p.reloads > reloads, 'the views reloaded onto the home book');
    eq(w.p.settings.books, [], 'down to the home book → single-book mode');
    ok(!('books' in w.p.stored), '… and data.json carries no `books` key, exactly as before books existed');
    eq(changed(before, w.snap()), [], 'still not one file touched');
    eq(w.destructive, [], 'still no destructive vault call');

    eq(await w.p.removeBook(HOME), { ok: false, reason: 'home' }, 'the home book cannot be removed');

    /* locked */
    const wl = await openBeta(files, { books: three, privacyLock: true });
    wl.p.budgetUnlocked = false;
    eq(await wl.p.removeBook(BETA), { ok: false, reason: 'locked' }, 'removing the open book behind the privacy splash is refused');
    eq(wl.p.settings.books, three, '… nothing moved');

    /* relabel */
    const wr = await openBeta(files, { books: three });
    eq(await wr.p.relabelBook(ACME, 'Acme Holdings'), { ok: true }, 'relabel');
    eq(wr.p.stored.books[2], { folder: ACME, label: 'Acme Holdings' }, 'label changed, folder the same');
    eq(wr.destructive, [], 'relabel touches no file either');

    /* grep-level guard: no vault API in the remove path */
    const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const mainSrc = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8'));
    const body = name => {
      const at = mainSrc.indexOf(`\n  async ${name}(`);
      ok(at > 0, `fixture: main.js ${name}() found`);
      return mainSrc.slice(at, mainSrc.indexOf('\n  }\n', at));
    };
    const FORBIDDEN = /\bvault\b|\btrash|\.delete\(|\.rename\(|\badapter\b|\bremove\(|\brmdir\b|trashFile/;
    for (const name of ['removeBook', 'commitBooks', 'relabelBook']) {
      ok(!FORBIDDEN.test(body(name)), `main.js ${name}() reaches no vault API`);
    }
    const booksSrc = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'books.js'), 'utf8'));
    const rm = booksSrc.slice(booksSrc.indexOf('function bookListRemove('), booksSrc.indexOf('\nmodule.exports'));
    ok(rm.length > 100 && !FORBIDDEN.test(rm), 'books.js bookListRemove() reaches no vault API');
    const dialogs = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'book-settings.js'), 'utf8'));
    ok(!/\btrash|\.delete\(|\.rename\(|\badapter\b|trashFile/.test(dialogs), 'the Books dialogs reach no destructive vault API');
    const tabSrc = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'settings-tab.js'), 'utf8'));
    const booksPart = tabSrc.slice(tabSrc.indexOf('\n  bookRows() {'), tabSrc.indexOf('\n  nonEssentialRows('));
    ok(booksPart.length > 500 && !/\btrash|\.delete\(|\.rename\(|\badapter\b|trashFile|\bvault\.(?!getAbstractFileByPath)/.test(booksPart),
      'nor do the settings tab\'s Books methods (their one vault touch is a read of the home Settings.md\'s cache entry)');
    ok(FORBIDDEN.test('await this.app.vault.trash(f)') && FORBIDDEN.test('io.trashFile(p)'),
      'NEGATIVE CONTROL: the guard pattern does catch a trash call');
  }

  /* ---- 7. the settings tab and the Add dialog ------------------------------- */
  {
    const w = makeWorld(FILES(), { stored: { budgetFolder: HOME, onboarded: true } });
    await w.p.loadSettings();
    const tab = new BudgetSettingTab(w.p.app, w.p);
    let rows = tab.bookRows();
    eq(rows.map(r => r.name), ['Budget'], 'single-book mode: the home book alone');
    let s = new Setting(new FakeEl('div'));
    rows[0].render(s);
    eq(buttons(s.settingEl).length, 0, '… with no Relabel (no switcher to label it in) and no Remove (it is the home book)');
    ok(/home book/.test(rows[0].desc) && /open on this device/.test(rows[0].desc), '… described as the home book, open here');

    w.p.settings.books = [...LIST, { folder: ACME, label: 'Acme' }];
    w.p.app.vault.createFolder(ACME);
    rows = tab.bookRows();
    eq(rows.map(r => r.name), ['Household', 'Beta', 'Acme'], 'with a list: every book under its label, home first');
    s = new Setting(new FakeEl('div'));
    rows[0].render(s);
    eq(buttons(s.settingEl).map(b => b.textContent), ['Change label'], 'the home book can be relabelled, not removed');
    s = new Setting(new FakeEl('div'));
    rows[2].render(s);
    eq(buttons(s.settingEl).map(b => b.textContent), ['Change label', 'Remove'], 'another book has both');

    const defs = tab.getSettingDefinitions().map(d => d.name);
    const at = defs.indexOf('Books');
    ok(at >= 0, 'the 1.13 declarative tab has the Books heading');
    eq(defs.slice(at, at + 5), ['Books', 'Household', 'Beta', 'Acme', 'Add a book'], '… then the same rows, then Add');
    tab.display();
    const names = all(tab.containerEl, e => e.hasClass('setting-item-name')).map(e => e.textContent);
    const ia = names.indexOf('Books');
    eq(names.slice(ia, ia + 5), ['Books', 'Household', 'Beta', 'Acme', 'Add a book'], 'and display() draws the same section');

    const tabless = new BudgetSettingTab({}, { updateBudgetSettingsMd: async () => {} });
    eq(tabless.bookRows(), [], 'a plugin without the book seam gets no rows rather than a tab that throws');

    /* The Add dialog. */
    Modal.opened.length = 0;
    const m = new AddBookModal(w.p.app, w.p, () => {});
    m.open();
    eq(m.submit('Clients/Beta/Sub', 'Sub'), { reason: 'nested', folder: BETA }, 'the dialog refuses an overlapping folder');
    ok(/inside the book in "Clients\/Beta"/.test(textOf(m.contentEl, 'budget-onb-error')), '… inline, under the fields');
    ok(!m.closed && Modal.opened.length === 1, '… and stays open; no wizard');
    eq(m.submit(ZETA, 'Zeta'), null, 'a good folder is accepted');
    const wz = Modal.opened[1];
    ok(m.closed && wz instanceof OnboardingWizard, '… the dialog closes and the setup wizard opens');
    eq(wz.adding, { folder: ZETA, label: 'Zeta' }, '… in add-a-book mode, for that folder and label');
    wz.close();
    eq(w.p.settings.books.length, 3, 'closing that wizard adds nothing');
  }

  Module._load = prevLoad;
  console.log(`PASS books-settings — add through the wizard, relabel, remove; no wrong-book write, no vault call on remove, no budgetFolder change on add (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
