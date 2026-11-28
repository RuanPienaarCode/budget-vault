'use strict';
/* The pure half of subcategories (ADR-0010, issue #184): the list on a
   category note, a name found on a row, the rule that a row's category and its
   subcategory travel together, and what a filter and the "used yet?" test say.

   Every expectation below is a literal, not a recomputation of what the module
   does, so the module cannot agree with itself and be wrong.

     node tests/subcategories.test.cjs */

const assert = require('assert');
const {
  parseSubcategories, formatSubcategories, checkSubcategoryName, subcategoryOf,
  setRowCategory, inUseByCategory, offeredNames, bookUsesSubcategories,
  matchesSubcategory, NO_SUBCATEGORY,
} = require('../src/subcategories');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. the list on the category note ---------------------------------- */
eq(parseSubcategories('Fuel, Services, Tolls'), ['Fuel', 'Services', 'Tolls'], 'comma separated, in the order written');
eq(parseSubcategories('  Fuel ,Services  ,  Tolls  '), ['Fuel', 'Services', 'Tolls'], 'whitespace around a name is not part of it');
eq(parseSubcategories('"Fuel, Services"'), ['Fuel', 'Services'], 'a quoted scalar (what the writer produces) is read through its quotes');
eq(parseSubcategories('[Fuel, Services]'), ['Fuel', 'Services'], 'the bracketed form load.js hands back for a YAML block list');
eq(parseSubcategories(['Fuel', ' Services ', '']), ['Fuel', 'Services'], 'a real array, as metadataCache would give it');
eq(parseSubcategories('"Fuel", \'Services\''), ['Fuel', 'Services'], 'items keep the quotes they were written with in a block list; they are not part of the name');
eq(parseSubcategories('Fuel, Fuel, Services'), ['Fuel', 'Services'], 'an exact repeat is the same name');
eq(parseSubcategories('Fuel, fuel'), ['Fuel', 'fuel'], 'exact text: case makes a different name, as it does for categories');
eq(parseSubcategories('Fuel,, ,Tolls,'), ['Fuel', 'Tolls'], 'empty entries are not names');
eq(parseSubcategories(''), [], 'blank is no names');
eq(parseSubcategories(undefined), [], 'absent is no names');
eq(parseSubcategories(null), [], 'null is no names');
eq(parseSubcategories(42), ['42'], 'a number a YAML parser handed over is still text');
eq(parseSubcategories('Tolls: N1, Café ☕'), ['Tolls: N1', 'Café ☕'], 'punctuation and non-ASCII are kept');

eq(formatSubcategories(['Fuel', 'Services']), 'Fuel, Services', 'written back the way it is read');
eq(parseSubcategories(formatSubcategories(['A b', 'C'])), ['A b', 'C'], 'format then parse is the identity for a comma-free list');
eq(formatSubcategories([]), '', 'no names is an empty string, which the writer turns into removing the key');

/* ---- 2. a name typed by the reader ------------------------------------- */
eq(checkSubcategoryName('  Fuel ', []), { name: 'Fuel' }, 'a name is trimmed');
eq(checkSubcategoryName('   ', []), { error: 'empty' }, 'blank is refused');
eq(checkSubcategoryName('', []), { error: 'empty' }, 'empty is refused');
eq(checkSubcategoryName('Fuel, Tolls', []), { error: 'comma' }, 'a comma would be read back as two names');
eq(checkSubcategoryName('Fuel', ['Fuel']), { error: 'duplicate' }, 'a name already on the list is refused');
eq(checkSubcategoryName('fuel', ['Fuel']), { name: 'fuel' }, 'exact text: a different case is a different name');
eq(checkSubcategoryName(undefined, []), { error: 'empty' }, 'nothing typed is empty, not a throw');

/* ---- 3. a row has a subcategory only through its category -------------- */
eq(subcategoryOf({ cat: 'Car', subcategory: 'Fuel' }), 'Fuel', 'the label on a categorised row');
eq(subcategoryOf({ cat: 'Car' }), '', 'a row that never had one');
eq(subcategoryOf({ cat: '', subcategory: 'Fuel' }), '', 'a row with no category cannot have one, even if a hand edit left the cell filled');
eq(subcategoryOf({ cat: 'Car', subcategory: '  ' }), '', 'whitespace is none');
eq(subcategoryOf(null), '', 'no row, no subcategory');

