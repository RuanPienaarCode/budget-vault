'use strict';
/* The Accounts decision queue — which accounts land in it, in what order.

   The page was rebuilt around a promise: the two or three accounts whose
   stated balance cannot be trusted are named at the top, most urgent first,
   each with the ONE action that settles it. Everything below is the ledger.
   That promise is only as good as this state machine, and every invariant here
   is a way of breaking it that reads as a design choice rather than a bug.

   Six invariants:

     1. NOTHING TO CHECK OUTRANKS EVERYTHING. An account no transactions import
        into cannot drift and cannot be "unconfirmed for 94 days" in any useful
        sense — both phrasings imply a check that could have run. It is told
        the truth instead: nothing can check this figure.

     2. DRIFT OUTRANKS STALENESS. An account that is BOTH stale and drifting
        gets the arithmetic, not the nag. Accepting the implied figure stamps
        today's date, so one tap settles both — reporting the staleness instead
        hides the answer behind the complaint.

     3. A FIGURE WITH NO DATE IS ITS OWN STATE. Not "stale", which implies it
        was confirmed once and has aged; there is no window to measure at all.

     4. THE QUEUE IS ORDERED BY WHAT IT COSTS TO SETTLE, not by vault order.
        Within one urgency, the oldest figure comes first.

     5. NEVER-CONFIRMED IS THE OLDEST THING ON THE PAGE, and two of them
        subtract to 0 rather than NaN. A NaN comparator is not merely mis-sorted
        — it is UNSTABLE, so the queue reshuffles between renders and the row a
        reader was about to tap moves out from under them.

     6. AN ACCOUNT THAT AGREES IS NEVER IN THE QUEUE. The all-clear state has
        to be reachable, or the band never goes away and stops being read.

   Pure node — no DOM, no Obsidian.
     node tests/accounts-status.test.cjs
*/

const assert = require('assert');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const { statusOf, wantsALook, staleRank, queueOrder, URGENCY } = require(path.join(SRC, 'acct-status.js'));

/* A fixed "today" — a test that reads the wall clock passes in June and fails
   in July, which is the bug reconcile.js's own header warns about. */
const TODAY = '2026-08-10';
const acct = (over = {}) => Object.assign({ name: 'A', balance: 1000, balance_updated: '2026-08-01' }, over);
const row = (date, amount) => ({ date, amount, label: 'A' });

/* ---- 1. nothing to check outranks everything ---- */
{
  /* Stale by 94 days AND no rows. The staleness is true and useless: there is
     nothing that could have confirmed it. */
  const s = statusOf(acct({ balance_updated: '2026-05-08' }), [], TODAY);
  eq(s.state, 'notx', 'no rows wins over staleness');

  /* No rows AND no date. Same answer — still nothing to check against. */
  eq(statusOf(acct({ balance_updated: '' }), [], TODAY).state, 'notx',
    'no rows wins over a missing date too');

  /* And it is genuinely in the queue, not quietly dropped for lack of data. */
  ok(wantsALook(s), 'an account nothing imports into still asks for a look');
}

/* ---- 2. drift outranks staleness ---- */
{
  /* Confirmed 94 days ago, and money has moved since. Both true; the reader is
     handed the arithmetic, because accepting it stamps the date as well. */
  const s = statusOf(acct({ balance_updated: '2026-05-08' }), [row('2026-06-01', -250)], TODAY);
  eq(s.state, 'drift', 'a stale AND drifting account is offered the arithmetic');
  eq(s.rec.implied, 750, 'the implied figure is the one the offer would write');
  ok(URGENCY.drift < URGENCY.stale, 'drift sorts ahead of stale in the queue');
}

/* ---- 3. no date is its own state, not staleness ---- */
{
  const s = statusOf(acct({ balance_updated: '' }), [row('2026-08-05', -100)], TODAY);
  eq(s.state, 'nodate', 'a figure with no readable date is nodate, not stale');
  eq(s.days, null, 'and it has no age to report');

  /* A date the loader cannot parse is the same thing as none: there is still
     no window to place. */
  eq(statusOf(acct({ balance_updated: 'end of June' }), [row('2026-08-05', -100)], TODAY).state,
    'nodate', 'an unparseable date is nodate too');
}

/* ---- 4 + 5. queue order ---- */
{
  const mk = (name, state, days) => ({ name, state, days });
  /* Deliberately built in the WRONG order, and with the two never-confirmed
     entries adjacent — that pair is what produced NaN when staleRank returned
     Infinity, and a NaN comparator silently un-sorts the whole list. */
  const q = queueOrder([
    mk('okOne', 'ok', 2),
    mk('notxOne', 'notx', 40),
    mk('nodateA', 'nodate', null),
    mk('staleOld', 'stale', 94),
    mk('nodateB', 'nodate', null),
    mk('driftOne', 'drift', 31),
    mk('staleNew', 'stale', 38),
  ]);

  eq(q.map(x => x.name), ['driftOne', 'staleOld', 'staleNew', 'nodateA', 'nodateB', 'notxOne'],
    'urgency first, then the oldest figure within an urgency');
  ok(!q.some(x => x.state === 'ok'), 'an account that agrees is never in the queue');

  /* The NaN trap, stated directly: two never-confirmed entries must compare
     equal, not produce NaN. */
  const a = mk('x', 'nodate', null), b = mk('y', 'nodate', null);
  eq(staleRank(b) - staleRank(a), 0, 'two never-confirmed figures compare equal, not NaN');
  ok(Number.isFinite(staleRank(a)), 'never-confirmed has a finite rank');
  ok(staleRank(a) > staleRank(mk('z', 'stale', 9999)),
    'never-confirmed still outranks any real age');

  /* Stability: the same input sorted twice gives the same order. */
  eq(queueOrder(q).map(x => x.name), q.map(x => x.name), 'the order is stable across passes');
}

/* ---- 6. the all-clear is reachable ---- */
{
  const s = statusOf(acct({ balance_updated: '2026-08-09' }), [row('2026-08-01', -50)], TODAY);
  eq(s.state, 'ok', 'a fresh figure with nothing since it agrees');
  ok(!wantsALook(s), 'and it stays out of the queue');
  eq(queueOrder([s]).length, 0, 'a page where everything agrees has an empty queue');

  /* Rows dated AHEAD of today are not drift — the money has not moved yet.
     reconcile reports them separately; the state stays ok. */
  const ahead = statusOf(acct({ balance_updated: '2026-08-09' }), [row('2026-08-20', -900)], TODAY);
  eq(ahead.state, 'ok', 'a scheduled debit order dated ahead is not drift');
  eq(ahead.rec.state, 'pending', 'but it is still reported as pending');
}

console.log(`PASS — the Accounts decision queue names the right accounts, in the right order (${checks} checks).`);
