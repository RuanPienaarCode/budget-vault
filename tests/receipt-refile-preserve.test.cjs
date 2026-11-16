'use strict';
/* Re-filing a product (receipt-file.js refileReceiptText) changes the
   Category and/or Healthy CELLS of the matching rows and nothing else.

   The audit of 16 Nov 2026 found it re-serialised the whole table from the
   schema's seven columns, so a hand-added column and a row with neither a
   name nor a barcode (a "bag levy" line typed by hand, which the loader
   skips but the reader can see) were deleted the first time anyone re-filed
   an unrelated product on the Food page, and the slip's spend fell by that
   row. A receipt is a file the reader may edit; this page only ever owns
   two cells of it.

   Synthetic slip. The diff is taken line by line, so "byte for byte" is
   checked on every line that is not the one cell, and the receipt is read
   back through parseReceiptFile, the loader load.js itself uses.

   node tests/receipt-refile-preserve.test.cjs */

const assert = require('assert');
const rf = require('../src/receipt-file');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const nl = '\n';
const build = eol => [
  '---', 'kind: receipt', 'receipt_store: "Sample Store"', 'receipt_date: 2026-02-14',
  'receipt_time: ""', 'receipt_total: 90.00', '---', '',
  'A line the reader wrote above.', '',
  '# Sample Store · 2026-02-14', '',
  '| Barcode | Item | Amount | Discount | Category | Healthy | Note |',
  '| --- | --- | ---: | ---: | --- | --- | --- |',
  '| 6000000000011 | MYSTERY A | 40.00 |  | Other |  | for Mom |',
  '| 6000000000028 | MYSTERY B | 30.00 |  | Other | yes | gift |',
  '|  |  | 20.00 |  | Other |  | bag levy |',
  '| 6000000000035 | MYSTERY C |  10.00 |  |  Pantry  |  | keep me   |',
  '',
  'Bought for the braai.', '',
].join(eol);

const diffLines = (a, b, eol) => {
  const x = a.split(eol), y = b.split(eol);
  eq(y.length, x.length, 'same number of lines');
  return x.map((l, i) => (l === y[i] ? null : [i, l, y[i]])).filter(Boolean);
};

for (const eol of [nl, '\r\n']) {
  const tag = eol === nl ? 'LF' : 'CRLF';
  const text = build(eol);
  const before = rf.parseReceiptFile(text, 'r.md');
  eq(rf.receiptPaid(before), 80, tag + ': baseline paid (the nameless R20 row is not an item to the loader)');

  /* (a) one product re-filed: exactly one cell of one line differs. */
  {
    const out = rf.refileReceiptText(text, '6000000000011', { category: 'Pantry' });
    const d = diffLines(text, out, eol);
    eq(d.length, 1, tag + ': a: exactly one line changed');
    eq(d[0][2], '| 6000000000011 | MYSTERY A | 40.00 |  | Pantry |  | for Mom |', tag + ': a: only the Category cell differs');
    ok(out.includes('|  |  | 20.00 |  | Other |  | bag levy |'), tag + ': a: the nameless row survives');
    ok(out.includes('| Note |') && out.includes('| keep me   |'), tag + ': a: the extra column and its cells survive');
    const after = rf.parseReceiptFile(out, 'r.md');
    eq(rf.receiptPaid(after), rf.receiptPaid(before), tag + ': a: the receipt spend is unchanged');
    eq(after.items.map(i => i.category), ['Pantry', 'Other', 'Pantry'], tag + ': a: only MYSTERY A moved');
    eq(after.items.map(i => i.extraCells), before.items.map(i => i.extraCells), tag + ': a: extra cells read back the same');
  }

  /* (b) already filed that way: nothing to write. */
  eq(rf.refileReceiptText(text, '6000000000011', { category: 'Other' }), null, tag + ': b: same category is null');
  eq(rf.refileReceiptText(text, '6000000000011', { healthy: false }), null, tag + ': b: same healthy flag is null');
  eq(rf.refileReceiptText(text, '6000000000011', { category: 'Other', healthy: false }), null, tag + ': b: neither changed is null');
  eq(rf.refileReceiptText(text, '9999999999999', { category: 'Pantry' }), null, tag + ': b: no row carries the key is null');

  /* (c) the Healthy flag flips without touching Category. */
  {
    const on = rf.refileReceiptText(text, '6000000000011', { healthy: true });
    const d = diffLines(text, on, eol);
    eq(d.length, 1, tag + ': c: one line');
    eq(d[0][2], '| 6000000000011 | MYSTERY A | 40.00 |  | Other | yes | for Mom |', tag + ': c: only the Healthy cell differs');
    const off = rf.refileReceiptText(text, '6000000000028', { healthy: false });
    eq(diffLines(text, off, eol)[0][2], '| 6000000000028 | MYSTERY B | 30.00 |  | Other |  | gift |', tag + ': c: and flips back off');
    const both = rf.refileReceiptText(text, '6000000000035', { category: 'Snacks', healthy: true });
    eq(diffLines(text, both, eol)[0][2], '| 6000000000035 | MYSTERY C |  10.00 |  |  Snacks  | yes | keep me   |',
      tag + ': c: both cells at once keep the cell padding around them');
  }

  /* A name-keyed row (no barcode) is found by its folded name. */
  {
    const named = text.replace('| 6000000000011 | MYSTERY A', '|  | Mystery  A');
    const out = rf.refileReceiptText(named, rf.itemKey({ name: 'mystery a' }), { category: 'Pantry' });
    eq(diffLines(named, out, eol).length, 1, tag + ': name key: one line');
  }
}

/* A row cut short: a hand-typed line with no Category cell and no trailing
   pipe still gets one, and the cells it already had are not touched. */
{
  const short = ['| Barcode | Item | Amount | Discount | Category | Healthy |', '| --- | --- | ---: | ---: | --- | --- |',
    '| 600 | TEA | 12.00 |'].join(nl) + nl;
  const out = rf.refileReceiptText(short, '600', { category: 'Drinks' });
  ok(out.startsWith('| Barcode | Item | Amount | Discount | Category | Healthy |\n| --- | --- | ---: | ---: | --- | --- |\n| 600 | TEA | 12.00 |'), 'the cells it already had are byte for byte');
  eq(rf.parseReceiptFile(out, 'r.md').items[0].category, 'Drinks', 'and reads back through the loader');
  eq(rf.parseReceiptFile(out, 'r.md').items[0].amount, 12, 'amount intact');
}

console.log(`PASS receipt-refile-preserve: ${checks} checks`);
