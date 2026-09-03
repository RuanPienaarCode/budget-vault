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
      /* M2, 2026-08-29 audit — `earliest` is null on a vault that has
         imported nothing at all (earliestDataMonth's own doc: an imported-
         but-empty file is not history either), and the old `earliest &&`
         guard only ever fired when it was truthy — so on a genuinely empty
         vault the break never ran and all `want` periods got pushed, twelve
         months of invented zero-spend history on the very first report a
         brand-new household ever generated, directly contradicting this
         function's own comment two paragraphs up. No data at all means
         there is no floor to test a period against, which is the SAME
         answer as "before the earliest month there is" — so `!earliest`
         breaks here exactly where a real earliest date immediately would,
         leaving only the current period (i===0, always pushed first). */
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
     per-account one, THE PER-CURRENCY ONE, transfers dropped, income dropped,
     and NET per category so a refund nets off rather than counting as spend.
     A baseline built by different rules than the figure it is subtracted from
     is not a comparison.

     ISSUE 28, third pass. The currency filter was the sentence above being
     false. summaryInRange() (src/period.js) held foreign rows out of income
     and spend in the first pass and healthSnapshot() (src/health-data.js) was
     taught the same predicate in the second, while this function — which the
     Dashboard's trend chart, its comparison column and the SCORE's budget
     pillar all read — went on adding every remaining row into one per-category
     rand map. Three consequences, each measured on a two-currency vault:

       · the trend chart drew a rupiah holiday month as a rand spike
       · the comparison column announced the same rupiah as "up R 3 000 000
         on Groceries" against a rand baseline
       · health-data's `consumptionBudget` (the numerator of the score's
         `budgetUsed`) divided rupiah spending by a rand budget and read
         102 954% where the household's own answer was 97%. Only the numerator
         could ever go wrong there: a plan is written in the household's
         currency by construction, so there was nothing on the other side of
         the division to balance it.

     `foreignLabels()` is READ OFF ctx rather than restated here, deliberately.
     It is the SAME Map of transaction-folder label to symbol that
     summaryInRange filters by, so the hero, this comparison column and the
     score cannot come to different conclusions about which rows are household
     money — which is precisely this repository's recurring bug shape ("two
     figures derived by different rules"), and the one it keeps landing on
     when a second copy of a predicate is written rather than the first one
     shared. Resolved per call, for the reason nonBudgetLabels() states at its
     own definition: an account can be re-stamped with a currency between two
     of the six periods the trend draws.

     What is held out is NOT dropped silently — currency.js:14 forbids that.
     The exclusion is disclosed where these figures are printed: the Dashboard
     hero's own `dash.foreignExcluded` line names the same accounts, because
     the predicate is the same one.

     `count` deliberately ignores the cap. It answers "does the vault cover this
     period at all", and a month whose data starts on the 20th still happened —
     counting only the capped rows would drop it from the average entirely. It
     narrows with the rest, though: a period covered only by a rupiah account
     is not a rand period this vault can average, and counting it as one is
     what let compareTotals build a baseline out of months it holds no
     household spending for. */
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
