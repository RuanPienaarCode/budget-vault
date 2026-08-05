'use strict';
/* Period maths + the statement parsers. Both were completely untested, and
   both decide what numbers the user sees.

   period.js maps a transaction date to a financial period. The convention is a
   payday month: with month_start_day = 23, the period named "2026-08" runs
   23 Jul → 22 Aug. Get this wrong and every figure on the Dashboard and the
   Budget page is attributed to the wrong month — silently, because there is no
   error, just different totals.

   normalizeAmount / parseStatementDate turn a bank's CSV cell into a number
   and an ISO date. A wrong sign or a swapped DD/MM writes bad data to disk
   with no visible failure, which is why parseStatementDate deliberately never
   uses the Date constructor for non-ISO input (V8 and JavaScriptCore disagree).

   Runs in bare node. Wired into ./build.sh.
     node tests/period-and-parsers.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();

const { normalizeAmount, parseStatementDate, learnPattern, parseCsv,
  detectHeaderlessColumns, detectStatementColumns, reconcileAmounts } = require('../src/util');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ============================ period maths ============================== */
function periodCtx(monthStartDay, txFiles = {}) {
  const ctx = makeCtx({}, { settings: { month_start_day: monthStartDay } });
  ctx.S.txFiles = txFiles;
  require('../src/period')(ctx);
  return ctx;
}

/* ---- month_start_day = 23 (the default payday convention) ---- */
{
  const { periodRange, shiftPeriod, periodMonthName, txInPeriod } = periodCtx(23);

  eq(periodRange('2026-08'), { start: '2026-07-23', end: '2026-08-22' },
    'August runs 23 Jul → 22 Aug at start day 23');
  eq(periodRange('2026-01'), { start: '2025-12-23', end: '2026-01-22' },
    'January reaches back into the previous YEAR');
  eq(periodRange('2026-03'), { start: '2026-02-23', end: '2026-03-22' },
    'February is a short month but the start day still lands');
  eq(periodRange('2027-01'), { start: '2026-12-23', end: '2027-01-22' },
    'the year boundary rolls both ends');

  eq(shiftPeriod('2026-01', -1), '2025-12', 'shifting back past January rolls the year');
  eq(shiftPeriod('2026-12', 1), '2027-01', 'shifting past December rolls the year');
  eq(shiftPeriod('2026-06', 12), '2027-06', 'a twelve-month shift lands on the same month');
  eq(shiftPeriod('2026-06', -18), '2024-12', 'multi-year shifts roll correctly');

  eq(periodMonthName('2026-08'), 'August 2026', 'a period is named for the month it ENDS in');
}

/* ---- month_start_day = 1 (calendar months) ---- */
{
  const { periodRange } = periodCtx(1);
  eq(periodRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' },
    'a calendar February ends on the 28th');
  eq(periodRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' },
    'a LEAP February ends on the 29th');
  eq(periodRange('2026-01'), { start: '2026-01-01', end: '2026-01-31' },
    'a 31-day calendar month');
  eq(periodRange('2026-04'), { start: '2026-04-01', end: '2026-04-30' },
    'a 30-day calendar month');
}

/* ---- month_start_day = 28 (the clamped maximum) ---- */
{
  const { periodRange } = periodCtx(28);
  eq(periodRange('2026-03'), { start: '2026-02-28', end: '2026-03-27' },
    'start day 28 lands inside February in every year — this is why the loader clamps to 28');
}

/* ---- interval periods (fortnightly and friends) ---- */
function intervalCtx(period_days, period_anchor, txFiles = {}) {
  const ctx = makeCtx({}, { settings: { month_start_day: 23, period_days, period_anchor } });
  ctx.S.txFiles = txFiles;
  require('../src/period')(ctx);
  return ctx;
}
{
  const { periodRange, shiftPeriod, currentPeriod, periodMonthName, periodShortLabel } =
    intervalCtx(14, '2026-08-07');

  eq(periodRange('2026-08-07'), { start: '2026-08-07', end: '2026-08-20' },
    'a fortnight is 14 days INCLUSIVE — the 7th through the 20th, not the 21st');
  eq(shiftPeriod('2026-08-07', 1), '2026-08-21', 'the next fortnight opens the day after this one closes');
  eq(shiftPeriod('2026-08-07', -1), '2026-07-24', 'and shifting back crosses the month boundary cleanly');
  eq(shiftPeriod('2026-08-07', 26), '2027-08-06',
    '26 fortnights is 364 days, so a year later lands one day EARLIER — the cycle drifts against the calendar');

  // The bug this guards: a truncating divide rounds toward zero, so any date
  // before the anchor would land one period late.
  eq(periodRange(shiftPeriod('2026-08-07', -30)).start, '2025-06-13',
    'periods far BEFORE the anchor derive correctly (30 fortnights = 420 days back)');

  eq(periodMonthName('2026-08-07'), 'August 2026', 'a fortnight inside one month reports that month');
  eq(periodMonthName('2026-07-24'), 'Jul – Aug 2026', 'one spanning two months reports both');
  eq(periodMonthName('2025-12-25'), 'Dec 2025 – Jan 2026', 'and one spanning a year-end carries both years');
  eq(periodShortLabel('2026-08-07'), '7 Aug', 'the trend axis labels an interval period by its start day');

  // Anchors a whole number of intervals apart describe the SAME periods.
  const far = intervalCtx(14, '2027-03-05');   // 2026-08-07 + 15 fortnights
  eq(far.periodRange('2026-08-07'), { start: '2026-08-07', end: '2026-08-20' },
    'an anchor shifted by whole intervals is the same anchor');
  eq(far.currentPeriod(), currentPeriod(),
    'so it picks the same current period too — the anchor is meaningful only modulo the interval');

  // An anchor shifted by a NON-multiple genuinely moves every boundary.
  const off = intervalCtx(14, '2026-08-08');
  ok(off.currentPeriod() !== currentPeriod(),
    'a one-day anchor shift re-slices the periods — this is the destructive case the UI must warn about');

  // currentPeriod must land on a real period start, always.
  const cur = currentPeriod();
  ok(/^\d{4}-\d{2}-\d{2}$/.test(cur), 'the current interval period is named by date');
  eq(shiftPeriod(shiftPeriod(cur, -3), 3), cur, 'shifting away and back is lossless');

  // Other intervals ride the same maths.
  eq(intervalCtx(7, '2026-08-07').periodRange('2026-08-07'),
    { start: '2026-08-07', end: '2026-08-13' }, 'weekly is 7 days inclusive');
  eq(intervalCtx(28, '2026-08-07').periodRange('2026-08-07'),
    { start: '2026-08-07', end: '2026-09-03' }, 'four-weekly is 28 days inclusive');
}

