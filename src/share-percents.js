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
function sharePercents(amounts) {
  const total = amounts.reduce((s, v) => s + v, 0);
  if (total <= 0) return amounts.map(() => 0);
  const floors = amounts.map(v => Math.floor((v / total) * 100));
  const remainders = amounts
    .map((v, i) => ({ i, frac: (v / total) * 100 - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let left = 100 - floors.reduce((s, v) => s + v, 0);
  const pct = floors.slice();
  for (let k = 0; k < remainders.length && left > 0; k++, left--) pct[remainders[k].i]++;
  return pct;
}

module.exports = { sharePercents };
