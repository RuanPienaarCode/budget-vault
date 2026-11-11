'use strict';
/* The vault watcher sees a book at the vault root — and only the book
   (2026-11-11 audit, task 2, the watcher half).

   WHY THIS CAME FIRST. A root book's writes were refused on purpose (io.js
   withinBudget, tests/root-book.test.cjs section 3) for one reason: every
   watcher in the app asked "is this change in the budget?" with a hand-spelled
   prefix — `p === base || p.startsWith(base + '/')` — and a root book's base
   is '/' in Obsidian ('' in the harness), which no vault path starts with. So
   every event in a root book was dropped before io.observeChange heard it: no
   stale mark, no reload, and a Save there would have overwritten a phone's
   row with nothing to refuse it.

   AND WHY "SEES THE ROOT" IS NOT "SEES THE VAULT". The patch that was handed
   over spelled the question through io.js insideBook, which at the root is
   true of every path in the vault. That is the right answer to "did this path
   climb out?" and the wrong one to "is this the budget's file?": a root book
   shares its folder with the reader's daily notes, and a watcher that owned
   them would re-read the whole budget after every save of any note, and mark
   that note stale. io.js bookOwns is the narrower question — the six files
   and nine folders this app keeps in a book — and it is the ONE predicate the
   watchers and the write containment both ask.

   What this suite pins, under the harness's normalizePath and under
   Obsidian 1.15.0's (see tests/root-book.test.cjs for where that was read):

     1. bookOwns: at the root, the book's files and folders and nothing else;
        in a folder, exactly insideBook — and the two lists are the names the
        rest of src/ actually spells, found by reading it;
     2. fsChangeInBudget at the root: a change, a rename in, a rename out and a
        folder rename are the budget's; a note that merely lives in the vault
        is not; and for a book in a folder the answer is the old prefix's, on
        every path in a corpus;
     3. classifyRename at the root, and unchanged in a folder;
     4. end to end over the real io: an external edit to a root book's file,
        delivered the way the controller delivers it, is marked stale; an edit
        to somebody else's note is never handed to io at all;
     5. the headless API's watcher (api.js underBudget) tells a subscriber
        about the first and not about the second;
     6. the Notes page's "is this path taken?" (views/notes.js taken()) reads
        a root book's Notes/ by its real paths.

     node tests/root-book-watcher.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();

/* Obsidian 1.15.0's normalizePath, and the per-call flavour switch — both as
   in tests/root-book.test.cjs, whose header says where they come from. */
const obsidianNormalize = p => {
  let o = String(p).replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (o === '') o = '/';
  return o.replace(/ | /g, ' ').normalize('NFC');
};
const stubNormalize = require('obsidian').normalizePath;
const flavour = { fn: stubNormalize };
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const answers = [];
const prevLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  /* The New note dialog, answered from a queue (section 6): src/modal.js is
     the only Obsidian-only piece between addNote and the vault. */
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(req)) {
    return { askFields: async () => (answers.length ? answers.shift() : null), confirmModal: async () => false };
  }
  const m = prevLoad.call(this, req, parent, ...rest);
  return req === 'obsidian' ? { ...m, normalizePath: p => flavour.fn(p) } : m;
};

const io = require('../src/io');
const { makeIo, insideBook, bookOwns, bookOwnsPath, BOOK_FILES, BOOK_FOLDERS } = io;
const { collapsePath } = require('../src/vault-path');
const { fsChangeInBudget, classifyRename } = require('../src/controller');
const { buildApi } = require('../src/api');
const { pinClock } = require('./helpers/figures.cjs');
const { SEED, B, TODAY } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const settle = ms => new Promise(r => setTimeout(r, ms));
const f = p => ({ path: p });
const atRoot = files => Object.fromEntries(Object.entries(files).map(([k, v]) => [k.slice(B.length + 1), v]));

const FLAVOURS = [
  ['harness stub (root is "")', stubNormalize, ''],
  ['Obsidian 1.15.0 (root is "/")', obsidianNormalize, '/'],
];

/* The reader's own vault, around a budget at its root. None of it is the
   book's — including the ones that look nearly like it. */
