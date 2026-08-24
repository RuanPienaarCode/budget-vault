'use strict';
/* Owed Money — what is still out there, and how long it has been gone.

   Extracted from views/owed.js when the Dashboard grew a position band that
   states an outstanding total of its own. Two definitions of "outstanding" in
   one app is the failure worth.js was written to end: the Owed page nets
   part-payments off, and a second copy on the dashboard that forgot to would
   report a partly-recovered loan as still fully owed — on the one screen most
   likely to be read first, and against a page six inches away that disagrees.

   Pure — no DOM, no obsidian import — so tests/owed-math.test.cjs runs it in
   bare node. `today` is injectable for the same reason it is in reconcile.js:
   a test that reads the wall clock passes in June and fails in July. */

const { daysSince } = require('./reconcile');

/* What is still out on this entry. Net of part-payments, and floored at zero:
   a repayment larger than the loan is somebody's typo, and letting it go
   negative would quietly pay off the NEXT person's loan inside a total. */
function outstandingOf(o) {
  return Math.max(0, (o.amount || 0) - (o.repaid || 0));
}

/* Settled is something the arithmetic can CONCLUDE — the page used to offer
   `outstanding | paid` and nothing between, so a reader recovering R900 of
   R4 000 had to pick which lie to tell.

   The explicit status is still honoured, because money comes back in ways the
   vault never sees — cash, a favour, a debt forgiven — and a reader who says
   it is settled is right.

   Settles on an epsilon, not exact equality — the same EPS debt-math.js
   already uses for the identical reason. A repayment box defaults to
   `left.toFixed(2)`, and a THREE-decimal cell (a hand-typed `amount 1000.564`
   survives normalizeAmount intact) rounds DOWN there: a "full" repayment of
   1000.56 against 1000.564 leaves an outstanding of 0.004, `=== 0` is false,
   and the entry stays open forever reading "R 0 left" — a label rounded to
   whole rand disagreeing with a status the maths never actually reached. */
function isSettled(o) {
  return o.status === 'paid' || outstandingOf(o) <= 0.005;
}

/* Everything a summary needs, in one pass.

   `recovered` counts capped repayments PLUS the full amount of any entry
   flagged paid by hand without a recorded repayment — otherwise marking a loan
   settled the honest way (you were paid in cash) would drop it out of the
   recovered total entirely and read as money that vanished.

   `oldestDays` is the age of the oldest UNSETTLED entry, and null when none of
   them carries a readable lending date. Age, not the due date: the due column
   was empty on every row of the vault this was built against — it asks for
   something you do not have when you lend to family — and how long the money
   has been gone is both derivable and the figure that actually applies
   pressure. */
function owedSummary(owed, today) {
  const list = owed || [];
  let outstanding = 0, recovered = 0, open = 0, oldestDays = null;
  for (const o of list) {
    const settled = isSettled(o);
    // A negative `amount` (a typo, or a stray minus sign the amount input
    // never blocked) makes outstandingOf clamp to 0 — which marks the row
    // settled — and the settled branch below used to add that negative
    // amount straight into a total of money that came BACK: a -500 entry on
    // a book with R500 already recovered dropped Recovered from R500 to R0.
    // outstandingOf already floors `amount` at zero for the very same reason;
    // this total has to agree with it rather than read `o.amount` raw.
    const amt = Math.max(0, o.amount || 0);
    if (settled) {
      // A hand-flagged entry with no repayment recorded: the whole amount came
      // back by some route the vault never saw.
      recovered += o.repaid > 0 ? Math.min(o.repaid, amt) : amt;
      continue;
    }
    open++;
    outstanding += outstandingOf(o);
    recovered += Math.min(o.repaid || 0, amt);
    const age = daysSince(o.lent, today);
    if (age !== null && (oldestDays === null || age > oldestDays)) oldestDays = age;
  }
  return { outstanding, recovered, open, entries: list.length, oldestDays };
}

module.exports = { outstandingOf, isSettled, owedSummary };
