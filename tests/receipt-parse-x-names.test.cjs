'use strict';
/* An item name ending in "x" (receipt-parse.js parseGeneric).

   A line ending in @, x or × was skipped as "a quantity waiting for its
   price", so any product whose name ends in the letter x ("Cake Mix", "Box",
   "Ajax", "Kleenex") vanished from a split-column slip, and the price that
   followed it overwrote the item above. Only a trailing @/x/× that follows a
   NUMBER (optionally with a unit) is a quantity line: "2 x", "3x",
   "0.456 kg @", "2 ×" — never the last letter of a word.

   Synthetic slips.   node tests/receipt-parse-x-names.test.cjs */

const assert = require('assert');
const { parseReceiptText } = require('../src/receipt-parse');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const slip = (...lines) => parseReceiptText(['Sample Shop', '2026-02-14', 'TAX INVOICE', ...lines].join('\n'));
const rows = r => r.items.map(i => [i.name, i.amount]);

{
  const r = slip('Bread', '15.00', 'Cake Mix', '25.00', 'Milk', '20.00', 'TOTAL 60.00');
  eq(rows(r), [['Bread', 15], ['Cake Mix', 25], ['Milk', 20]], 'a name ending in x is an item, and each price stays with its own item');
  eq(r.problems, [], 'and the slip adds up');
}
for (const name of ['Box', 'Ajax', 'Kleenex', 'Mix']) {
  const r = slip('Bread', '15.00', name, '25.00', 'TOTAL 40.00');
  eq(rows(r), [['Bread', 15], [name, 25]], `${name} survives as an item`);
}
{
  const r = slip('Apples', '2 x', '9.99', 'TOTAL 9.99');
  eq(rows(r), [['Apples', 9.99]], 'a quantity line still hands its price to the item above');
}
/* The quantity forms that must stay quantity lines. */
for (const q of ['2 x', '3x', '2 ×', '0.456 kg @', '0.456kg @', '2 @', '12 x', '1,5 kg @', '500 g @']) {
  const r = slip('Item', q, '9.99', 'TOTAL 9.99');
  eq(rows(r), [['Item', 9.99]], `"${q}" is a quantity line, not a product`);
}
/* The same slip with the quantity and price on one line is untouched. */
eq(rows(slip('Bananas 0.456 kg @ R19.99/kg 9.12', 'Milk 20.00', 'TOTAL 29.12')), [['Bananas 0.456 kg @ R19.99/kg', 9.12], ['Milk', 20]],
  'one-line quantity unchanged');
eq(rows(slip('Max 25.00', 'TOTAL 25.00')), [['Max', 25]], 'a one-line product ending in x is as before');

console.log(`PASS receipt-parse-x-names: ${checks} checks`);
