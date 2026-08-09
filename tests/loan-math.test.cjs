'use strict';
/* Loan maths guard test.

   src/loans.js is the one place in the plugin that produces a number a reader
   might act on with real money, so the arithmetic is pinned against two fully
   worked examples plus the published SARS bracket boundaries. A silent change
   to a rate, a bracket base or the rounding rule fails the build.

   Runs in bare node — loans.js has no `obsidian` dependency, so no stub needed.
   Wired into ./build.sh.

     node tests/loans.test.cjs      # exits non-zero on any failure */

const assert = require('assert');
const L = require('../src/loan-math');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => {
  assert.ok(Math.abs(a - b) <= tol, `${m} — got ${a}, expected ${b} ± ${tol}`);
  checks++;
};
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- worked example 1: R1.5m home, 10% deposit, 11%, 20 years ---- */
{
  const price = 1500000, deposit = price * 0.10, loan = price - deposit;
  eq(loan, 1350000, 'loan amount');

  const t = L.totalsFor(loan, 11, 240);
  eq(t.payment, 13935, 'monthly repayment on R1 350 000 over 20 years at 11%');
  eq(t.totalRepaid, 3344400, 'total repaid = rounded instalment x 240');
  eq(t.totalInterest, 1994400, 'total interest');

  const duty = L.zaTransferDuty(price);
  eq(duty, 8700, 'SARS transfer duty on R1 500 000 (3% of the excess over R1 210 000)');

  const p = L.loanProfileFor('za');
  eq(p.bondCost(loan), 23550, 'bond registration estimate on a R1 350 000 bond');
  eq(p.transferCost(price), 23000, 'transfer cost estimate on a R1 500 000 purchase');
  eq(p.mortgageInitiationFee(loan), 6563, 'NCA initiation fee, capped at R5 707 + VAT');

  const onceOff = duty + p.bondCost(loan) + p.transferCost(price) + p.mortgageInitiationFee(loan);
  eq(onceOff, 61813, 'total once-off buying costs');
  eq(deposit + onceOff, 211813, 'cash needed upfront');

  // The schedule has to reconcile with the headline instalment, not drift off it.
  const rows = L.amortise(loan, 11, 240, t.payment);
  eq(rows.length, 240, 'one row per month');
  eq(rows[rows.length - 1].closing, 0, 'the last month lands exactly on zero');
  near(rows.reduce((s, r) => s + r.interest, 0), t.totalInterest, 500,
    'schedule interest agrees with the headline total');

  const years = L.byYear(rows);
  eq(years.length, 20, 'one row per year');
  eq(years[0].opening, loan, 'year 1 opens on the full loan');
  eq(years[19].closing, 0, 'year 20 closes on zero');
  ok(years[0].interest > years[19].interest, 'interest falls as the balance amortises');
}

/* ---- worked example 2: R350k vehicle, 10% deposit, 11%, 60 months ---- */
{
  const price = 350000, deposit = price * 0.10, finance = price - deposit;
  eq(finance, 315000, 'finance amount');

  const t = L.totalsFor(finance, 11, 60);
  eq(t.payment, 6849, 'monthly repayment on R315 000 over 60 months at 11%');
  eq(t.totalRepaid, 410940, 'total repaid');
  eq(t.totalInterest, 95940, 'total interest');

  const p = L.loanProfileFor('za');
  /* INCLUDING VAT (1% of R315 000 = R3 150, grossed up at 15%), like the
     mortgage initiation fee and like what the lender actually debits. This was
     3150 while the function capped an ex-VAT 1% against a VAT-inclusive cap and
     returned it raw — two bases in one expression, and the same amount read
     R2 000 here against R6 563 on the mortgage path. */
  eq(p.vehicleInitiationFee(finance), 3622, 'vehicle initiation fee, VAT included');
  eq(p.vehicleInitiationFee(10000000), Math.round(5707 * 1.15),
    'and it caps at the same NCA maximum the mortgage fee does');
  eq(p.serviceFee * 60, 4470, 'service fees over the term');

  // Total cost of ownership INCLUDES the deposit — it is money spent on the car.
  eq(deposit + t.totalRepaid + p.vehicleInitiationFee(finance) + p.serviceFee * 60, 454032,
    'total cost of ownership');
}

