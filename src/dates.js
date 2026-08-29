'use strict';
/* Calendar dates, as this app means them.

   Every date the plugin stores is a LOCAL calendar date in YYYY-MM-DD — the day
   printed on a bank statement, not an instant. That distinction is the whole
   reason this module exists: `new Date().toISOString().slice(0, 10)` is UTC, so
   at 01:00 in Johannesburg it returns yesterday, and these values get compared
   against transaction dates to decide which rows land inside a period or after
   a balance was last confirmed. An hour's drift there silently misfiles a day.

   Pure — no DOM, no obsidian import — so the pure maths modules (reconcile,
   recurring, debt-math, savings-math, worth) can require it without pulling
   dom.js's obsidian dependency into their bare-node tests.

   Split out of the old util.js, where the shape regex had been written twice and the
   local-Date formatter existed as an inline expression in eight files. Two of
   those had quietly grown a UTC variant instead, which is the drift above. */

/* Date-SHAPED. Says nothing about whether the date EXISTS — 2026-13-45 passes.
   Use isRealIsoDate when the value has to name a day that happened. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* A Date → the local calendar date it falls on. */
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Today as a local calendar date. */
function todayIso() {
  return isoOf(new Date());
}

/* Today, to the minute, in the SAME local calendar this module's own header
   insists on for a date — extended to a time-of-day for the Report page's
   "Generated" stamp (M3, 2026-08-29 audit). Before this, that one caller
   built its own `new Date().toISOString().slice(0, 16).replace('T', ' ')` —
   UTC, the exact drift this file's header names for a bare date, just never
   fixed for a timestamp because nothing needed one until the report did. A
   report generated at 06:18 SAST printed "04:18"; for a reader east of
   Greenwich it is not just the wrong hour, it is the wrong CALENDAR DAY, in
   both the frontmatter and the line the reader actually sees. One copy of
   the local-time rule, not a second one inlined at the call site — the same
   reason isoOf/todayIso exist instead of eight files each writing their own
   `${d.getFullYear()}-…`. */
function nowLocalMinute() {
  const d = new Date();
  return `${isoOf(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* Whole days since the epoch, in UTC. Local-time date maths drifts by a day
   across a DST boundary, which would silently lengthen or shorten a period
   twice a year. Shared so the settings tab measures an anchor shift with the
   same arithmetic period.js derives the periods themselves with — if the two
   ever disagreed, the tab would warn about a move that changed nothing, or
   stay silent through one that moved every boundary.

   Note the deliberate asymmetry with isoOf above: a date is FORMATTED in local
   time because that is the calendar the user reads, but two dates are COUNTED
   between in UTC because that is the only way the count is stable. */
function isoDayNumber(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/* Whole days from a to b, counted the same way isoDayNumber counts — UTC, so
   a local-time DST shift cannot round a day away. Both must be date-SHAPED
   ISO strings (isRealIsoDate is the caller's job, not this one's); returns
   null when either isn't, so a caller in a loop doesn't have to test twice.

   What null BECOMES — 0, a thrown state, a fall back to the wall clock — is
   not this function's decision. committed.js, savings-math.js and
   reconcile.js each had their own copy of this arithmetic with a different
   answer to that question baked in (0, null, and "assume now" respectively);
   this is the one copy of the counting, with the policy left at each call
   site where it was already deliberate. */
function daysBetween(aIso, bIso) {
  if (!ISO_DATE.test(aIso || '') || !ISO_DATE.test(bIso || '')) return null;
  return isoDayNumber(bIso) - isoDayNumber(aIso);
}

/* Whole days from `today` until an ISO deadline — negative once it has
   passed, counted the same UTC way daysBetween does so a DST boundary between
   now and the deadline cannot round a day away. `today` is required rather
   than defaulted to `new Date()`: this is a pure module, and its one caller
   (views/tax.js's countdown tiles) already has a real "today" to hand in on
   every call, so a clock-reading default would only have been an untested
   branch. Thin wrapper kept here, not inlined at the call site, because the
   UTC-day arithmetic is exactly daysBetween's and a second copy is how the
   two would drift. */
function daysUntil(iso, today) {
  return daysBetween(today, iso);
}

/* The inverse: a UTC day number back to YYYY-MM-DD. UTC getters, to undo
   exactly what isoDayNumber did — reading a day number with local getters
   would shift the result by a day for anyone west of Greenwich. */
function isoFromDayNumber(n) {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/* A real calendar date in YYYY-MM-DD, not merely something date-SHAPED. The
   shape regex admits 2026-13-45 and 2026-02-30, which Date.UTC rolls forward
   without complaint — so a pay cycle anchored on one ran from a day its own
   Settings.md never named. Shared because the loader, the period maths and
   both settings tabs must agree on which anchors are usable: if the loader
   accepted one that period.js then refused, the tab would sit there offering a
   cycle the app is not running. */
function isRealIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(t)) return false;
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() + 1 === m && back.getUTCDate() === d;
}

/* A period length in days, or 0 for the payday month. Lives here rather than in
   period.js because the LOADER has to agree with it: if the loader stored what
   the file said and period.js decided separately what was usable, a settings
   control reading the raw value would report a cycle the app isn't running.
   Out-of-band values become 0, never the nearest legal number — falling back to
   the payday month the user already had is honest, whereas coercing 400 to 31
   would silently invent a cycle nobody chose. The band is wide enough for every
   real payroll rhythm and narrow enough to exclude a one-day period. */
const MIN_PERIOD_DAYS = 7, MAX_PERIOD_DAYS = 31;
function periodDaysOrZero(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < MIN_PERIOD_DAYS || n > MAX_PERIOD_DAYS) return 0;
  return n;
}
module.exports = { ISO_DATE, isoOf, todayIso, nowLocalMinute, isoDayNumber, isoFromDayNumber, isRealIsoDate, periodDaysOrZero, daysBetween, daysUntil };

