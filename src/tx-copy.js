'use strict';
/* Copying a transaction into the Add dialog (issue #188) -- the pure rules.

   A repeat entry (the same shop, the same cash payment) is one tap and a date
   change instead of retyping, which matters most to the people who type their
   entries in rather than import statements. The Copy action hands the Add
   dialog a DRAFT built from the row; this is the part that decides what is in
   it, kept out of the view so a guard test can run it in bare node. Nothing is
   written here or by the action: the row exists only when the dialog is
   confirmed, so cancelling leaves no trace.

   What a copy is, decided with the issue (2026-11-28):

     - Today's date. A copy is nearly always a new occurrence, and the original
       row's date would have filed it back in the month it came from. `today` is
       injected, like every date in the pure modules.
     - Everything the dialog asks for: account, description, category,
       subcategory, amount, direction and note.
     - NOT excluded. Excluded is the reader's veto of one row from the totals; a
       new entry has not been vetoed, and the dialog has no such field.
     - NOT a split. A part copies as an ordinary row under its own category and
       slice amount; the copy is a fresh line, not one more slice of a charge it
       does not belong to. A split PARENT is not copied at all: it is the line
       the bank printed, parked excluded because its parts describe the same
       money (src/tx-role.js), and a copy of it would be a second charge of the
       whole amount sitting in no split.

   Pure: no DOM, no Obsidian, no clock. */

const { splitRole, SPLIT_PARENT } = require('./tx-role');
const { subcategoryOf } = require('./subcategories');

const isRow = row => !!row && typeof row === 'object';

/* Is this row offered the Copy action. A parent is recognised by its ROLE cell
   alone, not by supersededBySplit(): that one also needs the Excluded tick, on
   purpose, so it can only narrow the excluded set. Here the question is the
   opposite one -- what the reader sees. The Transactions page draws the parent
   chip wherever the role says parent, ticked or not, so a hand-reversed parent
   is still the row the chip is on and is not copied. */
function canCopyRow(row) {
  return isRow(row) && splitRole(row.split) !== SPLIT_PARENT;
}

/* The magnitude as the text the dialog's amount field holds. The dialog types
   magnitudes and applies the direction on the way out (the same idiom as the
   split dialog), so the sign lives in `dir`. Not toFixed(): a three-decimal
   stored amount (a fuel slip, -912.345) is shown as stored, and the dialog
   rounds it as it rounds anything typed. Empty for zero or unreadable, so the
   dialog's own check asks for an amount rather than the copy making one up. */
function magnitudeText(amount) {
  const n = Math.abs(Number(amount));
  return Number.isFinite(n) && n !== 0 ? String(n) : '';
}

/* The draft for Add transaction, or null when the row is not copyable.

   Exactly the keys the dialog reads (views/transactions.js, addTransaction's
   `kept()`), and `subcategory` only when the row carries one -- read through
   subcategoryOf, the one door, so a row with no category has none (ADR-0010
   section 1) and a padded name arrives trimmed. `label` is the account the row
   sits in, which the caller knows and the raw row does not carry. */
function copyDraft(row, label, today) {
  if (!canCopyRow(row)) return null;
  const draft = {
    date: today,
    desc: row.desc == null ? '' : String(row.desc),
    label,
    dir: Number(row.amount) > 0 ? 'in' : 'out',
    amount: magnitudeText(row.amount),
    cat: row.cat == null ? '' : String(row.cat),
    note: row.note == null ? '' : String(row.note),
  };
  const sub = subcategoryOf(row);
  if (sub) draft.subcategory = sub;
  return draft;
}

module.exports = { canCopyRow, copyDraft };
