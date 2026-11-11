'use strict';
/* The wiring order is declared once (2026-11-11 audit, task 23).

   Every module in this app is a register(ctx) function that destructures off
   the shared ctx at register time, so the order they are registered in is
   load-bearing. It used to be written three times — controller.js, the test
   harness and the figures helper — and the three had drifted: the figures
   helper, which is the mount the reconciliation gate and both golden ledgers
   run on, registered neither fx-live nor budget-export. The one test that can
   catch "two figures derived by different rules" was therefore run on an app
   that had no fxConvert, and nobody had decided that; a list had simply not
   been updated.

   src/wiring.js holds the list now. This suite pins the three things that
   make "once" true rather than aspirational:

     1. wire() applies ITS order, whatever the caller asked for, and refuses a
        name it does not hold instead of skipping it.
     2. Mounting through it yields the whole app: every view the controller
        dispatches to, and the two modules the gate used to be missing.
     3. The three former declarations no longer spell a list of their own —
        the only way they can drift again.

     node tests/wiring-one-declaration.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto, DATA_LAYER } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, dispatchedViews, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

(async () => {
  /* ---- 1. the order is the list's, never the caller's -------------------- */
  {
    const { WIRING, wire } = require('../src/wiring');
    const ids = WIRING.map(m => m.id);
    eq(new Set(ids).size, ids.length, 'every module is listed once — a duplicate would throw in ctx.provide at mount');
    ok(WIRING.every(m => typeof m.load === 'function' && typeof m.load() === 'function'), 'every entry loads a register(ctx) function');

    /* The dependencies the app's own comments call load-bearing, as an order
       over ids. Not a copy of the list (that would be the second declaration
       this file exists to prevent) — only the pairs a reorder must not break,
       each with the binding that breaks. */
    const before = (a, b, why) => ok(ids.indexOf(a) !== -1 && ids.indexOf(a) < ids.indexOf(b), `${a} registers before ${b} — ${why}`);
    eq(ids[0], 'io', 'io is first: every other module reads or writes through it');
    before('period', 'load', 'load.js reads periodRange/currentPeriod');
    before('load', 'fx-live', 'it reads the settings load fills and the book load names (loadedBook)');
    before('period', 'trend-math', 'trend-math destructures the period helpers');
    before('trend-math', 'figures', 'figures reads periodSpend');
    before('figures', 'health-data', 'health-data destructures periodFigures (ISSUE 84)');
    before('dashboard', 'report', 'the report reads the rows the Dashboard publishes');
    before('categories', 'transactions', 'lazyCatSelect');
    before('transactions', 'import', 'serializeTxFile');
    before('figures', 'budget-export', 'budgetVsActualRows');
    before('fx-live', 'accounts', 'the Accounts hero is the one caller of fxConvert');

    /* Swap the modules for recorders, so the order wire() applies
       is observed directly rather than inferred from a mount that happened not
       to throw. */
    const real = WIRING.map(m => m.load);
    const calls = [];
    WIRING.forEach(m => { m.load = () => () => calls.push(m.id); });
    try {
      wire({});
      eq(calls, ids, 'with no selection, every module registers, in list order');

      calls.length = 0;
      wire({}, [...DATA_LAYER].reverse());
      eq(calls, ids.filter(id => DATA_LAYER.includes(id)),
        'a selection chooses WHICH modules, never their sequence — handed the data layer backwards, wire() still applies its own order');

      calls.length = 0;
      assert.throws(() => wire({}, ['io', 'no-such-module']), /no module "no-such-module"/,
        'a name the list does not hold throws — a module renamed in wiring.js must not silently drop out of a harness that still asks for the old name');
      checks++;
      eq(calls, [], 'and it throws BEFORE registering anything, so a half-mounted ctx is never left behind');
    } finally { WIRING.forEach((m, i) => { m.load = real[i]; }); }
  }

  /* ---- 2. the gate's mount is the whole app ------------------------------ */
  {
    const B = 'Budget';
    const unpin = pinClock('2026-09-02');
    try {
      const M = await mountFor({ [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n' });
      for (const { view, fn } of dispatchedViews()) {
        ok(typeof M.ctx[fn] === 'function', `the mount provides ctx.${fn}, which controller.js dispatches "${view}" to`);
      }
      /* The two the figures helper never registered. fxConvert is the Accounts
         hero's converted total; exportBudgetWorkbook is budget-export's. */
      ok(typeof M.ctx.fxConvert === 'function' && typeof M.ctx.refreshRates === 'function' && typeof M.ctx.fxTable === 'function',
        'fx-live is mounted: the gate can reach fxConvert (task 8 depends on exactly this)');
      eq(M.ctx.fxConvert([]), null,
        'and with exchange_rates off it answers null — the un-converted split, which is every existing fixture');
      const budgetExport = Object.keys(spyProvides(require('../src/views/budget-export')));
      ok(budgetExport.length > 0 && budgetExport.every(k => k in M.ctx),
        `budget-export is mounted: ctx carries what it publishes (${budgetExport.join(', ')})`);
      M.restore();
    } finally { unpin(); }
  }

  /* ---- 2b. loadInto still registers the data layer and nothing else ------ */
  {
    const ctx = makeCtx({ 'Budget/Settings.md': '---\nmonth_start_day: 1\ncurrency: "R"\n---\n' });
    await loadInto(ctx);
    ok(typeof ctx.periodFigures === 'function' && typeof ctx.healthSnapshot === 'function' && typeof ctx.noteButton === 'function',
      'loadInto registers figures, health-data and notes');
    ok(!('renderDashboard' in ctx) && !('fxConvert' in ctx) && !('catSelect' in ctx),
      'and leaves the views, fx-live and categories to the caller — two hundred suites register their own afterwards, and a second ctx.provide throws');
  }

  /* ---- 3. no second spelling --------------------------------------------- */
  {
    const controller = read('src/controller.js');
    eq((controller.match(/require\('\.\/views\//g) || []).length, 0,
      'controller.js requires no view module itself — a view is wired by adding it to src/wiring.js');
    eq((controller.match(/^\s*register[A-Z]\w*\(ctx\);/gm) || []).length, 0,
      'and registers nothing by hand: a module registered there would be in the app and missing from the gate');
    ok(/^\s*wire\(ctx\);/m.test(controller), 'it mounts through wire(ctx)');

    for (const helper of ['tests/helpers/harness.cjs', 'tests/helpers/figures.cjs']) {
      const src = read(helper);
      eq((src.match(/require\([^)]*src\/views\//g) || []).length, 0,
        `${helper} names no view module — it reads src/wiring.js, so it cannot fall behind the app again`);
      ok(/src\/wiring'\)\.wire\(/.test(src), `${helper} registers through wire()`);
    }
  }

  console.log(`PASS wiring-one-declaration — one ordered list, read by the controller, the harness and the gate's mount (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });

/* What a register function publishes, read by handing it a ctx that answers
   anything and records provide(). Used to name budget-export's keys without
   typing them here. */
function spyProvides(register) {
  const provided = {};
  const anything = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : anything),
    apply: () => anything,
  });
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'provide' ? obj => Object.assign(provided, obj) : anything),
  });
  register(ctx);
  return provided;
}
