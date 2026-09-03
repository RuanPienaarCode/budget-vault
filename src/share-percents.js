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

/* One share, printed as a percentage label — whole percents, except at the two
   boundaries where a whole percent would state the opposite of the truth.

   100% was the first. "100% allocated" printed beside a red "over-budgeted
   R 97,80" was the trap this closes: 100.24% rounds to 100, and the one thing
   that pair of tiles exists to say — which SIDE of the line the plan is on —
   was exactly what the rounding ate. The same masking runs the other way (99.7%
   printing "100%" over a real amount still unallocated), so the guard is
   symmetric.

   0% is the same trap one boundary down, and ISSUE 37 is what it cost. A
   household with an FNB card at 22.25% on R8 000 pays R148 a month of interest;
   against a R35 000 income that is 0.42%, and Math.round takes it to 0. The
   Dashboard's debt tile printed "0%" directly above its own meta line reading
   "R 148 a month" — one tile, two opposite claims, and "0%" is the one that
   reads as a verdict. It is also the exact claim health-math.js's null-vs-zero
   rule exists to prevent ("a debt whose rate nobody has typed is not a debt at
   0%"), defeated at the last step by the formatter rather than by the maths.

   So the guard is not "the 100 boundary", it is "the whole percent this label
   would land on, when landing there is itself a claim". Small is not none, and
   over is not exactly.

   Decimals appear only at those boundaries and only as many as it takes (at
   most two — a share within half a hundredth of a percent of a boundary IS that
   boundary at any precision this app can render, which is also what keeps a
   true 0 printing "0" rather than "0,00"); everywhere else the label is the
   same whole percent every caller printed before. `decimalSep` is the locale's
   own separator, the one formatMoney already prints, so "100,2%" and "R 97,80"
   agree on what a decimal looks like. */
const GUARDED = new Set([0, 100]);
function sharePercentLabel(share, decimalSep) {
  const pct = share * 100;
  if (!Number.isFinite(pct)) { return '0'; }
  const whole = Math.round(pct);
  /* `whole` is what String() would print, so -0 (from any pct in [-0.5, 0))
     compares equal to 0 here and prints "0" — the same rule formatMoney
     applies to a minus that outlived its digits. */
  if (!GUARDED.has(Math.abs(whole)) || Math.abs(pct - whole) < 0.005) { return String(whole); }
  for (let d = 1; d <= 2; d++) {
    const s = pct.toFixed(d);
    if (Number(s) !== whole) { return s.replace('.', decimalSep || '.'); }
  }
  return String(whole);
}

module.exports = { sharePercents, largestRemainder, sharePercentLabel };
