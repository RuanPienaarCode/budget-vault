'use strict';
/* The numbers harness must see the Notes page and the multi-period Report.

   L2b-10 (15 Oct 2026 audit), two blind spots in tests/helpers/figures.cjs:

   1. NOTES. mountFor() built the ctx, ran loadInto() — which registers
      views/notes.js, and notes.js destructures `$` off the ctx AT REGISTER TIME —
      and only then swapped the real DOM stub in. So the Notes page rendered into
      the harness's inert stand-in, drew nothing, and both golden ledgers have
      carried an empty `## notes` section since the harness was written: a page
      that could have lost every note without the ledger moving.

   2. THE GENERATED REPORT. The ledger harvests what each page RENDERS; the
      Report page renders a form, and its figures live in the document Create
      writes. Nothing harvested that, so the 3-month and 12-month documents were
      never read. The 12-month document shipped "165% of spending budget used"
      (spend over twelve months against the budget of the one period that had
      one) and every guard stayed green.

   Pinned: a note reaches the Notes page through mountFor; harvestAll returns a
   `report-3m` and a `report-12m` entry whose figures are read off the generated
   markdown, addressed by section and row so the golden line is stable.

     node tests/figures-harness-covers-notes-and-report.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, harvestAll, pinClock, harvestView, dispatchedViews } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

(async () => {
  /* ---- 1. the Notes page draws ---------------------------------------- */
  {
    const note = (title, subject) => `---\nnote_kind: account\nnote_subject: "${subject}"\ncreated: 2026-09-01\n---\n\n# ${title}\n\nbody\n`;
    const files = {
      ...SEED,
      [`${B}/Notes/2026-09-01 Gate code.md`]: note('Gate code', 'Cheque'),
      [`${B}/Notes/2026-09-02 Statement query.md`]: note('Statement query', 'Cheque'),
    };
    const unpin = pinClock(TODAY);
    try {
      const M = await mountFor(files, { period: PERIOD, budgetFolder: B });
      const view = dispatchedViews().find(v => v.view === 'notes');
      ok(view, 'notes is a dispatched view');
      const res = harvestView(M.ctx, M.nodes, M.raws, view);
      eq(res.error, null, 'the Notes page renders without throwing');
      const drawn = String((M.nodes.get('#notesList') || {}).textContent || '');
      ok(/Gate code/.test(drawn) && /Statement query/.test(drawn),
        `both notes are drawn into #notesList (got: "${drawn.slice(0, 80)}")`);
      ok(res.figures.length > 0, 'and the harvest finds numbers on the page (the KPI tiles) instead of an empty section');
    } finally { unpin(); }
  }

  /* ---- 2. the generated report is harvested ---------------------------- */
  {
    const results = await harvestAll(SEED, { period: PERIOD, today: TODAY, budgetFolder: B });
    const names = results.map(r => r.view);
    ok(names.includes('report-3m') && names.includes('report-12m'), `harvestAll includes the generated 3m and 12m reports (views: ${names.join(', ')})`);
    for (const key of ['report-3m', 'report-12m']) {
      const r = results.find(x => x.view === key);
      eq(r.error, null, `${key}: generated without error`);
      ok(r.figures.length > 20, `${key}: its markdown figures are harvested (${r.figures.length})`);
      /* The heading is the section's own words — sentence case since the
         2026-10-20 audit (D2-20) — matched without regard to case so the
         address test is about addressing, not about styling. */
      const inc = r.figures.find(f => /^report-(3m|12m)\/Income & Spend\/Income\//i.test(f.address) && f.kind === 'money');
      ok(inc, `${key}: the Income row of Income & spend has an addressed money figure`);
      ok(r.figures.some(f => f.kind === 'percent'), `${key}: percentages (e.g. "% of spending budget used") are harvested`);
      ok(!r.figures.some(f => /\b2026-\d\d-\d\d\b/.test(f.text) || /^\d\d:\d\d$/.test(f.text)), `${key}: the generated-at stamp and ISO dates are not figures`);
    }
    /* Addresses are what the golden diff is read by: a figure appearing twice
       under one address would be indistinguishable in a diff. */
    const r12 = results.find(x => x.view === 'report-12m');
    const keys = r12.figures.map(f => `${f.address}|${f.text}`);
    eq(new Set(keys).size, keys.length, 'report-12m: no two figures share an address and text');
  }

  console.log(`PASS figures-harness-covers-notes-and-report (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
