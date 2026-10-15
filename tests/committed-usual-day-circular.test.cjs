'use strict';
/* A debt's usual payment day is the circular median of the days it was paid.

   usualDay lifted every day under 16 by 31 whenever the payments spread more
   than 15 days, a rule written for a cluster that straddles the month END
   (30th, 31st, 1st, 2nd). Three payments on the 14th, 15th and 16th with one
   late on the 30th also spread more than 15, so the 14th and 15th were lifted
   to the 45th and 46th and the "usual day" came out as the 7th. A debt really
   paid mid-month was flagged missed from the 8th — a week early, on the card
   that asks the reader to chase it (2026-10-14 audit, L2b-03).

   The expected values are computed here independently: the day 1..31 that
   minimises the summed distance on a 31-day circle, ties to the lower day.
   Driven through debtCommitments, the only caller, so the figure asserted is
   the `due` date and the `missed` flag a reader sees.

     node tests/committed-usual-day-circular.test.cjs */

const assert = require('assert');
const { debtCommitments } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const circ = (a, b) => { const x = Math.abs(a - b); return Math.min(x, 31 - x); };
const circMedian = ds => {
  let best = null;
  for (let d = 1; d <= 31; d++) {
    const c = ds.reduce((t, x) => t + circ(x, d), 0);
    if (!best || c < best.c) best = { d, c };
  }
  return best.d;
};

const dueFor = dates => {
  const debt = { name: 'Car loan', category: 'Car loan', payment: 4800, status: 'active', start: '2025-01-15' };
  const rows = dates.map(d => ({ date: d, cat: 'Car loan', amount: -4800 }));
  const [c] = debtCommitments({ debts: [debt], rows, from: '2026-10-10', to: '2026-10-31', periodStart: '2026-10-01', periodDays: 31, today: '2026-10-10' });
  return c;
};

const CASES = [
  ['three mid-month, one late on the 30th', ['2026-06-14', '2026-07-15', '2026-08-16', '2026-09-30']],
  ['a month-end straddle', ['2026-06-30', '2026-07-31', '2026-08-01', '2026-09-02']],
  ['early in the month, one late on the 20th', ['2026-06-01', '2026-07-02', '2026-08-03', '2026-09-20']],
  ['an odd count across the seam', ['2026-05-29', '2026-06-30', '2026-07-31', '2026-08-01', '2026-09-02']],
  ['one outlier at the opposite end', ['2026-05-10', '2026-06-11', '2026-07-12', '2026-08-13', '2026-09-28']],
];
for (const [label, dates] of CASES) {
  const want = circMedian(dates.map(d => Number(d.slice(8))));
  /* The oracle is the usual day; the card places it with nextOnDay from the
     period start, so that is the date asserted. On the 10th a day before the
     10th has gone with no payment (missed); the 10th itself has not. */
  const c = dueFor(dates);
  eq([c.due, c.missed], [`2026-10-${String(want).padStart(2, '0')}`, want < 10], `${label}: usual day ${want}`);
}

/* The reported failure, spelled out: mid-month payers are not "missed" on the 10th. */
{
  const c = dueFor(['2026-06-14', '2026-07-15', '2026-08-16', '2026-09-30']);
  eq(c.missed, false, 'a debt paid around the 15th is not flagged missed on the 10th');
  eq(c.due >= '2026-10-14' && c.due <= '2026-10-16', true, 'and its due date is the 14th-16th, not the 7th');
}

/* An ordinary cluster is untouched: the plain median, as before. */
{
  eq(dueFor(['2026-07-03', '2026-08-05', '2026-09-04']).due, '2026-10-04', 'a tight cluster keeps its median');
  eq(dueFor(['2026-07-01', '2026-08-03']).due, '2026-10-02', 'and an even pair its rounded midpoint');
}

console.log(`PASS committed-usual-day-circular.test.cjs (${checks} checks)`);
