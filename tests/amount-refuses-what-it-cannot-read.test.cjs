'use strict';
/* amount.js refuses a cell it cannot read, instead of reading a different number.

   The module's own header promises it: "a missing sign is a wrong number; a
   missing amount is a wrong number wearing an empty cell" - and the whole
   point of normalizeAmount is that the answer is null when it cannot be sure.
   The 2026-10-14 audit found three ways it was not.

   L8-01 (High). Two slips read as a confident, wrong figure:
     - the thousands-comma strip ran on any string with a comma, so "7,000,00"
       (a typed 7,000.00 with the dot slipped to a comma) read as 700 000, and
       "1,234,56" as 123 456. `readable: true`, so nothing flagged it. Reached
       end to end: a Budget.md cell left the Dashboard hero at "R 730 779
       spending budget".
     - the trailing-unit strip removed ANY 2-4 letters after the number, so
       "1 5OO" (the letter O typed for zero) read as 15 and "2OO" as 2.
   The fix keeps every convention the module documents - 3-digit comma groups
   (US/UK), Indian lakh groups, decimal comma, space and dot grouping, a
   currency code separated from the number or a known ISO code glued to it, and
   the non-ASCII markers (zl, Kc, the yen sign) - and refuses the rest.

   L4b-04 (Low). 400 digits is a finite string and Number() of it is Infinity,
   which import accepted and wrote as "Infinity" into a month file.

   L4b-02 (Low). The unit-strip regex began with an unbounded whitespace run
   and was tried from every position, so a long run of spaces (a fixed-width
   export, or a hostile cell) cost O(n^2): 80 000 spaces took 6.4 s, reached
   from detectHeaderlessColumns on every non-date cell of a headerless file.

     node tests/amount-refuses-what-it-cannot-read.test.cjs */

const assert = require('assert');
const { normalizeAmount, parseNum } = require('../src/amount');
const { detectHeaderlessColumns } = require('../src/statement');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. L8-01: a comma that is not a thousands separator is not read as one ---- */
for (const bad of ['7,000,00', '1,234,56', '12,34,5', '1,2,3', '70,00,000,0', ',500', '1,2345']) {
  eq(normalizeAmount(bad), null, `"${bad}" is not a well-formed number in any documented grouping - refused`);
  eq(parseNum(bad).readable, false, `"${bad}" is reported unreadable, so the schema keeps its raw text`);
}

/* every grouping the module documents still reads */
const good = [
  ['7,000.00', 7000], ['1,234,567.89', 1234567.89], ['1,234', 1234], ['999,999', 999999],
  ['5,00,000', 500000], ['1,23,456', 123456], ['1,00,00,000', 10000000], ['1,00,000.50', 100000.5], ['12,345', 12345],
  ['1 234,56', 1234.56], ['1.234,56', 1234.56], ['12,5', 12.5], ['12,50', 12.5],
  ['1 234 567', 1234567], ['1.500.000', 1500000], ['-1,234.50', -1234.5], ['(1,234.50)', -1234.5],
  ['R 1,234.56', 1234.56], ['$1,200', 1200], ['1,234.56-', -1234.56], ['1,234.56 Cr', 1234.56],
  ['1,234.56 Dr', -1234.56], ['.50', 0.5], ['100', 100], ['0.00', 0], ['18.5%', 18.5],
];
for (const [s, want] of good) eq(normalizeAmount(s), want, `"${s}" still reads as ${want}`);

/* ---- 2. L8-01: letters glued to the number are a unit only when they are one ---- */
for (const bad of ['1 5OO', '2OO', '15OO', '1,2OO', '1O0', '100abc', '5l0']) {
  eq(normalizeAmount(bad), null, `"${bad}" has letters that are not a currency code - refused`);
}
const units = [
  ['1234.56 ZAR', 1234.56], ['1234.56ZAR', 1234.56], ['50CHF', 50], ['1 234,56 EUR', 1234.56],
  ['100 usd', 100], ['1,200円', 1200], ['1,200元', 1200], ['25 zł', 25], ['25zł', 25], ['99 Kč', 99],
  ['99Kč', 99], ['1 000 Ft', 1000], ['100 kr', 100], ['1 234,56 €', 1234.56], ['1234.56€', 1234.56],
  ['R150', 150], ['Rp 1.500.000', 1500000], ['US$1,200', 1200], ['1234 ABC', 1234],
];
for (const [s, want] of units) eq(normalizeAmount(s), want, `"${s}" keeps reading as a unit-suffixed ${want}`);

/* prose is still prose */
for (const prose of ['about 15 000', '15 000 about', 'three thousand', 'N/A', '12 000 R', '--100', '']) {
  eq(normalizeAmount(prose), null, `"${prose}" stays unreadable`);
}

/* ---- 3. L4b-04: a number too big to hold is not a number ---- */
eq(normalizeAmount('9'.repeat(400)), null, 'a 400-digit amount is refused, not read as Infinity');
eq(normalizeAmount('1' + '0'.repeat(309)), null, '1e309 is refused');
eq(normalizeAmount('1' + '0'.repeat(300)), 1e300, 'while 1e300 is still a finite number');
eq(parseNum('9'.repeat(400)).readable, false, 'and the strict reader calls it unreadable');

/* ---- 4. L4b-02: linear in the length of a whitespace run ---- */
{
  const ms = f => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
  const N = 80000;
  const [tSpaces, rSpaces] = ms(() => normalizeAmount('1' + ' '.repeat(N) + '!'));
  eq(rSpaces, null, 'a number, a long run of spaces, then punctuation is unreadable');
  ok(tSpaces < 500, `80 000 spaces read in ${tSpaces.toFixed(0)} ms (was ~6 400 ms; budget 500 ms)`);
  const [tUnit, rUnit] = ms(() => normalizeAmount('1' + ' '.repeat(N) + 'ZAR'));
  eq(rUnit, 1, 'a long run of spaces before a real unit still reads');
  ok(tUnit < 500, `and takes ${tUnit.toFixed(0)} ms`);
  const cell = '1' + ' '.repeat(40000) + '!';
  const rows = [['2026-01-01', cell, cell], ['2026-01-02', 'SHOP', '-5.00'], ['2026-01-03', 'SHOP', '-6.00']];
  const [tHeaderless] = ms(() => detectHeaderlessColumns(rows, true));
  ok(tHeaderless < 500, `detectHeaderlessColumns over a 40 000-space cell takes ${tHeaderless.toFixed(0)} ms (budget 500 ms)`);
}

console.log(`PASS amount-refuses-what-it-cannot-read (${checks} checks)`);
