'use strict';
/* Receipt text -> line items (src/receipt-parse.js).

   The fixtures are SYNTHETIC slips in the Checkers layout — this repo is
   public, and a real slip carries a card's last digits, a loyalty number and
   a cashier's name. Their shapes are not invented, though: each one copies a
   way Apple's Live Text really read a real slip while this was built.

     1  typed text, one price per line — the easy case;
     2  the same slip column-split: names in one run, prices in another, with
        stray VAT-table prices before them, `R5O.00` for R50.00, a name
        wrapped over two lines, `(WS` for `(V)`, and the R0.00 dropped;
     3  the item prices arriving AFTER the loyalty footer, past TOTAL;
     4  a voided line, and the slip's own count leaving the reversal out;
     5  a price lost to OCR — reported with both figures, never hidden;
     6  the loyalty "Savings at" dash-date is not the purchase date;
     7  a generic, non-Checkers receipt;
     8  a known barcode's confirmed name replaces an OCR-mangled one.

   Runs in bare node. node tests/receipt-parse.test.cjs */

const assert = require('assert');
const { parseReceiptText, itemsTotal } = require('../src/receipt-parse');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const codes = r => r.problems.map(p => p.code);

const HEADER = [
  'SHOPRITE CHECKERS (PTY) LTD',
  'SAMPLETOWN Tel No +27 00 000 0000',
  'APPROVED AMOUNT: R150.00',
];

/* ---- 1. typed ---------------------------------------------------------- */
const typed = [
  ...HEADER,
  'TAX INVOICE',
  'Item/GTIN 6000000000011', 'MILK FCRM 2L          R40.00A',
  ' XTRASAVE MILK                 -R10.00',
  'Item/GTIN 6000000000028', 'APPLES 1KG (V)        R30.00A',
  'Item/GTIN 6000000000035', 'CHOC SLAB 80G         R50.00',
  'Item/GTIN 6000000000042', 'BREAD BROWN 700G      R40.00',
  'Item/GTIN 2200000000000', 'LITTLE SHOP            R0.00',
  'TOTAL [5]               R150.00',
  'Electronic Payment      R150.00',
  'Today you saved R10.00',
  'Date Time Store Reg Txn',
  '01/02/26 09:30 100 001 001',
  'Savings at 28-01-2026',
  'BARCODE [',
].join('\n');

{
  const r = parseReceiptText(typed);
  eq(r.format, 'checkers', '1: recognised as a Checkers slip');
  eq(r.store, 'Checkers Sampletown', '1: store from the branch line');
  eq(r.date, '2026-02-01', '1: dd/mm/yy purchase date');
  eq(r.time, '09:30', '1: time');
  eq(r.total, 150, '1: total from APPROVED AMOUNT');
  eq(r.items.map(i => [i.barcode, i.name, i.amount, i.discount, i.healthy]), [
    ['6000000000011', 'MILK FCRM 2L', 40, -10, false],
    ['6000000000028', 'APPLES 1KG', 30, 0, true],
    ['6000000000035', 'CHOC SLAB 80G', 50, 0, false],
    ['6000000000042', 'BREAD BROWN 700G', 40, 0, false],
  ], '1: four products, discount on the line above it, (V) flag stripped, R0 line dropped');
  eq(itemsTotal(r.items), 150, '1: items add up to the slip');
  eq(r.problems, [], '1: nothing to report');
}

/* ---- 2. column-split OCR ----------------------------------------------- */
{
  const split = [
    ...HEADER,
    'TAX INVOICE',
    'Item/GTIN 6000000000011', 'MILK FCRM 2L', 'XTRASAVE MILK',
    'Item/GTIN 6000000000028', 'APPLES 1KG (WS',
    'Item/GTIN 6000000000035', 'CHOC SLAB', '80G',
    'Item/GTIN 6000000000042', 'BREAD BROWN 700G',
    'Item/GTIN 2200000000000', 'LITTLE SHOP',
    'TOTAL [5]', 'RATE', 'TAX', '15%', 'R12.00', 'GROSS', 'R92.00',
    'R40.00A', '-R10.00', 'R30.00A', 'R5O.00', 'R40.00',
    'R150.00', 'NET',
    'Date', '01/02/26', 'Time', '09:30',
    'BARCODE [',
  ].join('\n');
  const r = parseReceiptText(split);
  eq(r.items.map(i => [i.name, i.amount, i.discount, i.healthy]), [
    ['MILK FCRM 2L', 40, -10, false],
    ['APPLES 1KG', 30, 0, true],
    ['CHOC SLAB 80G', 50, 0, false],
    ['BREAD BROWN 700G', 40, 0, false],
  ], '2: the run of prices that fits the items and adds up to the total is the one used');
  eq(r.problems, [], '2: proven by the total, count matches');
}

/* ---- 3. prices past the footer ----------------------------------------- */
{
  const late = [
    'SHOPRITE CHECKERS (PTY) LTD', 'SAMPLETOWN Tel No +27 00 000 0000',
    'APPROVED AMOUNT: R60.00',
    'TAX INVOICE',
    'Item/GTIN 6000000000059', 'TOM ONION 410G',
    'Item/GTIN 6000000000066', 'RED LENTILS 500G (V)',
    'TOTAL [2]', 'Electronic Payment', 'RATE', 'TAX', 'R2.00', 'GROSS', 'R25.00',
    'Hi Sample', 'Thank you for swiping your', 'Since joining', 'you have saved', 'R7000',
    'R25.00', 'R35.00A', 'R60.00', 'NET',
    '01/02/26', '17:00', 'BARCODE [',
  ].join('\n');
  const r = parseReceiptText(late);
  eq(r.items.map(i => [i.name, i.amount]), [['TOM ONION 410G', 25], ['RED LENTILS 500G', 35]],
    '3: a stray R25.00 before the real run does not shift the pairing');
  eq(r.problems, [], '3: proven');
}

