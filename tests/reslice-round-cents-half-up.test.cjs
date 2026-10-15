'use strict';
/* src/reslice.js roundCents rounds HALF-UP ON THE DECIMAL VALUE, like the export's.

   L8 Info (15 Oct 2026 audit). There were two roundCents in src/. The export's
   reads a figure at fifteen significant digits (which strips the binary residue)
   and rounds by moving the point in the string; reslice.js multiplied by 100 and
   called Math.round, so 1.005 (stored a hair below its half) came back 1 where
   the export says 1.01. A suggested budget amount of R1.005 per week is a real
   input (a monthly figure divided by 4.345...), and the same number printed two
   different ways in two parts of one app is this repo's recurring defect shape.

   Pinned: the half-cent cases both ways, a sweep of every half-cent boundary
   from -R20 to R20 against an integer-cents reference, agreement with
   src/budget-export.js over that sweep, and the contract the existing
   reslice suite holds (a hair below zero stays a signed zero, 12.345 -> 12.35).

     node tests/reslice-round-cents-half-up.test.cjs */
const assert = require('assert');
const { roundCents } = require('../src/reslice');
const { roundCents: exportRound } = require('../src/budget-export');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* The hand cases from the audit repro (L8/dup/roundcents.cjs). */
for (const [x, want] of [[1.005, 1.01], [2.675, 2.68], [0.015, 0.02], [10.005, 10.01], [1234.565, 1234.57], [-1.005, -1.01], [-2.675, -2.68]]) {
  eq(roundCents(x), want, `${x} rounds half away from zero on its decimal value`);
}
eq(roundCents(12.344), 12.34, 'below the half rounds down');
eq(roundCents(12.345), 12.35, 'and 12.345 up');
eq(roundCents(-12.345), -12.35, 'negative side: away from zero');
eq(roundCents(-0.001), -0, 'a hair below zero stays a signed zero (tests/reslice.test.cjs holds this)');
eq(roundCents(1e-9), 0, 'and a hair above zero is zero');
eq(roundCents(Number.NaN), Number.NaN, 'NaN passes through');

/* Every half-cent boundary: k hundredths plus half a hundredth, typed as a
   decimal string so the reference never touches floating point. */
let off = 0, disagree = 0;
for (let k = -2000; k <= 2000; k++) {
  const abs = Math.abs(k);
  const half = `${abs / 100 | 0}.${String(abs % 100).padStart(2, '0')}5`;           // e.g. 1.005
  const v = Number((k < 0 ? '-' : '') + half);
  const want = Number(((k < 0 ? -1 : 1) * (abs + 1) / 100).toFixed(2));              // half away from zero, in integers
  if (roundCents(v) !== want && !(roundCents(v) === 0 && want === 0)) off++;
  if (roundCents(v) !== exportRound(v) && !(roundCents(v) === 0 && exportRound(v) === 0)) disagree++;
}
eq(off, 0, 'no half-cent boundary in -R20..R20 rounds the wrong way');
eq(disagree, 0, 'and none rounds differently from src/budget-export.js roundCents');

console.log(`PASS reslice-round-cents-half-up (${checks} checks)`);
