'use strict';
/* Country locale profiles — everything that varies by country lives here:
   default currency symbol, number formatting, statement date order, the
   import view's bank blurb, and the tax-season vocabulary (authority,
   tax-year span, deadlines, taxpayer-type labels, seed checklist + documents).

   The stored data model stays country-agnostic: `taxpayer_type` is always
   provisional|standard|unknown and `assessment` is always
   submit-requested|auto-assessed|unknown — profiles only change the LABELS
   shown for those values and what a new tax year is seeded with, so
   switching country never breaks files written under another one.

   The chosen country is stored as `country:` in the budget folder's
   Settings.md (vault-synced, like `currency`); a missing key means South
   Africa, which is what every pre-country install was. */

/* Format an amount with a profile's own separators. figureChecks methods use
   method shorthand so `this` is the profile they were read off. */
const { fact, limitsFor: zaLimitsForFact } = require('./facts');
const { formatAmount } = require('./currency');

/* `currency` is a symbol the CALLER believes these figures are in. Delegates
   the actual formatting to currency.js's formatAmount so this is not a second
   implementation of money()'s rules — see that function for what was
   disagreeing (symbol source, sign placement, the space, and the missing
   non-finite guard).

   ISSUE 30 — read the argument order carefully, because it was reversed once
   and both directions were wrong in different ways.

   Originally this printed the PROFILE's symbol, and a household set to "$"
   saw its own tax callouts labelled "R". That was fixed by preferring the
   household symbol, and the pendulum went one notch too far: it then stamped
   the household symbol onto figures that are not the household's. On a vault
   with `country: za` and `currency: Rp`, the under-65 interest exemption —
   R23 800, a statutory RAND figure from src/facts.js carrying
   `unit: 'ZAR per tax year'` — rendered as "Rp 23 800,00", and the comparison
   `localInterest <= exempt` ran a rupiah amount against a rand constant and
   printed the DIFFERENCE as a single figure.

   The resolution is that neither symbol is a property of this function: the
   caller knows which currency the figures it is passing are denominated in,
   and za's figureChecks passes ZA_CURRENCY explicitly because every figure on
   a SARS tax page is rand by construction — an IRP5 is a South African
   document and its source-code amounts are rand whatever currency the
   household happens to budget in. The fallback to the profile's own symbol
   remains for the locale-profiles guard test, which calls figureChecks()
   directly with no currency in scope. */
const fmtAmt = (p, v, currency) => formatAmount(currency || p.currency, v, 2, p);

/* Sum the figure rows carrying any of the given codes. */
const sumCodes = (figures, ...codes) => (figures || [])
  .filter(f => codes.includes((f.code || '').trim()))
  .reduce((a, f) => a + (f.amount || 0), 0);

/* SARS remuneration + fringe-benefit codes — what an IRP5 contributes to
   taxable income. Deliberately excludes investment codes (4201/4218/4250/…),
   which are exempt or separately assessed. */
/* SARS thresholds that CHANGE BY TAX YEAR, newest first.

   figureChecks has always received `year` and never read it, so every threshold
   was frozen at whatever was true when it was typed and the page went on
   asserting it for every year after. The tax-free investment annual limit rose
   from R36 000 to R46 000 with effect from 1 March 2026 — the 2027 tax year —
   which meant a 2027 page told a saver who had contributed R40 000, entirely
   within the limit, that they owed a 40% penalty on R4 000.

   `year` here is the SARS tax year (the one ending in February of that calendar
   year), matching what views/tax.js passes in. An unrecognised or missing year
   falls back to the oldest row rather than the newest, so a figure is never
   asserted for a year this table has not been told about.

   Verified against sars.gov.za on 10 August 2026:
     - TFSA annual limit R36 000 through 2026, R46 000 from 2027.
     - CGT annual exclusion R40 000. A rise to R50 000 from 2027 was reported
       during the audit but could NOT be confirmed against a primary source, so
       it is deliberately NOT coded here. Year-keying it now makes that a
       one-line data edit once someone reads the figure rather than a code
       change. Verifying it is an open item. */
/* Year-keyed limits live in src/facts.js — the reason they are keyed at all
   is that figureChecks used to receive the tax year and never read it, so a
   2027 page asserted a 2026 threshold and told a compliant saver they owed a
   40% penalty on R10 000. */
const zaLimitsFor = zaLimitsForFact;

const ZA_INCOME_CODES = [
  '3601', '3605', '3606', '3610', '3615', '3616', '3617', '3699',
  '3701', '3702', '3707', '3713', '3718',
  '3801', '3802', '3805', '3806', '3808', '3810',
];

/* Compare what the authority assessed against what was captured.

   The check that earns its keep is the second one: an assessment whose taxable
   income matches employment income *to the cent* has picked up nothing else —
   so any other income figure on the page was either exempt or never declared.
   It asks rather than accuses, because "exempt" is the common answer and only
   the filer knows which. `employmentCodes` empty (generic profiles) → no
   checks, since "which codes are income" is jurisdictional. */