/* ---- balloon payments ---- */
{
  const withBalloon = L.totalsFor(315000, 11, 60, 315000 * 0.30);
  const without = L.totalsFor(315000, 11, 60);
  ok(withBalloon.payment < without.payment, 'a balloon lowers the instalment');
  ok(withBalloon.totalInterest > without.totalInterest,
    'a balloon costs more interest overall — the point of the whole card');
  eq(withBalloon.balloon, 94500, 'balloon amount');

  const rows = L.amortise(315000, 11, 60, withBalloon.payment, withBalloon.balloon);
  eq(rows[rows.length - 1].closing, 94500, 'the schedule ends on the balloon, not on zero');
}

/* ---- edge cases that would otherwise produce NaN or Infinity on screen ---- */
{
  eq(L.monthlyPayment(0, 11, 240), 0, 'no principal → no instalment');
  eq(L.monthlyPayment(100000, 11, 0), 0, 'no term → no instalment (not a division by zero)');
  eq(L.monthlyPayment(120000, 0, 60), 2000, 'a 0% deal amortises linearly');
  eq(L.zaTransferDuty(0), 0, 'no price → no duty');
  eq(L.totalsFor(100000, 11, 60, 200000).balloon, 100000, 'a balloon cannot exceed the loan');
  eq(L.amortise(0, 11, 0, 0).length, 0, 'an empty loan has an empty schedule');
}

/* ---- SARS bracket boundaries ---- */
{
  eq(L.zaTransferDuty(1210000), 0, 'nothing is due at the top of the nil band');
  near(L.zaTransferDuty(1663800), 13614, 0.01, 'bracket 2 ends on its published base');
  near(L.zaTransferDuty(2329300), 53544, 0.01, 'bracket 3 ends on its published base');
  near(L.zaTransferDuty(3149000), 119120, 0.01, 'bracket 4 ends on its published base');
  near(L.zaTransferDuty(12100500), 1103783, 3, 'bracket 5 ends on its published base');
  ok(L.zaTransferDuty(20000000) > L.zaTransferDuty(12100500), 'the top bracket keeps rising');

  // Monotonic across the whole table — a mis-keyed base would show up as a
  // purchase price where paying MORE for the house costs LESS in duty.
  let prev = -1;
  for (let v = 0; v <= 15000000; v += 25000) {
    const d = L.zaTransferDuty(v);
    assert.ok(d >= prev, `transfer duty must never fall — dipped at R${v}`);
    prev = d;
  }
  checks++;

  /* Again at every SEAM, one rand at a time. The R25 000 stride above steps
     from R12 100 000 straight to R12 125 000 and jumps clean over the only
     place the table actually dipped: compounding the 11% band to the top of
     bracket 5 gives R1 103 785, while SARS publishes R1 103 783 as bracket 6's
     base — so duty fell by two rand as the price rose by one. Real, invisible
     to a coarse sweep, and indefensible in a figure the file calls exact
     arithmetic on the published table. */
  for (const seam of [1210000, 1663800, 2329300, 3149000, 12100500]) {
    let p2 = -1;
    for (let v = seam - 3; v <= seam + 3; v++) {
      const d = L.zaTransferDuty(v);
      assert.ok(d >= p2, `transfer duty dipped crossing the seam at R${seam} (at R${v})`);
      p2 = d;
    }
    checks++;
  }
  near(L.zaTransferDuty(12100500), 1103783, 0.01,
    'and the top seam lands exactly on the published base, not two rand above it');
}

/* ---- countries without a cost profile still get the calculator ---- */
{
  const p = L.loanProfileFor('uk');
  eq(p.hasBuyingCosts, false, 'no buying-costs card outside South Africa');
  eq(p.transferDuty(1500000), 0, 'no duty asserted for a country with no table');
  for (const k of Object.keys(L.GENERIC_LOAN_PROFILE)) {
    ok(k in L.LOAN_PROFILES.za, `the za profile must carry every key the view reads (missing ${k})`);
  }
}

console.log(`PASS — loan maths, SARS duty brackets and cost profiles intact (${checks} checks).`);
