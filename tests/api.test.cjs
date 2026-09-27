'use strict';
/* app.plugins.plugins['budget-app'].api — the headless read API.

   Vista's Budget card re-derived the Dashboard hero's "left to spend" figure
   from the vault files with its own reader, and a 2026-09-27 audit found it
   drifting from this app in thirteen ways. The fix is this module (src/api.js):
   Vista reads the app's own figure instead of re-deriving one.

   What this suite pins:
     1. api.currentPeriod() equals periodFigures(currentPeriod()) exactly as
        the Dashboard hero derives left/budgeted/spent/over from it — checked
        against the SAME household fixture the byte-golden ledger uses, read
        through the harness ctx every other figures test in this repo trusts,
        so a drift between api.js's own minimal ctx and the mounted one shows
        up here rather than only in a live vault.
     2. null when the budget folder is not configured.
     3. onChange fires after a reload, and unsubscribing stops it.
     4. every one of the above runs with no ItemView, no leaf, no DOM at all —
        the headless case Vista's card actually is.

     node tests/api.test.cjs
*/
const assert = require('assert');
const { stubObsidian, makeVault, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const { buildApi } = require('../src/api');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

function makePlugin(files, budgetFolder = B) {
  return { settings: { budgetFolder }, app: { vault: makeVault(files) }, _lastWrite: 0 };
}

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* ---- 1. parity with periodFigures, as the Dashboard hero reads it ---- */
    {
      const plugin = makePlugin(SEED);
      const api = buildApi(plugin);

      /* No workspace, no leaf, no view was ever constructed to get here —
         the "no view open" case (4) proven structurally rather than asserted
         by name: BudgetView/mountApp are never required by this file at all. */
      ok(!plugin.app.workspace, 'no workspace was touched — currentPeriod() needs no view');

      const got = await api.currentPeriod();
      ok(got, 'currentPeriod() answers for a configured vault');

      // The independent reader: the harness ctx every other figures/period
      // test in this repo already trusts (registerIo/Period/Load/Figures plus
      // trend-math, health-data and notes — none of which touch budget totals).
      const ctx2 = makeCtx(SEED, { budgetFolder: B });
      const S2 = await loadInto(ctx2);
      const p = ctx2.currentPeriod();
      eq(p, PERIOD, "sanity: the fixture's current period is the one the golden ledger pins");
      const F = ctx2.periodFigures(p);

      // views/dashboard.js's renderHero, verbatim: bud.spend minus used.spent.
      const budgeted = F.budget.spend;
      const spent = F.used.spent;
      const left = budgeted - spent;

      eq(got.budgeted, budgeted, 'budgeted matches periodFigures.budget.spend, as the hero reads it');
      eq(got.spent, spent, "spent matches periodFigures.used.spent (carries the assume-spent provision)");
      eq(got.left, left, "left is the hero's own subtraction, not a third rule");
      eq(got.start, F.range.start, 'range start matches periodRange');
      eq(got.end, F.range.end, 'range end matches periodRange');
      eq(got.asOf, F.summary.asOf, "asOf is periodSummary's own running-period boundary");
      eq(got.label, ctx2.periodTitle(p), 'label is periodTitle — the header pill\'s own string');
      eq(got.currency, { symbol: S2.settings.currency },
        'currency carries the household symbol only — this fixture sets no currency_code');

      const wantOver = F.rows.filter(r => r.over)
        .map(r => ({ category: r.cat, budgeted: r.budget, spent: r.actual }))
        .sort((a, b) => (b.spent - b.budgeted) - (a.spent - a.budgeted));
      eq(got.over, wantOver, 'over-budget categories match budgetVsActualRows, most over first');
      ok(wantOver.every((r, i) => i === 0 || (wantOver[i - 1].spent - wantOver[i - 1].budgeted) >= (r.spent - r.budgeted)),
        'over is sorted most-over-first');

      ok(Array.isArray(got.notes), 'notes is an array');
      // This fixture holds a foreign-currency account (household.cjs's own
      // header names it as the multi-currency case) — the hero's own caveat
      // about it must ride along on the exported figure too.
      if (F.summary.foreign && F.summary.foreign.count) {
        ok(got.notes.length > 0, 'a period with foreign accounts held out carries that caveat');
        ok(got.notes.some(n => n.includes(String(F.summary.foreign.count))),
          'the caveat names the same count the hero itself would print');
      }
    }

    /* ---- 2. null when unconfigured ---- */
    {
      const plugin = makePlugin({});
      const api = buildApi(plugin);
      const got = await api.currentPeriod();
      eq(got, null, 'no Settings.md and no Categories/ folder — null, not a fabricated figure');
    }
    {
      // Half-configured: a Categories/ folder with nothing else. hasBudgetData's
      // own rule (main.js) is "either exists", so this must answer, not null.
      const plugin = makePlugin({ [`${B}/Categories/Food.md`]: '---\ntype: expense\n---\n' });
      const api = buildApi(plugin);
      const got = await api.currentPeriod();
      ok(got !== null, 'a Categories/ folder alone counts as configured, same as hasBudgetData()');
    }

    /* ---- 3. onChange fires after a reload; unsubscribe stops it ---- */
    {
      const plugin = makePlugin(SEED);
      const api = buildApi(plugin);
      let fired = 0;
      const unsubscribe = api.onChange(() => { fired++; });
      await api._reload();
      eq(fired, 1, 'onChange fires once after a reload');
      await api._reload();
      eq(fired, 2, 'and again after a second one');
      unsubscribe();
      await api._reload();
      eq(fired, 2, 'unsubscribe stops further firing');

      // currentPeriod() itself must NOT be the thing that fires onChange —
      // otherwise a subscriber hears about its own read.
      let firedAgain = 0;
      api.onChange(() => { firedAgain++; });
      await api.currentPeriod();
      await api.currentPeriod();
      eq(firedAgain, 0, 'currentPeriod() reloads for freshness but never notifies on its own');
    }

    /* ---- 4. a bare-node host with no vault.on() never throws at construction ---- */
    {
      const plugin = makePlugin(SEED);
      ok(typeof plugin.app.vault.on === 'undefined', 'sanity: this harness vault has no event bus');
      let api;
      assert.doesNotThrow(() => { api = buildApi(plugin); },
        'buildApi must not require vault.on to exist');
      ok(typeof api.currentPeriod === 'function' && typeof api.onChange === 'function', 'api shape is intact regardless');
      checks++;
    }

    console.log(`api: ${checks} checks passed.`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
