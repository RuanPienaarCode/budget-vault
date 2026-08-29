'use strict';
/* Reading a statement that is not in rand.

   Issue #28 was reported by an Indonesian household. While fixing the totals
   it turned out they could not have imported a statement in the first place:
   normalizeAmount("Rp 1.500.000") returned null, views/import.js counted the
   row into `skipped`, and a whole statement imported ZERO rows while
   reporting them as skipped. Not an error — a plausible silent nothing, which
   is precisely the failure src/amount.js's own header says it exists to
   refuse.

   Two gaps, pinned here together because they are the same gap seen from two
   ends: the amount cell, and the column heading above it.

     node tests/foreign-statement-import.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { normalizeAmount } = require('../src/amount');
const { detectStatementColumns } = require('../src/statement');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- 1. the symbols and codes real statements lead with ---- */
{
  const cases = [
    ['Rp 1.500.000', 1500000, 'Indonesian rupiah, dot-grouped — the reporter\'s own statement'],
    ['Rp1500000', 1500000, 'and with no space after the symbol'],
    ['¥1,200', 1200, 'yen/yuan'],
    ['RMB 100', 100, 'and the code some Chinese exports use instead'],
    ['CNY 100', 100, 'as well as the ISO one'],
    ['₹500', 500, 'rupee'],
    ['R$ 250,00', 250, 'Brazilian real — consumed WHOLE, not as an R leaving a stray $'],
    ['kr 100,50', 100.5, 'Nordic krona with a decimal comma'],
    ['CHF 50', 50, 'Swiss franc'],
    ['zł 99,00', 99, 'Polish złoty'],
    ['₩50000', 50000, 'won'],
  ];
  for (const [cell, want, why] of cases) eq(normalizeAmount(cell), want, `${JSON.stringify(cell)} — ${why}`);
}

/* ---- 2. what must NOT change: everything that already worked ---- */
{
  const cases = [
    ['R 1 234,56', 1234.56], ['$1,200.00', 1200], ['€900.00', 900],
    ['1.234,56', 1234.56], ['(123.45)', -123.45], ['100.00 Dr', -100],
    ['123.45-', -123.45], ['.50', 0.5], ['18.5%', 18.5],
  ];
  for (const [cell, want] of cases) {
    eq(normalizeAmount(cell), want, `${JSON.stringify(cell)} still reads as it always did`);
  }
}

/* ---- 3. the AMBIGUOUS case is left alone, on purpose ----

   "1.500" is genuinely one and a half OR one thousand five hundred, and this
   vault does not know which. It parses exactly as it always has. Widening the
   dot-grouped rule to cover it would be guessing at money, which is the one
   thing src/amount.js refuses to do — "1.500.000" is safe only because no
   money has two decimal points. */
{
  eq(normalizeAmount('1.500'), 1.5,
    'a SINGLE dot group is ambiguous and is not reinterpreted — guessing here would print a confident wrong number');
  eq(normalizeAmount('0.500'), 0.5, 'and a three-decimal cell is still three decimals');
  eq(normalizeAmount('1.500.000'), 1500000,
    'two or more groups cannot be a decimal, so THAT one is safe to read');
  eq(normalizeAmount('12.345.678'), 12345678, 'however many groups there are');
}

/* ---- 4. junk is still refused ---- */
{
  for (const cell of ['', '   ', 'N/A', 'three thousand', '--100', 'R', '$']) {
    eq(normalizeAmount(cell), null, `${JSON.stringify(cell)} is null — a wrong number is worse than no number`);
  }
}

/* ---- 5. the column heading above the cell ---- */
{
  const rows = h => [h, ['2026-01-01', 'Warung', '1.500.000', '2.000.000']];
  for (const cur of ['ZAR', 'EUR', 'IDR', 'CNY', 'USD']) {
    const got = detectStatementColumns(rows(['Date', 'Description', `Amount (${cur})`, `Balance (${cur})`]));
    ok(got, `a statement headed "Amount (${cur})" is auto-detected`);
    eq(got.iAmount, 2, `and its amount column is found — the currency in a heading is a label, not a different column`);
  }
  const plain = detectStatementColumns(rows(['Date', 'Description', 'Amount', 'Balance']));
  eq(plain.iAmount, 2, 'the unadorned heading is unaffected');

  // NEGATIVE CONTROL: a file with a date and no amount-ish column at all is
  // still not a statement, and must not start passing detection.
  eq(detectStatementColumns([['Date', 'Description', 'Notes'], ['2026-01-01', 'x', 'y']]), null,
    'a file with no amount column is still refused — the fallback widened the match, it did not remove it');
}

console.log(`PASS — a statement that is not in rand can be read: amounts and headings (${checks} checks).`);
