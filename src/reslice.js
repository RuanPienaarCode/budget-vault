'use strict';
/* Re-slicing a stranded budget's AMOUNTS onto the current period length.

   Switching period length leaves the old Budgets/<period>.md files in the vault
   but unaddressable — src/views/budgets.js explains that and offers to carry the
   structure across. Structure only: carryStructure() deliberately brings
   categories and notes and never a figure, because halving a monthly amount is
   right for groceries and wrong for rent, and a silently scaled number looks
   exactly like one somebody chose.

   This module does the arithmetic for the other half of that offer — a
   SUGGESTION per row, which the reader accepts or rejects line by line. Nothing
   here writes anything; it returns numbers for a modal to show. The judgement
   stays with the user, which is the whole reason the amounts were left blank in
   the first place.

   Pure — no DOM, no obsidian — so the suggestion arithmetic is testable in bare
   node without a stub, like the rest of the maths modules. */

const { ISO_DATE, isoDayNumber } = require('./dates');

/* How long the stranded periods were, inferred from their own names.

   The length is not recorded anywhere: a budget file is named for its start and
   carries no cycle length, so a vault that switched 7 → 14 has date-named files
   that cannot say which they were. Consecutive starts CAN say it — they are one
   cycle apart by construction — so the smallest positive gap between them is
   the old length.

   The smallest, not the first: a vault that has skipped periods (no budget
   written for a fortnight) shows gaps of 14 and 28, and only the smaller one is
   a cycle. It can still overstate when EVERY gap skips — a vault with exactly
   two files a month apart on a 14-day cycle reads as 28 — which is why the
   caller must be able to say "unknown" rather than guess: one file gives no gap
   at all, and that is the common case for someone who switched immediately. */
function inferIntervalFromKeys(keys) {
  const days = (keys || [])
    .filter(k => typeof k === 'string' && ISO_DATE.test(k))
    .map(isoDayNumber)
    .sort((a, b) => a - b);
  let best = null;
  for (let i = 1; i < days.length; i++) {
    const gap = days[i] - days[i - 1];
    if (gap > 0 && (best === null || gap < best)) best = gap;
  }
  return best;
}

/* Money rounds to cents, and rounds HALF AWAY FROM ZERO rather than JS's
   Math.round, which rounds -0.5 to -0.0 and would flip the sign of a small
   negative line. Budget rows are positive in practice, but the serializer
   writes whatever it is handed and a stray -0 in a file is a puzzle nobody
   should have to solve. */
function roundCents(n) {
  const s = n < 0 ? -1 : 1;
  return s * Math.round(Math.abs(n) * 100) / 100;
}

/* One suggestion per source row.

   `oldDays` null means the old length could not be inferred (see above). The
   rows still come back — the reader may well want the old figures carried over
   verbatim — but `suggested` is null and `scaled` is false, so the modal can
   say plainly that this is a copy and not a re-slice. Inventing a factor of 1
   and calling it a suggestion would be the silent conversion this whole flow
   exists to avoid.

   `existing` is the draft's current amount for that category. A row already
   budgeted for THIS period is marked so the modal can default it off and say
   why — the switch stranded the old files, it did not entitle them to overwrite
   work done since. */
function resliceBudget({ rows, oldDays, dstDays, existingByCategory = {} }) {
  const known = Number.isFinite(oldDays) && oldDays > 0 && Number.isFinite(dstDays) && dstDays > 0;
  const factor = known ? dstDays / oldDays : null;
  return {
    oldDays: known ? oldDays : null,
    dstDays: Number.isFinite(dstDays) && dstDays > 0 ? dstDays : null,
    factor,
    rows: (rows || []).map(r => {
      const old = Number(r.amount) || 0;
      const existing = Number(existingByCategory[r.category]) || 0;
      return {
        category: r.category,
        type: r.type,
        notes: r.notes || '',
        oldAmount: old,
        suggested: known ? roundCents(old * factor) : null,
        scaled: known,
        existing,
        hasExisting: existing !== 0,
      };
    }),
  };
}

module.exports = { inferIntervalFromKeys, resliceBudget, roundCents };
