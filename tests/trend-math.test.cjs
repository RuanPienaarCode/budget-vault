'use strict';
/* trend-math — the Dashboard's trend and comparison arithmetic, in bare node.

   These functions lived inside views/dashboard.js, where the only way to test
   them was to mount the whole view with a fake DOM — so their edge rules
   (the honest-history floor, the part-period cap, the uncovered-period skip)
   were pinned only through rendered pixels, or not at all. Extracted, they
   are driven here the way period.js's own maths is: real registerPeriod,
   in-memory state, injected dates.

     node tests/trend-math.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* Real period.js + trend-math.js over hand-set state — the same wiring order
   controller.js uses. month_start_day 1 so a period IS its calendar month and
   the fixture dates read without arithmetic. */
function trendCtx({ settings = {}, txFiles = {}, categories = [], accounts = [], period = '2026-07' } = {}) {
  const ctx = makeCtx({}, { settings: { month_start_day: 1, ...settings } });
  ctx.S.txFiles = txFiles;
  ctx.S.categories = categories;
  ctx.S.accounts = accounts;
  ctx.S.period = period;
  require('../src/period')(ctx);
  require('../src/trend-math')(ctx);
  return ctx;
}

const file = (label, month, rows) => ({ label, month, rows });
const row = (date, cat, amount, extra = {}) => ({ date, desc: 'x', cat, amount, ...extra });

/* ---- periodsForMonths: a range names a span of time, not a column count ---- */
{
  const monthly = trendCtx();
  eq(monthly.periodsForMonths(6), 6, 'on a monthly cycle, 6M is 6 points');
  const weekly = trendCtx({ settings: { period_days: 7 } });
  eq(weekly.periodsForMonths(6), 26, 'on a weekly cycle, 6M is ~26 points');
  eq(weekly.periodsForMonths(0), 2, 'never fewer than 2 points — one point is not a trend');
}

/* ---- earliestDataMonth: empty files are not history ---- */
{
  const ctx = trendCtx({ txFiles: {
    a: file('Cheque', '2026-03', []),                                  // imported but empty
    b: file('Cheque', '2026-05', [row('2026-05-02', 'Groceries', -100)]),
    c: file('Cheque', '2026-07', [row('2026-07-02', 'Groceries', -100)]),
  } });
  eq(ctx.earliestDataMonth(), '2026-05',
    'a month file with no rows does not extend history backwards');
  eq(trendCtx().earliestDataMonth(), null, 'no data, no earliest');
}

/* ---- trendPeriods: reaches back only as far as the data honestly goes ---- */
{
  const ctx = trendCtx({ txFiles: {
    b: file('Cheque', '2026-05', [row('2026-05-02', 'Groceries', -100)]),
  } });
  eq(ctx.trendPeriods(6), ['2026-05', '2026-06', '2026-07'],
    'periods before the first import are not drawn as zero-spend months');
  const bare = trendCtx();
  eq(bare.trendPeriods(4), ['2026-04', '2026-05', '2026-06', '2026-07'],
    'with no data at all there is no floor — the caller asked for 4 and gets 4');
  eq(ctx.trendPeriods(1), ['2026-07'],
    'the current period is always included, even empty — a chart that drops "now" reads as broken');
}

/* ---- historySpan: months of history the vault actually holds ---- */
{
  const ctx = trendCtx({ txFiles: {
    b: file('Cheque', '2026-03', [row('2026-03-02', 'Groceries', -100)]),
  } });
  eq(ctx.historySpan(), 5, 'March through July, counting the month on screen');
  eq(trendCtx().historySpan(), 0, 'no data, no span');
}

/* ---- elapsedDays: a part-period cannot be read against whole ones ----
   The clock is pinned for this block (dashboard-cards' Date subclass
   pattern): elapsedDays takes `today` injected for the day arithmetic, but
   its is-this-the-current-period gate goes through period.js's
   currentPeriod(), which reads the real clock. */
{
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2026, 6, 15, 12, 0, 0); }
    static now() { return new PinnedDate().getTime(); }
  }
  global.Date = PinnedDate;
  try {
    const ctx = trendCtx({ period: '2026-07' });
    eq(ctx.elapsedDays('2026-07-09'), 9, 'nine days of July have happened');
    eq(ctx.elapsedDays('2026-07-31'), null,
      'the last day counts as complete — the capped window IS the whole period');
    const past = trendCtx({ period: '2026-06' });
    eq(past.elapsedDays('2026-07-09'), null,
      'a finished period on screen is whole; the question does not arise');
  } finally { global.Date = RealDate; }
}

/* ---- periodSpend: the filter mirrors periodSummary, the cap is honest ---- */
{
  const categories = [
    { name: 'Groceries', type: 'expense' },
    { name: 'Salary', type: 'income' },
    { name: 'Move', type: 'transfer' },
  ];
  const accounts = [
    { name: 'Cheque', in_budget: true },
    { name: 'Fund', tx_label: 'Fund', in_budget: false },
  ];
  const ctx = trendCtx({ categories, accounts, txFiles: {
    a: file('Cheque', '2026-07', [
      row('2026-07-02', 'Groceries', -300),
      row('2026-07-20', 'Groceries', -200),          // after the 10-day cut
      row('2026-07-03', 'Groceries', 50),            // refund: nets off
      row('2026-07-04', 'Salary', 20000),            // income: never spend
      row('2026-07-05', 'Move', -900),               // transfer: never spend
      row('2026-07-06', 'Groceries', -999, { excluded: true }),  // per-row veto
    ]),
    b: file('Fund', '2026-07', [row('2026-07-07', 'Groceries', -400)]), // non-budget account
  } });
  const whole = ctx.periodSpend('2026-07', null);
  eq(whole.whole, { Groceries: 450 }, 'net spend: 300 + 200 − 50, veto/transfer/income/non-budget all out');
  const cut = ctx.periodSpend('2026-07', 10);
  eq(cut.part, { Groceries: 250 }, 'the capped window stops at day 10: 300 − 50');
  eq(cut.whole, { Groceries: 450 }, 'while the whole-period figure is unchanged');
  eq(cut.count, whole.count, 'count ignores the cap — it answers "is this period covered at all"');
}

/* ---- compareTotals: an uncovered period is not a zero-spend period ---- */
{
  const categories = [{ name: 'Groceries', type: 'expense' }];
  const ctx = trendCtx({ categories, txFiles: {
    a: file('Cheque', '2026-06', [row('2026-06-02', 'Groceries', -600)]),
    b: file('Cheque', '2026-05', [row('2026-05-02', 'Groceries', -500)]),
    // 2026-04 deliberately absent: averaging it in would halve every figure.
  } });
  const base = ctx.compareTotals(3, null);
  eq(base.counted, 2, 'only the periods the vault covers are counted');
  eq(base.totals, { Groceries: 1100 }, 'and the totals are their sum, not a three-way average');
  eq(trendCtx().compareTotals(3, null), null,
    'a first-month vault has no baseline — null, not a column of zeroes');
}

console.log(`PASS — trend maths: honest history floor, part-period cap, uncovered periods skipped (${checks} assertions).`);
