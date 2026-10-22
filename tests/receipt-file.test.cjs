'use strict';
/* Receipts — the file contract, filing, bank-line matching and the period
   summary (src/receipt-file.js). Synthetic data only; the repo is public.

     1  a receipt serializes and parses back to the same items, Discount
        blank when there was none, Healthy as yes;
     2  re-filing one product rewrites only its rows' Category, keeps every
        line around the table byte for byte, and writes nothing when
        nothing changed;
     3  the keyword rules' ORDER — the exceptions that sit above the words
        they would otherwise fall into;
     4  the household's memory (Food Items.md) beats the guess, and survives
        a round trip;
     5  matching: same cents, a bank date from a day before to five after,
        store name preferred, one bank line per receipt;
     6  the summary counts what was PAID, so categories add up to the slips.

   node tests/receipt-file.test.cjs */

const assert = require('assert');
const rf = require('../src/receipt-file');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const receipt = {
  store: 'Checkers Sampletown', date: '2026-02-01', time: '09:30', total: 150,
  items: [
    { barcode: '6000000000011', name: 'MILK FCRM 2L', amount: 40, discount: -10, category: 'Dairy & eggs', healthy: false },
    { barcode: '6000000000028', name: 'APPLES 1KG', amount: 30, discount: 0, category: 'Fruit & veg', healthy: true },
    { barcode: '6000000000035', name: 'CHOC SLAB 80G', amount: 50, discount: 0, category: 'Snacks & chocolate', healthy: false },
    { barcode: '', name: 'Bread | brown', amount: 40, discount: 0, category: 'Bakery', healthy: false },
  ],
};

/* ---- 1. round trip ----------------------------------------------------- */
const text = rf.serializeReceipt(receipt);
{
  ok(text.includes('| 6000000000028 | APPLES 1KG | 30.00 |  | Fruit & veg | yes |'),
    '1: no discount is a blank cell, healthy is yes');
  ok(text.includes('| -10.00 |'), '1: a discount is written negative');
  ok(text.includes('Bread \\| brown'), '1: a pipe in a name is escaped');
  const back = rf.parseReceiptFile(text, 'Receipts/2026-02/x.md');
  eq([back.store, back.date, back.time, back.total], ['Checkers Sampletown', '2026-02-01', '09:30', 150], '1: frontmatter');
  eq(back.items.map(i => [i.barcode, i.name, i.amount, i.discount, i.category, i.healthy]),
    receipt.items.map(i => [i.barcode, i.name, i.amount, i.discount, i.category, i.healthy]), '1: items');
  eq(rf.receiptPaid(back), 150, '1: paid adds up to the slip');
  eq(rf.receiptPath(receipt), 'Receipts/2026-02/2026-02-01 Checkers Sampletown 0930.md', '1: path');
}

/* ---- 2. re-filing ------------------------------------------------------ */
{
  const withExtras = text.replace('# Checkers', 'A line the reader wrote.\n\n# Checkers') + '\nBought for the braai.\n';
  const out = rf.refileReceiptText(withExtras, '6000000000035', { category: 'Treats' });
  ok(out.includes('| CHOC SLAB 80G | 50.00 |  | Treats |'), '2: the product is re-filed');
  ok(out.includes('| MILK FCRM 2L | 40.00 | -10.00 | Dairy & eggs |'), '2: other rows untouched');
  const lead = withExtras.slice(0, withExtras.indexOf('| Barcode'));
  ok(out.startsWith(lead), '2: everything above the table kept byte for byte');
  ok(out.trimEnd().endsWith('Bought for the braai.'), '2: everything below the table kept');
  /* A line straight under a table is another ROW of it in GFM and in
     Obsidian's reader, so the blank line between them is content too. */
  ok(/\|\n\nBought for the braai\./.test(out), '2: and the blank line that keeps it out of the table');
  ok(/\|\n\nA note\.\n$/.test(rf.serializeReceipt(receipt, { trail: 'A note.\n' })), '2: a fresh trail gets one too');
  ok(/\|\n\nKeep me\.\n$/.test(rf.serializeFoodItems(new Map([['1', { barcode: '1', name: 'X', category: 'Other', healthy: false }]]), { lead: '---\nkind: food-items\n---', trail: '\nKeep me.\n' })),
    '2: Food Items.md the same');
  eq(rf.refileReceiptText(withExtras, '6000000000035', { category: 'Snacks & chocolate' }), null,
    '2: no change, no write');
  const byName = rf.refileReceiptText(text, rf.itemKey({ name: 'bread |  BROWN' }), { category: 'Pantry' });
  ok(byName && byName.includes('| Bread \\| brown | 40.00 |  | Pantry |'), '2: a barcode-less line is keyed by its folded name');
}

