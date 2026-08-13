'use strict';
/* Facts about the outside world, with their provenance.

   Every figure in this file describes something the app does not control: a
   SARS bracket, a National Credit Act cap, a lending rate. They are the only
   numbers here that can become wrong while nobody touches the code, and the
   app had no way to tell one that was checked last week from one that was
   invented.

   That is not a hypothetical. Shipped versions of this plugin have carried:

     - a SARS transfer-duty table whose top three brackets appear in no
       published table from any year, under a note calling it exact arithmetic;
     - National Credit Act fee caps asserted to the reader as statutory
       maximums, which nobody had read from the regulation — three separate
       audits failed to verify them, because there was nowhere to record that
       they were unverified;
     - a tax-free-savings threshold that would have told compliant savers they
       owed a 40% penalty from 1 March 2026.

   A bare number cannot say any of that. An entry here must:

     value      the figure itself
     unit       what it is measured in
     claim      what it asserts about the world, in words a reader can check
     source     the primary source URL, or null meaning NOBODY HAS CHECKED
     verified   ISO date it was last read from that source, or null
     reviewBy   ISO date after which the build fails until someone looks again

   `verified: null` is a legitimate, deliberate value. Making "unverified" say
   so out loud is half the point: it is what the UI copy has to be honest about,
   and it is what three audits had no way to record.

   THE TEST DOES NOT CHECK THE NUMBERS. It cannot — no test can know today's
   TFSA limit, and the old tax suite proved what happens when one pretends
   otherwise: it pinned a stale figure as "expected" and defended it. What a
   test CAN hold is that a human looked recently, which is what `reviewBy` and
   tests/facts.test.cjs enforce.

   Pure — no DOM, no obsidian import. */

/* Review dates are set to the next moment the figure could plausibly move,
   not an arbitrary interval: SARS rates change in the Budget and take effect
   1 April or 1 March, filing seasons are announced mid-year, and the repo rate
   is decided every second month. A date that arrives before the world changes
   costs one look; one that arrives after is the failure this file prevents. */

