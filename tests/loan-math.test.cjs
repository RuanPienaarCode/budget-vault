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
  /* Regulation 42(2) Table B, mortgage agreements: "R1 100 per credit agreement,
     plus 10 % of the amount in excess of R10 000 … But never to exceed R5 250".
     R5 250 × 1.15 = R6 037.50. This pinned 6563 against a cap of R5 707, a
     figure that appears in no version of the regulation. */
  eq(p.mortgageInitiationFee(loan), 6038, 'NCA initiation fee, capped at R5 250 + VAT');
  // R30 000 is small enough to stay under the cap: 1 100 + 10% of the 20 000
  // above R10 000 = R3 100, + VAT = R3 565. From R51 500 up the cap governs.
  eq(p.mortgageInitiationFee(30000), 3565,
    'and below the cap it is the published formula from R1 100, not R1 207');

  const onceOff = duty + p.bondCost(loan) + p.transferCost(price) + p.mortgageInitiationFee(loan);
  // 61813 before the initiation-fee correction; the R525 delta is that fee alone
  // (R6 563 → R6 038), duty and the two conveyancing anchors are unchanged here
  // because a R1.5m purchase sits well below the brackets that were wrong.
  eq(onceOff, 61288, 'total once-off buying costs');
  eq(deposit + onceOff, 211288, 'cash needed upfront');

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
  /* Vehicle finance is an "OTHER CREDIT AGREEMENT" under Regulation 42(2)
     Table B, not a mortgage: R165 plus 10% above R1 000, capped at R1 050 ex
     VAT. Any car worth financing is past the cap, so the answer is the cap —
     R1 050 × 1.15 = R1 207.50.

     This asserted 3622 while the function charged 1% of the financed amount
     against the R5 707 MORTGAGE cap: more than five times the statutory
     maximum, under a note telling the reader the fees follow the NCA caps.
     Both the 1% convention and the borrowed cap are gone; the regulation
     publishes a formula, so the app uses the formula. */
  eq(p.vehicleInitiationFee(finance), 1208, 'vehicle initiation fee — the "other credit agreement" cap, VAT included');
  /* The "other credit agreement" cap binds from R9 850 up (165 + 10% of the
     8 850 above R1 000 = 1 050), so every vehicle loan a person would actually
     take pays exactly the cap. Below it the published formula governs: R5 000
     gives 165 + 400 = R565, + VAT = R649.75. */
  eq(p.vehicleInitiationFee(5000), 650,
    'below the cap it is the published formula, not a percentage of the loan');
  eq(p.vehicleInitiationFee(10000000), Math.round(1050 * 1.15),
    'and it caps at R1 050 + VAT, NOT at the mortgage cap');
  // Regulation 44: R60 ex VAT = R69.00. Was R74.50, which matches no version of
  // the regulation — it was R50 before 6 May 2016 and R60 after.
  eq(Math.round(p.serviceFee * 60), 4140, 'service fees over the term');

  // Total cost of ownership INCLUDES the deposit — it is money spent on the car.
  eq(Math.round(deposit + t.totalRepaid + p.vehicleInitiationFee(finance) + p.serviceFee * 60), 451288,
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

/* ---- a 0% loan never reports interest, in either direction ----
   The true answer at i = 0 is exactly 0, but `exact` (the unrounded
   instalment) is rarely an integer, so rounding it to the instalment shown
   multiplied a few cents of drift by every month in the term and produced an
   arbitrary, often negative, "Total interest" underneath an amortisation
   table that showed R0 in every row. Pinned on the SHIPPED vehicle defaults
   (previously "Total interest R -18", "Total repaid R 314 982" borrowing
   R315 000), plus a sweep so this cannot regress through some OTHER
   principal/term combination the worked examples don't happen to hit. */
{
  const price = 350000, deposit = price * 0.10, finance = price - deposit;
  const t = L.totalsFor(finance, 0, 54);
  eq(t.totalInterest, 0, 'a 0% loan reports exactly zero interest, not a rounding artefact');
  eq(t.totalRepaid, finance, 'a 0% loan repays exactly what was borrowed');

  let sawNonZero = 0;
  for (let principal = 1000; principal <= 500000; principal += 1373) {
    for (let months = 6; months <= 72; months += 7) {
      const r = L.totalsFor(principal, 0, months);
      if (r.totalInterest !== 0 || r.totalRepaid !== principal) sawNonZero++;
    }
  }
  eq(sawNonZero, 0, 'no 0% loan in the sweep reports non-zero interest or a repaid total off the principal');
}

/* ---- the amortisation schedule stops at the balloon floor, never past it ----
   A rounded instalment on a small principal can clear the loan before the
   final month; with no early exit the schedule kept "repaying" a balance
   already at zero, driving it negative and reporting NEGATIVE interest for
   every remaining month. R11 000 over 360 months at 11% used to go negative
   from month 354, bottoming at -R575.23, and `byYear` folded that into year
   30 reading +R0.87 where the truth is roughly R18. */
{
  const principal = 11000, rate = 11, months = 360;
  const payment = L.totalsFor(principal, rate, months).payment;
  const rows = L.amortise(principal, rate, months, payment);
  ok(rows.every(r => r.closing >= 0), 'the schedule never carries a negative balance');
  ok(rows.every(r => r.interest >= 0), 'the schedule never reports negative interest');
  ok(rows.length < months, 'a rounded instalment that overshoots ends the schedule before the nominal term');
  eq(rows[rows.length - 1].closing, 0, 'the schedule still lands exactly on zero');
}

/* ---- SARS bracket boundaries ---- */
{
  eq(L.zaTransferDuty(1210000), 0, 'nothing is due at the top of the nil band');
  near(L.zaTransferDuty(1663800), 13614, 0.01, 'bracket 2 ends on its published base');
  near(L.zaTransferDuty(2329300), 53544, 0.01, 'bracket 3 ends on its published base');
  near(L.zaTransferDuty(2994800), 106784, 0.01, 'bracket 4 ends on its published base');
  near(L.zaTransferDuty(13310000), 1241456, 0.01, 'bracket 5 ends on its published base');
  ok(L.zaTransferDuty(20000000) > L.zaTransferDuty(13310000), 'the top bracket keeps rising');

  /* Worked cases from the published table, so a future edit has to move a figure
     a reader can check against SARS rather than only an internal boundary. */
  near(L.zaTransferDuty(5000000), 327356, 0.01, 'R5m: 106 784 + 11% of the 2 005 200 above 2 994 800');
  near(L.zaTransferDuty(3149000), 123746, 0.01, 'R3 149 000 sits inside the 11% band, not at the top of the 8% one');
  near(L.zaTransferDuty(20000000), 2111156, 0.01, 'R20m: 1 241 456 + 13% of the 6 690 000 above 13 310 000');

  /* THE GUARD THAT WOULD HAVE CAUGHT THE FABRICATION.

     A real SARS table is exactly self-consistent: each bracket's published base
     IS the duty at its own lower bound, so compounding the band below reproduces
     it to the cent. The table this file shipped until now was not — chaining the
     11% band to its stated top gave R1 103 785 against a stated base of
     R1 103 783, and that two-rand gap was explained away in a comment as a SARS
     rounding quirk, then papered over with a Math.min clamp and defended by a
     per-rand seam sweep. It was not a quirk. It was the arithmetic of a table
     nobody published, and the brackets either side matched no SARS year.

     Asserting the invariant rather than the numbers is what makes this
     structural: a base that does not equal the compounded value below it is a
     base nobody published, whatever provenance is claimed for it. */
  // [lower bound, published base at that bound, marginal rate above it]
  const BANDS = [
    [1210000, 0, 0.03], [1663800, 13614, 0.06], [2329300, 53544, 0.08],
    [2994800, 106784, 0.11], [13310000, 1241456, 0.13],
  ];
  for (let i = 1; i < BANDS.length; i++) {
    const [from, base, rate] = BANDS[i - 1];
    const [nextFrom, nextBase] = BANDS[i];
    near(base + (nextFrom - from) * rate, nextBase, 0.005,
      `the base at R${nextFrom} must equal the duty compounded from R${from} — exactly, not to within a few rand`);
  }

  // Monotonic across the whole table — a mis-keyed base would show up as a
  // purchase price where paying MORE for the house costs LESS in duty.
  let prev = -1;
  for (let v = 0; v <= 15000000; v += 25000) {
    const d = L.zaTransferDuty(v);
    assert.ok(d >= prev, `transfer duty must never fall — dipped at R${v}`);
    prev = d;
  }
  checks++;

  /* A per-rand sweep across every seam used to sit here, hunting a two-rand dip
     that the coarse stride above steps over. It is deliberately GONE, along with
     the Math.min clamp in loan-math.js that it was written to prove correct.
     Both existed only because the table was fabricated: the real one compounds
     exactly (asserted above), so there is no discontinuity left to clamp and
     nothing for a seam sweep to find. Left in place they would read as evidence
     that the dip is a real property of SARS's table and invite the next reader
     to reconstruct the wrong figures from them. */
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

/* ---- the home costs card must charge the fee it advertises ---- */
/* recalcHome() in src/views/loans.js never read p.serviceFee, while
   recalcCar() (same file) does — and the ZA profile's own costsNote, printed
   on the HOME costs card, literally reads "monthly service fee R69.00". So the
   page stated the fee and never charged it: R69 x 240 months is R16 560
   missing from a 20-year bond, invisible in the exact monthly figure a buyer
   checks affordability against.

   Two things are pinned here. First, the arithmetic recalcHome() now folds in
   — split into a pure, DOM-free function and published via ctx.provide() the
   same way src/views/budgets.js publishes otherShapeBudgets()/carryStructure()
   for the same reason: src/dom.js's el() calls document.createElement, so
   recalcHome() itself cannot run in bare node. Second, a source-text guard so
   a future edit that stops CALLING the fold (leaving it defined but unused,
   the exact shape of the original bug) fails the build rather than passing
   silently — tests/settings-parity.test.cjs uses the same text-anchored
   technique for the same reason: a DOM-free check cannot see what never ran. */
{
  const fs = require('fs');
  const path = require('path');
  const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
  stubObsidian();

  const ctx = makeCtx({}, { settings: { country: 'za' } });
  ctx.registerDirty = () => {};
  require('../src/views/loans')(ctx);
  ok(typeof ctx.homeServiceFeeFold === 'function',
    'src/views/loans.js publishes homeServiceFeeFold via ctx.provide, same pattern as budgets.js');

  const p = L.loanProfileFor('za');
  eq(p.serviceFee, 69, 'sanity: the ZA NCA-capped monthly service fee is R69.00 (R60 + 15% VAT)');

  const withFee = ctx.homeServiceFeeFold(13935, p.serviceFee, 240);
  eq(withFee.monthlyTotal, 14004, 'R13 935 repayment + R69 service fee = R14 004 a month, not R13 935');
  eq(withFee.termTotal, 16560, 'R69 x 240 months = R16 560 over a 20-year bond — the figure the bug dropped');

  const noFee = ctx.homeServiceFeeFold(9000, 0, 120);
  eq(noFee.monthlyTotal, null, 'a country/profile with no service fee gets no Total-per-month row — matches recalcCar\'s if(service>0) gate');
  eq(noFee.termTotal, 0, 'and no Service-fees-over-the-term row either');

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'loans.js'), 'utf8');
  const recalcHome = src.slice(src.indexOf('function recalcHome('), src.indexOf('\n  /* --------------------------- vehicle finance'));
  ok(/p\.serviceFee/.test(recalcHome), 'recalcHome() must read p.serviceFee — this is the exact line the original bug omitted');
  ok(/homeServiceFeeFold\(/.test(recalcHome), 'recalcHome() must actually CALL the fold, not just define it unused');
  ok(/'Monthly service fee'/.test(recalcHome), 'recalcHome() must render the Monthly service fee row');
  ok(/'Total per month'/.test(recalcHome), 'recalcHome() must render the Total per month row, folding the fee in like recalcCar does');
  ok(/'Service fees over the term'/.test(recalcHome), 'recalcHome() must render the Service fees over the term row');
}

console.log(`PASS — loan maths, SARS duty brackets and cost profiles intact (${checks} checks).`);
