'use strict';
/* Two date labels from src/period.js, both from the audit of 20 Oct 2026.

   1. dateText(iso) — a date for PROSE. dayLabel says "Oct 23", which is right
      inside a sentence about this year and wrong about any other: "your
      balance was last confirmed Oct 23" read on 20 Oct 2026 about a date in
      2025 says three days ago when it means a year. dateText is dayLabel with
      ", YYYY" appended only when the year is not today's year — today being
      the same injected-or-clock today currentPeriod and periodSummary use.
      Anything that is not a real ISO date comes back exactly as it was given,
      so a caller can hand it a cell the reader typed without guarding first.

   2. MT-13 — periodShortLabel('2026-08') printed "Aug 26" on the trend axis.
      With periods that start on the 22nd that reads as the 26th of August.
      It is "Aug ’26" now (U+2019, the typographic year elision), which no
      reader takes for a day. Interval periods keep "7 Aug" — that one IS a
      day, the period's start.

   Mounted through the harness the same way tests/period-and-parsers.test.cjs
   mounts registerPeriod. Figures and dates are made up.
     node tests/period-date-text-and-axis-label.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

function periodCtx(settings) {
  const ctx = makeCtx({}, { settings });
  ctx.S.txFiles = {};
  require('../src/period')(ctx);
  return ctx;
}

/* ---- 1. dateText ---- */
{
  const { dateText, dayLabel } = periodCtx({ month_start_day: 22 });
  ok(typeof dateText === 'function', 'ctx.dateText is provided by registerPeriod');

  // today injected, like currentPeriod(todayArg)
  const TODAY = '2026-10-20';
  eq(dateText('2026-10-23', TODAY), 'Oct 23', 'a date in today\'s year is dayLabel alone');
  eq(dateText('2026-10-23', TODAY), dayLabel('2026-10-23'), 'and is exactly dayLabel, not a second spelling of it');
  eq(dateText('2026-01-01', TODAY), 'Jan 1', 'the first day of this year still needs no year');
  eq(dateText('2026-12-31', TODAY), 'Dec 31', 'nor the last');
  eq(dateText('2025-12-31', TODAY), 'Dec 31, 2025', 'last year carries its year');
  eq(dateText('2027-01-05', TODAY), 'Jan 5, 2027', 'so does next year');
  eq(dateText('2025-10-20', TODAY), 'Oct 20, 2025', 'the same day a year ago is NOT today');

  // today from the clock, when nothing is injected
  const unpin = pinClock(TODAY);
  try {
    eq(dateText('2026-03-04'), 'Mar 4', 'with no today passed, the clock\'s year decides');
    eq(dateText('2024-03-04'), 'Mar 4, 2024', 'and another year still carries its year');
  } finally { unpin(); }
  const unpin2 = pinClock('2027-02-01');
  try {
    eq(dateText('2026-03-04'), 'Mar 4, 2026', 'the same date reads with its year once the clock moves on');
  } finally { unpin2(); }

  // a malformed injected today falls back to the clock, as currentPeriod does
  const unpin3 = pinClock(TODAY);
  try {
    eq(dateText('2026-05-06', 'not-a-date'), 'May 6', 'a malformed today is ignored, not trusted');
  } finally { unpin3(); }

  // not a real ISO date: returned unchanged
  eq(dateText('', TODAY), '', 'empty stays empty');
  eq(dateText(undefined, TODAY), undefined, 'undefined stays undefined');
  eq(dateText(null, TODAY), null, 'null stays null');
  eq(dateText('soon', TODAY), 'soon', 'words a reader typed stay as typed');
  eq(dateText('2026-13-45', TODAY), '2026-13-45', 'a date-shaped string that is no date stays as given');
  eq(dateText('2026-02-30', TODAY), '2026-02-30', 'so does an impossible day');
  eq(dateText('2026-10-23 12:00', TODAY), '2026-10-23 12:00', 'a timestamp is not a date');
}

/* ---- 2. MT-13: the month-period axis label ---- */
{
  const { periodShortLabel, dayLabel, periodRange } = periodCtx({ month_start_day: 22 });
  eq(periodShortLabel('2026-08'), 'Aug \u201926', 'a month period reads Aug ’26 — a year, not the 26th');
  eq(periodShortLabel('2027-01'), 'Jan \u201927', 'across the year boundary too');
  eq(periodShortLabel('2026-12'), 'Dec \u201926', 'December');
  ok(!/^[A-Z][a-z]{2} \d{1,2}$/.test(periodShortLabel('2026-08')),
    'it can no longer be mistaken for a dayLabel ("Aug 22")');
  eq(dayLabel(periodRange('2026-08').end), 'Aug 21', 'the August period, starting on the 22nd, ends Aug 21');
}
{
  const { periodShortLabel } = periodCtx({ month_start_day: 23, period_days: 14, period_anchor: '2026-08-07' });
  eq(periodShortLabel('2026-08-07'), '7 Aug', 'an interval period is still labelled by its start DAY, unchanged');
}

console.log(`PASS — dateText and the trend-axis period label (${checks} checks).`);