const FACTS = {
  /* ------------------------------ SARS ---------------------------------- */
  'za.transfer.duty': {
    value: [
      [0, 1210000, 0, 0],
      [1210000, 1663800, 0, 0.03],
      [1663800, 2329300, 13614, 0.06],
      [2329300, 2994800, 53544, 0.08],
      [2994800, 13310000, 106784, 0.11],
      [13310000, Infinity, 1241456, 0.13],
    ],
    unit: 'ZAR bands [from, to, base, marginal rate]',
    claim: 'SARS transfer-duty table for natural persons, effective 1 April 2025 and unchanged for the 2027 tax year.',
    source: 'https://www.sars.gov.za/tax-rates/transfer-duty/',
    verified: '2026-08-10',
    reviewBy: '2027-04-01',
    country: 'za',
  },
  'za.vat.rate': {
    value: 1.15,
    unit: 'multiplier',
    claim: 'South African VAT is 15%; Budget 2026 left it unchanged.',
    source: 'https://www.sars.gov.za/types-of-tax/value-added-tax/',
    verified: '2026-08-10',
    reviewBy: '2027-04-01',
    country: 'za',
  },
  'za.interest.exemption.under65': {
    value: 23800,
    unit: 'ZAR per tax year',
    claim: 'SARS local-interest exemption for taxpayers under 65. Unchanged for 2025, 2026 and 2027.',
    source: 'https://www.sars.gov.za/tax-rates/income-tax/interest-and-dividends/',
    verified: '2026-08-10',
    reviewBy: '2027-03-01',
    country: 'za',
  },
  'za.interest.exemption.over65': {
    value: 34500,
    unit: 'ZAR per tax year',
    claim: 'SARS local-interest exemption from age 65.',
    source: 'https://www.sars.gov.za/tax-rates/income-tax/interest-and-dividends/',
    verified: '2026-08-10',
    reviewBy: '2027-03-01',
    country: 'za',
  },
  'za.cgt.inclusion.individual': {
    value: 0.4,
    unit: 'fraction of the gain',
    claim: 'CGT inclusion rate for natural persons — 40%, which is SARS\'s published 18% maximum effective rate at a 45% marginal rate.',
    source: 'https://www.sars.gov.za/tax-rates/income-tax/capital-gains-tax-cgt/',
    verified: '2026-08-10',
    reviewBy: '2027-03-01',
    country: 'za',
  },
  'za.tfsa.lifetime': {
    value: 500000,
    unit: 'ZAR lifetime',
    claim: 'SARS tax-free investment lifetime contribution limit.',
    source: 'https://www.sars.gov.za/types-of-tax/personal-income-tax/tax-free-investments/',
    verified: '2026-08-10',
    reviewBy: '2027-03-01',
    country: 'za',
  },

  /* --------------------- National Credit Act ---------------------------- */
  /* Government Gazette 39379, Government Notice 1080 of 6 November 2015 — the
     regulations on the review of limitations of fees and interest rates, in
     force 6 May 2016. Retrieved as PDF and text-extracted; a widely linked
     "NATIONAL-CREDIT-ACT-REGULATIONS.pdf" hosted under a 2025 URL is in fact
     the ORIGINAL 2006 text (R1 000 / R5 000 / R50), so the gazette number and
     commencement date are the only reliable handle on which version is which. */
  'za.nca.init.mortgage.base': {
    value: 1100,
    unit: 'ZAR excluding VAT',
    claim: 'NCA reg 42(2) Table B, mortgage agreements: R1 100 per credit agreement, plus 10% of the amount above R10 000.',
    source: 'https://www.gov.za/sites/default/files/gcis_document/201511/39379gon1080.pdf',
    verified: '2026-08-10',
    reviewBy: '2027-04-01',
    country: 'za',
  },
  'za.nca.init.mortgage.cap': {
    value: 5250,
    unit: 'ZAR excluding VAT',
    claim: 'NCA reg 42(2) Table B, mortgage agreements: "But never to exceed R5 250".',
    source: 'https://www.gov.za/sites/default/files/gcis_document/201511/39379gon1080.pdf',
    verified: '2026-08-10',
    reviewBy: '2027-04-01',
    country: 'za',
  },
  'za.nca.init.other.base': {
    value: 165,
    unit: 'ZAR excluding VAT',
    claim: 'NCA reg 42(2) Table B, other credit agreements (and credit facilities, unsecured and short-term): R165 plus 10% of the amount above R1 000. Vehicle finance falls here, not under mortgages.',
    source: 'https://www.gov.za/sites/default/files/gcis_document/201511/39379gon1080.pdf',
    verified: '2026-08-10',
    reviewBy: '2027-04-01',
    country: 'za',
  },
  'za.nca.init.other.cap': {
    value: 1050,
    unit: 'ZAR excluding VAT',
    claim: 'NCA reg 42(2) Table B, other credit agreements: "But never to exceed R1 050".',
    source: 'https://www.gov.za/sites/default/files/gcis_document/201511/39379gon1080.pdf',
    verified: '2026-08-10',
    reviewBy: '2027-04-01',
    country: 'za',
  },
  'za.nca.servicefee': {
    value: 60,
    unit: 'ZAR per month, excluding VAT',
    claim: 'NCA reg 44: "The maximum monthly service fee, prescribed in terms of section 105 (1) of the Act, is R60" — exclusive of VAT, so R69.00 at 15%.',
    source: 'https://www.gov.za/sites/default/files/gcis_document/201511/39379gon1080.pdf',
    verified: '2026-08-10',
    reviewBy: '2027-04-01',
    country: 'za',
  },

  /* ------------------- unverified: recorded as such --------------------- */
  /* These are the entries the ledger exists for. Each one is currently a
     DEFAULT the reader is asked to check, not a figure the app stands behind,
     and the UI copy has to keep saying so for exactly as long as `verified`
     is null here. */
  'za.prime.rate': {
    value: 11,
    unit: 'percent per year',
    claim: 'South African prime lending rate, used only as a starting value in the loan calculators. Secondary sources put it at 10.50% (repo 7.00%) as of August 2026, but SARB\'s own page is script-rendered and was not read directly, so this is NOT verified and the calculator copy must keep telling the reader to confirm the rate their bank actually offered.',
    source: null,
    verified: null,
    reviewBy: '2026-11-01',
    country: 'za',
  },
  'za.conveyancing.anchors': {
    value: 'see ZA_TRANSFER_COST / ZA_BOND_COST in loan-math.js',
    unit: 'ZAR anchors, VAT inclusive',
    claim: 'Guideline conveyancing and bond-registration cost anchors. Never checked against the published tariff — correctly labelled as estimates in the UI, which is the only reason this is a low risk rather than the transfer-duty failure again.',
    source: null,
    verified: null,
    reviewBy: '2027-04-01',
    country: 'za',
  },
  'za.vehicle.insurance.rate': {
    value: 0.0035,
    unit: 'fraction of vehicle price per month',
    claim: 'Rough monthly comprehensive cover as a share of vehicle price. Never checked against real South African premiums; hedged in the UI as an estimate to replace with a real quote.',
    source: null,
    verified: null,
    reviewBy: '2027-08-01',
    country: 'za',
  },
  'dti.stretched.threshold': {
    value: 36,
    unit: 'percent of gross monthly income',
    claim: 'A debt-to-income level some lenders treat as stretched. This is a United States mortgage-underwriting convention with no standing in South African affordability assessment, which the National Credit Act governs as a disposable-income calculation rather than a ratio. The app no longer grades anyone against it; it is kept here only so that if the figure is ever shown again, it is shown with this attached.',
    source: null,
    verified: null,
    reviewBy: '2027-04-01',
  },
};

