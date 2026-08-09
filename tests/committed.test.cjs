'use strict';
/* What's left — the forward view, and the six rules that make it trustworthy.

   src/committed.js is pure, so this runs in bare node with no stub. Every case
   passes an explicit `today`: a test that reads the wall clock passes in August
   and fails in September.

   The rule this file exists to defend is rule 2 — a commitment already charged
   is NOT a commitment. Medical aid that went off on the 1st is spent, not still
   coming. Counting it would inflate the committed figure every single period,
   and a reader who catches that once never trusts the card again.

     node tests/committed.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const {
  WHOLE_MONTH_DAYS, nextOnDay, cashOnHand, serviceCommitments, debtCommitments, whatsLeft,
} = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-08-13';
const P_START = '2026-07-26', P_END = '2026-08-25';   // a payday month, 31 days

/* A merchant charged on the 2nd of each month, at a price that rose. */
const fibreRows = [
  { date: '2026-05-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -779 },
  { date: '2026-06-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -859 },
  { date: '2026-07-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -859 },
];
const fibre = { name: 'Fibre', provider: 'Cool Ideas', cycle: 'monthly', amount: 779, active: true, next: '' };

/* ---- 1. nextOnDay places a day-of-month, and clamps a short month ---- */
{
  eq(nextOnDay('2026-08-13', 22), '2026-08-22', 'a day later this month');
  eq(nextOnDay('2026-08-13', 2), '2026-09-02', 'a day already past rolls to next month');
  eq(nextOnDay('2026-08-13', 13), '2026-08-13', 'today itself counts');
  eq(nextOnDay('2026-01-30', 31), '2026-01-31', 'the 31st exists in January');
  eq(nextOnDay('2026-02-15', 31), '2026-02-28', 'the 31st clamps to a short month, it does not skip it');
  eq(nextOnDay('', 5), null, 'no date, no placement');
  eq(nextOnDay('2026-08-13', 0), null, 'no day, no placement');
}

/* ---- 2. Cash: implied, in-budget, positive, and honest about gaps ---- */
{
  const r = cashOnHand([
    { name: 'Cheque', implied: 12400, dated: true, inBudget: true },
    { name: 'Credit Card', implied: -8400, dated: true, inBudget: true },
    { name: 'Holiday fund', implied: 5000, dated: true, inBudget: false },
    { name: 'Old savings', implied: 900, dated: false, inBudget: true },
  ]);
  eq(r.cash, 12400, 'only positive, in-budget balances are spendable cash');
  ok(r.cash !== 4000, 'a credit-card balance is a debt, not negative cash — the Debt page owns it');
  eq(r.counted, 2, 'counted = in-budget AND dated: the holiday fund is out of budget, the old savings undated');
  eq(r.unknown, ['Old savings'], 'an undated balance is NAMED, never folded in as zero');
}
{
  eq(cashOnHand([]).cash, 0, 'no accounts is no cash');
  eq(cashOnHand(null).counted, 0, 'a missing list is not a crash');
}

/* ---- 3. RULE 2: a charge already made is not still coming ---- */
{
  // Due on the 2nd. Today is the 13th, and the 2 Aug charge is in this period.
  const landed = [...fibreRows, { date: '2026-08-02', desc: 'COOL IDEAS FIBRE', cat: 'Internet', amount: -859 }];
  const out = serviceCommitments({
    services: [fibre], rows: landed, from: TODAY, to: P_END, periodStart: P_START,
  });
  eq(out, [], 'a service already charged in this period is NOT counted again');
}
{
  // Same service, same dates, but this period's charge has not landed.
  const out = serviceCommitments({
    services: [fibre], rows: fibreRows, from: '2026-07-30', to: P_END, periodStart: P_START,
  });
  eq(out.length, 1, 'a service not yet charged this period is still coming');
  eq(out[0].due, '2026-08-02', 'the due date is derived from the charge history, not typed');
  eq(out[0].amount, 859, 'RULE 3: the amount is what was really charged, not the 779 on the page');
  eq(out[0].basis, 'charged', 'and it says where the figure came from');
}

/* ---- 4. Only what falls inside the window ---- */
{
  const out = serviceCommitments({
    services: [fibre], rows: fibreRows, from: TODAY, to: P_END, periodStart: P_START,
  });
  eq(out, [], 'a charge due on the 2nd is not "still coming" on the 13th');
}
{
  const inactive = { ...fibre, active: false };
  eq(serviceCommitments({ services: [inactive], rows: fibreRows, from: '2026-07-30', to: P_END, periodStart: P_START }),
    [], 'an inactive service is not counted');
}
{
  // No history at all: the typed figure is all there is, and it is labelled.
  const svc = { name: 'iCloud', provider: 'Apple', cycle: 'monthly', amount: 199, active: true, next: '2026-08-20' };
  const out = serviceCommitments({ services: [svc], rows: [], from: TODAY, to: P_END, periodStart: P_START });
  eq(out.length, 1, 'a service with no charge history falls back to its typed date');
  eq(out[0].amount, 199, 'and to its typed amount');
  eq(out[0].basis, 'stated', 'clearly marked as stated rather than charged');
}

/* ---- 5. Debts: placed from real payments, and never double-counted ---- */
const bond = { name: 'Home loan', lender: 'FNB', payment: 2110, extra: 500, status: 'active', category: 'Bond', start: '2019-03-22' };
const paidHistory = [
  { date: '2026-05-22', desc: 'BOND', cat: 'Bond', amount: -2610 },
  { date: '2026-06-22', desc: 'BOND', cat: 'Bond', amount: -2610 },
  { date: '2026-07-22', desc: 'BOND', cat: 'Bond', amount: -2610 },
];
{
  const out = debtCommitments({
    debts: [bond], rows: paidHistory, from: TODAY, to: P_END, periodStart: P_START, periodDays: 31,
  });
  eq(out.length, 1, 'an unpaid instalment inside the window is still coming');
  eq(out[0].due, '2026-08-22', 'placed on the day the payments actually land');
  eq(out[0].amount, 2610, 'payment + extra, because both go out');
  eq(out[0].basis, 'contracted', 'a debt instalment is contracted, not observed');
}
{
  const paidThisPeriod = [...paidHistory, { date: '2026-08-05', desc: 'BOND', cat: 'Bond', amount: -2610 }];
  eq(debtCommitments({ debts: [bond], rows: paidThisPeriod, from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }),
    [], 'RULE 2 again: a debt already paid this period is not still coming');
}
{
  eq(debtCommitments({ debts: [{ ...bond, status: 'paid' }], rows: paidHistory, from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }),
    [], 'a settled debt is not counted');
  eq(debtCommitments({ debts: [{ ...bond, payment: 0, extra: 0 }], rows: [], from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }),
    [], 'a debt with no instalment has nothing to expect');
}
{
  /* RULE 6: unplaceable, so only a window of a whole month can claim it. On a
     weekly cycle a monthly instalment does NOT fall in every period, and
     claiming it three weeks out of four is the failure this guards. */
  const noLink = { ...bond, category: '', start: '' };
  eq(debtCommitments({ debts: [noLink], rows: [], from: TODAY, to: P_END, periodStart: P_START, periodDays: 31 }).length,
    1, 'a whole-month window can claim an unplaceable instalment');
  eq(debtCommitments({ debts: [noLink], rows: [], from: TODAY, to: '2026-08-19', periodStart: '2026-08-13', periodDays: 7 }),
    [], 'a weekly window must NOT claim a monthly instalment it cannot place');
  ok(WHOLE_MONTH_DAYS === 28, 'the threshold is a whole month');
}

/* ---- 6. The card as a whole ---- */
{
  const accounts = [{ name: 'Cheque', implied: 12400, dated: true, inBudget: true }];
  const rows = [...fibreRows, ...paidHistory];
  const L = whatsLeft({
    accounts, services: [fibre], debts: [bond], rows,
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.cash, 12400, 'cash is the implied balance');
  eq(L.committed, 2610, 'only the bond is still coming — the fibre was due on the 2nd');
  eq(L.free, 9790, 'free is cash less what is committed');
  eq(L.short, false, 'not short');
  eq(L.days, 12, '13 Aug to 25 Aug is 12 days');
  eq(Math.round(L.perDay), 816, 'per-day divides what is free by the days left');
  eq(L.counts, { service: 0, debt: 1 }, 'the counts describe what was actually counted');
  eq(L.items.length, 1, 'RULE 5: every counted charge is disclosed');
}
{
  /* RULE 4: a budget target is an intention and must never enter this figure.
     Nothing in the input carries one — this asserts the shape stays that way. */
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 1000, dated: true, inBudget: true }],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.committed, 0, 'no scheduled charges means nothing is committed, whatever is budgeted');
  eq(L.free, 1000, 'and everything in the account is free');
}
{
  // Short, not "negative free".
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 500, dated: true, inBudget: true }],
    services: [], debts: [bond], rows: paidHistory,
    periodStart: P_START, periodEnd: P_END, today: TODAY,
  });
  eq(L.short, true, 'less cash than commitments reads as short');
  eq(L.free, -2110, 'the figure itself keeps its sign for the caller to abs()');
  eq(L.perDay, null, 'there is no daily allowance to quote when there is nothing free');
}
{
  // The last day of a period: no division by zero, and no whole balance quoted
  // as a daily rate.
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 1000, dated: true, inBudget: true }],
    services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today: P_END,
  });
  eq(L.days, 0, 'the last day has no days left');
  eq(L.perDay, null, 'and quotes no per-day figure');
}
{
  // No dated balance anywhere: the cash side cannot be drawn, and must not
  // silently read as an empty account.
  const L = whatsLeft({
    accounts: [{ name: 'Cheque', implied: 12400, dated: false, inBudget: true }],
    services: [fibre], debts: [], rows: fibreRows,
    periodStart: P_START, periodEnd: P_END, today: '2026-07-30',
  });
  eq(L.cashKnown, false, 'an undated balance leaves cash unknown');
  eq(L.cash, 0, 'and contributes nothing');
  eq(L.unknownAccounts, ['Cheque'], 'the account is named so the reader can fix it');
  ok(L.committed > 0, 'the committed side still works without it');
}

console.log(`PASS — the forward view counts what is coming, once, and only what it can place (${checks} assertions).`);
