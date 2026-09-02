'use strict';
/* What a stated balance IS right now, and which of those states the reader is
   asked about first.

   Extracted from views/accounts.js for the same reason reconcile.js was: this
   is the judgement the Accounts page is built on — which accounts land in the
   decision queue, in what order, and what each one is told to do — and it is
   pure arithmetic over dates and rows. Left inside the view it could only be
   checked by rendering a page.

   The states, and why the order between them is what it is:

     notx    a transactions folder is linked, but nothing has imported into it
             yet. Nothing can check the figure.
     nofolder no folder is linked at all, so nothing can import, so nothing can
             check the figure either.

             These two are separated because the ANSWER differs and only the
             answer is actionable: the first reader imports a statement, the
             second links a folder. Collapsed into one state — which is what
             "zero rows" gives you, since an empty folder contributes no rows —
             the page hands every one of them "Link a folder", telling the first
             reader to re-link a folder they already have. Both are said before
             the states below for the same reason as before: they make every one
             of them unanswerable rather than false, because an account with no
             transactions cannot drift, and calling it "unconfirmed for 94 days"
             implies a check that could have happened and didn't.
     drift   money has moved since the figure was confirmed, and there is an
             exact replacement waiting. The only state with a one-tap answer,
             so it outranks the two below even when they are also true.
     nodate  a figure with no readable date — there is no window to place, so
             nothing can be measured from it.
     unreadable
             the FIGURE has a date, but one or more TRANSACTIONS do not: a row
             dated 2026-13-05 (the ordinary day/month swap), 2026-02-30, or
             "end of June". Such a row cannot be placed before or after the
             confirmation, so the check is incomplete and the account cannot
             honestly be called settled — see reconcile()'s own note on why it
             is counted rather than guessed at. Ranked below `stale` because a
             stale figure has an answer the reader can give from inside the app
             ("Confirm balance") while this one is a typo they have to go and
             find in a transaction file, and above the three set-up gaps
             because, unlike those, this is a figure that LOOKED checked and
             was not.
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
   last three are set-up gaps that have already waited this long.

   `notx` sorts above `nofolder` because it is the nearer of the two to being
   answered — the folder is already there, so the reader is one import from a
   checkable figure, where the other still has to decide what to link. */
const URGENCY = { drift: 0, stale: 1, unreadable: 2, nodate: 3, notx: 4, nofolder: 5, ok: 9 };

/* Never-confirmed sorts as the oldest thing on the page. MAX_SAFE_INTEGER
   rather than Infinity so two of them subtract to 0 rather than to NaN — a NaN
   makes the comparator non-transitive, and the resulting order is not merely
   wrong but unstable between renders. */
const OLDEST = Number.MAX_SAFE_INTEGER;
const staleRank = s => (s.days === null ? OLDEST : s.days);

/* `hasFolder` is the caller's answer to "is a Transactions/ folder linked to
   this account?" — knowledge that lives in the vault tree, not in the rows, and
   cannot be recovered from an empty row list. Omitting it resolves to
   `nofolder`, which is what every caller got before this argument existed. */
function statusOf(a, rows, today, hasFolder) {
  const list = rows || [];
  const rec = reconcile(a, list, today);
  const days = daysSince(a.balance_updated, today);
  let state;
  if (!list.length) state = hasFolder ? 'notx' : 'nofolder';
  else if (rec.state === 'drift') state = 'drift';
  /* Consult reconcile()'s OWN verdict for "is this date usable at all" rather
     than re-deriving one from `days === null` — the two used to disagree.
     `days` is `daysSince()`'s signed count, null only when the date is
     unreadable; reconcile() also calls a date 'no-date' when it is a real ISO
     string dated in the FUTURE (a typo'd year), which left `days` a real
     negative number that `days === null` let straight through to the `stale`
     check below. `d > STALE_DAYS` is false for a negative `d`, so the account
     read as freshly confirmed and vanished from the attention queue — the
     exact hole 1.23.1 closed in reconcile() and stalenessSummary() but missed
     here, because this was a second function answering the same question by
     a different rule. reconcile() already worked this out three lines above;
     asking it again by a different test is how the two answers drifted apart
     in the first place. */
  else if (rec.state === 'no-date') state = 'nodate';
  else if (isStale(a.balance_updated, today)) state = 'stale';
  /* THE LAST GATE BEFORE `ok`, and it is a gate rather than a rank. A row
     whose date names no day (2026-13-05, 2026-02-30, "end of June") cannot be
     placed on either side of the confirmation, so reconcile() counted it and
     placed nothing — which means "clean" here means "nothing READABLE has
     moved", and reporting that as `ok` would paint the pill green on "agrees"
     over a check that never finished. That is exactly how R2 000 of spending
     went missing: the row sorted after today as a string, landed in `ahead`,
     and the account left the decision queue entirely.

     It sits AFTER `stale` deliberately. Both are true of the same account
     often enough (nobody who mistypes a date is confirming balances weekly),
     and of the two only `stale` has an answer the reader can give without
     leaving the page — the same reasoning that puts `drift` ahead of `stale`
     twelve lines up, applied one rung down. The count still travels on `rec`
     either way, so a view showing a stale account can still say what else is
     wrong with it. */
  else if (rec.unreadable) state = 'unreadable';
  else state = 'ok';
  /* Resolved against the state that was actually reached, not against every
     state the account could have been in. An account told to ignore `notx`
     that later starts drifting is asked about the drift — muting one warning
     is not a standing licence to stop checking the figure. */
  const muted = state !== 'ok' && mutedWarnings(a).has(state);
  return { state, rec, days, muted };
}

