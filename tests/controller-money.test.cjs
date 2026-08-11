'use strict';
/* money() must never render a broken number as garbage.

   `(NaN).toFixed(2)` is the string "NaN", which has no '.' to split on, so
   `"NaN".split('.')[1]` is undefined and the old code rendered "R
   NaN,undefined" — a garbage figure sitting next to every real one on the
   Dashboard. Same story for Infinity ("R Infinity,undefined"). -0 was already
   safe ("R 0,00") and is pinned here as the negative control that proves the
   guard isn't just forcing every input through 0.

   No loader coercion or render-path division has been found to reach money()
   with a non-finite value — every one already guards. This is a
   latent-hazard guard, not a regression test for a proven path.

   formatMoney is the pure core pulled out of controller.js's moneyIn() so it
   is testable without a live mount. Pure — no DOM, no obsidian import.
     node tests/controller-money.test.cjs
*/

const assert = require('assert');
require('./helpers/harness.cjs').stubObsidian();
const { formatMoney } = require('../src/controller');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const ZA = { thousands: ' ', decimal: ',' };

/* ---------------------------------------------------------- the guard */
eq(formatMoney('R', NaN, 2, ZA), 'R 0,00', 'NaN renders as zero, not "NaN,undefined"');
eq(formatMoney('R', Infinity, 2, ZA), 'R 0,00', 'Infinity renders as zero, not "Infinity,undefined"');
eq(formatMoney('R', -Infinity, 2, ZA), 'R 0,00', 'and -Infinity the same way');

/* -------------------------------------------- the negative control:
   -0 was already safe before this guard — prove the fix doesn't route every
   input through the same zero for the wrong reason. */
eq(formatMoney('R', -0, 2, ZA), 'R 0,00', '-0 stays safe (this already worked)');

/* ------------------------------------------------- ordinary values, unchanged */
eq(formatMoney('R', 1234.5, 2, ZA), 'R 1 234,50', 'ordinary positive amount, thousands + decimal separators');
eq(formatMoney('R', -1234.5, 2, ZA), 'R -1 234,50', 'ordinary negative amount keeps its sign');
eq(formatMoney('R', 0, 0, ZA), 'R 0', 'decimals=0 drops the fractional part entirely');

console.log(`controller-money.test.cjs — ${checks} checks OK`);
