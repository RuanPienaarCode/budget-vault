'use strict';
/* The Transactions export is named after what is IN it, refuses the folders
   its siblings refuse, and says which files it is about to replace.

   Three defects in one click, all silent (2026-10-07 audit):

   L4A-01 — files were named by range alone, so an export filtered to Fuel and
   the next, unfiltered export of the same period landed on ONE path: the
   one-row Fuel file was replaced by the full one without a word, and the CSV
   never said it had been filtered at all. The budget export already names
   this exact shape "data loss" (src/budget-export.js budgetExportPaths). Now
   the active filter is in the file name — up to three, each with its kind,
   past that a count and a short tag of WHICH filters — and a re-export of the
   same selection still lands on, and replaces, its own earlier file. The CSV
   carries its filter in its NAME only: a comment row would be read as data by
   every pivot table and by this app's own importer.

   TX-EXPORT-DEST (L4A-02 / L4B-PATH-TXEXPORT) — the destination had none of
   the Report's and the budget export's guards. Into <budget>/Categories the
   next vault load gained two categories; into .obsidian/plugins/budget-app it
   wrote four files nothing in the file explorer will ever show; and the
   folder was then remembered as the default. Refused now, before anything is
   written, through io.js's destinationProblem — the one answer every export
   shares — worded with the Report's own sentences.

   And a typed folder that already held the reader's own Categories.md had it
   overwritten with only a success toast. An export replaces what is at its
   paths — that is its contract — so it now says which files those are and
   waits, the way the budget export's dialog lists "replaces …".

   Driven through the REAL exportTransactions over the REAL loader; only the
   two dialogs are answered.
     node tests/transactions-export-names-and-destination.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const folders = [];
const confirmAnswers = [];
const confirms = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => (folders.length ? { folder: folders.shift() } : null),
      askSplit: async () => null,
      confirmModal: async (app, opts) => { confirms.push(opts); return confirmAnswers.length ? confirmAnswers.shift() : true; },
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const i18n = require('../src/i18n');

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD
    + '| 2026-09-02 | Shell Main Road | Fuel | -500.00 |  |  |\n'
    + '| 2026-09-04 | Engen Station | Fuel | -300.00 |  |  |\n'
    + '| 2026-09-05 | Corner Cafe | Food | -35.00 |  |  |\n'
    + '| 2026-09-06 | Payment to the local municipality for water and electricity services | Food | -900.00 |  |  |\n'
    + '| 2026-09-07 | Transfer ref a/b:c | Food | -10.00 |  |  |\n'
    + '| 2026-09-25 | Salary | Salary | 20000.00 |  |  |\n',
};

async function mount(extra = {}) {
  const m = await mountFor({ ...FILES, ...extra }, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.plugin.settings.exportFolder = 'Exports';
  m.ctx.app.vault.configDir = '.obsidian';
  return m;
}
const filter = (ctx, { acc = '', cat = '', q = '' } = {}) => {
  ctx.$('#txAccount').value = acc; ctx.$('#txCategory').value = cat; ctx.$('#txSearch').value = q;
};
const exportInto = async (ctx, folder) => { folders.push(folder); await ctx.exportTransactions(); };
const written = (ctx, before) => [...ctx.vault._store.keys()].filter(k => !before.has(k) && !k.endsWith('/.folder')).sort();
const csvRows = text => text.trim().split('\n').length - 1;
const lastToast = ctx => ctx._toasts[ctx._toasts.length - 1] || {};

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. a filtered export and the full one are two files -------------- */
    {
      const { ctx } = await mount();
      const range = ctx.filteredRows().range;
      const base = `Exports/Transactions ${range}`;
      filter(ctx, { cat: 'Fuel' });
      await exportInto(ctx, 'Exports');
      const fuelCsv = ctx.vault._store.get(`${base} (category Fuel).csv`);
      ok(fuelCsv, `the Fuel export is named after its filter: "${base} (category Fuel).csv"`);
      ok(ctx.vault._store.get(`${base} (category Fuel).md`), 'and so is its markdown twin');
      eq(csvRows(fuelCsv), 2, 'fixture: two Fuel rows');
      filter(ctx);
      await exportInto(ctx, 'Exports');
      ok(ctx.vault._store.get(`${base}.csv`), 'the unfiltered export keeps the plain name it always had');
      eq(csvRows(ctx.vault._store.get(`${base}.csv`)), 6, 'with every row');
      eq(ctx.vault._store.get(`${base} (category Fuel).csv`), fuelCsv,
        'and the Fuel export is still there, untouched (L4A-01: it was silently replaced)');
      ok(!/fuel|filter/i.test(fuelCsv.split('\n')[0]), 'the CSV itself stays data only — a comment row would be read as a row by a pivot table and by the importer');

      /* The same selection again replaces its own file — and says so. */
      filter(ctx, { cat: 'Fuel' });
      confirms.length = 0;
      await exportInto(ctx, 'Exports');
      eq(confirms.length, 1, 're-exporting the same selection asks before replacing');
      ok(confirms[0].message.includes(`${base} (category Fuel).csv`), 'and names the file it replaces');
      eq(ctx.vault._store.get(`${base} (category Fuel).csv`), fuelCsv, 'then writes the same file again, at the same path');
    }

    /* ---- 2. up to three filters named, past that a count and a tag --------- */
    {
      const { ctx } = await mount();
      const range = ctx.filteredRows().range;
      filter(ctx, { acc: 'Cheque', cat: 'Fuel', q: 'SHELL' });
      await exportInto(ctx, 'Exports');
      ok(ctx.vault._store.get(`Exports/Transactions ${range} (account Cheque, category Fuel, search shell).csv`),
        'three filters are each named, with their kind — an account and a category of one name never collide');
      ctx.setTxInBudgetOnly('Fuel');               // the Dashboard drill-through's scope: a fourth
      const before = new Set(ctx.vault._store.keys());
      await exportInto(ctx, 'Exports');
      const four = written(ctx, before).filter(k => k.endsWith('.csv'));
      eq(four.length, 1, 'four filters write one CSV');
      ok(/ \(4 filters [0-9a-z]{4,}\)\.csv$/.test(four[0]), `past three, the name counts them and tags which: ${four[0]}`);
      const again = new Set(ctx.vault._store.keys());
      await exportInto(ctx, 'Exports');
      eq(written(ctx, again), [], 'the same four filters land on the same path');
      filter(ctx, { acc: 'Cheque', cat: 'Fuel', q: 'engen' });
      ctx.setTxInBudgetOnly('Fuel');
      const other = new Set(ctx.vault._store.keys());
      await exportInto(ctx, 'Exports');
      const four2 = written(ctx, other).filter(k => k.endsWith('.csv'));
      ok(four2.length === 1 && four2[0] !== four[0], 'and a different four never share a path with them');

      ctx.setTxInBudgetOnly(null);
      filter(ctx, { q: 'payment to the local municipality for water and electricity services' });
      const long = new Set(ctx.vault._store.keys());
      await exportInto(ctx, 'Exports');
      const longCsv = written(ctx, long).filter(k => k.endsWith('.csv'));
      ok(longCsv.length === 1 && / \(1 filter [0-9a-z]{4,}\)\.csv$/.test(longCsv[0]),
        `a filter too long for a file name is tagged, not spelled out: ${longCsv[0]}`);

      filter(ctx, { q: 'a/b:c' });
      const odd = new Set(ctx.vault._store.keys());
      await exportInto(ctx, 'Exports');
      const oddCsv = written(ctx, odd).filter(k => k.endsWith('.csv'));
      ok(oddCsv.length === 1 && oddCsv[0].endsWith('(search a-b-c).csv'), `characters a path cannot carry are made safe: ${oddCsv[0]}`);

      /* The name budget is BYTES, the unit a file-name limit is counted in: 20
         CJK characters are 60 bytes (and 29 characters with the kind), so by a
         character count they would have been spelled out. */
      const { filterTag } = require('../src/exporter');
      ok(/^\(1 filter [0-9a-z]{4,}\)$/.test(filterTag([`category ${'中'.repeat(20)}`])),
        'a name that is short in characters but long in bytes is tagged, not spelled out');
      eq(filterTag([`category ${'中'.repeat(4)}`]), `(category ${'中'.repeat(4)})`, 'while a short one is still named');
    }

    /* ---- 3. folders the next load would read back are refused --------------- */
    const REFUSED = [
      [`${B}/Categories`, i18n.t('report.field.folderManaged', { folder: 'Categories' })],
      [`${B.toLowerCase()}/categories`, i18n.t('report.field.folderManaged', { folder: 'Categories' })],
      [`${B}/Accounts`, i18n.t('report.field.folderManaged', { folder: 'Accounts' })],
      [`${B}/Plans`, i18n.t('report.field.folderManaged', { folder: 'Plans' })],
      [`${B}/Notes`, i18n.t('report.field.folderManaged', { folder: 'Notes' })],
      [`${B}/Transactions/Exports`, i18n.t('report.field.folderManaged', { folder: 'Transactions' })],
      ['.obsidian/plugins/budget-app', i18n.t('bx.problem.configDir', { folder: '.obsidian' })],
      ['../outside', i18n.t('report.field.folderTraversal')],
      ['.obsidian-notes', i18n.t('bx.problem.hiddenFolder', { folder: '.obsidian-notes' })],
      ['Exports/.cache', i18n.t('bx.problem.hiddenFolder', { folder: '.cache' })],
    ];
    for (const [folder, reason] of REFUSED) {
      const { ctx } = await mount();
      const before = new Set(ctx.vault._store.keys());
      await exportInto(ctx, folder);
      eq(written(ctx, before), [], `"${folder}": nothing is written`);
      const t = lastToast(ctx);
      ok(t.bad, `"${folder}": the refusal is said, as an error`);
      eq(t.msg, reason, `"${folder}": in the Report's own words`);
      eq(ctx.plugin.settings.exportFolder, 'Exports', `"${folder}": and it is not remembered as the next default`);
    }
    {
      /* What the refusal saves: the next load does not gain a category. */
      const { ctx, S } = await mount();
      await exportInto(ctx, `${B}/Categories`);
      const ctx2 = makeCtx(Object.fromEntries(ctx.vault._store), { budgetFolder: B });
      const S2 = await loadInto(ctx2);
      eq(S2.categories.map(c => c.name).sort(), S.categories.map(c => c.name).sort(), 'the next vault load reads the same categories (L4A-02: two were added)');
    }
    for (const folder of ['Exports', `${B}/Exports`, 'Admin/Tax 2026']) {
      const { ctx } = await mount();
      const before = new Set(ctx.vault._store.keys());
      await exportInto(ctx, folder);
      eq(written(ctx, before).length, 4, `control: "${folder}" is an ordinary folder and all four files are written`);
    }

    /* ---- 4. a file already at a path is named before it is replaced ---------- */
    {
      const MINE = 'My own notes on how we categorise. Do not lose this.';
      const { ctx } = await mount({ 'Household/Categories.md': MINE });
      confirms.length = 0;
      confirmAnswers.push(false);
      const before = new Set(ctx.vault._store.keys());
      await exportInto(ctx, 'Household');
      eq(confirms.length, 1, 'a folder holding a file at one of the export\'s paths is asked about first');
      ok(confirms[0].message.includes('Household/Categories.md'), 'and the question names that file');
      eq(confirms[0].message, i18n.t('bx.replaces', { count: 1, files: 'Household/Categories.md' }), 'in the budget export\'s own sentence');
      eq(ctx.vault._store.get('Household/Categories.md'), MINE, 'declined: the reader\'s note is untouched');
      eq(written(ctx, before), [], 'and nothing else was written either');
      eq(ctx.plugin.settings.exportFolder, 'Exports', 'nor is the folder remembered');

      confirmAnswers.push(true);
      await exportInto(ctx, 'Household');
      ok(ctx.vault._store.get('Household/Categories.md') !== MINE, 'agreed: the export replaces it, which is now a choice the reader made');
      eq(ctx.plugin.settings.exportFolder, 'Household', 'and the folder is remembered once something landed');
    }
    {
      const { ctx } = await mount();
      confirms.length = 0;
      await exportInto(ctx, 'Fresh folder');
      eq(confirms.length, 0, 'control: nothing to replace, nothing to ask');
    }
  } finally { unpin(); }
  console.log(`PASS transactions-export-names-and-destination — named after its filter, refused where the vault would read it back, and asked before replacing (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
