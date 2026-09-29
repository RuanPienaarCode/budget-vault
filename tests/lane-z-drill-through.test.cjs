'use strict';
/* Lane Z, item 3 (2026-09-29 totals audit): the drill-through sum.

   Tapping a Dashboard wedge lands on Transactions filtered to that category, and
   the page tells the reader the list is what the wedge adds up to. The
   reconciliation now taps every legend row, the Uncategorised tile and the
   Missing categories tile the way the page wires them, sums the counted rows
   listed and compares. This pins the checker on the committed household:

     - a household whose drill-throughs agree passes every one;
     - the household itself holds ONE real disagreement, and this test names it
       (the Groceries wedge lists the earmarked-fund outflow the BUDGET lens
       holds out: R3 900 under a wedge of R2 400) - see KNOWN_SCREEN_BUGS in
       tests/reconcile-gate.test.cjs;
     - a running period that lists rows dated after today fails, with the reason
       on the check. That is expected until the Transactions scope hides them
       (another lane's change); the tampered case below pins the wording.

     node tests/lane-z-drill-through.test.cjs */

const assert = require('assert');
const { reconcile, householdVault, runChecks } = require('../scripts/reconcile-page.cjs');
const { B } = require('./figures/household.cjs');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const clone = x => JSON.parse(JSON.stringify(x));
const drills = checks => checks.filter(c => /^Drill-through/.test(c.name));
const one = (checks, re) => {
  const hit = drills(checks).filter(c => re.test(c.name));
  assert.strictEqual(hit.length, 1, `exactly one drill check matching ${re} (got ${hit.length}: ${hit.map(c => c.name).join(' | ')})`);
  return hit[0];
};

