'use strict';
/* Financial-period math + per-period summaries.

   A period has a NAME its files are addressed by and BOUNDARIES deciding which
   transactions fall inside it, and the two are deliberately separate (CONTEXT.md,
   ADR-0001). 'YYYY-MM' is a payday month, named for the month it ends in;
   'YYYY-MM-DD' is an interval period named for the day it starts on, derived
   from period_anchor plus period_days. Nothing is materialised, and the anchor
   matters only MODULO the interval.

   ADR-0007 · period.js — purpose. The full narrative, and every rule this file
   used to carry as prose, is in the ADR-0007 register. */

const { MONTHS } = require('./constants');
const { periodDaysOrZero } = require('./dates');
const { safeSeg } = require('./vault-path');
const { isForeign, symbolOf } = require('./currency');
const { ISO_DATE: DATE_KEY, isoOf, todayIso, isoDayNumber: dayNum, isoFromDayNumber: isoFromDayNum, isRealIsoDate } = require('./dates');
const { reconcile } = require('./reconcile');
/* ISSUE 43. The score already answers "how much did this household actually
   put aside" and it does it by PAIRING the two legs of a movement, so money
   shuffled between two funds is not counted as fresh saving. That reading is
   reused rather than re-spelled: a second answer to the same question is the
   defect this whole audit keeps finding. */
const { savedFromOutside } = require('./savings-math');
const { budgetUsedShare, budgetSpent, assumedProvision } = require('./money-flow');
const { SET_ASIDE_TYPES, isPoolAccount } = require('./vocabulary');
const { stamp, tally, LENSES } = require('./ledger');

/* ADR-0007 · Pay cycle is a number of days. A word would need a dialect; absent
   or zero means the payday month; periodDaysOrZero bands it on load. */

/* ADR-0007 · Month key shape. Month 01–12 and year 0100–9999 only — Date's
   rollover turned '2026-13' and '0000-01' into windows the name never claimed. */
const MONTH_KEY = /^(?:0[1-9]\d{2}|[1-9]\d{3})-(0[1-9]|1[0-2])$/;

/* Whole-day arithmetic in UTC (dayNum / isoFromDayNum, from src/dates.js).
   Local-time date maths would drift by a day across a DST boundary — a period
   would silently gain or lose a day twice a year, which is exactly the kind of
   failure that shows up as "my totals moved" with no error to point at. */

