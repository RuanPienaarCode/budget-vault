'use strict';
/* Switching books — the one safe path, and the control that calls it
   (ADR 0009 §3, issue #167).

   A switch is a reload, and a reload with unsaved edits in the page is how a
   row typed into client A ends up in client B's files. Every way of getting
   that wrong is invisible until two books exist on a real device, so this
   drives the REAL main.js switchBook() over the REAL loader, the REAL
   api.js and the real fake-DOM, and pins:

     1. switchDecision, case by case — and the ORDER of the refusals, which is
        the policy (locked says nothing about which books exist; unknown beats
        dirty; asking for the open book is never a refusal);
     2. bookChoices — which books, in what order, under what name, and that a
        vault with no list has nothing to choose;
     3. the control: a single-book vault renders no visible switcher and no
        options; two books render both, the open one selected; a refusal is
        said, in the reader's language, and the select is not left lying;
        the drawer copy (the phone's switcher) is drawn from the same model
        as the top bar one and never disagrees with it;
     4. switchBook through the plugin:
          - ok: writes the per-device key (and ONLY that: no data.json write,
            budgetFolder untouched), reloads every open view, and tells the
            API's subscribers exactly once;
          - already open: a no-op — no write, no reload, no notification;
          - unknown / unlisted / listed-but-folder-gone: refused, nothing moves;
          - dirty: refused with the open book, the stored key AND the unsaved
            row all still there — the negative control is the same call with
            the row saved, which goes through;
          - locked: refused before anything is asked of the list; and once the
            splash is open a switch is allowed and does not re-lock;
     5. the loaded state: after a switch the loader holds book B's categories,
        accounts and transactions and NOTHING of book A's, the headless API's
        figure is B's, and switching back restores A's.

     node tests/books-switch.test.cjs */

