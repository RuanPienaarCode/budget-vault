'use strict';
/* Trend and comparison arithmetic — the period maths behind the Dashboard's
   trend chart and its category-comparison column.

   Pure, registered like period.js (reads S and the period helpers off ctx), so
   it is testable in bare node without mounting the dashboard. The DOM, the
   range pills, the i18n labels and the colour floor stay in the view.

   `today` is injectable throughout, per the repo rule: a test that reads the
   wall clock asserts something different every morning.

   ADR-0007 · trend-math.js — purpose. Narrative in the ADR-0007 register. */

const { todayIso, isoDayNumber, isoFromDayNumber } = require('./dates');

module.exports = function registerTrendMath(ctx) {
  const { S, shiftPeriod, periodRange, currentPeriod, txInPeriod, nonBudgetLabels, foreignLabels, catType, ledger, tally, LENSES } = ctx;

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
      /* ADR-0007 · An empty vault has no trend history. M2, 2026-08-29 audit — a
         null `earliest` breaks exactly where a real earliest month would. */
      if (i > 0 && (!earliest || periodRange(p).end.slice(0, 7) < earliest)) break;
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

  /* ADR-0007 · Elapsed days of the period on screen. Null when finished; a
     part-period cannot be read against whole ones (the 39%-down-on-food card). */
  function elapsedDays(today) {
    if (S.period !== currentPeriod()) return null;
    const { start, end } = periodRange(S.period);
    const t = today || todayIso();
    if (t >= end) return null;
    return Math.max(1, isoDayNumber(t) - isoDayNumber(start) + 1);
  }

  /* ADR-0007 · periodSpend mirrors the budget vetoes, currency included. ISSUE 28,
     third pass (102 954%); whole and capped to `days`. ADR-0007 · count ignores the
     cap but honours the vetoes. foreignLabels() is read off ctx, not restated. */
  /* Phase 2 of ADR-0006: tally(ledger(p), LENSES.TREND) — BUDGET's vetoes
     under the net sign rule, minus the earmarkedOut veto ISSUE 41 never
     taught this walk (see the TREND lens's own note in src/ledger.js; the
     omission is preserved and named, not fixed, in this phase). `part` is
     the same tally over the rows dated on or before the cap. */
  function periodSpend(p, days) {
    const { start, end } = periodRange(p);
    let cut = null;
    if (days !== null) {
      const c = isoFromDayNumber(isoDayNumber(start) + days - 1);
      if (c < end) cut = c;
    }
    const stamped = ledger(start, end);
    const whole = tally(stamped, LENSES.TREND);
    const part = cut ? tally(stamped.filter(s => s.date <= cut), LENSES.TREND) : whole;
    return { count: whole.count, whole: whole.spendByCat, part: part.spendByCat };
  }
  /* ADR-0007 · Comparison baseline carries two totals. `totals` like-for-like over
     the elapsed window, `full` only to tell "new" from "not billed yet"; null
     when no completed period has data. */
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
