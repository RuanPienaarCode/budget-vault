'use strict';
/* The headline and the table under it are one loan, so they get one basis.

   `totalsFor` computed `totalRepaid = payment * n + b` — the instalment times
   the term the reader ASKED for. `amortise` draws the schedule and does two
   things that arithmetic cannot see:

     · it FORCES the last row onto the balloon (0 for a normal loan), because
       a rounded instalment leaves a few cents of drift over 240 months and a
       schedule ending at "R 3 outstanding" reads as a bug; so the final
       payment is not a full instalment,
     · and it BREAKS EARLY when the rounded instalment overshoots — a small
       principal over a long term clears before month n.

   Both make the schedule shorter or cheaper than `payment * n`, and neither
   was reflected in the figure printed above it. R15 000 at 11% over 360
   months announced R36 480 of interest over a table that runs 358 months and
   totals R36 059: a R421 gap, on a card whose whole promise is arithmetic the
   reader can check. On the shipped R1.35m home-loan example the gap is R395
   in the other direction — the headline claiming more repaid than the
   schedule ever collects.

   So the totals are read OFF the schedule now. That is a stronger version of
   the original argument, not a retreat from it: the reader could always check
   "R13 935 × 240" on a phone, and can now check the table they are already
   looking at instead.

     node tests/loan-schedule-identity.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const L = require('../src/loan-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => {
  assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++;
};

const scheduleOf = (p, rate, n, b = 0) => {
  const t = L.totalsFor(p, rate, n, b);
  return { t, rows: L.amortise(p, rate, n, t.payment, b) };
};
const sumInterest = rows => rows.reduce((s, r) => s + r.interest, 0);

/* ---- 1. the case that made the gap impossible to miss ---- */
{
  const { t, rows } = scheduleOf(15000, 11, 360);
  ok(rows.length < 360, 'a rounded instalment on a small principal clears the loan early — the schedule is shorter than the term asked for');
  eq(t.termMonths, rows.length, 'and the totals say so, rather than reporting a term the schedule never ran');
  eq(t.totalInterest, sumInterest(rows),
    'the headline interest IS the schedule\'s interest — not a second figure derived a second way');
  ok(t.totalInterest < 36480,
    'and it is no longer the payment × 360 figure, which charged interest for two months the loan was already paid off');
}

/* ---- 2. the identity holds everywhere, not just where it was noticed ----

   A sweep rather than three worked examples: the defect only shows up when
   the rounding happens to overshoot, and which combinations do that is not
   something anyone can pick by hand. Exact equality, not a tolerance — the
   two figures are now the same sum, so any drift at all means they have been
   derived twice again. */
{
  let cases = 0;
  for (const p of [1000, 11000, 15000, 250000, 315000, 1350000]) {
    for (const rate of [0, 4, 11, 18.5, 24]) {
      for (const n of [6, 54, 60, 120, 240, 360]) {
        for (const bPct of [0, 0.3]) {
          const b = Math.round(p * bPct);
          const { t, rows } = scheduleOf(p, rate, n, b);
          assert.strictEqual(t.totalInterest, sumInterest(rows),
            `headline interest === schedule interest for ${p}@${rate}%/${n} balloon ${b}`);
          assert.strictEqual(t.termMonths, rows.length,
            `realised term === schedule length for ${p}@${rate}%/${n} balloon ${b}`);
          /* Total cash out = every row's interest and capital, plus the
             balloon settled at the end. Which reduces to principal + interest,
             and that reduction is worth pinning: it is the reason the 0% case
             below needs no special-casing any more. */
          near(t.totalRepaid,
            rows.reduce((s, r) => s + r.interest + r.capital, 0) + t.balloon, 1e-6,
            `total repaid === what the schedule actually collects for ${p}@${rate}%/${n} balloon ${b}`);
          cases++;
        }
      }
    }
  }
  checks += 3;
  ok(cases > 300, `the sweep really covered the space (${cases} loans)`);
}

/* ---- 3. a 0% loan borrows exactly what it repays — structurally now ----

   This used to be a special case: `payment * n` multiplied a few cents of
   rounding drift by every month in the term, so the shipped vehicle defaults
   printed "Total interest R -18" above a table showing R0 in every row, and
   the fix was to hard-code 0 at rate <= 0. Off the schedule there is nothing
   to hard-code: every row's interest is `bal * 0`, so the sum is exactly zero
   and the repaid total is exactly the principal. The special case is gone,
   and this is what proves its absence is safe rather than a regression
   waiting for a reader with a 0% deal. */
{
  const finance = 350000 - 35000;
  const t = L.totalsFor(finance, 0, 54);
  eq(t.totalInterest, 0, 'a 0% loan reports exactly zero interest');
  eq(t.totalRepaid, finance, 'and repays exactly what was borrowed');

  let sawNonZero = 0;
  for (let principal = 1000; principal <= 500000; principal += 1373) {
    for (let months = 6; months <= 72; months += 7) {
      const r = L.totalsFor(principal, 0, months);
      if (r.totalInterest !== 0 || r.totalRepaid !== principal) sawNonZero++;
    }
  }
  eq(sawNonZero, 0, 'and no 0% loan in the sweep reports otherwise, with no rate special-case left to carry it');
}

/* ---- 4. a loan that runs its full term still says so ---- */
{
  const { t, rows } = scheduleOf(1350000, 11, 240);
  eq(t.termMonths, 240, 'a normal bond runs every month it was given');
  eq(t.months, 240, 'and `months` still reports the term that was ASKED for, which is a different question');
  eq(rows[rows.length - 1].closing, 0, 'landing exactly on zero');
  eq(t.totalInterest, sumInterest(rows), 'with the headline still off the schedule');
}

/* ---- 5. a balloon still costs more, which is the point of the card ---- */
{
  const withBalloon = L.totalsFor(315000, 11, 60, 315000 * 0.30);
  const without = L.totalsFor(315000, 11, 60);
  ok(withBalloon.payment < without.payment, 'a balloon lowers the instalment');
  ok(withBalloon.totalInterest > without.totalInterest, 'and costs more interest overall');
  eq(withBalloon.totalRepaid > without.totalRepaid, true, 'and more money in total');
}

console.log(`PASS  loan-schedule-identity.test.cjs  (${checks} checks)`);
