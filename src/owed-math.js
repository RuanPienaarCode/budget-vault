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
const { isForeign, symbolOf } = require('./currency');

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
/* `household` is optional. Absent means "add every entry", which is exactly
   how this function always behaved and what every caller that has not been
   taught about currencies still gets — and it is the right answer for a
   vault whose entries state no currency, which is all of them until someone
   sets one (ISSUE 30; Owed Money.md gained the column by ADR-0003 append).

   Supplied, entries in another currency are held OUT of the totals and
   returned in `otherCurrencies` for the caller to state. Adding a €500 loan
   to a relative into a rand "outstanding" figure is a wrong number, and
   dropping it silently is what currency.js:14 forbids — so it is neither. */
function owedSummary(owed, today, household) {
  const list = owed || [];
  let outstanding = 0, recovered = 0, open = 0, oldestDays = null;
  const others = new Map();
  const backOthers = new Map();
  for (const o of list) {
    const settled = isSettled(o);
    /* Settled FIRST, then foreign — and that order is the whole of this
       branch's history. The foreign test used to `continue` before
       isSettled() ran, so a euro entry the reader marked `status: paid` was
       counted in `otherCurrencies` forever: the Owed page printed "plus € 500
       owed in other currencies" beside a row whose own pill, off the same
       isSettled(), read "Paid". Nothing the reader could do cleared it, since
       setting that status is exactly what the app asks of them.

       And a foreign entry's recovered money reached nowhere at all. It cannot
       reach `recovered` — that total is stated in the household's currency and
       €200 is not R200, which currency.js:10 forbids inventing a rate for —
       so it needs a counterpart of its own, or it is money dropped in silence,
       which currency.js:14 forbids just as plainly. Hence `recoveredOthers`:
       the same [symbol, total] shape as `otherCurrencies`, so a view states
       both the same way.

       `amt` is floored for the same reason the household branch floors it: a
       stray minus sign makes outstandingOf clamp to 0, which marks the row
       settled, and reading `o.amount` raw would then subtract a typo from a
       real recovery. The bug was fixed once on the household side; this is the
       same arithmetic one currency over and gets the same floor rather than a
       second chance to reintroduce it. */
    if (household && isForeign(o, household)) {
      const sym = symbolOf(o, household);
      const amt = Math.max(0, o.amount || 0);
      if (settled) {
        backOthers.set(sym, (backOthers.get(sym) || 0)
          + (o.repaid > 0 ? Math.min(o.repaid, amt) : amt));
      } else {
        others.set(sym, (others.get(sym) || 0) + Math.max(0, outstandingOf(o)));
        const back = Math.min(o.repaid || 0, amt);
        if (back > 0) { backOthers.set(sym, (backOthers.get(sym) || 0) + back); }
      }
      continue;
    }
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
  return {
    outstanding, recovered, open, entries: list.length, oldestDays,
    /* [symbol, outstanding] pairs, in each entry's own currency and never
       converted — the caller states them beside the total rather than
       inside it. Empty on every single-currency vault. */
    otherCurrencies: [...others].map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0]),
    /* The other half of that ledger, in the same shape: what has come BACK in
       each foreign currency. Separate from `recovered` because that figure is
       in the household's own currency and adding a euro to it would be a wrong
       number; separate from `otherCurrencies` because "still out" and "came
       back" are opposite answers and a reader must not have to work out which
       one a single list is showing them. Empty on every single-currency
       vault — and empty, like its sibling, when no household symbol was given
       at all, because then nothing was held out to report. */
    recoveredOthers: [...backOthers].map(([sym, v]) => [sym, (Math.round(v * 100) / 100) || 0]),
  };
}

module.exports = { outstandingOf, isSettled, owedSummary };
