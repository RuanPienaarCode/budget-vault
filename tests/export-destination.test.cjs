'use strict';
/* Where the budget export may write, and what its "this replaces …" line
   says before the click — on a filesystem that ignores case, as macOS and iOS
   do.

   2026-10-07 audit:

     L4A-07 (a)    the dialog's "replaces" list asked Obsidian's index for the
                   EXACT path. An "exports/budget … - summary.csv" from an
                   earlier export typed into "exports" is, on APFS and iOS, the
                   very file "Exports/Budget … - Summary.csv" names — and the
                   preview said nothing. Worse than the audit could see from
                   outside Obsidian: Vault.create (app.js 1.13.7) asks the
                   ADAPTER whether the path exists, case-insensitively there,
                   and throws "File already exists." — so the click did not
                   even replace it, it stopped half-way. Now the preview asks
                   io.js's vaultPathTaken (case-folded, NFC), and the write
                   goes to the file the vault already has under its own
                   spelling, so "replaces" is what then happens.
     DESTINATIONS  the folder check refused Obsidian's config folder by its
                   first segments and nothing else of its kind: "x/.obsidian",
                   ".trash", ".obsidian-notes" were all accepted. Obsidian
                   indexes no path with a segment starting with a dot (app.js
                   1.13.7: a path is hidden when any segment startsWith(".")),
                   so the file was written where Open and Reveal can never
                   find it. The check is now io.js's destinationProblem —
                   traversal, config folder, managed folders, case-folded, the
                   rule the Report already uses — of the folder as TYPED and
                   of the folder written, plus a refusal of any hidden segment.
                   ".." used to be dropped silently ("../outside" wrote to
                   outside/); it is refused now, not rebased.

   The vault here is helpers/case-insensitive-vault.cjs: the harness vault
   behaving as Obsidian 1.13.7 does on APFS. Synthetic data only.

     node tests/export-destination.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { caseInsensitive } = require('./helpers/case-insensitive-vault.cjs');
const i18n = require('../src/i18n');
const FILES = require('./helpers/views-vault.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const JUNE = {
  [`${B}/Budgets/2026-06.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4500.00 | |\n| Salary | income | 40000.00 | |\n',
  [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${FILES.TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n| 2026-06-04 | Grocer | Groceries | -2100.50 |  |  |  |\n',
};
async function mount(extra, { insensitiveLookup = true } = {}) {
  const ctx = makeCtx({ ...FILES, ...JUNE, ...(extra || {}) });
  caseInsensitive(ctx.vault);
  if (!insensitiveLookup) delete ctx.vault.getAbstractFileByPathInsensitive;
  ctx.vault.configDir = '.obsidian';
  await loadInto(ctx);
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.currentPeriod = () => '2026-08';
  require('../src/views/budget-export')(ctx);
  return ctx;
}
/* June and July, both finished: a summary over them names three files */
const ANSWER = { mode: 'months', range: '2', includeCurrent: false, content: 'summary', categories: null, includeTx: false, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };
const MINE = 'exports/budget summary june 2026 to july 2026 - summary.csv';

