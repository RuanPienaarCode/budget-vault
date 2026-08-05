'use strict';
/* Financial-period math + per-period summaries.

   A period has a NAME its files are addressed by and BOUNDARIES deciding which
   transactions fall inside it, and the two are deliberately separate — see
   CONTEXT.md and docs/adr/0001. Two shapes of name exist:

     'YYYY-MM'     a payday month, running from month_start_day of the previous
                   month to the day before it in the named month. The name is
                   stable no matter what month_start_day is, so retuning the
                   boundary day re-slices the window without orphaning a file.

     'YYYY-MM-DD'  an interval period (every two weeks, and friends), named for
                   the day it starts on. Derived from period_anchor — one known
                   payday — plus period_days. Nothing is materialised.

   The anchor is meaningful only MODULO the interval: two anchors a whole number
   of intervals apart describe the same set of periods, so all maths below runs
   off the anchor's phase rather than its literal value. Only a shift that isn't
   a whole number of intervals actually moves a boundary. */

const { MONTHS } = require('./constants');
const { safeSeg, periodDaysOrZero, isoDayNumber: dayNum } = require('./util');

/* The pay cycle is stored as its own length in days rather than a named type.
   A word would have to pick a dialect — "fortnightly" is idiomatic in za/uk/au
   and foreign in us/ca, "biweekly" is idiomatic there and genuinely ambiguous
   (every two weeks, or twice a week?) — and locale.js has no vocabulary layer
   to swap it per country. A number reads the same everywhere, needs no new word
   when a cycle is added, and lets someone paid every ten days simply work.

   Absent or zero means the payday month, so a vault that has never heard of
   this setting behaves exactly as it always did. The band the value must fall
   in is enforced by periodDaysOrZero in util.js, which the loader applies on
   the way in so the stored setting and the running one can never disagree. */

const MONTH_KEY = /^\d{4}-\d{2}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/* Whole-day arithmetic in UTC. Local-time date maths would drift by a day
   across a DST boundary — a period would silently gain or lose a day twice a
   year, which is exactly the kind of failure that shows up as "my totals moved"
   with no error to point at. */
