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
   it is settled is right. */
function isSettled(o) {
  return o.status === 'paid' || outstandingOf(o) === 0;
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
    if (settled) {
      // A hand-flagged entry with no repayment recorded: the whole amount came
      // back by some route the vault never saw.
      recovered += o.repaid > 0 ? Math.min(o.repaid, o.amount || 0) : (o.amount || 0);
      continue;
    }
    open++;
    outstanding += outstandingOf(o);
    recovered += Math.min(o.repaid || 0, o.amount || 0);
    const age = daysSince(o.lent, today);
    if (age !== null && (oldestDays === null || age > oldestDays)) oldestDays = age;
  }
  return { outstanding, recovered, open, entries: list.length, oldestDays };
}

module.exports = { outstandingOf, isSettled, owedSummary };
