'use strict';
/* Money owed in another currency carried no pressure.

   owedSummary()'s foreign branch ended in `continue` before the household
   accounting below it, so a foreign entry reached the AMOUNT totals (split per
   symbol, disclosed beside the rand figure — that half has been right since
   1.34.0) and reached nothing else. `open` and `oldestDays` were both computed
   under that `continue`.

   Neither of those two figures is denominated in anything. `open` is a count of
   obligations and `oldestDays` is a count of days; there is no rate to invent
   for either, so currency.js:10 — the rule that keeps euros out of a rand total
   — has nothing to say about them. Holding them out was the foreign branch
   over-reaching: it was written to protect the SUMS, and took the pressure with
   it.

   What the reader saw. A €5 000 loan out for 400 days:

     - the Owed page's own row said "out 400 days" (views/owed.js reads
       daysSince(o.lent) per row with no currency filter at all, and the same
       isSettled() the summary uses), while
     - the Dashboard position band, off owedSummary(), said "nothing out on
       loan" — i18n.t('dash.pos.owedOpen', { count: 0 }) — with no oldest age
       beside it.

   Two figures derived by different rules, which is this repo's recurring bug
   shape, and here the two rules disagreed about whether a loan existed.

   The ordering fixed in 1.34.0 must survive: SETTLED first, then foreign. A
   foreign entry the reader marked `paid` is not open and does not age, exactly
   as a rand one does not — tests/owed-foreign-settlement.test.cjs owns that
   half and this file must not contradict it.

     node tests/owed-foreign-pressure.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { owedSummary } = require('../src/owed-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const TODAY = '2026-09-02';
const entry = o => ({ person: 'A', amount: 0, repaid: 0, status: 'outstanding', lent: '2026-01-01', currency: '', ...o });

/* ---- 1. an open foreign entry is an open entry ---- */
{
  const s = owedSummary([entry({ person: 'Luc', amount: 5000, currency: '€' })], TODAY, 'R');
  eq(s.open, 1,
    'a euro loan still out is one loan still out — "N open" counts obligations, not rand');
  eq(s.outstanding, 0, 'and no euro has joined the rand total, which is the part that was always right');
  eq(s.otherCurrencies, [['€', 5000]], 'the amount is still stated in its own symbol beside it');
}

/* ---- 2. …and it ages ---- */
/* 2026-01-01 to 2026-09-02 is 244 days. The date is a fixture literal and
   `today` is injected, so this assertion cannot change its answer in October —
   the same reason reconcile.js takes `today` at all. */
{
  const s = owedSummary([entry({ person: 'Luc', amount: 5000, currency: '€' })], TODAY, 'R');
  eq(s.oldestDays, 244,
    'the oldest debt age is a count of DAYS — there is no exchange rate between a day and a day');
}

/* ---- 3. the oldest entry wins whichever currency it is in ---- */
/* The defect at its most consequential: the rand entry is young, the euro one
   is old, and the page reported the young one as the oldest thing outstanding.
   A reader chasing their oldest loan was pointed at the wrong person. */
{
  const s = owedSummary([
    entry({ person: 'Sam', amount: 1000, lent: '2026-08-01' }),   // 32 days
    entry({ person: 'Luc', amount: 5000, lent: '2025-07-29', currency: '€' }), // 400 days
  ], TODAY, 'R');
  eq(s.open, 2, 'both loans are open');
  eq(s.oldestDays, 400, 'and the euro one is the oldest — 400 days, not Sam at 32');
}

/* ---- 4. a SETTLED foreign entry is still not open (the 1.34.0 ordering) ---- */
/* Settled first, then foreign. Both routes to settled: the explicit flag, and
   the arithmetic concluding it. If either of these goes to 1, the fix has been
   applied above isSettled() instead of below it and 1.34.0 has been regressed:
   the row's own pill would read "Paid" beside a count that still holds it. */
{
  const flagged = owedSummary([entry({ person: 'Luc', amount: 500, status: 'paid', currency: '€' })], TODAY, 'R');
  eq(flagged.open, 0, 'a foreign entry the reader marked paid is not open');
  eq(flagged.oldestDays, null, '…and does not age — a settled loan applies no pressure');

  const repaid = owedSummary([entry({ person: 'Luc', amount: 500, repaid: 500, currency: '€' })], TODAY, 'R');
  eq(repaid.open, 0, 'nor is one the arithmetic concludes is settled');
  eq(repaid.oldestDays, null, '…and it does not age either');
}

/* ---- 5. a negative amount does not become an open loan ---- */
/* A stray minus sign makes outstandingOf clamp to 0, which marks the row
   settled — so the typo row must fall out of the count on the SAME rule the
   money totals already floor it out on, rather than being counted as an
   obligation nobody holds. */
{
  const s = owedSummary([entry({ person: 'Typo', amount: -500, currency: '€' })], TODAY, 'R');
  eq(s.open, 0, 'a negative amount is settled by outstandingOf, so it is not an open loan');
  eq(s.oldestDays, null, 'and there is no age to report for a loan that is not out');
}

/* ---- 6. no household symbol: byte-for-byte the old behaviour ---- */
/* The negative control. Absent a household symbol nothing is held out at all,
   so every entry has always reached the household accounting — this fix must
   not have moved that vault by a single figure. */
{
  const s = owedSummary([
    entry({ person: 'Sam', amount: 1000, repaid: 400, lent: '2026-08-01' }),
    entry({ person: 'Luc', amount: 500, repaid: 200, currency: '€', lent: '2025-07-29' }),
  ], TODAY);
  eq(s.open, 2, 'both entries are added, exactly as this function always behaved');
  eq(s.outstanding, 900, 'on the money side too');
  eq(s.oldestDays, 400, 'and the age is the oldest of the lot');
}

/* ---- 7. `entries` still counts every row, open or not ---- */
/* The Owed page's Entries tile prints this. It has always been the whole book,
   and `open` is now a genuine subset of it for every row rather than for the
   household ones only — so the two figures on that page can be read against
   each other without a currency footnote nobody wrote. */
{
  const s = owedSummary([
    entry({ person: 'Sam', amount: 1000 }),
    entry({ person: 'Kim', amount: 2000, status: 'paid' }),
    entry({ person: 'Luc', amount: 500, currency: '€' }),
    entry({ person: 'Ada', amount: 300, status: 'paid', currency: '$' }),
  ], TODAY, 'R');
  eq(s.entries, 4, 'every row is an entry');
  eq(s.open, 2, 'and exactly the unsettled ones are open, in both currencies');
}

console.log(`PASS  owed-foreign-pressure.test.cjs  (${checks} checks)`);