/* ---- 4. a voided line -------------------------------------------------- */
{
  const voided = [
    'SHOPRITE CHECKERS (PTY) LTD', 'SAMPLETOWN Tel No +27 00 000 0000',
    'APPROVED AMOUNT: R130.00',
    'TAX INVOICE',
    'Item/GTIN 6000000000073', 'COFFEE BEANS        R30.00',
    'Voided',
    'Item/GTIN 6000000000080', 'GOUDA 400G          R100.00',
    'Item/GTIN 6000000000080', 'GOUDA 400G          R100.00',
    'Voided',
    'Item/GTIN 6000000000080', 'GOUDA 400G         -R100.00',
    ' * Auth: 1234', ' A Supervisor', ' VoidLineItem',
    'TOTAL [3]               R130.00',
    '01/02/26 10:00', 'BARCODE [',
  ].join('\n');
  const r = parseReceiptText(voided);
  eq(r.items.map(i => [i.name, i.amount]), [['COFFEE BEANS', 30], ['GOUDA 400G', 100]],
    '4: the reversal cancels one of the two lines; the approver\'s name is no product');
  eq(r.problems, [], '4: TOTAL [3] counts the voided original but not its reversal');
}

/* ---- 5. a price OCR lost ----------------------------------------------- */
{
  const lost = typed.replace('R30.00A', 'R3O.0');
  const r = parseReceiptText(lost);
  ok(codes(r).includes('sum-mismatch'), '5: a slip that no longer adds up says so');
  const p = r.problems.find(x => x.code === 'sum-mismatch');
  eq(p.total, 150, '5: with the slip total');
  ok(p.items !== 150, '5: and what the items came to');
  eq(r.items.length, 4, '5: the grid is still full for the reader to fix');
}

/* ---- 5b. a misread digit behind a stray price --------------------------- */
{
  const split = [
    ...HEADER, 'TAX INVOICE',
    'Item/GTIN 6000000000011', 'MILK FCRM 2L', 'XTRASAVE MILK',
    'Item/GTIN 6000000000028', 'APPLES 1KG',
    'Item/GTIN 6000000000035', 'CHOC SLAB 80G',
    'Item/GTIN 6000000000042', 'BREAD BROWN 700G',
    'TOTAL [4]', 'TAX', 'R12.00',
    'R40.00A', '-R10.00', 'R30.00A', 'R5O.03', 'R40.00',
    '01/02/26 09:30', 'BARCODE [',
  ].join('\n');
  const r = parseReceiptText(split);
  eq(r.items.map(i => i.amount), [40, 30, 50.03, 40],
    '5b: no run adds up, so the run nearest the total is used — not one shifted onto the stray R12.00');
  eq(r.problems.map(p => p.code), ['sum-mismatch'], '5b: and the miss is still reported');
}

/* ---- 6. the loyalty date is not the purchase date ---------------------- */
{
  const noDate = typed.replace('01/02/26 09:30 100 001 001', 'no date printed');
  const r = parseReceiptText(noDate);
  eq(r.date, '', '6: "Savings at 28-01-2026" is the loyalty balance, not the purchase');
  ok(codes(r).includes('no-date'), '6: reported as missing');
}

/* ---- 7. a generic receipt ---------------------------------------------- */
{
  const generic = [
    'FARM STALL',
    '2026-02-03 08:15',
    'Eggs x18          75.00'.replace('75.00', 'R75.00'),
    'Honey 500g        R90.00',
    'Loyalty discount  -R5.00',
    'Sourdough         R60.00',
    'SUBTOTAL          R220.00',
    'TOTAL             R220.00',
    'CARD              R220.00',
  ].join('\n');
  const r = parseReceiptText(generic);
  eq(r.format, 'generic', '7: not a Checkers slip');
  eq(r.store, 'FARM STALL', '7: first line names the shop');
  eq(r.date, '2026-02-03', '7: ISO date');
  eq(r.total, 220, '7: TOTAL, not SUBTOTAL or CARD');
  eq(r.items.map(i => [i.name, i.amount, i.discount]), [
    ['Eggs x18', 75, 0], ['Honey 500g', 90, -5], ['Sourdough', 60, 0],
  ], '7: a negative line is the discount on the line above it');
  eq(r.problems, [], '7: adds up');
}

/* ---- 9. the slip's own "Today you saved" ------------------------------- */
{
  const r = parseReceiptText(typed.replace('Today you saved R10.00', 'Today you saved R15.00'));
  eq(r.problems, [{ code: 'saved-mismatch', items: 10, slip: 15 }], '9: a discount the slip counted but the lines do not is reported');
}

/* ---- 10. a product whose name starts like a VAT heading ----------------- */
{
  const r = parseReceiptText(typed.replace('BREAD BROWN 700G', 'NETTLE TEA 40S'));
  eq(r.items[3].name, 'NETTLE TEA 40S', '10: NET is a heading only as a whole word');
  eq(r.problems, [], '10: and the slip still adds up');
}

/* ---- 8. a known barcode's confirmed name ------------------------------- */
{
  const mangled = typed.replace('CHOC SLAB 80G', 'CH0C SLAR 8OG');
  const r = parseReceiptText(mangled, { known: { '6000000000035': { name: 'CHOC SLAB 80G' } } });
  eq(r.items[2].name, 'CHOC SLAB 80G', '8: the name already confirmed for this barcode wins over OCR');
}

console.log(`PASS receipt-parse (${checks} checks)`);