/* ---- 3. rule order ----------------------------------------------------- */
{
  const g = rf.guessCategory;
  eq(g('TOM ONION 410G'), 'Pantry', '3: tinned tomato & onion is not veg');
  eq(g('TOM 4S PK'), 'Fruit & veg', '3: fresh tomatoes are');
  eq(g('CHICKPEAS 400G'), 'Pantry', '3: CHICKPEAS is not chicken');
  eq(g('CHIC WHL BIRD'), 'Meat & fish', '3: CHIC is');
  eq(g('BUTTERNUT PKG'), 'Fruit & veg', '3: BUTTERNUT is not butter');
  eq(g('BUTTR TRAD 500G'), 'Dairy & eggs', '3: BUTTR is');
  eq(g('CHECKOUT BAG CH'), 'Household', '3: bags');
  eq(g('PRSDNT BLKPEP400'), 'Cheese', '3: President is cheese');
  eq(g('SAUV BLANC 750ML'), 'Wine & alcohol', '3: wine');
  eq(g('TANGO KIDS 750G'), 'Fruit & veg', '3: tangerines');
  eq(g('MYSTERY THING', '6003670000001'), 'Fruit & veg', '3: Checkers fresh-produce barcode as a last resort');
  eq(g('MYSTERY THING', '6001000000000'), 'Other', '3: otherwise Other');
  eq(g('CADBURY DAIRY MILK 80G'), 'Snacks & chocolate', '3: Dairy Milk is chocolate, not milk');
  eq(g('PEANUT BUTTER 400G'), 'Pantry', '3: peanut butter is not butter');
  eq(g('TOMATO SAUCE 700ML'), 'Pantry', '3: tomato sauce is not a tomato');
}

/* ---- 4. the household's memory ---------------------------------------- */
{
  const map = new Map();
  map.set('6000000000035', { barcode: '6000000000035', name: 'CHOC SLAB 80G', category: 'Treats', healthy: false });
  map.set(rf.itemKey({ name: 'Farm eggs' }), { barcode: '', name: 'Farm eggs', category: 'Dairy & eggs', healthy: true });
  eq(rf.suggestFiling({ barcode: '6000000000035', name: 'CHOC SLAB 80G' }, map),
    { category: 'Treats', healthy: false, known: true }, '4: the map beats the guess');
  eq(rf.suggestFiling({ barcode: '', name: 'FARM  EGGS' }, map),
    { category: 'Dairy & eggs', healthy: true, known: true }, '4: by folded name, and its healthy flag carries');
  eq(rf.suggestFiling({ barcode: '6009999999999', name: 'APPLES 1KG', healthy: true }, map),
    { category: 'Fruit & veg', healthy: true, known: false }, '4: unknown -> guess, slip (V) kept');
  const back = rf.parseFoodItems(rf.serializeFoodItems(map));
  eq([...back.keys()].sort(), [...map.keys()].sort(), '4: Food Items.md round trip keys');
  eq(back.get('6000000000035').category, 'Treats', '4: and categories');
}

/* ---- 5. matching ------------------------------------------------------- */
{
  const r = (rel, date, total, store = 'Checkers Sampletown') => ({ rel, date, time: '10:00', total, store, items: [] });
  const receipts = [
    r('a', '2026-02-01', 48), r('b', '2026-02-02', 48), r('c', '2026-02-10', 99.99), r('d', '2026-02-20', 12),
  ];
  const txs = [
    { key: 't1', date: '2026-02-01', amount: -48, desc: 'CHECKERS SAMPLETOWN' },
    { key: 't2', date: '2026-02-03', amount: -48, desc: 'CHECKERS SAMPLETOWN' },
    { key: 't3', date: '2026-02-10', amount: -99.99, desc: 'PICK N PAY' },
    { key: 't4', date: '2026-02-11', amount: -99.99, desc: 'Checkers Sampletown 123' },
    { key: 't5', date: '2026-02-27', amount: -12, desc: 'CHECKERS' },
  ];
  const m = rf.matchReceipts(receipts, txs);
  eq(m.get('a').key, 't1', '5: same day, same cents');
  eq(m.get('b').key, 't2', '5: the second R48.00 does not steal the first bank line');
  eq(m.get('c').key, 't4', '5: the line naming the store beats a nearer one that does not');
  ok(!m.has('d'), '5: seven days later is not this slip');
}

/* ---- 4b. merging into the memory ---------------------------------------- */
{
  const map = new Map([['6000000000011', { barcode: '6000000000011', name: 'MILK FCRM 2L', category: 'Dairy & eggs', healthy: false }]]);
  eq(rf.mergeFoodItems(map, [{ barcode: '6000000000011', name: 'M1LK FCRN', category: 'Dairy & eggs', healthy: false }]), false,
    '4b: same filing, no change, no write');
  eq(rf.mergeFoodItems(map, [{ barcode: '6000000000011', name: 'M1LK FCRN', category: 'Drinks', healthy: true }]), true, '4b: a re-file changes it');
  eq(map.get('6000000000011'), { barcode: '6000000000011', name: 'MILK FCRM 2L', category: 'Drinks', healthy: true },
    '4b: newest category and flag, but the first-remembered name survives an OCR misread');
}

