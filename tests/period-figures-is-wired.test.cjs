'use strict';
/* ISSUE 84 — the surfaces READ the snapshot, not merely agree with it.

   periodFigures() is the period snapshot ADR-0006 Phase 3 exists to provide.
   It had no caller anywhere in src/: four surfaces plus health-data.js each
   composed their own period out of the same seven ctx seams, 44 direct calls
   between them.

   tests/period-figures.test.cjs asserts the snapshot's VALUES match what the
   views compute. It never asserts a view READS it — so the seam could be
   correct, unused and green, which is exactly the state it was in. That is the
   same shape as the Plan mirror test (a test proving an equivalence rather than
   a wiring) which left seven suites green over transposed loader columns.

   So this file spies on the seam and RENDERS. An equivalence test cannot tell
   "both compute 1 000" from "one of them is dead"; a call count can.

   The spy has to be installed BEFORE the view modules are required: they
   destructure off ctx at register time — views-render.test.cjs's own comment
   records that — so a wrapper added afterwards would never be seen.

     node tests/period-figures-is-wired.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const FILES = require('./helpers/views-vault.cjs');

/* The surfaces that read the snapshot, and the period each asks it for.

   `budgets` is NOT here, and that is a finding rather than an omission — see
   the block at the end of this file. */
const SURFACES = [
  { view: 'dashboard', fn: 'renderDashboard', period: 'screen' },
  /* The Report page's RENDER draws the options card; the migrated loop is in
     buildReportData(), which the exported document runs. createReport() is the
     real entry to it and writes only into the in-memory vault here. */
  { view: 'report', fn: 'createReport', period: 'range' },
  /* The Score's flow card is "this period's income" and stays anchored to the
     current period whatever month is on screen, so it asks for that one. */
  { view: 'score', fn: 'renderScore', period: 'current' },
];

async function mount(period = '2026-07') {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  S.period = period;
  const { $ } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);

  /* The spy, before a single view module is required. */
  const calls = [];
  const real = ctx.periodFigures;
  ok(typeof real === 'function', 'periodFigures is on the ctx before any view registers');
  ctx.periodFigures = p => { calls.push(p); return real(p); };

  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts', 'savings',
    'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return { ctx, S, calls };
}

(async () => {
  for (const { view, fn, period } of SURFACES) {
    const { ctx, calls } = await mount();
    calls.length = 0;
    await ctx[fn]();
    ok(calls.length > 0, `views/${view}.js reads periodFigures() when it renders (${calls.length} call(s))`);
    if (period === 'range') {
      /* The Report covers a SPAN, so it asks the snapshot once per period in
         that span rather than for the one on screen. Assert the shape, not a
         particular month. */
      ok(calls.every(p => /^\d{4}-\d{2}$/.test(p)),
        `views/${view}.js asks it for real periods (${calls.join(', ')})`);
    } else {
      const want = period === 'screen' ? '2026-07' : ctx.currentPeriod();
      ok(calls.includes(want),
        `views/${view}.js asks it for the ${period} period (${want}; asked for: ${calls.join(', ') || 'nothing'})`);
    }
  }

  /* health-data.js is named by ISSUE 84 too, and is asserted STATICALLY here
     rather than with the spy. Not laziness — the spy genuinely cannot see it.
     health-data is registered by loadInto, so it destructures the real
     periodFigures before any wrapper this file installs can exist, which is the
     same register-time binding that makes the ordering in controller.js
     load-bearing. The view modules are required AFTER the spy goes in, which is
     why they can be caught behaviourally and this one cannot.

     Its wiring is proven instead by the byte-golden ledger: health-data feeds
     the Score's ring and the Dashboard's health card, and all 770 figures were
     unchanged across the migration. */
  {
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'health-data.js'), 'utf8');
    ok(/\bperiodFigures\b/.test(src), 'health-data.js reads periodFigures');
    ok(!/\bbudgetUsed\(p\)|\bbudgetTotals\(p\)|\bperiodSpend\(p, null\)|\bperiodRange\(p\)/.test(src),
      'and no longer re-composes the period from the seams behind it');
  }

  /* ---- why views/budgets.js is not in SURFACES ------------------------ */
  {
    /* ISSUE 84 asks for four surfaces. The Budget page cannot be one of them,
       and the reason is a product behaviour rather than an oversight: its strip
       and tile are computed over the UNSAVED DRAFT —

         planFigures(S.period, { rows: draft })
         budgetUsed(S.period, { rows: draft })

       — "so the strip moves as an amount is typed, before the file is saved"
       (views/budgets.js's own comment). periodFigures(p) takes no override and
       reads saved state, so routing that page through it would silently stop
       the figures moving as the reader types.

       Asserted rather than merely written down, so that if periodFigures ever
       learns the override this file is what says the exception can end. */
    const fs = require('fs'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'budgets.js'), 'utf8');
    ok(/planFigures\(S\.period, \{ rows: draft \}\)/.test(src),
      'the Budget page still computes its plan over the unsaved draft');
    const figs = fs.readFileSync(path.join(__dirname, '..', 'src', 'figures.js'), 'utf8');
    const sig = (figs.match(/function periodFigures\(([^)]*)\)/) || [])[1];
    eq((sig || '').trim(), 'p',
      'periodFigures still takes a period alone — the day it takes an override, the Budget page can join');
  }

  console.log(`PASS period-figures-is-wired (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
