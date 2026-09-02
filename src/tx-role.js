'use strict';
/* The role a transaction row plays in a split, and the one predicate every
   reader of RAW rows has to apply.

   WHY THIS EXISTS AS ITS OWN MODULE.

   `Excluded` came to mean two unrelated things, and nothing could tell them
   apart:

     1. "Vetoed from income and spend totals, but the money still moved."
        Internal transfers, and every row in a fund account. Anything measuring
        the ACCOUNT rather than the budget — reconciliation, contributions,
        growth — MUST read these, or a savings page reports a fund that has
        never received anything.

     2. "Superseded by its own parts." A split parent. The parts carry the same
        money under finer categories, so anything reading raw rows counts that
        charge TWICE — once as the parent, once as the parts.

   Rule 1 is deliberate, documented in reconcile.js and savings-math.js, and
   correct. It is also exactly what made rule 2 invisible: every module that
   correctly refused to filter on `excluded` was, by the same refusal, adding
   split parents to its totals. A R1,000 charge split 600/400 moved an implied
   balance by R2,000, and the Accounts page then offered to write that figure
   into the vault.

   So the parent carries a role of its own rather than leaning on `excluded`,
   and the two meanings stop sharing a column.

   Pure, and deliberately tiny: reconcile.js, savings-math.js and the views all
   need the same answer, and three copies of `r.split === 'parent'` is how the
   next consumer gets written without one. */

/* The row the bank actually printed. Kept rather than deleted — it holds the
   importer's `date|desc|amount|label` dedup key, so deleting it would let a
   re-import of the same statement re-add the line on top of its own parts. */
const SPLIT_PARENT = 'parent';

/* One slice of a parent, carrying its own category. Marked so the parts can be
   grouped under the parent, and so an unsplit knows exactly what to remove
   rather than guessing from matching dates and descriptions. */
const SPLIT_PART = 'part';

/* Read the Split cell off disk. Anything that is not one of the two known
   roles becomes '' — a hand-typed word in that column is a note to a human,
   never a role that changes the arithmetic. Absent on every file written
   before this column existed, which is the same as empty. */
function splitRole(cell) {
  const v = String(cell == null ? '' : cell).trim().toLowerCase();
  return v === SPLIT_PARENT || v === SPLIT_PART ? v : '';
}

/* Is this row's money already described by other rows in the same file?

   The one question every reader of raw rows must ask before totalling. Callers
   that filter on `!excluded` (period totals, budget-vs-actual) are already
   safe — a parent is always excluded too — so this is for the readers that
   deliberately do NOT filter on it.

   BOTH columns, deliberately: this NARROWS the excluded set, it never reaches
   outside it. Two reasons, and the first is the one that bites.

   A split is documented as reversible by hand — "untick Excluded, delete the
   parts" — and thousands of these rows sit in markdown files the reader is
   invited to edit. Keyed on the role alone, that reversal leaves a row the
   budget counts and reconciliation skips: money visible on one page and gone
   from another, with nothing on screen to explain it. Unticking Excluded is
   the reader saying "this row is real again", and it has to mean that
   everywhere.

   The second is an invariant worth having on its own: no reader can ever skip
   a row that the period totals are counting. Whatever else goes wrong, the
   two halves of the app cannot disagree about whether a row exists. */
function supersededBySplit(row) {
  return !!row && !!row.excluded && splitRole(row.split) === SPLIT_PARENT;
}

/* Was this row created by a split rather than read off a statement?

   The mirror question, and the one to ask when what matters is not "how much
   money" but "what did the bank actually print". A part is a category the
   reader drew inside a charge; it is not a line any statement ever carried, so
   anything reasoning about statements — the importer's duplicate index, the
   recurring-charge detector — must see the parent and not the parts. */
function isSplitPart(row) {
  return !!row && splitRole(row.split) === SPLIT_PART;
}