const NOT_THE_BOOKS = [
  'Journal/2026-11-12.md', 'README.md', 'Daily/Settings.md', 'Projects/Transactions/2026-07.md',
  'Projects/Budget/Categories/Food.md', 'Categories.md', 'Settings', 'Settings.md/x.md', 'My Settings.md',
  'Transactions 2025/Cheque/2025-12.md', 'Exports/2026-09 transactions.csv', 'Reports/2026-09 Financial Report.md',
  '.obsidian/app.json', '.obsidian/plugins/budget-app/data.json', '.trash/Food.md', 'Attachments/irp5.pdf',
];
const THE_BOOKS = [
  'Settings.md', 'Exchange Rates.md', 'Owed Money.md', 'Debts.md', 'Assets.md', 'Services.md',
  'Categories/Food.md', 'Accounts/Cheque.md', 'Accounts/Closed/Old card.md', 'Budgets/2026-09.md', 'Plans/Holiday.md',
  'Tax/2026.md', 'Tax/2026/irp5.pdf', 'Transactions/Cheque/2026-07.md', 'Transactions/Closed/Old card/2026-08.md',
  'Notes/2026/Car service.md', 'Receipts/2026-09/Checkers.md', 'Receipts/Food Items.md',
  'Data/Categorisation Rules.csv', 'Data/Deleted transactions.csv',
  /* A book folder on its own: renamed or deleted, it takes every file in it. */
  'Transactions', 'Categories', 'Notes',
];