{
  const r = { cat: 'Car', subcategory: 'Fuel', amount: -10 };
  eq(setRowCategory(r, 'Home'), true, 'changing the category reports a change');
  eq(r, { cat: 'Home', amount: -10 }, 'and clears the subcategory entirely: the key is gone, not blank');
}
{
  const r = { cat: 'Car', subcategory: 'Fuel' };
  eq(setRowCategory(r, 'Car'), false, 'setting the category it already has is not a change');
  eq(r, { cat: 'Car', subcategory: 'Fuel' }, 'so the subcategory stays');
}
{
  const r = { cat: 'Car', subcategory: 'Fuel' };
  eq(setRowCategory(r, ''), true, 'removing the category is a change');
  eq(r, { cat: '' }, 'and a row with no category has no subcategory');
}
{
  const r = { cat: '' };
  eq(setRowCategory(r, 'Car', 'Fuel'), true, 'an action that sets both (a categorisation rule) is honoured');
  eq(r, { cat: 'Car', subcategory: 'Fuel' }, 'category and subcategory land together');
}
{
  const r = { cat: 'Car', subcategory: 'Fuel' };
  setRowCategory(r, 'Home', 'Fuel');
  eq(r, { cat: 'Home', subcategory: 'Fuel' }, 'a subcategory the same action sets is kept, even one the old category also had');
}
{
  const r = { cat: 'Car', subcategory: 'Fuel' };
  setRowCategory(r, '', 'Fuel');
  eq(r, { cat: '' }, 'a subcategory offered with no category is dropped: it would belong to nothing');
}
{
  const r = { cat: 'Car' };
  setRowCategory(r, 'Home');
  ok(!('subcategory' in r), 'clearing a row that had none does not mint an empty key');
}

/* ---- 4. names in use, and what a dropdown offers ----------------------- */
{
  const rows = [
    { cat: 'Car', subcategory: 'Tolls' }, { cat: 'Car', subcategory: 'Fuel' }, { cat: 'Car', subcategory: 'Tolls' },
    { cat: 'Home', subcategory: 'Tolls' }, { cat: 'Car' }, { cat: '', subcategory: 'Orphan' },
    { cat: 'Car', subcategory: '  ' },
  ];
  const used = inUseByCategory(rows);
  eq([...used.keys()].sort(), ['Car', 'Home'], 'only categorised rows with a name count');
  eq(used.get('Car'), ['Fuel', 'Tolls'], 'distinct, sorted');
  eq(used.get('Home'), ['Tolls'], 'a name shared by two categories belongs to each separately');
  eq(inUseByCategory([]).size, 0, 'no rows, nothing in use');

  eq(offeredNames(['Services', 'Fuel'], ['Fuel', 'Tolls']), ['Services', 'Fuel', 'Tolls'], 'listed names first in written order, then the unlisted ones in use');
  eq(offeredNames([], ['Tolls', 'Fuel']), ['Tolls', 'Fuel'], 'a category with nothing listed still offers what its rows use');
  eq(offeredNames(['A'], []), ['A'], 'nothing in use adds nothing');
  eq(offeredNames(undefined, undefined), [], 'nothing at all offers nothing');
}

/* ---- 5. out of sight until used ---------------------------------------- */
{
  const cats = [{ name: 'Car' }, { name: 'Home', subcategories: [] }];
  eq(bookUsesSubcategories(cats, [{ cat: 'Car' }, { cat: 'Home', subcategory: '' }]), false, 'no list and no row: the book does not use them');
  eq(bookUsesSubcategories([{ name: 'Car', subcategories: ['Fuel'] }], []), true, 'a name on a category note is enough');
  eq(bookUsesSubcategories(cats, [{ cat: 'Car', subcategory: 'Fuel' }]), true, 'a name on a row is enough');
  eq(bookUsesSubcategories(cats, [{ cat: '', subcategory: 'Fuel' }]), false, 'a hand-edited cell on an uncategorised row is not use');
  eq(bookUsesSubcategories(undefined, undefined), false, 'nothing loaded is not use');
}

/* ---- 6. the filter ----------------------------------------------------- */
{
  const fuel = { cat: 'Car', subcategory: 'Fuel' }, plain = { cat: 'Car' }, none = { cat: '' };
  eq([fuel, plain, none].map(r => matchesSubcategory(r, '')), [true, true, true], 'no filter keeps every row');
  eq([fuel, plain, none].map(r => matchesSubcategory(r, 'Fuel')), [true, false, false], 'a name keeps the rows that carry it');
  eq([fuel, plain, none].map(r => matchesSubcategory(r, NO_SUBCATEGORY)), [false, true, true], '"No subcategory" keeps every row without one');
  eq([fuel].map(r => matchesSubcategory(r, 'fuel')), [false], 'exact text');
  eq(matchesSubcategory({ cat: '', subcategory: 'Fuel' }, 'Fuel'), false, 'a hand-edited cell on an uncategorised row is not a subcategory');
  ok(typeof NO_SUBCATEGORY === 'string' && NO_SUBCATEGORY !== '' && NO_SUBCATEGORY !== 'Fuel', 'the sentinel cannot be a name or blank');
}

console.log(`subcategories.test.cjs — ${checks} checks OK`);