(async () => {
  i18n.setLanguage('en');

  /* ---------------- L4A-07 (a): the case-variant file is named, then replaced ---------------- */
  {
    const ctx = await mount({ [MINE]: 'my own hand-edited notes\n' });
    const d = ctx.describeBudgetExport(ANSWER);
    ok(!d.problem, `exportable: ${d.problem || ''}`);
    eq(d.replaces, [MINE], 'the preview names the file a case-insensitive filesystem would overwrite — by the name it already has');
    eq(d.files, ['Exports/Budget summary June 2026 to July 2026.pdf', 'Exports/Budget summary June 2026 to July 2026.xlsx', MINE],
      'and lists it under that name, the path the click will write');
    let threw = null, out = null;
    try { out = await ctx.runBudgetExport(ANSWER); } catch (e) { threw = e; }
    eq(threw, null, 'the click does not stop at "File already exists." (what Obsidian\'s create says on APFS)');
    eq(out.written, d.files, 'it writes exactly the files the preview named');
    ok(ctx.vault._store.get(MINE).startsWith('Category,Type,Currency,June 2026,July 2026'), 'the existing file now holds the export — replaced, as the preview said');
    ok(!ctx.vault._store.has('Exports/Budget summary June 2026 to July 2026 - Summary.csv'), 'and no second spelling of it appeared beside it');
  }
  {
    // The exact-match case is unchanged: a second export names exactly the file already there.
    const ctx = await mount();
    eq(ctx.describeBudgetExport(ANSWER).replaces, [], 'a first export replaces nothing');
    await ctx.runBudgetExport({ ...ANSWER, formats: ['xlsx'] });
    eq(ctx.describeBudgetExport(ANSWER).replaces, ['Exports/Budget summary June 2026 to July 2026.xlsx'], 'a second names exactly the file already there');
  }
  {
    // An Obsidian without the insensitive lookup still WARNS — the replaces list is vaultPathTaken's.
    const ctx = await mount({ [MINE]: 'mine\n' }, { insensitiveLookup: false });
    eq(ctx.describeBudgetExport(ANSWER).replaces, ['Exports/Budget summary June 2026 to July 2026 - Summary.csv'],
      'without Obsidian\'s insensitive lookup the file is still named before the click (in the spelling asked for)');
  }

  /* ---------------- DESTINATIONS: one check, the Report's, plus hidden folders ---------------- */
  {
    const ctx = await mount();
    const problem = folder => ctx.describeBudgetExport({ ...ANSWER, folder }).problem || null;
    const hidden = seg => i18n.t('bx.problem.hiddenFolder', { folder: seg });
    eq(problem('.trash'), hidden('.trash'), 'Obsidian\'s .trash is hidden from the file explorer — refused, and the reason names it');
    eq(problem('Notes/.archive'), hidden('.archive'), 'any segment that starts with a dot hides everything under it');
    eq(problem('.obsidian-notes'), hidden('.obsidian-notes'), 'so ".obsidian-notes" is refused too — not as the config folder, as a hidden one');
    eq(problem('x/.obsidian'), hidden('.obsidian'), 'and a nested ".obsidian" is a hidden folder, not a config folder');
    ok(hidden('.trash') !== 'bx.problem.hiddenFolder' && /\.trash/.test(hidden('.trash')), 'the hidden-folder reason is real English text naming the folder (en.js)');
    eq(problem('.obsidian/plugins'), i18n.t('bx.problem.configDir', { folder: '.obsidian' }), 'inside the config folder is the config-folder reason, as before');
    eq(problem('.Obsidian'), i18n.t('bx.problem.configDir', { folder: '.obsidian' }), 'in any case');
    eq(problem('../outside'), i18n.t('report.field.folderTraversal'), '".." is refused, not silently dropped (it used to write to outside/)');
    eq(problem('Exports/../Budget/Categories'), i18n.t('report.field.folderTraversal'), 'a ".." anywhere, before whatever it collapses onto');
    eq(problem('Budget/categories'), i18n.t('report.field.folderManaged', { folder: 'Categories' }), 'a managed folder in another case');
    eq(problem('Budget\\Categories'), i18n.t('report.field.folderManaged', { folder: 'Categories' }), 'or typed with a backslash');
    for (const f of ['Exports', 'Admin/Tax 2026', 'obsidian-notes', 'Budget/Exports', './Exports', 'Exports.2026']) {
      eq(problem(f), null, `an ordinary folder is accepted: "${f}"`);
    }
    for (const f of ['.trash', 'x/.obsidian', '../outside', 'Budget/categories']) {
      let threw = null;
      const before = new Set(ctx.vault._store.keys());
      try { await ctx.runBudgetExport({ ...ANSWER, folder: f, formats: ['csv'] }); } catch (e) { threw = e; }
      ok(threw, `the write refuses "${f}" too, independently of the dialog`);
      eq([...ctx.vault._store.keys()].filter(k => !before.has(k)), [], `and nothing was written for "${f}"`);
    }
  }

  console.log(`PASS export-destination (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
