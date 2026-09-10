'use strict';
/* The reconciliation, as a gate.

   ISSUE 86. This repo's recurring defect is "two figures derived by different
   rules" — nine occurrences by commit message, four more found in the
   2026-09-09 audit, one of them Critical. The defences against it were:

     - seven regexes matching the literal text of seven duplications already
       found (period-figures.test.cjs, vocabulary.test.cjs). Regression pins.
       They cannot catch an eighth.
     - scripts/reconcile-page.cjs, which judges the CLASS: it renders every
       page, puts three readings of the same money side by side (the DOM
       harvest, the seams, and an independent oracle spelled without ledger.js)
       and reports where they disagree. It ran in no gate, because it needed a
       real household and a real household cannot be committed to a public repo.

   So the one instrument that could catch a new duplication was the one nobody
   ran. All four of the audit's Criticals passed a green suite.

   tests/figures/household.cjs is already a full vault in the shape the script
   reads, so the reconciliation now runs over it with no private data — that is
   the `--household` mode this test drives.

   WHAT THIS TEST IS

   A GATE, with a clean baseline: every check the fixture can make agrees. It
   did not start that way — the first run had fourteen `fail` checks, and all
   fourteen were triaged (2026-09-10) as faults in the CHECKS, not the app.
   Thirteen were addressing faults of one shape: a figure located by its position
   among its siblings, on a page where something above it is conditional. A
   greeting that renders only with `household:` set, an earmark term that appears
   only when a fund is earmarked, a second chart bar that exists only with debts,
   a foreign-currency tag nested INSIDE the total it qualifies — each shifts every
   index below or around it, and the check then reads its neighbour's figure and
   reports a disagreement that is entirely its own. The fourteenth was a fixture
   gap: the household declared no owners, so the Accounts owner card never
   rendered at all.

   The fix was to give the figures NAMES. `data-fig` on a node stops addressOf's
   walk (tests/helpers/figures.cjs), so the address is `root/@name` and survives
   any reordering. The views name their own figures now, and the checks address
   them by name.

   Two checks changed meaning rather than address, and both were the repo's own
   signature defect sitting inside the instrument built to catch it:

     - the unallocated tile was compared against `planTotal − income`, spelled by
       hand here, where ADR-0007 registers `unallocated` as `income − total`. Two
       rules for one figure, disagreeing by exactly twice itself.
     - the worth chart's owned bar was compared against `worth().net`. It is
       always short by the liabilities, because that is what net MEANS.

   One check was WITHDRAWN rather than fixed: the Budget strip's gap note had no
   correct global to compare against — `gap.notShown` is the donut's gap over a
   different row population — and the strip's own gap has no seam in the register
   at all. A check with no right answer is worse than no check.

   WHAT IT ASSERTS

   `fail` must be EMPTY. Not a pinned list — empty. A new disagreement on any of
   sixteen pages fails the suite, which is the thing the seven anti-duplication
   regexes elsewhere cannot do: they match the literal text of duplications
   already found.

   `info` and `unverified` are pinned in BOTH directions. `info` is a difference
   the script could attribute to a documented gap, so a new one is a new place
   the app prints two bases of one figure (ISSUE 88). `unverified` is pinned
   because it is where a broken check hides: add() downgrades to `unverified`
   whenever either side is not a number, so a selector that stops matching looks
   exactly like a fixture that cannot exercise the check. Four of the original
   fourteen unverified were that, not fixture gaps. Pinning the set means a check
   going quiet has to be acknowledged.

     node tests/reconcile-gate.test.cjs
*/

