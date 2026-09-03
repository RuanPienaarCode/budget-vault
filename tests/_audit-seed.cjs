'use strict';
/* The `BudgetAudit` household from the live 1.35.1 audit of 2 Sep 2026, as a
   fixture every issue from that audit can be reproduced against.

   Not a test — a shared seed. It is deliberately the SAME household across
   issues #35–#48, because most of those issues are one ledger read by
   different rules, and a per-issue fixture would let two fixes disagree
   about the household while each stayed green on its own file. */

const B = 'Budget';

const TX_HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---|---:|---|---|---|\n';
const tx = rows => TX_HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} |  |  |  |\n`).join('');

const DEBT_HEAD = '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n';

const OWED_HEAD = '---\nkind: owed\n---\n\n'
  + '| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n'
  + '|---|---:|---|---|---|---:|---|---|\n';

const ASSET_HEAD = '---\nkind: assets\n---\n\n'
  + '| Item | Kind | Value | Valued | Notes | Currency |\n'
  + '|---|---|---:|---|---|---|\n';

const SERVICE_HEAD = '---\nkind: services\n---\n\n'
  + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
  + '|---|---|---:|---|---|---|---|---|---|\n';

/* Sep 2026, calendar month. Today in every reproduction is 2026-09-02. */
const SEED = {
  [`${B}/Settings.md`]:
    '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',

  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Gift.md`]: '---\ntype: income\ncolor: "#55bb88"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Gym.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Categories/Medical.md`]: '---\ntype: expense\ncolor: "#3366aa"\n---\n',
  /* Typed savings/investment, which is this app's own vocabulary for "money
     moved, not money consumed" (TYPE_ORDER in constants.js). ISSUE 40 is about
     these two envelopes padding "budget remaining"; a fixture that typed them
     `expense` would be asserting that the app cannot tell them apart from
     groceries, which is a different — and true — statement about a household
     that has not filled the type in. */
  [`${B}/Categories/Emergency.md`]: '---\ntype: savings\ncolor: "#cc9933"\n---\n',
  [`${B}/Categories/Investing.md`]: '---\ntype: investment\ncolor: "#33cc99"\n---\n',
  [`${B}/Categories/Transfer.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',

  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 20000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Emergency fund.md`]:
    '---\ntype: savings\ntx_label: "Emergency fund"\nemergency_fund: true\nbalance: 15000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Baby fund.md`]:
    '---\ntype: savings\ntx_label: "Baby fund"\nbalance: 8000.00\nbalance_updated: 2026-09-01\n---\n',

  [`${B}/Budgets/2026-09.md`]:
    '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 35000.00 |  |\n'
    + '| Groceries | expense | 6000.00 |  |\n'
    + '| Gym | expense | 1000.00 |  |\n'
    + '| Medical | expense | 3500.00 |  |\n'
    + '| Emergency | expense | 2000.00 |  |\n'
    + '| Investing | expense | 2000.00 |  |\n',

  /* August, the last COMPLETED period — what the health card measures. The
     live audit vault had one; without it every share is null and the tile
     shows a dash, which is a different (correct) state from the one #37 is
     about. */
  [`${B}/Transactions/Cheque/2026-08.md`]: tx([
    ['2026-08-01', 'Salary', 'Salary', 35000],
    ['2026-08-01', 'Discovery', 'Medical', -3500],
    ['2026-08-04', 'Checkers', 'Groceries', -4000],
    ['2026-08-06', 'Virgin Active', 'Gym', -250],
    ['2026-08-13', 'Virgin Active', 'Gym', -250],
    ['2026-08-20', 'Virgin Active', 'Gym', -250],
    ['2026-08-27', 'Virgin Active', 'Gym', -250],
  ]),

  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 35000],
    ['2026-09-01', 'Discovery', 'Medical', -3500],
    ['2026-09-01', 'To emergency fund', 'Transfer', -2000],
    ['2026-09-02', 'Checkers', 'Groceries', -1200],
    ['2026-09-03', 'Virgin Active', 'Gym', -250],
    ['2026-09-10', 'Virgin Active', 'Gym', -250],
    ['2026-09-12', 'Woolworths', 'Groceries', -890],
    ['2026-09-17', 'Virgin Active', 'Gym', -250],
    ['2026-09-24', 'Virgin Active', 'Gym', -250],
  ]),
  [`${B}/Transactions/Emergency fund/2026-09.md`]: tx([
    ['2026-09-01', 'From cheque', 'Transfer', 2000],
    ['2026-09-28', 'Family gift', 'Gift', 5000],
  ]),
  [`${B}/Transactions/Baby fund/2026-09.md`]: tx([
    ['2026-09-01', 'Pram', 'Groceries', -5000],
  ]),

  [`${B}/Debts.md`]: DEBT_HEAD
    + '| FNB card | FNB | credit card | 8000.00 | 8000.00 | 22.25 | 500.00 | 0.00 | 2025-01-01 | | active | | |\n',

  [`${B}/Assets.md`]: ASSET_HEAD
    + '| Polo | vehicle | 85000.00 | 2026-01-01 |  |  |\n',

  [`${B}/Owed Money.md`]: OWED_HEAD
    + '| Thabo | 2000.00 | Loan |  | outstanding | 0.00 | 2026-06-01 |  |\n',

  /* Weekly is not in the Cycle vocabulary — table-schema's vocab() folds it to
     `monthly` and keeps `cycleRaw`. That is the ground truth #33 and #47 are
     about, so the fixture states it the way a household would type it. */
  [`${B}/Services.md`]: SERVICE_HEAD
    + '| Virgin Active | Virgin | 250.00 | weekly | 2026-09-03 | Gym | yes |  |  |\n',
};

const TODAY = '2026-09-02';
const PERIOD = '2026-09';

/* The clock, pinned — and it is part of this household's identity, not a
   convenience. Half the audit's findings ARE the date: a gift on the 28th
   counted on the 2nd, an instalment whose day went by yesterday, a balance
   confirmed this morning. currentPeriod() and todayIso() both read
   `new Date()`, so a suite that let the real date through would assert
   something different every morning and go green or red on the calendar
   rather than on the code — and every one of these files would quietly stop
   testing anything at all the moment the real month rolled past September
   2026.

   Subclassed rather than replaced so every OTHER use of Date in the loader
   and the period maths still works: only the no-argument constructor and
   now() are answered from the fixed instant. Same shape as the local helper
   in tests/dashboard-cards.test.cjs, lifted here because the whole audit
   suite needs it rather than one file. */
const RealDate = Date;
function atAuditDate(fn, iso = TODAY) {
  const [y, m, d] = iso.split('-').map(Number);
  const fixed = () => new RealDate(y, m - 1, d, 12, 0, 0);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixed().getTime()); }
    static now() { return fixed().getTime(); }
  }
  global.Date = FakeDate;
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate; });
}

module.exports = {
  SEED, TODAY, PERIOD, B, tx, atAuditDate,
  DEBT_HEAD, OWED_HEAD, ASSET_HEAD, SERVICE_HEAD,
};