const reconcileAssessed = (p, figures, t, employmentCodes, currency) => {
  if (!t || t.assessment !== 'assessed' || typeof t.assessment_income !== 'number') return [];
  if (!employmentCodes || !employmentCodes.length) return [];
  const fmt = v => fmtAmt(p, v, currency);
  const rows = (figures || []).filter(f => (f.amount || 0) > 0);
  if (!rows.length) return [];

  const employment = sumCodes(figures, ...employmentCodes);
  const others = rows.filter(f => !employmentCodes.includes((f.code || '').trim()));
  const msgs = [];

  if (employment > 0 && t.assessment_income < employment - 1) {
    msgs.push({ ok: false, text: `Assessed taxable income ${fmt(t.assessment_income)} is below your captured employment income ${fmt(employment)} — check the assessment against your certificates.` });
  } else if (employment > 0 && Math.abs(t.assessment_income - employment) <= 1 && others.length) {
    msgs.push({ ok: false, text: `Assessed taxable income ${fmt(t.assessment_income)} matches your employment income exactly, so none of the other ${others.length} captured figure${others.length === 1 ? '' : 's'} reached it. Confirm each was exempt rather than omitted — if any was trade income, a correction is due before the deadline.` });
  } else if (employment > 0) {
    msgs.push({ ok: true, text: `Assessed taxable income ${fmt(t.assessment_income)} is consistent with the ${fmt(employment)} of employment income captured.` });
  }
  return msgs;
};

/* Shared generic tax content for countries without a dedicated profile. */
const genericTax = (authority) => ({
  authority,
  taxIntro: `Track a ${authority === 'Tax' ? 'tax' : authority} return season here — progress steps, the documents you need and where each one comes from, with the files themselves stored in your vault.`,
  yearHint: 'Tax year (calendar year)',
  figureCodeLabel: 'Code',
  yearSpan: y => `Jan – Dec ${y}`,
  currentTaxYear: now => (now.getMonth() + 1 <= 4 ? now.getFullYear() - 1 : now.getFullYear()),
  seedDeadlines: () => ({ deadline_standard: '', deadline_provisional: '' }),
  deadlineLabels: ['Deadline', 'Alternative deadline'],
  activeDeadline: t => t.deadline_standard || t.deadline_provisional,
  defaultTaxpayerType: 'unknown',
  defaultAssessment: 'unknown',
  taxpayerTypes: [
    ['provisional', 'Self-employed / files a return'],
    ['standard', 'Tax withheld by employer'],
    ['unknown', 'Unknown'],
  ],
  assessments: [
    ['submit-requested', 'Return required'],
    ['auto-assessed', 'No return required this year'],
    ['assessed', 'Assessed — notice received'],
    ['unknown', 'Not checked yet'],
  ],
  /* No jurisdiction knowledge here — thresholds and the set of codes that
     count as income are both country-specific, so a generic profile has
     nothing safe to assert. Countries with a profile override this. */
  figureChecks() { return []; },
  seasonMsgs(t) {
    const msgs = [];
    if (t.assessment === 'submit-requested') msgs.push('A return is required — work through the steps below.');
    else if (t.assessment === 'auto-assessed') msgs.push('Marked as no return required this year — keep the documents anyway in case that changes.');
    else msgs.push('Check with your tax authority whether you need to file a return this year.');
    if (t.taxpayer_type === 'provisional') msgs.push('Self-employment or untaxed income usually means extra payments during the year — check your authority\'s schedule.');
    return msgs;
  },
  safetyNote: 'Always type your tax authority\'s web address into the browser yourself — tax authorities never ask for passwords or OTPs by email, SMS or phone.',
  seedSteps: () => [
    { step: 'Confirm whether you must file a return', notes: '' },
    { step: 'Gather income statements', notes: 'Employer certificates, bank interest, investment statements' },
    { step: 'Gather deduction records', notes: 'Receipts for anything claimable — medical, donations, work expenses' },
    { step: 'Complete the return', notes: '' },
    { step: 'Submit before the deadline', notes: '' },
    { step: 'Pay any balance due', notes: '' },
    { step: 'Respond to tax authority queries', notes: '' },
  ],
  seedDocs: () => [
    { name: 'Employment income statement', source: 'Employer', notes: '' },
    { name: 'Bank interest statement', source: 'Your bank', notes: 'One per bank' },
    { name: 'Investment income statements', source: 'Investment provider', notes: '' },
    { name: 'Deduction receipts', source: 'Own records', notes: '' },
    { name: 'Letters & notices', source: 'Tax authority', notes: '' },
  ],
});

