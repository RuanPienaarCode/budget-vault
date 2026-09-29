'use strict';
/* Lane Z, items 1 and 2 (2026-09-29 totals audit): the reconciliation's own
   window and absence rules, pinned on the committed synthetic household.

   1. "Σ split rows = Σ periodSpend(p).whole" compared the donut, which closes at
      today, with a whole-period seam. Faking the clock to mid-period made it fail
      by exactly the spend dated after that clock, on the HEAD checker too. Both
      sides now read the same window (periodSpend's own day cap), and what lies
      between them is stated and pinned exactly (see the two identities under it).

   2. The what's-left checks sat behind `if (cash)`, so a card that failed to
      render passed by not being there. Absence is now a reading: a non-current
      period must NOT draw the chain, the current one must (when cash is known).

     node tests/lane-z-window-and-card.test.cjs */

const assert = require('assert');
const { reconcile, householdVault, runChecks } = require('../scripts/reconcile-page.cjs');
const { B } = require('./figures/household.cjs');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const clone = x => JSON.parse(JSON.stringify(x));
const named = (checks, re) => {
  const hit = checks.filter(c => re.test(c.name));
  assert.strictEqual(hit.length, 1, `exactly one check matching ${re} (got ${hit.length}: ${hit.map(c => c.name).join(' | ')})`);
  return hit[0];
};
const failed = checks => checks.filter(c => c.status === 'fail').map(c => `${c.page} :: ${c.name}`);
/* The one screen bug the household is known to hold (see KNOWN_SCREEN_BUGS in
   tests/reconcile-gate.test.cjs); every other failure is a fault here. */
const KNOWN = ['dashboard :: Drill-through: wedge "Groceries" lists rows that sum to it'];
const unexpected = checks => failed(checks).filter(f => !KNOWN.includes(f));

