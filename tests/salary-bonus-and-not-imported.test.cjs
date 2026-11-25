'use strict';
/* NUM-4 (2026-11-25 audit). Two ways the What's-left card lost a salary it
   could prove.

   1. A BONUS MONTH. findRecurringCredit judged a salary's sameness on the
      spread of its last three credits, so one month paid with a bonus on top
      (usually about 40 240, one month 74 378) put the spread at 85% and the
      salary vanished for three periods: no "lands on" line, and no settlement
      panel for the card it pays off. Sameness is now judged on the median of
      the recent three, and ONE credit larger than that median is tolerated
      while the others still agree within the existing 15%. The amount named
      is the median, never the bonus. A smaller outlier, or two outliers, are
      still refused: the detector must not start calling irregular income a
      salary.

   2. A SALARY THAT LANDED BUT IS NOT IMPORTED YET. whatsLeft only looked at a
      credit dated today or later, so a salary due on the 22nd, on an account
      imported only to the 15th, was dropped on the 26th — while a debit order
      in exactly that position is held as "not imported yet". The credit is now
      held the same way (committed.js knownTo against its account), marked as
      such, and never counted as cash.

   Synthetic rows; the figures are the audit's shape, not a household's.

     node tests/salary-bonus-and-not-imported.test.cjs */

const assert = require('assert');
const { findRecurringCredit } = require('../src/recurring');
const { whatsLeft } = require('../src/committed');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SAL = 'EMPLOYER SALARY';
const c = (date, amount, desc = SAL) => ({ date, amount, desc });

/* ---- 1. one bonus month among the recent three ---- */
{
  const T = '2026-11-10';
  const rows = [c('2026-07-23', 40240), c('2026-08-23', 40240), c('2026-09-23', 74378), c('2026-10-23', 40240)];
  const found = findRecurringCredit(rows, T);
  ok(found, 'a salary with one bonus month among its last three is still a salary');
  eq(found && found.amount, 40240, 'named at the usual pay (the median), not the bonus');
  eq(found && found.next, '2026-11-23', 'and expected on its usual day');

  /* The bonus as the newest credit: the window still holds it for three months. */
  const newest = findRecurringCredit([c('2026-08-23', 40240), c('2026-09-23', 40240), c('2026-10-23', 74378)], T);
  eq(newest && newest.amount, 40240, 'a bonus in the newest month does not hide or inflate the salary');

  /* The two usual credits may differ, within the existing spread of the median. */
  const drift = findRecurringCredit([c('2026-08-23', 40240), c('2026-09-23', 74378), c('2026-10-23', 42000)], T);
  eq(drift && drift.amount, 42000, 'the others agree within 15% of the median, which is the amount named');
}

/* ---- 2. what is still refused ---- */
{
  const T = '2026-11-10';
  const no = (rows, why) => eq(findRecurringCredit(rows, T), null, why);
  no([c('2026-08-23', 40240), c('2026-09-23', 20000), c('2026-10-23', 40240)],
    'a SMALLER outlier is not a bonus: a short month is not a predictable salary');
  no([c('2026-08-23', 40240), c('2026-09-23', 60000), c('2026-10-23', 80000)],
    'two outliers leave nothing agreeing: refused');
  no([c('2026-05-23', 20000, 'COMMISSION'), c('2026-06-23', 48000, 'COMMISSION'), c('2026-07-23', 31000, 'COMMISSION')],
    'commission that swings is still not a salary (the old guard case)');
  no([c('2026-08-23', 30000), c('2026-09-23', 40240), c('2026-10-23', 74378)],
    'one larger credit tolerated, but the remaining two must still agree');
}

/* ---- 3. a salary due before today, after its account's import ---- */
{
  const cheque = { name: 'Cheque', type: 'checking', dated: true, implied: 5000, importedTo: '2026-11-15', balanceDate: '2026-11-01' };
  const pay = ['2026-08-22', '2026-09-22', '2026-10-22'].map(d => c(d, 40240));
  const accountOfRow = new Map(pay.map(r => [r, cheque]));
  const base = {
    accounts: [cheque], services: [], debts: [], rows: [], settleRows: [], cardRows: [], cardRefundRows: [],
    incomeRows: pay, accountOfRow, periodStart: '2026-11-22', periodEnd: '2026-12-21', today: '2026-11-26',
  };
  const L = whatsLeft(base);
  ok(L.incoming, 'the salary due on the 22nd is held, since its account is imported only to the 15th');
  eq(L.incoming && L.incoming.amount, 40240, 'at the salary amount');
  eq(L.incoming && L.incoming.next, '2026-11-22', 'on the day it was due');
  eq(L.incoming && L.incoming.notImported, true, 'marked as not imported yet, the debit orders\' own state');
  eq(L.incoming && L.incoming.asOf, '2026-11-15', 'with the day its account is known to');
  eq(L.cash, 5000, 'and it is not cash: the cash figure is the implied balance alone');
  eq(L.afterIncoming, L.free + 40240, 'the after-pay figure is free plus the held salary, once');

  /* NEGATIVE CONTROL: the account imported past the 22nd with no salary on it.
     The pay is missing, not pending — dropped, exactly as a debit order is. */
  const imported = { ...cheque, importedTo: '2026-11-25' };
  const L2 = whatsLeft({ ...base, accounts: [imported], accountOfRow: new Map(pay.map(r => [r, imported])) });
  eq(L2.incoming, null, 'imported past its day with no salary: nothing is claimed');

  /* A confirmed balance after the due date already holds the pay if it came. */
  const confirmed = { ...cheque, balanceDate: '2026-11-24' };
  const L3 = whatsLeft({ ...base, accounts: [confirmed], accountOfRow: new Map(pay.map(r => [r, confirmed])) });
  eq(L3.incoming, null, 'a balance confirmed after the due date is not held twice');

  /* A salary still to come this period is unchanged, and not marked. */
  const L4 = whatsLeft({ ...base, today: '2026-11-20', periodStart: '2026-11-01', periodEnd: '2026-11-30' });
  eq(L4.incoming && L4.incoming.next, '2026-11-22', 'a salary still ahead is claimed as before');
  eq(L4.incoming && L4.incoming.notImported, undefined, 'and is an ordinary incoming credit, not a held one');
  const L5 = whatsLeft({ ...base, today: '2026-11-20', periodStart: '2026-10-22', periodEnd: '2026-11-21' });
  eq(L5.incoming, null, 'one landing after the period ends is not claimed');
}

console.log(`PASS salary-bonus-and-not-imported (${checks} checks)`);
