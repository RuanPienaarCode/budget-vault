'use strict';
/* Books — which folder is open, and the guards that keep two books apart
   (ADR 0009, issue #166).

   A vault may hold several books; exactly one is open on a device. The rule is
   one sentence — the stored choice if it is listed AND still exists, else the
   home book — and every way of getting it wrong writes one client's rows into
   another client's files. So this pins, against the REAL code:

     1. resolveOpenBook, case by case: empty list → home; stored, listed and
        present → stored; stored but removed from the list → home; stored but
        its folder deleted → home; stored IS home → home; spellings of one
        folder (trailing slash, backslashes, NFC) are one folder; and the
        fallback never lands on an unlisted folder or on some OTHER listed one;
     2. the per-device store: Obsidian's vault-scoped loadLocalStorage when the
        host has it, window.localStorage under a vault-specific key otherwise,
        nothing at all without a vault id, and a throwing store reads as
        "no choice" rather than taking down every path the app builds;
     3. data.json: an empty book list is never written (single-book mode
        writes no new key), a real one is, and the frozen default cannot be
        pushed onto — driven through main.js's own loadSettings / saveData;
     4. the export guard refuses every book's managed folders, not only the
        open one's — open book A, export into B's Transactions/ → managed;
        and NEGATIVE CONTROL, an ordinary folder is still accepted;
     5. the seam end to end: with a second book open, the real loader reads
        THAT book's files and settingsMdPath() names its Settings.md, and the
        home book is untouched.

     node tests/books.test.cjs */

