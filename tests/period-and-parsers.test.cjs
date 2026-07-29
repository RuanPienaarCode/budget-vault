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

const { normalizeAmount, parseStatementDate, learnPattern } = require('../src/util');

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

/* ============================ learnPattern ============================== */
for (const [desc, want, why] of [
  ['WOOLWORTHS GARDENS 400738******3558', 'WOOLWORTHS GARDENS', 'masked card number trimmed'],
  ['CHECKERS SANDTON I8816879', 'CHECKERS SANDTON', 'digit-heavy reference trimmed'],
  ['VODACOM VODSS3MMGJMQ', 'VODACOM', 'long caps+digit reference trimmed'],
  ['PICK N PAY', 'PICK N PAY', 'a clean description is left alone'],
  ['SHOPRITE 123456789', 'SHOPRITE', 'long digit run trimmed'],
  // The <4-character guard: trimming 'ABC 123456789' would leave 'ABC', which is
  // too short to match anything usefully, so the untrimmed original wins.
  ['ABC 123456789', 'ABC 123456789', 'a stem under 4 chars falls back to the full description'],
]) {
  eq(learnPattern(desc), want, `learnPattern — ${why}`);
}
ok(learnPattern('AB 12345678').length >= 4,
  'trimming must never leave a pattern too short to be meaningful');

console.log(`PASS — period maths + statement parsers intact (${checks} assertions).`);
