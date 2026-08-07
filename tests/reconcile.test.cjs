'use strict';
/* Reconciliation — the argument the app makes about a hand-typed figure.

   src/reconcile.js has no DOM and no obsidian import, so this runs in bare node
   with no stub. Every case passes an explicit `today`: a test that reads the
   wall clock passes in June and fails in July.

   Two of these guard traps rather than behaviour, and are the reason the file
   exists at all:

     - rows dated AHEAD of today must never fold into the implied balance, or
       a scheduled debit order is counted once now and again next week.
     - EXCLUDED rows must still count. "Excluded" keeps a row out of income and
       spend totals; the money still left the bank. Every transaction in a
       fund account can be excluded, and reconciliation on those accounts is
       exactly where this module is about to be pointed — a later well-meant
       `.filter(r => !r.excluded)` would silently zero the whole page.

     node tests/reconcile.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const {
  STALE_DAYS, daysSince, isStale, reconcile, stalenessSummary,
} = require('../src/reconcile');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-08-07';
const acct = (balance, balance_updated) => ({ balance, balance_updated });
const row = (date, amount, extra) => ({ date, amount, ...extra });

/* ---- 1. daysSince reads what it can, and refuses what it can't ---- */
{
  eq(daysSince('2026-08-07', TODAY), 0, 'today is zero days ago');
  eq(daysSince('2026-08-01', TODAY), 6, 'six days');
  eq(daysSince('2026-04-11', TODAY), 118, 'the reference vault\'s stale stamp is 118 days');
  eq(daysSince('', TODAY), null, 'blank is not a date');
  eq(daysSince('end of June', TODAY), null, 'a hand-typed phrase is not a date');
  eq(daysSince(undefined, TODAY), null, 'missing is not a date');
  eq(daysSince('2026-13-45', TODAY), null, 'an impossible date is refused, not coerced');
}

/* ---- 2. never-confirmed and long-ago are the same thing to a reader ---- */
{
  ok(isStale('', TODAY), 'never confirmed is stale');
  ok(isStale('end of June', TODAY), 'unreadable is stale');
  ok(isStale('2026-04-11', TODAY), '118 days is stale');
  ok(!isStale('2026-08-01', TODAY), 'six days is not stale');
  ok(!isStale(TODAY, TODAY), 'confirmed today is not stale');
  eq(STALE_DAYS, 30, 'the threshold clears a monthly statement cycle');
  // Exactly on the boundary: 30 days is not yet stale, 31 is.
  ok(!isStale('2026-07-08', TODAY), '30 days is inside the window');
  ok(isStale('2026-07-07', TODAY), '31 days is outside it');
}

/* ---- 3. the four states ---- */
{
  eq(reconcile(acct(100, TODAY), [], TODAY).state, 'no-tx', 'no rows means nothing to check against');
  eq(reconcile(acct(100, TODAY), null, TODAY).state, 'no-tx', 'missing rows behaves as none');

  eq(reconcile(acct(100, ''), [row('2026-08-01', 50)], TODAY).state, 'no-date',
    'a balance with no readable date cannot place the window');
  eq(reconcile(acct(100, 'end of June'), [row('2026-08-01', 50)], TODAY).state, 'no-date',
    'nor can a hand-typed one');

  eq(reconcile(acct(100, '2026-08-01'), [row('2026-07-20', 50)], TODAY).state, 'clean',
    'rows older than the balance have already been absorbed into it');

  const drift = reconcile(acct(1000, '2026-08-01'), [
    row('2026-07-30', -999),   // before the stamp — must not count
    row('2026-08-02', -200),
    row('2026-08-05', 50),
  ], TODAY);
  eq(drift.state, 'drift', 'money has moved since the balance was stated');
  eq(drift.count, 2, 'only rows after the stamp are counted');
  eq(drift.delta, -150, 'the delta is their sum');
  eq(drift.implied, 850, 'implied is the stated balance plus the delta');
}

/* ---- 4. rows dated ahead never fold into the implied balance ----
   The trap: a scheduled debit order dated next week. Counting it now would
   also count it again after the balance is re-stamped with today's date,
   because it would STILL be dated after the new stamp. */
{
  const pending = reconcile(acct(1000, '2026-08-01'), [row('2026-08-20', -500)], TODAY);
  eq(pending.state, 'pending', 'a future row alone is pending, not drift');
  eq(pending.ahead, 1, 'and it is named rather than silently dropped');
  ok(!('implied' in pending), 'pending offers no implied figure to accept');

  const mixed = reconcile(acct(1000, '2026-08-01'), [
    row('2026-08-03', -100),
    row('2026-08-20', -500),   // ahead
  ], TODAY);
  eq(mixed.state, 'drift', 'a past row still drives drift');
  eq(mixed.implied, 900, 'the future row is NOT in the implied balance');
  eq(mixed.ahead, 1, 'but it is reported, so "matches" never hides a debit order');

  const boundary = reconcile(acct(1000, '2026-08-01'), [row(TODAY, -100)], TODAY);
  eq(boundary.state, 'drift', 'a row dated today has moved');
  eq(boundary.implied, 900, 'and counts in full');
}

/* ---- 5. excluded rows still count ----
   Every transaction in the reference vault's fund accounts carries
   `Excluded: yes`. Reconciliation must read them. */
{
  const rows = [
    row('2026-08-02', 2000, { excluded: true }),
    row('2026-08-03', 84.41, { excluded: true, category: 'Interest income' }),
  ];
  const r = reconcile(acct(10000, '2026-08-01'), rows, TODAY);
  eq(r.state, 'drift', 'an account whose every row is excluded still reconciles');
  eq(r.count, 2, 'excluded rows are counted');
  eq(r.implied, 12084.41, 'and their money is in the implied balance');
}

/* ---- 6. the summary the Savings and Dashboard pages need ---- */
{
  const s = stalenessSummary([
    acct(1, '2026-04-11'),   // 118 days — stale
    acct(2, '2026-04-11'),   // stale
    acct(3, TODAY),          // fresh
    acct(4, ''),             // never confirmed — stale, and undateable
  ], TODAY);
  eq(s.total, 4, 'every account is counted');
  eq(s.stale, 3, 'two long-ago plus one never-confirmed');
  eq(s.dated, 3, 'the blank one contributes no age');
  eq(s.oldestDays, 118, 'the oldest readable confirmation drives the headline');

  const none = stalenessSummary([], TODAY);
  eq(none.stale, 0, 'an empty vault is not stale');
  eq(none.oldestDays, null, 'and has no oldest');
  eq(stalenessSummary(undefined, TODAY).total, 0, 'missing accounts behaves as none');
}

console.log(`reconcile.test.cjs — ${checks} checks OK`);
