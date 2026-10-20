'use strict';
/* The reconciliation holds the donut legend to the reader's own sum (M1-01,
   audit of 20 Oct 2026).

   Each legend row prints Spent, a baseline (3M / prev) and Change, and the
   header says Change is Spent against that baseline. A reader checks it in
   their head with the two figures printed beside it. Until this audit the
   checker did not: it compared the Change with the RAW values behind Spent
   and the baseline, at a 1.01 tolerance, and a real row of that shape — here
   with made-up figures, Spent R 2 718, 3M R 2 717 and Change R 0 — passed,
   though the sum the reader does gives R 1.

   The check now reads all three off their PRINTED text (U+00A0 mapped to a
   space first) and requires Change = Spent − baseline exactly. This suite
   rehearses the audit's row on the synthetic household's own legend, so it
   fails on the old rule and passes on the new one, plus the controls that
   keep the new rule from failing a row that does add up.

   Figures are made up. Lane L1 fixes the page; this file pins only the check.
     node tests/reconcile-donut-legend-exact.test.cjs */

const assert = require('assert');
const { reconcile, householdVault, runChecks } = require('../scripts/reconcile-page.cjs');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const clone = x => JSON.parse(JSON.stringify(x));
const LEGEND = /Donut legend: Change = Spent/;
const legendCheck = checks => {
  const hit = checks.filter(c => c.page === 'dashboard' && LEGEND.test(c.name));
  assert.strictEqual(hit.length, 1, `exactly one donut legend check (got ${hit.length})`);
  return hit[0];
};

/* The first legend row carrying all three money figures, as live references
   into a cloned page set so a test can rewrite what the page "printed". */
function firstFullRow(pages) {
  const dash = pages.find(p => p.view === 'dashboard');
  const rows = new Map();
  for (const f of dash.figures) {
    const m = /^dashSplit\/ul\.donut-legend\/li\[(\d+)\]\/.*span\.dl-(val|base|delta)\[/.exec(f.address);
    if (!m || f.kind !== 'money') continue;
    (rows.get(m[1]) || rows.set(m[1], {}).get(m[1]))[m[2]] = f;
  }
  return [...rows.values()].find(r => r.val && r.base && r.delta);
}
const print = (f, text, raw) => { f.text = text; f.raw = raw; f.context = { ...f.context, own: text }; };

(async () => {
  const H = householdVault();
  const r = await reconcile({ ...H, today: '2026-10-05' });

  /* ---- the household's own legend adds up ---- */
  const base = legendCheck(r.checks);
  eq(base.status, 'pass', `on the fixture the printed legend adds up: ${base.pageSource}`);
  ok(base.globalValue >= 3, `and it compared real rows (${base.globalValue})`);
  ok(firstFullRow(clone(r.pages)), 'fixture: at least one row carries Spent, a baseline and a Change');

  /* ---- the audit's row: R 2 718 against R 2 717, printed Change R 0 ---- */
  {
    const pages = clone(r.pages);
    const row = firstFullRow(pages);
    // The raw values sit 0.2 apart, so "R 0" is the rounded TRUE movement —
    // the old rule's excuse — while the printed parts differ by a whole rand.
    print(row.val, 'R 2 718', 2717.6);
    print(row.base, 'R 2 717', 2717.4);
    print(row.delta, 'R 0', 0);
    const c = legendCheck(runChecks(r.G, pages));
    eq(c.status, 'fail', `Spent R 2 718, 3M R 2 717, Change R 0 FAILS: ${c.pageSource}`);
    ok(/R 2 718 − R 2 717 = 1, page prints 0/.test(c.pageSource), `and names the row with its printed figures: ${c.pageSource}`);
  }

  /* ---- controls: rows that do add up, in the shapes the page prints ---- */
  {
    const pages = clone(r.pages);
    const row = firstFullRow(pages);
    print(row.val, 'R 2 718', 2717.6);
    print(row.base, 'R 2 717', 2717.4);
    print(row.delta, '+R 1', 1);
    eq(legendCheck(runChecks(r.G, pages)).status, 'pass', 'the same row printing +R 1 passes');
  }
  {
    const pages = clone(r.pages);
    const row = firstFullRow(pages);
    print(row.val, 'R 2 400', 2400);
    print(row.base, 'R 4 000', 4000);
    print(row.delta, '−R 1 600', 1600);
    eq(legendCheck(runChecks(r.G, pages)).status, 'pass', 'a fall, printed with the U+2212 minus before the symbol, passes');
    print(row.delta, '−R 1 500', 1500);
    eq(legendCheck(runChecks(r.G, pages)).status, 'fail', 'and the same fall misprinted by R 100 fails');
  }
  {
    const pages = clone(r.pages);
    const row = firstFullRow(pages);
    print(row.val, 'R\u00a012\u00a0345', 12345);
    print(row.base, 'R\u00a012\u00a0000', 12000);
    print(row.delta, '+R\u00a0345', 345);
    eq(legendCheck(runChecks(r.G, pages)).status, 'pass', 'figures glued with U+00A0 are read as the reader reads them');
  }

  console.log(`PASS — the donut legend check holds the printed Change to the printed Spent − baseline exactly (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
