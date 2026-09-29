'use strict';
/* Lane Z, item 4 (2026-09-29 totals audit): the household's "unverified" checks.

   Eight checks read `unverified` on the committed household. Six were the
   checker treating absence as an unknown where the page's own rule makes absence
   the correct reading; two are honest fixture gaps and stay pinned in
   tests/reconcile-gate.test.cjs (the Plan page needs a `## money in` table, which
   adds four figures and so moves tests/figures/ledger.txt).

     - Score, "fixed bills %" and "budget used (six-period average)": score.js
       scoreNow drops a bit whose metric is null. Null beside nothing is a PASS.
     - Score, chip-versus-ring: with no ring measure there is nothing to set the
       chip against.
     - Investments (Accounts group, Savings segment, Savings KPI-versus-segment):
       accounts.js draws a group only for a kind it holds; savings.js draws a
       segment only for a type that holds money.

   The other direction is what stops this being a way to hide things: a measure
   the seam HAS, with nothing printed, and an investment account with no group,
   are failures. Each is pinned below on a tampered reading.

     node tests/lane-z-absence.test.cjs */

const assert = require('assert');
const { reconcile, householdVault, runChecks } = require('../scripts/reconcile-page.cjs');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const clone = x => JSON.parse(JSON.stringify(x));
const one = (checks, page, re) => {
  const hit = checks.filter(c => c.page === page && re.test(c.name));
  assert.strictEqual(hit.length, 1, `exactly one ${page} check matching ${re} (got ${hit.length}: ${hit.map(c => c.name).join(' | ')})`);
  return hit[0];
};

(async () => {
  const H = householdVault();
  const r = await reconcile({ ...H });
  const quiet = r.checks.filter(c => c.status === 'unverified').map(c => `${c.page} :: ${c.name}`).sort();
  eq(quiet, [], 'nothing is unverified on the household (the Plan fixture became a real plan, 2026-09-29)');

  const cases = [
    ['score', /^Ring: fixed bills % of income/], ['score', /^Ring: budget used \(six-period average\)/],
    ['score', /^Budget chip "budget used" \(this period\) vs ring/],
    ['savings', /^Worth chart: "Investments" segment/], ['savings', /^KPI "Investments" \(stated\) vs chart/],
    ['accounts', /^Group "Investments"/],
  ];
  for (const [page, re] of cases) eq(one(r.checks, page, re).status, 'pass', `${page}: ${re} is a pass - absence is the correct reading`);
  ok(/nothing to print|not rendered/.test(one(r.checks, 'score', /^Ring: fixed bills/).pageSource), 'and the ring check says why');
  ok(/no account of type investment/.test(one(r.checks, 'accounts', /^Group "Investments"/).pageSource), 'the group check names the reason');

  /* ---- NEGATIVE CONTROLS: absence is a pass only where the seam agrees ------------ */
  const G = clone(r.G);
  G.health.metrics.fixedShare = 0.3;
  const bad = runChecks(G, r.pages);
  eq(one(bad, 'score', /^Ring: fixed bills % of income/).status, 'fail', 'a fixed-bills share the seam holds but the page does not print is a FAIL');
  eq(one(bad, 'score', /^Ring: spending row prints one percentage per known measure/).status, 'fail', 'and the presence rule fails beside it');

  const G2 = clone(r.G);
  G2.accounts.push({ ...clone(G2.accounts[0]), name: 'Broker', type: 'investment', foreign: false });
  eq(one(runChecks(G2, r.pages), 'accounts', /^Group "Investments"/).status, 'fail', 'an investment account with no group on the Accounts page is a FAIL');

  const G3 = clone(r.G);
  G3.worth.byTypeImplied.investment = 5000;
  const seg = one(runChecks(G3, r.pages), 'savings', /^Worth chart: "Investments" segment/);
  eq(seg.status, 'fail', 'implied investments of R5 000 with no chart segment is a FAIL');
  ok(/NOT DRAWN/.test(seg.pageSource), 'named as not drawn');

  /* And the present case is still compared, not waved through: the Savings group
     exists on the household, so a wrong seam still fails there. */
  const G4 = clone(r.G);
  G4.worth.byTypeImplied.savings += 777;
  eq(one(runChecks(G4, r.pages), 'savings', /^Worth chart: "Savings" segment/).status, 'fail', 'a segment that IS drawn is still checked against the seam');

  console.log(`PASS lane-z-absence (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
