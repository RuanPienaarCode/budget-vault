'use strict';
/* Loan maths + the country-specific once-off costs behind the Loan Calculators
   view. Pure functions only — no DOM, no `obsidian`, no Node — so the whole
   file runs in bare node under tests/loans.test.cjs, and so nothing here can
   trip the iOS 15 / WebKit floor the rest of src/ has to respect.

   EVERY fee, bracket and tariff below is a DEFAULT TO VERIFY, not a quote.
   Transfer duty is the only figure here that is exact arithmetic on a published
   table; the conveyancing and bond-registration amounts are interpolated from a
   guideline tariff and will differ from a real attorney's quote, and lenders
   set their own initiation and service fees within the regulated caps. The view
   says so on the page — keep it that way if you edit this file. */

/* ---------------------------- core annuity ------------------------------ */

/* Monthly instalment for a loan of `principal` over `months` at
   `annualRatePct`, leaving `balloon` outstanding at the end (0 for a normal
   amortising loan). Standard annuity with a future value:

     PMT = (P − B·(1+i)^−n) · i / (1 − (1+i)^−n)

   A zero rate is not a rounding edge — it is what a 0% dealer deal actually is,
   and the formula above divides by zero there, so it gets its own branch. */
function monthlyPayment(principal, annualRatePct, months, balloon = 0) {
  const p = Number(principal) || 0;
  const n = Math.round(Number(months) || 0);
  const b = Math.min(Math.max(Number(balloon) || 0, 0), p);
  if (p <= 0 || n <= 0) return 0;
  const i = (Number(annualRatePct) || 0) / 100 / 12;
  if (i <= 0) return (p - b) / n;
  const f = Math.pow(1 + i, -n);
  return Math.max(0, (p - b * f) * i / (1 - f));
}

/* Month-by-month schedule. `payment` is passed in rather than recomputed so the
   schedule reconciles with the instalment the user is looking at — which is the
   ROUNDED one (see totalsFor). Recomputing to full precision here would make
   the table's closing balance disagree with the headline figure by a few rand
   for no reader-visible reason.

   The last month is forced to land exactly on the balloon (0 for a normal
   loan): rounding the instalment leaves a few cents of drift over 240 months,
   and a schedule that ends at "R 3 outstanding" reads as a bug. */
function amortise(principal, annualRatePct, months, payment, balloon = 0) {
  const i = (Number(annualRatePct) || 0) / 100 / 12;
  const n = Math.round(Number(months) || 0);
  const b = Math.min(Math.max(Number(balloon) || 0, 0), principal);
  const rows = [];
  let bal = Number(principal) || 0;
  for (let m = 1; m <= n; m++) {
    const interest = bal * i;
    let capital = payment - interest;
    let closing = bal - capital;
    /* A rounded instalment on a small principal can clear the loan before
       month `n` — with no early exit the schedule kept "repaying" a balance
       already at (or past) the balloon floor, driving `closing` negative and
       turning every remaining row's interest negative too (R11 000 over 360
       months at 11% went negative from month 354, bottoming at -R575.23;
       byYear then folded that into a year that understated its own interest
       by an order of magnitude). Clamped here exactly like the FORCED last
       row below, and for the same reason: this row didn't know in advance it
       would be the last one, but the moment it overshoots the floor, it is. */
    if (m === n || closing <= b) { capital = bal - b; closing = b; }
    rows.push({ month: m, opening: bal, interest, capital, closing });
    bal = closing;
    if (bal <= b) break;
  }
  return rows;
}

/* Collapse a schedule into one row per year — 20 rows a reader can scan, rather
   than 240 they can't. */
function byYear(rows) {
  const years = [];
  for (const r of rows) {
    const y = Math.ceil(r.month / 12);
    let e = years[y - 1];
    if (!e) e = years[y - 1] = { year: y, opening: r.opening, interest: 0, capital: 0, closing: r.closing };
    e.interest += r.interest;
    e.capital += r.capital;
    e.closing = r.closing;
  }
  return years;
}

