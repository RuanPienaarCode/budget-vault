'use strict';
/* "Has this instalment been paid this period?" is answered once.

   Two readers ask it. The Debts page asks the BUDGET lens —
   `tally(ledger(start, end), LENSES.BUDGET)`, five vetoes: excluded,
   nonBudget, foreign, earmarkedOut, transfer. committed.js's rule 2, which
   decides whether a debt is still coming out of this period's money, walked the
   raw rows with one veto that is not among those five (`!isSplitPart`).

   So the same instalment could be settled on one screen and outstanding on the
   other, and in the direction that flatters: a debit order on an Excluded row,
   or from an account marked `budget: false`, or paid out of an earmarked fund,
   dropped off "still committed" and was added to "actually free" — while the
   Debts page went on showing the debt R9 000 short. ADR-0006 Phase 3 moved one
   reader onto the lens and not the other.

   The fix is a `settleRows` argument, not a second veto list: committed.js
   cannot see `nonBudget` or `earmarkedOut` from a raw row at all — those are
   stamps — so the only honest fix is to be handed the rows the lens kept.

   What this pins:

     1. a row the BUDGET lens DROPS does not settle an instalment,
     2. a row it KEEPS does,
     3. the veto list this depends on is still BUDGET's — asserted against
        LENSES.BUDGET itself, so adding a sixth veto there does not silently
        leave this test describing a rule nobody applies any more,
     4. the Dashboard hero actually passes settleRows — a source grep, because
        every assertion above stays green if the wiring is dropped.

     node tests/instalment-one-rule.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { debtCommitments } = require('../src/committed');
const { LENSES } = require('../src/ledger');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const P_START = '2026-09-01', P_END = '2026-09-30', TODAY = '2026-09-20';
const bond = { name: 'Bond', category: 'Home loan', payment: 9000, extra: 0, start: '2020-01-05', status: 'active' };
const paymentRow = { date: '2026-09-05', cat: 'Home loan', amount: -9000, label: 'Cheque' };

const stillOwing = settleRows => debtCommitments({
  debts: [bond], rows: [paymentRow], settleRows,
  from: TODAY, to: P_END, periodStart: P_START, periodDays: 30, today: TODAY,
});

/* ---- 1: a row the lens dropped does not settle it ----------------------- */

/* The lens kept nothing — the payment was on an Excluded row, or came from a
   `budget: false` account. The instalment is still coming out of this period. */
const dropped = stillOwing([]);
eq(dropped.length, 1, 'an instalment whose only payment the BUDGET lens dropped is STILL committed');
eq(dropped[0].amount, 9000, 'and for the full instalment — the hero must not add it to "actually free"');
eq(dropped[0].kind, 'debt', 'reported as a debt claim');

/* ---- 2: a row the lens kept does settle it ------------------------------ */

eq(stillOwing([paymentRow]), [], 'a payment the lens KEPT settles the instalment, as it always did');

/* ---- 3: the rule is BUDGET's, and stays BUDGET's ------------------------ */

/* Asserted against the lens rather than against a copy of its veto names. A
   test that hardcoded the five would go on passing while BUDGET grew a sixth,
   which is the shape of the bug this whole file is about. */
eq([...LENSES.BUDGET.drop].sort(),
  ['earmarkedOut', 'excluded', 'foreign', 'nonBudget', 'transfer'].sort(),
  'BUDGET still vetoes exactly the five this fix was reasoned about — a sixth needs a look here');
ok(LENSES.BUDGET.drop.includes('nonBudget') && LENSES.BUDGET.drop.includes('earmarkedOut'),
  'and both stamps committed.js cannot compute from a raw row are among them — which is why settleRows exists');

/* ---- 4: the hero is actually wired to it ------------------------------- */

/* Claims 1-3 all pass with the Dashboard still handing over unfiltered rows,
   because they call debtCommitments directly. The wiring is the fix. */
const dash = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'dashboard.js'), 'utf8');
ok(/settleRows\s*=\s*ledger\([^)]*\)\s*\.filter\(\s*s\s*=>\s*keeps\(LENSES\.BUDGET, s\)\s*\)/.test(dash),
  'the Dashboard builds settleRows from the BUDGET lens over ledger()');
ok(/\bsettleRows,/.test(dash), 'and passes it into whatsLeft');

/* The foreign bands deliberately do NOT: BUDGET drops every foreign row, so a
   lens-filtered set would read every foreign instalment as never settled. */
const foreignStart = dash.indexOf('L: whatsLeft({');
const foreignCall = dash.slice(foreignStart, dash.indexOf('}),', foreignStart));
ok(foreignStart !== -1 && foreignCall.includes('periodStart'),
  'the foreign band whatsLeft call was located, so the assertion below is looking at something');
ok(!/settleRows/.test(foreignCall),
  'a foreign band passes its own rows — it has no BUDGET lens to ask');

console.log(`PASS — one rule for "has this instalment been paid", and the hero is wired to it (${checks} assertions).`);
