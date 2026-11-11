'use strict';
/* The wiring order, declared ONCE.

   Every module below is a `register(ctx)` function: it destructures what it
   needs off the shared ctx AT REGISTER TIME and publishes its own helpers back
   with ctx.provide(). So the order is load-bearing — a provider registered
   after its reader binds `undefined`, and the failure surfaces as "x is not a
   function" a whole screen away from the cause (ISSUE 84 was exactly that).

   Until the 2026-11-11 audit (task 23) the order was written down three
   times: in controller.js, in tests/helpers/harness.cjs (whose own comment
   called it "a SECOND declaration of the app's wiring order") and in
   tests/helpers/figures.cjs. The three had already drifted. The harness
   registered load AFTER health-data where the app registers it third; the
   figures helper registered food last where the app registers it before the
   Dashboard; and the figures helper — the mount the reconciliation gate and
   both golden ledgers run on — left out fx-live and budget-export altogether.
   So the one test that can catch "two figures derived by different rules" ran
   on a mount the app never performs, and the converted Accounts hero, the only
   caller of fxConvert, was outside it (task 8).

   This list is the controller's order exactly as it stood, moved here so that
   the controller, the harness and the figures helper all read it. A new view
   is wired by adding ONE line; it cannot be mounted in the app and forgotten
   in the gate.

   `id` is the name a caller selects a module by (harness.cjs registers only
   the data layer, because 200 suites register their own views after it).

   `load` is a thunk, not the module, so that asking for the data layer does
   not evaluate every view. That is not thrift: a suite such as
   tests/assets-kind-labels.test.cjs swaps `askFields` on the modal module
   AFTER loadInto and BEFORE it requires views/assets.js, which takes
   `askFields` off that module when it is first evaluated. A list of eager
   requires evaluated the view inside loadInto, ahead of the swap, and the
   suite opened a real dialog. The app is unchanged by it: controller.js calls
   loadAll() at its own top level, where its twenty-six requires used to be, so
   every module is still evaluated when the controller is and not at first
   mount. (esbuild bundles a require() inside a function exactly as it does
   one at the top of a file.) */

const WIRING = [
  /* Order is load-bearing: io before all (writeFile/readFile); period before
     load/dashboard/transactions/budgets/import (currentPeriod, txInPeriod);
     categories before transactions/budgets/import (lazyCatSelect); transactions
     before import (serializeTxFile). Reordering these silently produces
     "x is not a function" a whole screen away from the cause. */
  { id: 'io', load: () => require('./io') },                  // basePath, readFile, writeFile, mdFilesIn, …
  { id: 'period', load: () => require('./period') },          // periodRange, currentPeriod, periodSummary, …
  { id: 'load', load: () => require('./load') },              // loadVault, txSegment
  /* After load (it reads S.settings) and before every view that might print a
     converted figure. Registering it does NOT touch the network — see its own
     header; nothing happens at all until exchange_rates is switched on. */
  { id: 'fx-live', load: () => require('./fx-live') },        // fxTable, refreshRates, fxConvert
  { id: 'categories', load: () => require('./categories') },  // catSelect, lazyCatSelect, promptCreateCategory
  { id: 'trend-math', load: () => require('./trend-math') },  // trendPeriods, historySpan, periodSpend, … (needs period)
  // After trend-math, whose periodsForMonths it uses, and before the two views
  // that read the snapshot it assembles.
  /* figures BEFORE health-data, and the order is load-bearing. ISSUE 84 —
     health-data.js reads periodFigures, and every module here destructures off
     ctx at register time, so a provider registered afterwards binds undefined.
     Safe in this direction: figures.js reads only period/load seams and nothing
     health-data publishes. */
  { id: 'figures', load: () => require('./figures') },        // periodFigures, budgetVsActualRows, categorySpendRows, categoryGap (ADR-0006 Phase 3)
  { id: 'health-data', load: () => require('./health-data') }, // healthSnapshot
  /* Before the views, because five of them render its noteButton() chip — they
     reach it through ctx at render time rather than by destructuring, so the
     order is belt-and-braces rather than load-bearing. loadVault calls
     ctx.loadNotes(), which is late-bound for the same reason. */
  { id: 'notes', load: () => require('./views/notes') },
  /* After period (periodRange, currentPeriod, catType, dateText) and io;
     loadVault calls ctx.loadReceipts, which load.js publishes itself. */
  { id: 'food', load: () => require('./views/food') },
  { id: 'dashboard', load: () => require('./views/dashboard') },
  // After dashboard, whose budgetVsActualRows/categorySpendRows it reads —
  // the report page's whole reason for existing is never re-deriving those.
  { id: 'report', load: () => require('./views/report') },
  { id: 'score', load: () => require('./views/score') },
  { id: 'transactions', load: () => require('./views/transactions') },
  { id: 'budgets', load: () => require('./views/budgets') },
  // After figures (budgetVsActualRows) and trend-math (periodsForMonths,
  // earliestDataMonth), which it destructures; budgetDirty it reads late.
  { id: 'budget-export', load: () => require('./views/budget-export') },
  { id: 'plan', load: () => require('./views/plan') },
  { id: 'accounts', load: () => require('./views/accounts') },
  { id: 'savings', load: () => require('./views/savings') },
  { id: 'assets', load: () => require('./views/assets') },
  { id: 'debts', load: () => require('./views/debts') },
  { id: 'owed', load: () => require('./views/owed') },
  { id: 'services', load: () => require('./views/services') },
  { id: 'tax', load: () => require('./views/tax') },
  { id: 'loans', load: () => require('./views/loans') },
  { id: 'import', load: () => require('./views/import') },
  /* LAST, after every view has published its renderers: it wraps each one so
     a page paints inside one render pass (see its header). Registered before
     a view, it would find nothing to wrap and that view would paint outside
     any pass — correct figures, computed many times over. Not controller.js's
     order: this module is new with the 2026-11-11 audit, task 9(b). */
  { id: 'render-pass', load: () => require('./render-pass') },
];

/* Register the modules onto a ctx, in the one order.

   With no `only`, every module — what the app does at mount. With `only` (an
   array of ids), just those, still in THIS list's order whatever order the
   caller wrote them in: a caller may choose how much of the app it mounts, and
   never the sequence. An id this list does not hold throws rather than being
   skipped, so a module renamed here cannot quietly drop out of a harness that
   still asks for it by its old name — the silent omission is the defect this
   file exists to end. */
function wire(ctx, only) {
  if (only) {
    for (const id of only) {
      if (!WIRING.some(m => m.id === id)) throw new Error(`wiring: no module "${id}" in src/wiring.js`);
    }
  }
  for (const m of WIRING) {
    if (!only || only.includes(m.id)) m.load()(ctx);
  }
}

/* Evaluate every module now, registering nothing. For controller.js, which
   used to do exactly this by requiring each one at the top of the file. */
function loadAll() {
  for (const m of WIRING) m.load();
}

module.exports = { WIRING, wire, loadAll };
