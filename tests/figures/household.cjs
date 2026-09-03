'use strict';
/* The household the committed numbers ledger is harvested from.

   Its own fixture rather than a share of tests/_audit-seed.cjs: that seed is
   pinned to one audit's reproductions and moves when those issues move, and a
   golden ledger whose household drifts underneath it reports every drift as a
   regression. This one changes only when someone means to change what the
   ledger covers.

   Chosen to light up all sixteen views, because a figure on a page nothing
   populates is a figure the ledger cannot see. So: two months of transactions
   either side of the period boundary, an income and several expense categories
   plus a transfer, a savings account with an inception date, a foreign-currency
   account (the multi-currency split is this repo's most-repeated bug shape),
   a debt with a rate and an extra payment, an asset old enough to be stale, a
   service, money owed, a plan and a tax year.

   Since 1.39.0 it also holds one of each row shape the four-phase calculation
   refactor settled (ADR-0005, ADR-0006), so the ledger pins those rules too:
   a set-aside envelope with its contribution (Investing), an assume-spent
   category with no transaction behind it (Carry), a split (a Takealot parent
   with two parts), and an outflow from the earmarked emergency fund (the
   pram). Before this the fixture held none of them, which is why every phase
   of that refactor left the ledger byte-identical — it could not see what
   had changed.

   Every figure is a round number a reader can do in their head. That is
   deliberate: when the ledger moves, the diff should be legible without a
   calculator, and a fixture full of realistic-looking noise makes a one-cent
   rounding change indistinguishable from a broken rule. */

const B = 'Budget';
const TODAY = '2026-09-02';
const PERIOD = '2026-09';

const TX_HEAD = '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n'
  + '|---|---|---|---:|---|---|---|\n';
const tx = rows => TX_HEAD + rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  | ${r[5] || ''} |\n`).join('');

const SEED = {
  [`${B}/Settings.md`]:
    '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',

  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Categories/Gym.md`]: '---\ntype: expense\ncolor: "#3366aa"\n---\n',
  [`${B}/Categories/Transfer.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',
  /* Set-aside: an investment-typed category. Its outflow is money the
     household KEPT, so it leaves "spent" and "budget used" (ADR-0005). */
  [`${B}/Categories/Investing.md`]: '---\ntype: investment\ncolor: "#66aa33"\n---\n',
  /* Assume-spent: consumed at its budget with no statement line behind it. */
  [`${B}/Categories/Carry.md`]: '---\ntype: expense\ncolor: "#aa6633"\nassume_spent: true\n---\n',

  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 20000.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Accounts/Emergency fund.md`]:
    '---\ntype: savings\ntx_label: "Emergency fund"\nemergency_fund: true\nbalance: 15000.00\n'
    + 'balance_updated: 2026-09-01\ninception_date: 2026-01-01\nstarting_amount: 10000.00\n---\n',
  /* The foreign account. Every multi-currency bug this repo has had needed one
     account the household total must NAME rather than SUM — the hero, the
     split, the score and both exports have each got this wrong at least once. */
  [`${B}/Accounts/Dollar savings.md`]:
    '---\ntype: savings\ntx_label: "Dollar savings"\ncurrency: "$"\nbalance: 1000.00\n'
    + 'balance_updated: 2026-09-01\n---\n',

  [`${B}/Budgets/2026-09.md`]:
    '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n'
    + '| Groceries | expense | 5000.00 |  |\n'
    + '| Rent | expense | 9000.00 |  |\n'
    + '| Gym | expense | 1000.00 |  |\n'
    + '| Investing | investment | 2000.00 |  |\n'
    + '| Carry | expense | 500.00 |  |\n',

  /* August: the last COMPLETED period, which is what the health card and every
     comparison column measure. Without one, each of those is a dash — a valid
     state, but not the one worth pinning. */
  [`${B}/Transactions/Cheque/2026-08.md`]: tx([
    ['2026-08-01', 'Salary', 'Salary', 30000],
    ['2026-08-01', 'Landlord', 'Rent', -9000],
    ['2026-08-05', 'Checkers', 'Groceries', -4000],
    ['2026-08-06', 'Virgin Active', 'Gym', -1000],
  ]),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-01', 'Salary', 'Salary', 30000],
    ['2026-09-01', 'Landlord', 'Rent', -9000],
    ['2026-09-02', 'Checkers', 'Groceries', -2000],
    ['2026-09-02', 'To emergency fund', 'Transfer', -1000],
    /* The set-aside contribution: one leg, to a platform outside the vault. */
    ['2026-09-02', 'To unit trust', 'Investing', -2000],
    /* The split: the parent is excluded by construction and superseded by its
       parts, which carry the money — 600 in total, across two categories. */
    ['2026-09-02', 'Takealot', 'Groceries', -600, 'yes', 'parent'],
    ['2026-09-02', 'Takealot', 'Groceries', -400, '', 'part'],
    ['2026-09-02', 'Takealot', 'Gym', -200, '', 'part'],
  ]),
  [`${B}/Transactions/Emergency fund/2026-09.md`]: tx([
    ['2026-09-02', 'From cheque', 'Transfer', 1000],
    /* The earmarked outflow: spend the fund paid for, disclosed on the hero
       as funded-from-savings and held out of budget spend (ISSUE 41). */
    ['2026-09-02', 'Pram', 'Groceries', -1500],
  ]),

  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n'
    + '| Card | FNB | credit card | 8000.00 | 10000.00 | 20.00 | 500.00 | 100.00 | 2025-01-01 | | active | | |\n',

  /* Valued in 2024 and read in 2026: old enough that isStaleValuation() fires,
     which is a caveat the page must print beside the figure. */
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n'
    + '| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n'
    + '| Polo | vehicle | 80000.00 | 2024-01-01 |  |  |\n',

  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n'
    + '| Person | Amount | Description | Due date | Status | Repaid | Lent | Currency |\n'
    + '|---|---:|---|---|---|---:|---|---|\n'
    + '| Thabo | 2000.00 | Loan |  | outstanding | 500.00 | 2026-06-01 |  |\n',

  [`${B}/Services.md`]: '---\nkind: services\n---\n\n'
    + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
    + '|---|---|---:|---|---|---|---|---|---|\n'
    + '| Virgin Active | Virgin | 1000.00 | monthly | 2026-09-06 | Gym | yes |  |  |\n',

  [`${B}/Plans/2026-09.md`]: '---\nkind: plan\n---\n\n'
    + '| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Salary | income | 30000.00 |  |\n'
    + '| Rent | expense | 9000.00 |  |\n',

  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n'
    + '# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n'
    + '| Gather documents | busy | 2026-09-01 | |\n\n'
    + '## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n'
    + '| IRP5 | Employer | needed | | |\n\n'
    + '## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n'
    + '| 4201 | Local interest | Bank A | 15000.00 |\n',
};

module.exports = { SEED, B, TODAY, PERIOD };
