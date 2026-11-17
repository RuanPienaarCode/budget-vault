'use strict';
/* "ADD THE REST" ON AN OVERSPENT BUCKET LEFT MONEY UNALLOCATED.

   A bucket's claim on the money in is max(amount, spent) (plan-math.js
   bucketClaims). The envelope card's "Add the rest" button set
   `env.amount + placeable` and the slider's ceiling was built the same way,
   so on an overspent bucket both started from the amount it HOLDS and not from
   the amount it CLAIMS, and under-filled by exactly the overrun.

   Synthetic plan: money in R 10 000; bucket A holds R 3 000 with R 4 500 spent
   (claims R 4 500); bucket B holds R 2 000. The hero says R 3 500 left to
   allocate. The old button put A at R 6 500 (claim 6 500 + B 2 000 = 8 500, so
   R 1 500 still unallocated); the right answer is R 8 000, after which the
   plan is fully placed. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { planSummary, envelopeReach } = require('../src/plan-math');

assert.strictEqual(typeof envelopeReach, 'function', 'plan-math.js exports envelopeReach');

const plan = {
  sources: [{ name: 'Salary', amount: 10000 }],
  envelopes: [{ name: 'A', amount: 3000 }, { name: 'B', amount: 2000 }],
  items: [{ envelope: 'A', amount: 4500, spent: 4500 }],
};
const sum = planSummary(plan);
assert.strictEqual(sum.placeable, 3500, 'hero: R 3 500 left to allocate');

const A = envelopeReach(3000, 4500, sum.placeable);
assert.strictEqual(A.addRest, 8000, 'Add the rest on the overspent bucket starts from its claim (4 500), not its amount');
assert.strictEqual(A.ceiling, 8000, 'its slider tops out at R 8 000');

/* The point of the button: pressing it leaves nothing to allocate. */
const after = planSummary({ ...plan, envelopes: [{ name: 'A', amount: A.addRest }, plan.envelopes[1]] });
assert.strictEqual(after.placeable, 0, 'after pressing it the hero reads nothing left to allocate');

/* Not overspent: exactly as before (amount + placeable; ceiling floor of 100). */
const B = envelopeReach(2000, 0, sum.placeable);
assert.strictEqual(B.addRest, 5500, 'healthy bucket: amount + placeable');
assert.strictEqual(B.ceiling, 5500, 'healthy bucket: ceiling = amount + placeable');
const Bspent = envelopeReach(2000, 1200, 3500);
assert.strictEqual(Bspent.addRest, 5500, 'spent below amount is not overspent: unchanged');

/* Floors: never below the current amount, never below 100. */
assert.strictEqual(envelopeReach(0, 0, 0).ceiling, 100, 'ceiling floor of 100');
assert.strictEqual(envelopeReach(500, 0, -200).ceiling, 500, 'negative placeable never shrinks the ceiling below the amount');
assert.strictEqual(envelopeReach(500, 900, -200).ceiling, 900, 'overspent with nothing placeable: ceiling is the claim');
assert.ok(envelopeReach(3000, 4500, 0).ceiling >= 3000, 'ceiling never below the current amount');

/* The view must go through the shared function, not spell the sum a second time. */
const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'plan.js'), 'utf8');
assert.ok(/envelopeReach\(/.test(view), 'plan.js calls envelopeReach');
assert.ok(!/env\.amount\s*\+\s*sum\.placeable/.test(view), 'plan.js no longer adds placeable to the held amount');
assert.ok(!/env\.amount\s*\+\s*Math\.max\(0,\s*sum\.placeable\)/.test(view), 'nor does the slider ceiling');
/* The free card's "Add to <bucket>" chips do the same job from the other side
   of the page, and were still spelling it the old way after the card was fixed
   (pre-push audit, 17 Nov 2026). No bucket's amount is raised by placeable
   anywhere in the view except through envelopeReach. */
assert.ok(!/\.amount\s*\+\s*sum\.placeable/.test(view), 'no bucket amount is raised by placeable outside envelopeReach');
assert.ok((view.match(/envelopeReach\(/g) || []).length >= 2, 'the card and the free-card chips both call it');

console.log('PASS plan-add-rest-overspent: Add the rest and the slider ceiling start from the bucket claim');
