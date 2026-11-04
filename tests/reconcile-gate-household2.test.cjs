'use strict';
/* The reconciliation gate, over the SECOND golden household (ISSUE 79).

   tests/reconcile-gate.test.cjs runs scripts/reconcile-page.cjs over
   tests/figures/household.cjs: month_start_day 1, monthly cycles, one populated
   period. tests/figures/household2.cjs (#89) is the other shape - a mid-month
   start day, a year rollover, weekly and fortnightly services, a February
   clamp - built because the first household moved for none of six mutations.
   It was in the figures ledger (ledger2.txt) but in no reconciliation gate: a
   one-off run on 2026-09-17 gave 104 pass / 0 fail / 16 unverified / 2 info,
   and #79 left "triage those 18 before household2 can join the ratchet" open.

   Re-run on 2026-11-04 after the checker fixes of 29 Sep and the Accounts
   live-balance change: 145 pass, 0 fail, 0 info, 2 unverified. The two are
   the Plan page's pot identities, and household2 has no Plans file, so there
   is no pot to check. That is a fixture gap, not a broken selector, and it is
   pinned below in both directions like the first gate's CANNOT_BE_MADE.

     node tests/reconcile-gate-household2.test.cjs
*/
const assert = require('assert');
const { reconcile } = require('../scripts/reconcile-page.cjs');
const H2 = require('./figures/household2.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* household2 declares no Plans/ file: the Plan page draws no pot, so neither
   identity has a number on either side. Giving the fixture a plan moves these
   two to `pass` - and this list must then shrink in the same commit. */
const CANNOT_BE_MADE = [
  'plan :: Σ envelopes + free = pot',
  'plan :: Σ sources = pot',
];

/* Floor under the pass count: a collapse into `unverified` is not a pass. */
const MIN_PASSING = 140;

(async () => {
  const t0 = Date.now();
  const { pages, checks: result, period, today } = await reconcile({
    files: { ...H2.SEED }, budgetFolder: H2.B, today: H2.TODAY, period: H2.PERIOD,
  });

  ok(pages.length >= 16, `all sixteen views were harvested (got ${pages.length})`);
  eq(pages.filter(p => p.error).map(p => `${p.view}: ${p.error}`), [], 'no page threw while rendering');
  const figures = pages.reduce((t, p) => t + p.figures.length, 0);
  ok(figures > 500, `the harvest actually read figures off the pages (got ${figures})`);
  eq(period, H2.PERIOD, 'the fixture period is the one household2 declares');
  eq(today, H2.TODAY, 'and the clock is the pinned one, not the wall clock');

  const idsOf = status => result.filter(c => c.status === status)
    .map(c => `${c.page} :: ${c.name}`).sort();

  eq(idsOf('fail'), [],
    'a figure on household2 disagrees with the total it is checked against. This list is '
    + 'empty on purpose - run the reconciliation over household2 and read the page.');

  const quiet = idsOf('unverified');
  eq(quiet.filter(f => !CANNOT_BE_MADE.includes(f)), [],
    'a check went QUIET on household2 - a selector that stopped matching, or a figure this '
    + 'household cannot exercise. Find out which, then fix it or pin it.');
  eq(CANNOT_BE_MADE.filter(f => !quiet.includes(f)), [],
    'a check household2 could not make now can - remove it from CANNOT_BE_MADE in this commit.');

  eq(idsOf('info'), [],
    'a new difference attributable to a documented gap on household2 - decide whether the '
    + 'page discloses it (ISSUE 88), then pin it here.');

  const passing = idsOf('pass').length;
  ok(passing >= MIN_PASSING,
    `household2 still makes at least ${MIN_PASSING} passing checks (got ${passing})`);

  console.log(`PASS — reconciliation gate over household2: ${figures} figures, ${result.length} checks, `
    + `${passing} agree, ${quiet.length} not measurable (${Date.now() - t0}ms, ${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
