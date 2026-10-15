'use strict';
/* Three small defects in the Transactions export's click, found by the
   2026-10-14 audit (L4a-06, L4a-07, L4a-11). Driven through the REAL
   exportTransactions over the REAL loader; only the two dialogs are answered.

   L4a-06  The export wrote paths.* with no case-variant check. macOS and iOS
           resolve paths case-insensitively and Obsidian's index does not: an
           earlier "exports/Transactions Whole history.csv" IS the file
           "Exports/Transactions Whole history.csv" names there. The dialog
           warned it would REPLACE the file (vaultPathTaken folds case), the
           reader said yes, and then writeVaultFile missed the index's exact
           key, called vault.create, and Obsidian threw "File already
           exists." — the export stopped half-way and said only "Could not
           write the export". The budget export and the Report adopted
           onDisk() for exactly this (2026-10-07, L4A-07 a); this one did not.

   L4a-07  The file name for "whole history" came from the interface
           language's own phrase, so a Afrikaans reader's export was
           "Transactions Hele geskiedenis.csv" — and the same selection
           exported from a phone set to English landed on a different path,
           so neither replaced the other. File names are literal English
           (the export naming rule, filteredRows's `names`).

   L4a-11  The refusal for a managed folder reused report.field.folderManaged,
           "a report saved here would be read back in…" — a sentence about a
           document this click never makes. The export has its own wording.

     node tests/transactions-export-case-name-refusal.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const folders = [];
const confirms = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => (folders.length ? { folder: folders.shift() } : null),
      askSplit: async () => null,
      confirmModal: async (app, opts) => { confirms.push(opts); return true; },
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { caseInsensitive } = require('./helpers/case-insensitive-vault.cjs');
/* mountFor re-requires src/ fresh, so the i18n the views hold is not the one required
   at the top: ask the cache again after every mount. */
const I = () => require('../src/i18n');

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD
    + '| 2026-09-02 | Shell Main Road | Fuel | -500.00 |  |  |\n'
    + '| 2026-09-25 | Salary | Salary | 20000.00 |  |  |\n',
};

async function mount(extra = {}, { insensitive = false } = {}) {
  const m = await mountFor({ ...FILES, ...extra }, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.plugin.settings.exportFolder = 'Exports';
  m.ctx.app.vault.configDir = '.obsidian';
  if (insensitive) caseInsensitive(m.ctx.vault);
  return m;
}
const lastToast = ctx => ctx._toasts[ctx._toasts.length - 1] || {};
const hasFolded = (ctx, p) => [...ctx.vault._store.keys()].some(k => k.toLowerCase() === p.toLowerCase());
const exportInto = async (ctx, folder) => { folders.push(folder); await ctx.exportTransactions(); };

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- L4a-06: a case-variant file is replaced, not a failure ------------- */
    {
      const MINE = 'exports/Transactions Whole history.csv';
      const { ctx } = await mount({ [MINE]: 'an earlier export\n' }, { insensitive: true });
      ctx.$('#txWholeHistory').checked = true;
      confirms.length = 0;
      await exportInto(ctx, 'Exports');
      const t = lastToast(ctx);
      ok(!t.bad, `no failure toast after the reader agreed to replace it: ${JSON.stringify(t.msg)}`);
      eq(confirms.length, 1, 'the dialog still asks first');
      ok(confirms[0].message.includes(MINE), 'and names the file the vault already has, by its own spelling');
      ok(ctx.vault._store.get(MINE).startsWith('Date,Description'), 'the earlier file now holds the export — replaced, as the dialog said');
      ok(!ctx.vault._store.has('Exports/Transactions Whole history.csv'), 'and no second spelling of it appeared beside it');
      ok(hasFolded(ctx, 'exports/Transactions Whole history.md'), 'the markdown twin was written too (the failure stopped it after the first write)');
      ok([...ctx.vault._store.keys()].some(k => /Categories\.csv$/i.test(k)), 'and the categories files — the export ran to the end');
    }
    {
      // Control: an exact-case file is still replaced at its own path.
      const { ctx } = await mount({ 'Exports/Transactions Whole history.csv': 'earlier\n' }, { insensitive: true });
      ctx.$('#txWholeHistory').checked = true;
      await exportInto(ctx, 'Exports');
      ok(!lastToast(ctx).bad && ctx.vault._store.get('Exports/Transactions Whole history.csv').startsWith('Date,'), 'control: the exact-case file is replaced where it is');
    }
    {
      // A fresh folder asks nothing and writes under the spelling typed.
      const { ctx } = await mount({}, { insensitive: true });
      ctx.$('#txWholeHistory').checked = true;
      confirms.length = 0;
      await exportInto(ctx, 'Exports');
      eq(confirms.length, 0, 'control: nothing there, nothing to ask');
      ok(ctx.vault._store.has('Exports/Transactions Whole history.csv'), 'control: written under the typed spelling');
    }

    /* ---- L4a-07: the file name is English whatever the interface says ------- */
    for (const lang of ['af', 'de', 'zh']) {
      const { ctx } = await mount();
      I().setLanguage(lang);          // after mount: loading the vault resets the language to its setting
      ctx.$('#txWholeHistory').checked = true;
      ok(I().t('tx.wholeHistory') !== 'Whole history', `${lang}: fixture — the interface phrase really differs`);
      eq(ctx.filteredRows().range, I().t('tx.wholeHistory'), `${lang}: the range shown to the reader is still translated`);
      await exportInto(ctx, 'Exports');
      ok(ctx.vault._store.has('Exports/Transactions Whole history.csv'), `${lang}: the whole-history export is "Transactions Whole history.csv"`);
      const stray = [...ctx.vault._store.keys()].filter(k => /^Exports\/Transactions /.test(k) && !k.startsWith('Exports/Transactions Whole history.'));
      eq(stray, [], `${lang}: no file named in the interface language`);
      // A month export: the month name is English already (period.js MONTH_FULL).
      const { ctx: c2 } = await mount();
      I().setLanguage(lang);
      await exportInto(c2, 'Exports');
      const month = [...c2.vault._store.keys()].filter(k => /^Exports\/Transactions .*\.csv$/.test(k));
      eq(month.length, 1, `${lang}: one month CSV`);
      ok(/^Exports\/Transactions September 2026 /.test(month[0]), `${lang}: a month export keeps its English month name: ${month[0]}`);
    }
    I().setLanguage('en');

    /* ---- L4a-11: the refusal has its own words ------------------------------ */
    {
      const { ctx } = await mount();
      I().setLanguage('en');
      await exportInto(ctx, `${B}/Categories`);
      const t = lastToast(ctx);
      ok(t.bad, 'a managed folder is refused as an error');
      eq(t.msg, I().t('tx.export.folderManaged', { folder: 'Categories' }), 'in the Transactions export\'s own sentence');
      ok(t.msg !== 'tx.export.folderManaged', 'which is real text in en.js, not the key echoed back');
      ok(!/report/i.test(t.msg), `and does not talk about a report: ${t.msg}`);
      ok(/Categories/.test(t.msg) && /export/i.test(t.msg), 'it names the folder and the export');
    }
  } finally { unpin(); }
  console.log(`PASS transactions-export-case-name-refusal — a case-variant file is replaced, the file name is literal English, the managed-folder refusal talks about the export (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