/* ---- an interval cycle is inert without a usable anchor or a sane length ---- */
{
  // The loader drops both keys together, but the period module must not produce
  // garbage if a bad pair ever reaches it. Storing the cycle as a NUMBER means a
  // hand-edited Settings.md can express far more nonsense than a named type
  // could, so every rejected value must fall back to the payday month the user
  // already had — never to some number nobody chose.
  const monthly = p => {
    eq(p.periodRange('2026-08'), { start: '2026-07-23', end: '2026-08-22' },
      'monthly periods are untouched by the interval code path');
    ok(/^\d{4}-\d{2}$/.test(p.currentPeriod()), 'and still name themselves YYYY-MM');
  };
  monthly(intervalCtx(0, ''));                 // nothing set at all
  monthly(intervalCtx(14, ''));                // a cycle with no anchor to count from
  monthly(intervalCtx(0, '2026-08-07'));       // an anchor with no cycle
  monthly(intervalCtx(1, '2026-08-07'));       // below the floor — daily periods are absurd
  monthly(intervalCtx(6, '2026-08-07'));       // just below the floor
  monthly(intervalCtx(32, '2026-08-07'));      // just above the ceiling
  monthly(intervalCtx(400, '2026-08-07'));     // far above it
  monthly(intervalCtx(-14, '2026-08-07'));     // negative — would run periods backwards
  monthly(intervalCtx('banana', '2026-08-07'));// not a number at all

  // The band's edges themselves must WORK, or the clamp is off by one.
  eq(intervalCtx(7, '2026-08-07').periodRange('2026-08-07'),
    { start: '2026-08-07', end: '2026-08-13' }, 'the shortest allowed cycle is 7 days');
  eq(intervalCtx(31, '2026-08-07').periodRange('2026-08-07'),
    { start: '2026-08-07', end: '2026-09-06' }, 'the longest allowed cycle is 31 days');

  // An unusual but real cycle: paid every ten days. The whole reason the setting
  // is a number rather than a list of names we chose.
  eq(intervalCtx(10, '2026-08-07').periodRange('2026-08-17'),
    { start: '2026-08-17', end: '2026-08-26' }, 'a ten-day cycle just works');
}

/* ---- a remembered period name must match the shape settings can address ---- */
{
  // S.period survives a reload, but the period LENGTH can change underneath it.
  // Without this check a monthly user who switches to a 14-day cycle keeps
  // seeing 31-day windows and every nav click returns another month name, so
  // they can never reach a period of the length they just chose.
  const fortnight = intervalCtx(14, '2026-08-07');
  ok(!fortnight.periodKeyValid('2026-08'), 'a month name is unusable on a 14-day cycle');
  ok(fortnight.periodKeyValid('2026-08-07'), 'a date name is what that cycle addresses');

  const monthly = intervalCtx(0, '');
  ok(!monthly.periodKeyValid('2026-08-07'), 'a date name is unusable on a payday month');
  ok(monthly.periodKeyValid('2026-08'), 'a month name is what that addresses');

  // The shapes really are not interchangeable — this is the damage the guard
  // prevents, pinned so nobody "simplifies" the check away.
  eq(fortnight.periodRange('2026-08').end, '2026-08-22',
    'a month name on a 14-day cycle yields a 31-day window — never 14 days');
  ok(!/^\d{4}-\d{2}-\d{2}$/.test(fortnight.shiftPeriod('2026-08', 1)),
    'and navigating from it lands on another month name, stranding the user');

  ok(!monthly.periodKeyValid(''), 'an empty name is not addressable');
  ok(!monthly.periodKeyValid(undefined), 'nor is a missing one');
  ok(!monthly.periodKeyValid('2026-8'), 'nor a nearly-right one');

  /* A month name must name a real month. '2026-13' is month-SHAPED, and Date's
     rollover turned it into a perfectly navigable 31-day window whose title
     read "undefined 2026" — MONTH_FULL has no thirteenth entry. */
  ok(!monthly.periodKeyValid('2026-13'), 'there is no thirteenth month');
  ok(!monthly.periodKeyValid('2026-00'), 'nor a zeroth one');
  ok(monthly.periodKeyValid('2026-01') && monthly.periodKeyValid('2026-12'),
    'while January and December are exactly as addressable as before');
}