const PROFILES = {
  za: {
    label: 'South Africa',
    currency: 'R',
    thousands: ' ', decimal: ',',
    dayFirst: true,
    stripDescSuffix: ' ZA',
    // Only banks whose real exports have actually been imported end to end.
    // Others very likely work — the importer reads columns by name and falls
    // back to reading the layout by shape — but naming one here reads as a
    // promise, and a statement that imports with the wrong sign is worse than
    // one that doesn't import at all.
    banks: 'Discovery, FNB, Capitec, Nedbank',
    importHint: null,   // keep the static Discovery-filename hint in the shell
    authority: 'SARS',
    taxIntro: 'Track a SARS return season here — progress steps, the documents you need (IRP5, IT3(b), medical certificate, …) and the files themselves, stored in the vault.',
    yearHint: 'Tax year (ends Feb of this year)',
    figureCodeLabel: 'Source code',
    yearSpan: y => `1 Mar ${y - 1} – end Feb ${y}`,
    currentTaxYear: now => (now.getMonth() + 1 >= 3 ? now.getFullYear() : now.getFullYear() - 1),
    /* Filing-season deadlines shift a little every year — editable defaults
       (2026-season dates carried forward as a pattern). */
    seedDeadlines: y => ({ deadline_standard: `${y}-10-23`, deadline_provisional: `${y + 1}-01-22` }),
    deadlineLabels: ['Deadline (standard)', 'Deadline (provisional)'],
    activeDeadline: t => (t.taxpayer_type === 'standard' ? t.deadline_standard : t.deadline_provisional),
    defaultTaxpayerType: 'provisional',
    defaultAssessment: 'submit-requested',
    taxpayerTypes: [
      ['provisional', 'Provisional'],
      ['standard', 'Standard'],
      ['unknown', 'Unknown — confirm on eFiling'],
    ],
    assessments: [
      ['submit-requested', 'SARS asked me to submit'],
      ['auto-assessed', 'Auto-assessed'],
      ['assessed', 'Assessed — ITA34 received'],
      ['unknown', 'Not checked yet'],
    ],
    /* Thresholds are the current published figures, not permanent ones — the
       page labels them as defaults to verify. The under-65 interest exemption
       is hard-coded because the plugin holds no date of birth; over-65s get a
       higher one and the message says so. */
    figureChecks(figures, year, t, currency) {
      /* RAND, deliberately, and NOT the household symbol the caller passes.
         Every figure this function touches is rand: the reader's own numbers
         come off an IRP5/IT3 (South African documents, denominated in rand),
         and the thresholds they are compared against are SARS statutes. A
         household that budgets in another currency still files in rand, and
         the page says so above these callouts. `currency` is accepted and
         ignored here so the signature stays uniform across profiles — see
         fmtAmt's header for the two opposite bugs this settles. */
      void currency;
      const fmt = v => fmtAmt(this, v, this.currency);
      const msgs = [];

      const localInterest = sumCodes(figures, '4201');
      if (localInterest > 0) {
        const exempt = fact('za.interest.exemption.under65');   // over-65s get more; the message says so
        msgs.push(localInterest <= exempt
          ? { ok: true, text: `Local interest ${fmt(localInterest)} is under the ${fmt(exempt)} under-65 exemption — ${fmt(exempt - localInterest)} of headroom.` }
          : { ok: false, text: `Local interest ${fmt(localInterest)} exceeds the ${fmt(exempt)} under-65 exemption — ${fmt(localInterest - exempt)} is taxable.` });
      }
      // Foreign interest (4218) carries no exemption — a separate ITR12 line
      // that must never be folded into the 4201 test.
      const foreignInterest = sumCodes(figures, '4218');
      if (foreignInterest > 0) {
        msgs.push({ ok: true, text: `Foreign interest ${fmt(foreignInterest)} gets no exemption — declare it separately from local interest.` });
      }

      const lim = zaLimitsFor(year);
      const tfsa = sumCodes(figures, '4219');
      if (tfsa > lim.tfsa) {
        msgs.push({ ok: false, text: `TFSA contributions ${fmt(tfsa)} exceed the ${fmt(lim.tfsa)} annual limit for the ${lim.year} tax year — 40% penalty on the ${fmt(tfsa - lim.tfsa)} excess. Confirm the current limit on sars.gov.za.` });
      } else if (tfsa > 0) {
        msgs.push({ ok: true, text: `TFSA ${fmt(tfsa)} of the ${fmt(lim.tfsa)} limit for the ${lim.year} tax year used — ${fmt(lim.tfsa - tfsa)} of headroom before the year closes.` });
      }

      const gains = sumCodes(figures, '4250');
      if (gains > lim.cgt) {
        /* The EXCESS is not what reaches taxable income — an individual's
           inclusion rate is 40%, so R100 000 of gains puts R24 000 into taxable
           income, not R60 000. Stating the excess as though it were the taxable
           amount overstated it by two and a half times, and unlike the
           thresholds either side of it that is not a figure the page's
           "defaults to verify" disclaimer covers: the numbers going stale is one
           thing, a stated relationship being wrong is another. */
        const excess = gains - lim.cgt;
        msgs.push({ ok: false, text: `Capital gains ${fmt(gains)} exceed the ${fmt(lim.cgt)} annual exclusion by ${fmt(excess)} — at the 40% inclusion rate for individuals, about ${fmt(excess * fact('za.cgt.inclusion.individual'))} feeds into taxable income.` });
      } else if (gains > 0) {
        msgs.push({ ok: true, text: `Capital gains ${fmt(gains)} are under the ${fmt(lim.cgt)} annual exclusion.` });
      }

      return msgs.concat(reconcileAssessed(this, figures, t, ZA_INCOME_CODES, currency));
    },
    seasonMsgs(t) {
      const msgs = [];
      if (t.assessment === 'submit-requested') {
        msgs.push('SARS has asked for a return — you were not auto-assessed. Work through the steps below and file the ITR12 on eFiling.');
      } else if (t.assessment === 'auto-assessed') {
        msgs.push('SARS auto-assessed this year. Check the assessment on eFiling — if income is missing or you disagree, file an ITR12 before the deadline; otherwise nothing more may be needed.');
      } else {
        msgs.push('Check your auto-assessment status on the eFiling dashboard — SARS either auto-calculates or asks you to submit, depending on your income mix.');
      }
      if (t.taxpayer_type === 'provisional') {
        msgs.push('As a provisional taxpayer you also file IRP6 returns twice a year — they are in the steps below.');
      } else if (t.taxpayer_type === 'unknown') {
        msgs.push('Salary plus freelance income usually means provisional taxpayer — confirm under "Maintain Registered Particulars" on eFiling.');
      }
      return msgs;
    },
    safetyNote: 'Always type sars.gov.za into the browser yourself — SARS never asks for passwords or OTPs by email, SMS or phone.',
    /* Method shorthand, not an arrow, so `this` is the profile — the TFSA
       step below reads this.currency/thousands/decimal to format a limit it
       must not hard-code. Called as loc.seedSteps(year) (views/tax.js), so
       the binding is always the profile it belongs to. */
    seedSteps(year) {
      return [
      { step: 'Confirm taxpayer status on eFiling', notes: 'Maintain Registered Particulars — provisional vs standard' },
      { step: 'Check auto-assessment status on the eFiling dashboard', notes: '' },
      { step: 'Gather documents', notes: 'See the Documents list below' },
      { step: 'Open the ITR12 return on eFiling', notes: 'sars.gov.za or the SARS MobiApp' },
      { step: 'Review pre-populated data', notes: 'IRP5, medical certificate, bank IT3(b)s — check both banks reflect' },
      { step: 'Add freelance income & deductible expenses', notes: 'Invoiced total; home office %, software, equipment, internet/phone portion, accounting fees' },
      { step: 'Declare investment income', notes: 'IT3(b)/IT3(c) from your investment provider: interest, dividends, capital gains on sales' },
      /* ISSUE 30 — built from facts.js rather than written out, because a
         literal here outlives the fix that corrected it everywhere else.
         This step hard-coded "R36 000/yr" while limitsFor(2027) returns
         46 000 and figureChecks (200 lines up) printed "the R 46 000,00
         annual limit" — two figures for one statutory limit, one screen
         apart. Worse, seeded steps are WRITTEN to Tax/<year>.md, so the
         stale number persisted in the reader's vault long after the code
         was right. src/facts.js:207-210 exists to end exactly this; the
         earlier pass fixed figureChecks and missed the seed prose. */
      { step: 'Declare TFSA contributions',
        notes: `Contribution certificate; check the ${fmtAmt(this, zaLimitsFor(year).tfsa, this.currency)}/yr `
          + `& ${fmtAmt(this, fact('za.tfsa.lifetime'), this.currency)} lifetime limits` },
      { step: 'Claim out-of-pocket medical expenses', notes: 'Qualifying expenses not covered by the aid' },
      { step: 'Submit the ITR12', notes: '' },
      { step: 'Check the ITA34 against your own figures', notes: 'Assessed taxable income should account for every income figure you captured — anything missing was either exempt or omitted' },
      { step: 'Decide on a Request for Correction', due: `${year}-10-23`, notes: 'Only if something was left out — undeclared trade income is the one with real consequence' },
      { step: 'Respond to SARS verification requests', notes: 'Within the timeframe SARS gives' },
      { step: `IRP6 provisional return ${year + 1} — period 1`, due: `${year}-08-31`, notes: 'Provisional taxpayers only — mark N/A if standard' },
      { step: `IRP6 provisional return ${year + 1} — period 2`, due: `${year + 1}-02-28`, notes: 'Provisional taxpayers only — mark N/A if standard' },
      ];
    },
    seedDocs: () => [
      { name: 'IRP5 / IT3(a) employee certificate', source: 'Employer', notes: 'Usually pre-populated' },
      { name: 'IT3(b) interest certificate', source: 'Your bank', notes: 'One per bank you hold accounts with' },
      { name: 'IT3(b) interest certificate', source: 'Your second bank', notes: 'Remove if not applicable' },
      // Providers issue these as separate certificates — one row each, so a
      // three-PDF provider doesn't have to be split by hand every year.
      { name: 'IT3(b) investment income certificate', source: 'Investment provider', notes: 'Interest, dividends, REIT distributions' },
      { name: 'IT3(c) capital gains statement', source: 'Investment provider', notes: 'Disposals during the year — remove if nothing was sold' },
      { name: 'IT3(s) TFSA contribution certificate', source: 'Investment provider', notes: 'Growth is exempt; contributions still declared' },
      { name: 'Medical aid tax certificate', source: 'Medical aid scheme', notes: 'Usually pre-populated' },
      { name: 'Out-of-pocket medical expenses summary', source: 'Own records', notes: '' },
      { name: 'Invoiced income summary', source: 'Freelance business', notes: 'Total invoiced for the tax year' },
      { name: 'Business expense records', source: 'Freelance business', notes: 'Home office, software, equipment, internet/phone, accounting' },
      { name: 'SARS letters & notices', source: 'SARS', notes: '' },
    ],
  },

  us: {
    label: 'United States',
    currency: '$',
    thousands: ',', decimal: '.',
    dayFirst: false,
    banks: 'Chase, Bank of America, Wells Fargo, Citi, Capital One',
    importHint: 'Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.',
    authority: 'IRS',
    taxIntro: 'Track an IRS filing season here — progress steps, the documents you need (W-2, 1099s, 1098, …) and the files themselves, stored in the vault.',
    yearHint: 'Tax year (calendar year)',
    figureCodeLabel: 'Form line',
    yearSpan: y => `Jan – Dec ${y}`,
    currentTaxYear: now => (now.getMonth() + 1 <= 4 ? now.getFullYear() - 1 : now.getFullYear()),
    seedDeadlines: y => ({ deadline_standard: `${y + 1}-04-15`, deadline_provisional: `${y + 1}-10-15` }),
    deadlineLabels: ['Filing deadline', 'Extension deadline'],
    activeDeadline: t => t.deadline_standard,
    defaultTaxpayerType: 'unknown',
    defaultAssessment: 'submit-requested',
    taxpayerTypes: [
      ['provisional', 'Pays estimated tax (1040-ES)'],
      ['standard', 'Withholding only (W-2)'],
      ['unknown', 'Unknown'],
    ],
    assessments: [
      ['submit-requested', 'Return required'],
      ['auto-assessed', 'Not required to file this year'],
      ['assessed', 'Assessed — IRS notice received'],
      ['unknown', 'Not checked yet'],
    ],
    figureChecks() { return []; },
    seasonMsgs(t) {
      const msgs = [];
      if (t.assessment === 'auto-assessed') msgs.push('Marked as not required to file — most people with income above the standard deduction still are, so keep the documents in case that changes.');
      else msgs.push('Work through the steps below and file Form 1040 by the April deadline. An extension (Form 4868) extends filing to October, but any balance is still due in April.');
      if (t.taxpayer_type === 'provisional') msgs.push('You also make quarterly estimated payments — the 1040-ES steps are below.');
      else if (t.taxpayer_type === 'unknown') msgs.push('Freelance or side income with no withholding usually means quarterly estimated payments (Form 1040-ES).');
      return msgs;
    },
    safetyNote: 'Always type irs.gov into the browser yourself — the IRS never initiates contact by email, SMS or phone to ask for personal or payment details.',
    seedSteps: year => [
      { step: 'Gather income documents', notes: 'W-2s and 1099s — most arrive by end of January' },
      { step: 'Decide standard vs itemized deduction', notes: 'Itemize only if mortgage interest + SALT + charity beat the standard deduction' },
      { step: 'Report freelance / self-employment income', notes: 'Schedule C income minus business expenses; Schedule SE for self-employment tax' },
      { step: 'Report investment income', notes: '1099-INT, 1099-DIV, 1099-B — interest, dividends, capital gains' },
      { step: 'Check IRA / HSA contributions', notes: 'Prior-year contributions allowed until the filing deadline' },
      { step: 'File Form 1040', notes: 'IRS Free File, tax software, or a preparer — e-file with direct deposit is fastest' },
      { step: 'Pay any balance due', notes: 'Due by the April deadline even if you file an extension' },
      { step: 'Respond to IRS notices', notes: 'Within the timeframe on the letter' },
      { step: `1040-ES estimated payment ${year + 1} — Q1`, due: `${year + 1}-04-15`, notes: 'Estimated-tax payers only — mark N/A if withholding covers you' },
      { step: `1040-ES estimated payment ${year + 1} — Q2`, due: `${year + 1}-06-15`, notes: 'Estimated-tax payers only — mark N/A if withholding covers you' },
    ],
    seedDocs: () => [
      { name: 'W-2 wage statement', source: 'Employer', notes: 'One per employer' },
      { name: '1099-NEC / 1099-K freelance income', source: 'Clients / platforms', notes: '' },
      { name: '1099-INT interest statement', source: 'Your bank', notes: 'One per bank' },
      { name: '1099-DIV / 1099-B investment statements', source: 'Broker', notes: 'Dividends, sales, capital gains' },
      { name: '1098 mortgage interest statement', source: 'Mortgage lender', notes: 'If itemizing' },
      { name: 'HSA forms (5498-SA / 1099-SA)', source: 'HSA custodian', notes: '' },
      { name: 'Charitable donation receipts', source: 'Own records', notes: 'If itemizing' },
      { name: 'Business expense records', source: 'Own records', notes: 'Home office, software, equipment, mileage' },
      { name: 'Prior-year return', source: 'Own records', notes: 'For AGI and carryovers' },
      { name: 'IRS letters & notices', source: 'IRS', notes: '' },
    ],
  },

  uk: {
    label: 'United Kingdom',
    currency: '£',
    thousands: ',', decimal: '.',
    dayFirst: true,
    banks: 'Barclays, HSBC, Lloyds, NatWest, Monzo, Starling',
    importHint: 'Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.',
    authority: 'HMRC',
    taxIntro: 'Track an HMRC Self Assessment season here — progress steps, the documents you need (P60, P11D, interest statements, …) and the files themselves, stored in the vault.',
    yearHint: 'Tax year (ends 5 Apr of this year)',
    figureCodeLabel: 'Box',
    yearSpan: y => `6 Apr ${y - 1} – 5 Apr ${y}`,
    currentTaxYear: now => (now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1),
    seedDeadlines: y => ({ deadline_standard: `${y + 1}-01-31`, deadline_provisional: `${y}-10-31` }),
    deadlineLabels: ['Online filing deadline', 'Paper filing deadline'],
    activeDeadline: t => t.deadline_standard,
    defaultTaxpayerType: 'unknown',
    defaultAssessment: 'unknown',
    taxpayerTypes: [
      ['provisional', 'Self Assessment'],
      ['standard', 'PAYE only'],
      ['unknown', 'Unknown — check on gov.uk'],
    ],
    assessments: [
      ['submit-requested', 'Notice to file received'],
      ['auto-assessed', 'Not required (PAYE settles it)'],
      ['assessed', 'Assessed — SA302 / calculation received'],
      ['unknown', 'Not checked yet'],
    ],
    figureChecks() { return []; },
    seasonMsgs(t) {
      const msgs = [];
      if (t.assessment === 'submit-requested') msgs.push('HMRC expects a Self Assessment return — file the SA100 online by 31 January and pay what\'s due the same day.');
      else if (t.assessment === 'auto-assessed') msgs.push('PAYE should settle your tax this year. Keep the documents anyway — untaxed income over the allowances would mean registering for Self Assessment.');
      else msgs.push('Use the "Check if you need to send a Self Assessment tax return" tool on gov.uk — register by 5 October if you do.');
      if (t.taxpayer_type === 'provisional') msgs.push('Payments on account may be due on 31 January and 31 July if your last bill was over £1,000.');
      return msgs;
    },
    safetyNote: 'Always type gov.uk into the browser yourself — HMRC never asks for passwords or bank details by email or SMS.',
    seedSteps: () => [
      { step: 'Check if you need to file / register for Self Assessment', notes: 'gov.uk tool; register by 5 Oct if new — you need your UTR' },
      { step: 'Gather employment documents', notes: 'P60 (or P45 if you changed jobs), P11D for benefits' },
      { step: 'Gather bank interest & dividend statements', notes: 'Interest over the savings allowance and dividends over the allowance are taxable' },
      { step: 'Total self-employment income & expenses', notes: 'Invoiced total minus allowable expenses; check the £1,000 trading allowance' },
      { step: 'Claim reliefs', notes: 'Pension contributions, Gift Aid donations, marriage allowance' },
      { step: 'File the SA100 online', notes: 'gov.uk — sign in with your Government Gateway ID' },
      { step: 'Pay the balance (and first payment on account)', due: '', notes: 'Both due 31 January' },
      { step: 'Second payment on account', notes: 'Due 31 July, if payments on account apply' },
      { step: 'Respond to HMRC queries', notes: '' },
    ],
    seedDocs: () => [
      { name: 'P60 end-of-year certificate', source: 'Employer', notes: '' },
      { name: 'P45 (if you changed jobs)', source: 'Previous employer', notes: 'Remove if not applicable' },
      { name: 'P11D benefits statement', source: 'Employer', notes: 'Remove if not applicable' },
      { name: 'Bank interest statements', source: 'Your bank', notes: 'One per bank' },
      { name: 'Dividend vouchers', source: 'Broker / companies', notes: '' },
      { name: 'Self-employment income & expense records', source: 'Own records', notes: '' },
      { name: 'Pension contribution statement', source: 'Pension provider', notes: '' },
      { name: 'Gift Aid donation summary', source: 'Own records', notes: '' },
      { name: 'HMRC letters & notices', source: 'HMRC', notes: '' },
    ],
  },

  eu: {
    label: 'Eurozone (generic)',
    currency: '€',
    thousands: '.', decimal: ',',
    dayFirst: true,
    banks: null,
    importHint: 'Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.',
    ...genericTax('Tax'),
  },

  au: {
    label: 'Australia',
    currency: '$',
    thousands: ',', decimal: '.',
    dayFirst: true,
    banks: 'CommBank, Westpac, ANZ, NAB',
    importHint: 'Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.',
    authority: 'ATO',
    taxIntro: 'Track an ATO tax-return season here — progress steps, the documents you need (income statement, dividend statements, deduction receipts, …) and the files themselves, stored in the vault.',
    yearHint: 'Tax year (ends 30 Jun of this year)',
    figureCodeLabel: 'Label',
    yearSpan: y => `1 Jul ${y - 1} – 30 Jun ${y}`,
    currentTaxYear: now => (now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1),
    seedDeadlines: y => ({ deadline_standard: `${y}-10-31`, deadline_provisional: `${y + 1}-05-15` }),
    deadlineLabels: ['Self-lodgement deadline', 'Tax agent deadline (typical)'],
    activeDeadline: t => t.deadline_standard,
    defaultTaxpayerType: 'unknown',
    defaultAssessment: 'submit-requested',
    taxpayerTypes: [
      ['provisional', 'PAYG instalments'],
      ['standard', 'PAYG withholding only'],
      ['unknown', 'Unknown'],
    ],
    assessments: [
      ['submit-requested', 'Return required'],
      ['auto-assessed', 'Non-lodgment advice (no return needed)'],
      ['assessed', 'Assessed — notice of assessment received'],
      ['unknown', 'Not checked yet'],
    ],
    figureChecks() { return []; },
    seasonMsgs(t) {
      const msgs = [];
      if (t.assessment === 'auto-assessed') msgs.push('Lodge a non-lodgment advice on myGov so the ATO knows no return is coming.');
      else msgs.push('Wait for pre-fill to complete (usually late July) before lodging through myTax on myGov — lodge by 31 October, or engage a tax agent before then for a later deadline.');
      if (t.taxpayer_type === 'provisional') msgs.push('PAYG instalments are usually paid quarterly through the year — the ATO issues the activity statements.');
      return msgs;
    },
    safetyNote: 'Always type ato.gov.au or my.gov.au into the browser yourself — the ATO never asks for passwords or payment by email, SMS or phone.',
    seedSteps: () => [
      { step: 'Confirm your income statement is tax-ready', notes: 'Employers finalise Single Touch Payroll by mid-July' },
      { step: 'Wait for pre-fill to complete', notes: 'Bank interest, dividends and health-fund data flow in by late July' },
      { step: 'Gather deduction records', notes: 'Work-related expenses, working-from-home diary/logbook, donations' },
      { step: 'Declare investment income', notes: 'Interest, dividends (with franking credits), capital gains on sales' },
      { step: 'Add private health insurance details', notes: 'Statement pre-fills; affects the Medicare levy surcharge' },
      { step: 'Lodge through myTax on myGov', notes: 'Or via a registered tax agent' },
      { step: 'Check the notice of assessment & pay any balance', notes: '' },
      { step: 'Respond to ATO queries', notes: '' },
    ],
    seedDocs: () => [
      { name: 'Income statement (STP)', source: 'Employer via myGov', notes: 'Wait until marked tax-ready' },
      { name: 'Bank interest summary', source: 'Your bank', notes: 'One per bank' },
      { name: 'Dividend statements', source: 'Broker / registries', notes: 'Include franking credits' },
      { name: 'Private health insurance statement', source: 'Health fund', notes: '' },
      { name: 'Work-related deduction receipts', source: 'Own records', notes: 'Including working-from-home records' },
      { name: 'Capital gains records', source: 'Broker / own records', notes: 'For any assets sold' },
      { name: 'ATO letters & notices', source: 'ATO', notes: '' },
    ],
  },

  ca: {
    label: 'Canada',
    currency: '$',
    thousands: ',', decimal: '.',
    dayFirst: false,
    banks: 'RBC, TD, Scotiabank, BMO, CIBC',
    importHint: 'Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.',
    authority: 'CRA',
    taxIntro: 'Track a CRA tax-filing season here — progress steps, the documents you need (T4, T5, RRSP receipts, …) and the files themselves, stored in the vault.',
    yearHint: 'Tax year (calendar year)',
    figureCodeLabel: 'Line',
    yearSpan: y => `Jan – Dec ${y}`,
    currentTaxYear: now => (now.getMonth() + 1 <= 4 ? now.getFullYear() - 1 : now.getFullYear()),
    seedDeadlines: y => ({ deadline_standard: `${y + 1}-04-30`, deadline_provisional: `${y + 1}-06-15` }),
    deadlineLabels: ['Filing deadline', 'Self-employed deadline'],
    activeDeadline: t => (t.taxpayer_type === 'provisional' ? t.deadline_provisional : t.deadline_standard),
    defaultTaxpayerType: 'unknown',
    defaultAssessment: 'submit-requested',
    taxpayerTypes: [
      ['provisional', 'Self-employed / pays instalments'],
      ['standard', 'Employee (T4 only)'],
      ['unknown', 'Unknown'],
    ],
    assessments: [
      ['submit-requested', 'Return required'],
      ['auto-assessed', 'No return needed this year'],
      ['assessed', 'Assessed — notice of assessment received'],
      ['unknown', 'Not checked yet'],
    ],
    figureChecks() { return []; },
    seasonMsgs(t) {
      const msgs = [];
      if (t.assessment === 'auto-assessed') msgs.push('Even with no tax owing, filing keeps benefit and credit payments (GST/HST credit, CCB) flowing — consider filing anyway.');
      else msgs.push('Work through the steps below and file by 30 April. Self-employed filers have until 15 June, but any balance is still due 30 April.');
      if (t.taxpayer_type === 'provisional') msgs.push('The CRA may require quarterly instalments if you owe more than $3,000 in two consecutive years.');
      return msgs;
    },
    safetyNote: 'Always type canada.ca into the browser yourself — the CRA never demands payment or asks for credentials by email, SMS or phone.',
    seedSteps: () => [
      { step: 'Gather tax slips', notes: 'T4, T5, T3, T4A — most arrive by end of February; also in CRA My Account' },
      { step: 'Total RRSP contributions', notes: 'Including first-60-days contributions; check your deduction limit' },
      { step: 'Gather receipts', notes: 'Medical, donations, childcare, tuition' },
      { step: 'Total self-employment income & expenses', notes: 'Form T2125 — income minus business expenses' },
      { step: 'File via NETFILE-certified software', notes: 'Auto-fill my return pulls slips from CRA My Account' },
      { step: 'Pay any balance due', notes: 'Due 30 April even if filing by the self-employed deadline' },
      { step: 'Check the notice of assessment', notes: 'Confirms refund/balance and next year\'s RRSP room' },
      { step: 'Respond to CRA review requests', notes: '' },
    ],
    seedDocs: () => [
      { name: 'T4 employment income slip', source: 'Employer', notes: 'One per employer' },
      { name: 'T5 investment income slip', source: 'Your bank / broker', notes: '' },
      { name: 'T3 trust income slip', source: 'Fund provider', notes: 'Remove if not applicable' },
      { name: 'T4A pension / self-employment slip', source: 'Payer', notes: 'Remove if not applicable' },
      { name: 'RRSP contribution receipts', source: 'Financial institution', notes: 'Including first-60-days' },
      { name: 'Medical expense receipts', source: 'Own records', notes: '' },
      { name: 'Donation receipts', source: 'Own records', notes: '' },
      { name: 'Business income & expense records', source: 'Own records', notes: 'If self-employed' },
      { name: 'CRA letters & notices', source: 'CRA', notes: '' },
    ],
  },

  cn: {
    label: 'China (mainland)',
    currency: '¥',
    thousands: ',', decimal: '.',
    dayFirst: false,   // Chinese statements are big-endian YYYY-MM-DD → month before day when reduced
    banks: 'ICBC, China Construction Bank, Agricultural Bank of China, Bank of China, China Merchants Bank',
    importHint: 'Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.',
    authority: 'STA',
    taxIntro: 'Track a China Individual Income Tax (IIT) annual reconciliation here — progress steps, the documents you need and the files themselves, stored in the vault. Filing is through the 个人所得税 app or etax.chinatax.gov.cn.',
    yearHint: 'Tax year (calendar year)',
    figureCodeLabel: 'Item',
    yearSpan: y => `Jan – Dec ${y}`,
    /* Annual reconciliation runs 1 Mar – 30 Jun of the following year, so up
       to June you are still settling the prior calendar year. */
    currentTaxYear: now => (now.getMonth() + 1 <= 6 ? now.getFullYear() - 1 : now.getFullYear()),
    seedDeadlines: y => ({ deadline_standard: `${y + 1}-06-30`, deadline_provisional: `${y + 1}-03-01` }),
    deadlineLabels: ['Reconciliation deadline', 'Reconciliation window opens'],
    activeDeadline: t => t.deadline_standard,
    defaultTaxpayerType: 'unknown',
    defaultAssessment: 'unknown',
    taxpayerTypes: [
      ['provisional', 'Business / freelance income (prepaid, trued up annually)'],
      ['standard', 'Employer withholds monthly'],
      ['unknown', 'Unknown — check in the 个人所得税 app'],
    ],
    assessments: [
      ['submit-requested', 'Annual reconciliation required'],
      ['auto-assessed', 'Exempt from reconciliation'],
      ['assessed', 'Settled — reconciliation result received'],
      ['unknown', 'Not checked yet'],
    ],
    figureChecks() { return []; },
    seasonMsgs(t) {
      const msgs = [];
      if (t.assessment === 'submit-requested') msgs.push('The annual IIT reconciliation (汇算清缴) is required — complete it in the 个人所得税 app between 1 March and 30 June of the following year.');
      else if (t.assessment === 'auto-assessed') msgs.push('You appear exempt from the annual reconciliation (single employer, income within the threshold, or tax already settled monthly). Keep records anyway — a second income source can change that.');
      else msgs.push('Check in the 个人所得税 app whether you need the annual reconciliation — multiple income sources or under-withheld tax usually mean yes.');
      if (t.taxpayer_type === 'provisional') msgs.push('Business or labour-service income is usually prepaid monthly or quarterly and trued up in the annual reconciliation.');
      return msgs;
    },
    safetyNote: 'Always type chinatax.gov.cn or open the official 个人所得税 app yourself — the STA never asks for passwords or verification codes by SMS, email or phone.',
    seedSteps: year => [
      { step: 'Confirm whether you must do the annual reconciliation', notes: '个人所得税 app → 办税 → 综合所得年度汇算' },
      { step: 'Check pre-filled comprehensive income', notes: 'Wages, labour remuneration, author\'s remuneration and royalties pre-fill' },
      { step: 'Confirm special additional deductions', notes: 'Children\'s education, housing loan interest or rent, elderly care, continuing education, infant care under 3, serious-illness medical' },
      { step: 'Declare other comprehensive income', notes: 'Freelance / labour-service income from other payers not already withheld' },
      { step: 'Declare investment or overseas income', notes: 'Interest, dividends and any taxable foreign income — remove if not applicable' },
      { step: 'Submit the annual reconciliation', due: `${year + 1}-06-30`, notes: '1 Mar – 30 Jun, in the app or on etax.chinatax.gov.cn' },
      { step: 'Claim the refund or pay the balance due', notes: 'Refunds pay to your linked bank card; balances due by 30 June' },
      { step: 'Respond to STA queries', notes: '' },
    ],
    seedDocs: () => [
      { name: 'Comprehensive-income withholding records', source: 'Employer / payers', notes: 'Pre-fills in the 个人所得税 app' },
      { name: 'Labour-service / author-remuneration / royalty records', source: 'Other payers', notes: 'Remove if not applicable' },
      { name: 'Special additional deduction records', source: 'Own records', notes: 'Education, housing, elderly/infant care, medical' },
      { name: 'Housing loan interest or rent records', source: 'Bank / landlord', notes: '' },
      { name: 'Investment income records', source: 'Bank / broker', notes: 'If applicable' },
      { name: 'Overseas income records', source: 'Own records', notes: 'Remove if not applicable' },
      { name: 'STA letters & notices', source: 'STA', notes: '' },
    ],
  },

  other: {
    label: 'Other / not listed',
    currency: '$',
    thousands: ',', decimal: '.',
    dayFirst: true,
    banks: null,
    importHint: 'Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.',
    ...genericTax('Tax'),
  },
};

