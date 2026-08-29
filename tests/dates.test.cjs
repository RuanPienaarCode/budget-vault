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
const { nowLocalMinute, todayIso } = require('../src/dates');

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

console.log(`dates.test.cjs — ${checks} checks OK`);