/* ---- isRealIsoDate: date-SHAPED is not the same as a date ---- */
{
  const { isRealIsoDate } = require('../src/util');
  for (const good of ['2026-08-07', '2024-02-29', '2026-01-01', '2026-12-31']) {
    ok(isRealIsoDate(good), `${good} is a real date`);
  }
  for (const bad of ['2026-13-45', '2026-02-30', '2026-00-10', '2026-01-32', '2025-02-29',
    '7 Aug 2026', '2026-8-7', '2026-08', '', null, undefined, 20260807]) {
    ok(!isRealIsoDate(bad), `${JSON.stringify(bad)} is not`);
  }
  // Date.UTC maps years 0–99 onto 1900–1999, so a two-digit year silently
  // becomes a different century. The round-trip catches that too.
  ok(!isRealIsoDate('0050-01-01'), 'a year Date would relocate to the 1900s is rejected');
}

/* ---- a remembered period must also be ON PHASE, not merely date-shaped ---- */
{
  /* The damage this prevents: on a 7-day cycle anchored 2026-08-07 the user is
     sitting on 2026-08-14, then switches to 14 days. Every YYYY-MM-DD passes a
     shape check, so the old name survived — but 08-14 is no longer a period
     START, and its window straddled the two real periods either side of it.
     Prev/next then walked that off-phase track forever (only "jump to current"
     escaped), and a budget saved there wrote a file no later period could
     address — and one the Budgets page did NOT list as stranded, because it
     passed this very check. */
  const fortnight = intervalCtx(14, '2026-08-07');
  ok(fortnight.periodKeyValid('2026-08-07'), 'the anchor itself is a period start');
  ok(fortnight.periodKeyValid('2026-08-21'), 'so is a whole cycle after it');
  ok(fortnight.periodKeyValid('2026-07-24'), 'and a whole cycle BEFORE it');
  ok(!fortnight.periodKeyValid('2026-08-14'),
    'a weekly start left over from a 7-day cycle is NOT addressable at 14 days');
  ok(!fortnight.periodKeyValid('2026-08-08'), 'nor is any other off-phase date');

  // Proof the off-phase name really did describe a window nothing else agrees
  // with — pinned so the check can't be softened back to a shape test.
  eq(fortnight.periodRange('2026-08-14'), { start: '2026-08-14', end: '2026-08-27' },
    'the off-phase window straddles the real periods 08-07…08-20 and 08-21…09-03');

  // 14 → 7 strands nothing: every fortnightly start is also a weekly one.
  const week = intervalCtx(7, '2026-08-07');
  ok(week.periodKeyValid('2026-08-14') && week.periodKeyValid('2026-08-21'),
    'shortening the cycle to a divisor keeps every old start addressable');

  // An off-cycle ANCHOR move re-slices every boundary, so yesterday's start is
  // off-phase too — the same failure by a different route.
  const moved = intervalCtx(14, '2026-08-10');
  ok(!moved.periodKeyValid('2026-08-07'),
    'after a 3-day anchor move the old period start is no longer a start');

  // A filename the regex admits but the calendar does not. Date.UTC would roll
  // 2026-13-45 forward to a date the name never said.
  ok(!fortnight.periodKeyValid('2026-13-45'), 'a date-shaped non-date is not addressable');

  // currentPeriod is the recovery path the loader falls back to, so it must
  // itself always pass — for every cycle length, not just the tested one.
  for (const days of [7, 10, 14, 28, 31]) {
    const c = intervalCtx(days, '2026-08-07');
    ok(c.periodKeyValid(c.currentPeriod()), `currentPeriod is on phase at ${days} days`);
  }
}

/* ---- an unusable anchor can never produce a period named NaN ---- */
{
  // intervalDays() used to test the anchor for TRUTHINESS only, so a state not
  // built by the loader came back with periods literally called 'NaN-NaN-NaN'.
  for (const bad of ['not-a-date', '7 Aug 2026', '2026-8-7', '2026-13-45', '2026-02-30', 42, {}]) {
    const p = intervalCtx(14, bad);
    eq(p.intervalDays(), 0, `an anchor of ${JSON.stringify(bad)} leaves the cycle inert`);
    ok(/^\d{4}-\d{2}$/.test(p.currentPeriod()),
      `and falls back to a payday month, never a NaN name (${JSON.stringify(bad)})`);
  }
  // The regex admits 2026-13-45; only the round-trip catches it.
  eq(intervalCtx(14, '2026-13-45').periodRange('2026-08'),
    { start: '2026-07-23', end: '2026-08-22' }, 'a rolled-over anchor date is rejected, not silently rolled');
}