/* Dropdown order — South Africa first (the pre-country default). */
const COUNTRY_ORDER = ['za', 'us', 'uk', 'eu', 'au', 'ca', 'cn', 'other'];

/* Resolve a Settings.md `country` value to a profile; unknown/missing → za
   (every install before the country setting existed was South African). */
/* ISSUE 30 — an UNKNOWN country resolves to `other`, not to South Africa.

   This and loan-math.js's loanProfileFor() read the same `country` key and
   used to disagree about what an unrecognised value meant: this one returned
   PROFILES.za, that one returned GENERIC. A hand-edited `country: nl` in
   Settings.md — a plain markdown file this app documents as user-editable —
   therefore put one reader in two countries at once, handed them the full
   SARS checklist, ITR12 and the R23 800 interest exemption, and gave them a
   generic loan profile alongside it.

   `other` is the honest answer, and it exists precisely for this: a country
   this app has no tax law for gets no tax law. Serving South African rules to
   someone who typed "nl" is the more dangerous of the two ways to be wrong,
   because those rules look authoritative and are not theirs.

   A MISSING or blank code still means za — that is the documented default for
   every vault written before `country` existed, and changing it would move
   the tax page under people who never chose one. Only a value that was
   actually typed and is not recognised falls to `other`. */
function localeFor(code) {
  const raw = code == null ? '' : String(code).trim().toLowerCase();
  if (!raw) return PROFILES.za;
  return PROFILES[raw] || PROFILES.other;
}

module.exports = { PROFILES, COUNTRY_ORDER, localeFor };
