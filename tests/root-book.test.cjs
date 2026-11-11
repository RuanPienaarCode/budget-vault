'use strict';
/* A book at the vault root: read right, contained right — and not yet written
   (2026-11-11 audit, task 2 — Medium).

   WHAT THE AUDIT FOUND. io.js guardedPath is the defence in depth on every
   budget-rooted write: the path is collapsed and must stay inside the open
   book's folder, so a label like `../../evil` pulled from a synced Accounts
   file never becomes a write. Its test is `resolved !== base &&
   !resolved.startsWith(base + '/')`. For a book at the vault root the
   collapsed base is the empty string, the prefix test becomes
   startsWith('/'), and no relative path starts with a slash: EVERY write is
   refused — "Refused write outside the budget folder: Settings.md".

   WHICH ROOT. The audit reproduced that against the harness's normalizePath
   stub, where normalizePath('/') is ''. Obsidian's own answers '/': read out
   of the installed app (obsidian-1.15.0.asar, app.js), it is

     function xe(o){return Nl(Oo(o)).normalize("NFC")}
     function Oo(o){return o=o.replace(/([\\/])+/g,"/").replace(/(^\/+|\/+$)/g,""),o===""&&(o="/"),o}
     Nl = o => o.replace(/ | /g," ")

   so in a real vault basePath() is '/' and relPath('Settings.md') is
   normalizePath('//Settings.md') = 'Settings.md'. Both spellings of the root
   collapse to '' and both hit the refusal — the defect is real in Obsidian,
   not a harness artefact. Every section below therefore runs TWICE: once under
   the harness's stub and once under Obsidian's own function, spelled as above.

   WHAT ELSE THE ROOT BROKE, which the audit did not see because nothing could
   be written to show it:
     - load.js derived every `rel` as path.slice(base.length + 1). With base
       '/' that drops TWO characters ('Categories/Food.md' →
       'tegories/Food.md'), with '' one — so the path each writer addresses
       "the file it was read from" by named a file that does not exist. A root
       book that could write would have forked every month, account and plan
       on its first Save.
     - the settings tab counted stranded budgets under '//Budgets/'.
     - the vault watcher's "is this change in the budget?" (controller.js
       fsChangeInBudget, api.js underBudget — other lanes' files) is the same
       hand-spelled prefix, so it drops every event in a root book: no stale
       mark, no refusal, no reload.

   SO THE WRITE STAYS REFUSED, deliberately, until the watcher can see a root
   book. That refusal is the only thing between such a book and a Save that
   overwrites a phone's row unopposed; lifting it first would trade "cannot
   save" for "can lose an edit". Section 3 pins both halves together, as a
   ratchet: the day fsChangeInBudget answers true for a root book, this suite
   fails and says to lift the refusal (io.js withinBudget — one line, onto
   insideBook; branch fix/audit-root-book-writes carries it with its tests).

   AND SO DOES THE DELETE, which is new. io.trashFile had no containment of
   its own; a root book could not reach it only because its garbled rels
   resolved to no file, so every delete was a silent "nothing to delete".
   Getting the rels right made the file findable — and, for one revision of
   this fix, made every confirmed delete in a root book land while every Save
   was still refused (the pre-merge review ran it: `trashFile: true (file
   gone)` against 722b109's `false`). A delete now goes through the same
   containment a write does.

   What this suite pins:

     1. insideBook / relUnder (io.js), the one root-aware spelling of "is this
        path in the book" and "what is it called there": both roots, a folder,
        a sibling folder sharing the book's prefix, `../` in every position,
        and a base that merely collapses to nothing;
     2. the traversal defence, unchanged: a folder book refuses `../` as it
        always did — and deletes only its own files;
     3. the hold, and the reason for it, side by side: a root book writes
        nothing and deletes nothing, through io directly and through the rels
        the real loader now hands out;
     4. the REAL loader, over the committed household moved to the root, builds
        exactly the state it builds for the same files under Budget/ — every
        `rel` included — and each rel names the file it was read from;
     5. the settings tab's stranded-budget counts see a root book's Budgets/.

     node tests/root-book.test.cjs */

const assert = require('assert');
const Module = require('module');
const H = require('./helpers/harness.cjs');
H.stubObsidian();

/* Obsidian 1.15.0's normalizePath, verbatim in behaviour (see the header). */
const obsidianNormalize = p => {
  let o = String(p).replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '');
  if (o === '') o = '/';
  return o.replace(/ | /g, ' ').normalize('NFC');
};
/* One switch for every src/ module: they destructure normalizePath once, at
   require time, so the stub hands them a function that asks `flavour` on each
   call rather than a fixed one. Installed before anything in src/ loads. */
