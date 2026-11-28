'use strict';
/* The pure half of "create a missing account, category or subcategory from the
   Add transaction dialog" (issue #189): what the dialog hands back when the
   reader picks a create entry, and what the draft is when Add reopens.

   Nothing here opens a dialog or touches a vault. The dialog's behaviour is in
   tests/field-create-entry.test.cjs and the page's flow in
   tests/transactions-add-create.test.cjs; this file pins the two rules they
   share, so the modal and the view cannot read them two ways:

     1. A pick is recognised by one marker on the resolved values, and removed
        before the values become a draft -- so it can never be carried into the
        next dialog or written to a row.
     2. After a create, only what the create decides changes: a new account is
        selected; a new category is selected and the subcategory typed under the
        OLD category is dropped (a subcategory belongs to one category); a new
        subcategory is selected. A create that did not land changes nothing.

     node tests/add-create.test.cjs */

const assert = require('assert');
const {
  CREATE_OPTION, CREATE_KEY, pickedCreate, typedValues, createdValue, draftAfterCreate,
} = require('../src/add-create');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TYPED = { date: '2026-11-28', desc: 'Coffee', label: 'Cheque', dir: 'in', amount: '12.50', cat: 'Car', subcategory: 'Fuel', note: 'with Sam' };

/* ---- 1. the marker ------------------------------------------------------- */
eq(typeof CREATE_OPTION, 'string', 'the entry has a value to carry');
ok(CREATE_OPTION.startsWith('__') && CREATE_OPTION.endsWith('__'), 'and it is a reserved-looking value, not an ordinary account or category name');
eq(pickedCreate({ ...TYPED }), null, 'values with no marker are an ordinary answer');
eq(pickedCreate({ ...TYPED, [CREATE_KEY]: 'label' }), 'label', 'the marker names the field whose entry was picked');
eq(pickedCreate({ ...TYPED, [CREATE_KEY]: 'cat' }), 'cat', 'any field');
eq(pickedCreate({ ...TYPED, [CREATE_KEY]: '' }), null, 'an empty marker is no pick');
eq(pickedCreate({ ...TYPED, [CREATE_KEY]: 7 }), null, 'a marker that is not a field key is no pick');
eq(pickedCreate(null), null, 'a cancelled dialog (null) is no pick');
eq(pickedCreate(undefined), null, 'nor is nothing');
eq(pickedCreate('label'), null, 'nor is a bare string');

const withMark = { ...TYPED, [CREATE_KEY]: 'cat' };
const stripped = typedValues(withMark);
eq(stripped, TYPED, 'typedValues is exactly what was typed, marker gone');
ok(!(CREATE_KEY in stripped), 'no trace of the marker remains');
ok(stripped !== withMark, 'a copy, not the dialog\'s own object');
const arr = typedValues({ list: ['a', 'b'], [CREATE_KEY]: 'x' });
eq(arr, { list: ['a', 'b'] }, 'array values survive');
const src = { toggles: ['a'] };
const copy = typedValues(src);
copy.toggles.push('b');
eq(src.toggles, ['a'], 'and an array is copied, so a draft cannot edit the dialog\'s values');
eq(typedValues(null), {}, 'nothing typed is an empty draft');

/* ---- what a creator hands back, as a value for the dropdown -------------- */
eq(createdValue('label', { name: 'Wallet', tx_label: '' }), 'Wallet', 'an account is selected by its name');
eq(createdValue('label', { name: 'Wallet', tx_label: 'Cash' }), 'Cash', 'or by its transaction label when it has one: Add\'s list is built from the label');
eq(createdValue('cat', { name: 'Coffee', type: 'expense' }), 'Coffee', 'a category by its name');
eq(createdValue('subcategory', 'Tolls'), 'Tolls', 'a subcategory is the name itself');
eq(createdValue('label', null), null, 'a cancelled or failed account create is no value');
eq(createdValue('cat', null), null, 'category');
eq(createdValue('subcategory', null), null, 'subcategory');
eq(createdValue('subcategory', ''), null, 'an empty name is no value');
eq(createdValue('label', {}), null, 'an account with no name is no value');
eq(createdValue('cat', { name: '' }), null, 'a category with no name is no value');
eq(createdValue('label', undefined), null, 'undefined');
eq(createdValue('nonsense', 'x'), null, 'a key the dialog does not have is no value');

/* ---- 2. the draft Add reopens with --------------------------------------- */
{
  const d = draftAfterCreate({ ...TYPED, [CREATE_KEY]: 'label' }, 'label', 'Wallet');
  eq(d, { ...TYPED, label: 'Wallet' }, 'a new account is selected and every other field is as typed');
  ok(!(CREATE_KEY in d), 'with no marker');
}
{
  const d = draftAfterCreate({ ...TYPED, [CREATE_KEY]: 'cat' }, 'cat', 'Coffee');
  eq(d, { ...TYPED, cat: 'Coffee', subcategory: '' }, 'a new category is selected and the subcategory typed under the old one is dropped');
}
{
  const d = draftAfterCreate({ ...TYPED, [CREATE_KEY]: 'subcategory' }, 'subcategory', 'Tolls');
  eq(d, { ...TYPED, subcategory: 'Tolls' }, 'a new subcategory is selected under the same category');
}
for (const key of ['label', 'cat', 'subcategory']) {
  const d = draftAfterCreate({ ...TYPED, [CREATE_KEY]: key }, key, null);
  eq(d, TYPED, `${key}: a create that did not land (cancelled, refused, failed) leaves the draft exactly as typed`);
}
eq(draftAfterCreate({ ...TYPED, [CREATE_KEY]: 'label' }, 'label', ''), TYPED, 'an empty result is the same as none');
eq(draftAfterCreate({ ...TYPED, [CREATE_KEY]: 'zzz' }, 'zzz', 'x'), TYPED, 'a key Add does not have changes nothing');
{
  const typed = { ...TYPED, desc: '', amount: '' };
  eq(draftAfterCreate({ ...typed, [CREATE_KEY]: 'cat' }, 'cat', 'Coffee'), { ...typed, cat: 'Coffee', subcategory: '' },
    'an unfinished form (blank description, no amount) is kept as it is: a create is not a submit and is not validated');
}
{
  const input = { ...TYPED, [CREATE_KEY]: 'label' };
  const before = JSON.stringify(input);
  draftAfterCreate(input, 'label', 'Wallet');
  eq(JSON.stringify(input), before, 'the values handed in are not edited');
}

console.log(`PASS add-create (${checks} checks)`);