/* ---- a monthly salary reads the same in every week of the month ---- */
{
  /* The Debt page quotes instalments monthly and judges them against the 36%
     lenders use, so it needs a MONTHLY income figure whatever the period
     length is. Scaling one period up by the number of periods in a month is
     right only when income lands every period: on a weekly cycle a monthly
     salary arrives in one week out of four, so three weeks showed no ratio at
     all and the fourth multiplied a single paycheque by 4.35. */
  const SALARY = 30000;
  const rows = {};                                     // 'YYYY-MM' -> rows
  const push = (date, desc, cat, amount) => {
    const m = date.slice(0, 7);
    (rows[m] = rows[m] || []).push({ date, desc, cat, amount, excluded: false, note: '' });
  };
  for (const m of ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04']) {
    push(`${m}-25`, 'Salary', 'Salary', SALARY);
    // Spend in every week, so no period reads as "no data" and gets trimmed.
    for (const d of ['02', '09', '16', '23', '30']) {
      if (m === '2026-02' && d === '30') continue;
      push(`${m}-${d}`, 'Groceries', '', -500);
    }
  }
  const txFiles = {};
  for (const m of Object.keys(rows)) txFiles[`FNB/${m}`] = { label: 'FNB', month: m, dirty: false, rows: rows[m] };

  const weekly = intervalCtx(7, '2026-01-02', txFiles);
  weekly.S.categories = [{ name: 'Salary', type: 'income', color: '#888' }];

  // Eight consecutive weeks spanning two paydays — the worst case for a figure
  // derived from one period at a time.
  const weeks = [];
  for (let i = 0; i < 8; i++) weeks.push(weekly.shiftPeriod('2026-04-03', -i));
  const got = weeks.map(p => weekly.monthlyIncome(p).income);

  for (const [i, v] of got.entries()) {
    ok(Math.abs(v - SALARY) / SALARY < 0.1,
      `week ${i} back from 2026-04-03 reports ${Math.round(v)} — within 10% of the real ${SALARY}/month`);
  }
  ok(Math.max(...got) / Math.min(...got) < 1.1,
    'and the figure barely moves week to week — no payday-week spike, no empty-week collapse');

  // What it replaced, pinned so the regression is recognisable: the raw period
  // income is either nothing or a full paycheque, and neither is a month.
  const raw = weeks.map(p => weekly.periodSummary(p).income);
  ok(raw.includes(0) && raw.includes(SALARY),
    'the single-period figure this replaced swung between 0 and a whole salary');

  eq(weekly.monthlyIncome('2026-04-03').periods, 13,
    'a weekly cycle averages over 13 periods — 91 days is 2.99 months, so it catches three paydays every time');

  // A vault whose data starts three weeks ago must not be divided by three
  // months of silence it was never around for.
  const young = intervalCtx(7, '2026-01-02', {
    'FNB/2026-01': { label: 'FNB', month: '2026-01', dirty: false, rows: [
      { date: '2026-01-09', desc: 'Salary', cat: 'Salary', amount: 10000, excluded: false, note: '' },
    ] },
  });
  young.S.categories = [{ name: 'Salary', type: 'income', color: '#888' }];
  eq(young.monthlyIncome('2026-01-09').periods, 1,
    'periods with no data at all are trimmed off the back of the window');
  ok(Math.abs(young.monthlyIncome('2026-01-09').income - 10000 * (365.25 / 12) / 7) < 1,
    'so the only week on record is scaled up, exactly as before — not averaged into nothing');

  // The payday month is untouched: the period already IS a month.
  const month = periodCtx(23, txFiles);
  month.S.categories = [{ name: 'Salary', type: 'income', color: '#888' }];
  eq(month.monthlyIncome('2026-02'), { income: month.periodSummary('2026-02').income, periods: 1 },
    'a payday month reports its own income untouched');
}

/* ---- fortnightly transactions land in exactly one period ---- */
{
  const rows = [
    { date: '2026-08-06', desc: 'day before the fortnight', cat: '', amount: -10, excluded: false, note: '' },
    { date: '2026-08-07', desc: 'the boundary itself', cat: '', amount: -20, excluded: false, note: '' },
    { date: '2026-08-20', desc: 'last day of the fortnight', cat: '', amount: -30, excluded: false, note: '' },
    { date: '2026-08-21', desc: 'first day of the next', cat: '', amount: -40, excluded: false, note: '' },
  ];
  // All four rows sit in ONE calendar-month file while spanning THREE periods —
  // transaction storage stays monthly no matter what the period type is.
  const txFiles = { 'FNB/2026-08': { label: 'FNB', month: '2026-08', dirty: false, rows } };
  const { txInPeriod } = intervalCtx(14, '2026-08-07', txFiles);

  eq(txInPeriod('2026-08-07').map(t => t.desc), ['the boundary itself', 'last day of the fortnight'],
    'the start day belongs to the fortnight it opens; the day before does not');
  eq(txInPeriod('2026-07-24').map(t => t.desc), ['day before the fortnight'],
    'the previous fortnight claims the day before');
  eq(txInPeriod('2026-08-21').map(t => t.desc), ['first day of the next'],
    'and the following fortnight claims the next boundary');

  const all = ['2026-07-24', '2026-08-07', '2026-08-21'].flatMap(p => txInPeriod(p).map(t => t.desc));
  eq(all.length, new Set(all).size, 'no transaction may appear in two fortnights');
  eq(all.length, rows.length, 'and none may fall through the gap between them');
}

