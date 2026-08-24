'use strict';
/* Guard for the future-dated `balance_updated` trap in isStale() / statusOf().

   1.23.1 closed this hole in reconcile() (returns 'no-date' for a
   balance_updated after today) and in stalenessSummary() (a negative age
   folds into undated rather than counting as fresh). isStale() itself was
   missed, and it is the function the Accounts attention queue actually
   consults through statusOf().

   Before the fix: `isStale(iso, today)` was `daysSince(...) === null ||
   d > STALE_DAYS`. A future date makes `daysSince` return a NEGATIVE number,
   and a negative number is never `> STALE_DAYS`, so a typo'd year read as
   freshly confirmed. statusOf() then compounded it by re-deriving its own
   "is this date usable" answer from `days === null` instead of asking
   reconcile() — whose 'no-date' verdict, sitting right there in the same
   return value, already knew the date was a future typo.

   Net effect this guards against: an account with a `balance_updated` typo'd
   into next year resolved to `state: 'ok'`, `wantsALook: false` — silently
   dropped from the queue and the attention count while real spending sat
   unaccounted for.

     node tests/future-balance-updated.test.cjs      # non-zero exit on failure
*/

const assert = require('assert');
const { isStale, reconcile } = require('../src/reconcile');
const { statusOf } = require('../src/acct-status');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const TODAY = '2026-08-07';
const FUTURE = '2027-08-07';   // a year typo'd forward — 365 days from now
const account = (extra) => ({ balance: 1000, balance_updated: FUTURE, ...extra });
const row = (date, amount) => ({ date, amount });

/* ---- isStale() itself: a future stamp is stale, not fresh ---- */
{
  ok(isStale(FUTURE, TODAY), 'a balance_updated a year in the future is stale, not freshly confirmed');
  // Sanity: the near-boundary and unreadable cases this function already
  // covered keep working — this guard must not be the only thing passing.
  ok(isStale('2026-04-11', TODAY), '118 days is still stale');
  ok(!isStale('2026-08-01', TODAY), 'six days is still not stale');
  ok(isStale('end of June', TODAY), 'unreadable is still stale');
}

/* ---- reconcile() already knew: 'no-date' for a future stamp ---- */
{
  const rec = reconcile(account(), [row('2026-08-01', -200)], TODAY);
  eq(rec.state, 'no-date', 'reconcile() already reads a future balance_updated as no-date');
}

/* ---- statusOf(): the queue-facing verdict must agree with reconcile()'s,
   not re-derive a second one from `days === null` ---- */
{
  const a = account();
  const rows = [row('2026-08-01', -200)];   // real spending after the (bogus) confirmation
  const s = statusOf(a, rows, TODAY, true);
  eq(s.state, 'nodate', 'a future-dated confirmation must not resolve to ok');
  ok(s.state !== 'ok', 'must not silently agree with the transactions');
}

/* ---- and the case that actually hid the money: no rows dated after the
   typo'd future stamp still must not fall through the same net.state check
   into isStale() reading a negative day count as fresh ---- */
{
  const a = account();
  const s = statusOf(a, [row('2026-01-01', -50)], TODAY, true);
  eq(s.state, 'nodate', 'unreachable-by-date rows still leave the account unconfirmed, not ok');
}

console.log(`future-balance-updated: ${checks} checks passed.`);