module.exports = function registerPeriod(ctx) {
  const { S } = ctx;

  /* ADR-0007 · Anchor must be a real date. Only an ISO round-trip catches both
     2026-13-45 and a state built without the loader ('NaN-NaN-NaN'). */
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

  /* ADR-0007 · Period key must be addressable under current settings. S.period
     survives a reload but the period LENGTH can change underneath it. */
  function periodKeyValid(p) {
    if (typeof p !== 'string') return false;
    const iv = intervalDays();
    if (!iv) return MONTH_KEY.test(p);
    /* ADR-0007 · Interval key must sit on the anchor's phase. Shape alone is not
       enough: a length change or off-cycle anchor move redraws the set of starts. */
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
  /* ADR-0007 · dayLabel names a day; periodShortLabel names a period. The axis
     label renders the YEAR second, so it printed 'Aug 26' for a period ending the 22nd. */
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
  /* ADR-0007 · accountForLabel folds case and safeSegs both sides. The mirror of
     txSegment() in load.js; null for an orphan folder, whose rows stay in. */
  function accountForLabel(label) {
    const key = safeSeg(label).toLowerCase();
    return S.accounts.find(a =>
      a.tx_label === label || a.name === label ||
      (!!a.tx_label && safeSeg(a.tx_label).toLowerCase() === key) ||
      safeSeg(a.name).toLowerCase() === key) || null;
  }
  /* ADR-0007 · accountIndex hands over rows unfiltered. ONE pass over S.txFiles;
     callers decide what to drop, and both existing ones drop nothing. */
  /* ADR-0007 · One folded-key lookup per index. ISSUE 61 — exactly equivalent to
     accountForLabel's scan, built once instead of once per transaction file. */
  function labelLookup() {
    const map = new Map();
    for (const a of S.accounts) {
      for (const k of [a.tx_label, a.name]) {
        if (!k) continue;
        const key = safeSeg(k).toLowerCase();
        if (!map.has(key)) map.set(key, a);
      }
    }
    return label => map.get(safeSeg(label).toLowerCase()) || null;
  }
  function accountIndex() {
    const idx = new Map();
    const lookup = labelLookup();
    for (const f of Object.values(S.txFiles)) {
      const a = lookup(f.label);
      if (!a) continue;                 // an orphan folder with no account file
      let e = idx.get(a);
      if (!e) { e = { rows: [], labels: new Set() }; idx.set(a, e); }
      e.labels.add(f.label);
      for (const r of f.rows) e.rows.push(r);
    }
    return idx;
  }

  /* ADR-0007 · Implied balances are as of now, on new objects. ISSUE 44 —
     reconcile() is the one definition of "what this account should read now";
     S.accounts is never mutated, a stated balance being a claim with an age. */
  function impliedAccounts(todayArg) {
    const idx = accountIndex();
    /* Passed straight through to reconcile, which has always taken `today` as
       its third argument — this function simply stopped supplying one. */
    const today = DATE_KEY.test(todayArg || '') ? todayArg : undefined;
    return (S.accounts || []).map(a => {
      const rec = reconcile(a, (idx.get(a) || {}).rows || [], today);
      return rec.state === 'drift' ? { ...a, balance: rec.implied } : a;
    });
  }

  /* ADR-0007 · Folders resolve to accounts even when empty. accountIndex() is
     built from S.txFiles and cannot see a folder with no month file yet. */
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

  /* ADR-0007 · Earmarked outgoings leave the budget. ISSUE 41 — money leaving a
     declared fund is not this period's spend; money arriving is income. */
  /* ADR-0007 · type: savings alone is not a declaration. Earmarked means an
     emergency_fund flag, or a pool account with a goal; in_budget_stated opts out. */
  function isEarmarkedAccount(a) {
    if (!a || a.in_budget_stated) return false;
    const ef = a.emergency_fund;
    if (ef === true || (typeof ef === 'number' && ef > 0)) return true;
    if (!isPoolAccount(a)) return false;
    return (a.goal_amount > 0) || !!a.target_date || (a.monthly_contribution > 0);
  }

  /* ADR-0007 · Declared category type is null when unstated. A default is not
     evidence of intent for savedFromOutside's ISSUE 32 rule. */
  function declaredCatType(name) {
    const c = (S.categories || []).find(x => x.name === name);
    return c && c.type_stated ? c.type : null;
  }
  /* ADR-0007 · Moved-to-funds is an aggregate, not per envelope. ISSUE 43 — no
     link exists from a transfer row to a category, and free text is not guessed. */
  function movedToFunds(p, todayArg) {
    const { start, end } = periodRange(p);
    const labels = new Map();
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (isEarmarkedAccount(a) || isPoolAccount(a)) {
        labels.set(f.label, a);
      }
    }
    if (!labels.size) return 0;
    /* Injected like periodSummary's, and for the same reason. */
    const today = DATE_KEY.test(todayArg || '') ? todayArg : todayIso();
    /* ADR-0007 · Moved-to-funds windows as of today. ISSUE 35's shape: a period
       not yet started moves nothing, and this figure has nowhere to put a caveat. */
    if (today < start) { return 0; }
    const stop = today < end ? today : end;
    return savedFromOutside(txInRange(start, stop), labels, declaredCatType);
  }

  function earmarkedLabels() {
    const out = new Set();
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (isEarmarkedAccount(a)) out.add(f.label);
    }
    return out;
  }
  /* ADR-0007 · Foreign folders are held out and named. ISSUE 28 — no rate to
     convert with; a SECOND set beside nonBudgetLabels() because the disclosure
     for "opted out" is not the sentence for "cannot be added together". */
  function foreignLabels() {
    const out = new Map();
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (a && isForeign(a, S.settings.currency)) out.set(f.label, symbolOf(a, S.settings.currency));
    }
    return out;
  }
  function catType(name) { return S.categories.find(c => c.name === name)?.type || null; }
  /* ADR-0007 · catKnown is a separate question from catType. "No category" and
     "category file gone" are different answers, both reachable. */
  function catKnown(name) { return !!name && S.categories.some(c => c.name === name); }
  /* Is this category one whose budgeted amount IS its actual spend? See the
     comment on the flag in src/load.js. Its own lookup rather than a field on
     the budget row, because the answer belongs to the category and has to hold
     across every period the row appears in — including periods whose file was
     written before the flag existed. */
  function catAssumeSpent(name) { return S.categories.find(c => c.name === name)?.assumeSpent === true; }

  /* ADR-0007 · A budget row's type is the category's live type. The stored cell
     stands in only when no file answers; `??`, not `||`. */
  function budgetRowType(b) {
    return catType(b.category) ?? b.type;
  }

  /* ADR-0007 · Deficit is read off net, not spend − income. ADR-0007 · Deficit
     excludes the assume-spent overlay. Positive means overspent by that much;
     zero or less means there is nothing to carry. */
  function periodDeficit(p) {
    /* `0 - net`, not `-net`: negating a zero balance yields NEGATIVE zero,
       which money() formats as "-R0.00" — the same break-even wart this repo
       has already shipped once, on the Accounts hero. Subtracting from zero
       gives the same answer everywhere else and a positive zero here. */
    return 0 - periodSummary(p).net;
  }

  /* ADR-0007 · Period figures close at today. ISSUE 35 — the rest of the window
     comes back as `scheduled`, not dropped; done here so every Dashboard figure
     shares one boundary (tests/cross-page-consistency.test.cjs). */
  /* ADR-0007 · today is injected. Optional, defaulting to the clock, so the
     boundary can be driven by a test or an "as at" report, not a faked global Date. */
  function periodSummary(p, todayArg) {
    const { start, end } = periodRange(p);
    const today = DATE_KEY.test(todayArg || '') ? todayArg : todayIso();
    if (today < start || today >= end) {
      /* Behind us, or entirely ahead of us. Either way there is no "so far"
         boundary inside this window to draw. */
      const whole = summaryInRange(start, end);
      if (today < start) {
        /* ADR-0007 · A future period is all scheduled. ISSUE 73 — nothing has
           happened yet, so the headline figures are zero and the plan is `scheduled`. */
        const nothing = summaryInRange(end, start);   // an empty window, same shape
        nothing.asOf = start;
        nothing.scheduled = { income: whole.income, spend: whole.spend, count: whole.count, from: start };
        return nothing;
      }
      whole.asOf = end;
      whole.scheduled = EMPTY_SCHEDULED;
      return whole;
    }
    const soFar = summaryInRange(start, today);
    /* The remainder, measured by the same function over the complementary
       window rather than by subtracting two totals. Subtraction would be
       arithmetically identical for `income` and `spend` and quietly wrong for
       `count`, which counts ROWS the two windows classify independently — and
       a disclosure that miscounts what it is disclosing is worse than none. */
    const rest = summaryInRange(nextDay(today), end);
    soFar.asOf = today;
    soFar.scheduled = {
      income: rest.income, spend: rest.spend, count: rest.count, from: nextDay(today),
    };
    return soFar;
  }
  /* ADR-0007 · Set-aside types are one copy. ISSUE 40 — SET_ASIDE_TYPES in
     vocabulary.js, read by both halves of the budget-used ratio. */

  /* Frozen so every caller that reads `scheduled` off a finished period gets
     the same object shape rather than a fresh literal each render — and so
     nothing downstream can mutate one period's disclosure into another's. */
  const EMPTY_SCHEDULED = Object.freeze({ income: 0, spend: 0, count: 0, from: null });
  /* One day on, as an ISO string. Day arithmetic goes through dates.js's day
     numbering rather than through Date: a `new Date(iso)` here parses as UTC
     while periodRange's own boundaries are built from LOCAL getters, and the
     two disagree by a day either side of midnight in half the world. */
  const nextDay = iso => isoFromDayNum(dayNum(iso) + 1);

  /* ADR-0007 · summaryInRange is the BUDGET tally. ADR-0006 Phase 2 — every
     field is read off tally(ledger(start, end), LENSES.BUDGET). */
  function summaryInRange(start, end) {
    const t = tally(ledger(start, end), LENSES.BUDGET);
    return {
      income: t.income, spend: t.spend, net: t.net,
      uncategorised: t.uncategorised, uncatSpend: t.uncatSpend, uncatIncome: t.uncatIncome,
      unknown: t.unknown, byCat: t.byCat,
      setAside: t.setAside, fundedFromSavings: t.fundedFromSavings,
      count: t.count,
      foreign: t.foreign,
    };
  }
  /* The env the ledger stamps rows against: every household fact a veto
     reads, resolved once per call. `fixedCats` rides along for the HOUSEHOLD
     lens's `fixed` slice. */
  function ledgerEnv() {
    return {
      nonBudgetLabels: nonBudgetLabels(),
      foreignLabels: foreignLabels(),
      earmarkedLabels: earmarkedLabels(),
      fixedCats: new Set(S.categories.filter(c => c.fixed).map(c => c.name)),
      catType, catKnown,
    };
  }
  /* Every row in the window, stamped once. The one entry point a period
     figure should take. */
  function ledger(start, end) { return stamp(txInRange(start, end), ledgerEnv()); }

  /* ADR-0007 · Monthly income averages calendar months. For the Debt page's 36%
     threshold; scaling one period up breaks on a weekly cycle, and the payday
     month is returned untouched. */
  const MONTH_DAYS = 365.25 / 12;
  /* ADR-0007 · Income window is three calendar months, not a period count. No
     span of days holds a fixed number of monthly paydays (R26 758 for a R40 000
     household); three calendar months holds three every time. */
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
  /* ADR-0007 · Monthly income ends at the last complete period. A running
     period is partial, reads low, and a low income is a high ratio shown in red. */
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
  /* ADR-0007 · Budget totals bucket by the live category type. Through
     budgetRowType — the stored Type cell never heals after a retype
     (tests/period-budget-totals-live-type.test.cjs). */
  /* ADR-0007 · Set-aside envelopes are not budget to spend. ISSUE 40 — a savings
     or investment row is `setAside`, budgeted and shown, but not "left to spend". */
  function budgetTotals(p) { return budgetTotalsOf(S.budgets[p] || []); }
  /* The same bucketing over any set of budget rows — the Budget page hands in
     its unsaved draft so its tiles move as the reader types. */
  function budgetTotalsOf(budget) {
    let income = 0, spend = 0, setAside = 0;
    for (const b of budget || []) {
      const type = budgetRowType(b);
      if (type === 'income') income += b.amount;
      else if (type === 'transfer') continue;
      else if (SET_ASIDE_TYPES.has(type)) setAside += b.amount;
      else spend += b.amount;
    }
    return { income, spend, setAside };
  }

  /* ADR-0007 · Budget used has one period-level reading. The rule is ADR-0005's;
     the operands come back with the share because every surface prints both. */
  function budgetUsed(p, opts) {
    const { today, rows } = opts || {};
    const sum = periodSummary(p, today);
    const budget = rows || S.budgets[p] || [];
    const budgeted = budgetTotalsOf(budget).spend;
    /* The assume-spent provision, over the same rows the denominator was
       built from, measured against this period's real spend per category. */
    const assumedRows = budget.filter(b => {
      const type = budgetRowType(b);
      return type !== 'income' && type !== 'transfer' && catAssumeSpent(b.category);
    });
    const assumed = assumedProvision(assumedRows, b => -(sum.byCat[b.category] || 0));
    const operands = { spend: sum.spend, setAside: sum.setAside, assumed };
    return { spent: budgetSpent(operands), budgeted, assumed, setAside: sum.setAside || 0,
      used: budgetUsedShare({ ...operands, budgeted }) };
  }

  ctx.provide({
    periodRange, currentPeriod, shiftPeriod, periodTitle, periodMonthName, periodShortLabel, dayLabel,
    txInPeriod, catType, periodSummary, monthlyIncome, budgetTotals, accountForLabel, accountIndex, impliedAccounts, accountsWithFolder, nonBudgetLabels,
    /* Published so the score's household walk (health-data.js) narrows rows by
       the SAME predicate summaryInRange does — a second spelling of "which
       folders are foreign" is how the ISSUE 28 fix reached the numerators and
       missed the divisors. */
    foreignLabels,
    /* ISSUE 41. Published for the same reason foreignLabels above it is: an
       oracle or a view that re-spells "which folders are set aside" is a second
       rule waiting to disagree with this one. */
    earmarkedLabels, movedToFunds, declaredCatType,
    intervalDays, periodKeyValid, catAssumeSpent, catKnown, periodDeficit,
    /* ADR-0005. The one period-level "budget used" reading. */
    budgetUsed,
    /* ADR-0006 Phase 2. The ledger and its lenses, for every consumer that
       needs a period figure the three named seams do not already hand back. */
    ledgerEnv, ledger, tally, LENSES,
    /* The one reading of a budget row's type — views/dashboard.js's
       budgetVsActualRows reads it too, so the table, the hero and the Budget
       page cannot bucket one row three ways. */
    budgetRowType,
  });
};
