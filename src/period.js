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
const { periodDaysOrZero } = require('./dates');
const { safeSeg } = require('./vault-path');
const { ISO_DATE: DATE_KEY, isoOf, isoDayNumber: dayNum, isoFromDayNumber: isoFromDayNum, isRealIsoDate } = require('./dates');

/* The pay cycle is stored as its own length in days rather than a named type.
   A word would have to pick a dialect — "fortnightly" is idiomatic in za/uk/au
   and foreign in us/ca, "biweekly" is idiomatic there and genuinely ambiguous
   (every two weeks, or twice a week?) — and locale.js has no vocabulary layer
   to swap it per country. A number reads the same everywhere, needs no new word
   when a cycle is added, and lets someone paid every ten days simply work.

   Absent or zero means the payday month, so a vault that has never heard of
   this setting behaves exactly as it always did. The band the value must fall
   in is enforced by periodDaysOrZero in dates.js, which the loader applies on
   the way in so the stored setting and the running one can never disagree. */

/* Month 01–12, not any two digits: '2026-13' is date-SHAPED but not a month,
   and Date's rollover turned it into a real 31-day window titled "undefined
   2026" that the arrows would happily walk into.

   Year 0100–9999 for the same reason one step up. Date.UTC maps years 0–99 onto
   1900–1999, so '0000-01' passed a bare \d{4} and then resolved to a window
   starting 1899-12-23 — a period the name never claimed. That is the same
   relocation isRealIsoDate rejects by round-trip, and the two must agree: a
   month key it would refuse as a date must not be reachable as a month. */
const MONTH_KEY = /^(?:0[1-9]\d{2}|[1-9]\d{3})-(0[1-9]|1[0-2])$/;

