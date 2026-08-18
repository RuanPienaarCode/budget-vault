'use strict';
/* Largest-remainder (Hare quota) allocation for a column of percentages that
   must sum to exactly 100 — independent `Math.round()` per slice does not: six
   equal sixths print 17 six times (102%), three equal thirds print 33 three
   times (99%), and [50,25,12.5,12.5] prints 50,25,13,13 (101%). The same
   rounded set is what gets concatenated into the donut's aria-label, so for a
   screen-reader user the gap is not cosmetic — it is the only reading of the
   chart they get.

   Each slice keeps its floor and the leftover whole points go to the slices
   with the largest fractional remainder, biggest first. Ties are broken by
   ORIGINAL INDEX rather than by trusting `Array.prototype.sort` to stay
   stable across a future refactor, so two equal slices resolve the same way
   on every render — a screen reader announcing the same chart twice must
   hear the same numbers twice.

   ONE module, imported by the two donut views. It lived as an identical
   12-line copy in each, justified as "the two views own their own files" —
   the only place in this codebase where file ownership was argued to outrank
   the "if it can be pure, it is" rule, and one more copy for the donut test
   to remember. Both views re-export it, so the test still reads each view's
   own door. Pure — no DOM, no obsidian import. */
/* The allocation itself, over already-scaled values and an arbitrary target.

   Extracted so the health card's score breakdown can share it: those parts are
   points out of a score, not percentages out of 100, but the failure is
   identical — rounding each one alone printed "0 + 26 + 17" beside a headline
   of 42, and a panel whose whole claim is that the parts explain the number
   cannot visibly disagree with it. Percentages were simply the first place this
   bit; the module header's argument for ONE copy applies just as much to the
   second caller. */
function largestRemainder(values, target) {
  const floors = values.map(v => Math.floor(v));
  const remainders = values
    .map((v, i) => ({ i, frac: v - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let left = Math.round(target) - floors.reduce((s, v) => s + v, 0);
  const out = floors.slice();
  for (let k = 0; k < remainders.length && left > 0; k++, left--) out[remainders[k].i]++;
  return out;
}

function sharePercents(amounts) {
  const total = amounts.reduce((s, v) => s + v, 0);
  if (total <= 0) return amounts.map(() => 0);
  return largestRemainder(amounts.map(v => (v / total) * 100), 100);
}

module.exports = { sharePercents, largestRemainder };
