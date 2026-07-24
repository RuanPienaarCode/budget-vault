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

/* Shared generic tax content for countries without a dedicated profile. */
const genericTax = (authority) => ({
  authority,
  taxIntro: `Track a ${authority === 'Tax' ? 'tax' : authority} return season here — progress steps, the documents you need and where each one comes from, with the files themselves stored in your vault.`,
  yearHint: 'Tax year (calendar year)',
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
    ['unknown', 'Not checked yet'],
  ],
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
    banks: 'Discovery, FNB, Capitec, Nedbank, Standard Bank, Absa',
    importHint: null,   // keep the static Discovery-filename hint in the shell
    authority: 'SARS',
    taxIntro: 'Track a SARS return season here — progress steps, the documents you need (IRP5, IT3(b), medical certificate, …) and the files themselves, stored in the vault.',
    yearHint: 'Tax year (ends Feb of this year)',
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
      ['unknown', 'Not checked yet'],
    ],
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
    seedSteps: year => [
      { step: 'Confirm taxpayer status on eFiling', notes: 'Maintain Registered Particulars — provisional vs standard' },
      { step: 'Check auto-assessment status on the eFiling dashboard', notes: '' },
      { step: 'Gather documents', notes: 'See the Documents list below' },
      { step: 'Open the ITR12 return on eFiling', notes: 'sars.gov.za or the SARS MobiApp' },
      { step: 'Review pre-populated data', notes: 'IRP5, medical certificate, bank IT3(b)s — check both banks reflect' },
      { step: 'Add freelance income & deductible expenses', notes: 'Invoiced total; home office %, software, equipment, internet/phone portion, accounting fees' },
      { step: 'Declare investment income', notes: 'IT3(b)/IT3(c) from your investment provider: interest, dividends, capital gains on sales' },
      { step: 'Declare TFSA contributions', notes: 'Contribution certificate; check R36 000/yr & R500 000 lifetime limits' },
      { step: 'Claim out-of-pocket medical expenses', notes: 'Qualifying expenses not covered by the aid' },
      { step: 'Submit the ITR12', notes: '' },
      { step: 'Respond to SARS verification requests', notes: 'Within the timeframe SARS gives' },
      { step: `IRP6 provisional return ${year + 1} — period 1`, due: `${year}-08-31`, notes: 'Provisional taxpayers only — mark N/A if standard' },
      { step: `IRP6 provisional return ${year + 1} — period 2`, due: `${year + 1}-02-28`, notes: 'Provisional taxpayers only — mark N/A if standard' },
    ],
    seedDocs: () => [
      { name: 'IRP5 / IT3(a) employee certificate', source: 'Employer', notes: 'Usually pre-populated' },
      { name: 'IT3(b) interest certificate', source: 'Your bank', notes: 'One per bank you hold accounts with' },
      { name: 'IT3(b) interest certificate', source: 'Your second bank', notes: 'Remove if not applicable' },
      { name: 'IT3(b) / IT3(c) investment certificates', source: 'Investment provider', notes: 'Interest, dividends, capital gains' },
      { name: 'TFSA contribution certificate', source: 'Investment provider', notes: 'Growth is exempt; contributions still declared' },
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
      ['unknown', 'Not checked yet'],
    ],
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
      ['unknown', 'Not checked yet'],
    ],
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
      ['unknown', 'Not checked yet'],
    ],
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
      ['unknown', 'Not checked yet'],
    ],
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
      ['unknown', 'Not checked yet'],
    ],
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
function localeFor(code) {
  return PROFILES[(code || 'za').toString().trim().toLowerCase()] || PROFILES.za;
}

module.exports = { PROFILES, COUNTRY_ORDER, localeFor };
