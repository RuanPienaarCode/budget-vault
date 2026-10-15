'use strict';
/* "Actually free" holds the debit orders nobody listed on Services.md.

   serviceCommitments reads only Services.md and Debts.md, so a debit order the
   household never typed in — medical aid, car insurance, a monthly transfer
   into an investment account — was in neither "still committed" nor the cash
   the account's imported statements had absorbed. On the real vault this was
   found on, about R13 000 of orders that leave the cheque account around the
   1st of every period sat outside the figure, so "actually free" read that
   much too high the whole time the statement was not imported
   (2026-10-14 audit, L2a-N05 / L1-10).

   The decision (Ruan's default): hold them the way a not-yet-imported Service
   is held. Not every outflow: one that has been charged under the SAME
   description, once in each of the last three months, on about the same day
   and for about the same amount, from an in-budget cash account. Anything a
   Services row or a debt already counts is left to that row, so nothing is
   counted twice. Items come out in the shape the Dashboard already renders
   (kind 'service', name = the category, detail = the description).

   Synthetic figures; the shape is the real one.

     node tests/committed-recurring-debit-orders.test.cjs */

const assert = require('assert');
const { debitOrderCommitments, whatsLeft } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const P_START = '2026-10-22', P_END = '2026-11-21', TODAY = '2026-10-22';
const cheque = extra => ({ name: 'Cheque', type: 'checking', dated: true, inBudget: true, implied: 30000,
  importedTo: '2026-09-26', balanceDate: '2026-09-10', ...extra });

const row = (date, desc, cat, amount) => ({ date, desc, cat, amount: -amount });
const monthly = (desc, cat, amount, days) => days.map(d => row(d, desc, cat, amount));
const JUL_SEP = ['2026-07-01', '2026-08-01', '2026-09-01'];
const medical = monthly('DISCOVERY HEALTH 4471', 'Medical aid', 7500, JUL_SEP);
const invest = monthly('TRANSFER INVESTCO', 'Investing', 1000, JUL_SEP);
const owned = (rows, account) => new Map(rows.map(r => [r, account]));
const run = (rows, account, extra) => debitOrderCommitments({
  rows, services: [], debts: [], from: TODAY, to: P_END, periodStart: P_START,
  accountOfRow: owned(rows, account), ...extra,
});
const shape = items => items.map(i => [i.name, i.detail, i.basis, i.due, i.occurrences, i.amount])
  .sort((a, b) => (a[0] + a[3]).localeCompare(b[0] + b[3]));

/* ---- 1. the reported shape: two orders on the 1st, import stops on the 26th ---- */
{
  const out = run([...medical, ...invest], cheque());
  eq(shape(out), [
    ['Investing', 'TRANSFER INVESTCO', 'not-imported', '2026-10-01', 1, 1000],
    ['Investing', 'TRANSFER INVESTCO', 'charged', '2026-11-01', 1, 1000],
    ['Medical aid', 'DISCOVERY HEALTH 4471', 'not-imported', '2026-10-01', 1, 7500],
    ['Medical aid', 'DISCOVERY HEALTH 4471', 'charged', '2026-11-01', 1, 7500],
  ], 'each order is held for the date the import missed and committed for the one in the window');
  const held = out.find(i => i.basis === 'not-imported');
  eq([held.kind, held.account, held.asOf, held.unit === held.amount], ['service', 'Cheque', '2026-09-26', true],
    'in the item shape the Dashboard renders for a held Service, with its account and as-of');
}

/* ---- 1b. the shapes the real orders had ----
   Two transfers to two accounts whose bank wording differs only in digits are
   two orders (their categories and amounts tell them apart); and a debit order
   whose reference changes its LETTERS every month is still one order. */
{
  const twoTransfers = [
    ...monthly('SAVER IP759203-630843-DO', 'Savings (C)', 1000, JUL_SEP),
    ...monthly('SAVER IP758185-634578-DO', 'Savings (R)', 2000, JUL_SEP),
  ];
  eq(shape(run(twoTransfers, cheque())).map(r => [r[0], r[2], r[5]]), [
    ['Savings (C)', 'not-imported', 1000], ['Savings (C)', 'charged', 1000],
    ['Savings (R)', 'not-imported', 2000], ['Savings (R)', 'charged', 2000],
  ], 'two orders that share their wording once the digits are stripped are counted separately');

  const pension = ['AB1001', 'CD2002', 'EF3003'].map((ref, i) => row(JUL_SEP[i], `PENSIONCO  0555555  ${ref}`, 'Retirement', 450.25));
  eq(shape(run(pension, cheque())).map(r => [r[0], r[2], r[5]]), [
    ['Retirement', 'not-imported', 450.25], ['Retirement', 'charged', 450.25],
  ], 'an order whose reference letters change every month is still one order');
}

/* ---- 2. records that reach the date with no charge: not held ---- */
{
  const out = run(medical, cheque({ importedTo: '2026-10-05' }));
  eq(shape(out), [['Medical aid', 'DISCOVERY HEALTH 4471', 'charged', '2026-11-01', 1, 7500]],
    'a 1 Oct charge the statements reach and do not contain was not taken');
}

