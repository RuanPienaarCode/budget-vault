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
    if (m === n) { capital = bal - b; closing = b; }
    rows.push({ month: m, opening: bal, interest, capital, closing });
    bal = closing;
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
  return {
    payment, exact, months: n, balloon: b, totalRepaid,
    totalInterest: totalRepaid - (Number(principal) || 0),
  };
}

/* ------------------------- South African costs -------------------------- */

/* SARS transfer duty, 2025/26 table (effective 1 April 2025). Each row is
   [from, to, base duty at `from`, marginal rate above `from`]. The base column
   is SARS's own published figure, not a recomputation — the top bracket's
   1 103 783 differs by R2 from what compounding the lower brackets gives, and
   the published number is the one that matters. */
const ZA_TRANSFER_DUTY = [
  [0, 1210000, 0, 0],
  [1210000, 1663800, 0, 0.03],
  [1663800, 2329300, 13614, 0.06],
  [2329300, 3149000, 53544, 0.08],
  [3149000, 12100500, 119120, 0.11],
  [12100500, Infinity, 1103783, 0.13],
];

function zaTransferDuty(price) {
  const v = Number(price) || 0;
  if (v <= 0) return 0;
  for (const [from, to, base, rate] of ZA_TRANSFER_DUTY) {
    if (v <= to) return base + (v - from) * rate;
  }
  return 0;
}

/* National Credit Act initiation-fee cap for a mortgage agreement:
   R1 207 + 10% of the amount above R10 000, capped at R5 707 excluding VAT.
   VAT is added because that is what the lender actually debits. */
const ZA_VAT = 1.15;
const ZA_INIT_CAP_EX_VAT = 5707;
const ZA_INIT_CAP = ZA_INIT_CAP_EX_VAT * ZA_VAT;   // R6 563.05

function zaMortgageInitiationFee(loanAmount) {
  const a = Number(loanAmount) || 0;
  if (a <= 0) return 0;
  const exVat = Math.min(1207 + Math.max(0, a - 10000) * 0.10, ZA_INIT_CAP_EX_VAT);
  return Math.round(exVat * ZA_VAT);
}

/* Vehicle finance is quoted differently: lenders price the initiation fee off
   the financed amount and stop at the same statutory cap. This is the ONE
   number in this file that is a market convention rather than a published
   formula — a real lender's quote is the thing to trust. */
function zaVehicleInitiationFee(financeAmount) {
  const a = Number(financeAmount) || 0;
  if (a <= 0) return 0;
  return Math.round(Math.min(a * 0.01, ZA_INIT_CAP));
}

/* NCA monthly service-fee cap. */
const ZA_SERVICE_FEE = 74.5;

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
    defaultRate: 11,
    rateNote: 'South Africa\'s prime rate was 11.00% (repo + 3.50%) when this default was set — confirm the current rate and what your bank actually offered you.',
    costsNote: 'Estimates only. Transfer duty is exact arithmetic on the SARS 2025/26 table (effective 1 April 2025); bond registration and transfer costs are interpolated from the guideline conveyancing tariff and will differ from your attorney\'s quote. Fees follow the National Credit Act caps (initiation R5 707 + VAT, monthly service fee R74.50).',
    feesNote: 'Fees follow the National Credit Act maximums — initiation capped at R5 707 + VAT (R6 563), monthly service fee R74.50. Lenders set their own within those caps, so use your quote when you have one.',
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
  zaTransferDuty, zaMortgageInitiationFee, zaVehicleInitiationFee,
  ZA_TRANSFER_DUTY, ZA_SERVICE_FEE, ZA_INIT_CAP,
  LOAN_PROFILES, GENERIC_LOAN_PROFILE, loanProfileFor,
};
