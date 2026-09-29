'use strict';
/* The synthetic household behind tests/lane-r-*.test.cjs: one August in which
   every kind of money that can land in a fund does, once. No real figure. */

const B = 'Budget';
const TX = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${Number(r[3]).toFixed(2)} | ${r[4] || ''} |  |  |\n`).join('');
const cat = (type, extra = '') => `---\ntype: ${type}\n${extra}---\n`;
const fund = (name, extra = '') => `---\ntype: savings\nbalance: 1000.00\nbalance_updated: 2026-08-01\ntx_label: "${name}"\nbudget: false\n${extra}---\n`;

/* August. Every case a rule has to tell apart, one row pair each:

     regular   Cheque -1 000 -> Kids Fund +1 000            a transfer: counts
     windfall  UIF lands in Cheque (Excluded), is moved on   both legs Excluded: not counted
     gift      Kids Fund +2 500 with no leg anywhere         outside money: not moved
     interest  Kids Fund +80, category interest:true         growth: not moved
     shuffle   Kids Fund -700 -> Old Fund +700               pool to pool: not moved
     half      Cheque -300 (Excluded) -> Kids Fund +300      one leg vetoed: not counted
     rebate    tax rebate lands in Cheque (Excluded), moved   all three legs Excluded: not counted
               on to Old Fund (Excluded)                      */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\n---\n',
  [`${B}/Categories/Salary.md`]: cat('income'),
  [`${B}/Categories/Windfall.md`]: cat('income'),
  [`${B}/Categories/Interest.md`]: cat('income', 'interest: true\n'),
  [`${B}/Categories/Groceries.md`]: cat('expense'),
  [`${B}/Categories/Saving.md`]: cat('savings'),
  [`${B}/Categories/Transfer.md`]: cat('transfer'),
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 35000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  [`${B}/Accounts/Kids Fund.md`]: fund('Kids Fund'),
  [`${B}/Accounts/Old Fund.md`]: fund('Old Fund'),
  [`${B}/Transactions/Cheque/2026-08.md`]: TX([
    ['2026-08-01', 'Salary', 'Salary', 30000],
    ['2026-08-02', 'To kids fund', 'Saving', -1000],
    ['2026-08-03', 'UIF payout', 'Windfall', 25000, 'yes'],
    ['2026-08-04', 'UIF to kids fund', 'Transfer', -25000, 'yes'],
    ['2026-08-05', 'Checkers', 'Groceries', -5000],
    ['2026-08-14', 'To kids fund (vetoed leg)', 'Saving', -300, 'yes'],
    ['2026-08-12', 'Tax rebate', 'Windfall', 5000, 'yes'],
    ['2026-08-13', 'Rebate to old fund', 'Saving', -5000, 'yes'],
  ]),
  [`${B}/Transactions/Kids Fund/2026-08.md`]: TX([
    ['2026-08-02', 'From cheque', 'Saving', 1000],
    ['2026-08-04', 'UIF from cheque', 'Transfer', 25000, 'yes'],
    ['2026-08-06', 'Gift from gran', 'Windfall', 2500],
    ['2026-08-07', 'Interest earned', 'Interest', 80],
    ['2026-08-10', 'To old fund', 'Saving', -700],
    ['2026-08-14', 'From cheque', 'Saving', 300],
  ]),
  [`${B}/Transactions/Old Fund/2026-08.md`]: TX([
    ['2026-08-10', 'From kids fund', 'Saving', 700],
    ['2026-08-13', 'Rebate from cheque', 'Saving', 5000, 'yes'],
  ]),
};

module.exports = { B, TX, cat, fund, FILES };