const stubNormalize = require('obsidian').normalizePath;
const flavour = { fn: stubNormalize };
const prevLoad = Module._load;
Module._load = function (req, ...rest) {
  const m = prevLoad.call(this, req, ...rest);
  return req === 'obsidian' ? { ...m, normalizePath: p => flavour.fn(p) } : m;
};

const { makeIo, insideBook, relUnder } = require('../src/io');
const { collapsePath } = require('../src/vault-path');
const { fsChangeInBudget } = require('../src/controller');
const { SEED, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const refused = async (fn, m) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err && /Refused (write|delete) outside the budget folder/.test(err.message), `${m}${err ? ` (got: ${err.message})` : ' (it went through)'}`);
  checks++;
};

const FLAVOURS = [
  ['harness stub (root is "")', stubNormalize, ''],
  ['Obsidian 1.15.0 (root is "/")', obsidianNormalize, '/'],
];

/* The household, plus the shapes it does not hold whose `rel` the loader also
   derives: a note, a till slip, an account whose frontmatter never closes
   (named in unreadableFiles by its rel), and a month filed a level down. */
const EXTRA = {
  [`${B}/Notes/2026/Car service.md`]: '---\nnote_kind: general\n---\n\nBooked for October.\n',
  [`${B}/Receipts/2026-09/Checkers.md`]: '---\nkind: receipt\nreceipt_store: "Checkers"\nreceipt_date: 2026-09-01\nreceipt_time: "10:02"\nreceipt_total: 55.00\n---\n\n| Item | Qty | Price | Barcode | Category |\n|---|---:|---:|---|---|\n| Milk | 1 | 55.00 |  |  |\n',
  [`${B}/Accounts/Closed/Old card.md`]: '---\ntype: credit_card\nbalance: 0\n',
  [`${B}/Transactions/Closed/Old card/2026-08.md`]: '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n| 2026-08-03 | Annual fee | Gym | -50.00 |  |  |\n',
};
const HOUSEHOLD = { ...SEED, ...EXTRA };
const atRoot = files => Object.fromEntries(Object.entries(files).map(([k, v]) => [k.slice(B.length + 1), v]));

/* What a load built, as plain data: every key the loader commits that a view
   reads or a writer addresses. */
const KEYS = ['settings', 'categories', 'accounts', 'accountsIgnored', 'accountsDuplicated', 'budgets', 'budgetMeta',
  'txFiles', 'txFolders', 'txFolderPaths', 'txFoldersIgnored', 'rules', 'owed', 'debts', 'assets', 'services',
  'plans', 'tax', 'taxOrphanYears', 'notes', 'receipts', 'unreadableFiles'];
const stateOf = S => JSON.parse(JSON.stringify(Object.fromEntries(KEYS.map(k => [k, S[k]]))));
/* Every budget-relative path the state says a file was READ from. */
function relsOf(S) {
  return [
    ...S.categories.map(c => c.rel), ...S.accounts.map(a => a.rel),
    ...Object.values(S.budgetMeta).map(m => m.rel), ...Object.values(S.txFiles).map(f => f.rel),
    ...Object.values(S.plans).map(p => p.rel), ...Object.values(S.tax).map(t => t.rel),
    ...S.notes.map(n => n.rel), ...S.receipts.map(r => r.rel),
  ];
}