/* ------------------------- muting a warning ---------------------------- */

/* Every state that can be silenced. `ok` is absent because there is nothing
   there to silence, and its absence is what stops `ignore_warnings: ok` from
   parsing into something meaningless.

   `unreadable` is absent for a different reason: every state in this list is a
   JUDGEMENT the reader may reasonably disagree with — a cash wallet nobody
   will ever import into, a fund whose balance is confirmed yearly on purpose.
   A transaction date that names no day is not a judgement, it is a typo with
   one correct answer, and offering to hide it would let a vault carry money
   nothing can place, permanently and by consent. It is also the one state a
   reader can settle for good: fix the date and it never returns. */
const WARNINGS = ['drift', 'stale', 'nodate', 'notx', 'nofolder'];

/* The frontmatter is written by hand as often as by the dialog, so the words a
   reader would actually reach for all resolve. `notx` and `nodate` are what the
   code calls them; nobody types that unprompted, and a key that silently fails
   to parse is worse than no key at all — the reader sets it, the warning stays,
   and there is nothing on screen explaining why. */
const WARNING_ALIASES = {
  drift: 'drift', drifted: 'drift', drifting: 'drift',
  stale: 'stale', unconfirmed: 'stale', old: 'stale', 'not-confirmed': 'stale',
  nodate: 'nodate', 'no-date': 'nodate', 'never-confirmed': 'nodate', undated: 'nodate',
  notx: 'notx', 'no-transactions': 'notx', 'no-transaction': 'notx',
  'nothing-imported': 'notx', 'no-imports': 'notx', 'no-import': 'notx',
  nofolder: 'nofolder', 'no-folder': 'nofolder', 'not-linked': 'nofolder',
};

/* Which warnings this account has been told to keep quiet about.

   Accepts `true` (all of them — the shorthand, and what the dialog's
   everything-off state means), a bracketed or bare comma/space list, or
   nothing. Underscores and spaces normalise to hyphens so `no_transactions`,
   `no transactions` and `no-transactions` are the same instruction.

   An unrecognised word is DROPPED rather than treated as "mute everything":
   guessing wide on a typo would hide the very state the reader is trying to
   name, which is the one failure this key must not have. */
function mutedWarnings(a) {
  const raw = String((a && a.ignore_warnings) || '').trim();
  if (!raw) return new Set();
  if (/^(true|yes|on|all|1)$/i.test(raw)) return new Set(WARNINGS);
  if (/^(false|no|off|none|0)$/i.test(raw)) return new Set();
  /* Split on COMMAS only, then fold the whitespace inside each item into a
     hyphen. Splitting on whitespace too would look more generous and be less
     useful: `[no transactions, unconfirmed]` is what someone writing the words
     out actually types, and a whitespace split tears it into "no" and
     "transactions", neither of which means anything. The cost is that a
     comma-less `notx nofolder` mutes nothing — which is not valid YAML flow
     syntax anyway, and failing closed is the right direction to fail. */
  const out = new Set();
  for (const part of raw.replace(/^\[|\]$/g, '').split(',')) {
    const k = part.trim().toLowerCase()
      .replace(/^["']|["']$/g, '')
      .replace(/[_\s]+/g, '-');
    if (WARNING_ALIASES[k]) out.add(WARNING_ALIASES[k]);
  }
  return out;
}

/* A muted account KEEPS its state — it is not reported as `ok`, and the page
   still shows the pill saying what it actually is. Only `wantsALook` changes,
   which is what takes it out of the queue, the attention count and the
   "Needs a look" filter.

   Reporting it as `ok` instead would have been fewer lines and a lie: a figure
   nothing has ever confirmed does not agree with the transactions, it is
   merely one the reader has said they do not want asked about. The distinction
   is the whole reason this is a mute and not a fix. */
const wantsALook = s => s.state !== 'ok' && !s.muted;

/* The decision queue: everything that wants a look, most urgent first, and
   within one urgency the oldest figure first. Returns a NEW array — the caller
   renders from it while still holding the unsorted model. */
function queueOrder(statuses) {
  return statuses
    .filter(wantsALook)
    .slice()
    .sort((x, y) => URGENCY[x.state] - URGENCY[y.state] || staleRank(y) - staleRank(x));
}

module.exports = { URGENCY, STALE_DAYS, WARNINGS, statusOf, wantsALook, staleRank,
  queueOrder, mutedWarnings };
