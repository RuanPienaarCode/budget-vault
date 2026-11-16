'use strict';
/* A pack size followed by a price on a typed item line (receipt-parse.js
   moneyTail, the generic parser).

   "Eggs 30 120.00" was read as R30 120.00 = 30120.00, because a space between
   digit groups counted as a thousands separator. On an item line a space
   groups digits only when a currency symbol directly precedes the number
   (R1 234.56, R 1 234.56); without one the last number is the price and what
   precedes it stays in the name. A comma separator keeps working either way,
   and the TOTAL line keeps its old reading. A line that is only a figure (a
   price column Live Text put on its own line) has no name to keep a pack size
   in, so it is still read as grouped.

   Synthetic slips.   node tests/receipt-parse-pack-size.test.cjs */

const assert = require('assert');
const { parseReceiptText } = require('../src/receipt-parse');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const slip = (...lines) => parseReceiptText(['Sample Farm Stall', '2026-02-14', 'TAX INVOICE', ...lines].join('\n'));
const one = line => { const r = slip(line); return r.items.map(i => [i.name, i.amount]); };

eq(one('Eggs 30 120.00'), [['Eggs 30', 120]], 'a pack size before a price is part of the name');
eq(one('Eggs 18 75'), [['Eggs 18', 75]], "the modal's own taught example is unchanged");
eq(one('Honey 89.90'), [['Honey', 89.9]], 'a plain price is unchanged');
eq(one('TV R1 234.56'), [['TV', 1234.56]], 'a space group after R is thousands');
eq(one('TV R 1 234.56'), [['TV', 1234.56]], '... with a space after the R too');
eq(one('TV 1,234.56'), [['TV', 1234.56]], 'a comma group is thousands with no symbol');
eq(one('TV R1,234.56'), [['TV', 1234.56]], '... and with one');
eq(one('Eggs 30 120,00'), [['Eggs 30', 120]], 'a decimal comma after a pack size');
eq(one('Eggs 30 R120.00'), [['Eggs 30', 120]], 'a symbol on the price only');
eq(one('Fridge R12 345.00'), [['Fridge', 12345]], 'bigger thousands with a symbol');
/* A price never starts with a nought, so a last group that does is the tail of
   a grouped figure even with no symbol. Read strictly, "TV 5 000" was "TV 5"
   at R0 and the line was dropped. */
eq(one('TV 5 000'), [['TV', 5000]], 'a whole-rand thousand with no symbol is not a pack size and R0');
eq(one('TV 1 034.56'), [['TV', 1034.56]], 'nor is a group that starts with a nought, with cents');
eq(one('Eggs 30 120'), [['Eggs 30', 120]], 'a pack size before a whole-rand price is still part of the name');

/* The whole slip adds up, so no sum-mismatch is raised for the pack size. */
{
  const r = slip('Eggs 30 120.00', 'Honey 89.90', 'Total 209.90');
  eq(r.items.map(i => i.amount), [120, 89.9], 'both items');
  eq(r.problems, [], 'and the slip adds up to its total');
}
/* TOTAL lines keep their reading: a grouped total is still read grouped. */
{
  const r = slip('TV R1 234.56', 'Total 1 234.56');
  eq([r.total, r.problems], [1234.56, []], 'a space-grouped total line is unchanged');
  const r2 = slip('TV 1 234.56', 'Sub Total 1 234.56');
  eq(r2.total, 1234.56, 'so is a Sub Total');
}
/* A figure on a line of its own has no name to hold a pack size. */
{
  const r = slip('Fridge', '1 234.56', 'TOTAL 1 234.56');
  eq(r.items.map(i => [i.name, i.amount]), [['Fridge', 1234.56]], 'a split-column price keeps its grouping');
}

console.log(`PASS receipt-parse-pack-size: ${checks} checks`);