/* ---- boundary dates land in exactly one period ---- */
{
  const rows = [
    { date: '2026-07-22', desc: 'day before the boundary', cat: '', amount: -10, excluded: false, note: '' },
    { date: '2026-07-23', desc: 'the boundary itself', cat: '', amount: -20, excluded: false, note: '' },
    { date: '2026-08-22', desc: 'last day of the period', cat: '', amount: -30, excluded: false, note: '' },
    { date: '2026-08-23', desc: 'first day of the next', cat: '', amount: -40, excluded: false, note: '' },
  ];
  const txFiles = {
    'FNB/2026-07': { label: 'FNB', month: '2026-07', dirty: false, rows: rows.slice(0, 2) },
    'FNB/2026-08': { label: 'FNB', month: '2026-08', dirty: false, rows: rows.slice(2) },
  };
  const { txInPeriod } = periodCtx(23, txFiles);

  const aug = txInPeriod('2026-08').map(t => t.desc);
  eq(aug, ['the boundary itself', 'last day of the period'],
    'the start day belongs to the period it opens; the day before does not');
  const jul = txInPeriod('2026-07').map(t => t.desc);
  eq(jul, ['day before the boundary'], 'the previous period claims the day before');
  const sep = txInPeriod('2026-09').map(t => t.desc);
  eq(sep, ['first day of the next'], 'and the following period claims the next boundary');

  // Every row must be claimed by exactly one period — no gaps, no double count.
  const all = ['2026-07', '2026-08', '2026-09'].flatMap(p => txInPeriod(p).map(t => t.desc));
  eq(all.length, new Set(all).size, 'no transaction may appear in two periods');
  eq(all.length, rows.length, 'and none may fall through the gap between periods');
}

/* ---- summary: transfers excluded, income vs spend, excluded rows dropped ---- */
{
  const rows = [
    { date: '2026-08-01', desc: 'Salary', cat: 'Income', amount: 42000, excluded: false, note: '' },
    { date: '2026-08-02', desc: 'Groceries', cat: 'Food', amount: -1000, excluded: false, note: '' },
    { date: '2026-08-03', desc: 'To savings', cat: 'Move', amount: -5000, excluded: false, note: '' },
    { date: '2026-08-04', desc: 'Refund', cat: '', amount: -50, excluded: true, note: '' },
    { date: '2026-08-05', desc: 'Cash', cat: '', amount: -75, excluded: false, note: '' },
  ];
  const ctx = periodCtx(23, { 'FNB/2026-08': { label: 'FNB', month: '2026-08', dirty: false, rows } });
  ctx.S.categories = [
    { name: 'Income', type: 'income', color: '#000' },
    { name: 'Food', type: 'expense', color: '#000' },
    { name: 'Move', type: 'transfer', color: '#000' },
  ];
  const sum = ctx.periodSummary('2026-08');
  eq(sum.income, 42000, 'income comes from income-typed categories');
  eq(sum.spend, 1075, 'spend excludes transfers and excluded rows');
  eq(sum.uncategorised, 1, 'excluded rows are not counted as uncategorised');
  eq(sum.byCat.Move, undefined, 'a transfer contributes to no category total');
  eq(sum.count, 4, 'count covers every non-excluded row in the period');
}

/* ========================= normalizeAmount ============================== */
for (const [cell, want, why] of [
  ['1234.56', 1234.56, 'plain decimal'],
  ['1,234.56', 1234.56, 'thousands comma'],
  ['1 234,56', 1234.56, 'decimal comma with a space separator'],
  ['1.234,56', 1234.56, 'European format'],
  ['R 1 234.56', 1234.56, 'rand symbol and spaces'],
  ['$1,234.56', 1234.56, 'dollar symbol'],
  ['(123.45)', -123.45, 'parenthesised negative'],
  ['123.45-', -123.45, 'trailing minus'],
  ['-123.45', -123.45, 'leading minus'],
  ['+123.45', 123.45, 'explicit plus'],
  ['123.45 Cr', 123.45, 'Cr marker is a credit'],
  ['123.45 Dr', -123.45, 'Dr marker is a debit'],
  ['0', 0, 'zero is a valid amount, not a failure'],
  ['0.00', 0, 'zero with decimals'],
  ['', null, 'blank is null'],
  ['   ', null, 'whitespace is null'],
  ['abc', null, 'junk is null'],
  ['R', null, 'a bare currency symbol is null'],
]) {
  eq(normalizeAmount(cell), want, `normalizeAmount(${JSON.stringify(cell)}) — ${why}`);
}
ok(normalizeAmount('1 234,56') !== 1, 'a decimal-comma cell must never collapse to its leading digit');