(async () => {
  const H = householdVault();

  /* ---- the household as it is -------------------------------------------------- */
  const base = await reconcile({ ...H });
  const dash = base.pages.find(p => p.view === 'dashboard');
  ok(dash.drill && !dash.drill.error, 'the Dashboard was clicked');
  eq(dash.drill.wedges.map(w => w.name), ['Rent', 'Groceries', 'Investing', 'Gym'], 'every legend row was tapped, in the order the donut draws them');
  for (const w of dash.drill.wedges) eq(w.selected, w.name, `${w.name}: the tap selects its own category on Transactions`);
  eq(dash.drill.wedges.find(w => w.name === 'Rent').sum, -9000, 'the Rent list adds up to the Rent wedge');

  for (const cat of ['Rent', 'Investing', 'Gym']) eq(one(base.checks, new RegExp(`wedge "${cat}"`)).status, 'pass', `${cat}: the list sums to the wedge`);
  /* Was the one real screen bug this check found (2026-09-29): the list also
     carried the pram paid from the earmarked Emergency fund, R3 900 under a
     R2 400 wedge. The drill-through now hides every BUDGET-lens veto
     (tests/lane-int-drill-vetoes.test.cjs). */
  const groceries = one(base.checks, /wedge "Groceries"/);
  eq(groceries.status, 'pass', 'Groceries: the list sums to the wedge, the earmarked pram held back');
  eq(groceries.pageValue, 2400, 'R2 400 listed under a wedge of R2 400');
  eq(one(base.checks, /legend row is a split row/).status, 'pass', 'the clickable legend rows are the top of the split, in order');
  eq(one(base.checks, /hero tiles drawn exactly/).status, 'pass', 'the household has no uncategorised or orphaned rows, so no tile');

  /* ---- a household whose drill-throughs agree ------------------------------------ */
  const files = { ...H.files };
  delete files[`${B}/Transactions/Emergency fund/2026-09.md`];   // no earmarked outflow
  files[`${B}/Transactions/Emergency fund/2026-09.md`] = '---\nkind: transactions\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
    + '| 2026-09-02 | From cheque | Transfer | 1000.00 |  |  |  |\n';
  const clean = await reconcile({ ...H, files });
  eq(drills(clean.checks).filter(c => c.status !== 'pass').map(c => c.name), [], 'without the earmarked outflow every drill-through check passes');
  eq(one(clean.checks, /wedge "Groceries"/).pageValue, 2400, 'Groceries lists exactly the wedge: Checkers plus the counted part; the excluded parent is listed but not summed');
  ok(clean.pages.find(p => p.view === 'dashboard').drill.wedges.find(w => w.name === 'Groceries').excludedListed >= 1, 'the excluded split parent IS listed (nothing silently disappears) and is left out of the sum');

  /* ---- the tiles ---------------------------------------------------------------- */
  const tiled = { ...files };
  tiled[`${B}/Transactions/Cheque/2026-09.md`] += '| 2026-09-02 | Mystery shop |  | -60.00 |  |  |  |\n'
    + '| 2026-09-02 | Kiosk | Renamed away | -80.00 |  |  |  |\n'
    + '| 2026-09-02 | Deli | Old name | -20.00 |  |  |  |\n';
  const withTiles = await reconcile({ ...H, files: tiled });
  const d2 = withTiles.pages.find(p => p.view === 'dashboard').drill;
  eq(d2.expectedTiles, ['uncategorised', 'missing'], 'both tiles are drawn, Uncategorised first');
  eq(d2.tiles.map(t => [t.kind, t.selected, t.count]), [['uncategorised', '__none__', 1], ['missing', '__missing__', 2]], 'each tile selects its filter and lists its rows');
  eq(drills(withTiles.checks).filter(c => c.status !== 'pass').map(c => c.name), [], 'and every drill-through check passes, wedges for the orphaned names included');
  eq(one(withTiles.checks, /Uncategorised tile lists/).globalValue, 1, 'the Uncategorised tile says 1');
  eq(one(withTiles.checks, /Missing categories tile lists/).globalValue, 2, 'the Missing tile counts 2 rows');

  /* ---- a running period with rows dated after today, untampered ---------------------
     The Transactions scope hides them (src/views/transactions.js, hiddenFuture),
     so the list is the figure the wedge closes at today. If that scope is ever
     dropped this is where it shows: the two rows below would be listed. */
  {
    const running = { ...files };
    running[`${B}/Transactions/Cheque/2026-09.md`] += '| 2026-09-20 | Checkers | Groceries | -300.00 |  |  |  |\n| 2026-09-25 | Late fee | Rent | -80.00 |  |  |  |\n';
    const r = await reconcile({ ...H, files: running, today: '2026-09-05' });
    eq(drills(r.checks).filter(c => c.status !== 'pass').map(c => `${c.name}: ${c.note}`), [], 'rows dated after 2026-09-05 are not listed under a figure that closes on the 5th');
    const w = r.pages.find(p => p.view === 'dashboard').drill.wedges;
    eq(w.map(x => x.after.count), [0, 0, 0, 0], 'none of the listed rows is dated after today');
  }

  /* ---- NEGATIVE CONTROLS ---------------------------------------------------------- */
  const t = (mut, pages = withTiles.pages, G = withTiles.G) => { const p = clone(pages); mut(p.find(x => x.view === 'dashboard').drill); return runChecks(G, p); };
  eq(one(t(d => { d.wedges.find(w => w.name === 'Rent').sum -= 50; }), /wedge "Rent"/).status, 'fail', 'a list that is R50 off the wedge fails');
  eq(one(t(d => { d.wedges.find(w => w.name === 'Gym').selected = 'Phone'; }), /wedge "Gym" selects/).status, 'fail', 'a tap that selects the wrong category fails');
  eq(one(t(d => { d.tiles[0].count = 2; }), /Uncategorised tile lists/).status, 'fail', 'an Uncategorised list that is a row too long fails');
  eq(one(t(d => { d.tiles[1].count = 1; }), /Missing categories tile lists/).status, 'fail', 'a Missing list that is a row short fails');
  eq(one(t(d => { d.tiles.pop(); }), /hero tiles drawn exactly/).status, 'fail', 'a tile that is not drawn although its count is above zero fails');
  eq(one(t(d => { d.wedges.reverse(); }), /legend row is a split row/).status, 'fail', 'legend rows out of order fail');
  const none = runChecks(withTiles.G, withTiles.pages.map(p => (p.view === 'dashboard' ? { ...p, drill: undefined } : p)));
  eq(one(none, /Drill-through: exercised/).status, 'unverified', 'a Dashboard that was never clicked is unverified, not silently absent');

  /* A running period lists rows dated after today; the figure closes at today.
     This is the failure the Transactions scope change (hide rows after today) is
     expected to remove. Tampered here so the test does not depend on that change
     landing: the list carries a later row of R300. */
  const later = t(d => {
    const w = d.wedges.find(x => x.name === 'Rent');
    w.sum -= 300; w.count += 1; w.after = { count: 1, sum: -300 };
  }, clean.pages, clean.G);
  const lateRent = one(later, /wedge "Rent"/);
  eq(lateRent.status, 'fail', 'a list that includes a row dated after today fails');
  ok(lateRent.why.some(w => /dated after today/.test(w)), 'and the check says the difference is exactly those rows');
  ok(/1 listed row\(s\) dated after 2026-09-02/.test(lateRent.note), 'with their number and date in the note');

  console.log(`PASS lane-z-drill-through (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
