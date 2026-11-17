'use strict';
/* A slip's heading keeps its payment words out of the product list.

   isTotalLine (receipt-parse.js) tells a total / payment line by the keyword
   that LEADS it, so "Birthday Card 35.00" and "Cash Register Roll 45.00" are
   products. Left to that rule alone, the lines a till prints ABOVE the first
   product read as products too — "CASH SALE INVOICE" as an unpriced row,
   "TAX INV NO 12345" as a row priced at the invoice number, "Till 3 Cash
   Desk" as another unpriced row — and each one either switched the slip's
   total check off or failed it. Before isTotalLine those lines were skipped,
   by the keyword appearing anywhere in them.

   So above the first product, a line with no price in cents is still judged
   the old, wider way. A line that ends in rand and cents is a product wherever
   it stands. Invented slips.

   node tests/receipt-parse-heading-words.test.cjs */

const assert = require('assert');
const { parseReceiptText } = require('../src/receipt-parse');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const slip = (...lines) => parseReceiptText(['Sample Farm Stall', '2026-02-14', ...lines].join('\n'));
const rows = r => r.items.map(i => [i.name, i.amount]);
const body = ['Milk 20.00', 'Bread 15.00', 'TOTAL 35.00'];
const clean = [['Milk', 20], ['Bread', 15]];

/* Heading lines, each above the first product. */
for (const head of [
  'CASH SALE INVOICE',
  'TAX INV NO 12345',
  'Till 3 Cash Desk',
  'CASH SALE',
  'CASH SLIP',
  'VAT REG NO 4123456789',
  'CARD PAYMENT',
  'CREDIT CARD SLIP',
]) {
  const r = slip(head, ...body);
  eq(rows(r), clean, `"${head}" above the products is not a product`);
  eq(r.problems, [], `"${head}" leaves the slip adding up to its total`);
  eq(r.total, 35, `"${head}" does not become the total`);
}

/* Two heading lines in a row, and one that carries a number. */
{
  const r = slip('CASH SALE INVOICE', 'TAX INV NO 12345', ...body);
  eq([rows(r), r.problems, r.total], [clean, [], 35], 'a heading of several such lines');
}

/* A priced product is a product even as the first line of the slip. */
{
  const r = slip('Birthday Card 35.00', 'Plasters 20.00', 'TOTAL 55.00');
  eq(rows(r), [['Birthday Card', 35], ['Plasters', 20]], 'a product named with a payment word, first on the slip');
  eq(r.problems, [], 'and the slip adds up');
}
{
  const r = slip('Cash Register Roll 45.00', 'Milk 20.00', 'TOTAL 65.00');
  eq(rows(r), [['Cash Register Roll', 45], ['Milk', 20]], 'one that even starts with the word');
}

/* Under the first product the heading rule is over: a name on a line of its
   own (a price column on separate lines) is a product, payment word or not. */
{
  const r = slip('Milk', '20.00', 'Birthday Card', '35.00', 'Plasters', '20.00', 'TOTAL 75.00');
  eq(rows(r), [['Milk', 20], ['Birthday Card', 35], ['Plasters', 20]], 'split columns, payment word mid-slip');
  eq(r.problems, [], 'and the slip adds up');
}

/* A credit note is a way of paying, not a discount on the line above it. */
{
  const r = slip('Milk 20.00', 'Bread 15.00', 'Credit Note -10.00', 'TOTAL 35.00');
  eq(r.items.map(i => [i.name, i.amount, i.discount || 0]), [['Milk', 20, 0], ['Bread', 15, 0]], 'a credit note discounts nothing');
}

/* A total is a total wherever the word stands in its line.

   TOTAL (and the other strong words) never had to lead: "Sub-Total", "Sale
   Total", "Order Total" end the product block as they always did. Asked to
   lead, each was read as a product priced at the slip's own total, the block
   ran on, and the slip counted twice (pre-push audit, 17 Nov 2026). The slip
   below has NO line that starts with TOTAL, so the line under test is the only
   thing that can end the block and name the total. */
for (const line of [
  'Sub-Total 49.98', 'SUB-TOTAL 49.98', 'Sub Total: 49.98', 'Sale Total 49.98', 'Order Total 49.98',
  'Invoice Total 49.98', 'Basket Total 49.98', 'Rounded Total 49.98', 'Items Total 49.98', 'Final Total 49.98',
  'Nett Total 49.98', 'Customer Total 49.98', 'Bill Total R49.98', 'Grand-Total 49.98', 'Total Incl. VAT 49.98',
  'Total (VAT Incl) 49.98', 'Total Due: R49.98', 'Cash Total 49.98', 'Card Total 49.98',
]) {
  const r = slip('Bread 16.99', 'Milk 32.99', line, 'Cash 50.00', 'Change 0.02');
  eq(rows(r), [['Bread', 16.99], ['Milk', 32.99]], `"${line}" ends the products and is not one`);
  eq([r.total, r.problems], [49.98, []], `"${line}" is the slip's total, and the slip adds up`);
}

/* The card machine's "Card Type" line under a slip with no TOTAL line ends the
   products, alone, with nothing above it to have ended them already. */
{
  const r = slip('Bread 16.99', 'Milk 32.99', 'Card Type: VISA');
  eq(rows(r), [['Bread', 16.99], ['Milk', 32.99]], '"Card Type: VISA" under the products is not a product');
}

/* A card holder is something a shop sells. HOLDER is not a word that may
   follow a payment word, so the line is a product and the ones under it are
   kept. */
{
  const r = slip('Milk 20.00', 'Credit Card Holder 120.00', 'Plasters 20.00', 'TOTAL 160.00');
  eq(rows(r), [['Milk', 20], ['Credit Card Holder', 120], ['Plasters', 20]], 'a card holder is a product, and the block runs on');
  eq(r.problems, [], 'and the slip adds up');
}

console.log(`PASS receipt-parse-heading-words — a slip's heading keeps its payment words out of the products (${checks} checks)`);