const assert = require('assert');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();
const base = require('obsidian');
const { SEED, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const books = require('../src/books');
const { resolveOpenBook, normalizeFolder, bookFolders, allBookFolders, persistableSettings,
  readStoredBook, writeStoredBook, OPEN_BOOK_KEY } = books;

const ACME = 'Clients/Acme';
const ZETA = 'Clients/Zeta';
const LIST = [{ folder: ACME, label: 'Acme' }, { folder: ZETA, label: 'Zeta' }];
const exists = (...present) => f => present.includes(f);

(async () => {
  /* ---- 1. resolveOpenBook ------------------------------------------------- */
  {
    const asked = [];
    const spy = f => { asked.push(f); return true; };
    eq(resolveOpenBook({ books: [], homeFolder: B, stored: ACME, folderExists: spy }), B,
      'empty list (single-book mode) → the home book, whatever is stored');
    eq(asked, [], '… and the vault is never asked, so single-book mode costs no lookup');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: null, folderExists: spy }), B,
      'nothing stored on this device → the home book');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: ACME, folderExists: exists(ACME) }), ACME,
      'stored, listed and present → the stored book');
    eq(resolveOpenBook({ books: [{ folder: ZETA, label: 'Zeta' }], homeFolder: B, stored: ACME, folderExists: exists(ACME, ZETA) }), B,
      'stored but removed from the list → the home book, even though the folder is still there');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: ACME, folderExists: exists(ZETA) }), B,
      'stored but its folder deleted or renamed → the home book');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: B, folderExists: () => false }), B,
      'stored IS the home book → the home book, whether or not its folder exists yet');
    eq(resolveOpenBook({ books: [], homeFolder: 'Finances/Budget', stored: undefined }), 'Finances/Budget',
      'no folderExists and nothing stored is fine');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: ACME }), B,
      'no folderExists given → nothing is confirmed present → the home book');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: ACME, folderExists: () => { throw new Error('vault gone'); } }), B,
      'a folderExists that throws → the home book, never a crash');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: 'Clients/Unlisted', folderExists: () => true }), B,
      'an unlisted folder that exists is NEVER opened — a folder becomes a book only by being added');

    /* Normalisation: one folder, several spellings. */
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: 'Clients/Acme/', folderExists: exists(ACME) }), ACME,
      'a stored trailing slash is the listed folder');
    eq(resolveOpenBook({ books: [{ folder: '/Clients//Acme/', label: 'Acme' }], homeFolder: B, stored: 'Clients\\Acme', folderExists: exists(ACME) }), ACME,
      'leading, doubled and back-slashes on either side are the same folder, returned normalised');
    eq(resolveOpenBook({ books: LIST, homeFolder: 'Budget/', stored: ' Budget ' }), B,
      'the home book compares normalised too');
    const nfc = 'Clients/B\u00e9groting', nfd = 'Clients/Be\u0301groting';
    ok(nfc !== nfd && nfc === nfd.normalize('NFC'), 'fixture: one name, two Unicode spellings');
    eq(resolveOpenBook({ books: [{ folder: nfd, label: 'B' }], homeFolder: B, stored: nfc, folderExists: exists(nfc) }), nfc,
      'a decomposed listing and a composed stored choice are one folder (NFC)');
    eq(resolveOpenBook({ books: LIST, homeFolder: B, stored: 'clients/acme', folderExists: () => true }), B,
      'NOT case-folded: Obsidian looks folders up by exact key, and the safe miss is the home book');
    eq(normalizeFolder('/'), '', 'the vault root is "" here (main.js maps it to normalizePath\'s "/")');
    eq(normalizeFolder('A B/'), 'A B', 'a non-breaking space reads as a space, as normalizePath does');

    /* A hand-edited data.json must not break boot. */
    eq(bookFolders('Clients/Acme'), [], 'a books value that is not an array lists nothing');
    eq(bookFolders([null, 7, { label: 'no folder' }, { folder: 3 }, { folder: ACME }, { folder: ACME + '/' }]), [ACME],
      'junk entries are skipped and duplicates collapse');
    eq(resolveOpenBook({ books: { folder: ACME }, homeFolder: B, stored: ACME, folderExists: () => true }), B,
      'a malformed list is single-book mode');
    eq(allBookFolders({ books: LIST, homeFolder: B }), [B, ACME, ZETA], 'every book, home first');
    eq(allBookFolders({ books: [{ folder: B }, { folder: ACME }], homeFolder: B }), [B, ACME], 'the home book listed again appears once');
    eq(allBookFolders({ books: [], homeFolder: B }), [B], 'single-book mode: just the home book');
  }

  /* ---- 2. the per-device store ------------------------------------------- */
  {
    const memStore = () => {
      const m = new Map();
      return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    };

    // Obsidian ≥ 1.8.7: the host's vault-scoped helpers win.
    const kv = {};
    const host = {
      loadLocalStorage: k => (k in kv ? kv[k] : null),
      saveLocalStorage: (k, v) => { if (v === null) delete kv[k]; else kv[k] = v; },
    };
    const unused = memStore();
    eq(readStoredBook(host, () => unused), null, 'nothing stored yet');
    eq(writeStoredBook(host, () => unused, 'Clients/Acme/'), true, 'stored through saveLocalStorage');
    eq(kv[OPEN_BOOK_KEY], ACME, '… normalised, under the plugin\'s key');
    eq(readStoredBook(host, () => unused), ACME, 'and read back through loadLocalStorage');
    eq(unused.m.size, 0, 'window.localStorage is not touched when the host has its own');
    eq(writeStoredBook(host, () => unused, null), true, 'null forgets the choice');
    eq(readStoredBook(host, () => unused), null, '… and it is gone');
    kv[OPEN_BOOK_KEY] = { not: 'a folder' };
    eq(readStoredBook(host, () => unused), null, 'a stored non-string is no choice');

    // Obsidian 1.8.0–1.8.6: window.localStorage, keyed by THIS vault.
    const ls = memStore();
    const vaultA = { appId: 'vault-a' }, vaultB = { appId: 'vault-b' };
    eq(writeStoredBook(vaultA, () => ls, ACME), true, 'falls back to window.localStorage');
    eq(ls.m.get(`${OPEN_BOOK_KEY}:vault-a`), ACME, '… under a key carrying the vault id');
    eq(readStoredBook(vaultA, () => ls), ACME, 'read back in the same vault');
    eq(readStoredBook(vaultB, () => ls), null, 'another vault on the same device does not see it');
    const named = { vault: { getName: () => 'Household' } };
    eq(writeStoredBook(named, () => ls, ZETA), true, 'no appId: the vault name keys it');
    eq(ls.m.get(`${OPEN_BOOK_KEY}:Household`), ZETA, '… as `<key>:<vault name>`');
    writeStoredBook(vaultA, () => ls, null);
    ok(!ls.m.has(`${OPEN_BOOK_KEY}:vault-a`), 'null removes the key');

    const anon = {};
    eq(writeStoredBook(anon, () => ls, ACME), false, 'no vault id at all → nothing is written (it could collide with another vault)');
    eq(readStoredBook(anon, () => ls), null, '… and nothing is read');

    const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };
    eq(readStoredBook(vaultA, () => throwing), null, 'a store that throws on read is "no choice"');
    eq(writeStoredBook(vaultA, () => throwing, ACME), false, 'a store that throws on write reports false');
    eq(readStoredBook(vaultA, () => { throw new Error('window.localStorage denied'); }), null, 'even touching window.localStorage may throw — guarded');
    eq(readStoredBook({ loadLocalStorage() { throw new Error('x'); } }, null), null, 'a throwing host helper is "no choice"');
    eq(writeStoredBook({ saveLocalStorage() { throw new Error('x'); } }, null, ACME), false, '… and a throwing host writer reports false');
  }

  /* ---- 3. data.json: no new key in single-book mode ------------------------ */
  {
    eq(persistableSettings({ budgetFolder: B, books: [] }), { budgetFolder: B }, 'an empty list is dropped from what is written');
    const real = { budgetFolder: B, books: LIST };
    ok(persistableSettings(real) === real, 'a real list is written as-is');
    const odd = { budgetFolder: B, books: 'hand-edited' };
    ok(persistableSettings(odd) === odd, 'a non-array is not ours to quietly correct');

    /* Through main.js itself, with Obsidian's Plugin as far as these methods
       reach into it (the same shape tests/api-privacy-lock.test.cjs uses). */
    class Plugin {
      constructor() { this.saved = []; this.stored = {}; }
      async loadData() { return this.stored; }
      async saveData(d) { this.saved.push(JSON.parse(JSON.stringify(d))); }
    }
    const prevLoad = Module._load;
    Module._load = function (req, ...rest) {
      if (req === 'obsidian') return { ...base, Plugin };
      return prevLoad.call(this, req, ...rest);
    };
    const BudgetPlugin = require('../src/main');
    const { DEFAULT_SETTINGS } = require('../src/constants');

    const p = new BudgetPlugin();
    const v159 = { budgetFolder: B, onboarded: true, theme: 'dark' };
    p.stored = { ...v159 };
    await p.loadSettings();
    eq(p.settings.books, [], 'a 1.59 data.json loads as single-book mode');
    ok(p.settings.books !== DEFAULT_SETTINGS.books, '… with its own list, not the shared default');
    ok(Object.isFrozen(DEFAULT_SETTINGS.books), 'the default list is frozen');
    assert.throws(() => DEFAULT_SETTINGS.books.push({ folder: 'x' }), TypeError); checks++;
    await p.saveSettings();
    ok(!('books' in p.saved[0]), 'saveSettings() writes no `books` key for a single-book vault');
    p.settings.theme = 'light';
    await p.saveData(p.settings);
    ok(!('books' in p.saved[1]), 'nor does the 1.13 settings tab, which calls saveData() directly');
    eq(p.settings.books, [], '… while the in-memory settings keep their list');
    eq(Object.keys(p.saved[1]).sort(), Object.keys(p.settings).filter(k => k !== 'books').sort(),
      'the only key dropped is `books`');

    p.settings.books.push({ folder: ACME, label: 'Acme' });
    await p.saveSettings();
    eq(p.saved[2].books, [{ folder: ACME, label: 'Acme' }], 'once a book is added, the list is written');
    eq(p.saved[2].budgetFolder, B, 'and the home book is still the home book');

    /* activeFolder() through the real class: home by default; the stored book
       once listed and present; setOpenBookLocal() writes local storage only. */
    const kv = {};
    const vault = H.makeVault({ [`${ACME}/Settings.md`]: '---\ncurrency: "R"\n---\n', [`${B}/Settings.md`]: '---\n---\n' });
    p.app = {
      vault,
      loadLocalStorage: k => (k in kv ? kv[k] : null),
      saveLocalStorage: (k, val) => { if (val === null) delete kv[k]; else kv[k] = val; },
    };
    eq(p.activeFolder(), B, 'nothing stored → activeFolder() is the home book');
    const savesBefore = p.saved.length;
    eq(p.setOpenBookLocal(ACME), true, 'setOpenBookLocal stores the choice');
    eq(p.saved.length, savesBefore, '… without a data.json write');
    eq(p.settings.budgetFolder, B, '… and without touching the home book');
    eq(p.activeFolder(), ACME, 'activeFolder() is now the open book');
    eq(p.settingsMdPath(), `${ACME}/Settings.md`, 'settingsMdPath() follows it');
    ok(p.hasBudgetData(), 'hasBudgetData() asks of the open book');
    eq(p.allBookFolders(), [B, ACME], 'allBookFolders() is every book, home first');
    p.settings.books = [];
    eq(p.activeFolder(), B, 'the list emptied → single-book mode → home, whatever is stored');
    p.settings.books = [{ folder: ACME, label: 'Acme' }];
    p.settings.budgetFolder = '';
    p.setOpenBookLocal(null);
    eq(p.activeFolder(), base.normalizePath(''),
      'a home book at the vault root resolves to normalizePath("") — "/" in Obsidian, as basePath() always saw it');
    Module._load = prevLoad;
  }

  /* ---- 4. the export guard refuses every book ------------------------------ */
  {
    const { destinationProblem: dp } = require('../src/io');
    const managed = folder => ({ kind: 'managed', folder });
    const all = { budgetFolder: ACME, budgetFolders: [B, ACME, ZETA] };
    eq(dp(`${ZETA}/Transactions`, all), managed('Transactions'), 'open book Acme, export into Zeta\'s Transactions/ → refused');
    eq(dp(`${B}/categories/x`, all), managed('Categories'), 'the home book\'s managed folders too, in any case');
    eq(dp(`${ACME}/Budgets`, all), managed('Budgets'), 'and the open book\'s own, as before');
    eq(dp('Clients/Reports', all), null, 'NEGATIVE CONTROL: an ordinary folder beside the books is still accepted');
    eq(dp(`${ZETA}/Exports`, all), null, '… and so is a non-managed folder inside another book');
    eq(dp(`${ZETA}/Transactions`, { budgetFolder: ACME }), null,
      'without the list only the open book is guarded — which is the hole budgetFolders closes');
    eq(dp('Categories', { budgetFolders: [B] }), null, 'with only the list, the vault root is not implicitly a book');

    /* The ctx-bound guard, as every view calls it: open book Acme on this
       device, Zeta listed, home is Budget. */
    const ctx = H.makeCtx({ ...SEED }, { budgetFolder: B });
    const kv = { [OPEN_BOOK_KEY]: ACME };
    ctx.plugin.settings.books = LIST;
    ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in kv ? kv[k] : null), saveLocalStorage() {} };
    await ctx.vault.createFolder(ACME);
    require('../src/io')(ctx);
    eq(ctx.basePath(), ACME, 'fixture: the open book is Acme');
    eq(ctx.destinationProblem(`${ZETA}/transactions/2026`), managed('Transactions'), 'ctx guard: another listed book\'s Transactions/ is refused');
    eq(ctx.destinationProblem(`${B}/Accounts`), managed('Accounts'), 'ctx guard: the home book\'s managed folders are refused while a client is open');
    eq(ctx.destinationProblem(`${ACME}/Notes`), managed('Notes'), 'ctx guard: the open book\'s own');
    eq(ctx.destinationProblem('Exports'), null, 'ctx guard NEGATIVE CONTROL: an ordinary folder is fine');
  }

  /* ---- 5. the seam end to end: the loader reads the open book ------------- */
  {
    const acmeFiles = {
      [`${ACME}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${ACME}/Categories/Consulting.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    };
    const files = { ...SEED, ...acmeFiles };
    const names = ctx => ctx.S.categories.map(c => c.name).sort();

    const home = H.makeCtx(files, { budgetFolder: B });
    home.plugin.settings.books = LIST;
    home.plugin.app = { vault: home.vault, loadLocalStorage: () => null, saveLocalStorage() {} };
    await H.loadInto(home);
    ok(names(home).includes('Groceries') && !names(home).includes('Consulting'),
      'nothing stored: the home book loads, and only the home book');

    const kv = { [OPEN_BOOK_KEY]: ACME };
    const open = H.makeCtx(files, { budgetFolder: B });
    open.plugin.settings.books = LIST;
    open.plugin.app = { vault: open.vault, loadLocalStorage: k => (k in kv ? kv[k] : null), saveLocalStorage() {} };
    await H.loadInto(open);
    eq(names(open), ['Consulting'], 'Acme open: the real loader reads Acme\'s categories and none of the home book\'s');
    eq(open.basePath(), ACME, 'and every relative path is rooted there');

    await open.writeFile('Categories/Retainer.md', '---\ntype: income\n---\n');
    ok(!!open.vault.getFileByPath(`${ACME}/Categories/Retainer.md`), 'a write lands in the open book');
    ok(!open.vault.getFileByPath(`${B}/Categories/Retainer.md`), '… and never in the home book');

    delete kv[OPEN_BOOK_KEY];
    eq(open.basePath(), B, 'the choice forgotten: the very next path is the home book again (resolved per call)');
  }

  /* ---- 6. a hand-edited entry cannot make the vault root (or worse) a book ---
     (review note 6). validateNewBook refuses '', '..', and dot-folders at Add
     time, but data.json is a file anyone can edit, and bookFolders() took any
     string. `{ folder: "" }` normalised to the vault root; folderExists('/') is
     always true; so a stored choice of '' opened the WHOLE VAULT as a book —
     one that contains every other book, and whose Categories/ is whatever
     happens to sit at the top of the vault. The pure helpers now drop such an
     entry from the list, so it can be neither opened nor guarded as a book. */
  {
    const bad = [{ folder: '', label: 'Everything' }, { folder: '/', label: 'Slash' }, { folder: '../Outside', label: 'Up' },
      { folder: 'Clients/../..', label: 'Climb' }, { folder: '.hidden/Book', label: 'Hidden' }, { folder: 'Clients/.trash', label: 'Trash' }];
    const list = [...bad, ...LIST];
    eq(bookFolders(list), [ACME, ZETA], 'bookFolders drops the root, a traversal and a hidden folder — keeping the real books');
    for (const b of bad) {
      eq(resolveOpenBook({ books: list, homeFolder: B, stored: b.folder, folderExists: () => true }), B,
        `a stored choice of ${JSON.stringify(b.folder)} opens the HOME book, not the folder (even though it "exists")`);
    }
    eq(resolveOpenBook({ books: list, homeFolder: B, stored: ACME, folderExists: () => true }), ACME,
      'NEGATIVE CONTROL: a real listed book beside them still opens');
    eq(allBookFolders({ books: list, homeFolder: B }), [B, ACME, ZETA], 'the export guard\'s list carries only real books');
    const choices = books.bookChoices({ books: list, homeFolder: B, openFolder: B, homeFallback: 'Home' });
    eq(choices.items.map(i => i.folder), [B, ACME, ZETA], 'the switcher offers only real books');
    eq(books.switchDecision({ books: list, homeFolder: B, open: B, target: '', folderExists: () => true }), { ok: false, reason: 'unknown' },
      'and switching to "" is refused as unknown');
    /* A home book AT the vault root is still the home book: the root is only
       refused as a LISTED entry, never as budgetFolder (today's behaviour for a
       budget kept at the top of the vault). */
    eq(resolveOpenBook({ books: [{ folder: '', label: 'Root' }], homeFolder: '', stored: null }), '', 'a home book at the root still opens');
    eq(books.bookChoices({ books: [{ folder: '', label: 'Root' }], homeFolder: '', openFolder: '', homeFallback: 'Home' }).items.map(i => i.label), ['Root'],
      '… and keeps the label its own list entry gives it');

    /* End to end through the plugin's seam: the stored choice is '', the
       folder "exists" (the root always does), and the open book is the home. */
    const kv = { [OPEN_BOOK_KEY]: '' };
    const ctx = H.makeCtx({ ...SEED }, { budgetFolder: B });
    ctx.plugin.settings.books = [{ folder: B, label: 'Home' }, { folder: '', label: 'Everything' }];
    ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in kv ? kv[k] : null), saveLocalStorage() {} };
    eq(ctx.plugin.activeFolder(), B, 'plugin.activeFolder() with a stored "" and a listed "" → the home book');
  }

  console.log(`PASS books — open book resolution, per-device store, no new data.json key, every book guarded, the loader follows the seam (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
