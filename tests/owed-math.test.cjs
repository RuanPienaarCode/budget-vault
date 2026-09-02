'use strict';
/* Owed Money arithmetic — the definitions the Owed page and the Dashboard's
   position band now SHARE.

   They did not always. outstandingOf/isSettled were local consts inside
   views/owed.js, and the dashboard band would have needed its own copy. The
   copy is the bug: the Owed page nets part-payments off, so a second
   implementation that summed `amount` instead of `amount - repaid` would report
   a half-recovered loan as still fully owed — on the screen read first, and
   against a page one tap away that disagrees. Same failure mode worth.js was
   extracted to end.

   Two things are pinned here:
     1. the arithmetic itself, case by case
     2. that owedSummary() returns EXACTLY what the old inline expressions in
        renderOwedKpis did — the extraction must be a refactor, not a rewrite

   Bare node; wired into ./build.sh.
     node tests/owed-math.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { outstandingOf, isSettled, owedSummary } = require('../src/owed-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The expressions renderOwedKpis carried before the extraction, verbatim. If
   owedSummary ever drifts from these, the Owed page's own tiles change too —
   which is the point: one definition, checked against its own history. */
function legacyOutstanding(list) {
  return list.filter(o => !isSettled(o)).reduce((s, o) => s + outstandingOf(o), 0);
}
function legacyRecovered(list) {
  return list.reduce((s, o) => s + Math.min(o.repaid || 0, o.amount || 0), 0)
    + list.filter(o => o.status === 'paid' && !(o.repaid > 0)).reduce((s, o) => s + (o.amount || 0), 0);
}

/* ------------------------------ outstandingOf --------------------------- */
eq(outstandingOf({ amount: 2000 }), 2000, 'nothing repaid: all of it is out');
eq(outstandingOf({ amount: 2000, repaid: 500 }), 1500, 'part-payments come off');
eq(outstandingOf({ amount: 2000, repaid: 2000 }), 0, 'fully repaid is zero');
/* A repayment larger than the loan is somebody's typo. Floored rather than
   allowed negative: a -500 here would quietly pay off the NEXT person's loan
   inside a total, and nobody would ever see which entry did it. */
eq(outstandingOf({ amount: 2000, repaid: 2500 }), 0, 'an over-repayment cannot go negative');
eq(outstandingOf({}), 0, 'a blank row is not a debt');

/* -------------------------------- isSettled ----------------------------- */
ok(!isSettled({ amount: 2000 }), 'money out is not settled');
ok(!isSettled({ amount: 2000, repaid: 500 }), 'nor is money partly back');
ok(isSettled({ amount: 2000, repaid: 2000 }), 'the arithmetic can conclude settled');
/* The explicit status still wins, because money comes back in ways the vault
   never sees — cash, a favour, a debt forgiven. A reader who says it is settled
   is right, and the app must not argue. */
ok(isSettled({ amount: 2000, repaid: 0, status: 'paid' }), 'and a reader may simply say so');

/* ------------------------------- owedSummary ---------------------------- */
{
  const list = [
    { person: 'Sam', amount: 2000, repaid: 500, status: 'outstanding', lent: '2026-05-01' },
    { person: 'Jo', amount: 800, repaid: 0, status: 'outstanding', lent: '2026-06-20' },
    { person: 'Kim', amount: 1200, repaid: 1200, status: 'outstanding', lent: '2026-03-01' },
    { person: 'Alex', amount: 400, repaid: 0, status: 'paid', lent: '2026-02-01' },
  ];
  const s = owedSummary(list, '2026-07-01');

  eq(s.outstanding, 2300, '1 500 from Sam plus 800 from Jo');
  eq(s.open, 2, 'Kim is settled by arithmetic and Alex by hand');
  eq(s.entries, 4, 'entries counts every row, settled or not');
  // 500 (Sam) + 0 (Jo) + 1 200 (Kim) + 400 (Alex, paid in cash) = 2 100
  eq(s.recovered, 2100, 'recovered includes money that came back off-ledger');
  /* Age of the oldest UNSETTLED entry — Kim's March loan is older but it is
     back, and dunning somebody who has already paid you is the one output here
     that would actually damage something. */
  eq(s.oldestDays, 61, 'oldest open entry is Sam at 61 days, not Kim at 122');

  eq(s.outstanding, legacyOutstanding(list), 'outstanding matches the pre-extraction expression');
  eq(s.recovered, legacyRecovered(list), 'recovered matches the pre-extraction expression');
}

/* No lending dates at all — the shape of a vault that pre-dates the `lent`
   column, which is additive and absent on every older file. `null`, not 0: a
   loan of unknown age is not a loan made today. */
{
  const s = owedSummary([{ person: 'Sam', amount: 500, status: 'outstanding' }], '2026-07-01');
  eq(s.oldestDays, null, 'no readable date means no age, not a zero');
  eq(s.outstanding, 500, 'which does not stop the total being computed');
}

/* An empty and an absent ledger both have to answer, because the dashboard band
   calls this before it knows whether the vault has an Owed Money.md at all. */
for (const [label, input] of [['empty', []], ['absent', undefined], ['null', null]]) {
  const s = owedSummary(input, '2026-07-01');
  /* Deliberately the WHOLE object, not a field at a time: a new key added to
     the summary shape has to be an explicit decision here, because the
     dashboard band destructures this and a key that appears without anyone
     noticing is a key nobody wired up. `recoveredOthers` (foreign money that
     came back — see tests/owed-foreign-settlement.test.cjs) arrived through
     exactly this check. */
  eq(s, { outstanding: 0, recovered: 0, open: 0, entries: 0, oldestDays: null,
    otherCurrencies: [], recoveredOthers: [] },
    `an ${label} ledger summarises to zeroes rather than throwing`);
}

/* ISSUE 30 — an entry in another currency (Owed Money.md gained a Currency
   column by ADR-0003 append). It is neither added into the rand total nor
   dropped: it comes back in `otherCurrencies` for the page to state.

   Without a household symbol the function behaves exactly as it always did
   and adds everything, which is what every existing caller gets and the right
   answer for a ledger where nothing states a currency. */
{
  const ledger = [
    { person: 'Sam', amount: 500, repaid: 0, status: 'outstanding' },
    { person: 'Pierre', amount: 300, repaid: 0, status: 'outstanding', currency: '€' },
  ];
  const blind = owedSummary(ledger, '2026-07-01');
  eq(blind.outstanding, 800, 'with no household symbol, every entry is added — unchanged behaviour');
  eq(blind.otherCurrencies, [], 'and nothing is reported as held out');

  const split = owedSummary(ledger, '2026-07-01', 'R');
  eq(split.outstanding, 500, 'told the household symbol, only the rand entry is in the total');
  eq(split.open, 1, 'and the open count matches the figure beside it');
  eq(split.otherCurrencies, [['€', 300]],
    'the euro entry is NAMED in its own currency — not converted, and not silently dropped');
}

/* Over-repayment across the whole summary: recovered must not count money that
   was never lent, or a fat-fingered repayment inflates the "Recovered" tile
   with cash that does not exist. */
{
  const list = [{ person: 'Sam', amount: 1000, repaid: 1500, status: 'outstanding' }];
  const s = owedSummary(list, '2026-07-01');
  eq(s.outstanding, 0, 'over-repaid is settled');
  eq(s.recovered, 1000, 'and recovered is capped at what was actually lent');
  eq(s.recovered, legacyRecovered(list), 'the cap matches the pre-extraction expression');
}

console.log(`PASS — owed arithmetic is shared, net of part-payments, and unchanged by the extraction (${checks} assertions).`);
