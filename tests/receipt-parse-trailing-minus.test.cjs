'use strict';
/* A discount written with the minus AFTER the figure (receipt-parse.js
   moneyTail, parseGeneric, audit 17 Nov 2026).

   MONEY_TAIL only allowed a leading minus, so "Promo 5.00-" became an
   unpriced item instead of a R5 discount on the product above. Many tills
   print the sign last. The trailing spelling now means exactly what the
   leading one does, on an item line and on a bare figure line, with or
   without R and with a decimal comma. A hyphen inside a name or a range
   ("2-pack", "80-count") is not a minus: the sign only counts straight after a
   two-decimal figure at the end of the line.

   Synthetic slips.   node tests/receipt-parse-trailing-minus.test.cjs */

const assert = require('assert');
const { parseReceiptText } = require('../src/receipt-parse');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const slip = (...lines) => parseReceiptText(['Sample Shop', '2026-02-14', 'TAX INVOICE', ...lines].join('\n'));
const view = r => ({ items: r.items.map(i => [i.name, i.amount, i.discount]), total: r.total, problems: r.problems });

{
  const trailing = slip('Milk 20.00', 'Promo 5.00-', 'TOTAL 15.00');
  const leading = slip('Milk 20.00', 'Promo -5.00', 'TOTAL 15.00');
  eq(view(trailing), view(leading), 'item line: trailing minus reads as leading minus');
  eq(view(trailing).items, [['Milk', 20, -5]], 'and it is a R5 discount on the milk');
  eq(trailing.problems, [], 'no unpriced, the slip adds up');
}

/* Item-line spellings against the leading-minus twin. */
for (const [trail, lead] of [
  ['Promo 5.00-', 'Promo -5.00'], ['Promo R5.00-', 'Promo -R5.00'], ['Promo 5,00-', 'Promo -5,00'],
  ['Promo R5,00-', 'Promo -R5,00'], ['Promo R 5.00-', 'Promo -R 5.00'], ['Staff Discount 1,250.00-', 'Staff Discount -1,250.00'],
]) {
  const a = slip('Milk 2000.00', trail, 'TOTAL 1000.00');
  const b = slip('Milk 2000.00', lead, 'TOTAL 1000.00');
  eq(view(a), view(b), `"${trail}" reads as "${lead}"`);
}

/* Bare figure line under an item. */
for (const [trail, lead] of [['5.00-', '-5.00'], ['R5.00-', '-R5.00'], ['5,00-', '-5,00'], ['R5,00-', '-R5,00']]) {
  const a = slip('Milk 20.00', trail, 'TOTAL 15.00');
  const b = slip('Milk 20.00', lead, 'TOTAL 15.00');
  eq(view(a), view(b), `bare "${trail}" behaves as bare "${lead}"`);
  eq(view(a).items, [['Milk', 20, -5]], `bare "${trail}" is a R5 discount`);
}
{
  /* Column-split: name, then its price, then the discount figure alone. */
  const r = slip('Milk', '20.00', 'Bread', '15.00', '2.50-', 'TOTAL 32.50');
  eq(view(r).items, [['Milk', 20, 0], ['Bread', 15, -2.5]], 'a bare trailing-minus line discounts the product above');
  eq(r.problems, [], 'and adds up');
}
{
  /* With no product above, the same thing happens as for the leading spelling. */
  const a = slip('Promo 5.00-', 'Milk 20.00', 'TOTAL 15.00');
  const b = slip('Promo -5.00', 'Milk 20.00', 'TOTAL 15.00');
  eq(view(a), view(b), 'a discount before any item matches its leading twin');
}

/* A hyphen in a name or a range is not a minus. */
eq(view(slip('Coke 2-pack 25.00', 'TOTAL 25.00')).items, [['Coke 2-pack', 25, 0]], 'Coke 2-pack');
eq(view(slip('Wipes 80-count 39.99', 'TOTAL 39.99')).items, [['Wipes 80-count', 39.99, 0]], 'Wipes 80-count');
eq(view(slip('Wipes 80-count', '39.99', 'TOTAL 39.99')).items, [['Wipes 80-count', 39.99, 0]], 'Wipes 80-count, price on its own line');
eq(view(slip('Bin Bags 10-', '15.00', 'TOTAL 15.00')).items, [['Bin Bags 10-', 15, 0]], 'a figure without cents followed by a hyphen is a name');
eq(view(slip('Milk 20.00', 'Bread - 15.00', 'TOTAL 35.00')).items, [['Milk', 20, 0], ['Bread -', 15, 0]], 'a spaced hyphen before a price is not a trailing minus (as before)');

console.log(`PASS receipt-parse-trailing-minus: ${checks} checks`);