/* The headline numbers, all derived from the ROUNDED instalment — because that
   is the number on the page, and "R 13 935 × 240" is arithmetic the reader can
   check on their own phone. Deriving the totals from the unrounded instalment
   instead would be marginally more accurate and would look wrong. */
function totalsFor(principal, annualRatePct, months, balloon = 0) {
  const exact = monthlyPayment(principal, annualRatePct, months, balloon);
  const payment = Math.round(exact);
  const n = Math.round(Number(months) || 0);
  const b = Math.min(Math.max(Number(balloon) || 0, 0), principal);
  const totalRepaid = payment * n + b;
  const p = Number(principal) || 0;
  /* A 0% loan borrows exactly what it repays — that is what 0% MEANS — but
     `exact` is rarely an integer of its own, so rounding it to the instalment
     actually shown (payment = Math.round(exact)) multiplies a few cents of
     rounding drift by every month in the term. On the shipped vehicle
     defaults (R350 000, 10% deposit, 54 months, 0%) that produced "Total
     interest R -18" in warning-coloured text sitting directly above an
     amortisation table that shows R0 interest in every single row — the page
     contradicting itself. There is no equivalent drift to hide at a real
     rate: the interest itself dwarfs a few rounded cents. So this is special-
     cased rather than generalised into a tolerance band. */
  const totalInterest = (Number(annualRatePct) || 0) <= 0 ? 0 : totalRepaid - p;
  return {
    payment, exact, months: n, balloon: b,
    totalRepaid: (Number(annualRatePct) || 0) <= 0 ? p : totalRepaid,
    totalInterest,
  };
}

/* ------------------------- South African costs -------------------------- */

/* SARS transfer duty, effective 1 April 2025 (unchanged for 1 April 2026).
   Each row is [from, to, base duty at `from`, marginal rate above `from`].

   Verified against sars.gov.za/tax-rates/transfer-duty/ on 10 August 2026.

   The four figures above R2 329 300 used to be different, and wrong: bracket
   boundaries of R3 149 000 and R12 100 500 with bases of R119 120 and
   R1 103 783, which appear in no SARS table from any year. They were assembled
   rather than copied, and the tell was arithmetic — chaining the 11% band gave
   R1 103 785 against a stated base of R1 103 783. That two-rand gap was written
   off as a SARS rounding quirk, hidden behind a Math.min clamp, and defended by
   a per-rand seam sweep in the test file. All three are gone: the published
   table compounds EXACTLY, which tests/loan-math.test.cjs now asserts as an
   invariant rather than pinning the numbers. On a R5m house the old table
   understated duty by R4 626, under a UI note calling it exact arithmetic. */
const { fact } = require('./facts');

/* The table itself lives in src/facts.js, with the SARS URL it was read from
   and the date it was last checked. It is data about the world, not logic —
   and the previous version of it was fabricated, so where it came from is
   now recorded beside it rather than in a comment nobody can verify. */
const ZA_TRANSFER_DUTY = fact('za.transfer.duty');

function zaTransferDuty(price) {
  const v = Number(price) || 0;
  if (v <= 0) return 0;
  for (let i = 0; i < ZA_TRANSFER_DUTY.length; i++) {
    const [from, to, base, rate] = ZA_TRANSFER_DUTY[i];
    if (v > to) continue;
    /* No clamp. There used to be a Math.min against the next bracket's base,
       holding down a two-rand dip that only the fabricated table produced. The
       published table compounds exactly, so the curve rises on its own and a
       clamp could now only ever mask the next data-entry error. */
    return base + (v - from) * rate;
  }
  return 0;
}

/* National Credit Act initiation fees, Regulation 42(2) Table B.

   Source: Government Gazette No. 39379, Government Notice 1080 of 6 November
   2015, in force 6 May 2016. Read from the gazette on 10 August 2026; no later
   amendment found. Verbatim, for mortgages:

     "(a) R1 100 per credit agreement, plus 10 % of the amount in excess of
      R10 000   (b) But never to exceed R5 250"

   The figures here were R1 207 and R5 707 until that read. Neither appears in
   the gazette, in the original 2006 regulations (R1 000 / R5 000), or anywhere
   else — the same assembled-not-copied shape as the transfer-duty table above,
   and asserted to the reader as a statutory maximum. VAT is added because that
   is what the lender actually debits; the caps themselves are ex VAT. */
