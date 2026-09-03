'use strict';
/* The "Largest" tile picked its winner by comparing raw numbers across
   currencies.

     const biggest = S.assets.reduce((b, a) => (a.value > b.value ? a : b));

   `a.value` is a figure stated in whatever symbol its own row carries, and
   this vault holds no rate to convert one into another — currency.js:10 is
   explicit that it never invents one. So the comparison was not a comparison
   at all: it ranked 50000000 above 900000 without asking what either number
   was denominated in.

   It fails hardest where it looks most plausible. A currency that runs many
   units to the rand — rupiah, yen, won — makes an ordinary foreign possession
   outrank the family home on the digits alone: an Rp 50 000 000 motorbike
   (about R50 000) beat an R900 000 house. And because the value is then
   printed by aMoney() in the winner's OWN symbol, the label was correct. The
   page read "Largest: Rp 50 000 000 · Motorbike" — a true sentence, a true
   figure, and the wrong item — which is worse than a visibly broken tile,
   because there is nothing on screen for the reader to disbelieve.

   The fix is the shape the tile DIRECTLY ABOVE it has used since issue #30:
   answer the question over the household's own currency, and name the rest
   beside the answer rather than folding them in or dropping them. Total value
   already reads `assetTotal(S.assets, S.settings.currency)` with
   `plus … held abroad, not converted` under it; Largest now ranks the
   household rows and names the largest per foreign symbol under itself.

   Driven through the real view module over the shared DOM stub, the same way
   tests/assets-valuation-age-and-currency.test.cjs drives it: the tile is
   assembled inside renderAssetKpis(), so a test that re-derived the reduce
   would be guarding a copy of the bug.

     node tests/assets-largest-currency.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const HEAD = '| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n';

/* Valuation dates are all recent literals so the stale caveat and the
   "Needs a new valuation" tile stay out of the strings asserted here — this
   file is about the Largest tile only, and views/assets.js reads the wall
   clock directly, so the fixture rather than the test has to guarantee it. */
const assets = rows => ({
  [`${B}/Settings.md`]: SETTINGS,
  [`${B}/Assets.md`]: `---\nkind: assets\n---\n\n# Assets\n\n${HEAD}${rows.join('\n')}\n`,
});

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts',
    'savings', 'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  ctx.renderAssets();
  /* The ONE tile, not the whole KPI strip. "Total value" carries its own
     `plus … held abroad` footnote off the same rows, so asserting against the
     strip's textContent would let that footnote satisfy an assertion about
     this one — a test that passes on its neighbour's disclosure while the tile
     under examination says nothing. Each tile is a `.mini` whose first child
     is its `.l` label (src/dom.js kpiTiles). */
  /* The hero (variant B of the 3 Sep 2026 redesign) folds the four tiles into
     one card; the "largest" figure and its footnotes now live together in one
     `.assets-hero-largest` span, which is the single node this test reads. */
  return label => {
    const t = $('#assetKpis').querySelector(label === 'Largest' ? '.assets-hero-largest' : '.assets-hero');
    assert.ok(t, `the "${label}" figure must be on the page`);
    return t.textContent;
  };
}

