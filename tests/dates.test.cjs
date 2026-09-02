'use strict';
/* Calendar dates — src/dates.js, pinned.

   M3 (2026-08-29 audit) is the reason this file exists: the Report page's
   "Generated" timestamp used `new Date().toISOString().slice(0, 16).replace('T',
   ' ')` — UTC — while todayIso() a few lines above it in the SAME function,
   and every other "now" this app stamps, reads local calendar parts. Generated
   at 06:18 SAST, the old line printed "04:18"; for a reader east of Greenwich
   it is the wrong CALENDAR DAY, not just the wrong hour, in both the
   frontmatter and the line a reader actually sees. nowLocalMinute() is the one
   place that rule now lives for a timestamp, the same way isoOf()/todayIso()
   are the one place it lives for a bare date — see this module's own header.

   The wall clock is pinned (Date-subclass pattern, same as
   trend-math.test.cjs's elapsedDays block) so this asserts a real value, not
   "did not throw".

   Pure node — no DOM, no obsidian.
     node tests/dates.test.cjs */

const assert = require('assert');
const { nowLocalMinute, todayIso, isoOf, isoDayNumber, isoFromDayNumber, daysBetween, ISO_DATE } = require('../src/dates');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(2026, 7, 29, 6, 18, 42); }
  static now() { return new PinnedDate().getTime(); }
}

global.Date = PinnedDate;
try {
  /* THE REGRESSION, reproduced exactly: 06:18 local, which the old
     `toISOString().slice(0, 16)` line would have printed as "04:18" (SAST is
     UTC+2) — a different hour AND, for a reader further east, a different
     calendar day too. */
  eq(nowLocalMinute(), '2026-08-29 06:18', 'local calendar date and time, minute precision, zero-padded');

  /* nowLocalMinute()'s DATE half must be the exact same string todayIso()
     already gives for the same instant — one local-time rule, not a second
     one that happens to agree today and could silently drift from it later
     (the exact shape CLAUDE.md calls out as this codebase's most-repeated
     bug: two figures/derivations of "now" that could, in principle, disagree). */
  eq(nowLocalMinute().slice(0, 10), todayIso(), 'the date half of the timestamp is exactly todayIso() — one local-time rule, not two');

  /* Midnight — the boundary a UTC/local mismatch actually bites on. 00:05
     SAST (2026-08-29) is still 2026-08-28 in UTC; the old UTC-based line
     would have named the wrong day outright, not merely the wrong hour. */
  class Midnight extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2026, 7, 29, 0, 5, 0); }
    static now() { return new Midnight().getTime(); }
  }
  global.Date = Midnight;
  eq(nowLocalMinute(), '2026-08-29 00:05', 'just after local midnight still names the LOCAL day, not the UTC one a few hours behind it');

  /* Single-digit hour/minute are zero-padded — "9:5" would not parse back
     as a fixed-width timestamp the way every other stamp in this app does. */
  class SingleDigit extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2026, 2, 3, 9, 5, 0); }
    static now() { return new SingleDigit().getTime(); }
  }
  global.Date = SingleDigit;
  eq(nowLocalMinute(), '2026-03-03 09:05', 'single-digit hour and minute are zero-padded');
} finally {
  global.Date = RealDate;
}


