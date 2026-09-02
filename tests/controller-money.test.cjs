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

/* ---------------------------------------------- the SIGNED ZERO
   -0 above was safe only because `-0 < 0` is false in JS. Every OTHER negative
   that rounds away to nothing was not: the sign came from the UNROUNDED `v`
   while the digits came from the rounded magnitude, so the two disagreed and
   the reader got a minus sign in front of a zero.

   Both halves of that are real inputs. Summing signed floats leaves a
   remainder like -7.1e-15 behind — the very remainder currency.js's
   primaryTotal exists to collapse — so a break-even household rendered
   "R -0,00", which the Dashboard paints in danger red. And at decimals=0 (the
   compact tiles) every amount between -0,5 and 0 printed "R -0". A minus is
   the strongest claim a money label makes; it must not outlive the rounding
   that erased the number it belonged to. */
eq(formatMoney('R', -7.1e-15, 2, ZA), 'R 0,00',
  'a float remainder from summing signed values must not render as "-0,00" in danger red');
eq(formatMoney('R', -0.004, 2, ZA), 'R 0,00', 'anything under half a cent rounds to a plain zero');
eq(formatMoney('R', -0.4, 0, ZA), 'R 0', 'and at decimals=0, anything under half a unit does too');
eq(formatMoney('R', -0.005, 2, ZA), 'R -0,01', 'the boundary the other way: a figure that still rounds to a cent KEEPS its sign');
eq(formatMoney('R', -0.5, 0, ZA), 'R -1', 'and so does one that still rounds to a whole unit');

/* ------------------------------------------------- ordinary values, unchanged */
eq(formatMoney('R', 1234.5, 2, ZA), 'R 1 234,50', 'ordinary positive amount, thousands + decimal separators');
eq(formatMoney('R', -1234.5, 2, ZA), 'R -1 234,50', 'ordinary negative amount keeps its sign');
eq(formatMoney('R', 0, 0, ZA), 'R 0', 'decimals=0 drops the fractional part entirely');

/* ------------------------------------------- the two formatters are ONE rule
   src/currency.js's formatAmount is a deliberate byte-for-byte copy of this
   function — duplicated, as its own header explains, because controller.js
   pulls in `obsidian` and mounts the live app, so nothing pure can require it.
   A copy with no test holding the two together is a copy that drifts, and the
   drift this module has already paid for is views/tax.js printing the COUNTRY's
   symbol instead of the household's. Every case above, plus locale variants,
   asserted through both doors at once — so a fix applied to one and forgotten
   in the other goes red here rather than on somebody's Dashboard. */
{
  const { formatAmount } = require('../src/currency');
  const US = { thousands: ',', decimal: '.' };
  for (const [sym, v, dp, loc] of [
    ['R', 1234.5, 2, ZA], ['R', -1234.5, 2, ZA], ['R', 0, 0, ZA],
    ['R', NaN, 2, ZA], ['R', Infinity, 2, ZA], ['R', -Infinity, 2, ZA], ['R', -0, 2, ZA],
    ['R', -7.1e-15, 2, ZA], ['R', -0.004, 2, ZA], ['R', -0.4, 0, ZA],
    ['R', -0.005, 2, ZA], ['R', -0.5, 0, ZA],
    ['$', 40000, 2, US], ['€', -999.999, 2, US], ['¥', 1234567, 0, US],
  ]) {
    eq(formatAmount(sym, v, dp, loc), formatMoney(sym, v, dp, loc),
      `formatAmount must stay byte-identical to formatMoney for (${sym}, ${v}, ${dp})`);
  }
}

console.log(`controller-money.test.cjs — ${checks} checks OK`);
