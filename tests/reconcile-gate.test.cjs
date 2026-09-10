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

   WHAT THIS TEST IS, AND IS NOT

   It is a RATCHET, not a clean-zero gate. The fixture currently reconciles with
   fourteen `fail` checks, and they are pinned below UNTRIAGED. I have not
   established whether they are defects, fixture gaps, or checks whose DOM
   selectors do not survive a narrow household — and pinning them as "expected"
   would be worth nothing if I am wrong about which.

   What it does buy, today: a NEW disagreement — an eighth duplication, on any
   of sixteen pages — makes a name appear in the fail set that is not in this
   list, and the suite goes red. That is the thing the regexes cannot do.

   It also fails when a pinned name DISAPPEARS. That is deliberate: if one of
   the fourteen is fixed, the list must be updated in the same commit, so the
   baseline can only ever shrink on purpose. A silently-shrinking allowlist is
   how a gate stops meaning anything.

   The fixture is NOT the real vault and does not replace running this against
   one before a release (`npm run reconcile -- --obsidian-vault "<root>"`). It
   is narrower and deliberately more exotic — one of each row shape ADR-0005 and
   ADR-0006 settled, which is more per row than a household carries. See
   docs/adr/0007 and ISSUE 89 (a second golden household), which is the work
   that would let the fourteen be triaged properly.

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
const UNTRIAGED_FAILURES = [
  'accounts :: Balance column = stated balances',
  'accounts :: Flow chips = ACCOUNT-lens activity',
  'accounts :: Group totals = Σ by group (bank / savings / investments)',
  'accounts :: Owner rows sum to the hero',
  'budgets :: budTotalsBottom: gap note (netted + uncategorised)',
  'budgets :: budTotalsBottom: over-budgeted',
  'budgets :: budTotalsTop: gap note (netted + uncategorised)',
  'budgets :: budTotalsTop: over-budgeted',
  'dashboard :: Hero sub: "of budgeted Y"',
  'dashboard :: Hero sub: "spent X"',
  'dashboard :: Position: debts',
  "dashboard :: What's left: free = cash − committed",
  'savings :: Worth chart: total',
  'savings :: Worth chart: Σ segments = total',
];

/* `info` is a difference the script could ATTRIBUTE to a documented gap —
   two rules printing two readings on purpose. Pinned for the same reason: a new
   one is a new place where the app prints two bases, and whether the page says
   so is exactly the question ISSUE 88 is about. */
const EXPLAINED_DIFFERENCES = [
  'accounts :: Group "Savings" (stated) vs Dashboard tile (implied)',
  "dashboard :: What's left: cash in your accounts vs implied bank balances",
];

/* A floor, not a pin. Checks move between `pass` and `unverified` as the
   fixture grows a figure a page could not previously render, and pinning the
   exact number would make this test fail on work that improved coverage. But it
   must not silently COLLAPSE: a check that stops being made stops guarding, and
   a run where most checks went unverified would otherwise look like a pass. */
const MIN_PASSING = 90;

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
  const appeared = failures.filter(f => !UNTRIAGED_FAILURES.includes(f));
  const cleared = UNTRIAGED_FAILURES.filter(f => !failures.includes(f));

  eq(appeared, [],
    'a NEW figure disagrees with the global total it is checked against — this is the '
    + '"two figures derived by different rules" shape. Run `npm run reconcile:household` '
    + 'and read the page it writes.');

  eq(cleared, [],
    'a pinned disagreement is GONE — good, but remove it from UNTRIAGED_FAILURES in this '
    + 'commit. The baseline must only ever shrink on purpose.');

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
    + `${passing} agree, ${failures.length} pinned untriaged, ${explained.length} explained `
    + `(${Date.now() - t0}ms, ${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
