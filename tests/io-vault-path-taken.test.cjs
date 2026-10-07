'use strict';
/* "Is this vault path already used?", asked the way the filesystem answers.

   Obsidian's index is an exact-key map: `Budget/settings.md` and
   `Budget/Settings.md` are two keys. macOS, iOS and iCloud Drive resolve
   paths case-insensitively and normalisation-insensitively, so on disk they
   are ONE file. io.js learned this for budget-relative paths in ISSUE 64
   (pathTaken); the vault-root probes kept the exact lookup, and two of them
   paid for it:

     · createVaultFileIfAbsent — the onboarding wizard's "never overwrite"
       write — read `Budget/settings.md` as absent beside a requested
       `Budget/Settings.md`, and wrote;
     · the same function returned TRUE ("I wrote") when vault.create threw,
       because its catch was commented "raced into existence" and fell
       through to `return true`. The wizard's celebration screen trusts that
       value for the manual path's first budget.

   vaultPathTaken() is pathTaken's vault-root twin, and the budget export's
   "this replaces …" list adopts it next. Pinned here, over the shared
   in-memory vault with the REAL makeIo:

     1. vaultPathTaken: exact, filename case, folder case, Unicode
        normalisation, a folder at the path; absent and escaping paths are
        not taken;
     2. without vault.getRoot() (the shared harness vault has none) a
        folder-CASE variant cannot be walked — the filename still folds;
     3. createVaultFileIfAbsent: skips a case-variant existing file, returns
        false when create throws, writes and returns true otherwise.

     node tests/io-vault-path-taken.test.cjs */

const assert = require('assert');
const { stubObsidian, makeVault, TFolder } = require('./helpers/harness.cjs');
stubObsidian();
const { makeIo } = require('../src/io');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* Obsidian's vault hands back its root folder (vault.getRoot()); the harness
   vault does not. Built from the vault's own index — nothing invented — so a
   folder whose name differs only by case can be walked from the top. */
function withRoot(vault) {
  vault.getRoot = () => {
    const root = new TFolder('');
    const tops = new Set([...vault._store.keys()].map(k => k.split('/')[0]));
    root.children = [...tops].map(t => vault.getAbstractFileByPath(t)).filter(Boolean);
    return root;
  };
  return vault;
}
function ioFor(files, { root = true } = {}) {
  const vault = makeVault(files);
  if (root) withRoot(vault);
  return { vault, io: makeIo({ vault, plugin: { settings: { budgetFolder: 'Budget' } } }) };
}

(async () => {
  /* ---- 1. vaultPathTaken ---------------------------------------------------- */
  {
    const { io } = ioFor({
      'Budget/Settings.md': 'x',
      'Budget/settings-notes.md': 'x',
      'exports/budget summary.csv': 'x',
      'Budget/Bégroting.md': 'x',     // decomposed, as a macOS listing can hand it over
      'Budget/Categories/Food.md': 'x',
    });
    ok(typeof io.vaultPathTaken === 'function', 'makeIo returns vaultPathTaken');
    eq(io.vaultPathTaken('Budget/Settings.md'), true, 'an exact match is taken');
    eq(io.vaultPathTaken('Budget/settings.md'), true, 'a filename differing only by case is taken');
    eq(io.vaultPathTaken('BUDGET/SETTINGS.MD'), true, 'and so is a folder differing only by case');
    eq(io.vaultPathTaken('Exports/Budget Summary.csv'), true, 'a vault-root folder in another case (the export case)');
    eq(io.vaultPathTaken('Budget/Bégroting.md'), true, 'a composed spelling of a decomposed name is the same file');
    eq(io.vaultPathTaken('Budget/categories'), true, 'a FOLDER at the path is taken too — no file can be created there');
    eq(io.vaultPathTaken('Budget/Settings.md.bak'), false, 'a different name is free');
    eq(io.vaultPathTaken('Budget/Other/Settings.md'), false, 'a missing parent folder means free');
    eq(io.vaultPathTaken('Budget/Settings.md/x.md'), false, 'a FILE where a folder segment should be is not a taken path');
    eq(io.vaultPathTaken('../outside.md'), false, 'a path escaping the vault is refused elsewhere, never "taken"');
    eq(io.vaultPathTaken(''), false, 'nothing is not taken');
  }

  /* ---- 2. no vault root ----------------------------------------------------- */
  {
    const { io } = ioFor({ 'Budget/settings.md': 'x', 'exports/budget summary.csv': 'x' }, { root: false });
    eq(io.vaultPathTaken('Budget/Settings.md'), true, 'the filename still folds against an exact parent');
    eq(io.vaultPathTaken('Exports/budget summary.csv'), false,
      'a folder-case variant at the vault root needs vault.getRoot() — documented, not guessed');
  }

  /* ---- 3. createVaultFileIfAbsent ------------------------------------------- */
  {
    const { vault, io } = ioFor({ 'Budget/settings.md': '---\nmonth_start_day: 25\n---\n' });
    const wrote = await io.createVaultFileIfAbsent('Budget/Settings.md', '---\nmonth_start_day: 1\n---\n');
    eq(wrote, false, 'a case-variant existing file is skipped (L4A-07 b)');
    eq([...vault._store.keys()], ['Budget/settings.md'], 'and no second file appears beside it');
    eq(vault._store.get('Budget/settings.md'), '---\nmonth_start_day: 25\n---\n', 'and the household\'s own file is untouched');
  }
  {
    const { vault, io } = ioFor({ 'budget/settings.md': 'theirs' });
    eq(await io.createVaultFileIfAbsent('Budget/Settings.md', 'ours'), false, 'a folder-case variant is skipped too');
    eq(vault._store.get('budget/settings.md'), 'theirs', 'untouched');
  }
  {
    const { vault, io } = ioFor({});
    vault.create = async () => { throw new Error('File already exists.'); };
    let threw = null, wrote;
    try { wrote = await io.createVaultFileIfAbsent('Budget/Settings.md', 'x'); } catch (e) { threw = e; }
    eq(threw, null, 'a create that throws does not throw out of createVaultFileIfAbsent');
    eq(wrote, false, 'and is reported as NOT written (L4A-07 c)');
  }
  {
    const { vault, io } = ioFor({ 'Budget/Categories/Food.md': 'x' });
    eq(await io.createVaultFileIfAbsent('Budget/Settings.md', 'fresh'), true, 'an absent file is written and reported as written');
    eq(vault._store.get('Budget/Settings.md'), 'fresh', 'with the content asked for');
    eq(await io.createVaultFileIfAbsent('Budget/Settings.md', 'again'), false, 'and a second call skips it');
    eq(vault._store.get('Budget/Settings.md'), 'fresh', 'leaving the first write in place');
  }

  console.log(`PASS io-vault-path-taken (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
