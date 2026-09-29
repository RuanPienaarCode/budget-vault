'use strict';
/* A refund landing on a settle-monthly card lowers what the cycle spent on it
   (2026-09-29 audit).

   "On the card this cycle" summed the card's outflows and nothing else, so a
   refund inside the cycle left the figure - and the ratio against the income
   that settles it - too high. On the audited vault the lane-C reading was a
   Checkers refund on 2026-09-23 that the figure ignored.

   The rule: a REFUND is a positive row whose category is on file and is
   neither income nor a transfer (ledger.js isRefund). It nets against the
   cycle's spend whether or not the row is Excluded - the card owes what moved
   on it, whatever the budget thinks - but a payment INTO the card (a transfer),
   income deposited on it, and an uncategorised inflow are not refunds, or a
   settlement would read the card as owing nothing. The net is floored at zero.

     node tests/lane-x-card-refunds.test.cjs */
const assert = require('assert');
const { B, tx, base, account, renderDash } = require('./helpers/dash-audit.cjs');
const { whatsLeft } = require('../src/committed');
const { stamp, isRefund } = require('../src/ledger');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. isRefund, on stamped rows ----------------------------------------- */
{
  const env = { catType: n => ({ Transfer: 'transfer', Salary: 'income', Groceries: 'expense' })[n] || null, catKnown: n => ['Transfer', 'Salary', 'Groceries'].includes(n) };
  const mk = (amount, cat) => stamp([{ label: 'Visa', date: '2026-07-06', amount, cat, desc: 'x' }], env)[0];
  ok(isRefund(mk(175.40, 'Groceries')), 'money back under an expense category is a refund');
  ok(!isRefund(mk(-50, 'Groceries')), 'an outflow is not');
  ok(!isRefund(mk(2400, 'Transfer')), 'a payment into the card (transfer) is not');
  ok(!isRefund(mk(680, 'Salary')), 'income deposited on the card is not');
  ok(!isRefund(mk(100, '')), 'an uncategorised inflow is not');
  ok(!isRefund(mk(100, 'Nowhere')), 'nor is a category with no file');
}

/* ---- 2. whatsLeft, straight ------------------------------------------------ */
{
  const visa = { name: 'Visa', type: 'credit_card', settleMonthly: true, inBudget: true, dated: true, implied: -1200, currency: 'R' };
  const cheque = { name: 'Cheque', type: 'checking', inBudget: true, dated: true, implied: 9000, currency: 'R' };
  const salary = ['2026-04', '2026-05', '2026-06', '2026-07'].map(m => ({ date: `${m}-25`, amount: 20000, desc: 'Payday', cat: 'Salary' }));
  const out = (date, amount) => ({ date, amount: -amount, desc: 'Shop', cat: 'Groceries' });
  const input = extra => ({
    accounts: [cheque, visa], services: [], debts: [], rows: [], incomeRows: salary,
    cardRows: [out('2026-07-03', 1000), out('2026-07-05', 200)],
    periodStart: '2026-07-01', periodEnd: '2026-07-31', today: '2026-07-15', ...extra,
  });
  const none = whatsLeft(input({}));
  eq([none.cardSpend, none.cardRefunds, none.cardGross], [1200, 0, 1200], 'no refunds: unchanged');

  const refund = (date, amount) => ({ date, amount, desc: 'Refund', cat: 'Groceries' });
  const L = whatsLeft(input({ cardRefundRows: [refund('2026-07-09', 175.40), refund('2026-06-20', 999), refund('2026-08-02', 999), refund('2026-02-30', 999)] }));
  eq(L.cardGross, 1200, 'the gross outgoings are still reported');
  eq(L.cardRefunds, 175.40, 'only the refund inside the cycle (real date, inside the window) is netted');
  eq(Math.round(L.cardSpend * 100) / 100, 1024.60, 'the cycle spends what the card carried less what came back');
  eq(Math.round(L.cycle.spend * 100) / 100, 1024.60, 'and the cycle band reads the net figure');
  eq(Math.round(L.cycle.ratio * 10000) / 10000, Math.round(1024.60 / 20000 * 10000) / 10000, 'as does its ratio against the settling income');

  const all = whatsLeft(input({ cardRefundRows: [refund('2026-07-09', 5000)] }));
  eq([all.cardSpend, all.cycle], [0, null], 'refunds beyond the spend floor it at zero: no cycle forms, no negative spend');
}

/* ---- 3. the hero ----------------------------------------------------------- */
(async () => {
  const salary = ['2026-04', '2026-05', '2026-06', '2026-07'];
  const files = visa => ({
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-07-14' }),
    [`${B}/Accounts/Visa.md`]: account('Visa', { type: 'credit_card', settle_monthly: 'true', balance: '-1000.00', balance_updated: '2026-07-14' }),
    ...Object.fromEntries(salary.map(m => [`${B}/Transactions/Cheque/${m}.md`, tx([[`${m}-25`, 'Payday', 'Salary', 20000]])])),
    [`${B}/Transactions/Visa/2026-07.md`]: tx(visa),
  });
  const cardLine = text => {
    const m = /R[\s  ]?([\d\s  ]+) on the card this cycle/.exec(text);
    return m ? Number(m[1].replace(/[^\d]/g, '')) : null;
  };
  const spent = [['2026-07-03', 'Woolworths', 'Groceries', -1000], ['2026-07-05', 'Checkers', 'Groceries', -200]];
  const line = async rows => cardLine((await renderDash(files(rows), { today: '2026-07-15', period: '2026-07' })).t('#leftBody'));

  eq(await line(spent), 1200, 'control: no refund, the card carried R1 200');
  eq(await line([...spent, ['2026-07-09', 'Checkers refund', 'Groceries', 300, 'yes']]), 900,
    'an EXCLUDED refund under an expense category still lowers it: the card owes what moved on it');
  eq(await line([...spent, ['2026-07-09', 'Checkers refund', 'Groceries', 300]]), 900, 'and so does a counted one');
  eq(await line([...spent,
    ['2026-07-10', 'Settling up', 'Transfer', 5000, 'yes'],
    ['2026-07-11', 'Client', 'Salary', 700],
    ['2026-07-12', 'Mystery', '', 90],
  ]), 1200, 'a settlement payment, income and an uncategorised inflow on the card are not refunds');

  console.log(`PASS - lane X, card refunds net against the settlement cycle (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
