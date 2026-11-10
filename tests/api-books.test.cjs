'use strict';
/* The headless API, version 2: which books there are, which one is open, and
   how a sibling plugin changes it (ADR 0009 rule 6, issue #169).

   Until this surface existed the sibling `obsidian-budget-books` switched client
   by writing settings.budgetFolder and calling view.appCtl.reload() — a private
   coupling to two things this plugin never promised, and one that made the open
   book follow the user to every device (discussion #154). The replacement is
   three additions to api.js, and the risk in each is a quiet one:

     - books() is a SECOND way to ask "what are the books called", beside the
       top-bar switcher. If it derived labels by its own rule, a card and the
       switcher would name one client two ways. So it is checked here against
       books.bookChoices over the same inputs, and the repeated-label suffix
       (which only bookChoices knows) is driven through it.
     - labels are usually client names and the splash promises nothing is on
       show, so books() while locked must answer { locked: true } having READ
       NOTHING — counted at the vault, as tests/api-privacy-lock.test.cjs counts
       currentPeriod()'s, with a negative control (the same call after the gate
       opens reads and lists).
     - setActiveBook() must be switchBook() and nothing else: same results, no
       throw, and — new for an API a consumer can keep a reference to — nothing
       at all once the plugin has unloaded.

   Driven through the REAL plugin class (main.js onload builds the API), the REAL
   switchBook(), the REAL loader and a controller stand-in with the real dirty
   rule, the way tests/books-switch.test.cjs builds a device. v1's own shapes are
   held by the other tests/api*.test.cjs files, untouched; this one only adds the
   figure's `book` and checks that everything else about it is as it was.

     node tests/api-books.test.cjs
*/
const assert = require('assert');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const base = require('obsidian');
const { SEED, B, TODAY } = require('./figures/household.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const books = require('../src/books');
const i18n = require('../src/i18n');
const { OPEN_BOOK_KEY } = books;

const ACME = 'Clients/Acme';
const ZETA = 'Clients/Zeta';
const LIST = [{ folder: ACME, label: 'Acme' }, { folder: ZETA, label: 'Zeta' }];

class Plugin {
  constructor() { this._events = []; this.saved = []; this.stored = {}; }
  register(cb) { this._events.push(cb); }
  registerEvent(ref) { this.register(() => ref.e.offref(ref)); }
  registerDomEvent() {}
  unload() { while (this._events.length) this._events.pop()(); }
  registerView() {}
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
  async loadData() { return this.stored; }
  async saveData(d) { this.saved.push(JSON.parse(JSON.stringify(d))); }
}
const prevLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') return { ...base, Plugin };
  return prevLoad.call(this, req, ...rest);
};
const BudgetPlugin = require('../src/main');
const { BudgetView } = require('../src/view');

