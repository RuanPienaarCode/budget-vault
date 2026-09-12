'use strict';
/* The populated vault every view-level suite mounts.

   Extracted from tests/views-render.test.cjs when a second suite needed the
   same household (ISSUE 84's wiring check). One copy, because two fixtures
   drifting apart is how a view-level guard starts proving something about a
   vault no other suite has.

   Every figure is synthetic. Never put real statement data in this repo. */

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test"\n---\n',

  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Transfer.md`]: '---\ntype: transfer\ncolor: "#666666"\n---\n',

  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ninstitution: "Bank A"\naccount_number: "12345678901"\ntx_label: "Cheque"\nbalance: 12000.00\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\ncredit_limit: 30000\nbalance: -4000.00\nsettle_monthly: true\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Savings Pot.md`]: '---\ntype: savings\nbalance: 55000.00\ngoal_amount: 100000\nmonthly_contribution: 2000\nbalance_updated: 2026-07-01\n---\n',
  [`${B}/Accounts/Fund.md`]: '---\ntype: investment\nbalance: 90000.00\ntotal_invested: 75000\nbalance_updated: 2026-07-01\n---\n',

  [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | |\n| Salary | income | 40000.00 | |\n',

  [`${B}/Transactions/Cheque/2026-07.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-07-01 | Salary | Salary | 40000.00 |  |  |  |\n'
    + '| 2026-07-03 | Grocer | Groceries | -1200.00 |  |  |  |\n'
    + '| 2026-07-05 | Split parent | Groceries | -900.00 | yes | Split into 2 | parent |\n'
    + '| 2026-07-05 | Split parent | Groceries | -500.00 |  |  | part |\n'
    + '| 2026-07-05 | Split parent | Salary | -400.00 |  |  | part |\n'
    + '| 2026-07-09 | Uncategorised thing |  | -300.00 |  |  |  |\n',

  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
    + '| Card debt | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 400.00 | 150.00 | 2024-03-01 | | active | |\n'
    + '| Vehicle | Bank B | vehicle | 150000.00 | 200000.00 | 11.25 | 3500.00 | 0.00 | 2023-01-15 | | active | |\n',

  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n| House | property | 1500000.00 | 2026-03-01 | |\n| Car | vehicle | 180000.00 | | |\n',

  [`${B}/Owed Money.md`]: '---\nkind: owed\n---\n\n| Person | Amount | Description | Due date | Status | Repaid |\n|---|---:|---|---|---|---:|\n| Sam | 250.00 | lunch | 2026-08-01 | outstanding | |\n| Lee | 400.00 | tools | | paid | 400.00 |\n',

  [`${B}/Services.md`]: '---\nkind: services\n---\n\n| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |\n|---|---|---:|---|---|---|---|---|\n| Streaming | Provider A | 199.00 | monthly | 2026-08-05 | Groceries | yes | |\n| Domain | Provider B | 250.00 | annual | 2026-11-01 | | no | |\n',

  [`${B}/Tax/2026.md`]: '---\nkind: tax\ntax_year: 2026\ntaxpayer_type: provisional\nassessment: pending\n---\n\n# Tax Year 2026\n\n## Progress\n\n| Step | Status | Due | Notes |\n|---|---|---|---|\n| Gather documents | busy | 2026-09-01 | |\n\n## Documents\n\n| Document | Source | Status | File | Notes |\n|---|---|---|---|---|\n| IRP5 | Employer | needed | | |\n\n## Figures\n\n| Source code | Description | Source | Amount |\n|---|---|---|---|\n| 4201 | Local interest | Bank A | 15000.00 |\n',
};

module.exports = FILES;
module.exports.B = B;
module.exports.TX_FM = TX_FM;
