'use strict';
/* Rows filed under the wrong month's file — found, counted and named, never
   moved.

   WHY THIS EXISTS AS ITS OWN MODULE.

   A transaction is stored under the calendar month it fell in (CONTEXT.md),
   and the period walk leans on that: txInRange (period.js) and
   unreadableAmounts (figures.js) skip a whole month file when its FILENAME
   month is outside the window, and only then filter the rows by date. That
   fast path is what keeps a five-year vault from being walked row by row for
   every period figure, and it is right for every row the app itself writes —
   the importer and the Add dialog both file a row by its own date.

   It is wrong for exactly one input, and that input is in scope by this
   plugin's first rule (the markdown is the source of truth, and a hand may
   edit it): a row whose date is not in its file's month. 2026-09-03 typed or
   pasted into 2026-08.md is out of August by its date and out of September by
   its file. reconcile() reads rows without asking which file they came from,
   so the implied balance moves by the row — and no period on any page shows
   why. The 2026-11-11 audit reproduced it: zero rows in September, spend 0,
   balance changed.

   The decision (Ruan, 2026-11-11) was to KEEP the fast path and disclose. The
   app argues, it does not correct: letting the row's date overrule its file
   would silently change which rows a period counts on every vault that has
   one, and moving the row would rewrite a file the reader typed. So this
   module only answers two questions, and the pages print the answer beside
   the figure it qualifies:

     misfiledRows(file)        which rows are dated outside the file's month
     uncountedRows(files, w)   which of those no period reads at all

   The second is narrower on purpose. Under calendar months they are the same
   set. Under a payday month or a day-count cycle a period spans two calendar
   months and reads both files, so a row dated 3 September in August's file IS
   read by the period running 23 August – 22 September: it is listed and
   counted, and a notice calling it missing would be a caveat with no figure
   under it. Only a row whose OWN period skips its file is in no period.

   Pure, and today-free: whether a row is misfiled is a fact about the file,
   and must read the same on any day. The period shape arrives as `windowOf`,
   so nothing here knows what a payday is. */

const { isRealIsoDate } = require('./dates');
const { supersededBySplit } = require('./tx-role');

/* The period walk's own veto, stated once for the detection: a month file is
   not read for a window that does not touch its calendar month. The same
   comparison txInRange and unreadableAmounts make inline; kept in step with
   them by tests/misfiled-rows-disclosed.test.cjs, whose oracle is the real
   txInPeriod and not this function. */
function fileOutsideWindow(month, start, end) {
  return month < String(start).slice(0, 7) || month > String(end).slice(0, 7);
}

/* The rows of one month file that are dated in another calendar month.

   A REAL date only. `2026-13-05` and "end of June" name no day at all, so
   they cannot be said to belong to another month; reconcile() already counts
   those as `unreadable` and acct-status refuses to call the account settled
   while one exists, and one row must not be reported under two reasons.

   Through tx-role, like every reader of raw rows: a superseded split parent is
   skipped, because its parts sit in the same file with the same date and carry
   the money — counting both would name one purchase as two rows. An Excluded
   row is NOT skipped: the money still moved, and the Score and the Accounts
   flow chips read it by period. */
function misfiledRows(file) {
  const out = [];
  if (!file || !file.month) return out;
  for (const r of file.rows || []) {
    if (!r || typeof r.date !== 'string' || r.date.startsWith(file.month)) continue;
    if (!isRealIsoDate(r.date) || supersededBySplit(r)) continue;
    out.push(r);
  }
  return out;
}

/* The misfiled rows that are in NO period: the period that owns the row's
   date does not read the file the row sits in.

   `windowOf(date)` hands back { start, end } of that period — period.js
   supplies periodRange(currentPeriod(date)), so the answer follows whatever
   shape a period has under the household's settings. A date no window owns
   (null) is uncounted by definition. Returns [{ file, row }], in file order. */
function uncountedRows(txFiles, windowOf) {
  const out = [];
  for (const file of Object.values(txFiles || {})) {
    for (const row of misfiledRows(file)) {
      const w = windowOf(row.date);
      if (!w || fileOutsideWindow(file.month, w.start, w.end)) out.push({ file, row });
    }
  }
  return out;
}

/* What a page prints: how many rows, and each file once with its own count.
   Sorted by path so the sentence reads the same on every render and on every
   device — S.txFiles is keyed in load order, which is the vault's, not the
   reader's. `relOf(file)` names the file; a month loaded from disk carries the
   path it was read from. */
function summariseMisfiled(items, relOf) {
  const nameOf = relOf || (f => f.rel);
  const byFile = new Map();
  for (const { file } of items || []) {
    let e = byFile.get(file);
    if (!e) { e = { label: file.label, month: file.month, rel: nameOf(file), count: 0 }; byFile.set(file, e); }
    e.count++;
  }
  const files = [...byFile.values()].sort((a, b) => String(a.rel).localeCompare(String(b.rel)));
  return { count: files.reduce((s, f) => s + f.count, 0), files };
}

module.exports = { fileOutsideWindow, misfiledRows, uncountedRows, summariseMisfiled };