/* Year-keyed limits, newest first. A single "current" value with a manual bump
   each Budget is the design that broke: figureChecks received the tax year and
   never read it, so a 2027 page asserted a 2026 threshold and told a compliant
   saver they owed a 40% penalty on R10 000. */
const ZA_YEAR_LIMITS = [
  {
    from: 2027,
    tfsa: 46000,
    cgt: 40000,
    /* SARS raised the annual TFSA contribution limit from R36 000 to R46 000
       effective 1 March 2026 (the 2027 tax year) — verified 10 Aug 2026.

       The CGT annual exclusion is deliberately NOT changed here. A rise to
       R50 000 was reported during the audit and could NOT be confirmed against
       a primary source; the exclusion has been R40 000 since 2016/17, which
       makes a jump notable enough to want a citation first. Two agents agreeing
       is how the fabricated transfer-duty table survived, so this waits. */
    cgtVerified: false,
  },
  { from: 2017, tfsa: 36000, cgt: 40000, cgtVerified: true },
];

function limitsFor(year) {
  const y = Number(year) || 0;
  const row = ZA_YEAR_LIMITS.find(r => y >= r.from) || ZA_YEAR_LIMITS[ZA_YEAR_LIMITS.length - 1];
  return { ...row, year: y || row.from };
}

/* Throws rather than returning undefined: a typo'd key would otherwise put
   `undefined` into a money figure, which is precisely the silent-wrong-number
   outcome this file exists to prevent. */
function fact(key) {
  if (!Object.prototype.hasOwnProperty.call(FACTS, key)) {
    throw new Error(`unknown fact: ${key}`);
  }
  return FACTS[key].value;
}

/* Everything past its review date. `today` is injectable for the same reason it
   is in reconcile.js — a test asserting expiry behaviour must be able to stand
   somewhere other than now. */
function staleFacts(today) {
  /* Local calendar date, not toISOString() — that is UTC, and in Johannesburg
     it names yesterday until 02:00, so the review banner fired up to two
     hours off. Same rule as dates.js todayIso(); inlined rather than imported
     so this file keeps zero project dependencies (facts.test.cjs pins the
     dependency direction — readers come through THIS module). */
  const d = new Date();
  const t = today ||
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return Object.entries(FACTS)
    .filter(([, f]) => f.reviewBy < t)
    .map(([key]) => ({ key, reviewBy: FACTS[key].reviewBy }));
}

/* The keys nobody has read from a primary source. Visible on purpose. */
function unverifiedFacts() {
  return Object.entries(FACTS).filter(([, f]) => f.verified === null).map(([key]) => key);
}

module.exports = { FACTS, fact, limitsFor, staleFacts, unverifiedFacts, ZA_YEAR_LIMITS };
