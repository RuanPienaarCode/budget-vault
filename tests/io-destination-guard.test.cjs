'use strict';
/* One check for "may a file be written into the folder the reader typed?".

   Three exports let the reader type a destination folder, and each grew its
   own partial answer. The Report refused the folders load.js reads back in
   (Categories/, Accounts/ …) but compared their names case-SENSITIVELY, so
   on APFS and iOS — case-insensitive filesystems — "Budget/categories"
   passed and the report landed in the real Categories/ folder, to be loaded
   as a category on the next vault load. It did not refuse Obsidian's own
   config folder at all (".obsidian/plugins/budget-app" wrote a file nobody
   could see). And "../outside" was quietly rebased to "outside/" at the
   vault root, although io.js says in so many words that such paths are
   refused, not rebased. The budget export had the config-folder check and
   the same case-sensitive managed one; the Transactions export had neither.

   destinationProblem() in src/io.js is the one answer now. The Report uses
   it; the other two exports adopt it next. Pinned here:

     1. the contract, case by case: config folder (any case, any depth,
        compared by SEGMENT), managed budget folders (case-folded, NFC,
        any depth), and dot-only segments (refused, never rebased);
     2. managedFolderMatch() — still exported from src/report.js for the
        budget export — folds case and normalisation the same way;
     3. the ctx-bound version reads the vault's own config folder and the
        configured budget folder;
     4. the Report refuses all three kinds BEFORE the click (warning text,
        Create disabled) and AT the click (nothing written, nothing
        remembered) — and NEGATIVE CONTROL, an ordinary nested folder still
        writes, so the refusals are not a page that writes nothing at all.

     node tests/io-destination-guard.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

(async () => {
  const { destinationProblem: dp } = require('../src/io');
  ok(typeof dp === 'function', 'src/io.js exports destinationProblem');

  /* ---- 1. the contract ------------------------------------------------------ */
  const CFG = { kind: 'configDir', folder: '.obsidian' };
  const managed = folder => ({ kind: 'managed', folder });
  const TRAVERSAL = { kind: 'traversal' };
  const opts = { budgetFolder: 'Budget' };
  {
    for (const f of [null, undefined, '', '   ', 'Reports', 'Admin/Tax 2026', 'Budget', 'Budget/Reports', 'Other/Categories',
      'Budget/CategoriesOfSpending', './Reports', 'Reports/.']) {
      eq(dp(f, opts), null, `${JSON.stringify(f)} is an acceptable destination`);
    }
    for (const f of ['.obsidian', '.obsidian/plugins/budget-app', '.Obsidian/plugins', ' .obsidian / plugins ', '.OBSIDIAN',
      '.obsidian\\plugins']) {
      eq(dp(f, opts), CFG, `${JSON.stringify(f)} is inside the config folder`);
    }
    /* Any other segment starting with a dot hides the path: Obsidian 1.13.7
       indexes nothing under it, so a file written there never shows in the
       vault. One rule for every export (2026-10-07 audit; it used to live in
       the Budget export alone, and the Transactions export and the Report
       wrote into ".hidden" with a success toast). */
    const hidden = folder => ({ kind: 'hidden', folder });
    eq(dp('.obsidian-notes', opts), hidden('.obsidian-notes'), 'a dot-folder that only looks like the config folder is hidden all the same');
    eq(dp('notes/.obsidian', opts), hidden('.obsidian'), 'a dot-segment below the root is hidden, not the config folder');
    eq(dp('.trash', opts), hidden('.trash'), 'Obsidian\'s own trash folder');
    eq(dp('Notes/.archive/2026', opts), hidden('.archive'), 'at any depth, naming the segment that hides it');
    eq(dp('../.hidden', opts), TRAVERSAL, 'a traversal is refused as one first');
    eq(dp('.config/x', { configDir: '.config' }), { kind: 'configDir', folder: '.config' }, 'a renamed config folder is the one refused');
    eq(dp('.obsidian/x', { configDir: '.config' }), hidden('.obsidian'), '… and the default name is then an ordinary dot-folder, hidden');
    eq(dp('.obsidian/x'), CFG, 'configDir defaults to ".obsidian" when the caller has none to pass');

    eq(dp('Budget/Categories', opts), managed('Categories'), 'a managed budget folder');
    eq(dp('Budget/categories', opts), managed('Categories'), 'in any case — APFS and iOS are case-insensitive (L4A-03)');
    eq(dp('budget/CATEGORIES', opts), managed('Categories'), 'the budget folder\'s own name folds too');
    eq(dp('BUDGET/Transactions/Cheque', opts), managed('Transactions'), 'at any depth below a managed folder');
    for (const name of ['Accounts', 'Budgets', 'Plans', 'Tax', 'Notes']) {
      eq(dp(`Budget/${name.toLowerCase()}/x`, opts), managed(name), `${name}/ too, named in its canonical case`);
    }
    const nfc = 'Bégroting', nfd = 'Bégroting';
    ok(nfc !== nfd && nfc === nfd.normalize('NFC'), 'fixture: one name, two Unicode spellings');
    eq(dp(`${nfd}/Categories`, { budgetFolder: nfc }), managed('Categories'), 'a decomposed spelling of the budget folder is the same folder (NFC)');
    eq(dp('Categories', { budgetFolder: '' }), managed('Categories'), 'a budget folder at the vault root manages the root\'s Categories/');

    for (const f of ['../outside', 'Reports/../x', '..\\outside', ' .. /x', '.../x', 'a/b/..']) {
      eq(dp(f, opts), TRAVERSAL, `${JSON.stringify(f)} is refused rather than rebased`);
    }
    eq(dp('../.obsidian', opts), TRAVERSAL, 'a traversal is reported before anything it might point at');
    eq(dp('.obsidian/../Budget/Categories', opts), TRAVERSAL, 'including a config or managed folder it collapses onto');
  }

  /* ---- 2. managedFolderMatch folds the same way ------------------------------ */
  {
    const { managedFolderMatch } = require('../src/report');
    eq(managedFolderMatch('Budget/categories', 'Budget'), 'Categories', 'case-folded (L4A-03)');
    eq(managedFolderMatch('budget/Categories', 'Budget'), 'Categories', 'the budget folder too');
    eq(managedFolderMatch('Bégroting/Plans', 'Bégroting'), 'Plans', 'NFC-normalised');
    eq(managedFolderMatch('Budget/CategoriesOfSpending', 'Budget'), null, 'still by segment, not by prefix');
    eq(managedFolderMatch('Budget', 'Budget'), null, 'the budget folder itself is not a managed subfolder');
  }

  /* ---- 3. the ctx-bound version ----------------------------------------------- */
  {
    const ctx = makeCtx({ ...SEED }, { budgetFolder: B });
    await loadInto(ctx);
    ok(typeof ctx.destinationProblem === 'function', 'io publishes destinationProblem on ctx');
    eq(ctx.destinationProblem('.obsidian/plugins'), CFG, 'with the vault\'s config folder (".obsidian" when it reports none)');
    eq(ctx.destinationProblem(`${B}/categories`), managed('Categories'), 'and the configured budget folder');
    ctx.vault.configDir = '.config';
    eq(ctx.destinationProblem('.config/x'), { kind: 'configDir', folder: '.config' }, 'reading vault.configDir at call time');
    eq(ctx.destinationProblem('Reports'), null, 'an ordinary folder is fine');
  }

  /* ---- 4. the Report, before and at the click ------------------------------- */
  const unpin = pinClock(TODAY);
  try {
    const i18n = () => require('../src/i18n');
    const refusals = [
      { folder: '.obsidian/plugins/budget-app', message: () => i18n().t('bx.problem.configDir', { folder: '.obsidian' }) },
      { folder: `${B}/categories`, message: () => i18n().t('report.field.folderManaged', { folder: 'Categories' }) },
      { folder: '../outside', message: () => i18n().t('report.field.folderTraversal') },
      { folder: '.hidden', message: () => i18n().t('bx.problem.hiddenFolder', { folder: '.hidden' }) },
    ];
    for (const { folder, message } of refusals) {
      const M = await mountFor({ ...SEED }, { period: PERIOD, budgetFolder: B });
      const remembered = M.ctx.plugin.settings.reportFolder;
      M.ctx.renderReport();
      M.ctx.setReportFolder(folder);
      const desc = M.nodes.get('#reportFolderDesc');
      eq(desc.textContent, message(), `${folder}: the reader is told why BEFORE the click`);
      ok(desc.classList.contains('text-danger'), `${folder}: as a warning`);
      eq(M.nodes.get('#reportCreate').disabled, true, `${folder}: Create is disabled`);

      const out = await createReport(M, { folder });
      eq(out.written, [], `${folder}: and pressing it anyway writes nothing`);
      ok(out.toasts.some(t => t.includes(message())), `${folder}: the failure toast says why`);
      eq(M.ctx.plugin.settings.reportFolder, remembered, `${folder}: and the refused folder is not remembered`);
    }
    ok(i18n().t('report.field.folderTraversal') !== 'report.field.folderTraversal', 'the traversal sentence exists in English');

    /* NEGATIVE CONTROL: an ordinary nested folder writes, both formats. */
    const M = await mountFor({ ...SEED }, { period: PERIOD, budgetFolder: B });
    const out = await createReport(M, { folder: 'Household/Reports' });
    eq(out.written.sort(), ['Household/Reports/September 2026 Financial Report.json', 'Household/Reports/September 2026 Financial Report.md'],
      'CONTROL: an ordinary nested folder writes both files');
    eq(M.ctx.plugin.settings.reportFolder, 'Household/Reports', 'and is remembered for next time');
    eq(M.nodes.get('#reportCreate').disabled, false, 'with Create enabled');
  } finally { unpin(); }

  console.log(`PASS io-destination-guard (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