/* ======================== parseStatementDate ============================ */
for (const [cell, dayFirst, want, why] of [
  ['2026-07-23', true, '2026-07-23', 'ISO passes through'],
  ['2026/07/23', true, '2026-07-23', 'ISO with slashes'],
  ['23/07/2026', true, '2026-07-23', 'DD/MM under a day-first profile'],
  ['07/23/2026', false, '2026-07-23', 'MM/DD under a month-first profile'],
  ['23/07/2026', false, '2026-07-23', 'day > 12 is unambiguous and corrected either way'],
  ['07/23/2026', true, '2026-07-23', 'and corrected in the other direction too'],
  ['20260723', true, '2026-07-23', 'YYYYMMDD (Absa / Standard Bank)'],
  ['23 Jul 2026', true, '2026-07-23', 'DD Mon YYYY'],
  ['23-July-2026', true, '2026-07-23', 'full month name with dashes'],
  ['23Jul2026', true, '2026-07-23', 'DDMonYYYY run together (Nedbank cheque export)'],
  // Capitec stamps a clock time on its Transaction Date column. Parsing it must
  // not depend on the Date constructor, whose behaviour differs on iOS.
  ['2026-07-23 20:50', true, '2026-07-23', 'ISO with a trailing time'],
  ['2026-07-23T09:15:00', true, '2026-07-23', 'ISO with a T separator'],
  ['2026-07-23T09:15:00Z', true, '2026-07-23', 'ISO with a zone marker'],
  ['23/07/2026 00:20', true, '2026-07-23', 'DD/MM with a trailing time'],
  // The one that motivated the change: a month-end row timestamped just past
  // midnight must not be read as the following day.
  ['2026-02-28 23:59', true, '2026-02-28', 'a late month-end stamp stays in its own month'],
  ['01/02/2026', true, '2026-02-01', 'an ambiguous date follows the profile — day first'],
  ['01/02/2026', false, '2026-01-02', '…and month first for the other profile'],
  ['', true, null, 'blank is null'],
  ['not a date', true, null, 'junk is null'],
  ['2026-13-01', true, null, 'month 13 is rejected, not wrapped'],
  ['2026-00-10', true, null, 'month 0 is rejected'],
  ['2026-07-32', true, null, 'day 32 is rejected'],
]) {
  eq(parseStatementDate(cell, dayFirst), want,
    `parseStatementDate(${JSON.stringify(cell)}, dayFirst=${dayFirst}) — ${why}`);
}

/* ========================= reconcileAmounts ============================= */
/* The guard that makes an untested bank safe to import. A statement's own
   balance column is ground truth: only one sign convention and one row order
   can reproduce it, so the file proves what it is instead of the importer
   assuming. Everything here is synthetic. */
{
  // Oldest-first, money out already negative — the convention this app uses.
  const fwd = [
    { amount: 5500.00, balance: 2917.04 },
    { amount: -100.00, balance: 2817.04 },
    { amount: 9000.00, balance: 11817.04 },
    { amount: -1000.00, balance: 10817.04 },
    { amount: -5.04, balance: 10812.00 },
  ];
  const r = reconcileAmounts(fwd);
  ok(r.verified, 'a statement that reconciles as-is is verified');
  eq(r.flip, false, '…and needs no sign correction');
  eq(r.order, 'fwd', '…and is recognised as oldest-first');

  // THE BUG THIS EXISTS TO CATCH: same ledger, but the bank prints money out as
  // POSITIVE. Taken at face value every expense imports as income. The balance
  // column is what exposes it.
  const flipped = fwd.map(p => ({ amount: -p.amount, balance: p.balance }));
  const rf = reconcileAmounts(flipped);
  ok(rf.verified, 'a debits-positive statement still reconciles');
  eq(rf.flip, true, '…and is flagged for sign correction rather than imported as income');

  // Newest-first is just as common; the balance walk runs the other way.
  const rev = reconcileAmounts(fwd.slice().reverse());
  ok(rev.verified, 'a newest-first statement reconciles too');
  eq(rev.order, 'rev', '…and is recognised as newest-first');
  eq(rev.flip, false, '…without being mistaken for a sign problem');
}
{
  // Amounts that have nothing to do with the balances must NOT be declared
  // verified — an unproven file is imported unchanged and flagged, never
  // "corrected" on a guess.
  const r = reconcileAmounts([
    { amount: 10, balance: 500 }, { amount: 20, balance: 250 },
    { amount: 30, balance: 900 }, { amount: 40, balance: 125 },
    { amount: 50, balance: 700 },
  ]);
  ok(!r.verified, 'balances that do not line up are reported, not rubber-stamped');
}
{
  const r = reconcileAmounts([{ amount: 10, balance: 10 }, { amount: 10, balance: 20 }]);
  ok(!r.verified, 'too few rows to be conclusive is not a verdict');
  eq(reconcileAmounts([]).verified, false, 'no rows at all is not a verdict');
  eq(reconcileAmounts(null).verified, false, 'a missing ledger is handled, not thrown on');
}
{
  // A real statement can carry the odd reversal without losing the verdict, but
  // half-right must never pass.
  const mostly = [
    { amount: 100, balance: 1100 }, { amount: 100, balance: 1200 },
    { amount: 100, balance: 1300 }, { amount: 100, balance: 1400 },
    { amount: 100, balance: 1500 }, { amount: 100, balance: 9999 },
  ];
  ok(reconcileAmounts(mostly).verified, 'one bad row in six does not sink a good statement');
  const half = [
    { amount: 100, balance: 1100 }, { amount: 100, balance: 1200 },
    { amount: 100, balance: 5000 }, { amount: 100, balance: 5100 },
    { amount: 100, balance: 9000 }, { amount: 100, balance: 9100 },
  ];
  ok(!reconcileAmounts(half).verified, 'a half-matching ledger is not proof');
}

/* ====================== detectHeaderlessColumns ========================= */
/* Nedbank's cheque export carries no header row at all — a short preamble, then
   date,description,amount,balance. The layout has to be read off the shape of
   the rows. Synthetic figures; the balances are internally consistent because
   the running-balance test is what decides which of the two numeric columns is
   the amount. */
