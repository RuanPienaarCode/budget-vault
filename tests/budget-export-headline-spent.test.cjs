'use strict';
/* The budget export's "Income X · Spent Y" line prints the Budget page's
   Total spent — ADR-0005's `budgetUsed(p).spent` — not gross spend.

   The PDF's headline (budget-export.js modelToDoc → headline()) was fed
   `periodSummary(p).spend`, which is every outflow including the money the
   household set aside into savings and investments. The Budget page's tile
   prints budgetSpent({ spend, setAside, assumed }): spend LESS set-aside, plus
   the assume-spent provision. The export's own header promises "a number in
   the file is the number on the screen it came from", and on the vault this was
   found on 44 of 52 periods printed a different figure on the two (2026-10-14
   audit, L4a-01): the PDF counted money moved into investments as spent.

   Pinned here over the committed synthetic household, through the REAL loader
   and the REAL view, with the expected figures worked out BY HAND from the
   fixture rather than read from the seam under test:

     September (the running period, today is the 2nd)
       outflows counted by the budget lens   Rent 9 000
                                              Groceries 2 000 + 400 (split part)
                                              Gym 200 (split part)
                                              Investing 2 000  (set aside)
                                              = 13 600 gross spend
       less set-aside                         2 000
       plus the assume-spent provision        Carry 500 (budgeted, no transaction)
       Total spent on the Budget page         12 100
     (the Takealot parent is excluded, the transfers are transfers, and the
     pram came out of the earmarked emergency fund.)

     1. a period's headline prints 12 100, not 13 600;
     2. the figure is the Budget page's own tile, read off the same view;
     3. a DATE-RANGE export's headline subtracts the window's own set-aside —
        the same rule over the window (August 14 000 + September 13 600, less
        2 000 set aside = 25 600; no budget is handed in for a window, so no
        provision);
     4. the model carries `spent` beside `spend`, so every rendering that wants
        the gross figure still has it.

     node tests/budget-export-headline-spent.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor } = require('./helpers/figures.cjs');
const { kids, text } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const bx = require('../src/budget-export');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ANSWER = { mode: 'months', range: '1', includeCurrent: true, content: 'full', categories: null, includeTx: false, formats: ['pdf'], folder: 'Exports' };
const plain = v => `R ${Number(v).toFixed(2)}`;
const headlines = doc => doc.blocks.filter(b => b.type === 'note' && /^Income /.test(b.text)).map(b => b.text);

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(SEED, { period: PERIOD, budgetFolder: B });
    require('../src/views/budget-export')(M.ctx);
    const { ctx } = M;

    /* ---- 1, 4. a period's headline -------------------------------------- */
    {
      const { model } = await ctx.runBudgetExport(ANSWER);
      eq(model.periods.map(p => p.key), [PERIOD], 'fixture: one period, September');
      const s = model.budgets[0].summary;
      eq(s.spend, 13600, 'the model still carries the gross spend (13 600 by hand)');
      eq(s.spent, 12100, 'and the Budget page\'s Total spent beside it: 13 600 - 2 000 set aside + 500 assumed');
      const doc = bx.modelToDoc(model, { money: plain });
      const line = headlines(doc)[0];
      ok(line.includes('Spent R 12100.00'), `the PDF headline prints the page's figure — got "${line}"`);
      ok(!line.includes('13600'), 'and not the gross spend that counted the investment as spent');
    }

    /* ---- 2. it is the figure the Budget page prints --------------------- */
    {
      ctx.renderBudgets();
      const tile = kids(M.nodes.get('#budTotalsTop'), n => n.attrs && n.attrs['data-fig'] === 'bud-spent')[0];
      ok(tile, 'fixture: the Budget page drew its Total spent tile');
      const page = text(tile);
      const { model } = await ctx.runBudgetExport(ANSWER);
      const doc = bx.modelToDoc(model, { money: v => ctx.money(v, 0) });
      const line = headlines(doc)[0];
      const printed = / Spent (.+?)(?: · |$)/.exec(line)[1];
      ok(page.includes(printed), `the page's tile "${page}" shows the figure the PDF prints "${printed}"`);
    }

    /* ---- 3. a date range ------------------------------------------------- */
    {
      const dates = { ...ANSWER, mode: 'dates', preset: 'custom', from: '2026-08-01', to: '2026-09-30' };
      const { model } = await ctx.runBudgetExport(dates);
      const x = model.exact;
      eq(x.through, TODAY, 'fixture: the window runs through today');
      eq([x.totals.spend, x.totals.spent], [27600, 25600], 'the window: 27 600 gross, 25 600 after its own 2 000 set-aside');
      const line = headlines(bx.modelToDoc(model, { money: plain }))[0];
      ok(line.includes('Spent R 25600.00'), `the exact-dates headline subtracts the set-aside too — got "${line}"`);
      /* A category filter withholds the headline, as it always did. */
      const filtered = await ctx.runBudgetExport({ ...dates, categories: ['Rent'] });
      eq(filtered.model.exact.totals, null, 'withheld under a category filter: it would describe money the table does not show');
    }
  } finally { unpin(); }

  /* ---- 4b. hand-built periods without `spent` fall back to the same rule --- */
  {
    const P = [{
      key: '2026-06', name: 'June 2026', title: 'x', start: '2026-05-23', end: '2026-06-22', rows: [], txs: [],
      summary: { income: 100, spend: 80, setAside: 30, uncatSpend: 0, foreign: { count: 0, labels: [], symbols: [] } },
    }];
    const m = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: false, generated: 'g', currency: 'R' });
    eq(m.budgets[0].summary.spent, 50, 'with no provision handed in, spent is spend less set-aside — budgetSpent over the summary\'s own operands');
  }

  console.log(`PASS budget-export-headline-spent (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