(async () => {
  /* ---- 1. what a book owns ---- */
  {
    const owns = (base, p) => bookOwns(base, collapsePath(p));
    for (const root of ['', '/']) {
      const at = JSON.stringify(root);
      for (const p of THE_BOOKS) ok(owns(root, p), `T2: a book at ${at} owns ${p}`);
      for (const p of NOT_THE_BOOKS) ok(!owns(root, p), `T2: a book at ${at} does NOT own ${p} — it merely lives in the same vault`);
      /* The way the filesystem compares: one folder on APFS and iOS. */
      for (const p of ['categories/Food.md', 'TRANSACTIONS/Cheque/2026-07.md', 'settings.md', 'owed money.md'])
        ok(owns(root, p), `T2: …and ${p}, which macOS and iOS resolve onto the book's own`);
      for (const p of ['../Settings.md', 'Notes/../../Settings.md', '..'])
        ok(!owns(root, p), `T2: ${p} climbs out of the vault — nobody's`);
      ok(owns(root, 'Journal/../Settings.md'), 'T2: a path that dips and comes back is judged where it lands');
      ok(!owns(root, ''), 'T2: the vault root itself is not a file of the book');
      for (const junk of [null, undefined, '', 0, {}, ['Settings.md']])
        ok(!bookOwnsPath(root, junk), `T2: ${JSON.stringify(junk)} is no path, and nobody's`);
      ok(bookOwnsPath(root, 'Settings.md') && !bookOwnsPath(root, 'Journal/x.md'), 'T2: bookOwnsPath is bookOwns for a path as an event hands it over');
    }
    /* In a folder, nothing changed: the folder is the budget's, all of it. */
    for (const base of ['Budget', 'Clients/Acme', 'Finances/Budget']) {
      for (const tail of [...THE_BOOKS, ...NOT_THE_BOOKS, 'x.md']) {
        for (const p of [`${base}/${tail}`, tail, `${base}2/${tail}`, `Other/${base}/${tail}`, base]) {
          eq(owns(base, p), insideBook(base, collapsePath(p)), `a book in ${base} owns ${p} exactly when it is inside the folder`);
        }
      }
    }
    for (const odd of ['.', './', 'a/..', '..', 'Budget/..'])
      ok(!owns(odd, 'Settings.md'), `a base of ${JSON.stringify(odd)} is no book, and owns nothing`);

    /* The lists are the names src/ spells. Every literal handed straight to an
       io function, and every path constant, must be the book's at the root —
       so a new book-level file cannot be added without this list hearing. */
    const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const files = [];
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'lang') walk(p); } else if (e.name.endsWith('.js')) files.push(p);
      }
    };
    walk(path.join(__dirname, '..', 'src'));
    const CALL = /\b(?:readFile|writeFile|writeBinary|patchFile|fileAt|folderAt|pathTaken|isStaleFile|mdFilesIn|mdFilesUnder|subfoldersIn|subfoldersUnder)\(\s*(['"`])([^'"`$]+)(['"`$])/g;
    const CONST = /\bconst [A-Z_]+_(?:FILE|DIR|LOG) = '([^']+)'/g;
    /* Named by src/ and NOT a book's: the two vault-root destinations an
       export defaults to (report.js REPORT_DIR, exporter.js EXPORT_DIR),
       written through writeVaultFile, which is not rooted at the book. */
    const VAULT_RING = ['Reports', 'Exports'];
    const spelled = new Set();
    const strangers = [];
    let sites = 0;
    for (const file of files) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      const where = path.relative(path.join(__dirname, '..'), file);
      const judge = (lit, whole) => {
        const cut = lit.indexOf('/');
        if (cut < 0 && !whole) return;                    // `${computed}…`: not a literal first segment
        const top = cut < 0 ? lit : lit.slice(0, cut);
        if (VAULT_RING.includes(top)) return;
        sites++;
        spelled.add(top);
        if (!bookOwns('/', collapsePath(lit))) strangers.push(`${where}: ${lit}`);
      };
      let m;
      while ((m = CALL.exec(src))) judge(m[2], m[3] !== '$');
      while ((m = CONST.exec(src))) judge(m[1], true);
    }
    eq(strangers, [], 'T2: every path src/ hands an io function is one a root book owns — add a new book-level name to io.js BOOK_FILES / BOOK_FOLDERS');
    ok(sites >= 30, `the scan is reading call sites (${sites})`);
    eq([...BOOK_FILES, ...BOOK_FOLDERS].filter(n => !spelled.has(n)), [], 'T2: and every name on the two lists is one src/ really uses');
    eq(require('../src/fx-fetch').RATES_FILE, 'Exchange Rates.md', 'the rates file');
    const { RECEIPTS_DIR, FOOD_ITEMS_FILE } = require('../src/receipt-file');
    eq([RECEIPTS_DIR, FOOD_ITEMS_FILE, require('../src/note-file').NOTES_DIR], ['Receipts', 'Receipts/Food Items.md', 'Notes'], 'the receipts and notes folders');
    const { managedFolderMatch } = require('../src/report');
    for (const name of BOOK_FOLDERS.filter(n => !['Receipts', 'Data'].includes(n)))
      eq(managedFolderMatch(`${name}/x`, ''), name, `T2: ${name}/ is a folder the export guard already calls managed`);
    /* The household, moved to the root: every file in it is the book's. */
    eq(Object.keys(atRoot(SEED)).filter(p => !owns('/', p)), [], 'T2: every file of the committed household is one a root book owns');
  }

  /* ---- 2. the controller's "is this change the budget's?" ---- */
  for (const root of ['', '/']) {
    const at = JSON.stringify(root);
    for (const p of THE_BOOKS) ok(fsChangeInBudget(root, f(p)), `T2: at ${at} a change to ${p} is the budget's`);
    for (const p of NOT_THE_BOOKS) ok(!fsChangeInBudget(root, f(p)), `T2: at ${at} a change to ${p} is NOT the budget's`);
    ok(fsChangeInBudget(root, f('Archive/2026-09.md'), 'Transactions/Cheque/2026-09.md'), `T2: ${at}: a month renamed OUT of the book counts, by the path it left`);
    ok(fsChangeInBudget(root, f('Accounts/Savings.md'), 'Inbox/Savings.md'), `T2: ${at}: a file renamed INTO the book counts, by its new path`);
    ok(fsChangeInBudget(root, f('Old transactions'), 'Transactions'), `T2: ${at}: a book folder renamed away counts`);
    ok(!fsChangeInBudget(root, f('Journal/b.md'), 'Journal/a.md'), `T2: ${at}: a rename between two notes of the reader's own does not`);
    ok(!fsChangeInBudget(root, f('Journal/x.md'), { path: 'Settings.md' }), `${at}: a non-string second argument is not an old path`);
    ok(!fsChangeInBudget(root, null, undefined), `${at}: no file and no old path is no change`);
  }
  {
    /* A book in a folder: the answer the old prefix gave, path for path. */
    const old = (bp, file, oldPath) => {
      const under = p => typeof p === 'string' && p !== '' && (p === bp || p.startsWith(bp + '/'));
      return under(file && file.path) || under(oldPath);
    };
    let n = 0;
    for (const bp of ['Budget', 'Finances/Budget', 'Clients/Acme']) {
      const corpus = [bp, `${bp}2/x.md`, `${bp}/x.md`, `X${bp}/x.md`, 'x.md', '', undefined,
        ...[...THE_BOOKS, ...NOT_THE_BOOKS].flatMap(t => [`${bp}/${t}`, t, `${bp}2/${t}`])];
      for (const a of corpus) {
        for (const b of [undefined, ...corpus.slice(0, 12)]) {
          assert.strictEqual(fsChangeInBudget(bp, a === undefined ? null : f(a), b), old(bp, a === undefined ? null : f(a), b),
            `a book in ${bp}: (${a}, ${b}) is judged as it always was`);
          n++;
        }
      }
    }
    checks++;
    ok(n > 1500, `a folder book's watcher answers as the old prefix did on ${n} (path, old path) pairs`);
  }

  /* ---- 3. classifyRename ---- */
  {
    const cats = [{ name: 'Groceries', rel: 'Categories/Groceries.md' }, { name: 'Kids/School', rel: 'Categories/Kids-School.md' }];
    for (const root of ['', '/']) {
      const at = JSON.stringify(root);
      eq(classifyRename(root, 'Accounts/Cheque.md', 'Accounts/Current account.md', cats),
        { kind: 'account', from: 'Cheque', to: 'Current account' }, `T2: ${at}: an account renamed in a root book moves its notes`);
      eq(classifyRename(root, 'Categories/Groceries.md', 'Categories/Food.md', cats),
        { kind: 'category', from: 'Groceries', to: 'Food' }, `T2: ${at}: a category whose name tracks its filename does too`);
      eq(classifyRename(root, 'Categories/Kids-School.md', 'Categories/After-school.md', cats), null,
        `T2: ${at}: one named in frontmatter does not — its rel is found, whole`);
      eq(classifyRename(root, 'Accounts/Cheque.md', 'Archive/Cheque.md', cats), null, `${at}: moved out of Accounts/ is not a rename`);
      eq(classifyRename(root, 'Projects/Accounts/Cheque.md', 'Projects/Accounts/X.md', cats), null,
        `T2: ${at}: an Accounts/ folder elsewhere in the vault is not the book's`);
      eq(classifyRename(root, 'Accounts/Cheque.md', undefined, cats), null, `${at}: a missing new path is not a crash`);
    }
    /* In a folder: tests/notes.test.cjs pins the cases; the shape that could
       have moved is the book folder itself, and a sibling sharing its prefix. */
    eq(classifyRename('Accounts', 'Accounts', 'Accounts2', cats), null, 'a book folder named Accounts, renamed, is not an account');
    eq(classifyRename('Budget', 'Budget2/Accounts/A.md', 'Budget2/Accounts/B.md', cats), null, 'a sibling folder sharing the prefix is not the book');
    eq(classifyRename('Budget', 'Budget/Accounts/A.md', 'Budget/Accounts/B.md', cats), { kind: 'account', from: 'A', to: 'B' }, 'and the book\'s own account still is');
  }

  for (const [name, fn, root] of FLAVOURS) {
    flavour.fn = fn;
    const say = m => `${name}: ${m}`;

    /* ---- 4. end to end: the event, the gate, io's stale ledger ---- */
    {
      const TX = 'Transactions/Cheque/2026-09.md';
      const vault = H.makeVault({
        'Settings.md': '---\nmonth_start_day: 1\n---\n', [TX]: 'rows as loaded\n',
        'Journal/2026-11-12.md': 'a day\n', 'Projects/Transactions/2026-09.md': 'not a month of this budget\n',
      });
      const plugin = H.bookSeam({ settings: { budgetFolder: '/' }, _lastWrite: 0 });
      const vio = makeIo({ vault, plugin }, { view: true });
      eq(vio.basePath(), root, say('the open book is the vault root'));
      /* controller.js onFsChange, as it is written there (pinned below): ask
         the gate, then tell io, then schedule a reload for an external one. */
      const handed = [];
      const reloads = [];
      const onFsChange = (file, oldPath) => {
        if (!fsChangeInBudget(vio.basePath(), file, oldPath)) return null;
        handed.push(file.path);
        return vio.observeChange(file, oldPath).then(r => { if (!r.own) reloads.push(file.path); return r; });
      };
      const edit = async (p, text) => { const file = vault.getFileByPath(p); await vault.modify(file, text); return onFsChange(file); };

      await vio.readFile(TX);                                      // the page loads the month
      ok(!vio.isStaleFile(TX), say('a file nobody has touched is not stale'));
      await edit('Journal/2026-11-12.md', 'a day, and a thought\n');
      await edit('Projects/Transactions/2026-09.md', 'still not this budget\'s\n');
      eq(handed, [], say('T2: an edit to a note that merely lives in the vault is never handed to io'));
      eq(reloads, [], say('T2: …and schedules no reload of the budget'));
      ok(!vio.isStaleFile('Journal/2026-11-12.md') && !vio.isStaleFile(TX), say('T2: …and marks nothing'));

      await edit(TX, 'rows as loaded\n| 2026-09-02 | typed on the phone | -120.00 |\n');
      eq(handed, [TX], say('T2: an edit to a root book\'s month IS handed to io'));
      eq(reloads, [TX], say('T2: …is somebody else\'s, so the budget is to be re-read'));
      ok(vio.isStaleFile(TX), say('T2: …and the month is marked stale — a Save over it has something to refuse it'));
      ok(!vio.isStaleFile('Settings.md'), say('…and only that file'));

      /* Moved out of the book: both ends are told, the old path stays stale. */
      const text = vault._store.get('Settings.md');
      vault._store.delete('Settings.md');
      const moved = await vault.create('Archive/Settings.md', text);
      await onFsChange(moved, 'Settings.md');
      eq(handed, [TX, 'Archive/Settings.md'], say('T2: a book file renamed out of the book is handed over, by the path it left'));
      ok(vio.isStaleFile('Settings.md'), say('T2: …and the path it left is stale'));
    }
    {
      const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
      ok(/if \(!fsChangeInBudget\(ctx\.basePath\(\), file, oldPath\)\) return;\s*ctx\.observeChange\(file, oldPath\)\.then\(r => \{\s*if \(!r\.own\) reloads\.schedule\(800\);/.test(src),
        'the controller\'s watcher is the gate, then io, then the reload — the order section 4 drives');
    }

    /* ---- 5. the headless API's watcher ---- */
    {
      const unpin = pinClock(TODAY);
      try {
        const vault = H.makeVault(atRoot(SEED));
        const handlers = {};
        vault.on = (ev, cb) => { (handlers[ev] = handlers[ev] || []).push(cb); return { e: vault, name: ev, fn: cb }; };
        vault.offref = ref => { handlers[ref.name] = (handlers[ref.name] || []).filter(x => x !== ref.fn); };
        const emit = (ev, p, oldPath) => (handlers[ev] || []).slice().forEach(cb => cb({ path: p }, oldPath));
        const undo = [];
        const plugin = H.bookSeam({
          settings: { budgetFolder: '/', privacyLock: false }, budgetUnlocked: false,
          app: { vault, workspace: { onLayoutReady: cb => cb() } }, _lastWrite: 0,
          register(cb) { undo.push(cb); },
          registerEvent(ref) { this.register(() => ref.e.offref(ref)); },
        });
        const api = buildApi(plugin);
        let heard = 0;
        api.onChange(() => { heard++; });
        emit('modify', 'Journal/2026-11-12.md');
        emit('rename', 'Journal/b.md', 'Journal/a.md');
        emit('modify', 'Transactions/Cheque/2026-09.md');
        await settle(1000);
        eq(heard, 1, say('T2: a subscriber hears a change in a root book — once, and not for the reader\'s own notes'));
        emit('modify', 'Journal/2026-11-12.md');
        emit('create', 'Projects/Accounts/New.md');
        await settle(1000);
        eq(heard, 1, say('T2: a change to a note that merely lives in the vault is not a change to the budget'));
        emit('rename', 'Archive/Old cheque.md', 'Accounts/Old cheque.md');
        await settle(1000);
        eq(heard, 2, say('T2: an account file moved out of a root book is heard, by the path it left'));
        while (undo.length) undo.pop()();
      } finally { unpin(); }
    }

    /* ---- 6. the Notes page's "is this path taken?" ---- */
    {
      const unpin = pinClock('2026-10-07');
      try {
        const run = async (folder, prefix) => {
          const ctx = H.makeCtx({ [`${prefix}Settings.md`]: '---\nmonth_start_day: 1\n---\n', [`${prefix}Categories/Food.md`]: '---\ntype: expense\n---\n' },
            { budgetFolder: folder });
          await H.loadInto(ctx);
          /* Written since the load, so only the vault listing can know it —
             and differing from the new note's path by case alone, which is
             one file on the phone this ships to. */
          await ctx.vault.create(`${prefix}Notes/2026-10-07 fee query.md`, '---\nnote_kind: general\n---\n\nthe first call\n');
          const asked = [];
          ctx.writeFile = async rel => { asked.push(rel); };
          answers.push({ title: 'Fee query', about: 'general\u001F', body: 'the second call' });
          try { await ctx.addNote(); } catch (e) { /* the re-render after the write is not this test's subject */ }
          return asked;
        };
        eq(await run('/', ''), ['Notes/2026-10-07 Fee query 2.md'],
          say('T2: in a root book a new note steps past one already at that path — found by its whole path, not minus its first letters'));
        eq(await run('Budget', 'Budget/'), ['Notes/2026-10-07 Fee query 2.md'], say('as it does in a folder book'));
      } finally { unpin(); }
    }
  }

  console.log(`PASS root-book-watcher (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