const NEDBANK_CHEQUE = [
  'Statement Enquiry:',
  'Account Number :,1000000000',
  'Account Description :,Cheque',
  'Statement Number:,629',
  '23Jul2026,SOME PAYMENT - 1000000000,5500.00,2917.04',
  '23Jul2026,Savings - 2000000000,-100.00,2817.04',
  '26Jul2026,RENT RECEIVED,9000.00,11817.04',
  '27Jul2026,ATM CASH 5000000000000000,-1000.00,10817.04',
  '28Jul2026,Monthly fee,-5.04,10812.00',
].join('\n');
{
  const shape = detectHeaderlessColumns(parseCsv(NEDBANK_CHEQUE), true);
  ok(shape, 'a headerless Nedbank cheque export resolves to a layout');
  eq(shape.dataStart, 4, 'the four preamble lines are skipped');
  eq(shape.iDate, 0, 'date is the first column');
  eq(shape.iDesc, 1, 'description is the text column before the amount');
  // The bug this pins: reading the running balance as the amount would import
  // 2917.04 instead of 5500.00 and put a fictional 10 812 income row in July.
  eq(shape.iAmount, 2, 'the amount wins over the trailing running-balance column');
}
/* Two trailing numeric columns are either amount+balance or a Debit/Credit
   pair, and only the running-balance test can tell them apart. Under four data
   rows reconcileAmounts refuses to answer (three pairs of agreement is as
   likely to be coincidence as proof) — and "unprovable" must NOT collapse into
   "definitely a Debit/Credit pair", which is what reading the last column as
   the amount would mean. On this shape that silently imports the running
   BALANCE as every transaction: 4750.00 instead of -250.00, an expense booked
   as income. Null sends it to the manual column mapper, which is the whole
   point of having one. */
const SHORT_HEADERLESS = [
  'Account 1234',
  'Statement',
  '01Jul2026,ACME GROCER,-250.00,4750.00',
  '02Jul2026,SAMPLE FUEL CO,-600.50,4149.50',
  '03Jul2026,SALARY CREDIT,5000.00,9149.50',
].join('\n');
{
  const rows = parseCsv(SHORT_HEADERLESS);
  eq(detectHeaderlessColumns(rows, true), null,
    'three data rows cannot prove which trailing column is the amount — ask, never guess');
  eq(detectStatementColumns(rows, true), null,
    'and the decision function passes that through, so the import view opens the mapper');
}
/* The same shape one row longer DOES prove itself, so the guard above must not
   have cost the ordinary case — this is the negative control for it. */
{
  const shape = detectHeaderlessColumns(parseCsv(
    SHORT_HEADERLESS + '\n04Jul2026,GENERIC CAFE,-120.25,9029.25\n'), true);
  ok(shape, 'four data rows resolve');
  eq(shape.iAmount, 2, 'the amount column wins once the balances can prove it');
  eq(shape.iBalance, 3, 'and the trailing column is recorded as the balance');
}
/* Nedbank's credit card is the same headerless preamble, but a different shape:
   TWO leading date columns (posted, transacted) and a single amount at the
   right, with no balance. Signs come from the file — fees negative, payments
   and interest positive. */
const NEDBANK_CREDIT = [
  'Statement Enquiry :',
  'Account Number :, 5000000000000000',
  'Account Description :, CREDIT',
  '24-01-2026, 24-01-2026,CREDIT FACILITY SERVICE FEE,-20.00',
  '24-01-2026, 24-01-2026,VAT ON FEE,-3.00',
  '10-02-2026, 11-02-2026,DEBICHECK PAYMENT - THANK YOU,500.00',
  '16-02-2026, 16-02-2026,CREDIT INTEREST,2.31',
].join('\n');
{
  const rows = parseCsv(NEDBANK_CREDIT);
  const shape = detectHeaderlessColumns(rows, true);
  ok(shape, 'a headerless Nedbank credit-card export resolves to a layout');
  eq(shape.dataStart, 3, 'the three preamble lines are skipped');
  // The hazard: scanning for the description column from the LEFT would stop on
  // the second date column and import "24-01-2026" as every description.
  eq(shape.iDesc, 2, 'description is found past the second date column');
  eq(shape.iAmount, 3, 'a single trailing numeric column is the amount');
  // Posting date wins over transaction date here for the same reason it does on
  // a Capitec header — the two disagree on the 10th/11th row.
  eq(shape.iDate, 0, 'the posting date leads');
  const r = rows[shape.dataStart + 2];
  eq(parseStatementDate(r[shape.iDate], true), '2026-02-10', 'the posted date is the one imported');
  eq(normalizeAmount(r[shape.iAmount]), 500, 'a payment keeps its positive sign');
  eq(normalizeAmount(rows[shape.dataStart][shape.iAmount]), -20, 'a fee keeps its negative sign');
}
{
  // A Debit/Credit pair also trails two numeric columns, but its last column is
  // NOT a running balance — the balance test must decline and take the last.
  const shape = detectHeaderlessColumns(parseCsv([
    '23Jul2026,SOME MERCHANT,0.00,120.00',
    '24Jul2026,ANOTHER MERCHANT,0.00,45.50',
    '25Jul2026,A THIRD MERCHANT,0.00,17.25',
  ].join('\n')), true);
  ok(shape, 'a two-numeric-column file without a balance still resolves');
  eq(shape.iAmount, 3, 'without balance continuity the last column is the amount');
}
for (const [csv, why] of [
  ['just,some,text\nwith,no,dates', 'no date column'],
  ['Statement Enquiry:\nAccount Number :,1000000000', 'preamble only, no data rows'],
  ['23Jul2026,ONLY ONE ROW,100.00,100.00', 'a single row is not enough to infer a layout'],
  ['23Jul2026,100.00\n24Jul2026,200.00', 'no description column'],
]) {
  eq(detectHeaderlessColumns(parseCsv(csv), true), null,
    `detectHeaderlessColumns returns null rather than guessing — ${why}`);
}