const assert = require('assert');
const { reconcile, householdVault } = require('../scripts/reconcile-page.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* Identity is `page :: name`, because a check's name is unique only within its
   page and a duplication that moves from one page to another is a new finding,
   not the same one. */

/* `info` is a difference the script could ATTRIBUTE to a documented gap —
   two rules printing two readings on purpose. Pinned for the same reason: a new
   one is a new place where the app prints two bases, and whether the page says
   so is exactly the question ISSUE 88 is about. */
const EXPLAINED_DIFFERENCES = [
  'accounts :: Group "Savings" (stated) vs Dashboard tile (implied)',
  "dashboard :: What's left: cash in your accounts vs implied bank balances",
];

/* Every check the fixture cannot make, pinned in both directions. Ten are
   honest fixture gaps — no investment account, no fixed-bill category, no prior
   period to average, a Plans file holding budget-shaped rows rather than plan
   sources, no stale balance to disclose a drift against. Two are the
   stated-vs-implied KPI pairs whose partner segment is one of those gaps.

   Growing the fixture is how these come off the list, and #89 is that work. A
   check leaving this list is good news that still has to be written down. */
const CANNOT_BE_MADE = [
  'accounts :: Group "Investments" (stated) vs Dashboard tile (implied)',
  'dashboard :: Stale note: drift',
  'plan :: \u03a3 envelopes + free = pot',
  'plan :: \u03a3 sources = pot',
  'savings :: KPI "Investments" (stated) vs chart "Investments" segment (implied)',
  'savings :: KPI "Savings" (stated) vs chart "Savings" segment (implied)',
  'savings :: Worth chart: "Investments" segment (implied)',
  'savings :: Worth chart: "Savings" segment (implied)',
  'score :: Budget chip "budget used" (this period) vs ring (six-period average)',
  'score :: Ring: budget used (six-period average)',
  'score :: Ring: fixed bills % of income',
  'score :: Ring: living costs % of income',
];

/* A floor under the passing count as well, so a wholesale collapse into
   `unverified` cannot read as a pass even if someone updates the list above
   without thinking about why it grew. */
const MIN_PASSING = 100;

(async () => {
  const H = householdVault();
  const t0 = Date.now();
  const { G, pages, checks: result, period, today } = await reconcile({
    files: H.files, budgetFolder: H.budgetFolder, today: H.today, period: H.period,
  });

  /* The run itself has to have happened. Every assertion below is vacuous if
     the harvest silently produced nothing — which is the failure mode that
     makes a reconciliation gate worthless rather than red. */
  ok(pages.length >= 16, `all sixteen views were harvested (got ${pages.length})`);
  const errored = pages.filter(p => p.error);
  eq(errored.map(p => `${p.view}: ${p.error}`), [], 'no page threw while rendering');
  const figures = pages.reduce((t, p) => t + p.figures.length, 0);
  ok(figures > 500, `the harvest actually read figures off the pages (got ${figures})`);
  ok(result.length > 100, `checks were actually made (got ${result.length})`);
  eq(period, H.period, 'the fixture period is the one the household declares');
  eq(today, H.today, 'and the clock is the pinned one, not the wall clock');

  const idsOf = status => result.filter(c => c.status === status)
    .map(c => `${c.page} :: ${c.name}`).sort();

  /* ---- the ratchet ------------------------------------------------------ */

  const failures = idsOf('fail');
  eq(failures, [],
    'a figure disagrees with the global total it is checked against — this is the '
    + '"two figures derived by different rules" shape, and every one of these was a real '
    + 'finding or a broken check. Run `npm run reconcile:household` and read the page it '
    + 'writes. Do NOT pin it here: this list is empty on purpose.');

  const quiet = idsOf('unverified');
  eq(quiet.filter(f => !CANNOT_BE_MADE.includes(f)), [],
    'a check went QUIET. add() downgrades to unverified whenever either side is not a '
    + 'number, so this is either a selector that stopped matching — the failure mode that '
    + 'makes a gate look green while guarding nothing — or a figure that legitimately '
    + 'cannot be measured on this household. Find out which, then fix it or pin it.');
  eq(CANNOT_BE_MADE.filter(f => !quiet.includes(f)), [],
    'a check that could not be made now can — the fixture grew. Remove it from '
    + 'CANNOT_BE_MADE in this commit.');

  const explained = idsOf('info');
  eq(explained.filter(f => !EXPLAINED_DIFFERENCES.includes(f)), [],
    'a new difference attributable to a documented gap — a new place the app prints two '
    + 'bases of one figure. Decide whether the page discloses it (ISSUE 88), then pin it.');
  eq(EXPLAINED_DIFFERENCES.filter(f => !explained.includes(f)), [],
    'a pinned explained difference is gone — update EXPLAINED_DIFFERENCES here');

  const passing = idsOf('pass').length;
  ok(passing >= MIN_PASSING,
    `the reconciliation still makes at least ${MIN_PASSING} passing checks (got ${passing}) — `
    + 'a collapse to unverified is not a pass');

  /* ---- the oracle is independent --------------------------------------- */

  /* The whole design rests on the third reading being spelled WITHOUT ledger.js,
     so a bug inside the ledger cannot agree with itself. If that ever stopped
     being true the checks would keep passing and mean nothing, so assert the
     property the file's own header claims. */
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'reconcile-page.cjs'), 'utf8');
  const from = src.indexOf('---- the independent oracle');
  const to = src.indexOf('const oracle = {', from);
  ok(from !== -1 && to > from, 'the oracle section was located, so the assertions below look at something');
  const oracleSrc = src.slice(from, to);
  for (const forbidden of ['ledger(', 'tally(', 'LENSES']) {
    eq(oracleSrc.includes(forbidden), false,
      `the oracle stays spelled without ${forbidden} — a third reading that calls the ledger `
      + 'cannot catch a bug inside it, and every check that leans on the oracle would then '
      + 'be agreeing with itself');
  }

  /* And it must actually be reconciled against the ledger, not merely exist. */
  const oracleChecks = result.filter(c => /^Oracle /.test(c.name));
  ok(oracleChecks.length > 0, `the oracle is checked against the lens (${oracleChecks.length} identities)`);
  eq(oracleChecks.filter(c => c.status === 'fail').map(c => c.name), [],
    'the independent loop over raw rows agrees with tally(ledger, BUDGET) — if these two '
    + 'ever disagree, one of them is wrong about what the household spent');

  console.log(`PASS — the reconciliation runs as a gate: ${figures} figures, ${result.length} checks, `
    + `${passing} agree, ${failures.length} disagree, ${explained.length} explained, ${quiet.length} not measurable `
    + `(${Date.now() - t0}ms, ${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
