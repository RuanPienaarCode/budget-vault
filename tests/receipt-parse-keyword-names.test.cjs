'use strict';
/* A product whose NAME contains a payment or total word (receipt-parse.js
   parseGeneric, audit 17 Nov 2026).

   GENERIC_SKIP and PAID_LINE matched TOTAL / CARD / CASH / TAX / BALANCE ...
   anywhere in a line, so "Birthday Card 35.00" was dropped — and after the
   first item the same match ENDED the product block, taking every line below
   it. A line is now a total / payment / tax line only when such a word LEADS
   it (first word, or preceded only by other such words, a card brand or a
   "you / today / grand / net" lead-in). A weak word (cash, card, tax, change,
   balance, savings, credit, debit) that leads must not run on into an
   ordinary product word: "Cash Register Roll", "Tax Free Tea", "Savings Jar"
   and "Balance Bike" are products.

   Synthetic slips.   node tests/receipt-parse-keyword-names.test.cjs */

const assert = require('assert');
const { parseReceiptText } = require('../src/receipt-parse');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const slip = (...lines) => parseReceiptText(['Sample Farm Stall', '2026-02-14', 'TAX INVOICE', ...lines].join('\n'));
const rows = r => r.items.map(i => [i.name, i.amount]);

/* Names that contain, or start with, a payment word and are products. */
const PRODUCTS = [
  ['Birthday Card', 35], ['Gift Card', 200], ['Cash Register Roll', 45], ['Tax Free Tea', 30],
  ['Savings Jar', 60], ['Balance Bike', 900], ['Card Holder Wallet', 120], ['Change Purse', 80],
  ['Sympathy Card', 28.5], ['Credit Card Wallet', 99],
];
for (const [name, price] of PRODUCTS) {
  const line = `${name} ${price.toFixed(2)}`;
  const total = (price + 20).toFixed(2);
  const r = slip(line, 'Plasters 20.00', `TOTAL ${total}`);
  eq(rows(r), [[name, price], ['Plasters', 20]], `"${line}" is an item, and the line after it is kept`);
  eq(r.problems, [], `"${line}" slip adds up`);
  const first = slip('Plasters 20.00', line, `TOTAL ${total}`);
  eq(rows(first), [['Plasters', 20], [name, price]], `"${line}" survives after another item`);
  const head = slip(line, `TOTAL ${price.toFixed(2)}`);
  eq(rows(head), [[name, price]], `"${line}" survives as the first item`);
}

/* The mid-slip case from the audit: a keyword word mid-slip must not drop what follows. */
{
  const r = slip('Milk 20.00', 'Birthday Card 35.00', 'Plasters 20.00', 'TOTAL 75.00');
  eq(rows(r), [['Milk', 20], ['Birthday Card', 35], ['Plasters', 20]], 'three items');
  eq(r.problems, [], 'no sum-mismatch');
  eq(r.total, 75, 'total read');
}

/* Lines that ARE totals / payments / tax: still skipped before the first item
   and still the end of the block after it. */
const FURNITURE = [
  'TOTAL 55.00', 'SUB TOTAL 55.00', 'SUBTOTAL 55.00', 'CARD 55.00', 'VISA CARD 55.00',
  'DEBIT CARD ****1234 55.00', 'CREDIT CARD 55.00', 'CASH 100.00', 'CHANGE 45.00', 'VAT 15% 7.17', 'TAX 7.17',
  'AMOUNT DUE 55.00', 'BALANCE DUE 55.00', 'YOU SAVED 5.00', 'TOTAL SAVINGS 5.00', 'EFT 55.00',
  'E.F.T. 55.00', 'TENDERED 100.00', 'CASH TENDERED 100.00', 'PAYMENT 55.00', 'ROUNDING 0.02',
  'TOTAL ITEMS 3', 'TOTAL INCL VAT 55.00', 'VAT NO 4123456789', 'SAVINGS 5.00', 'BANK CARD 55.00',
  '*** TOTAL 55.00', 'GRAND TOTAL 55.00', 'AMOUNT PAID 55.00', 'PAID BY CARD 55.00', 'APPROVED BY CARD 55.00',
];
for (const line of FURNITURE) {
  const above = slip(line, 'Milk 20.00', 'Bread 15.00', 'TOTAL 35.00');
  eq(rows(above), [['Milk', 20], ['Bread', 15]], `"${line}" above the items is a header line`);
  const below = slip('Milk 20.00', 'Bread 15.00', line, 'Plasters 99.00', 'TOTAL 35.00');
  eq(rows(below), [['Milk', 20], ['Bread', 15]], `"${line}" after the items ends the block`);
}

/* Total picking is unchanged: TOTAL, else SUB TOTAL, else what was paid. */
eq(slip('Milk 20.00', 'Birthday Card 35.00', 'TOTAL 55.00').total, 55, 'TOTAL line');
eq(slip('Milk 20.00', 'Bread 15.00', 'SUB TOTAL 35.00', 'CASH 100.00').total, 35, 'SUB TOTAL line');
eq(slip('Milk 20.00', 'Bread 15.00', 'EFT 35.00').total, 35, 'EFT fallback');
eq(slip('Milk 20.00', 'Bread 15.00', 'AMOUNT DUE 35.00').total, 35, 'AMOUNT DUE fallback');
eq(slip('Milk 20.00', 'Bread 15.00', 'BALANCE DUE 35.00').total, 35, 'BALANCE DUE fallback');
eq(slip('Milk 20.00', 'Bread 15.00', 'DEBIT CARD ****1234 35.00').total, 35, 'DEBIT CARD fallback');

console.log(`PASS receipt-parse-keyword-names: ${checks} checks`);
