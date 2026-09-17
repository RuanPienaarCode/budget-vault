'use strict';
/* A SECOND golden household. ISSUE 89.

   tests/figures/household.cjs is `month_start_day: 1`, monthly cycles, one
   populated period — and a 2026-09-09 mutation pass (100 blind mutants, 66
   killed) found three money rules that survive mutation because nothing in
   the suite ever runs a household shaped differently from it:

     - src/period.js's currentPeriod() year rollover (`m > 12` -> `m >= 12`):
       only reachable on a non-1 month_start_day, in the eight days a
       November-ending period can be mistaken for opening next January.
     - src/views/services.js's chargeIndex(): its deliberate choice NOT to
       filter `excluded` rows (CLAUDE.md — this is an ACCOUNT-level measure,
       and excluded means "out of the budget", not "money that didn't move")
       was never exercised, because no fixture put an excluded row on a
       service's own account.
     - the weekly/fortnightly cadence path, thinly covered because the one
       committed fixture never uses a sub-monthly cycle.

   So: `month_start_day: 23` (a non-1 boundary, and the one that puts the
   rollover mutation in reach), a weekly and a fortnightly service, six
   calendar months of distinct figures (so a windowing bug moves a number),
   TODAY on a calendar month-end that ALSO sits in the 23rd-30th window the
   rollover bug needs, and an excluded row on a service's own account.

   Deliberately narrower than household.cjs elsewhere — no multi-currency
   account, no split, no set-aside/assume-spent rows, no second owner beyond
   what the Accounts owner card needs. Those rules are already pinned by the
   first household; duplicating them here would only be a second copy to keep
   in sync, not a second thing being tested. */

const B = 'Budget';
/* 30 November: a calendar month-end, and inside the 23rd-30th window where
   `m > 12` (correct) and `m >= 12` (the mutant) first disagree — November is
   month 11; the payday-month branch increments it to 12 before testing the
   rollover, so a `>=` there fires on the November case a `>` never does. */
const TODAY = '2026-11-30';
/* With month_start_day 23 and today the 30th (>= 23), the period rolls
   forward one month from the calendar one: '2026-12', running 23 Nov - 22
   Dec. The mutant answers '2027-01' instead — an empty period, on every page
   that reads S.period. */
const PERIOD = '2026-12';

