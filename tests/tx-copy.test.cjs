'use strict';
/* Copying a transaction into the Add dialog: the pure rules (issue #188).

   CONTRACT (src/tx-copy.js).

     canCopyRow(row) -> boolean
       true for an ordinary row and for a split PART; false for a split PARENT
       (decided by its role cell alone, so a parent whose Excluded tick was
       taken off by hand is still a parent) and for anything that is not a row.
       Never throws.

     copyDraft(row, label, today) -> draft | null
       null when canCopyRow is false. Otherwise exactly the keys the Add
       dialog's draft reads, and nothing else:
         date         `today`, never the row's own (a copy is a new occurrence)
         desc, note   as the row has them
         label        the account the row sits in, as handed in
         cat          the row's category, '' for none
         subcategory  only when the row carries one (subcategoryOf), so a row
                      with no category, or none, has no key at all
         dir, amount  'out' / 'in' by the row's sign, and the magnitude as text:
                      the dialog types magnitudes and applies the direction
       A zero or unreadable amount gives dir 'out' and an empty amount, so the
       dialog's own check asks for one rather than the copy inventing it.
       Not carried, by decision: Excluded (the copy counts) and the Split role
       (a part copies as an ordinary row). The row is never touched.

   Every expectation is a literal.
     node tests/tx-copy.test.cjs */

const assert = require('assert');
const { canCopyRow, copyDraft } = require('../src/tx-copy');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-11-28';
const FUEL = { date: '2026-08-14', desc: 'Engen Rivonia', cat: 'Car', amount: -512.4, excluded: false, note: 'monthly fill', split: '', subcategory: 'Fuel' };

/* ---- an ordinary spend: every field, and today's date --------------------- */
eq(copyDraft(FUEL, 'Cheque', TODAY),
  { date: '2026-11-28', desc: 'Engen Rivonia', label: 'Cheque', dir: 'out', amount: '512.4', cat: 'Car', subcategory: 'Fuel', note: 'monthly fill' },
  'account, description, category, subcategory, amount, direction and note, on today\'s date');
ok(copyDraft(FUEL, 'Cheque', TODAY).date !== FUEL.date, 'the date is not the original row\'s');
eq(copyDraft(FUEL, 'Cheque', '2027-01-05').date, '2027-01-05', 'it is whatever "today" it is handed, never read off the clock');

/* ---- income ------------------------------------------------------------------ */
eq(copyDraft({ date: '2026-08-25', desc: 'Salary', cat: 'Income', amount: 20000, note: '' }, 'Cheque', TODAY),
  { date: TODAY, desc: 'Salary', label: 'Cheque', dir: 'in', amount: '20000', cat: 'Income', note: '' },
  'a positive amount is direction in, as a magnitude; a row with no subcategory has no subcategory key');

/* ---- what is not carried ------------------------------------------------------- */
{
  const excluded = { ...FUEL, excluded: true };
  const d = copyDraft(excluded, 'Cheque', TODAY);
  ok(!('excluded' in d), 'an excluded row\'s copy has no excluded flag, so it starts counted');
  eq(Object.keys(d).sort(), ['amount', 'cat', 'date', 'desc', 'dir', 'label', 'note', 'subcategory'], 'and only the keys the Add dialog reads');
}

/* ---- split rows ---------------------------------------------------------------- */
{
  const part = { date: '2026-08-14', desc: 'Checkers', cat: 'Home', amount: -200, excluded: false, note: 'kettle', split: 'part', subcategory: 'Kitchen' };
  ok(canCopyRow(part), 'a split part can be copied');
  const d = copyDraft(part, 'Cheque', TODAY);
  eq(d, { date: TODAY, desc: 'Checkers', label: 'Cheque', dir: 'out', amount: '200', cat: 'Home', subcategory: 'Kitchen', note: 'kettle' },
    'a part copies as an ordinary row: its own category, subcategory and slice amount');
  ok(!('split' in d), 'with no split role');

  const parent = { date: '2026-08-14', desc: 'Checkers', cat: 'Home', amount: -300, excluded: true, note: 'Split into 2', split: 'parent' };
  ok(!canCopyRow(parent), 'a split parent is not offered the action');
  eq(copyDraft(parent, 'Cheque', TODAY), null, 'and has no draft');
  ok(!canCopyRow({ ...parent, excluded: false }), 'a parent whose Excluded tick was taken off by hand is still a parent');
  ok(!canCopyRow({ ...parent, split: ' Parent ' }), 'the role is read the way the loader reads it (case and padding)');
  ok(canCopyRow({ ...FUEL, split: 'maybe' }), 'a word in the Split column that is no role is a note to a human, not a parent');
}

/* ---- the subcategory is read through the one door -------------------------------- */
{
  ok(!('subcategory' in copyDraft({ ...FUEL, cat: '' }, 'Cheque', TODAY)), 'a row with no category has no subcategory to carry (ADR-0010 section 1)');
  eq(copyDraft({ ...FUEL, subcategory: '  Fuel  ' }, 'Cheque', TODAY).subcategory, 'Fuel', 'a padded one is trimmed');
  ok(!('subcategory' in copyDraft({ ...FUEL, subcategory: '   ' }, 'Cheque', TODAY)), 'a blank one is none');
  ok(!('subcategory' in copyDraft({ ...FUEL, subcategory: undefined }, 'Cheque', TODAY)), 'an absent one is none');
}

/* ---- amounts the dialog will have to ask about ------------------------------------ */
eq([copyDraft({ ...FUEL, amount: 0 }, 'Cheque', TODAY).dir, copyDraft({ ...FUEL, amount: 0 }, 'Cheque', TODAY).amount], ['out', ''], 'a zero amount is left empty for the dialog to ask for');
eq(copyDraft({ ...FUEL, amount: NaN }, 'Cheque', TODAY).amount, '', 'an unreadable one likewise');
eq(copyDraft({ ...FUEL, amount: undefined }, 'Cheque', TODAY).amount, '', 'and a missing one');
eq(copyDraft({ ...FUEL, amount: -912.345 }, 'Cheque', TODAY).amount, '912.345', 'a three-decimal amount is shown as stored; the dialog rounds it as it does every typed entry');
eq(copyDraft({ ...FUEL, amount: -0.1 }, 'Cheque', TODAY).amount, '0.1', 'a small one has no exponent or float noise');

/* ---- text fields -------------------------------------------------------------------- */
eq(copyDraft({ date: '2026-08-14', amount: -5 }, 'Cheque', TODAY),
  { date: TODAY, desc: '', label: 'Cheque', dir: 'out', amount: '5', cat: '', note: '' },
  'a row with no description, category or note copies empty strings, not "undefined"');

/* ---- never throws, never touches the row --------------------------------------------- */
for (const bad of [null, undefined, 0, '', 'row', 42]) {
  ok(canCopyRow(bad) === false, `canCopyRow(${JSON.stringify(bad)}) is false`);
  eq(copyDraft(bad, 'Cheque', TODAY), null, `copyDraft(${JSON.stringify(bad)}) is null`);
}
{
  const before = JSON.stringify(FUEL);
  const frozen = Object.freeze({ ...FUEL });
  copyDraft(frozen, 'Cheque', TODAY);
  eq(JSON.stringify(FUEL), before, 'the row is left exactly as it was');
  const d1 = copyDraft(FUEL, 'Cheque', TODAY), d2 = copyDraft(FUEL, 'Cheque', TODAY);
  ok(d1 !== d2, 'each call returns a fresh draft: a caller that edits one cannot reach the next');
}

console.log(`PASS tx-copy — a copy is the row on today's date, a split parent has none (${checks} checks)`);
