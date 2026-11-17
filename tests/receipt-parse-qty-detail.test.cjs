'use strict';
/* A weight / quantity detail on a line of its own (receipt-parse.js
   parseGeneric, audit 17 Nov 2026).

   "Bananas" / "0.456 kg @ R19.99/kg" / "9.12" made the detail line a fake
   item (it ends in "/kg", which neither MONEY_TAIL nor QTY_AWAITING_PRICE
   knew), left Bananas unpriced, and the "unpriced" problem switched off the
   total check for the whole slip. A line that is ONLY a number, an optional
   unit, optional NET / GROSS / EACH / EA, an @ or x, and optionally a unit
   price with a per-unit suffix has no product in it: it is skipped and the
   next price belongs to the product above, exactly as "2 x" already did.

   Synthetic slips.   node tests/receipt-parse-qty-detail.test.cjs */

const assert = require('assert');
const { parseReceiptText } = require('../src/receipt-parse');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const slip = (...lines) => parseReceiptText(['Sample Shop', '2026-02-14', 'TAX INVOICE', ...lines].join('\n'));
const rows = r => r.items.map(i => [i.name, i.amount]);

{
  const r = slip('Bananas', '0.456 kg @ R19.99/kg', '9.12', 'TOTAL 9.12');
  eq(rows(r), [['Bananas', 9.12]], 'the audit slip: one item at the line price');
  eq(r.problems, [], 'no unpriced, and the total check runs and passes');
}
{
  const r = slip('Bananas', '0.456 kg @ R19.99/kg', '9.12', 'Milk 20.00', 'TOTAL 99.00');
  eq(r.problems.map(p => p.code), ['sum-mismatch'], 'the total check is live: a wrong total is reported');
}
{
  const r = slip('Bananas', '0.456 kg NET @', '9.12', 'TOTAL 9.12');
  eq(rows(r), [['Bananas', 9.12]], '"0.456 kg NET @" leaves no amount-less row');
  eq(r.problems, [], 'and no problem');
}

/* Every spelling of a detail-only line, with the price on the line below. */
const DETAILS = [
  '0.456 kg @ R19.99/kg', '0.456 kg @ 19.99/kg', '0.456 kg @ R19.99 / kg', '0.456 kg @ 19.99 per kg',
  '0.456 kg @ 19.99 p/kg', '0.456kg @ 19.99/kg', '2 @ 4.50 each', '2 @ R4.50 ea', '2 x 4.50 each', '2 x 4.50/ea',
  '2 x 4.50', '2 x', '3x', '2 ×', '0.456 kg @', '0.456 kg NET @', '0.456 kg GROSS @', '1,5 kg @ 19,99/kg',
  '2 ea @ 4.50', '2 EACH @ 4.50', '500 g @ 1 200.00/kg', '0.456 KG NET @ R19.99/KG',
];
for (const d of DETAILS) {
  const r = slip('Apples', d, '9.00', 'Milk 20.00', 'TOTAL 29.00');
  eq(rows(r), [['Apples', 9], ['Milk', 20]], `"${d}" is a detail line, not an item`);
  eq(r.problems, [], `"${d}": slip adds up`);
}

/* Detail and the line price on one line, no product name: the figure at the
   end is the price of the product above. */
{
  const r = slip('Bananas', '0.456 kg @ R19.99/kg 9.12', 'TOTAL 9.12');
  eq(rows(r), [['Bananas', 9.12]], 'detail then line total on one line prices the product above');
}

/* Unchanged. */
eq(rows(slip('Bananas 0.456 kg @ R19.99/kg 9.12', 'Milk 20.00', 'TOTAL 29.12')),
  [['Bananas 0.456 kg @ R19.99/kg', 9.12], ['Milk', 20]], 'one-line form unchanged');
eq(rows(slip('Milk 2l 32.99', 'TOTAL 32.99')), [['Milk 2l', 32.99]], 'Milk 2l unchanged');
eq(rows(slip('Rice 5kg 89.99', 'TOTAL 89.99')), [['Rice 5kg', 89.99]], 'Rice 5kg unchanged');
eq(rows(slip('Free Range Biltong', '0.250 @ 100.00 100.00', 'TOTAL 100.00')), [['Free Range Biltong', 100]], 'weight @ price + total on one line unchanged');
eq(rows(slip('Max 25.00', 'Box', '15.00', 'TOTAL 40.00')), [['Max', 25], ['Box', 15]], 'names ending in x unchanged');
eq(rows(slip('2 Minute Noodles 12.00', 'TOTAL 12.00')), [['2 Minute Noodles', 12]], 'a product starting with a number is untouched');
eq(rows(slip('4 x 6 Photo Frame 55.00', 'TOTAL 55.00')), [['4 x 6 Photo Frame', 55]], 'a product with x in it is untouched');

console.log(`PASS receipt-parse-qty-detail: ${checks} checks`);
