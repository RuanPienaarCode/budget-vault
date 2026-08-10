'use strict';
/* What a stated balance IS right now, and which of those states the reader is
   asked about first.

   Extracted from views/accounts.js for the same reason reconcile.js was: this
   is the judgement the Accounts page is built on — which accounts land in the
   decision queue, in what order, and what each one is told to do — and it is
   pure arithmetic over dates and rows. Left inside the view it could only be
   checked by rendering a page.

   The states, and why the order between them is what it is:

     notx    nothing imports into this account, so NOTHING can check the
             figure. Said first because it makes every other state below
             unanswerable rather than false: an account with no transactions
             cannot drift, and calling it "unconfirmed for 94 days" implies a
             check that could have happened and didn't.
     drift   money has moved since the figure was confirmed, and there is an
             exact replacement waiting. The only state with a one-tap answer,
             so it outranks the two below even when they are also true.
     nodate  a figure with no readable date — there is no window to place, so
             nothing can be measured from it.
     stale   probably still right, just old.
     ok      it agrees with the transactions.

   `drift` deliberately outranks `stale`: an account that is BOTH stale and
   drifting should be handed the arithmetic rather than nagged about the date,
   because accepting the arithmetic stamps today's date anyway — one tap
   settles both. Telling that reader "unconfirmed for 94 days" instead would
   hide the answer behind the complaint.

   Pure — no DOM, no obsidian import — so it runs in bare node under
   tests/accounts-status.test.cjs. `today` is injectable for the same reason
   reconcile's is: a test that reads the wall clock passes in June and fails in
   July. */

const { daysSince, isStale, reconcile, STALE_DAYS } = require('./reconcile');

/* Lower sorts first. The queue is ordered by what it costs the reader to
   settle, not by where the account happens to sit in the vault: a drift has an
   exact replacement waiting, a stale figure is probably still right, and the
   last two are set-up gaps that have already waited this long. */
const URGENCY = { drift: 0, stale: 1, nodate: 2, notx: 3, ok: 9 };

/* Never-confirmed sorts as the oldest thing on the page. MAX_SAFE_INTEGER
   rather than Infinity so two of them subtract to 0 rather than to NaN — a NaN
   makes the comparator non-transitive, and the resulting order is not merely
   wrong but unstable between renders. */
const OLDEST = Number.MAX_SAFE_INTEGER;
const staleRank = s => (s.days === null ? OLDEST : s.days);

function statusOf(a, rows, today) {
  const list = rows || [];
  const rec = reconcile(a, list, today);
  const days = daysSince(a.balance_updated, today);
  let state;
  if (!list.length) state = 'notx';
  else if (rec.state === 'drift') state = 'drift';
  else if (days === null) state = 'nodate';
  else if (isStale(a.balance_updated, today)) state = 'stale';
  else state = 'ok';
  return { state, rec, days };
}

const wantsALook = s => s.state !== 'ok';

/* The decision queue: everything that wants a look, most urgent first, and
   within one urgency the oldest figure first. Returns a NEW array — the caller
   renders from it while still holding the unsorted model. */
function queueOrder(statuses) {
  return statuses
    .filter(wantsALook)
    .slice()
    .sort((x, y) => URGENCY[x.state] - URGENCY[y.state] || staleRank(y) - staleRank(x));
}

module.exports = { URGENCY, STALE_DAYS, statusOf, wantsALook, staleRank, queueOrder };