/* Integer cents first. `5250 * 1.15` is 6037.4999999999995 in binary floating
   point, so rounding it gives R6 037 for a fee that is exactly R6 037.50 —
   a rand lost to the same artefact the split modal and the owed totals each
   had to learn about separately. Multiplying by 115 before dividing keeps the
   half-cent exact, so the rounding is the decimal one a person would do. */
const VAT_PCT = Math.round(fact('za.vat.rate') * 100);   // 115
const vatIncl = ex => (ex * VAT_PCT) / 100;
const ZA_INIT_CAP_EX_VAT = fact('za.nca.init.mortgage.cap');
const ZA_INIT_CAP = vatIncl(ZA_INIT_CAP_EX_VAT);   // R6 037.50

/* Everything that is not a mortgage — "other credit agreements", and the same
   figures the gazette gives for credit facilities, unsecured and short-term
   credit: "R165 per credit agreement, plus 10% of the amount in excess of
   R1 000 … But never to exceed R1 050". Vehicle finance lives here. */
const ZA_OTHER_INIT_BASE = fact('za.nca.init.other.base');
const ZA_OTHER_INIT_CAP_EX_VAT = fact('za.nca.init.other.cap');

function zaMortgageInitiationFee(loanAmount) {
  const a = Number(loanAmount) || 0;
  if (a <= 0) return 0;
  const exVat = Math.min(fact('za.nca.init.mortgage.base') + Math.max(0, a - 10000) * 0.10, ZA_INIT_CAP_EX_VAT);
  return Math.round(vatIncl(exVat));
}

/* Vehicle finance is an "other credit agreement", NOT a mortgage.

   This charged 1% of the financed amount against the MORTGAGE cap, so it
   returned up to R6 563 where the gazette allows R1 207.50 including VAT — on a
   R315 000 car, R3 622 against a statutory maximum of R1 207.50, more than five
   times over, under a note asserting the figures follow the NCA maximums. The
   1%-of-finance convention went with it: the regulation gives a formula, and a
   market convention has no business standing in for one that is published. */
function zaVehicleInitiationFee(financeAmount) {
  const a = Number(financeAmount) || 0;
  if (a <= 0) return 0;
  /* Capped EX VAT and grossed up afterwards, like the mortgage fee above.
     Comparing an ex-VAT amount against a VAT-INCLUSIVE cap mixed two bases in
     one expression once before; the two fees must agree about what they
     include. */
  const exVat = Math.min(
    ZA_OTHER_INIT_BASE + Math.max(0, a - 1000) * 0.10,
    ZA_OTHER_INIT_CAP_EX_VAT,
  );
  return Math.round(vatIncl(exVat));
}

/* NCA monthly service-fee cap, Regulation 44, same gazette as above:
   "The maximum monthly service fee, prescribed in terms of section 105 (1) of
   the Act, is R60" — exclusive of VAT, so R69.00 at 15%. The figure here was
   R74.50, which matches no version of the regulation: it was R50 before 6 May
   2016 and R60 after. Stored VAT-inclusive because that is what is rendered. */
const ZA_SERVICE_FEE = vatIncl(fact('za.nca.servicefee'));   // R69.00 exactly

/* Conveyancing and bond-registration cost anchors, INCLUDING VAT, the deeds
   office fee and typical disbursements. Interpolated between anchors and
   extrapolated past the last one at that segment's slope.

   Anchors rather than a formula because the underlying guideline tariff is a
   step table that no closed form reproduces, and a plausible-looking formula
   that is quietly wrong at the top end is worse than an obvious estimate. */
const ZA_TRANSFER_COST = [
  [0, 0], [500000, 12500], [750000, 15000], [1000000, 18000], [1500000, 23000],
  [2000000, 29500], [3000000, 41000], [5000000, 62000], [10000000, 105000],
];
const ZA_BOND_COST = [
  [0, 0], [500000, 13500], [750000, 16500], [1000000, 19500], [1350000, 23550],
  [2000000, 30500], [3000000, 41500], [5000000, 63000], [10000000, 108000],
];

