'use strict';
/* Trend and comparison arithmetic — the period maths behind the Dashboard's
   trend chart and its category-comparison column.

   Extracted from views/dashboard.js, where ~100 lines of pure period
   arithmetic sat inside a DOM module against the house rule that if it can
   be pure, it is. Registered like period.js — these functions read S and the
   period helpers off ctx — so they are testable in bare node through the
   same harness, without mounting the dashboard. The DOM, the range pills,
   the i18n labels and the colour floor all stay in the view; what lives here
   is every function whose output is a number, a list of periods, or a map of
   category totals.

   `today` is injectable throughout, per the repo rule: a test that reads the
   wall clock asserts something different every morning. */

const { todayIso, isoDayNumber, isoFromDayNumber } = require('./dates');

module.exports = function registerTrendMath(ctx) {
  const { S, shiftPeriod, periodRange, currentPeriod, txInPeriod, nonBudgetLabels, catType } = ctx;

  /* How many periods a calendar-month range covers. A period is a pay cycle,
     which may be a week or a fortnight, so "6M" is 6 points on a monthly cycle
     and ~26 on a weekly one — the range names a span of time, not a count of
     columns. */
  function periodsForMonths(months) {
    const days = Number(S.settings.period_days) || 0;
    if (!days) return months;
    return Math.max(2, Math.round((months * 30.44) / days));
  }

  /* The earliest month any transaction actually lands in. The trend can only
     honestly reach back this far: periods before it are not "months you spent
     nothing", they are months that were never imported, and drawing them as
     zeroes invents a history of frugality that did not happen. */
  function earliestDataMonth() {
    let min = null;
    for (const f of Object.values(S.txFiles)) {
      if (!f.rows || !f.rows.length) continue;
      if (min === null || f.month < min) min = f.month;
    }
    return min;
  }

  /* Periods to plot, oldest first — `want` of them at most, fewer if the data
     runs out. The current period is always included even when it is empty,
     because a chart that silently drops "now" reads as broken. */
  function trendPeriods(want) {
    const earliest = earliestDataMonth();
    const out = [];
    for (let i = 0; i < want; i++) {
      const p = shiftPeriod(S.period, -i);
      if (earliest && i > 0 && periodRange(p).end.slice(0, 7) < earliest) break;
      out.push(p);
    }
    return out.reverse();
  }

  /* Calendar months of history the vault actually holds, counting the month on
     screen. This is what decides whether a long range is worth offering at all:
     the pills describe the data, not a fixed menu the data has to live up to. */
  function historySpan() {
    const earliest = earliestDataMonth();
    if (!earliest) return 0;
    const now = periodRange(S.period).end.slice(0, 7);
    if (now < earliest) return 0;
    const [ey, em] = earliest.split('-').map(Number);
    const [ny, nm] = now.split('-').map(Number);
    return (ny - ey) * 12 + (nm - em) + 1;
  }

  /* How much of the period ON SCREEN has actually happened yet, or null when it
     is finished and the question does not arise.

     This is the number the comparison column was missing. Nine days of August
     were being measured against three whole Julys: every category that bills
     late in the month showed a large green fall, every category that bills on
     the 1st showed a rise, and both figures were reporting nothing but today's
     date. The card said spending was down 39% on food in a month that had
     barely started. Same trap monthlyIncome() already sidesteps in period.js —
     a part-period cannot be read against whole ones.

     The last day of a running period counts as complete: by then the capped
     window IS the whole period, so there is nothing left to explain. */
  function elapsedDays(today) {
    if (S.period !== currentPeriod()) return null;
    const { start, end } = periodRange(S.period);
    const t = today || todayIso();
    if (t >= end) return null;
    return Math.max(1, isoDayNumber(t) - isoDayNumber(start) + 1);
  }

  /* Spend per category for one period, twice over: the whole period, and only
     its first `days` (which is the same thing when days is null, or when the
     window runs past the period's own end — a 31-day month compared against a
     30-day one caps at 30).

     Filtering mirrors periodSummary() exactly — the per-row veto, the
     per-account one, transfers dropped, income dropped, and NET per category so
     a refund nets off rather than counting as spend. A baseline built by
     different rules than the figure it is subtracted from is not a comparison.

     `count` deliberately ignores the cap. It answers "does the vault cover this
     period at all", and a month whose data starts on the 20th still happened —
     counting only the capped rows would drop it from the average entirely. */
  function periodSpend(p, days) {
    const skip = nonBudgetLabels();
    let cut = null;
    if (days !== null) {
      const { start, end } = periodRange(p);
      const c = isoFromDayNumber(isoDayNumber(start) + days - 1);
      if (c < end) cut = c;
    }
    const net = {}, netPart = {};
    let count = 0;
    for (const t of txInPeriod(p)) {
      if (t.excluded || skip.has(t.label)) continue;
      count++;
      if (catType(t.cat) === 'transfer') continue;
      const k = t.cat || '';
      net[k] = (net[k] || 0) + t.amount;
      if (!cut || t.date <= cut) netPart[k] = (netPart[k] || 0) + t.amount;
    }
    const spendOf = m => {
      const out = {};
      for (const [cat, amt] of Object.entries(m)) {
        const type = catType(cat);
        if (!cat || type === 'income' || type === 'transfer' || amt >= 0) continue;
        out[cat] = -amt;
      }
      return out;
    };
    return { count, whole: spendOf(net), part: spendOf(netPart) };
  }

  /* Spend per category, summed over the N periods BEFORE the one on screen —
     the numeric core of the comparison baseline. Returns null when there is
     not a single completed period to compare with: a first-month vault gets
     the donut it has always had rather than a column of "new" against nothing.

     TWO totals, because they answer different questions. `totals` is the
     like-for-like baseline the change column subtracts from, measured over the
     same elapsed window as the period on screen. `full` is the whole of each
     period, and its only job is deciding whether a category is genuinely NEW or
     has merely not billed yet this month — without it, every category that
     charges after the 9th would be announced as new for the first week of
     every period. The view adds the colour floor and the column label — those
     are presentation, not arithmetic. */
  function compareTotals(periods, days) {
    const totals = {}, full = {};
    let counted = 0;
    for (let i = 1; i <= periods; i++) {
      const p = shiftPeriod(S.period, -i);
      const sum = periodSpend(p, days);
      /* A period with no transactions at all is not a zero-spend period, it is
         a period the vault does not cover — averaging it in would halve every
         figure for every month before the data starts. */
      if (!sum.count) continue;
      counted++;
      for (const [cat, amt] of Object.entries(sum.whole)) full[cat] = (full[cat] || 0) + amt;
      for (const [cat, amt] of Object.entries(sum.part)) totals[cat] = (totals[cat] || 0) + amt;
    }
    if (!counted) return null;
    return { totals, full, counted };
  }

  ctx.provide({
    periodsForMonths, earliestDataMonth, trendPeriods, historySpan, elapsedDays, periodSpend, compareTotals,
  });
};