const assert = require('assert');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const base = require('obsidian');
const { installDom } = require('./helpers/dom-stub.cjs');
const { SEED, B, TODAY } = require('./figures/household.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const books = require('../src/books');
const { switchDecision, bookChoices, OPEN_BOOK_KEY } = books;
const i18n = require('../src/i18n');

const ACME = 'Clients/Acme';
const ZETA = 'Clients/Zeta';
const LIST = [{ folder: ACME, label: 'Acme' }, { folder: ZETA, label: 'Zeta' }];

(async () => {
  /* ---- 1. switchDecision --------------------------------------------------- */
  {
    const base0 = { books: LIST, homeFolder: B, open: B, dirty: false, locked: false, folderExists: () => true };
    const d = over => switchDecision({ ...base0, ...over });

    eq(d({ target: ACME }), { ok: true, noop: false, folder: ACME, stored: ACME }, 'a listed book → ok, stored as the choice');
    eq(d({ target: B, open: ACME }), { ok: true, noop: false, folder: B, stored: null },
      'back to the home book → ok, and the choice is FORGOTTEN (null), not stored as the home folder');
    eq(d({ target: B }), { ok: true, noop: true, folder: B, stored: null }, 'the home book while it is open → a no-op');
    eq(d({ target: ACME, open: ACME }), { ok: true, noop: true, folder: ACME, stored: ACME }, 'the open client → a no-op');
    eq(d({ target: 'Clients/Acme/', open: ACME }).noop, true, 'a trailing slash is the same folder → still a no-op');
    eq(d({ target: 'Clients\\Zeta' }).folder, ZETA, 'backslashes are the same folder');

    eq(d({ target: 'Clients/Nobody' }), { ok: false, reason: 'unknown' }, 'a folder that is not a book → unknown');
    eq(d({ target: undefined }), { ok: false, reason: 'unknown' }, 'no target → unknown, not a throw');
    eq(d({ target: 42 }), { ok: false, reason: 'unknown' }, 'a non-string target → unknown');
    eq(d({ target: 'clients/acme' }), { ok: false, reason: 'unknown' },
      'not case-folded: Obsidian\'s lookups are exact, so a different case is a different (unlisted) folder');
    eq(switchDecision({ books: [], homeFolder: B, open: B, target: ACME }), { ok: false, reason: 'unknown' },
      'single-book mode: no book but the home book can be opened');
    eq(d({ target: ACME, folderExists: f => f !== ACME }), { ok: false, reason: 'unknown' },
      'listed but its folder is gone → unknown (activeFolder() would fall back to home: no claiming a switch that cannot happen)');
    let asked = [];
    d({ target: B, open: ACME, folderExists: f => { asked.push(f); return false; } });
    eq(asked, [], 'the home book\'s folder is never asked about — it opens whether or not it exists yet');
    eq(d({ target: ACME, folderExists: () => { throw new Error('vault gone'); } }), { ok: false, reason: 'unknown' },
      'a throwing folderExists is "not there"');

    eq(d({ target: ACME, dirty: true }), { ok: false, reason: 'dirty' }, 'unsaved edits → dirty');
    eq(d({ target: ACME, locked: true }), { ok: false, reason: 'locked' }, 'the splash up → locked');

    /* The order. */
    eq(d({ target: 'Clients/Nobody', locked: true }), { ok: false, reason: 'locked' },
      'locked BEFORE unknown: a locked caller learns nothing about which folders are books');
    eq(d({ target: ACME, locked: true, dirty: true }), { ok: false, reason: 'locked' }, 'locked beats dirty');
    eq(d({ target: 'Clients/Nobody', dirty: true }), { ok: false, reason: 'unknown' }, 'unknown beats dirty — a typo is reported as a typo');
    eq(d({ target: ACME, open: ACME, dirty: true }), { ok: true, noop: true, folder: ACME, stored: ACME },
      'asking for the open book while dirty is a no-op, not a refusal — nothing changes, so nothing can cross over');
  }

  /* ---- 2. bookChoices ------------------------------------------------------- */
  {
    const c0 = bookChoices({ books: [], homeFolder: B, homeName: 'The Smiths', openFolder: B });
    eq(c0.visible, false, 'no list (single-book mode) → nothing to choose → not visible');
    eq(c0.items.length, 1, '… one choice, the home book');
    eq(bookChoices({ books: [{ folder: B, label: 'Home' }], homeFolder: B, openFolder: B }).visible, false,
      'a list whose only entry IS the home book is still one choice');
    eq(bookChoices({ books: 'hand-edited', homeFolder: B, openFolder: B }).visible, false, 'a non-array list reads as none');

    const c = bookChoices({ books: LIST, homeFolder: B, homeName: 'The Smiths', openFolder: ACME + '/' });
    eq(c.visible, true, 'a list of books that are not the home book → visible');
    eq(c.items.map(i => [i.folder, i.label, i.home, i.active]),
      [[B, 'The Smiths', true, false], [ACME, 'Acme', false, true], [ZETA, 'Zeta', false, false]],
      'home first (named by its household), then the list in order; the open one marked, whatever its spelling');
    eq(c.active.label, 'Acme', '`active` is the open item');

    eq(bookChoices({ books: LIST, homeFolder: B, openFolder: B }).items[0].label, 'Budget', 'no household name → the folder\'s last segment');
    eq(bookChoices({ books: LIST, homeFolder: 'Finances/Our Budget', openFolder: B }).items[0].label, 'Our Budget', '… the LAST segment');
    eq(bookChoices({ books: LIST, homeFolder: '/', openFolder: '/', homeFallback: 'Home book' }).items[0].label, 'Home book',
      'a home book at the vault root has no segment → the fallback');
    const listedHome = bookChoices({ books: [{ folder: B, label: 'Personal' }, ...LIST], homeFolder: B, homeName: 'The Smiths', openFolder: B });
    eq(listedHome.items.map(i => i.label), ['Personal', 'Acme', 'Zeta'], 'a home book that is LISTED keeps the reader\'s label over its household name, once');
    eq(bookChoices({ books: [{ folder: ACME, label: '  ' }], homeFolder: B, openFolder: B }).items[1].label, 'Acme',
      'a blank label falls back to the folder name');
    eq(bookChoices({ books: [{ folder: ACME, label: 'Budget' }], homeFolder: B, openFolder: B }).items.map(i => i.label),
      ['Budget (Budget)', 'Budget (Clients/Acme)'], 'two books with one label are told apart by their folder');
    eq(bookChoices({ books: LIST, homeFolder: B, openFolder: 'Elsewhere' }).active, null, 'an open folder no book names → no active item, no crash');
  }

  /* ---- 3. the control ------------------------------------------------------- */
  installDom();
  const { renderBookSwitcher, pickBook } = require('../src/book-switcher');
  {
    const mk = () => {
      const wrap = document.createElement('label'); wrap.className = 'book-switch hidden';
      const select = document.createElement('select');
      return { wrap, select };
    };
    const single = mk();
    renderBookSwitcher(single.wrap, single.select, bookChoices({ books: [], homeFolder: B, openFolder: B }));
    ok(single.wrap.classList.contains('hidden'), 'single-book vault: the switcher stays hidden');
    eq(single.select.options.length, 0, '… and holds no options, so there is nothing for a screen reader to find');

    const two = mk();
    renderBookSwitcher(two.wrap, two.select, bookChoices({ books: LIST, homeFolder: B, homeName: 'The Smiths', openFolder: ACME }));
    ok(!two.wrap.classList.contains('hidden'), 'a vault with books: visible');
    eq(two.select.options.map(o => o.textContent), ['The Smiths', 'Acme', 'Zeta'], 'every book listed by label, home first');
    eq(two.select.options.map(o => o.attrs.value), [B, ACME, ZETA], '… carrying the folder as the value');
    eq(two.select.value, ACME, '… with the open book selected');

    renderBookSwitcher(two.wrap, two.select, bookChoices({ books: [], homeFolder: B, openFolder: B }));
    ok(two.wrap.classList.contains('hidden') && two.select.options.length === 0,
      'the list emptied (a book removed in settings): hidden again, and emptied');
    renderBookSwitcher(two.wrap, two.select, null);
    ok(two.wrap.classList.contains('hidden'), 'no model (privacy splash up) → hidden');

    /* The two copies — the top bar's and the drawer's that replaces it on a
       phone (tests/phone-375.test.cjs section 15 holds why) — drawn from ONE
       model by one call, so they can never show different books, different
       open books, or one visible and one not. Each wrapper is built with the
       class list the shell actually ships, read out of src/shell.js, so a
       copy that stopped shipping hidden would fail here too. */
    {
      const { renderBookSwitchers } = require('../src/book-switcher');
      const shellSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'shell.js'), 'utf8');
      const shipped = id => { const m = new RegExp(`<(?:label|div) class="([^"]*)" id="${id}">`).exec(shellSrc); return m ? m[1] : null; };
      const copy = id => {
        const wrap = document.createElement('div'); wrap.className = shipped(id) || '';
        return { wrap, select: document.createElement('select') };
      };
      const top = copy('bookSwitch'), drawer = copy('drawerBookSwitch');
      ok(top.wrap.classList.contains('hidden') && drawer.wrap.classList.contains('hidden'), 'both copies ship hidden (src/shell.js), so the first frame paints neither');
      const pairs = [[top.wrap, top.select], [drawer.wrap, drawer.select]];
      const same = () => top.select.options.map(o => `${o.attrs.value}=${o.textContent}`).join('|') === drawer.select.options.map(o => `${o.attrs.value}=${o.textContent}`).join('|')
        && top.select.value === drawer.select.value
        && top.wrap.classList.contains('hidden') === drawer.wrap.classList.contains('hidden');

      renderBookSwitchers(pairs, bookChoices({ books: [], homeFolder: B, openFolder: B }));
      ok(top.wrap.classList.contains('hidden') && drawer.wrap.classList.contains('hidden'), 'single-book vault: the drawer copy stays hidden with the top bar one');
      eq(drawer.select.options.length, 0, '… and is just as empty');

      renderBookSwitchers(pairs, bookChoices({ books: LIST, homeFolder: B, homeName: 'The Smiths', openFolder: B }));
      ok(!drawer.wrap.classList.contains('hidden') && same(), 'books added: both copies show, with the same list and the same open book');
      eq(drawer.select.value, B, '… the home book, as opened');

      /* A switch from either copy ends in applyBooks redrawing both: the copy
         that was NOT used follows. */
      renderBookSwitchers(pairs, bookChoices({ books: LIST, homeFolder: B, homeName: 'The Smiths', openFolder: ZETA }));
      ok(same() && top.select.value === ZETA, 'after a switch both copies say Zeta is open');

      /* refreshBookSwitchers → applyBooks after a settings write: a relabel
         reaches both. */
      renderBookSwitchers(pairs, bookChoices({ books: [{ folder: ACME, label: 'Acme Holdings' }, LIST[1]], homeFolder: B, homeName: 'The Smiths', openFolder: ZETA }));
      ok(same() && drawer.select.options.some(o => o.textContent === 'Acme Holdings'), 'a relabel in settings reaches the drawer copy as well as the top bar one');

      renderBookSwitchers(pairs, null);
      ok(same() && drawer.wrap.classList.contains('hidden') && drawer.select.options.length === 0,
        'privacy splash up: both copies hidden and emptied — a client\'s name is in neither');
    }

    /* pickBook: every refusal is said, in words, and ok is silent. */
    const said = [];
    const deps = { notify: m => said.push(m), t: i18n.t };
    for (const reason of ['unknown', 'dirty', 'locked']) {
      const r = await pickBook({ switchBook: async () => ({ ok: false, reason }) }, ACME, deps);
      eq(r, { ok: false, reason }, `pickBook hands back the refusal (${reason})`);
    }
    eq(said.length, 3, 'each refusal raised exactly one notice');
    eq(new Set(said).size, 3, '… each with its own sentence');
    ok(said.every(m => m && !/^books\.switch\./.test(m)), '… a real sentence, not a bare i18n key');
    ok(/unsaved/i.test(said[1]), 'the dirty notice says why: unsaved changes');
    eq((await pickBook({ switchBook: async () => ({ ok: true }) }, ACME, deps)).ok, true, 'ok passes through');
    eq(said.length, 3, '… without a notice');
    const quiet = console.error; console.error = () => {};
    const thrown = await pickBook({ switchBook: async () => { throw new Error('boom'); } }, ACME, deps);
    console.error = quiet;
    eq(thrown.ok, false, 'a switchBook that throws is a refusal the control survives');
    eq(said.length, 4, '… and is still told to the reader');

    /* Every language has all three sentences (the parity test holds the keys;
       this holds that they are not English left in place). */
    for (const lang of Object.keys(i18n.TABLES)) {
      if (lang === 'en') continue;
      for (const k of ['books.switch.unknown', 'books.switch.dirty', 'books.switch.locked', 'topbar.book', 'topbar.bookTitle', 'books.homeFallback']) {
        ok(i18n.TABLES[lang][k] && i18n.TABLES[lang][k] !== i18n.TABLES.en[k], `${lang}.${k} is translated, not copied from English`);
      }
    }
  }

  /* ---- 3b. the wiring no bare-node test can mount ---------------------------
     controller.js's mountApp needs a DOMParser shell, so the three facts that
     make the control work are pinned in the source, the way
     tests/controller-watcher-rename.test.cjs pins its own: the shell ships the
     switcher HIDDEN (so a single-book vault never paints it, even for the
     frame before the first render), a change goes through pickBook (the
     refusals are said), and connectVault redraws it (which covers a switch,
     whose reload ends there). */
  {
    const fs = require('fs'), path = require('path');
    const shell = fs.readFileSync(path.join(__dirname, '..', 'src', 'shell.js'), 'utf8');
    const ctl = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
    ok(/<label class="book-switch hidden" id="bookSwitch">/.test(shell), 'the shell ships #bookSwitch with the hidden class');
    ok(/<select id="bookSelect"/.test(shell), '… wrapping a native <select id="bookSelect">');
    ok(/<div class="drawer-book hidden" id="drawerBookSwitch">/.test(shell), 'the shell ships the drawer copy #drawerBookSwitch with the hidden class');
    ok(/<select id="drawerBookSelect"/.test(shell), '… wrapping its own native <select id="drawerBookSelect">');
    {
      /* The handler takes the select, not a change event: it is called by
         settleBookSelect once the reader has settled on a book, which is not
         every `change` (tests/book-switcher-commit.test.cjs). */
      const handler = /const onBookPicked = async select => \{([\s\S]*?)\n  \};/.exec(ctl);
      ok(handler && /pickBook\(plugin, select\.value/.test(handler[1]) && /applyBooks\(\)/.test(handler[1]),
        'a pick from either select goes through pickBook, which says every refusal, then redraws both copies');
      ok(/for \(const select of \[\$\('#bookSelect'\), \$\('#drawerBookSelect'\)\]\) \{\s*settleBookSelect\(select, \(\) => onBookPicked\(select\)/.test(ctl),
        '… and BOTH selects are wired to it, so the drawer copy is not a picker that does nothing');
      const apply = /async function applyBooks\(\) \{[\s\S]*?\n  \}/.exec(ctl);
      ok(apply && (apply[0].match(/renderBookSwitchers\(pairs, /g) || []).length === 2 && !/renderBookSwitcher\(/.test(apply[0]),
        'applyBooks draws every copy through renderBookSwitchers, both when locked (null) and with a model — never one copy alone');
      ok(/\[\$\('#bookSwitch'\), \$\('#bookSelect'\)\],\s*\[\$\('#drawerBookSwitch'\), \$\('#drawerBookSelect'\)\]/.test(ctl),
        'the copies applyBooks draws are the top bar\'s and the drawer\'s');
    }
    ok(/async function connectVault\(\) \{\s*applyBooks\(\)/.test(ctl), 'connectVault redraws the switcher, so every switch and reload ends in a fresh list');
    ok(/applyBooks,\s*\};/.test(ctl), 'the controller exposes applyBooks, which main.js refreshBookSwitchers() calls on a settings write');

    /* ---- 3c. the two gates section 4's stand-in controller re-spells -------
       (2026-11 review: this file claimed "the real dirty rule and the real
       decline-while-dirty reload" while running hand-copied ones.) Pinned in
       the source instead, so a change to either in controller.js turns this
       file red rather than leaving the stand-in testing a rule the app no
       longer has. */
    ok(/ctx\.registerDirty\(\(\) => Object\.values\(S\.txFiles\)\.some\(f => f\.dirty\)\);/.test(ctl),
      'controller.js counts a tx file with unsaved rows as dirty — the stand-in\'s first clause');
    ok(/ctx\.registerDirty\(\(\) => !!S\.pendingImport\);/.test(ctl), '… and a pending import — its second');
    ok(/function hasDirty\(\) \{\s*return dirtyChecks\.some\(fn => fn\(\)\);\s*\}/.test(ctl), '… over every registerDirty predicate — its third (ctx._dirty)');
    ok(/reload: async \(\) => \{\s*if \(hasDirty\(\)\) \{[\s\S]{0,120}return;\s*\}\s*await connectVault\(\);/.test(ctl),
      'ctl.reload() declines while dirty, else connectVault() — the stand-in\'s reload');
    ok(/async function connectVault\(\) \{[\s\S]{0,80}await doReloadFromDisk\(\);/.test(ctl)
      && /const doReloadFromDisk = \(\) => reloadFromDisk\(ctx, S, \$, disableSaveButtons\);/.test(ctl),
      'connectVault() reloads through the module-level reloadFromDisk() — the function the stand-in calls');
  }

  /* ---- 4-5. switchBook on the real plugin, over the real loader ------------- */
  class Plugin {
    constructor() { this._events = []; this.saved = []; this.stored = {}; }
    register(cb) { this._events.push(cb); }
    registerEvent(ref) { this.register(() => ref.e.offref(ref)); }
    registerDomEvent() {}
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
  const { reloadFromDisk } = require('../src/controller');
  const { buildApi } = require('../src/api');

  const tx = (rows) => '---\nkind: transactions\n---\n\n'
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

  /* One device: a vault holding the home household and two client books, a
     real plugin onto it, a real API, and one "open view" whose controller is a
     STAND-IN — mountApp needs a DOMParser shell no bare-node test can build
     (3b says so for the switcher too). What is real and what is re-spelled:
       - the reload runs controller.js's OWN module-level reloadFromDisk() —
         the function connectVault() calls, stale bracket and all — over the
         real loader. This ctx mounts no Budget page, so there is no budget
         draft for it to invalidate, and that one hook is a no-op;
       - the two closure-level gates are RE-SPELLED, because they live inside
         mountApp: hasDirty() (the views' registerDirty predicates plus the
         controller's own two — a tx file with unsaved rows, a pending
         import) and reload()'s decline-while-dirty. Section 3c pins those
         lines in controller.js's source, so the stand-in cannot drift from
         them without this file going red.
     `lock` turns the privacy splash on, as the setting does. */
  async function device({ lock = false, files = { ...SEED, ...ACME_FILES, ...ZETA_FILES }, settings = {} } = {}) {
    const vault = H.makeVault(files);
    const handlers = {};
    vault.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return { e: vault, name, fn }; };
    vault.offref = () => {};
    const kv = {};
    const log = { localWrites: [] };
    const leaves = [];
    const app = {
      vault,
      workspace: { onLayoutReady: cb => cb(), getLeavesOfType: () => leaves, on: () => ({}) },
      loadLocalStorage: k => (k in kv ? kv[k] : null),
      saveLocalStorage: (k, v) => { log.localWrites.push([k, v]); if (v === null) delete kv[k]; else kv[k] = v; },
    };
    const plugin = new BudgetPlugin();
    plugin.app = app;
    plugin.stored = { budgetFolder: B, onboarded: true, openOnStartup: false, books: LIST.map(b => ({ ...b })), privacyLock: lock, ...settings };
    await plugin.onload();
    const savedAtStart = plugin.saved.length;

    const ctx = H.makeCtx(files, { budgetFolder: B });
    ctx.vault = vault; ctx.app = app; ctx.plugin = plugin;
    await H.loadInto(ctx);
    const view = Object.create(BudgetView.prototype);
    if (typeof ctx.invalidateBudgetDraft !== 'function') ctx.provide({ invalidateBudgetDraft: () => {} });
    const ctl = {
      reloads: 0, declined: 0,
      hasDirty: () => ctx._dirty() || Object.values(ctx.S.txFiles).some(f => f.dirty) || !!ctx.S.pendingImport,
      reload: async () => {
        if (ctl.hasDirty()) { ctl.declined++; return; }
        ctl.reloads++;
        await reloadFromDisk(ctx, ctx.S, ctx.$, () => {});
      },
    };
    view.appCtl = ctl;
    leaves.push({ view });

    const api = plugin.api;
    let told = 0;
    api.onChange(() => { told++; });
    return { plugin, ctx, ctl, api, kv, log, told: () => told, vault, savedAtStart,
      names: () => ctx.S.categories.map(c => c.name).sort(),
      accounts: () => ctx.S.accounts.map(a => a.name).sort(),
      files: () => Object.keys(ctx.S.txFiles).sort(),
      key: () => (OPEN_BOOK_KEY in kv ? kv[OPEN_BOOK_KEY] : null) };
  }

  const unpin = pinClock(TODAY);
  try {
    /* ---- 4a. ok ---- */
    {
      const d = await device();
      ok(d.names().includes('Groceries') && !d.names().includes('Consulting'), 'fixture: the home book is loaded on this device');
      eq(d.plugin.activeFolder(), B, 'fixture: nothing stored → the home book is open');
      const before = await d.api.currentPeriod();

      const r = await d.plugin.switchBook(ACME);
      eq(r, { ok: true }, 'switching to a listed client → { ok: true }');
      eq(d.key(), ACME, 'the per-device key now names the client');
      eq(d.plugin.activeFolder(), ACME, 'activeFolder() — the seam every path goes through — follows');
      eq(d.plugin.settings.budgetFolder, B, 'the home book is NOT rewritten (ADR 0009 §1)');
      eq(d.plugin.saved.length, d.savedAtStart, 'and data.json is not written at all');
      eq(d.log.localWrites, [[OPEN_BOOK_KEY, ACME]], 'the only write anywhere is the per-device key');
      eq(d.ctl.reloads, 1, 'the open view was reloaded, once');
      eq(d.told(), 1, 'the API\'s subscribers were told, exactly once');

      /* ---- 5. the loaded state is B's and nothing of A's ---- */
      eq(d.names(), ['Consulting', 'Software'], 'the loader holds Acme\'s categories and none of the home book\'s');
      eq(d.accounts(), ['Operating'], '… Acme\'s accounts only');
      eq(d.files(), ['Operating/2026-09'], '… Acme\'s transaction files only');
      eq(d.ctx.S.settings.currency, '$', '… Acme\'s Settings.md (currency), not the household\'s "R"');
      eq(d.ctx.basePath(), ACME, 'and every relative path is rooted in Acme');
      const after = await d.api.currentPeriod();
      ok(after && before && JSON.stringify(after) !== JSON.stringify(before),
        'the headless API now answers with the client\'s figure, not the household\'s');
      eq(after.currency, { symbol: '$' }, '… in the client\'s currency');
      eq(d.told(), 1, 'reading the figure notifies nobody (a subscriber must not hear about its own read)');

      /* Switch to the other client, then home. */
      eq(await d.plugin.switchBook(ZETA + '/'), { ok: true }, 'client to client, whatever the spelling');
      eq(d.names(), ['Zed'], 'Zeta\'s categories, none of Acme\'s');
      eq(d.files(), [], '… and no transaction file of Acme\'s survives into a book that has none');
      eq(d.told(), 2, 'one notification per switch');
      eq(await d.plugin.switchBook(B), { ok: true }, 'back to the home book');
      eq(d.key(), null, 'the home book is stored as NO choice');
      ok(d.names().includes('Groceries') && !d.names().includes('Zed'), 'the household is back, whole');
      eq(d.told(), 3, 'and told once more');
    }

    /* ---- 4b. already open ---- */
    {
      const d = await device();
      const r = await d.plugin.switchBook(B);
      eq(r, { ok: true }, 'the home book while it is open → ok');
      eq(d.log.localWrites, [], '… without a write');
      eq(d.ctl.reloads, 0, '… without a reload');
      eq(d.told(), 0, '… without telling anyone');
      await d.plugin.switchBook(ACME);
      const reloads = d.ctl.reloads, told = d.told(), writes = d.log.localWrites.length;
      eq(await d.plugin.switchBook(ACME), { ok: true }, 'the open client again → ok');
      eq([d.ctl.reloads, d.told(), d.log.localWrites.length], [reloads, told, writes], '… and still nothing happens');
    }

    /* ---- 4c. unknown ---- */
    {
      const d = await device({ settings: { books: [...LIST, { folder: 'Clients/Gone', label: 'Gone' }] } });
      for (const bad of ['Clients/Nobody', 'Clients', '', undefined, null, 7, 'Clients/Gone']) {
        let r;
        try { r = await d.plugin.switchBook(bad); } catch (e) { r = { threw: e.message }; }
        eq(r, { ok: false, reason: 'unknown' }, `switchBook(${JSON.stringify(bad)}) is refused as unknown and never throws`);
      }
      eq([d.key(), d.plugin.activeFolder(), d.ctl.reloads, d.told(), d.log.localWrites.length], [null, B, 0, 0, 0],
        'every unknown refusal left the open book, the stored key, the views and the API untouched');
      ok(d.names().includes('Groceries'), '… and the household is still what is loaded');
      /* The listed-but-deleted book: the refusal is why — activeFolder() would
         have answered the home book, so ok would have been a claim the next
         paint contradicts. */
      eq(d.plugin.settings.books.some(b => b.folder === 'Clients/Gone'), true, 'the book is still listed (a refusal never edits the list)');
    }

    /* ---- 4d. dirty ---- */
    {
      const d = await device();
      eq(await d.plugin.switchBook(ACME), { ok: true }, 'fixture: Acme is open');
      const reloads = d.ctl.reloads, told = d.told(), writes = d.log.localWrites.length;
      const f = d.ctx.S.txFiles['Operating/2026-09'];
      ok(f, 'fixture: Acme\'s transaction file is loaded');
      const typed = { date: '2026-09-03', desc: 'Typed into Acme, unsaved', cat: 'Software', amount: -99 };
      f.rows.push(typed); f.dirty = true;
      const rowsBefore = f.rows.length;

      const r = await d.plugin.switchBook(B);
      eq(r, { ok: false, reason: 'dirty' }, 'unsaved rows in the open book → { ok: false, reason: "dirty" }');
      eq(d.key(), ACME, 'the stored choice is unchanged');
      eq(d.plugin.activeFolder(), ACME, 'the open book is unchanged');
      eq(d.ctl.reloads, reloads, 'no view was reloaded');
      eq(d.ctl.declined, 0, 'no view was even ASKED to (the dirty check precedes the write, not ctl.reload\'s own decline)');
      eq(d.told(), told, 'the API\'s subscribers were not told');
      eq(d.log.localWrites.length, writes, 'nothing was written to the device store — not even written and rolled back');
      ok(d.ctx.S.txFiles['Operating/2026-09'] === f && f.dirty === true, 'the dirty state is intact');
      eq(f.rows.length, rowsBefore, 'the unsaved row is still there');
      ok(f.rows.includes(typed), '… the very object the reader typed');
      ok(d.ctx.basePath() === ACME && !d.vault.getFileByPath(`${B}/Transactions/Operating/2026-09.md`),
        'and a Save now would still land in Acme (basePath unchanged, nothing written to the household)');

      /* The other dirty source in controller.js: an import under review. */
      f.dirty = false;
      d.ctx.S.pendingImport = { rows: [] };
      eq((await d.plugin.switchBook(B)).reason, 'dirty', 'a pending import review is unsaved work too');
      d.ctx.S.pendingImport = null;

      /* NEGATIVE CONTROL: the same call with nothing unsaved goes through, so
         the refusal above was the dirty state and nothing else. */
      eq(await d.plugin.switchBook(B), { ok: true }, 'NEGATIVE CONTROL: the identical switch with the row saved succeeds');
      eq(d.plugin.activeFolder(), B, '… and the home book opens');
    }

    /* ---- 4e. locked ---- */
    {
      const d = await device({ lock: true });
      eq(d.plugin.budgetUnlocked, false, 'fixture: the splash is up and has not been opened this session');
      eq(await d.plugin.switchBook(ACME), { ok: false, reason: 'locked' }, 'a listed book while locked → locked');
      eq(await d.plugin.switchBook('Clients/Nobody'), { ok: false, reason: 'locked' },
        'an UNLISTED folder while locked → also locked, so the answer never says which folders are books');
      eq(await d.plugin.switchBook(B), { ok: false, reason: 'locked' }, 'even the book that is open → locked (it would confirm the list)');
      eq([d.key(), d.ctl.reloads, d.told(), d.log.localWrites.length], [null, 0, 0, 0], 'nothing moved');

      d.plugin.setBudgetUnlocked(true);
      const toldOnUnlock = d.told();   // opening the splash is itself a lock event the API announces
      eq(toldOnUnlock, 1, 'fixture: opening the splash told the API once, on its own account');
      eq(await d.plugin.switchBook(ACME), { ok: true }, 'once the splash has been opened this session a switch is allowed');
      eq(d.plugin.budgetUnlocked, true, '… and the privacy lock is NOT re-engaged by it');
      eq(d.plugin.settings.privacyLock, true, '… the setting itself is untouched');
      eq(d.told(), toldOnUnlock + 1, 'the API is told of the switch (it is unlocked), once');
      eq(await d.plugin.switchBook(B), { ok: true }, '… and a second switch needs no second tap');
    }

    /* ---- 4f. ordering and the plumbing around it ---- */
    {
      const d = await device();
      const order = [];
      d.api.onChange(() => order.push(['told', d.ctl.reloads]));
      await d.plugin.switchBook(ACME);
      eq(order, [['told', 1]], 'subscribers are told AFTER the views have reloaded, so a re-read sees the new book');

      let applied = 0;
      d.ctl.applyBooks = () => { applied++; };
      await d.plugin.saveSettings();
      ok(applied >= 1, 'a settings write redraws every open switcher — the book list changes through one, with no reload');
      delete d.ctl.applyBooks;
      await d.plugin.saveSettings();
      ok(true, 'a controller with no applyBooks (older view mid-mount) is skipped, not thrown at');

      eq(await d.plugin.homeBookName(), '', 'no household in the home Settings.md → no name');
    }
    {
      const smiths = { ...SEED, [`${B}/Settings.md`]: SEED[`${B}/Settings.md`].replace('---\n', '---\nhousehold: The Smiths\n') };
      ok(/household: The Smiths/.test(smiths[`${B}/Settings.md`]), 'fixture: the home Settings.md names its household');
      const d = await device({ files: { ...smiths, ...ACME_FILES, ...ZETA_FILES } });
      eq(await d.plugin.homeBookName(), 'The Smiths', 'the home book\'s household name is read from its own Settings.md');
      await d.plugin.switchBook(ACME);
      eq(await d.plugin.homeBookName(), 'The Smiths',
        '… even while a client is open (the label must not become the client\'s household)');
      const labels = bookChoices({ books: d.plugin.settings.books, homeFolder: d.plugin.allBookFolders()[0],
        homeName: await d.plugin.homeBookName(), openFolder: d.plugin.activeFolder() }).items.map(i => i.label);
      eq(labels, ['The Smiths', 'Acme', 'Zeta'], 'so the switcher lists the household, Acme and Zeta, from the plugin\'s own answers');
    }
  } finally { unpin(); Module._load = prevLoad; }

  console.log(`PASS books-switch — one safe switch path: refusals in their order, key-only write, reload (controller's reloadFromDisk; its dirty gates source-pinned), API told once, B's state and nothing of A's, no switcher in a single-book vault (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