const tx = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');
const ACME_FILES = {
  [`${ACME}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "$"\ncountry: us\nhousehold: Acme Ltd\n---\n',
  [`${ACME}/Categories/Consulting.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${ACME}/Categories/Software.md`]: '---\ntype: expense\ncolor: "#3366aa"\n---\n',
  [`${ACME}/Accounts/Operating.md`]: '---\nkind: account\n---\n',
  [`${ACME}/Transactions/Operating/2026-09.md`]: tx([
    ['2026-09-01', 'Retainer', 'Consulting', 5000], ['2026-09-02', 'Licence', 'Software', -120]]),
};
const ZETA_FILES = {
  [`${ZETA}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "$"\n---\n',
  [`${ZETA}/Categories/Zed.md`]: '---\ntype: expense\n---\n',
};
const ALL = { ...SEED, ...ACME_FILES, ...ZETA_FILES };

/* One device: a vault, a real plugin onto it, its real API, one open "view"
   (the real loader and the real dirty rule), and a read counter at the vault —
   the privacy suite's own instrument for "nothing was read". */
async function device({ files = ALL, settings = {}, view = true } = {}) {
  const vault = H.makeVault(files);
  const counts = { reads: 0 };
  const rawCached = vault.cachedRead.bind(vault);
  const rawRead = vault.read.bind(vault);
  vault.cachedRead = async f => { counts.reads++; return rawCached(f); };
  vault.read = async f => { counts.reads++; return rawRead(f); };
  vault.on = (name, fn) => ({ e: vault, name, fn });
  vault.offref = () => {};
  const kv = {};
  const leaves = [];
  const app = {
    vault,
    workspace: { onLayoutReady: cb => cb(), getLeavesOfType: () => leaves, on: () => ({}) },
    loadLocalStorage: k => (k in kv ? kv[k] : null),
    saveLocalStorage: (k, v) => { if (v === null) delete kv[k]; else kv[k] = v; },
  };
  const plugin = new BudgetPlugin();
  plugin.app = app;
  plugin.stored = { budgetFolder: B, onboarded: true, openOnStartup: false, privacyLock: false, books: LIST.map(b => ({ ...b })), ...settings };
  await plugin.onload();

  let ctx = null;
  if (view) {
    ctx = H.makeCtx(files, { budgetFolder: B });
    ctx.vault = vault; ctx.app = app; ctx.plugin = plugin;
    await H.loadInto(ctx);
    const v = Object.create(BudgetView.prototype);
    v.appCtl = {
      hasDirty: () => ctx._dirty() || Object.values(ctx.S.txFiles).some(f => f.dirty) || !!ctx.S.pendingImport,
      reload: async () => { await ctx.loadVault(); },
    };
    leaves.push({ view: v });
  }
  let told = 0;
  plugin.api.onChange(() => { told++; });
  return { plugin, api: plugin.api, ctx, counts, kv, told: () => told, vault };
}

const bookRows = list => list.map(b => [b.folder, b.label, b.active]);

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* ---- 0. the version ---- */
    {
      const d = await device();
      eq(d.api.apiVersion, 2, 'apiVersion is 2');
      for (const name of ['currentPeriod', 'onChange', 'books', 'setActiveBook']) {
        eq(typeof d.api[name], 'function', `the v1 name and the v2 additions are all there: ${name}`);
      }
    }

    /* ---- 1. books(), single-book mode ---- */
    {
      const d = await device({ settings: { books: [] } });
      eq(bookRows(await d.api.books()), [[B, 'Budget', true]],
        'no list → exactly ONE entry, the home book, active — named by its folder when Settings.md carries no household');

      const named = { ...ALL, [`${B}/Settings.md`]: ALL[`${B}/Settings.md`].replace(/^---\n/, '---\nhousehold: The Smiths\n') };
      ok(/household: The Smiths/.test(named[`${B}/Settings.md`]), 'fixture: the home Settings.md now names its household');
      const n = await device({ files: named, settings: { books: [] } });
      eq(bookRows(await n.api.books()), [[B, 'The Smiths', true]],
        'the home book is called by its household, as the switcher calls it');

      const root = await device({ files: { ...ALL }, settings: { books: [], budgetFolder: '/' } });
      const rl = await root.api.books();
      eq(rl.length, 1, 'a book at the vault root is still one entry');
      eq(rl[0].label, i18n.t('books.homeFallback'), '… named by the fallback, since a root has no folder segment to name it by');
    }

    /* ---- 2. books(), several books ---- */
    {
      const d = await device();
      const list = await d.api.books();
      eq(bookRows(list), [[B, 'Budget', true], [ACME, 'Acme', false], [ZETA, 'Zeta', false]],
        'the home book first and open, then the list in order, each with the label the reader gave it');
      eq(list.filter(b => b.active).length, 1, 'exactly one entry is active');
      eq(Object.keys(list[0]).sort(), ['active', 'folder', 'label'], 'each entry is exactly { folder, label, active }');

      /* One rule for labels: the same bookChoices the switcher renders from. */
      const model = books.bookChoices({ books: d.plugin.settings.books, homeFolder: B, homeName: '', openFolder: B, homeFallback: i18n.t('books.homeFallback') });
      eq(list, model.items.map(i => ({ folder: i.folder, label: i.label, active: i.active })), 'books() is bookChoices\' own list');

      await d.plugin.switchBook(ACME);
      eq(bookRows(await d.api.books()), [[B, 'Budget', false], [ACME, 'Acme', true], [ZETA, 'Zeta', false]], 'after a switch the active flag moves');

      /* A repeated label is told apart by its folder — a rule only bookChoices has. */
      const dup = await device({ settings: { books: [{ folder: ACME, label: 'Budget' }] } });
      eq((await dup.api.books()).map(b => b.label), ['Budget (Budget)', 'Budget (Clients/Acme)'],
        'two books with one label: the same suffix the switcher shows, not a second labelling rule');
    }

    /* ---- 3. books() while locked ---- */
    {
      const d = await device({ settings: { privacyLock: true } });
      eq(d.plugin.budgetUnlocked, false, 'fixture: the splash is up and the gate has not been opened');
      const reads = d.counts.reads;
      eq(await d.api.books(), { locked: true }, 'locked: exactly { locked: true } — no folder, no label');
      eq(d.counts.reads - reads, 0, '… and not one file was read to produce it');

      /* NEGATIVE CONTROL: the gate opens, the same call lists and reads. */
      d.plugin.setBudgetUnlocked(true);
      const before = d.counts.reads;
      const list = await d.api.books();
      eq(bookRows(list), [[B, 'Budget', true], [ACME, 'Acme', false], [ZETA, 'Zeta', false]],
        'NEGATIVE CONTROL: the identical call after the gate opens lists the books, so the refusal was the lock');
      d.plugin.setBudgetUnlocked(false);
      eq(await d.api.books(), { locked: true }, 'the gate closing locks it again');

      /* The home book's name is a file read: with the home book UNlisted and
         the lock up, that read must not happen either. */
      const named = { ...ALL, [`${B}/Settings.md`]: ALL[`${B}/Settings.md`].replace(/^---\n/, '---\nhousehold: The Smiths\n') };
      const n = await device({ files: named, settings: { privacyLock: true } });
      const r0 = n.counts.reads;
      eq(await n.api.books(), { locked: true }, 'locked with an unlisted, household-named home book');
      eq(n.counts.reads - r0, 0, '… still nothing read: the household name stays in the file');
      eq(JSON.stringify(await n.api.books()).includes('Smiths'), false, '… and nowhere in the answer');

      /* The lock closing while the name is being read hands back the lock. */
      const m = await device({ files: named, settings: { privacyLock: true } });
      m.plugin.setBudgetUnlocked(true);
      const rawCached = m.vault.cachedRead;
      m.vault.cachedRead = async f => { const v = await rawCached(f); m.plugin.setBudgetUnlocked(false); return v; };
      eq(await m.api.books(), { locked: true }, 'a read in flight when the lock closes hands back { locked: true }, not the list');
    }

    /* ---- 4. setActiveBook ---- */
    {
      /* ok */
      const d = await device();
      const r = await d.api.setActiveBook(ACME);
      eq(r, { ok: true }, 'a listed book → { ok: true }');
      eq(d.plugin.activeFolder(), ACME, 'the book is open');
      eq(d.kv[OPEN_BOOK_KEY], ACME, 'through the per-device key');
      eq(d.plugin.settings.budgetFolder, B, 'and the home book is not rewritten');
      eq(d.plugin.saved.length, 0, 'and data.json is not written (the point of the API over writing budgetFolder)');
      eq(await d.api.setActiveBook(ACME), { ok: true }, 'the book that is already open → ok again');
      eq(await d.api.setActiveBook(B), { ok: true }, 'the home book → ok');
      eq(d.kv[OPEN_BOOK_KEY], undefined, '… and the choice is forgotten, not stored as the home folder');

      /* unknown — verbatim, never a throw */
      const u = await device({ settings: { books: [...LIST, { folder: 'Clients/Gone', label: 'Gone' }] } });
      for (const bad of ['Clients/Nobody', '', undefined, null, 7, 'Clients/Gone']) {
        let got;
        try { got = await u.api.setActiveBook(bad); } catch (e) { got = { threw: e.message }; }
        eq(got, { ok: false, reason: 'unknown' }, `setActiveBook(${JSON.stringify(bad)}) → unknown, and never throws`);
      }
      eq([u.plugin.activeFolder(), u.kv[OPEN_BOOK_KEY], u.told()], [B, undefined, 0], 'every refusal left the open book, the key and the subscribers untouched');

      /* dirty, with its negative control */
      const y = await device();
      await y.api.setActiveBook(ACME);
      const f = y.ctx.S.txFiles['Operating/2026-09'];
      ok(f, 'fixture: Acme\'s transaction file is loaded');
      f.rows.push({ date: '2026-09-03', desc: 'Typed, unsaved', cat: 'Software', amount: -99 });
      f.dirty = true;
      const told = y.told();
      eq(await y.api.setActiveBook(B), { ok: false, reason: 'dirty' }, 'a view with unsaved edits → dirty');
      eq([y.plugin.activeFolder(), y.kv[OPEN_BOOK_KEY], y.told(), f.dirty, f.rows.length], [ACME, ACME, told, true, 3],
        '… the open book, the key, the subscribers and the unsaved row all stand');
      f.dirty = false;
      eq(await y.api.setActiveBook(B), { ok: true }, 'NEGATIVE CONTROL: the identical call with nothing unsaved goes through');

      /* locked */
      const l = await device({ settings: { privacyLock: true } });
      eq(await l.api.setActiveBook(ACME), { ok: false, reason: 'locked' }, 'the splash up → locked');
      eq([l.plugin.activeFolder(), l.kv[OPEN_BOOK_KEY]], [B, undefined], '… and nothing moved');
      eq(await l.api.setActiveBook('Clients/Nobody'), { ok: false, reason: 'locked' },
        'locked before unknown: a locked consumer learns nothing about which folders are books');
      l.plugin.setBudgetUnlocked(true);
      eq(await l.api.setActiveBook(ACME), { ok: true }, 'the gate open: the same switch is allowed');
      eq(l.plugin.budgetUnlocked, true, '… and does not re-lock the splash');
    }

    /* ---- 5. the figure carries its book ---- */
    {
      const d = await device();
      const home = await d.api.currentPeriod();
      eq(home.book, { folder: B, label: 'Budget' }, 'the figure names the open book');
      eq(Object.keys(home).sort(),
        ['asOf', 'book', 'budgeted', 'currency', 'end', 'label', 'left', 'noBudget', 'notes', 'over', 'spent', 'start'],
        'and it is the ONLY key v2 added: every v1 key is still there');

      await d.api.setActiveBook(ACME);
      const acme = await d.api.currentPeriod();
      eq(acme.book, { folder: ACME, label: 'Acme' }, 'after a switch the figure names the new book');
      ok(acme.budgeted !== home.budgeted || acme.spent !== home.spent, 'and the numbers are that book\'s too');
      const m = (await d.api.books()).find(b => b.active);
      eq(acme.book, { folder: m.folder, label: m.label }, 'the figure\'s book is books()\' active entry, verbatim');

      await d.api.setActiveBook(B);
      eq((await d.api.currentPeriod()).book, { folder: B, label: 'Budget' }, 'and back');

      /* The v1 shapes that carry no book. */
      const lk = await device({ settings: { privacyLock: true } });
      eq(await lk.api.currentPeriod(), { locked: true }, 'locked: still exactly { locked: true }, no book');
      const none = await device({ files: { [`${B}/readme.md`]: 'x' }, view: false });
      eq(await none.api.currentPeriod(), null, 'no budget folder set up: still null');
    }

    /* ---- 6. onChange fires once after a switch ---- */
    {
      const d = await device();
      eq(d.told(), 0, 'fixture: nobody has been told anything');
      await d.api.setActiveBook(ACME);
      eq(d.told(), 1, 'one notification for a successful setActiveBook');
      /* The callback re-reads, as Vista's does, and must see the NEW book. */
      let seen = null;
      d.api.onChange(() => { d.api.currentPeriod().then(p => { seen = p; }); });
      await d.api.setActiveBook(ZETA);
      await new Promise(r => setTimeout(r, 20));
      eq(d.told(), 2, 'and one more for the next switch — once per switch');
      eq(seen && seen.book, { folder: ZETA, label: 'Zeta' }, 'a subscriber that re-reads inside its callback gets the new book\'s figure');
      const t = d.told();
      await d.api.setActiveBook(ZETA);
      await d.api.setActiveBook('Clients/Nobody');
      eq(d.told(), t, 'a switch to the open book, and a refused one, tell nobody');
      await d.api.currentPeriod(); await d.api.books();
      eq(d.told(), t, 'reading the figure or the list notifies nobody');
    }

    /* ---- 7. an unloaded instance ---- */
    {
      const d = await device();
      const api = d.api;
      d.plugin.unload();
      const key = d.kv[OPEN_BOOK_KEY];
      eq(await api.setActiveBook(ACME), { ok: false, reason: 'unknown' }, 'after unload: { ok: false, reason: "unknown" }');
      eq([d.kv[OPEN_BOOK_KEY], d.plugin.activeFolder(), d.told()], [key, B, 0], '… and nothing was written, switched or announced');
    }

    /* ---- 8. v1's guarantee about the lock, unharmed by v2 ---- */
    {
      const d = await device({ settings: { privacyLock: true } });
      const r0 = d.counts.reads;
      eq(await d.api.currentPeriod(), { locked: true }, 'locked currentPeriod()');
      eq(d.counts.reads - r0, 0, '… still reads nothing (naming the book is done after the lock is answered)');
    }
  } finally {
    unpin();
  }
  console.log(`PASS — api-books: the headless API's v2 books surface (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