/* ---- 3. NEGATIVE CONTROLS: what must NOT be held ---- */
{
  const none = (rows, label, account) => eq(run(rows, account || cheque()), [], label);

  none([row('2026-07-03', 'SUPERMARKET', 'Groceries', 1450), row('2026-08-02', 'SUPERMARKET', 'Groceries', 2210),
    row('2026-09-04', 'SUPERMARKET', 'Groceries', 980)], 'an amount that varies is a habit, not a debit order');

  none([...medical, row('2026-09-01', 'OTHER ORDER', 'Medical aid', 7500)],
    'two charges of one amount in one category in a month are not told apart, so neither is claimed');

  none([...medical, row('2026-09-15', 'DISCOVERY HEALTH 4471', 'Medical aid', 7500)],
    'two charges in one month is not a once-a-month order');

  none(medical.slice(1), 'two months is not yet a pattern');

  none(monthly('DISCOVERY HEALTH', 'Medical aid', 7500, ['2026-06-01', '2026-08-01', '2026-09-01']),
    'a month with no charge breaks the run');

  none(monthly('GYM', 'Fitness', 300, ['2026-07-01', '2026-08-12', '2026-09-26']),
    'a day that wanders across the month is not a debit order');

  none(monthly('OLD POLICY', 'Insurance', 400, ['2026-03-01', '2026-04-01', '2026-05-01']),
    'an order that stopped in May is not revived by the boundary');

  none(medical, 'a credit-card payer is not cash leaving', cheque({ type: 'credit_card' }));
  none(medical, 'a savings or investment payer is not spendable cash', cheque({ type: 'savings' }));
  none(medical, 'an account opted out of the budget holds none of the cash', cheque({ inBudget: false }));

  eq(debitOrderCommitments({ rows: medical, services: [], debts: [], from: TODAY, to: P_END, periodStart: P_START }), [],
    'with no account map there is no payer to hold anything against');

  /* Income is not a debit order: only outflows. */
  none(medical.map(r => ({ ...r, amount: -r.amount })), 'a credit that repeats is income, not a debit order');
}

/* ---- 4. nothing counted twice ---- */
{
  const rows = [...medical, ...invest];
  const base = { rows, from: TODAY, to: P_END, periodStart: P_START, accountOfRow: owned(rows, cheque()) };
  const names = items => [...new Set(items.map(i => i.name))].sort();

  /* A Services row that matches the charges counts them through serviceCommitments. */
  const disc = { name: 'Medical aid', provider: 'Discovery', cycle: 'monthly', amount: 7500, active: true, next: '' };
  eq(names(debitOrderCommitments({ ...base, services: [disc], debts: [] })), ['Investing'],
    'the order a Services row matches is left to that row');

  /* Matched by the bank's wording alone: neither its name nor its category is the debit order's. */
  const byWording = { name: 'Health plan', provider: 'Discovery', cycle: 'monthly', amount: 7500, active: true, next: '', category: 'Cover' };
  eq(names(debitOrderCommitments({ ...base, services: [byWording], debts: [] })), ['Investing'],
    'a Services row that matches the charges by wording leaves them to serviceCommitments');

  /* A Services row whose tokens do not match the bank's wording still names the category. */
  const unmatched = { name: 'Health cover', provider: 'Nobody', cycle: 'monthly', amount: 7500, active: true, next: '', category: 'Medical aid' };
  eq(names(debitOrderCommitments({ ...base, services: [unmatched], debts: [] })), ['Investing'],
    'a category that already has a Services row is not counted again');

  /* An inactive row is the household saying it has stopped; its charges are not resurrected. */
  eq(names(debitOrderCommitments({ ...base, services: [{ ...disc, active: false }], debts: [] })), ['Investing'],
    'a cancelled Services row does not turn its charges into a debit order');

  /* A debt paid from the same category is the debt's instalment. */
  const debt = { name: 'Fund loan', lender: 'Bank', payment: 1000, status: 'active', category: 'Investing' };
  eq(names(debitOrderCommitments({ ...base, services: [], debts: [debt] })), ['Medical aid'],
    'a category a debt pays against is left to debtCommitments');

  /* End to end through whatsLeft: the order a Service matches is counted once. */
  const L = whatsLeft({
    accounts: [cheque()], services: [disc], debts: [], rows: medical, accountOfRow: owned(medical, cheque()),
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.committed, 15000, 'a Service-matched order is 2 x R7 500 once, not four times');
}

/* ---- 5. whatsLeft carries them into "actually free" ---- */
{
  const rows = [...medical, ...invest];
  const L = whatsLeft({
    accounts: [cheque()], services: [], debts: [], rows, accountOfRow: owned(rows, cheque()),
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.committed, 2 * 7500 + 2 * 1000, 'still committed holds both cycles of both orders');
  eq(L.free, 30000 - 17000, '"actually free" is the cash less them');
  eq(L.counts, { service: 4, debt: 0, card: 0, notImported: 2 }, 'and the counts say two are held for an account not imported yet');
  eq(L.items.filter(i => i.basis === 'not-imported').map(i => i.name).sort(), ['Investing', 'Medical aid'],
    'named in the disclosure by category');
}

console.log(`PASS committed-recurring-debit-orders.test.cjs (${checks} checks)`);