(async () => {
  const H = householdVault();
  const TX = `${B}/Transactions/Cheque/2026-09.md`;
  /* The household's September has no row after the 2nd. Two more, dated LATER in
     the period, are what a mid-period clock leaves out of the donut. One is a
     refund inside a category, so the tail has a per-category net that a plain
     difference of the two spend totals cannot reproduce. */
  const withLater = () => {
    const files = { ...H.files };
    files[TX] = files[TX]
      + '| 2026-09-20 | Checkers | Groceries | -300.00 |  |  |  |\n'
      + '| 2026-09-22 | Woolworths refund | Groceries | 120.00 |  |  |  |\n'
      + '| 2026-09-25 | Landlord late fee | Rent | -80.00 |  |  |  |\n';
    return files;
  };

  /* ---- 1. one window on both sides ------------------------------------------ */
  {
    const files = withLater();
    for (const today of ['2026-09-02', '2026-09-05', '2026-09-15', '2026-09-19', '2026-09-29']) {
      const r = await reconcile({ ...H, files, today, period: '2026-09' });
      eq(unexpected(r.checks), [], `no failure at the clock ${today} (the donut closes at today, and so does the seam it is checked against)`);
      const id = named(r.checks, /^Σ split rows = Σ periodSpend/);
      eq(id.status, 'pass', `Σ split = Σ periodSpend at ${today}`);
    }

    /* The mid-period clock really does separate the two totals - otherwise the
       pass above proves nothing. On the 5th the whole period holds spend the
       split has not reached. */
    const mid = await reconcile({ ...H, files, today: '2026-09-05', period: '2026-09' });
    const F = mid.G.figures;
    const split = F.split.reduce((t, r) => t + r.amount, 0);
    ok(F.trend.wholeTotal - split > 200, `the whole period holds ${F.trend.wholeTotal - split} of spend the donut has not reached - the case the old identity failed on`);
    eq(Math.round(F.trend.partTotal * 100), Math.round(split * 100), 'and the capped seam reads exactly the donut\'s window');
    eq(F.trend.capDays, 5, 'periodSpend was asked for the five days elapsed');
    ok(/periodSpend\(p, 5\)\.part/.test(named(mid.checks, /^Σ split rows = Σ periodSpend/).globalSource), 'and the check says which window it used');

    /* The difference between the windows is STATED and pinned, per category. */
    eq(named(mid.checks, /^Whole period = start\.\.asOf \+ after asOf/).status, 'pass', 'the un-clipped net per category is additive across the two windows');
    eq(named(mid.checks, /^periodSummary\.scheduled\.spend = BUDGET spend of the rows after asOf/).status, 'pass', 'the summary\'s scheduled spend is the BUDGET tally of the rest of the period');
    ok(mid.G.figures.scheduled.spend > 0, `and it is not vacuous: ${mid.G.figures.scheduled.spend} is scheduled`);

    /* A finished period has no cap; the window is the whole period on both sides. */
    const done = await reconcile({ ...H, files, today: '2026-10-05', period: '2026-09' });
    eq(done.G.figures.trend.capDays, null, 'a finished period is not capped');
    eq(named(done.checks, /^Σ split rows = Σ periodSpend/).status, 'pass', 'and Σ split = Σ whole there');
    eq(done.G.figures.scheduled.spend, 0, 'with nothing scheduled');

    /* NEGATIVE CONTROLS. The old comparison, spelled out, really does fail at
       the clock that exposed it. */
    ok(Math.abs(F.trend.wholeTotal - split) > 0.006, 'the pre-fix pairing (split vs whole) disagrees at 2026-09-05');
    /* And the new checks fail when their invariants are broken. */
    const G1 = clone(mid.G);
    G1.figures.trend.partTotal += 50;
    eq(named(runChecks(G1, mid.pages), /^Σ split rows = Σ periodSpend/).status, 'fail', 'a seam that reads a different window than the donut fails');
    const G2 = clone(mid.G);
    G2.figures.scheduled.spend += 10;
    eq(named(runChecks(G2, mid.pages), /^periodSummary\.scheduled\.spend/).status, 'fail', 'a scheduled disclosure that is not the rest of the period fails');
    const G3 = clone(mid.G);
    G3.lenses.whole.TREND.byCat[0].value += 25;
    eq(named(runChecks(G3, mid.pages), /^Whole period = start\.\.asOf/).status, 'fail', 'a ledger that is not additive over its windows fails');
  }

  /* ---- 2. the what's-left card: absence is a reading ------------------------- */
  {
    const cur = await reconcile({ ...H });
    const on = named(cur.checks, /^What's left: the card renders when it should/);
    eq(on.status, 'pass', 'the current period draws the card');
    ok(/current period: the card renders/.test(on.globalSource), 'and says why it is expected');
    ok(cur.checks.some(c => /free = cash/.test(c.name)), 'the arithmetic checks under it still run');

    /* A period that is not the current one: the card prints its sentence and
       no figure, which is the page's own rule (dashboard.js renderLeft). */
    const past = await reconcile({ ...H, period: '2026-08' });
    const off = named(past.checks, /^What's left: the card renders when it should/);
    eq(off.status, 'pass', 'a non-current period passes: the card only renders for the current one');
    ok(/not the current period/.test(off.globalSource), 'and the reason is named');
    eq(past.checks.filter(c => /free = cash|cash in your accounts/.test(c.name)).length, 0, 'the figure checks are not made where there is no figure');
    const later = await reconcile({ ...H, today: '2026-10-05', period: '2026-09' });
    eq(named(later.checks, /^What's left: the card renders when it should/).status, 'pass', 'a finished period at a later clock passes the same way');

    /* NEGATIVE CONTROLS. The card missing in the current period is a FAIL. */
    const gone = clone(cur.pages);
    const dash = gone.find(p => p.view === 'dashboard');
    dash.figures = dash.figures.filter(f => !/^leftBody\//.test(f.address));
    const missing = named(runChecks(cur.G, gone), /^What's left: the card renders when it should/);
    eq(missing.status, 'fail', 'the current period with no card fails - it used to pass by being skipped');
    ok(/NOT RENDERED/.test(missing.pageSource) && /counted account/.test(missing.globalSource), 'naming the accounts that make the cash known');

    /* ...unless the seam itself says there is no cash to show. */
    const G0 = clone(cur.G);
    G0.cash.counted = [];
    eq(named(runChecks(G0, gone), /^What's left: the card renders when it should/).status, 'pass', 'no counted cash and no card: the card hides itself, and that is right');

    /* A figure drawn in a period that is not the current one is the defect. */
    const leak = clone(past.pages);
    const fake = cur.pages.find(p => p.view === 'dashboard').figures.find(f => f.address === 'leftBody/@left-cash');
    ok(fake, 'the fixture\'s current-period card has a named cash tile to borrow');
    leak.find(p => p.view === 'dashboard').figures.push(clone(fake));
    eq(named(runChecks(past.G, leak), /^What's left: the card renders when it should/).status, 'fail', 'a chain drawn for a past period fails');

    /* A cash tile with no free/short tile after it is also not silent. */
    const headless = clone(cur.pages);
    const dh = headless.find(p => p.view === 'dashboard');
    dh.figures = dh.figures.filter(f => !/^leftBody\/@left-(free|short)$/.test(f.address));
    eq(named(runChecks(cur.G, headless), /^What's left: the free \(or short\) tile is drawn/).status, 'fail', 'the chain that stops at cash fails');
  }

  console.log(`PASS lane-z-window-and-card (${n} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
