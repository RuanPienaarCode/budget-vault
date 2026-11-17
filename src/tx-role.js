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
  const taken = (parts || []).reduce((sum, p) => sum + amountCents(p && p.amount), 0);
  return (amountCents(parent.amount) - taken) / 100;
}

/* A stored amount in whole cents, SIGNED. The one rule for turning an amount
   the schema keeps to three decimals (a fuel slip: -912.345) into cents, shared
   by the chip's shortfall above and the split dialog's total (modal.js), so the
   total the dialog balances to is, to the cent, the total the chip checks the
   parts against.

   It has to be shared and not merely repeated, because the obvious second
   spelling is not the same rule. Math.round rounds a half toward +infinity:
   -912.345 -> -91234 but 912.345 -> 91235. The dialog works in magnitudes, and
   Math.abs() first then round gives 91235 for both — one cent off the chip on
   every negative parent that sits exactly on a half cent, and the dialog would
   then offer a total the chip reports as R0.01 unaccounted. So the dialog takes
   the magnitude of THIS (the signed rounding), never rounds the magnitude
   itself. */
function amountCents(v) {
  return Math.round((Number(v) || 0) * 100);
}

/* The parts belonging to one split parent, among the rows of ITS OWN file:
   split role `part`, with the parent's date and description — the same three
   facts applySplit copies onto a part. A part carries no id back to its parent,
   so that is the only join there is; this is the ONE lookup the Transactions
   page (chip, Un-split, Delete) and the importer's Undo all ask.

   Two cases, and the second exists because the first is not enough.

   1. No other split parent in the file shares the parent's date and
      description: every part with that date and description, wherever it sits
      in the file. Exactly the rule this had before twins were told apart.

   2. Another parent does share them (two identical charges on one day, both
      split): date and description cannot say whose parts are whose, so the
      parts are told apart by POSITION. The Transactions page splices a split's
      parts in directly under their parent (splitTransaction), and a Save
      keeps the rows in the order they are in (placeRows only places rows new
      to the file), so a parent's own parts are the contiguous run of `part`
      rows with its date and description that follows it in the file's row
      order — up to the first row that is not one.

   A twin parent with NO such run under it — a hand-reordered file — falls back
   to every part with that key, as in case 1, so no row is stranded. That
   answer is a guess and says nothing about whose parts they are:
   splitPartsAmbiguous is how a caller finds out, to say so before it removes
   anything. A parent that is not among `rows` has no position, so it falls back
   the same way. */
function partsOfKey(rows, parent) {
  return rows.filter(x => x !== parent && splitRole(x && x.split) === SPLIT_PART
    && x.date === parent.date && x.desc === parent.desc);
}
function resolveSplitParts(rows, parent) {
  rows = rows || [];
  const all = partsOfKey(rows, parent);
  if (!splitParentsSharingKey(rows, parent).length) return { parts: all, ambiguous: false };
  const at = rows.indexOf(parent);
  const run = [];
  if (at >= 0) {
    for (let i = at + 1; i < rows.length; i++) {
      const x = rows[i];
      if (!(splitRole(x && x.split) === SPLIT_PART && x.date === parent.date && x.desc === parent.desc)) break;
      run.push(x);
    }
  }
  return run.length ? { parts: run, ambiguous: false } : { parts: all, ambiguous: true };
}
function splitPartsOf(rows, parent) {
  return resolveSplitParts(rows, parent).parts;
}

/* True when splitPartsOf had to fall back to every part with the parent's key
   because another identical split shares it and no run of parts sits under this
   parent: the count it returned may include the other split's parts. False on
   every unambiguous split, including a twin told apart by position. */
function splitPartsAmbiguous(rows, parent) {
  return resolveSplitParts(rows, parent).ambiguous;
}

/* The OTHER split parents in `rows` that share this parent's date and
   description — the rows whose parts date + description alone cannot tell apart
   from this one's. Empty on any unambiguous split. By role alone, like the
   page's own lookup: a parent whose Excluded tick was removed by hand still owns
   parts. */
function splitParentsSharingKey(rows, parent) {
  return (rows || []).filter(x => x !== parent && splitRole(x && x.split) === SPLIT_PARENT
    && x.date === parent.date && x.desc === parent.desc);
}

module.exports = {
  SPLIT_PARENT, SPLIT_PART, splitRole, supersededBySplit, isSplitPart, applySplit, splitShortfall,
  splitPartsOf, splitPartsAmbiguous, splitParentsSharingKey, amountCents,
};
