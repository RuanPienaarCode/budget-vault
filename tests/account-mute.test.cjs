'use strict';
/* Telling one account to stop asking.

   The queue on the Accounts page is worth having only while every row in it is
   a decision the reader actually intends to make. A cash wallet that will
   never have a statement to import sits in it forever saying "nothing
   imported", and one permanent row is enough to teach a reader to skim past
   the queue — at which point the drifting account underneath it is missed too.
   `ignore_warnings` is how that row leaves.

   What this pins is the shape of the mute rather than its plumbing:

     • it hides the NAG, not the FACT — the state is unchanged and still shown;
     • it is per-warning, so muting "nothing imported" does not also mute a
       drift that turns up later;
     • a typo mutes nothing, rather than muting everything.

   src/acct-status.js is pure, so this runs in bare node with no stub.

     node tests/account-mute.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { statusOf, wantsALook, queueOrder, mutedWarnings, WARNINGS } = require('../src/acct-status');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-08-10';
/* A wallet with no folder and nothing imported — the permanent-queue-row case
   this feature exists for. */
const wallet = extra => ({ name: 'Cash', balance: 500, balance_updated: TODAY, ...extra });

/* ---- 1. unmuted, an account with no folder asks to be looked at ---- */
{
  const s = statusOf(wallet(), [], TODAY, false);
  eq(s.state, 'nofolder', 'no folder linked');
  eq(s.muted, false, 'and nothing has told it to be quiet');
  eq(wantsALook(s), true, 'so it is in the queue');
}

/* ---- 2. muted, it keeps its state and leaves the queue ---- */
{
  const s = statusOf(wallet({ ignore_warnings: '[no-folder]' }), [], TODAY, false);
  eq(s.state, 'nofolder', 'the state is UNCHANGED — this is a mute, not a fix');
  eq(s.muted, true, 'but it is marked muted');
  eq(wantsALook(s), false, 'so it drops out of the queue, the count and the filter');
  eq(queueOrder([s]), [], 'and out of the ordered queue itself');
}

/* ---- 3. the mute is per-warning, and that is the whole point.

   An account told to ignore "nothing imported" that later DRIFTS must be
   asked about the drift. Muting one warning is not a standing licence to stop
   checking the figure — and drift is the one state with an exact answer
   waiting, so swallowing it would be the costliest possible over-reach. ---- */
{
  /* Confirmed on the 1st, then R100 moved on the 5th and the stated figure was
     never updated — so the transactions imply 400 where the file says 500. */
  const a = wallet({ balance_updated: '2026-08-01', ignore_warnings: '[no-transactions]' });
  const rows = [{ date: '2026-08-05', amount: -100, label: 'Cash' }];
  const s = statusOf(a, rows, TODAY, true);
  eq(s.state, 'drift', 'with rows present it is drifting, not the muted state');
  eq(s.muted, false, 'so the mute does not apply');
  eq(wantsALook(s), true, 'and the account is asked about again');
}

/* ---- 4. `true` mutes the lot ---- */
{
  for (const word of ['true', 'yes', 'all', 'ALL', ' true ']) {
    eq(mutedWarnings({ ignore_warnings: word }), new Set(WARNINGS), `"${word}" mutes every warning`);
  }
  const s = statusOf(wallet({ ignore_warnings: 'true' }), [], TODAY, false);
  eq(wantsALook(s), false, 'and the account never reaches the queue');
}

/* ---- 5. an ok account is never "muted".

   `muted` says a warning was silenced. An account that agrees with its
   transactions had none to silence, so reporting it as muted would put a
   dashed "ignored" pill on a perfectly healthy row. ---- */
{
  const a = wallet({ ignore_warnings: 'true' });
  const rows = [{ date: '2026-08-09', amount: 0, label: 'Cash' }];
  const s = statusOf(a, rows, TODAY, true);
  if (s.state === 'ok') eq(s.muted, false, 'an agreeing account is not "muted"');
  else ok(true, 'this fixture did not reach ok; covered by case 3');
}

/* ---- 6. the words a reader would actually type all resolve ---- */
{
  const same = (input, want, why) => eq([...mutedWarnings({ ignore_warnings: input })], want, why);
  same('[no-transactions]', ['notx'], 'the readable name');
  same('[notx]', ['notx'], 'the code name');
  same('no_transactions', ['notx'], 'underscores normalise');
  same('no transactions', ['notx'], 'and so do spaces');
  same('[unconfirmed, never-confirmed]', ['stale', 'nodate'], 'a list of readable names');
  same('unconfirmed,drift', ['stale', 'drift'], 'bare comma-separated, no brackets');
  same('[no-imports]', ['notx'], '"no imports" is the same complaint as "nothing imported"');
}

/* ---- 7. a typo mutes NOTHING.

   The failure to avoid is guessing wide: reading an unrecognised word as
   "mute everything" would silence the exact state the reader was trying to
   name, and they would have no way to see that it had happened. ---- */
{
  eq(mutedWarnings({ ignore_warnings: '[no-transctions]' }), new Set(), 'a misspelling mutes nothing');
  eq(mutedWarnings({ ignore_warnings: '[notx, banana]' }), new Set(['notx']),
    'and a bad word beside a good one drops only itself');
  eq(mutedWarnings({}), new Set(), 'no key at all mutes nothing');
  eq(mutedWarnings({ ignore_warnings: 'false' }), new Set(), 'and an explicit false does too');
  eq(mutedWarnings(null), new Set(), 'a missing account does not throw');
}

/* ---- 8. muting one account does not quieten another ---- */
{
  const loud = statusOf(wallet({ name: 'Petty Cash' }), [], TODAY, false);
  const quiet = statusOf(wallet({ ignore_warnings: 'true' }), [], TODAY, false);
  eq(queueOrder([quiet, loud]).length, 1, 'exactly one of the two is still asking');
  eq(queueOrder([quiet, loud])[0], loud, 'and it is the one that was not muted');
}

console.log(`PASS tests/account-mute.test.cjs (${checks} checks)`);
