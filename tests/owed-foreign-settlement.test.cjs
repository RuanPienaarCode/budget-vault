'use strict';
/* A foreign owed entry could never be settled, and its money could never come
   back.

   owedSummary()'s foreign branch `continue`d before `isSettled(o)` ran, so
   every one of the six lines below it was unreachable for a foreign entry.
   Two consequences, and the first is visible on the page:

     1. AN ENTRY THE READER MARKED PAID STAYED OUTSTANDING FOREVER. The row's
        own pill reads "Paid" — views/owed.js calls the same isSettled() — while
        the tile beside it says "plus € 500 owed in other currencies", off the
        same array, in the same render. Nothing the reader can do clears it:
        `status: paid` is exactly what the app tells them to set, and setting it
        moved nothing.

     2. RECOVERED MONEY WAS DISCLOSED NOWHERE. A €200 part-payment on a €500
        loan could not reach `recovered` (that total is in rand, and €200 is
        not R200 — currency.js:10 forbids the conversion), and there was no
        foreign counterpart for it to reach instead. currency.js:14 forbids
        the other half of that: money is never dropped silently. It was being
        dropped silently.

   Both are pinned here, plus the property that makes the fix safe: absent a
   household symbol, owedSummary behaves exactly as it always did — the same
   optional contract worth() and debtInterestMonthly carry.

     node tests/owed-foreign-settlement.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { owedSummary } = require('../src/owed-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-09-02';
const entry = o => ({ person: 'A', amount: 0, repaid: 0, status: 'outstanding', lent: '2026-01-01', currency: '', ...o });

/* ---- 1. a foreign entry the reader marked paid is settled ---- */
{
  const s = owedSummary([entry({ amount: 500, status: 'paid', currency: '€' })], TODAY, 'R');
  eq(s.otherCurrencies, [],
    'a foreign entry flagged paid is NOT still outstanding — the pill on its own row already says Paid');
  eq(s.recoveredOthers, [['€', 500]],
    'and the money that came back is named in its own currency rather than vanishing');
  eq(s.open, 0, 'nothing is open');
}

/* ---- 2. a foreign entry settled by its own arithmetic, not by the flag ---- */
{
  const s = owedSummary([entry({ amount: 500, repaid: 500, currency: '€' })], TODAY, 'R');
  eq(s.otherCurrencies, [], 'repaid in full settles a foreign entry the same way it settles a household one');
  eq(s.recoveredOthers, [['€', 500]], 'and the full amount is recovered, in euro');
}

/* ---- 3. a part-payment lands on BOTH sides, each in the right one ---- */
{
  const s = owedSummary([entry({ amount: 500, repaid: 200, currency: '€' })], TODAY, 'R');
  eq(s.otherCurrencies, [['€', 300]], 'what is still out is net of the part-payment, exactly as the household total is');
  eq(s.recoveredOthers, [['€', 200]], 'and the part that came back is stated rather than dropped');
  eq(s.outstanding, 0, 'neither figure leaks into the rand totals — there is no rate here to convert with');
  eq(s.recovered, 0, 'and no euro is counted as a rand');
}

/* ---- 4. household entries are untouched, and the two sides do not mix ---- */
{
  const s = owedSummary([
    entry({ person: 'Sam', amount: 1000, repaid: 400 }),
    entry({ person: 'Kim', amount: 2000, status: 'paid' }),
    entry({ person: 'Luc', amount: 500, repaid: 200, currency: '€' }),
    entry({ person: 'Ada', amount: 300, currency: '$' }),
  ], TODAY, 'R');
  eq(s.outstanding, 600, 'the rand outstanding is the rand entries only');
  eq(s.recovered, 2400, 'and so is the rand recovered');
  eq(s.entries, 4, 'every row is still counted as an entry — nothing disappeared from the book');
  eq(s.otherCurrencies, [['€', 300], ['$', 300]], 'each foreign symbol keeps its own outstanding total');
  eq(s.recoveredOthers, [['€', 200]], 'and only the symbols that actually saw money back appear on the recovered side');
}

/* ---- 5. no household symbol: byte-for-byte the old behaviour ---- */
{
  const rows = [
    entry({ person: 'Sam', amount: 1000, repaid: 400 }),
    entry({ person: 'Luc', amount: 500, repaid: 200, currency: '€' }),
  ];
  const s = owedSummary(rows, TODAY);
  eq(s.outstanding, 900, 'absent a household symbol every entry is added, exactly as this function always behaved');
  eq(s.recovered, 600, 'on both sides');
  eq(s.otherCurrencies, [], 'and nothing is held out, so there is nothing to name');
  eq(s.recoveredOthers, [], 'on either list');
}

/* ---- 6. the negative-amount clamp reaches the foreign side too ----

   A stray minus sign makes outstandingOf clamp to 0, which marks the row
   settled — and the settled branch adds `amount`. On the household side that
   was a real bug (a -500 row dropped Recovered from R500 to R0) and is already
   floored; the foreign branch is the same arithmetic and must not reintroduce
   it one currency over. */
{
  const s = owedSummary([
    entry({ person: 'Luc', amount: 500, status: 'paid', currency: '€' }),
    entry({ person: 'Typo', amount: -500, currency: '€' }),
  ], TODAY, 'R');
  eq(s.recoveredOthers, [['€', 500]], 'a negative amount contributes nothing rather than eating a real recovery');
  eq(s.otherCurrencies, [], 'and nothing negative reaches the outstanding side either');
}

/* ---- 7. a single-currency vault carries neither list ---- */
{
  const s = owedSummary([entry({ amount: 1000, repaid: 250 })], TODAY, 'R');
  eq(s.otherCurrencies, [], 'empty on every single-currency vault');
  eq(s.recoveredOthers, [], 'and so is its counterpart, so no view has to special-case one and not the other');
  ok(s.oldestDays !== null, 'the household entry still ages, so the fixture is a live one');
}

console.log(`PASS  owed-foreign-settlement.test.cjs  (${checks} checks)`);
