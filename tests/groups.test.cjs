'use strict';
/* Custom category groups (src/groups.js): the Settings.md `groups` and
   `nonessential_groups` lines, the order they produce, and the emergency
   maths they feed. Pure functions — no DOM, no obsidian. */
const assert = require('node:assert/strict');
const path = require('node:path');
const SRC = path.join(__dirname, '..', 'src');
const { parseGroups, parseNonEssential, typeOrder, typeRank, normaliseKey } = require(path.join(SRC, 'groups.js'));
const { TYPE_ORDER } = require(path.join(SRC, 'constants.js'));
const { essentialTotal } = require(path.join(SRC, 'health-math.js'));
const { serializeBudgetFile } = require(path.join(SRC, 'budget-file.js'));

let n = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++; };

/* ---- 1. parsing: keys are normalised, deduped, and never shadow a built-in ---- */
eq(parseGroups(''), [], 'blank line → no custom groups');
eq(parseGroups(undefined), [], 'absent key → no custom groups');
eq(parseGroups('property, treats'), ['property', 'treats'], 'plain comma list');
eq(parseGroups('Kids School, treats, TREATS'), ['kids-school', 'treats'], 'lower-cased, spaces folded to -, duplicates dropped');
eq(parseGroups('["property", "treats"]'), ['property', 'treats'], 'a YAML flow list arriving as text parses the same');
eq(parseGroups(['property', 'treats']), ['property', 'treats'], 'a real array (metadataCache) parses the same');
eq(parseGroups('housing, expense, property'), ['property'], 'built-in names are dropped, not duplicated');
eq(parseGroups(' , ,'), [], 'only separators → nothing');
eq(normaliseKey('  Héllo World! '), 'h-llo-world', 'non-ascii and punctuation become one dash, edges trimmed');

/* ---- 2. order: customs sit before expense; unknown types sort last ---- */
{
  const order = typeOrder(['property', 'treats']);
  const iExp = order.indexOf('expense');
  eq(order.slice(iExp - 2, iExp), ['property', 'treats'], 'custom groups spliced in, in written order, just before expense');
  eq(order.length, TYPE_ORDER.length + 2, 'nothing else added or lost');
  eq(typeOrder([]), TYPE_ORDER, 'no customs → the built-in order exactly');
  eq(typeOrder('property'), typeOrder(['property']), 'accepts the raw line too');
  assert.ok(typeRank('income', order) < typeRank('property', order), 'income still first'); n++;
  assert.ok(typeRank('nobody-declared', order) > typeRank('transfer', order), 'an undeclared type sorts AFTER transfer, not above income'); n++;
}

/* ---- 3. nonessential: validated against what exists; built-ins allowed ---- */
eq(parseNonEssential('treats, personal, ghost', ['treats']), ['treats', 'personal'], 'custom and built-in keys kept, unknown dropped');
eq(parseNonEssential('treats', []), [], 'a key naming no declared group is dropped');
eq(parseNonEssential('', ['treats']), [], 'blank → nothing extra');

/* ---- 4. the emergency divisor honours the list, and only ever shrinks ---- */
{
  const types = { Rent: 'housing', Coffee: 'treats', Hair: 'personal', TFSA: 'savings' };
  const typeOf = c => types[c] || null;
  const spend = { Rent: 9000, Coffee: 800, Hair: 400, TFSA: 2000 };
  eq(essentialTotal(spend, typeOf), 10200, 'without the list a custom group counts as essential (bills over treats)');
  eq(essentialTotal(spend, typeOf, ['treats']), 9400, 'a listed custom group drops out');
  eq(essentialTotal(spend, typeOf, new Set(['treats', 'personal'])), 9000, 'a Set works, and a built-in can be listed too');
  eq(essentialTotal(spend, typeOf, ['savings', 'housing-no']), 10200, 'listing an already-non-essential or unknown key changes nothing');
}

/* ---- 5. the period file is written in the vault's order ---- */
{
  const rows = [
    { category: 'Other', type: 'expense', amount: 1, notes: '' },
    { category: 'Flat', type: 'property', amount: 2, notes: '' },
    { category: 'Pay', type: 'income', amount: 3, notes: '' },
    { category: 'Mystery', type: 'zzz', amount: 4, notes: '' },
  ];
  const text = serializeBudgetFile({ period: '2026-08', rows, groups: ['property'] });
  const names = text.split('\n').filter(l => /^\| [A-Z]/.test(l) && !l.startsWith('| Category')).map(l => l.split('|')[1].trim());
  eq(names, ['Pay', 'Flat', 'Other', 'Mystery'], 'income, then the custom group, then expense, then the undeclared type last');
}

console.log(`groups.test.cjs — ${n} checks OK`);