const DAY = 86400000;
function isoFromDayNum(n) {
  const d = new Date(n * DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

module.exports = function registerPeriod(ctx) {
  const { S } = ctx;

  /* The anchor as a day number, or null if it isn't a real calendar date.
     Presence alone was not enough: the loader's shape check admits 2026-13-45,
     which Date.UTC rolls forward to a date the file never named, and a state
     built without the loader at all can hold anything — which surfaced as a
     period literally called 'NaN-NaN-NaN'. Round-tripping the day number back
     to ISO is the cheapest check that catches both, because only a real date
     survives it unchanged. */
  function anchorDay() {
    const a = S.settings.period_anchor;
    if (typeof a !== 'string' || !DATE_KEY.test(a)) return null;
    const n = dayNum(a);
    return Number.isFinite(n) && isoFromDayNum(n) === a ? n : null;
  }
  /* 0 for a payday month, otherwise the cycle length in days. The loader has
     already banded the stored value, so this re-check only matters for a state
     built without it — but a cycle with no usable anchor has nothing to count
     from, and that pairing must resolve to the payday month wherever it
     arises. */
  function intervalDays() {
    return anchorDay() === null ? 0 : periodDaysOrZero(S.settings.period_days);
  }
  /* The first period start on or before `day`, given the anchor's phase. A real
     floor, not a truncation — dates BEFORE the anchor must round down too, or
     every period earlier than the anchor lands one period late. */
  function periodStartOnOrBefore(day, iv) {
    const a = anchorDay();
    return a + Math.floor((day - a) / iv) * iv;
  }

  /* Can the current settings address a period of this name? S.period is
     remembered across a reload, but the period LENGTH can change underneath it,
     and the two shapes are not interchangeable. Left unchecked, a month name
     under a 14-day cycle falls through every reader's interval branch and comes
     back as a 31-day window that navigates to another month name — so a user who
     switches to a fortnightly cycle keeps seeing month-long periods, with no way
     to reach their own. The reverse leaks a date-named budget file into a vault
     that is back on payday months. Checked on load, where the switch lands. */
  function periodKeyValid(p) {
    if (typeof p !== 'string') return false;
    const iv = intervalDays();
    if (!iv) return MONTH_KEY.test(p);
    /* Shape alone is not enough for an interval period. Every YYYY-MM-DD passes
       the regex, but only the dates a whole number of cycles from the anchor
       are period STARTS — and both a length change and an off-cycle anchor move
       redraw that set. Switching 7 → 14 leaves half the old starts sitting
       BETWEEN the new boundaries, and each one still looked addressable here:
       the remembered period kept its old phase, so its window straddled two
       real periods, prev/next walked that off-phase track forever (only "jump
       to current" escaped it), and any budget saved meanwhile wrote a file no
       later period could ever address. Round-tripping p as well rejects a
       filename like 2026-13-45, which the regex accepts and Date.UTC would
       silently roll into a date the name doesn't say. */
    if (!DATE_KEY.test(p)) return false;
    const d = dayNum(p);
    if (!Number.isFinite(d) || isoFromDayNum(d) !== p) return false;
    return (d - anchorDay()) % iv === 0;
  }

  function periodRange(p) {
    const iv = intervalDays();
    if (iv && DATE_KEY.test(p)) {
      return { start: p, end: isoFromDayNum(dayNum(p) + iv - 1) };
    }
    const [y, m] = p.split('-').map(Number);
    const n = S.settings.month_start_day;
    if (n === 1) {
      return { start: `${p}-01`, end: `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
    }
    const sd = new Date(y, m - 2, n);
    const ed = new Date(y, m - 1, n - 1);
    const f = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: f(sd), end: f(ed) };
  }
  function currentPeriod() {
    const now = new Date();
    const iv = intervalDays();
    if (iv) {
      const today = dayNum(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
      return isoFromDayNum(periodStartOnOrBefore(today, iv));
    }
    let y = now.getFullYear(), m = now.getMonth() + 1;
    if (S.settings.month_start_day > 1 && now.getDate() >= S.settings.month_start_day) {
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  function shiftPeriod(p, delta) {
    const iv = intervalDays();
    if (iv && DATE_KEY.test(p)) return isoFromDayNum(dayNum(p) + delta * iv);
    let [y, m] = p.split('-').map(Number);
    m += delta;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  /* "August 2026" — the period's display month (the month it ENDS in, i.e. the
     YYYY-MM the period is named after). Shown next to the date range so the
     payday convention ("August" = Jul 23 → Aug 22) is always explicit. */
  const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  function periodMonthName(p) {
    const iv = intervalDays();
    if (iv && DATE_KEY.test(p)) {
      /* An interval period has no month it is "named after", so it reports the
         month(s) it spans instead — no new vocabulary for the user to learn,
         and periodTitle right beside it still carries the exact dates. */
      const { start, end } = periodRange(p);
      const [sy, sm] = start.split('-').map(Number);
      const [ey, em] = end.split('-').map(Number);
      if (sy === ey && sm === em) return `${MONTH_FULL[sm - 1]} ${sy}`;
      if (sy === ey) return `${MONTHS[sm - 1]} – ${MONTHS[em - 1]} ${ey}`;
      return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
    }
    const [y, m] = p.split('-').map(Number);
    return `${MONTH_FULL[m - 1]} ${y}`;
  }
  /* Axis-sized label for the dashboard trend, which used to slice the key
     apart itself and would read a 'YYYY-MM-DD' key as a nonsense month. */
  function periodShortLabel(p) {
    if (intervalDays() && DATE_KEY.test(p)) {
      const [, m, d] = p.split('-').map(Number);
      return `${d} ${MONTHS[m - 1]}`;
    }
    return `${MONTHS[parseInt(p.slice(5), 10) - 1]} ${p.slice(2, 4)}`;
  }
  function periodTitle(p) {
    const { start, end } = periodRange(p);
    const f = d => `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${parseInt(d.slice(8), 10)}`;
    const sy = start.slice(0, 4), ey = end.slice(0, 4);
    if (sy === ey) return `${f(start)} – ${f(end)}, ${ey}`;
    return `${f(start)}, ${sy} – ${f(end)}, ${ey}`;
  }
  function txInPeriod(p) {
    const { start, end } = periodRange(p);
    const out = [];
    for (const f of Object.values(S.txFiles)) {
      if (f.month < start.slice(0, 7) || f.month > end.slice(0, 7)) continue;
      for (const r of f.rows) if (r.date >= start && r.date <= end) out.push({ ...r, label: f.label, _file: f, _row: r });
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.desc.localeCompare(b.desc));
    return out;
  }

  /* ---------------------------- calculations ---------------------------- */
  /* The account file behind a transaction-folder label. The two are usually the
     same string, but need not be: `tx_label` points an account at a folder of
     another name, and safeSeg() strips filesystem-illegal characters on the way
     to disk. Same three-way match as txSegment() in load.js, run the other way
     round. Returns null for a folder with no account file — an orphan whose
     rows stay in the budget, since nothing says otherwise. */
  function accountForLabel(label) {
    const want = safeSeg(label);
    return S.accounts.find(a =>
      a.tx_label === label || a.name === label || safeSeg(a.name) === want) || null;
  }
  /* Labels belonging to `budget: false` accounts. Resolved per call rather than
     cached because periodSummary runs six times over for the dashboard trend
     and an account can be toggled between any two of them. */
  function nonBudgetLabels() {
    const out = new Set();
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (a && !a.in_budget) out.add(f.label);
    }
    return out;
  }
  function catType(name) { return S.categories.find(c => c.name === name)?.type || null; }
  function periodSummary(p) {
    // Excluded rows are the user's per-row veto; the non-budget set is the
    // per-account one. Both drop out of income/spend here and nowhere else —
    // Transactions still lists every row, so nothing goes invisible.
    const skip = nonBudgetLabels();
    const tx = txInPeriod(p).filter(t => !t.excluded && !skip.has(t.label));
    let income = 0, spend = 0, uncategorised = 0;
    const byCat = {};
    for (const t of tx) {
      const type = catType(t.cat);
      if (!t.cat) uncategorised++;
      if (type === 'transfer') continue;
      byCat[t.cat || ''] = (byCat[t.cat || ''] || 0) + t.amount;
      if (type === 'income') income += t.amount;
      else if (t.amount < 0) spend += -t.amount;
    }
    return { income, spend, uncategorised, byCat, count: tx.length };
  }
  /* A monthly income figure, for the one page that has to talk in months no
     matter what the period length is (Debt — an instalment is quoted monthly,
     and the 36% threshold only means anything against a month).

     Scaling a SINGLE period up by the number of periods in a month is right
     only when income lands every period, which is the fortnightly case it was
     written for. On a weekly cycle a monthly salary arrives in one period out
     of four: the three empty ones showed no ratio at all, and the fourth
     multiplied one paycheque by 4.35. So the window is widened to at least
     three months and the whole thing averaged — the same salary now reads the
     same in every week of the month.

     Leading periods with NO transactions are dropped rather than counted as
     zero-income months: a vault whose data starts three weeks ago must not be
     divided by three months of silence it was never around for. A gap INSIDE
     the window still counts, because there the silence is real.

     The payday month returns its own income untouched — the period already IS
     a month, and averaging would only blur it. */
  const MONTH_DAYS = 365.25 / 12;
  /* How many periods to average over: whichever count between two and four
     months lands CLOSEST to a whole number of months. Length matters more than
     it looks. A window a ragged 3.22 months long catches three monthly paydays
     in some weeks and four in others, which puts a 33% step into a number that
     should barely move; thirteen weeks is 2.99 months and catches three every
     time. Where income arrives every period the choice is moot, so this costs
     those cycles nothing. */
  function averagingPeriods(iv) {
    const lo = Math.max(1, Math.ceil((2 * MONTH_DAYS) / iv));
    const hi = Math.max(lo, Math.ceil((4 * MONTH_DAYS) / iv));
    let best = lo, bestErr = Infinity;
    for (let n = lo; n <= hi; n++) {
      const months = (n * iv) / MONTH_DAYS;
      const err = Math.abs(months - Math.round(months));
      if (err < bestErr) { best = n; bestErr = err; }
    }
    return best;
  }
  function monthlyIncome(p) {
    const iv = intervalDays();
    if (!iv) return { income: periodSummary(p).income, periods: 1 };
    const need = averagingPeriods(iv);
    const sums = [];
    for (let i = need - 1; i >= 0; i--) sums.push(periodSummary(shiftPeriod(p, -i)));
    let from = 0;
    while (from < sums.length - 1 && sums[from].count === 0) from++;
    const used = sums.slice(from);
    const total = used.reduce((s, x) => s + x.income, 0);
    return { income: total / (used.length * iv) * MONTH_DAYS, periods: used.length };
  }
  function budgetTotals(p) {
    const budget = S.budgets[p] || [];
    return {
      income: budget.filter(b => b.type === 'income').reduce((a, b) => a + b.amount, 0),
      spend: budget.filter(b => b.type !== 'income' && b.type !== 'transfer').reduce((a, b) => a + b.amount, 0),
    };
  }

  ctx.provide({
    periodRange, currentPeriod, shiftPeriod, periodTitle, periodMonthName, periodShortLabel,
    txInPeriod, catType, periodSummary, monthlyIncome, budgetTotals, accountForLabel, nonBudgetLabels,
    intervalDays, periodKeyValid,
  });
};
