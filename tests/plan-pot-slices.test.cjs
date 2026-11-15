'use strict';
/* THE PLAN HERO'S BAR: one slice per bucket, and widths that are the plan's own figures.

   The Plan page draws the pot as one bar cut into its buckets (plan-math.js
   potSlices). Three things about it must hold on every plan, including the
   broken ones, and each is the page's recurring failure shape if it does not:

     1. The widths total exactly 100. A row that sums to 100.01 wraps its last
        slice; one that sums to 99.98 leaves a gap that reads as money missing.
     2. The free slice is max(0, placeable) of the bar — the same figure the
        hero prints as "Left to allocate", from the same per-bucket claim. Two
        figures for one thing derived by two rules is what this module exists
        to prevent.
     3. A slice's inner widths are envelopeBar's, so an overspent bucket shows
        its overrun inside its own slice and still totals 100.

   And bucketScale is the largest claim, so a row's bar length is comparable
   down the column.

   Synthetic plans only.   node tests/plan-pot-slices.test.cjs */

const assert = require('assert');
const { planSummary, potSlices, bucketScale, envelopeBar, round2 } = require('../src/plan-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const total = r => round2(r.slices.reduce((t, s) => t + s.width, 0) + r.orphan + r.free);

/* ---- the fixture the preview harness ships: healthy, R 6 550 unallocated ---- */
const BABY = {
  sources: [{ amount: 40000 }, { amount: 8000, status: 'expected' }, { amount: 6500, status: 'expected' }, { amount: 1500 }],
  envelopes: [{ name: 'Settle up', amount: 11600 }, { name: 'Keep back', amount: 18000 }, { name: 'Coming up', amount: 4500 },
    { name: 'For the baby', amount: 12300 }, { name: 'For the house', amount: 1850 }, { name: 'For us', amount: 1200 }],
  items: [{ envelope: 'Settle up', amount: 8420, spent: 8420 }, { envelope: 'For the baby', amount: 900, spent: 640 },
    { envelope: 'For the house', amount: 1850, spent: 1812.99 }],
};
{
  const r = potSlices(BABY), sum = planSummary(BABY);
  eq(r.span, 56000, 'a plan inside its pot spans the pot');
  eq(r.slices.map(s => s.name), BABY.envelopes.map(e => e.name), 'one slice per bucket, in file order');
  eq(total(r), 100, 'the widths total exactly 100');
  eq(r.freeAmount, sum.placeable, 'the free slice is the hero\'s "left to allocate"');
  eq(r.free, round2(100 - r.slices.reduce((t, x) => t + x.width, 0)), 'and its width is what the slices leave of the bar');
  ok(Math.abs(r.free - 6550 / 56000 * 100) < 0.02, 'within a rounding step of its true share');
  eq(r.slices[0].width, round2(11600 / 56000 * 100), 'a slice is as wide as its bucket\'s claim on the pot');
  ok(Math.abs(r.slices[1].width - 18000 / 56000 * 100) < 0.02, 'and the widest, which takes the rounding, is within a step of its own');
  const inner = envelopeBar(11600, 8420);
  eq([r.slices[0].spent, r.slices[0].left, r.slices[0].over], [inner.spent, inner.left, inner.over],
    'inside a slice: envelopeBar\'s three widths');
  eq(bucketScale(BABY), 18000, 'the scale is the largest claim');
}

/* ---- the audit's example: one bucket run over, nothing past the pot ----
   Pot 10 000, three buckets of 3 000, A spent 4 500 and B 1 000. The claims
   are 4 500 + 3 000 + 3 000 = 10 500, so placeable is −500 and there is no
   free slice at all: the bar spans the claims. */
const AUDIT = {
  sources: [{ amount: 10000 }],
  envelopes: [{ name: 'A', amount: 3000 }, { name: 'B', amount: 3000 }, { name: 'C', amount: 3000 }],
  items: [{ envelope: 'A', amount: 3000, spent: 4500 }, { envelope: 'B', amount: 1000, spent: 1000 }],
};
{
  const r = potSlices(AUDIT), sum = planSummary(AUDIT);
  eq(sum.placeable, -500, 'fixture: the buckets claim R 500 more than is left');
  eq(r.span, 10500, 'the bar spans what the buckets claim once that passes the pot');
  eq([r.free, r.freeAmount], [0, 0], 'no free slice when nothing can be allocated');
  eq(total(r), 100, 'still exactly 100');
  ok(r.slices[0].over > 0, 'the overspent bucket shows its overrun inside its own slice');
  eq(round2(r.slices[0].spent + r.slices[0].left + r.slices[0].over), 100, 'and its inner widths total 100');
  ok(r.slices[0].width > r.slices[1].width, 'a bucket that spent past what it held takes the room it spent');
  eq(bucketScale(AUDIT), 4500, 'the scale follows the spend when it is the larger');
}

/* ---- edges ---- */
eq(potSlices({ sources: [], envelopes: [], items: [] }), { span: 0, slices: [], orphan: 0, free: 0, freeAmount: 0 }, 'an empty plan draws nothing');
{
  const r = potSlices({ sources: [{ amount: 500 }], envelopes: [], items: [] });
  eq([r.slices.length, r.free], [0, 100], 'money in and no buckets: the whole bar is free');
}
{
  const r = potSlices({ sources: [{ amount: 1000 }], envelopes: [{ name: 'X', amount: 0 }, { name: 'Y', amount: 400 }], items: [] });
  eq(r.slices.map(s => s.name), ['Y'], 'a bucket holding nothing draws no slice');
}
{
  // Two rows with one name are one bucket, as on screen and in bucketClaims.
  const r = potSlices({ sources: [{ amount: 1000 }], envelopes: [{ name: 'X', amount: 200 }, { name: 'X', amount: 300 }], items: [] });
  eq([r.slices.length, r.slices[0].amount], [1, 500], 'two rows, one name: one slice holding both');
}
{
  // Spent from no bucket: gone, so it takes room, and nobody's.
  const plan = { sources: [{ amount: 1000 }], envelopes: [{ name: 'X', amount: 400 }], items: [{ envelope: 'Gone', amount: 0, spent: 250 }] };
  const r = potSlices(plan), sum = planSummary(plan);
  eq(r.orphan, 25, 'money spent from no bucket takes its own room on the bar');
  eq(r.freeAmount, sum.placeable, 'and the free slice still agrees with placeable');
  eq(total(r), 100, 'totalling 100');
}
eq(bucketScale({ envelopes: [], items: [] }), 1, 'the scale is never below 1');

/* ---- randomised: the three rules on plans nobody designed ---- */
let seed = 20261115;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
for (let n = 0; n < 400; n++) {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].slice(0, 1 + Math.floor(rnd() * 7));
  const plan = {
    sources: [{ amount: round2(rnd() * 90000) }, { amount: round2(rnd() * 9000) }],
    envelopes: names.map(name => ({ name, amount: round2(rnd() * 20000) })),
    items: names.flatMap(name => rnd() < 0.7 ? [{ envelope: name, amount: 100, spent: round2(rnd() * 26000) }] : []),
  };
  const r = potSlices(plan), sum = planSummary(plan);
  if (total(r) !== 100) assert.fail(`plan ${n}: widths total ${total(r)}`);
  if (r.slices.some(s => s.width < 0) || r.free < 0) assert.fail(`plan ${n}: a negative width`);
  if (r.slices.some(s => round2(s.spent + s.left + s.over) !== 100)) assert.fail(`plan ${n}: a slice's inner widths are not 100`);
  // To the cent, give or take the one cent two orders of rounding can differ by.
  if (Math.abs(r.freeAmount - Math.max(0, sum.placeable)) > 0.011) {
    assert.fail(`plan ${n}: free slice ${r.freeAmount} vs placeable ${sum.placeable}`);
  }
  if (sum.placeable <= 0.005 && r.free !== 0) assert.fail(`plan ${n}: a free slice with nothing to allocate`);
}
checks += 400;

console.log(`PASS plan-pot-slices (${checks} checks)`);
