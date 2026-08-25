'use strict';
/* Guard tests for sharePercentLabel (share-percents.js) — the one rule for
   printing a share as a percent label without rounding a real over- or
   under-allocation back onto the 100% boundary.

   The shipped defect: "100% allocated" (and "100% of budgeted income") printed
   beside a red "over-budgeted R 97,80" tile, because 100.24% rounds to 100 —
   the label ate the only fact the two tiles disagreed on. The rule is used by
   the Dashboard hero, the Budget page's totals strip and the Score page's
   budget chip, so one wrong turn here mislabels all three at once.

     node tests/share-percent-label.test.cjs
*/

const assert = require('assert');
const { sharePercentLabel } = require('../src/share-percents');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* Away from the boundary, the label is the same whole percent every caller
   printed before this rule existed. */
eq(sharePercentLabel(0.5, ','), '50', 'an ordinary share is a plain whole percent');
eq(sharePercentLabel(0.053, ','), '5', 'small shares round as they always did');
eq(sharePercentLabel(1, ','), '100', 'exactly 100% prints 100');
eq(sharePercentLabel(1.006, ','), '101', 'past the boundary, plain rounding is unchanged (100.6 -> 101)');
eq(sharePercentLabel(1.2, ','), '120', 'well past it too');

/* The boundary itself: never collapse a real over- or under-allocation onto
   exactly 100. */
eq(sharePercentLabel(40893 / 40795.2, ','), '100,2', 'the shipped case: 100.24% must not read as exactly 100');
eq(sharePercentLabel(0.997, ','), '99,7', 'symmetric: 99.7% must not claim the plan is fully allocated');
eq(sharePercentLabel(1.0004, ','), '100,04', 'one decimal still reading 100.0 escalates to two');
eq(sharePercentLabel(1.00001, ','), '100', 'within half a hundredth of a percent, 100 is the honest label');

/* Formatting details. */
eq(sharePercentLabel(1.002, '.'), '100.2', 'the caller\'s decimal separator is used verbatim');
eq(sharePercentLabel(1.002), '100.2', 'no separator falls back to a dot');
eq(sharePercentLabel(NaN, ','), '0', 'non-finite input degrades to 0, matching formatMoney\'s own guard');
eq(sharePercentLabel(undefined, ','), '0', 'a missing share degrades the same way');

console.log(`PASS  share-percent-label.test.cjs  (${checks} checks)`);