(async () => {
  /* ---- 1. the two questions, as pure functions ---- */
  {
    const inside = (base, p) => insideBook(base, collapsePath(p));
    for (const root of ['', '/']) {
      const at = JSON.stringify(root);
      ok(inside(root, 'Settings.md') && inside(root, 'Transactions/Cheque/2026-07.md'), `T2: at root ${at} every vault path is inside the book`);
      ok(inside(root, 'Notes/../Settings.md'), `T2: root ${at}: a path that dips and comes back is still inside`);
      for (const p of ['../evil.md', '../../evil.md', 'Notes/../../evil.md', 'Accounts/../../../evil.md', '..'])
        ok(!inside(root, p), `T2: root ${at}: ${p} climbs out of the vault, so out of the book`);
      eq(relUnder(root, 'Categories/Food.md'), 'Categories/Food.md', `T2: at root ${at} a file is called by its whole vault path`);
    }
    ok(inside('Budget', 'Budget/Settings.md') && inside('Budget', 'Budget'), 'a folder book holds its own files, and is itself');
    ok(inside('Clients/Acme', 'Clients/Acme/Transactions/X/2026-07.md'), '…at any depth');
    for (const p of ['Budget2/Settings.md', 'BudgetX', 'Other/Budget/Settings.md', 'Budget/../evil.md', 'Budget/../../evil.md', 'Settings.md'])
      ok(!inside('Budget', p), `a folder book does not hold ${p}`);
    eq(relUnder('Budget', 'Budget/Categories/Food.md'), 'Categories/Food.md', 'a folder book\'s file loses the folder');
    eq(relUnder('Clients/Acme', 'Clients/Acme/Notes/2026/a.md'), 'Notes/2026/a.md', '…a nested book\'s too');
    eq(relUnder('Budget', 'Budget2/Categories/Food.md'), 'Budget2/Categories/Food.md', 'a path under a sibling that shares the prefix is not relative to the book');
    /* Only a base that IS the root is the root. */
    for (const odd of ['.', './', 'a/..', '..', 'Budget/..'])
      ok(!inside(odd, 'Settings.md'), `T2: a base of ${JSON.stringify(odd)} merely collapses to nothing — it is not the root book, and holds nothing`);
  }

  for (const [name, fn, root] of FLAVOURS) {
    flavour.fn = fn;
    const say = m => `${name}: ${m}`;
    const ob = require('obsidian');
    eq(ob.normalizePath('/'), root, say('this flavour\'s spelling of the vault root'));
    eq(ob.normalizePath(`${root}/Settings.md`), 'Settings.md', say('and a path under it is the bare vault path'));

    /* An io the way a view builds one, on a book at `folder`. */
    const rig = (files, folder) => {
      const vault = H.makeVault(files);
      vault.configDir = '.obsidian';
      const plugin = H.bookSeam({ settings: { budgetFolder: folder }, _lastWrite: 0 });
      return { vault, plugin, io: makeIo({ vault, plugin }), keys: () => [...vault._store.keys()].sort() };
    };

    /* ---- 2. the traversal defence, as it always was ---- */
    {
      const r = rig({ 'Budget/Settings.md': 'x', 'Budget2/Settings.md': 'theirs', 'evil.md': 'mine' }, 'Budget');
      const before = r.keys();
      for (const rel of ['../evil.md', '../Budget2/Settings.md', 'Notes/../../evil.md', '../../evil.md', '..']) {
        await refused(() => r.io.writeFile(rel, 'pwned'), say(`a folder book refuses ${rel}`));
        await refused(() => r.io.writeBinary(rel, new Uint8Array([1]).buffer), say(`…and as a binary (${rel})`));
        await refused(() => r.io.patchFile(rel, 'a: 1', '\n', { a: 2 }), say(`…and as a patch (${rel})`));
      }
      eq(r.keys(), before, say('…and writes nothing — a sibling folder sharing the book\'s prefix included'));
      await r.io.writeFile('Settings.md', 'ok');
      eq(r.vault._store.get('Budget/Settings.md'), 'ok', say('…while its own files still write'));
      await r.io.writeFile('Transactions/Cheque/2026-10.md', 'new month');
      eq(r.vault._store.get('Budget/Transactions/Cheque/2026-10.md'), 'new month', say('…and a new nested one is created under the book'));
      /* Deletes: its own file goes; a file that is not the book's does not. */
      for (const outside of ['evil.md', 'Budget2/Settings.md']) {
        await refused(() => r.io.trashFile(r.vault.getFileByPath(outside)), say(`T2: a folder book refuses to delete ${outside}, which is not its file`));
        ok(r.vault._store.has(outside), say('…and it is still there'));
      }
      eq(await r.io.trashFile(r.io.fileAt('Transactions/Cheque/2026-10.md')), true, say('its own file is deleted as before'));
      ok(!r.vault._store.has('Budget/Transactions/Cheque/2026-10.md'), say('…and gone'));
      eq(await r.io.trashFile(r.io.folderAt('Transactions/Cheque')), true, say('and its own folder'));
    }

    /* ---- 3. the hold, and the reason for it ---- */
    {
      const r = rig({ 'Settings.md': '---\nmonth_start_day: 1\n---\n', 'Categories/Food.md': '---\ntype: expense\n---\n' }, '/');
      eq(r.plugin.activeFolder(), root, say('the open book resolves to the vault root'));
      const before = r.keys();
      for (const rel of ['Settings.md', 'Transactions/Cheque/2026-10.md', '../evil.md', 'Notes/../../evil.md']) {
        await refused(() => r.io.writeFile(rel, 'x'), say(`a root book's write is refused (${rel})`));
      }
      await refused(() => r.io.writeBinary('Tax/2026/irp5.pdf', new Uint8Array([1]).buffer), say('…a binary too'));
      await refused(() => r.io.patchFile('Categories/Food.md', 'type: expense', '\n', { color: '"#888"' }), say('…and a patch'));
      ok(r.io.fileAt('Categories/Food.md'), say('io finds a root book\'s file by its rel'));
      await refused(() => r.io.trashFile(r.io.fileAt('Categories/Food.md')), say('T2: …and a root book\'s delete is refused with its writes'));
      eq(r.keys(), before, say('and nothing in the vault moved'));
      /* THE RATCHET. A root book may write only where the watcher can see a
         change in it — otherwise io's stale ledger is never told, and a Save
         overwrites whatever the phone wrote. Today it cannot. */
      eq(fsChangeInBudget(r.io.basePath(), { path: 'Transactions/Cheque/2026-07.md' }), false,
        say('the vault watcher does not see a change in a root book — which is WHY its writes are still refused. '
          + 'If this is now true, the watcher has been taught the root: lift the refusal in io.js guardedPath '
          + '(use insideBook; branch fix/audit-root-book-writes has it, with the config-folder refusal and its tests) and retire this section'));
    }

    /* ---- 4. the real loader at the root ---- */
    {
      const inFolder = await H.loadInto(H.makeCtx(HOUSEHOLD, { budgetFolder: B }));
      const want = stateOf(inFolder);
      const ctx = H.makeCtx(atRoot(HOUSEHOLD), { budgetFolder: '/' });
      const S = await H.loadInto(ctx);
      eq(ctx.basePath(), root, say('the loader\'s book is the vault root'));
      eq(stateOf(S), want, say('T2: the household at the root loads to exactly the state it loads to under Budget/'));
      const rels = relsOf(S);
      ok(rels.length >= 20, say(`the state names the files it was read from (${rels.length})`));
      eq(rels.filter(rel => !ctx.vault.getFileByPath(rel)), [], say('T2: every rel names the file it was read from'));
      eq(rels.filter(rel => !ctx.fileAt(rel)), [], say('T2: …and io resolves each one back to that file'));
      eq(S.txFolderPaths['Old card'], 'Transactions/Closed/Old card', say('T2: a month folder a level down keeps its own path'));
      eq(S.unreadableFiles.map(u => u.rel), ['Accounts/Closed/Old card.md'], say('T2: an unreadable file is named by its real path'));
      eq(ctx.txFileRel('Cheque', '2026-10'), 'Transactions/Cheque/2026-10.md', say('a new month is addressed beside the ones read'));
      /* The hold, through the paths a page would actually use: every rel the
         loader handed out now resolves to a real file, and none of them can
         be saved over or deleted. */
      const files = [...ctx.vault._store.keys()].sort();
      for (const rel of rels) {
        await refused(() => ctx.writeFile(rel, 'rebuilt from state'), say(`T2: a Save to ${rel} in a root book is refused`));
        await refused(() => ctx.trashFile(ctx.fileAt(rel)), say(`T2: …and so is its delete`));
      }
      await refused(() => ctx.trashFile(ctx.folderAt('Transactions/Cheque')), say('T2: an account\'s month folder cannot be deleted either'));
      eq([...ctx.vault._store.keys()].sort(), files, say('T2: the vault is exactly as it was'));
      await ctx.loadVault();
      eq(stateOf(ctx.S), want, say('T2: a reload reads the same state'));
      await ctx.loadNotes();
      await ctx.loadReceipts();
      eq(stateOf(ctx.S), want, say('T2: a standalone re-read of Notes/ and Receipts/ derives the same rels'));
    }

    /* ---- 5. the settings tab counts a root book's Budgets/ ---- */
    {
      const { BudgetSettingTab } = require('../src/settings-tab');
      const tabAt = (folder, prefix) => {
        const tab = Object.create(BudgetSettingTab.prototype);
        tab.plugin = H.bookSeam({ settings: { budgetFolder: folder } });
        tab.app = { vault: { getMarkdownFiles: () => ['2026-07', '2026-08', '2026-07-24', '2026-08-07']
          .map(b => new H.TFile(`${prefix}Budgets/${b}.md`)).concat(new H.TFile(`${prefix}Notes/Budgets/2026-09.md`)) } };
        tab.mdSettings = () => ({ period_anchor: '2026-08-07' });
        return tab;
      };
      for (const [folder, prefix] of [['/', ''], ['Budget', 'Budget/']]) {
        const tab = tabAt(folder, prefix);
        eq([tab.monthBudgetCount(), tab.datedBudgetCount(), tab.offPhaseBudgetCount(14)], [2, 2, 0],
          say(`T2: a book at ${JSON.stringify(folder)} counts its own Budgets/ — and only that folder`));
      }
    }
  }

  console.log(`PASS root-book (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