function interpolate(table, x) {
  const v = Number(x) || 0;
  if (v <= 0) return 0;
  for (let k = 1; k < table.length; k++) {
    const [x0, y0] = table[k - 1];
    const [x1, y1] = table[k];
    if (v <= x1) return y0 + (v - x0) * (y1 - y0) / (x1 - x0);
  }
  const [x0, y0] = table[table.length - 2];
  const [x1, y1] = table[table.length - 1];
  return y1 + (v - x1) * (y1 - y0) / (x1 - x0);
}

const round50 = v => Math.round(v / 50) * 50;

/* --------------------------- country profiles ---------------------------- */

/* Keyed by the same country codes as locale.js, deliberately as a SEPARATE
   table: locale.js is tax-and-formatting vocabulary with a strict key contract
   (tests/locale-profiles.test.cjs), and bolting purchase-cost tariffs onto
   every profile there would force seven countries to carry stub tax law they
   have no data for. A country with no entry here still gets the full
   repayment calculator — only the buying-costs card drops away. */
const LOAN_PROFILES = {
  za: {
    hasBuyingCosts: true,
    defaultRate: fact('za.prime.rate'),
    /* Every figure in these three notes now names WHEN it was checked. A hedge
       with no date cannot be acted on: the reader has no way to tell whether it
       is six weeks or three years old, which is the state the old wording left
       them in while quoting a prime rate that had moved and two fee caps that
       had never been read from the regulation at all. */
    rateNote: 'This calculator defaults to 11.00%. South Africa\'s prime rate has moved since — confirm today\'s rate and what your bank actually offered you before relying on any figure here.',
    costsNote: 'Estimates only. Transfer duty is arithmetic on the SARS table effective 1 April 2025, checked against sars.gov.za in August 2026; bond registration and transfer costs are interpolated from the guideline conveyancing tariff, which this app has never verified, and will differ from your attorney\'s quote. Lender fees are modelled on the National Credit Act caps as read from Government Gazette 39379 (initiation R5 250 + VAT, monthly service fee R60 + VAT).',
    feesNote: 'Lender fees are modelled on the National Credit Act caps in Government Gazette 39379 of 6 November 2015 — a mortgage initiation fee of R1 100 plus 10% above R10 000, capped at R5 250 + VAT (R6 038); other credit agreements, including vehicle finance, R165 plus 10% above R1 000, capped at R1 050 + VAT (R1 208); monthly service fee R60 + VAT (R69). Lenders set their own within those caps, so ask for the actual fees on your quote.',
    serviceFee: ZA_SERVICE_FEE,
    transferDuty: zaTransferDuty,
    transferCost: price => round50(interpolate(ZA_TRANSFER_COST, price)),
    bondCost: bond => round50(interpolate(ZA_BOND_COST, bond)),
    mortgageInitiationFee: zaMortgageInitiationFee,
    vehicleInitiationFee: zaVehicleInitiationFee,
  },
};

/* Everything the view reads, with the country-specific half switched off. */
const GENERIC_LOAN_PROFILE = {
  hasBuyingCosts: false,
  defaultRate: 8,
  rateNote: 'Enter the annual interest rate your lender quoted.',
  costsNote: '',
  feesNote: '',
  serviceFee: 0,
  transferDuty: () => 0,
  transferCost: () => 0,
  bondCost: () => 0,
  mortgageInitiationFee: () => 0,
  vehicleInitiationFee: () => 0,
};

function loanProfileFor(code) {
  return LOAN_PROFILES[(code || 'za').toString().trim().toLowerCase()] || GENERIC_LOAN_PROFILE;
}

module.exports = {
  monthlyPayment, amortise, byYear, totalsFor,
  // The ZA fee tables and their helpers are reached through LOAN_PROFILES, which
  // is how a non-ZA profile gets to substitute its own — exporting them by name
  // as well offered a second, country-specific path that nothing used.
  zaTransferDuty,
  LOAN_PROFILES, GENERIC_LOAN_PROFILE, loanProfileFor,
};
