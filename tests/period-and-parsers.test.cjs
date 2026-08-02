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