/* Whole-day arithmetic in UTC (dayNum / isoFromDayNum, from src/dates.js).
   Local-time date maths would drift by a day across a DST boundary — a period
   would silently gain or lose a day twice a year, which is exactly the kind of
   failure that shows up as "my totals moved" with no error to point at. */

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
    return isRealIsoDate(S.settings.period_anchor) ? dayNum(S.settings.period_anchor) : null;
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
    if (!isRealIsoDate(p)) return false;
    return (dayNum(p) - anchorDay()) % iv === 0;
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
    // Constructed and read in local time, so the month boundary is the one the
    // reader's own calendar shows — isoOf reads with the same local getters.
    return { start: isoOf(new Date(y, m - 2, n)), end: isoOf(new Date(y, m - 1, n - 1)) };
  }
  function currentPeriod() {
    const now = new Date();
    const iv = intervalDays();
    if (iv) {
      return isoFromDayNum(periodStartOnOrBefore(dayNum(isoOf(now)), iv));
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
  /* "Aug 22" — a real calendar DAY, for a full 'YYYY-MM-DD'.

     Deliberately not periodShortLabel, which takes a period KEY and renders the
     YEAR as its second half: 'Aug 26' there means August 2026 and is right on a
     trend axis. Handed an end DATE it still printed 'Aug 26', so a period ending
     on the 22nd announced itself as ending on the 26th — six inches below a
     header reading "Jul 23 – Aug 22, 2026". Two labels, two jobs; the mistake
     was reaching for the axis one to name a day. */
  const dayLabel = d => `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${parseInt(d.slice(8), 10)}`;

  function periodTitle(p) {
    const { start, end } = periodRange(p);
    const f = dayLabel;
    const sy = start.slice(0, 4), ey = end.slice(0, 4);
    if (sy === ey) return `${f(start)} – ${f(end)}, ${ey}`;
    return `${f(start)}, ${sy} – ${f(end)}, ${ey}`;
  }
  function txInPeriod(p) {
    const { start, end } = periodRange(p);
    return txInRange(start, end);
  }
  /* The same scan against an arbitrary date range. Split out because the
     monthly-income window is measured in CALENDAR MONTHS rather than in
     periods, and a second copy of this loop is how the two would come to
     disagree about what "excluded" or "in range" means. */
  function txInRange(start, end) {
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
  /* account -> { rows, labels } in ONE pass over S.txFiles.

     Lives here rather than in a view because Accounts and Savings both need it
     and would otherwise keep private copies that drift. Resolving per account
     instead of indexing once would walk every month file once per account.

     Rows are handed over unfiltered — excluded ones included. Callers decide
     what to drop, and the two that exist deliberately drop nothing: money that
     left the bank still left the bank whether or not it counts in the budget. */
  function accountIndex() {
    const idx = new Map();
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (!a) continue;                 // an orphan folder with no account file
      let e = idx.get(a);
      if (!e) { e = { rows: [], labels: new Set() }; idx.set(a, e); }
      e.labels.add(f.label);
      for (const r of f.rows) e.rows.push(r);
    }
    return idx;
  }

  /* The accounts a Transactions/ folder resolves to, EMPTY FOLDERS INCLUDED.

     accountIndex() cannot answer this and never could: it is built from
     S.txFiles, so an account whose folder exists but holds no month file yet
     produces no entry there and is indistinguishable from one with no folder at
     all. Both come back as zero rows; only this set separates them.

     Resolved through accountForLabel, the same door accountIndex uses, so a
     `tx_label` pointing at a differently-named folder counts here exactly as it
     counts there — otherwise an account would be told to link the folder it is
     already successfully importing from. */
  function accountsWithFolder() {
    const set = new Set();
    for (const name of S.txFolders || []) {
      const a = accountForLabel(name);
      if (a) set.add(a);
    }
    return set;
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
    const { start, end } = periodRange(p);
    return summaryInRange(start, end);
  }
  function summaryInRange(start, end) {
    // Excluded rows are the user's per-row veto; the non-budget set is the
    // per-account one. Both drop out of income/spend here and nowhere else —
    // Transactions still lists every row, so nothing goes invisible.
    const skip = nonBudgetLabels();
    const tx = txInRange(start, end).filter(t => !t.excluded && !skip.has(t.label));
    let income = 0, spend = 0, uncategorised = 0, uncatSpend = 0;
    // Object.create(null): a category named "constructor" or "__proto__"
    // otherwise collides with Object.prototype instead of getting its own
    // slot — src/views/debts.js:224 does the same for the same reason.
    const byCat = Object.create(null);
    for (const t of tx) {
      const type = catType(t.cat);
      if (!t.cat) uncategorised++;
      if (type === 'transfer') continue;
      byCat[t.cat || ''] = (byCat[t.cat || ''] || 0) + t.amount;
      if (type === 'income') income += t.amount;
      else if (t.amount < 0) { spend += -t.amount; if (!t.cat) uncatSpend += -t.amount; }
    }
    /* `uncatSpend` is the GROSS outgoing half of the uncategorised bucket, and
       it is deliberately not derivable from byCat[''], which is a NET figure. A
       period holding R16 895 of uncategorised payments and R21 440 of
       uncategorised deposits nets POSITIVE, so byCat[''] reports nothing while
       `spend` above has already counted the whole R16 895. The Dashboard's
       donut discloses what it left out by subtracting from `spend`, so it needs
       the same half of the bucket that `spend` counted — see renderSplit. */
    return { income, spend, uncategorised, uncatSpend, byCat, count: tx.length };
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
     those cycles nothing.

     The two roundings go OPPOSITE ways on purpose, because both bounds have to
     stay inside the band rather than merely near it: lo rounds UP to the first
     count at or above two months, hi rounds DOWN to the last one at or below
     four. Rounding hi up instead let the search consider a window longer than
     its own stated ceiling — a fortnightly cycle picked 9 periods, 126 days,
     4.14 months — which is only harmless because income lands every period on
     that cycle. Nothing in the search knew that; it was luck, not design.
     Math.max keeps hi ≥ lo for the long end of the band, where floor can bite. */
  /* The window is three CALENDAR months, and that is the whole point.

     It used to be a count of PERIODS, chosen so that count × interval landed
     closest to a whole number of average months — thirteen weeks being 91 days,
     2.99 months, which the comment here claimed "catches three paydays every
     time". It does not, and neither does any other length. A monthly payday
     recurs every 28 to 31 days, so whether a fixed span of DAYS contains two of
     them or three depends on where in the month the span happens to begin.
     Swept over every start date, every candidate from 63 to 366 days holds a
     varying count — even a full 365 days holds eleven paydays or twelve. There
     is no count that fixes it, which is why the search that picked one is gone
     rather than retuned.

     Measured on the code this replaces: a household earning R40 000 a month saw
     its stated monthly income move 50% between consecutive weeks, reading as
     little as R26 758 — and that figure is what the Debt page divides by to
     compare against a 36% threshold.

     Calendar months are exact where day counts can only approximate: step back
     three months and you have stepped over exactly three monthly paydays,
     whatever day of the month they fall on and however long those months were.
     Swept the same way over 5 117 windows and seven payday days, it holds three
     every time, with zero deviation. */
  const INCOME_MONTHS = 3;
  /* n calendar months before an ISO date, clamping a day the target month does
     not have: 31 March back one month is 28 February, not 3 March. */
  function isoMinusMonths(isoDate, n) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCMonth(t.getUTCMonth() - n);
    if (t.getUTCDate() !== d) t.setUTCDate(0);
    return t.toISOString().slice(0, 10);
  }
  const nextDayIso = d => isoFromDayNum(dayNum(d) + 1);
  /* Monthly income, for a cycle that is not already monthly.

     A period still RUNNING is a partial one: whatever has landed so far divided
     by a whole cycle reads low, and a low income is a HIGH debt-to-income ratio
     shown in red on the strength of nothing but which day of the week it is. So
     the window ends at the last COMPLETE period. A p in the past is already
     complete and ends at itself. */
  function monthlyIncome(p) {
    const iv = intervalDays();
    // The payday month is untouched: the period already IS a month, and
    // averaging would only blur it.
    if (!iv) return { income: periodSummary(p).income, months: 1, complete: true };

    const running = p === currentPeriod();
    const endsAt = periodRange(running ? shiftPeriod(p, -1) : p).end;
    /* (from, endsAt] — exclusive at the far end, so a payday sitting exactly on
       the boundary is not counted by two consecutive windows. */
    const win = n => summaryInRange(nextDayIso(isoMinusMonths(endsAt, n)), endsAt);

    /* Months with no data at all are trimmed off the FAR end, exactly as the
       period window used to trim leading empties: a vault whose history starts
       three weeks ago must not be divided by three months of silence it was
       never around for. A gap in the MIDDLE is real silence and still counts —
       this only walks in from the oldest month while that month is empty. */
    let months = INCOME_MONTHS;
    while (months > 1 && win(months).count === win(months - 1).count) months--;

    const w = win(months);
    /* A vault set up this week has no completed period at all, and would report
       no income while the user is looking straight at the salary they just
       imported. A partial figure beats a blank ratio — but say which one it is,
       so the page can label it honestly rather than implying a settled average. */
    if (running && w.count === 0) {
      const part = periodSummary(p);
      return { income: part.income / iv * MONTH_DAYS, months: 0, complete: false };
    }
    return { income: w.income / months, months, complete: true };
  }
  function budgetTotals(p) {
    const budget = S.budgets[p] || [];
    return {
      income: budget.filter(b => b.type === 'income').reduce((a, b) => a + b.amount, 0),
      spend: budget.filter(b => b.type !== 'income' && b.type !== 'transfer').reduce((a, b) => a + b.amount, 0),
    };
  }

  ctx.provide({
    periodRange, currentPeriod, shiftPeriod, periodTitle, periodMonthName, periodShortLabel, dayLabel,
    txInPeriod, catType, periodSummary, monthlyIncome, budgetTotals, accountForLabel, accountIndex, accountsWithFolder, nonBudgetLabels,
    intervalDays, periodKeyValid,
  });
};
