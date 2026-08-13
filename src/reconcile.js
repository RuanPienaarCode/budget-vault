'use strict';
/* Reconciliation — measuring a balance somebody TYPED against what their
   transactions imply, and reporting the disagreement.

   Extracted from views/accounts.js, which is where this was written and
   debugged first. It lives here because Accounts is no longer the only page
   that needs it: a savings balance, a subscription amount and a debt balance
   are all figures a reader states once and the vault can check afterwards.

   The rule this module exists to enforce: NEVER silently overwrite either
   figure. A reconciliation reports that two numbers disagree and hands the
   reader the arithmetic; deciding which one is wrong is theirs. That is why
   `reconcile` returns a state and an implied figure rather than a corrected
   balance — the caller renders an offer, not a change.

   Pure — no DOM, no obsidian import — so it runs in bare node under
   tests/reconcile.test.cjs. `today` is injectable for the same reason: a test
   that depends on the wall clock passes in June and fails in July. */

/* ISO_DATE and todayIso come from src/dates.js — also pure, so requiring it
   here keeps this module's bare-node test working. A reconciliation is where a
   local-vs-UTC "today" does its damage: the value is compared against statement
   dates to decide which rows land after the balance was last confirmed, so an
   hour's drift silently misfiles a day's transactions. */
const { ISO_DATE, todayIso, isRealIsoDate, daysBetween: isoDaysBetween } = require('./dates');
const { supersededBySplit } = require('./tx-role');

/* A balance nobody has confirmed in this long is treated as unverified. Long
   enough that a monthly statement cycle doesn't trip it, short enough that a
   figure quietly drifting for a quarter can't hide behind "recently updated". */
const STALE_DAYS = 30;

/* Whole days between an ISO date and today, or null if the value isn't a date
   this can reason about (blank, or a hand-typed "end of June"). dates.js owns
   the counting; isRealIsoDate is the realness check kept at this boundary — a
   shape-valid but impossible balance_updated (2026-13-45) must still be
   refused, not silently rolled forward a day-number library would accept.
   The wall-clock fallback stays here too, deliberately: `today` is normally
   injected so a test that reads the clock doesn't pass in June and fail in
   July, but a live reconciliation still needs an answer when nobody passed
   one in. */
function daysSince(iso, today) {
  if (!isRealIsoDate(iso)) return null;
  const now = isRealIsoDate(today) ? today : todayIso();
  return isoDaysBetween(iso, now);
}

/* Is a stated figure old enough to stop trusting? `null` (never confirmed, or
   a date this can't read) counts as stale — an unconfirmed balance and one
   confirmed before records began are the same thing to a reader. */
function isStale(iso, today) {
  const d = daysSince(iso, today);
  return d === null || d > STALE_DAYS;
}

/* What the balance should read RIGHT NOW: the last confirmed figure plus
   everything dated after it, up to and including today.

   Two windows, not one. A statement can carry rows dated ahead — a scheduled
   debit order, a pending card authorisation — and money that has not moved yet
   is not part of what the account reads today. Folding those in and then
   stamping the reconciliation with today's date would also count them a second
   time on the next pass, because they would still be dated after the new
   balance date. They are reported separately instead, and roll into the window
   on their own once the day arrives.

   Excluded rows DO count here: "exclude" keeps a row out of the BUDGET, but the
   money still left the bank, so skipping it would make every reconciliation on
   an account with one excluded transfer wrong. The glossary says the same
   thing — an excluded transaction is vetoed from income and spend totals, not
   hidden from everything.

   The ONE exception is a split parent, and it is the exception precisely
   because of the rule above. A split keeps the bank's own row, marks it
   excluded, and adds parts that sum back to it — so a reader honouring the
   rule counts that charge twice and reports an implied balance short by the
   whole amount. It is skipped by ROLE rather than by `excluded`, because those
   two now mean different things: see src/tx-role.js.

   States:
     no-tx    nothing to check against
     no-date  a balance with no readable date — can't place the window
     clean    nothing has moved since it was confirmed
     pending  nothing has moved, but rows are dated ahead
     drift    money has moved; `implied` is what it would read */
function reconcile(a, rows, today) {
  /* The DATE is checked before the rows, and the order is load-bearing.

     Tested the other way round, an account with a stated balance, no
     `balance_updated` and no imported transactions returned 'no-tx' and never
     reached the date test at all. The Dashboard's "What's left" card derives
     `dated` from exactly this state, so that account was treated as a confirmed
     balance and its full figure counted as spendable cash — which is the one
     thing committed.js's first rule says must never happen ("An account whose
     balance has no readable date cannot be placed at all and is COUNTED AS
     UNKNOWN rather than as zero"). The shape is common: a cash wallet, a
     just-added account, anything nothing imports into.

     'no-date' is the more fundamental answer of the two — without a date there
     is no window to place, whether or not there are rows to place in it. */
  if (!ISO_DATE.test(a.balance_updated || '')) return { state: 'no-date' };
  if (!rows || !rows.length) return { state: 'no-tx' };
  const now = ISO_DATE.test(today || '') ? today : todayIso();
  const since = [], ahead = [];
  for (const r of rows) {
    if (supersededBySplit(r)) continue;   // its parts are in this same list
    if (r.date <= a.balance_updated) continue;
    (r.date > now ? ahead : since).push(r);
  }
  const delta = since.reduce((s, r) => s + r.amount, 0);
  if (!since.length) {
    return ahead.length ? { state: 'pending', ahead: ahead.length } : { state: 'clean' };
  }
  return { state: 'drift', count: since.length, ahead: ahead.length, delta, implied: a.balance + delta };
}

/* How many of a set of accounts are carrying an unconfirmed balance, and the
   oldest confirmation among them. The Savings page states a net worth built out
   of these figures and the Dashboard wants to mention them at all — both need
   the summary rather than the per-account detail Accounts already renders. */
function stalenessSummary(accounts, today) {
  let stale = 0, oldest = null, dated = 0;
  for (const a of accounts || []) {
    const d = daysSince(a.balance_updated, today);
    if (d !== null) dated++;
    if (isStale(a.balance_updated, today)) stale++;
    if (d !== null && (oldest === null || d > oldest)) oldest = d;
  }
  return { total: (accounts || []).length, stale, dated, oldestDays: oldest };
}

module.exports = { STALE_DAYS, daysSince, isStale, reconcile, stalenessSummary };
