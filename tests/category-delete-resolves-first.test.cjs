'use strict';
/* Deleting a category trashes the category's own file, and only that file,
   however long the confirm dialog stays open.

   promptDeleteCategory used to look the file up AFTER the confirm: it
   assembled the path once the dialog came back, then called vault.trash
   itself instead of going through io.trashFile (2026-10-07 audit, L3-18).
   io.trashFile's header names exactly what that does: a path re-resolved
   after a dialog either no longer exists, or now points at a DIFFERENT file,
   which then gets trashed. In the audit's reproduction the category note was
   renamed while the dialog was open, and another note (a shopping list)
   arrived at the old path. The shopping list was trashed, and the toast said
   the category had been deleted. Notes, plans and tax years already resolved
   their file before the dialog.

   Now the file is resolved BEFORE the dialog and that TFile is trashed
   through io.trashFile. A TFile follows its file through a rename. A file
   that was deleted and replaced while the dialog was open gets a new TFile,
   so the vault no longer hands back the one we hold: in that case nothing is
   trashed, and the toast says the file changed.

   The shared harness vault rebuilds every TFile when a file is created, so
   it can only model the delete-and-replace case. Case 3 swaps in
   Obsidian's behaviour on the same vault object (one TFile per file, and a
   rename moves that same object to its new path) to show that a renamed
   category still goes to the trash.

   Real loader, real io, real categories module. The confirm dialog is
   answered at the module loader. Synthetic files only.
     node tests/category-delete-resolves-first.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The confirm dialog, answered at the module loader. `duringDialog` runs
   while the dialog is "open". That is where a rename or a sync lands. */
let duringDialog = null;
let answer = true;
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null,
      askRulesCleanup: async () => false,
      confirmModal: async () => { if (duringDialog) await duringDialog(); return answer; },
    };
  }
  return realLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto, TFile } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const registerCategories = require('../src/categories');

const B = 'Budget';
const CAT = `${B}/Categories/Snacks.md`;
const RENAMED = `${B}/Categories/Snacks (old).md`;
const SNACKS = '---\ntype: expense\ncolor: "#888888"\n---\n\n# Snacks\n';
const OTHER = '---\ntags: [personal]\n---\n\n# Snacks for the party\n\nA shopping list, not a category.\n';
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [CAT]: SNACKS,
};

/* Boot, with io.trashFile wrapped BEFORE categories registers, so the test
   can see which door the delete went through. */
async function boot(files) {
  const ctx = makeCtx(files, { budgetFolder: B });
  await loadInto(ctx);
  const trashed = [];
  const viaIo = ctx.trashFile;
  ctx.trashFile = async f => { trashed.push(f.path); return viaIo(f); };
  registerCategories(ctx);
  return { ctx, store: ctx.vault._store, trashed };
}
const lastToast = ctx => (ctx._toasts.slice(-1)[0] || {}).msg || '';

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the ordinary delete ---- */
    {
      duringDialog = null; answer = true;
      const { ctx, store, trashed } = await boot(BASE);
      eq(await ctx.promptDeleteCategory('Snacks'), true, 'the delete reports success');
      ok(!store.has(CAT), 'the category file is gone');
      eq(trashed, [CAT], 'and it went through io.trashFile, the one deletion door');
      ok(!ctx.S.categories.some(c => c.name === 'Snacks'), 'the category leaves the in-memory list');
      eq(lastToast(ctx), 'Deleted category "Snacks"', 'and the toast says so');
    }

    /* ---- 1b. declining deletes nothing ---- */
    {
      duringDialog = null; answer = false;
      const { ctx, store, trashed } = await boot(BASE);
      eq(await ctx.promptDeleteCategory('Snacks'), false, 'declining reports no delete');
      ok(store.has(CAT) && trashed.length === 0, 'and touches nothing');
      answer = true;
    }

    /* ---- 2. the file is replaced while the dialog is open ---- */
    {
      // The audit's reproduction. In this vault a rename is a delete plus a
      // create, which is also what a sync replacing the file looks like.
      const { ctx, store, trashed } = await boot(BASE);
      duringDialog = async () => {
        store.delete(CAT);
        store.set(RENAMED, SNACKS);
        await ctx.vault.create(CAT, OTHER);
      };
      eq(await ctx.promptDeleteCategory('Snacks'), false, 'the delete does not claim success');
      eq(store.get(CAT), OTHER, 'the note that arrived at the old path is NOT trashed');
      eq(store.get(RENAMED), SNACKS, 'nothing else was trashed either');
      eq(trashed, [], 'trashFile was never called');
      ok(/nothing was deleted/i.test(lastToast(ctx)), `the toast says nothing was deleted, got: ${lastToast(ctx)}`);
      ok(ctx.S.categories.some(c => c.name === 'Snacks'), 'and the in-memory list is left as it was');
      duringDialog = null;
    }

    /* ---- 3. Obsidian's rename: the TFile follows the file ---- */
    {
      const { ctx, store, trashed } = await boot(BASE);
      const vault = ctx.vault;
      // One TFile per file, keyed by path, and a rename moves that same
      // object to its new path. The vault methods io.js calls are swapped on
      // the same vault object io.js already holds.
      const live = new Map([...store.keys()].filter(p => !p.endsWith('/.folder')).map(p => [p, new TFile(p, vault)]));
      vault.getFileByPath = p => live.get(p) || null;
      vault.trash = async f => {
        assert.strictEqual(live.get(f.path), f, `trash() was handed a TFile the vault no longer holds: ${f.path}`);
        live.delete(f.path); store.delete(f.path);
      };
      const rename = (from, to) => {
        const f = live.get(from);
        live.delete(from); f.path = to; live.set(to, f);
        store.set(to, store.get(from)); store.delete(from);
      };
      duringDialog = async () => {
        rename(CAT, RENAMED);
        store.set(CAT, OTHER);
        live.set(CAT, new TFile(CAT, vault));
      };
      eq(await ctx.promptDeleteCategory('Snacks'), true, 'the delete goes ahead');
      ok(!store.has(RENAMED), 'the category\'s own file was trashed at its new path');
      eq(store.get(CAT), OTHER, 'the note that took the old path survives');
      eq(trashed, [RENAMED], 'through io.trashFile, by the TFile resolved before the dialog');
      duringDialog = null;
    }

    /* ---- 4. a hand-made file found by its frontmatter name ---- */
    {
      const files = { ...BASE };
      delete files[CAT];
      files[`${B}/Categories/my snacks file.md`] = '---\nname: Snacks\ntype: expense\ncolor: "#888888"\n---\n';
      const { ctx, store, trashed } = await boot(files);
      eq(await ctx.promptDeleteCategory('Snacks'), true, 'the delete succeeds');
      eq(trashed, [`${B}/Categories/my snacks file.md`], 'the file whose frontmatter names the category is the one trashed');
      ok(!store.has(`${B}/Categories/my snacks file.md`), 'and it is gone');
    }

    console.log(`PASS — category-delete-resolves-first: the file is resolved before the dialog and only that file is trashed (${checks} assertions).`);
  } finally { unpin(); }
})().catch(err => { console.error(err); process.exit(1); });
