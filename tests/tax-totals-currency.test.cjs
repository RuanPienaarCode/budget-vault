'use strict';
/* One tax page, two currencies, six inches apart.

   views/tax.js says at the top of its own checks block that "Every figure
   below is in <authority currency> — tax figures come off your certificates
   and the thresholds are SARS's, so this page is in R even though the rest of
   your budget is in Rp. Nothing is converted." locale.js's figureChecks then
   formats every callout with `this.currency`, honouring exactly that.

   The Figures table's own totals row did not. It formatted with money(), the
   HOUSEHOLD formatter, so a `country: za` vault set to `currency: Rp` read
   "R 23 800,00" in the callout and "Rp 23 800,00" in the totals row beneath
   it — the same figure, twice, in two currencies, on one card, with a
   paragraph between them promising nothing had been converted.

   This is the identical defect views/loans.js already fixed for the statutory
   tariff cards (its `tariffMoney`, and the comment above it: "Transfer duty
   $ 23 544 directly above costsNote's own literal text quoting initiation
   R5 250 + VAT"), so the fix is that same helper rather than a second idea
   about it.

   Drives the REAL views/tax.js through the DOM double and the real loader —
   the bug is in what the view formats with, which no test of locale.js or
   table arithmetic can see.

     node tests/tax-totals-currency.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TAX = '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n'
  + '# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n'
  + '| Gather documents | busy | 2026-09-01 | |\n\n'
  + '## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n'
  + '| IRP5 | Employer | needed | | |\n\n'
  + '## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n'
  + '| 4201 | Local interest | Bank A | 15000.00 |\n'
  + '| 4201 | Local interest | Bank B | 8800.00 |\n';

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => descend(e).map(x => x.textContent || '').join(' ') + (e.textContent || '');

/* `currency` is the household's; `country` decides the tax authority, and so
   the currency every figure on this page is actually stated in. The two being
   allowed to differ is the whole point of locale.js's own currency field. */
async function mount(currency) {
  const files = {
    [`${B}/Settings.md`]: `---\nmonth_start_day: 1\ncurrency: "${currency}"\ncountry: za\n---\n`,
    [`${B}/Tax/2026.md`]: TAX,
  };
  const ctx = makeCtx(files, { budgetFolder: B, settings: { month_start_day: 1, currency, country: 'za' } });
  const S = await loadInto(ctx);
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  /* Deliberately DISTINCT formatters: money() prints the household symbol and
     moneyIn() whatever symbol it is handed. A test whose two formatters agree
     could not tell the two apart, which is the entire question here. */
  ctx.money = (v, dp = 2) => `${currency} ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  require('../src/views/tax')(ctx);
  ctx.renderTax();
  return { ctx, S, nodes };
}

const totalRows = nodes =>
  descend(nodes.get('#taxFiguresTable')).filter(e => hasCls(e, 'tax-fig-total')).map(textOf);

(async () => {
  const za = require('../src/locale').PROFILES.za;
  eq(za.currency, 'R', 'the za profile states the authority\'s currency — the figure this page is denominated in');

  /* ---- 1. household currency differs from the authority's ---- */
  {
    const { nodes } = await mount('Rp');
    const rows = totalRows(nodes);
    eq(rows.length, 1, 'the two 4201 figures collapse into one total row, which is the shape a return asks for');
    ok(/R 23800\.00/.test(rows[0]),
      `the totals row is in the AUTHORITY's currency, like every other figure on the page (got ${JSON.stringify(rows[0])})`);
    ok(!/Rp 23800\.00/.test(rows[0]),
      'and NOT the household\'s — the paragraph above it promises nothing was converted, and printing Rp here makes that promise false');
  }

  /* ---- 2. the ordinary vault, where the two are the same ---- */
  {
    const { nodes } = await mount('R');
    const rows = totalRows(nodes);
    eq(rows.length, 1, 'same one row');
    ok(/R 23800\.00/.test(rows[0]),
      'a household already budgeting in the authority\'s own currency reads exactly what it always did — this fix is invisible to nearly every vault');
  }

  console.log(`PASS  tax-totals-currency.test.cjs  (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