(async () => {
  /* ---- 1. a many-units-to-the-rand currency does not win on the digits ---- */
  {
    const tile = await mount(assets([
      '| House | property | 900000.00 | 2026-08-01 | | |',
      '| Motorbike | vehicle | 50000000.00 | 2026-08-01 | | Rp |',
    ]));
    const L = tile('Largest');
    ok(/House/.test(L),
      `the household's own biggest possession is the largest — got: ${JSON.stringify(L)}`);
    ok(!/Motorbike/.test(L),
      'a rupiah figure does not outrank a rand one on its digit count — there is no rate here to compare with');
    ok(/Rp 50000000/.test(L),
      'and it is NAMED beside the answer rather than dropped: currency.js:14 forbids silent exclusion');
  }

  /* ---- 2. the winner is still stated in the household's own symbol ---- */
  {
    const tile = await mount(assets([
      '| House | property | 900000.00 | 2026-08-01 | | |',
      '| Corolla | vehicle | 120000.00 | 2026-08-01 | | |',
      '| Motorbike | vehicle | 50000000.00 | 2026-08-01 | | Rp |',
    ]));
    const L = tile('Largest');
    ok(/R 900000/.test(L), `the winning figure prints in rand — got: ${JSON.stringify(L)}`);
    ok(!/R 50000000/.test(L), 'and no rupiah figure is ever relabelled as rand');
  }

  /* ---- 3. two foreign symbols are each named, largest per symbol ---- */
  /* The same [symbol, figure] pair shape otherList() already prints under the
     Total value tile, so the two tiles disclose the same fact the same way.
     Per symbol it is the LARGEST, not the total — a tile answering "what is
     the biggest thing here" must not put a sum in its footnote, which would be
     two figures derived by different rules inside one caption. */
  {
    const tile = await mount(assets([
      '| House | property | 900000.00 | 2026-08-01 | | |',
      '| Lisbon flat | property | 400000.00 | 2026-08-01 | | € |',
      '| Lisbon car | vehicle | 30000.00 | 2026-08-01 | | € |',
      '| Motorbike | vehicle | 50000000.00 | 2026-08-01 | | Rp |',
    ]));
    const L = tile('Largest');
    ok(/€ 400000/.test(L), `the largest euro row is named — got: ${JSON.stringify(L)}`);
    ok(!/€ 430000/.test(L), 'the euro rows are not summed — this tile answers "largest", not "total"');
    ok(/Rp 50000000/.test(L), 'and the rupiah row is named too');
  }

  /* ---- 4. a single-currency vault is unchanged ---- */
  /* The negative control for the whole change: nearly every vault has no
     foreign row at all, and this tile must read there exactly as it always
     did or the fix has altered every household to serve a few. */
  {
    const tile = await mount(assets([
      '| House | property | 900000.00 | 2026-08-01 | | |',
      '| Corolla | vehicle | 120000.00 | 2026-08-01 | | |',
    ]));
    const L = tile('Largest');
    ok(/House/.test(L) && /R 900000/.test(L), 'the biggest rand asset, in rand');
    ok(!/not converted/.test(L), 'and no foreign footnote appears where there is nothing to disclose');
  }

  /* ---- 5. nothing priced yet still reads "—" ---- */
  /* The state the comment above the reduce exists for. Seeding from the first
     row rather than from null is what stops a household that has listed the
     house, the car and the ring but priced none of them from reading
     "Largest: —" as though it owned nothing — the tile names a row and states
     its zero. Filtering to household rows must not have reintroduced that. */
  {
    const tile = await mount(assets([
      '| House | property | | | | |',
      '| Ring | jewellery | | | | |',
    ]));
    const L = tile('Largest');
    ok(/House/.test(L), `an unpriced household still has a largest item named — got: ${JSON.stringify(L)}`);
  }

  /* ---- 6. an empty book still reads "—" ---- */
  {
    const tile = await mount({ [`${B}/Settings.md`]: SETTINGS,
      [`${B}/Assets.md`]: `---\nkind: assets\n---\n\n# Assets\n\n${HEAD}` });
    const L = tile('Largest');
    ok(/—/.test(L), `no assets at all is still an em dash — got: ${JSON.stringify(L)}`);
  }

  /* ---- 7. every asset foreign: the answer is honestly absent, not wrong ---- */
  /* There is no household-currency asset, so there is no household-currency
     answer, and inventing one would mean picking across currencies again. The
     tile says so and the footnote carries what the page DOES know. */
  {
    const tile = await mount(assets([
      '| Lisbon flat | property | 400000.00 | 2026-08-01 | | € |',
      '| Motorbike | vehicle | 50000000.00 | 2026-08-01 | | Rp |',
    ]));
    const L = tile('Largest');
    ok(/—/.test(L), `nothing is held in rand, so the rand answer is an em dash — got: ${JSON.stringify(L)}`);
    ok(/€ 400000/.test(L) && /Rp 50000000/.test(L),
      'and both foreign holdings are still named rather than the page falling silent');
  }

  console.log(`assets-largest-currency.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
