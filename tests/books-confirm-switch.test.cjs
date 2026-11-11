'use strict';
/* A confirmation dialog is a window in which the open book can change
   (ADR 0009 §3, the review of #166–#169, finding 3).

   switchBook() refuses while a page is dirty, and undo-import and the
   Transactions bulk delete both run on a CLEAN page — so neither is protected
   by that refusal. Each gathers book A's month-file objects, then awaits a
   confirmModal. A switch can land inside that await (the headless API's
   setActiveBook() from a sibling plugin, a second Budget view or a popout),
   and when the reader confirms, each wrote through txFileRel(label, month) —
   which resolves against whatever book is open by then. With the switch made
   and B's reload landed during the dialog, A's rows (minus the ones being
   removed) were written over B's month file of the same account and month,
   and the bulk delete appended A's rows to B's delete log.

   Two windows, both pinned through the REAL views over the REAL loader. In
   both, the view's own check after the dialog (io.js opWriter().replaced(),
   on the load stamp it took before opening it) is what refuses — before any
   write is attempted:

     (a) switched, reload not landed yet — the stamp's folder is no longer the
         open book's. io.js's folder guard would refuse the write too, but it
         is never reached; it is the backstop for a writer with no stamp;
     (b) switched AND reloaded during the dialog — the load the stamp names is
         no longer the one in memory. The folder guard cannot see this case at
         all (the two folders agree again), which is why the stamp exists.

   A reload committing BETWEEN two writes after the dialog is
   tests/books-midloop-switch.test.cjs.

   In both, every file of BOTH books is byte-identical afterwards and the
   reader is told why. NEGATIVE CONTROL: the identical operation with no
   switch inside the dialog goes through.

     node tests/books-confirm-switch.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* confirmModal runs `duringDialog` while the reader is "looking at" it, then
   confirms. */
let duringDialog = null;
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null, askSplit: async () => null,
      confirmModal: async () => { if (duringDialog) await duringDialog(); return true; },
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { buildIndex } = require('../src/dedupe');

const HOME = 'Budget', ACME = 'Clients/Acme';
const LIST = [{ folder: HOME, label: 'Home' }, { folder: ACME, label: 'Acme' }];
const month = rows => '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | Food | ${r[2]} |  |  |\n`).join('');
const book = (b, rows) => ({
  [`${b}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${b}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${b}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${b}/Transactions/Cheque/2026-09.md`]: month(rows),
});
const FILES = {
  ...book(HOME, [['2026-09-02', 'Corner Cafe', '-35.00'], ['2026-09-03', 'HOME Bakery', '-20.00']]),
  ...book(ACME, [['2026-09-04', 'ACME Corner Supplies', '-400.00'], ['2026-09-05', 'ACME Retainer', '5000.00']]),
};
const snapshot = ctx => new Map([...ctx.vault._store].filter(([k]) => !k.endsWith('/.folder')));

async function mount() {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: HOME });
  const { ctx } = m;
  ctx.render = () => {};
  ctx.switchView = () => {};
  const store = {};
  ctx.plugin.app = { vault: ctx.vault, loadLocalStorage: k => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { store[k] = v; } };
  ctx.plugin.settings.books = LIST.map(b => ({ ...b }));
  return ctx;
}
const switchOnly = ctx => async () => { ctx.plugin.setOpenBookLocal(ACME); };
const switchAndReload = ctx => async () => { ctx.plugin.setOpenBookLocal(ACME); await ctx.loadVault(); };
const lastToast = ctx => ctx._toasts[ctx._toasts.length - 1] || {};

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- the Transactions bulk delete ---------------------------------- */
    for (const [name, hook] of [['switched, reload pending', switchOnly], ['switched and reloaded', switchAndReload]]) {
      const ctx = await mount();
      ctx.$('#txSearch').value = 'corner';
      const before = snapshot(ctx);
      duringDialog = hook(ctx);
      await ctx.deleteFilteredTransactions();
      duringDialog = null;
      eq(snapshot(ctx), before, `bulk delete, ${name} during the dialog: every file of both books is byte-identical`);
      ok(!ctx.vault._store.get(`${ACME}/Transactions/Cheque/2026-09.md`).includes('HOME Bakery'),
        `bulk delete, ${name}: the household's rows were not written into Acme's month`);
      ok(!ctx.vault._store.has(`${ACME}/Data/Deleted transactions.csv`), `bulk delete, ${name}: nothing appended to Acme's delete log`);
      ok(lastToast(ctx).bad === true && /book|reloaded|read again|nothing/i.test(lastToast(ctx).msg || ''),
        `bulk delete, ${name}: the reader is told why nothing happened ("${lastToast(ctx).msg}")`);
    }
    {
      const ctx = await mount();
      ctx.$('#txSearch').value = 'corner';
      await ctx.deleteFilteredTransactions();
      ok(!ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`).includes('Corner Cafe'),
        'NEGATIVE CONTROL: with no switch inside the dialog the bulk delete goes through');
      eq(ctx.vault._store.get(`${ACME}/Transactions/Cheque/2026-09.md`), FILES[`${ACME}/Transactions/Cheque/2026-09.md`], '… touching only the household');
    }

    /* ---- undo-import --------------------------------------------------- */
    const importOne = async ctx => {
      ctx.S.pendingImport = { label: 'Cheque', filename: 'cheque.csv', index: buildIndex(ctx.S.txFiles),
        items: [{ date: '2026-09-09', desc: 'IMPORTED Fuel', cat: 'Food', amount: -300, excluded: false, include: true, dup: false }] };
      await ctx.commitImport();
      ok(ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`).includes('IMPORTED Fuel'), 'fixture: the import landed in the household');
      ok(ctx.S.lastImport, 'fixture: … and an undo is on offer');
    };
    for (const [name, hook] of [['switched, reload pending', switchOnly], ['switched and reloaded', switchAndReload]]) {
      const ctx = await mount();
      await importOne(ctx);
      const before = snapshot(ctx);
      duringDialog = hook(ctx);
      await ctx.undoImport();
      duringDialog = null;
      eq(snapshot(ctx), before, `undo-import, ${name} during the dialog: every file of both books is byte-identical`);
      ok(!ctx.vault._store.get(`${ACME}/Transactions/Cheque/2026-09.md`).includes('HOME Bakery'),
        `undo-import, ${name}: the household's rows were not written over Acme's month`);
      ok(lastToast(ctx).bad === true && /book|reloaded|read again|nothing/i.test(lastToast(ctx).msg || ''),
        `undo-import, ${name}: the reader is told why ("${lastToast(ctx).msg}")`);
    }
    {
      const ctx = await mount();
      await importOne(ctx);
      await ctx.undoImport();
      ok(!ctx.vault._store.get(`${HOME}/Transactions/Cheque/2026-09.md`).includes('IMPORTED Fuel'),
        'NEGATIVE CONTROL: with no switch inside the dialog the undo goes through');
      eq(ctx.vault._store.get(`${ACME}/Transactions/Cheque/2026-09.md`), FILES[`${ACME}/Transactions/Cheque/2026-09.md`], '… and Acme is untouched');
    }
  } finally { unpin(); Module._load = origLoad; }

  console.log(`PASS books-confirm-switch — a switch inside a confirmation dialog writes nothing into either book, and says so (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