/* ====================== detectStatementColumns ========================== */
/* The single decision every import hangs on. Two things are pinned here: the
   header shapes real statements arrive in, and — just as important — that an
   unrecognisable file returns NULL. Null is what opens the manual column
   mapper, so a wrong guess here is the difference between "point at your
   columns" and a silently mis-read ledger. */
{
  // Capitec: separate Money In / Money Out, a Balance, and BOTH date columns.
  const m = detectStatementColumns(parseCsv([
    'Nr,Account,Posting Date,Transaction Date,Description,Money In,Money Out,Balance',
    '1,1000000000,2026-07-31,2026-08-01 00:20,Interest Received,0.07,,38.39',
  ].join('\n')), true);
  ok(m, 'a Money In / Money Out statement resolves');
  eq(m.iDate, 2, 'posting date beats transaction date when a file carries both');
  eq(m.iDesc, 4, 'description found by name');
  eq(m.iCredit, 5, 'Money In maps to credit');
  eq(m.iDebit, 6, 'Money Out maps to debit');
  eq(m.iBalance, 7, 'the balance column is picked up for the reconciliation check');
  eq(m.dataStart, 1, 'data starts after the header row');
}
{
  // A single signed Amount column with no balance — the shape most exports use.
  const m = detectStatementColumns(parseCsv([
    '"Value Date","Type","Description","Amount"',
    '2026-01-12,"Card","MARKET HALL",-120.00',
  ].join('\n')), true);
  eq(m.iDate, 0, 'value date leads'); eq(m.iDesc, 2, 'description by name');
  eq(m.iAmount, 3, 'a single signed amount column');
  eq(m.iBalance, -1, 'no balance column is reported honestly, not invented');
}
{
  // Header names this app has never seen against a real file, but which cost
  // nothing to accept: guessing a NAME wrong only ever rejects a file, loudly.
  const m = detectStatementColumns(parseCsv([
    'Effective Date,Particulars,Debit,Credit,Running Balance',
    '23/07/2026,SOME MERCHANT,120.00,,880.00',
  ].join('\n')), true);
  ok(m, 'unfamiliar-but-plausible header names still resolve');
  eq(m.iDesc, 1, '"Particulars" is read as the description');
  eq(m.iBalance, 4, '"Running Balance" is recognised');
}
{
  // Header row not on line 1 — banks put an account preamble above it.
  const m = detectStatementColumns(parseCsv([
    'MY BANK LIMITED',
    'Account: 1000000000',
    '',
    'Date,Description,Amount',
    '23/07/2026,SOME MERCHANT,-120.00',
  ].join('\n')), true);
  // parseCsv drops the blank line, so the header is the third PARSED row.
  eq(m.headerIdx, 2, 'a header below a preamble is found');
  eq(m.dataStart, 3, '…and the preamble is not read as data');
}
for (const [csv, why] of [
  ['Date,Description\n2026-07-23,SOME MERCHANT', 'a header with no amount column at all'],
  ['just,some,text\nwith,nothing,useful', 'a file that is neither headed nor shaped like a statement'],
  ['', 'an empty file'],
]) {
  eq(detectStatementColumns(parseCsv(csv), true), null,
    `detectStatementColumns returns null so the manual mapper opens — ${why}`);
}
// The headerless path is reachable through the same front door.
ok(detectStatementColumns(parseCsv(NEDBANK_CHEQUE), true).headerIdx === -1,
  'a headerless statement resolves through the shape path, not the header path');

/* ============================ learnPattern ============================== */
for (const [desc, want, why] of [
  ['MEGAMART CENTRAL 000000******0000', 'MEGAMART CENTRAL', 'masked card number trimmed'],
  ['GROCER ONE CENTRAL X0000000', 'GROCER ONE CENTRAL', 'digit-heavy reference trimmed'],
  ['TELCO CO VODREF0000000', 'TELCO CO', 'long caps+digit reference trimmed'],
  ['CORNER MART', 'CORNER MART', 'a clean description is left alone'],
  ['VALUE MART 123456789', 'VALUE MART', 'long digit run trimmed'],
  // The <4-character guard: trimming 'ABC 123456789' would leave 'ABC', which is
  // too short to match anything usefully, so the untrimmed original wins.
  ['ABC 123456789', 'ABC 123456789', 'a stem under 4 chars falls back to the full description'],
]) {
  eq(learnPattern(desc), want, `learnPattern — ${why}`);
}
ok(learnPattern('AB 12345678').length >= 4,
  'trimming must never leave a pattern too short to be meaningful');

console.log(`PASS — period maths + statement parsers intact (${checks} assertions).`);
