'use strict';
/* ISSUE 91 (1). A charge whose date names no day cannot say WHEN it happened,
   so it cannot prove a commitment has already gone off.

   committed.js's `charged` filtered `c.date <= from` with no realness test, and
   `<=` on a hand-typed column load.js never validates is a STRING comparison.
   Which junk gets through is decided by ASCII: "end of June" sorts above every
   ISO date and fell out, while `2026-02-30` — the month-length slip
   src/reconcile.js:172 names verbatim, date-SHAPED so ISO_DATE passes it —
   sorts exactly where a real February date would and went straight in. On a
   payday period straddling the month end (month_start_day 23, the shape
   CLAUDE.md's own periodRange example uses) it then satisfied the "it already
   landed" test, and R2 500 of medical aid moved out of "still committed" and
   into "actually free" — the direction this card must never be wrong in.

   Two channels, because the row reaches two different comparisons:

     1-2  the MONTHLY path, where `charged.some(c => c.date >= periodStart)`
          drops the service outright — plus a real charge in the same window as
          the negative control, so the guard cannot pass by deleting the
          landed rule altogether.
     3    the SUB-MONTHLY path, where remainingCharges maps the row through
          isoDayNumber — which rolls 2026-02-30 forward to 2026-03-02 without
          complaint — and one week's charge is cleared by a day that never was.

   recurring.js's chargeStats has refused this input class since ISSUE 75; this
   is the half of the module that decides whether the charge HAPPENED, and it
   had no equivalent. The disagreement was visible inside one function: `seen`
   reported its last charge as 2026-02-05 while the landed test said 2026-02-30
   had gone off.

     node tests/committed-undatable-charge.test.cjs */

const assert = require('assert');
const { serviceCommitments, whatsLeft } = require('../src/committed');
const { chargeStats } = require('../src/recurring');
const { isRealIsoDate, isoDayNumber, isoFromDayNumber } = require('../src/dates');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* A period that straddles the month end, so a day-30 slip in February sorts
   INSIDE it and at or before today. Inside a calendar month it never could:
   a day-out-of-range slip always sorts past that month's real last day. */
const periodStart = '2026-02-23';
const periodEnd = '2026-03-22';
const today = '2026-03-01';

const tx = (date, amount, desc) => ({ date, desc, cat: 'Medical', amount });

/* The precondition this whole file rests on, pinned so it cannot quietly stop
   being the case: the row is date-SHAPED, is not a day, and sorts inside the
   window on both sides of the comparison. */
{
  eq(isRealIsoDate('2026-02-30'), false, 'the fixture row is not a real calendar day');
  ok('2026-02-30' <= today && '2026-02-30' >= periodStart,
    'and it sorts inside this period as a string — otherwise nothing below is reached');
  eq(isoFromDayNumber(isoDayNumber('2026-02-30')), '2026-03-02',
    'isoDayNumber rolls it forward silently, which is what channel 3 turns on');
}

/* ---- 1: monthly — an impossible date must not prove the charge landed ---- */
{
  const service = { name: 'Medical Aid', provider: 'Discovery', active: true, cycle: 'monthly', amount: 2500 };
  const rows = [
    tx('2025-12-05', -2500, 'DISCOVERY HEALTH 4471'),
    tx('2026-01-05', -2500, 'DISCOVERY HEALTH 4471'),
    tx('2026-02-05', -2500, 'DISCOVERY HEALTH 4471'),
    tx('2026-02-30', -2500, 'DISCOVERY HEALTH 4471'),   // the month-length slip
  ];

  const items = serviceCommitments({ services: [service], rows, from: today, to: periodEnd, periodStart });
  eq(items.length, 1, 'an undatable row does not settle March\'s medical aid — the commitment is still owed');
  eq(items[0].amount, 2500, 'and it is owed in full');
  eq(items[0].due, '2026-03-05', 'due on the day the real charges establish, not the one the typo invented');

  /* The module disagreeing with itself is the tell: chargeStats already
     refused the row, so the two halves read the same list differently. */
  eq(chargeStats(rows).last, '2026-02-05',
    'chargeStats anchors on the last REAL charge (ISSUE 75) — the landed test must agree with it');

  const accounts = [{ name: 'Cheque', type: 'checking', implied: 10000, dated: true, inBudget: true }];
  const left = whatsLeft({
    accounts, services: [service], debts: [], rows, settleRows: rows,
    incomeRows: [], cardRows: [], periodStart, periodEnd, today,
  });
  eq(left.committed, 2500, 'still committed carries it');
  eq(left.free, 7500, 'and "actually free" is R2 500 lower than the cash — the figure the defect inflated');

  /* The same vault with the mistyped row simply absent must read identically:
     a row nobody can place may not move a figure in EITHER direction. */
  const clean = rows.filter(r => isRealIsoDate(r.date));
  const leftClean = whatsLeft({
    accounts, services: [service], debts: [], rows: clean, settleRows: clean,
    incomeRows: [], cardRows: [], periodStart, periodEnd, today,
  });
  eq(left.free, leftClean.free, 'an unplaceable row changes nothing a reader can see');
}

/* ---- 2: NEGATIVE CONTROL — a REAL charge this period still settles it.
   Without this, deleting the landed test entirely would pass case 1. ---- */
{
  const service = { name: 'Medical Aid', provider: 'Discovery', active: true, cycle: 'monthly', amount: 2500 };
  const rows = [
    tx('2025-12-05', -2500, 'DISCOVERY HEALTH 4471'),
    tx('2026-01-05', -2500, 'DISCOVERY HEALTH 4471'),
    tx('2026-02-05', -2500, 'DISCOVERY HEALTH 4471'),
    tx('2026-02-25', -2500, 'DISCOVERY HEALTH 4471'),   // a real day, inside this period
  ];
  const items = serviceCommitments({ services: [service], rows, from: today, to: periodEnd, periodStart });
  eq(items.length, 0, 'a charge that really went off this period is not still coming — rule 2 is untouched');
}

/* ---- 3: sub-monthly — isoDayNumber rolls the slip to 2026-03-02, where it
   would clear a cadence date three days wide and quietly buy a week back. ---- */
{
  const service = { name: 'Gym', provider: 'Virgin Active', active: true, cycle: 'weekly', amount: 250 };
  const real = ['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23']
    .map(d => tx(d, -250, 'VIRGIN ACTIVE DEBIT'));
  const withSlip = [...real, tx('2026-02-30', -250, 'VIRGIN ACTIVE DEBIT')];

  const of = rows => serviceCommitments({ services: [service], rows, from: today, to: periodEnd, periodStart })[0];
  const good = of(real);
  const slip = of(withSlip);

  eq(good.occurrences, 3, 'precondition: three weekly charges are still to come (2 Mar, 9 Mar, 16 Mar)');
  eq(slip.occurrences, good.occurrences,
    'the slip must not clear the 2 March charge — a day that never happened cannot account for one that will');
  eq(slip.amount, 750, 'so the window still owes 3 × R250, not R500');
  eq(slip.due, '2026-03-02', 'and the first remaining charge is still the one the reader can act on');
}

console.log(`PASS — an undatable charge cannot prove a commitment landed (${checks} assertions).`);