/* ---- 5b. coverage ------------------------------------------------------- */
{
  const lines = [
    { key: 'split-parent', date: '2026-02-03', amount: -640.00, cat: 'Groceries', excluded: true },
    { key: 'takeaway', date: '2026-02-04', amount: -300, cat: 'Groceries', excluded: false },
    { key: 'salary', date: '2026-02-01', amount: 30000, cat: 'Salary', excluded: false },
    { key: 'march', date: '2026-03-01', amount: -99, cat: 'Groceries', excluded: false },
  ];
  const isFood = t => t.cat === 'Groceries' && !t.excluded;
  eq(rf.coverage(lines, new Set(['split-parent']), '2026-02-01', '2026-02-28', isFood), { spend: 940, covered: 640.00 },
    '5b: a matched split parent counts on both sides — 69%, never the 100% it read when only one side saw it');
  eq(rf.coverage(lines, new Set(), '2026-02-01', '2026-02-28', isFood), { spend: 300, covered: 0 }, '5b: nothing matched');
}

/* ---- 6. the summary ---------------------------------------------------- */
{
  const r1 = rf.parseReceiptFile(text, 'r1');
  const r2 = { ...r1, rel: 'r2', date: '2026-02-08', items: [
    { barcode: '6000000000035', name: 'CHOC SLAB 80G', amount: 55, discount: 0, category: 'Snacks & chocolate', healthy: false },
  ] };
  const outside = { ...r1, rel: 'r3', date: '2026-03-01' };
  const s = rf.foodSummary([r1, r2, outside], '2026-02-01', '2026-02-28');
  eq(s.receipts, 2, '6: two receipts in range');
  eq(s.spend, 205, '6: spend is what was paid (150 + 55)');
  eq(s.saved, 10, '6: XTRASAVE total');
  eq(s.healthy, 30, '6: healthy paid');
  eq(s.byCategory.map(c => [c.category, c.amount]), [
    ['Snacks & chocolate', 105], ['Bakery', 40], ['Dairy & eggs', 30], ['Fruit & veg', 30],
  ], '6: by category, biggest first, ties by name');
  eq(s.byCategory.reduce((a, c) => a + c.amount, 0), s.spend, '6: categories add up to spend');
  const choc = s.items.find(i => i.members.some(m => m.barcode === '6000000000035'));
  eq([choc.count, choc.amount, choc.lastPrice], [2, 105, 55], '6: one product across two slips, latest price');

  /* Newest-first input (the loader's order) must not let the OLDEST slip name
     the product; and price history reaches back past the period. */
  const jan = { ...r1, rel: 'jan', date: '2026-01-15', items: [
    { barcode: '6000000000035', name: 'CHOC OLD NAME', amount: 45, discount: 0, category: 'Other', healthy: false },
  ] };
  const s2 = rf.foodSummary([r2, r1, jan], '2026-02-01', '2026-02-28');
  const c2 = s2.items.find(i => i.members.some(m => m.barcode === '6000000000035'));
  eq(s2.items.filter(i => i.members.some(m => m.barcode === '6000000000035')).length, 1, '6: one barcode under two spellings is still one row');
  eq([c2.name, c2.category], ['CHOC SLAB 80G', 'Snacks & chocolate'], '6: the newest slip names and files the product');
  eq(c2.prices.map(p => p.amount), [45, 50, 55], '6: price history includes January, outside the period');
  eq(c2.count, 2, '6: but the counts stay inside the period');
  const s3 = rf.foodSummary([r2, r1, jan], '2026-01-01', '2026-01-31');
  eq(s3.items[0].prices.map(p => p.amount), [45], '6: and never runs past the period end');

  /* One row per product NAME (Ruan, 22 Oct 2026): the same tin from two
     suppliers carries two barcodes, and two "TOM ONION 410G" rows read as a
     duplicate. The row keeps every barcode behind it, so re-filing it can
     reach all of them. */
  const tinA = { ...r1, rel: 'tA', date: '2026-02-02', items: [
    { barcode: '6000000000101', name: 'TOM ONION 410G', amount: 17.99, discount: 0, category: 'Pantry', healthy: false },
  ] };
  const tinB = { ...r1, rel: 'tB', date: '2026-02-05', items: [
    { barcode: '6000000000202', name: 'Tom Onion  410g', amount: 21.99, discount: 0, category: 'Pantry', healthy: false },
    { barcode: '', name: 'tom onion 410G', amount: 19.99, discount: 0, category: 'Pantry', healthy: false },
  ] };
  const s4 = rf.foodSummary([tinB, tinA], '2026-02-01', '2026-02-28');
  const tins = s4.items.filter(i => rf.fold(i.name) === 'tom onion 410g');
  eq(tins.length, 1, '6: same name, different barcodes — one Items row');
  eq([tins[0].count, tins[0].amount], [3, 59.97], '6: counting every line under that name');
  eq(tins[0].prices.map(p => p.amount), [17.99, 21.99, 19.99], '6: one price history across the barcodes, oldest first');
  eq(tins[0].members.map(m => rf.itemKey(m)).sort(), ['#tom onion 410g', '6000000000101', '6000000000202'],
    '6: and every barcode (or name) behind the row, for re-filing');
}

console.log(`PASS receipt-file (${checks} checks)`);
