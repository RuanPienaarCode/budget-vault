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

   ISSUE 85 (2026-09-17) closed the other half: the Dashboard's foreign bands
   used to hand debtCommitments their raw, unvetoed rows — a foreign
   instalment could be settled by a payment on an Excluded row, a
   `budget: false` account, or an earmarked fund, with no Debts-page reading
   of that currency to disagree with it. BUDGET cannot be asked whole there —
   it drops every foreign row by construction — so `dropsAnyOf`'s `except`
   parameter is exported as the seam for asking it WITHOUT the foreign veto,
   narrowed by the caller to one currency's own rows.

   What this pins:

     1. a row the BUDGET lens DROPS does not settle an instalment,
     2. a row it KEEPS does,
     3. the veto list this depends on is still BUDGET's — asserted against
        LENSES.BUDGET itself, so adding a sixth veto there does not silently
        leave this test describing a rule nobody applies any more,
     4. the Dashboard hero actually passes settleRows, home band AND foreign —
        a source grep, because every assertion above stays green if the
        wiring is dropped,
     5. the foreign seam itself: a row this currency's own BUDGET-minus-foreign
        question drops does not settle it, one it keeps does, and a KEPT row
        of a DIFFERENT currency never does — dropsAnyOf's `except` narrows one
        veto, not the currency partition itself.

     node tests/instalment-one-rule.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { debtCommitments } = require('../src/committed');
const { LENSES, stamp, dropsAnyOf } = require('../src/ledger');

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

/* ---- 4: the hero is actually wired to it, home band AND foreign --------- */

/* Claims 1-3 all pass with the Dashboard still handing over unfiltered rows,
   because they call debtCommitments directly. The wiring is the fix. */
const dash = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'dashboard.js'), 'utf8');
ok(/settleRows\s*=\s*stamped\s*\.filter\(\s*s\s*=>\s*keeps\(LENSES\.BUDGET, s\)\s*\)/.test(dash),
  'the Dashboard builds settleRows from the BUDGET lens over the ledger');
ok(/\bsettleRows,/.test(dash), 'and passes it into the home band\'s whatsLeft');

/* ISSUE 85: the foreign bands now ask the same lens minus its own foreign
   veto, narrowed to the rows of that one currency — dropsAnyOf's `except`
   parameter is the seam, and it must be BUDGET being asked, not a private copy
   of BUDGET's veto names re-typed beside it. */
ok(/dropsAnyOf\(LENSES\.BUDGET,\s*s,\s*'foreign'\)/.test(dash),
  'a foreign band asks BUDGET, exempting only its own foreign veto');
const foreignStart = dash.indexOf('L: whatsLeft({');
const foreignCall = dash.slice(foreignStart, dash.indexOf('}),', foreignStart));
ok(foreignStart !== -1 && foreignCall.includes('periodStart'),
  'the foreign band whatsLeft call was located, so the assertion below is looking at something');
ok(/settleRows:\s*settleRowsFx\(sym\)/.test(foreignCall),
  'a foreign band now passes its own currency\'s lens-filtered rows, not a raw, unvetoed set');

/* ---- 5: the foreign seam itself, at the stamp level --------------------- */

/* Unit-level, independent of the Dashboard's own wiring, and independent of
   debtCommitments (which has no notion of currency at all — the partition
   into one settleRows per symbol is entirely `settleRowsFx`'s job, and this
   is what proves it does that job). Mirrors claims 1 and 2 above, once for a
   foreign symbol, plus the one failure mode unique to a foreign band: a KEPT
   row of the WRONG currency must not settle it either. */
const env = () => ({
  nonBudgetLabels: new Set(),
  foreignLabels: new Map([['EuroCard', '€'], ['DollarCard', '$']]),
  earmarkedLabels: new Set(),
  catType: () => null, catKnown: () => true,
});
const settleRowsFx = (rows, sym) => stamp(rows, env())
  .filter(s => s.foreign && s.symbol === sym && !dropsAnyOf(LENSES.BUDGET, s, 'foreign'))
  .map(s => s.row);
const euroBond = { name: 'Euro bond', category: 'Loan', payment: 900, extra: 0, start: '2020-01-05', status: 'active' };
const fxOwing = (rows, sym) => debtCommitments({
  debts: [euroBond], rows, settleRows: settleRowsFx(rows, sym),
  from: TODAY, to: P_END, periodStart: P_START, periodDays: 30, today: TODAY,
});

const euroExcluded = [{ date: '2026-09-05', cat: 'Loan', amount: -900, label: 'EuroCard', excluded: true }];
eq(fxOwing(euroExcluded, '€').length, 1,
  'a euro instalment paid on an Excluded euro row is STILL committed, exactly like the home-band case above');

const euroKept = [{ date: '2026-09-06', cat: 'Loan', amount: -900, label: 'EuroCard' }];
eq(fxOwing(euroKept, '€'), [], 'an ordinary euro payment settles the euro instalment');

const dollarKept = [{ date: '2026-09-07', cat: 'Loan', amount: -900, label: 'DollarCard' }];
eq(fxOwing(dollarKept, '€').length, 1,
  'a KEPT dollar payment does not settle a euro instalment — dropsAnyOf lifts the foreign VETO, it does not merge the currencies');

console.log(`PASS — one rule for "has this instalment been paid", home band and foreign, and the hero is wired to both (${checks} assertions).`);