/* Turn one row and an agreed set of parts into the rows a split leaves behind.

   Lives here, and pure, because this is where the two roles are ASSIGNED — and
   an assignment that happens inside a view function, behind a modal, is one no
   guard test can reach. Everything the double-count fix depends on is decided
   in these few lines, so they are the ones worth pinning.

   Mutates the parent deliberately: the caller holds the row that is already in
   the file's `rows` array, and returning a copy would leave the original on
   disk unexcluded and unmarked. Returns the new part rows for the caller to
   append.

   `parts` are [{ amount, cat, note }] as SplitModal resolves them — already
   signed like the parent and already summing to it exactly; this does no
   arithmetic and deliberately re-checks none, because the modal is the gate
   and a second, subtly different rule here is how the two drift apart. */
function applySplit(parent, parts, marker) {
  /* A row that already carries a role is already described by other rows in
     this file, so splitting it again would describe the same money a third
     time. Refused HERE and not only in the view, because the role is assigned
     here — and because the parent role used to be written unconditionally,
     which turned a PART into a parent and stopped it being a part. Every reader
     that skips parts (cardSpend, the service and debt histories, the importer's
     duplicate index) then counted it as a line the bank had printed.

     Null rather than a throw: the caller is a click handler, and "nothing
     happened" with a toast beside it is the honest outcome for a button that
     should not have been offered. */
  if (splitRole(parent && parent.split)) return null;
  /* No amountRaw on a part, deliberately. It is the loader's "I could not
     strictly parse this cell, write it back verbatim" flag, and the serializer
     prefers it over the number — so a part inheriting the parent's would write
     the parent's whole amount to disk under its own category. The parent keeps
     its own, being unchanged on disk apart from the two columns set below. */
  const rows = parts.map(p => ({
    date: parent.date, desc: parent.desc, cat: p.cat, amount: p.amount,
    excluded: false, note: p.note, split: SPLIT_PART,
  }));
  /* Both, always. `excluded` is what the budget totals read and the role is
     what the account totals read — and supersededBySplit requires both, so a
     parent that loses its Excluded tick becomes an ordinary row everywhere at
     once rather than in half the app. */
  parent.excluded = true;
  parent.split = SPLIT_PARENT;
  if (marker) parent.note = parent.note ? `${parent.note} · ${marker}` : marker;
  return rows;
}

/* What a parent's parts no longer account for.

   Zero on a healthy split, and it has to be: applySplit takes the modal at its
   word — "already summing to it exactly; this does no arithmetic and
   deliberately re-checks none, because the modal is the gate" — and that gate
   weighs the values it is about to WRITE (tests/split-transaction.test.cjs,
   section 4b). So anything non-zero here means rows have LEFT since.

   That is one specific thing, and it is worth naming. Delete a single part and
   the parent stays excluded AND marked, so it stays superseded — and the money
   that part carried then falls into no total whatsoever. Not the budget's,
   which never counted the parent. Not the account's, which skips it. No row is
   missing from the file and no file is corrupt; a figure is simply gone from
   the app, silently, on a delete whose own dialog warns about it in words and
   could not put a number on it. This is that number.

   Pure, and here rather than in the view for the reason this module exists at
   all: the sum that decides whether a split still adds up belongs beside the
   predicate that decides whether it counts — not inside a render function,
   where no guard test can reach it and a second, subtly different rule grows.

   In CENTS, deliberately. -1200 less -800 less -400 is 0 exactly, but
   -1240.85 less -800 less -440.85 is -2.27e-13 in binary floating point, and a
   chip announcing "R0.00 unaccounted" over a split that is exactly right would
   be worse than no chip: it teaches the reader to ignore the one warning that
   cell exists to give. Same rounding rule the modal's own remainder() applies,
   so the two can never disagree about what "balanced" means.

   Signed like the parent, leaving the caller to decide whether a direction is
   worth printing; 0 when there is nothing to report, so that
   `if (splitShortfall(...))` reads as the question it is. */
function splitShortfall(parent, parts) {
  if (!parent) return 0;
  const cents = v => Math.round((Number(v) || 0) * 100);
  const taken = (parts || []).reduce((sum, p) => sum + cents(p && p.amount), 0);
  return (cents(parent.amount) - taken) / 100;
}

module.exports = {
  SPLIT_PARENT, SPLIT_PART, splitRole, supersededBySplit, isSplitPart, applySplit, splitShortfall,
};