/* ══════════════ isoOf / isoDayNumber / isoFromDayNumber, pinned ═══════════

   These three are the arithmetic every period boundary in the app is built
   out of, and until now nothing asserted them directly — they were exercised
   only through periodRange, which reads their output back through the same
   assumptions that produced it. So a shape bug in them could only surface as
   a period that looked odd on screen.

   One did. isoOf never padded the YEAR, and period.js's MONTH_KEY deliberately
   admits years 0100–9999 with a comment insisting that "a month key it would
   refuse as a date must not be reachable as a month". With month_start_day 23,
   periodRange('0100-01') returned {start: '99-12-23', end: '100-01-22'} —
   strings that are not ISO-shaped, that isRealIsoDate would refuse, and that
   every date comparison in this app (all of them string comparisons on
   YYYY-MM-DD) would sort in front of every real transaction. The two halves of
   that promise now agree.

   Years outside 0000–9999 are unreachable: MONTH_KEY floors at 0100, ISO_DATE
   requires exactly four digits, and the widest a period can reach past a month
   key is 31 days. */
{
  const yearOf = (y, m, d) => { const x = new Date(2026, m - 1, d, 12); x.setFullYear(y); return x; };

  eq(isoOf(yearOf(99, 12, 23)), '0099-12-23', 'a two-digit year is padded to four — the string must stay ISO-shaped');
  eq(isoOf(yearOf(100, 1, 22)), '0100-01-22', 'and a three-digit one too');
  eq(isoOf(new Date(2026, 0, 5, 12)), '2026-01-05', 'an ordinary date is unchanged — month and day were already padded');
  eq(isoOf(new Date(2026, 11, 31, 12)), '2026-12-31', 'and so is the last day of a year');
  ok(ISO_DATE.test(isoOf(yearOf(99, 12, 23))), 'the padded string satisfies this module\'s own shape regex');

  /* Reached by ARITHMETIC, not by parsing "0099-12-23" — Date.UTC maps years
     0–99 onto 1900–1999, so isoDayNumber would quietly hand back 1999 and this
     would prove nothing. That relocation is the one period.js's MONTH_KEY
     comment names, and it is why the floor there is 0100 rather than 0000: the
     only way into year 99 is by counting BACKWARDS off a legal month key,
     which is precisely what periodRange('0100-01') does with month_start_day
     23. So this is the real path, walked the way the app walks it. */
  eq(isoFromDayNumber(isoDayNumber('0100-01-01') - 9), '0099-12-23',
    'the inverse pads too, or a period START could be ISO-shaped while its END was not');
  ok(ISO_DATE.test(isoFromDayNumber(-700000)), 'any day number the app can reach round-trips to an ISO-shaped string');

  /* Round-trip: a day number is the app's only representation of "a date plus
     n days", so every date it holds must survive the trip out and back. */
  for (const iso of ['1970-01-01', '2026-01-01', '2026-02-29'.replace('2026', '2024'),
                     '2026-08-22', '2026-12-31', '2100-03-01', '0100-01-01']) {
    eq(isoFromDayNumber(isoDayNumber(iso)), iso, `${iso} survives isoDayNumber → isoFromDayNumber unchanged`);
  }

  /* The UTC rule this module's header states, measured across the two dates a
     local-time count would get wrong. Northern-hemisphere DST moves on the
     last Sunday of March and October; a local-time subtraction loses an hour
     across one and gains one across the other, which rounds a 31-day span to
     30 or 32 — a period silently gaining or losing a day twice a year, with no
     error to point at. Counted in UTC, both are exactly 31. */
  eq(daysBetween('2026-03-01', '2026-04-01'), 31, 'a span across the spring DST change is 31 days, not 30');
  eq(daysBetween('2026-10-01', '2026-11-01'), 31, 'and across the autumn one it is 31, not 32');
  eq(daysBetween('2026-03-28', '2026-03-30'), 2, 'the two days either side of the change itself');

  eq(daysBetween('2026-03-05', '2026-03-01'), -4, 'a backwards span is negative, not its absolute value');
  eq(daysBetween('2026-03-01', '2026-03-01'), 0, 'and a zero span is zero, not one');
  eq(daysBetween('2026-02-28', '2026-03-01'), 1, 'a common year steps straight from 28 Feb to 1 Mar');
  eq(daysBetween('2024-02-28', '2024-03-01'), 2, 'a leap year has the extra day in between');
  eq(daysBetween('not a date', '2026-03-01'), null, 'a non-ISO argument is null, for the caller to decide about');
}

console.log(`dates.test.cjs — ${checks} checks OK`);