const TX_HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---:|---|---|---|\n';
const tx = rows => TX_HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  | ${r[5] || ''} |\n`).join('');

const SEED = {
  [`${B}/Settings.md`]:
    '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n'
    + 'owners: Alex, Sam\n---\n',

  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Categories/Gym.md`]: '---\ntype: expense\ncolor: "#3366aa"\n---\n',
  [`${B}/Categories/Software.md`]: '---\ntype: expense\ncolor: "#6c757d"\n---\n',

  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nowner: Alex\nbalance: 20000.00\nbalance_updated: 2026-11-23\n---\n',
  /* One savings account, so the Accounts owner card (gated on TWO owner rows)
     and the Savings page both have something — not the multi-currency case,
     which household.cjs already pins. */
  [`${B}/Accounts/Emergency fund.md`]:
    '---\ntype: savings\ntx_label: "Emergency fund"\nowner: Sam\nemergency_fund: true\nbalance: 15000.00\n'
    + 'balance_updated: 2026-11-23\ninception_date: 2026-01-01\nstarting_amount: 10000.00\n---\n',

  [`${B}/Budgets/${PERIOD}.md`]:
    '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n'
    + '| Groceries | expense | 4200.00 |  |\n'
    + '| Rent | expense | 9000.00 |  |\n'
    + '| Gym | expense | 1200.00 |  |\n'
    + '| Software | expense | 200.00 |  |\n',

  /* Six calendar months, June through November, each a different Groceries
     figure — so a period-window or income-averaging bug that folds two
     months together, or drops one, moves a number a reader could add up by
     hand. Salary and Rent are steady (an ordinary household), Groceries
     is not. */
  [`${B}/Transactions/Cheque/2026-06.md`]: tx([
    ['2026-06-01', 'Salary', 'Salary', 30000],
    ['2026-06-01', 'Landlord', 'Rent', -9000],
    ['2026-06-05', 'Checkers', 'Groceries', -4000],
  ]),
  [`${B}/Transactions/Cheque/2026-07.md`]: tx([
    ['2026-07-01', 'Salary', 'Salary', 30000],
    ['2026-07-01', 'Landlord', 'Rent', -9000],
    ['2026-07-05', 'Checkers', 'Groceries', -4200],
  ]),
  [`${B}/Transactions/Cheque/2026-08.md`]: tx([
    ['2026-08-01', 'Salary', 'Salary', 30000],
    ['2026-08-01', 'Landlord', 'Rent', -9000],
    ['2026-08-05', 'Checkers', 'Groceries', -3800],
  ]),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 30000],
    ['2026-09-01', 'Landlord', 'Rent', -9000],
    ['2026-09-05', 'Checkers', 'Groceries', -4500],
  ]),
  /* The fortnightly service: two charges 14 days apart. */
  [`${B}/Transactions/Cheque/2026-10.md`]: tx([
    ['2026-10-01', 'Salary', 'Salary', 30000],
    ['2026-10-01', 'Landlord', 'Rent', -9000],
    ['2026-10-05', 'Checkers', 'Groceries', -4100],
    ['2026-10-07', 'CloudBackup', 'Software', -100],
    ['2026-10-21', 'CloudBackup', 'Software', -100],
  ]),
  /* November: the last COMPLETED period's data (2026-11 = Oct 23 - Nov 22)
     dated the 1st-5th, and the CURRENT period's data (2026-12 = Nov 23 -
     Dec 22) dated the 24th-25th — already landed, since TODAY is the 30th.

     The weekly service, Virgin Active, is charged twice: once ordinary
     (3 Nov, R250, the stated price) and once EXCLUDED (17 Nov, R350) — money
     that really left the account on a row the household marked out of the
     budget. `chargeIndex()` is an ACCOUNT-level measure and deliberately does
     not filter `excluded` (CLAUDE.md), so BOTH charges count toward the
     price: recent = median(R250, R350), a spread of 33% over that median,
     which crosses chargeStats' 15% "varies" line and prints a neutral
     "varies" badge rather than asserting a price. Filter the excluded row out
     and only R250 remains: no spread, no badge, `agrees: true` — the reader
     is told their price checks out on a service the app should have said
     nothing conclusive about, having (correctly) discarded a real charge. */
  [`${B}/Transactions/Cheque/2026-11.md`]: tx([
    ['2026-11-01', 'Salary', 'Salary', 30000],
    ['2026-11-01', 'Landlord', 'Rent', -9000],
    ['2026-11-05', 'Checkers', 'Groceries', -3900],
    ['2026-11-03', 'Virgin Active', 'Gym', -250],
    ['2026-11-17', 'Virgin Active', 'Gym', -350, 'yes'],
    ['2026-11-25', 'Salary', 'Salary', 30000],
    ['2026-11-24', 'Checkers', 'Groceries', -1500],
  ]),

  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n'
    + '| Card | FNB | credit card | 8000.00 | 10000.00 | 20.00 | 500.00 | 100.00 | 2025-01-01 | | active | | |\n',

  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n'
    + '| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n'
    + '| Polo | vehicle | 80000.00 | 2024-01-01 |  |  |\n',

  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n'
    + '| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n'
    + '|---|---:|---|---|---|---:|---|---|\n'
    + '| Thabo | 2000.00 | Loan |  | outstanding | 500.00 | 2026-06-01 |  |\n',

  /* One weekly, one fortnightly — the sub-monthly cadence the household
     fixture never exercises. */
  [`${B}/Services.md`]: '---\nkind: services\n---\n\n'
    + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
    + '|---|---|---:|---|---|---|---|---|---|\n'
    + '| Virgin Active | Virgin | 250.00 | weekly | 2026-12-07 | Gym | yes |  |  |\n'
    + '| CloudBackup | CloudCo | 100.00 | fortnightly | 2026-12-05 | Software | yes |  |  |\n',

  [`${B}/Plans/${PERIOD}.md`]: '---\nkind: plan\n---\n\n'
    + '| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n'
    + '| Rent | expense | 9000.00 |  |\n',

  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n'
    + '# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n'
    + '| Gather documents | busy | 2026-12-01 | |\n\n'
    + '## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n'
    + '| IRP5 | Employer | needed | | |\n\n'
    + '## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n'
    + '| 4201 | Local interest | Bank A | 15000.00 |\n',
};

module.exports = { SEED, B, TODAY, PERIOD };
