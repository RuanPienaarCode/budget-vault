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
const { isForeign, symbolOf } = require('./currency');
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
     rows stay in the budget, since nothing says otherwise.

     Case-folded, because txSegment() is and for the same reason: the
     filesystems this plugin ships on resolve `cheque/` and `Cheque/` to one
     directory. txSegment gained the fold and this side did not, so a
     `tx_label: cheque` against an on-disk `Cheque` folder imported happily —
     the write side matched — while every read through this door saw an
     orphan: rows counted in the budget, the account told to link a folder it
     was already importing from. The two halves of one contract must fold the
     same way. tx_label goes through safeSeg here too — it is the same
     hand-typed frontmatter a.name is, and a "Visa: Gold" tx_label names a
     folder the filesystem holds as "Visa- Gold". */
  function accountForLabel(label) {
    const key = safeSeg(label).toLowerCase();
    return S.accounts.find(a =>
      a.tx_label === label || a.name === label ||
      (!!a.tx_label && safeSeg(a.tx_label).toLowerCase() === key) ||
      safeSeg(a.name).toLowerCase() === key) || null;
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
  /* Transaction folders whose ACCOUNT is stated in another currency.

     ISSUE 28 (2026-08-29 audit). Currency never reached the transaction path
     at all: txInRange stamps each row with its folder label and nothing else,
     and summaryInRange then did `income += t.amount` over the lot. So a
     Rp 1 500 000 lunch and a R 3 000 grocery shop were the same number.
     Measured, on a two-currency vault: the Dashboard hero read "R 1 499 000
     over" where R 1 000 was actually left; the Groceries budget row read
     "Spent R 1 503 000" against a R 4 000 budget; the donut, the trend line
     and the month-on-month deadband all inherited it. Not one of those
     figures carried a disclosure, because the account-level ones are the only
     place this app had ever thought to put one.

     A household-currency total cannot include foreign spend, and there is no
     rate here to convert it with. So those rows are held OUT of the totals —
     and named, every time, via the `foreign` field summaryInRange returns.
     Silence is the thing currency.js:14 actually forbids; a stated exclusion
     the reader can act on is what `budget: false` already is.

     Deliberately a SECOND set beside nonBudgetLabels() rather than folded
     into it: they answer different questions ("the reader opted this out" vs
     "this app cannot add these together"), and the disclosure a consumer
     writes for one is not the sentence for the other. */
  function foreignLabels() {
    const out = new Map();
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (a && isForeign(a, S.settings.currency)) out.set(f.label, symbolOf(a, S.settings.currency));
    }
    return out;
  }
  function catType(name) { return S.categories.find(c => c.name === name)?.type || null; }
  /* Does a category file actually answer to this name?

     The companion to catType, and deliberately a SEPARATE question. catType
     returns null both for "this row has no category" and for "this row names a
     category that isn't there", and collapsing those two is the same mistake
     detectHeaderlessColumns made with `verified:false` — "disproved" and "no
     evidence" are different answers, and reading one as the other is how a
     guess gets laundered into a number.

     Both states are reachable on supported paths: promptDeleteCategory leaves
     the name on existing rows on purpose, and there is no rename UI, so
     renaming a category means editing its file and orphaning every row that
     used it. Same exact-name match, through the same list, so catType and this
     can never disagree about which categories exist. */
  function catKnown(name) { return !!name && S.categories.some(c => c.name === name); }
  /* Is this category one whose budgeted amount IS its actual spend? See the
     comment on the flag in src/load.js. Its own lookup rather than a field on
     the budget row, because the answer belongs to the category and has to hold
     across every period the row appears in — including periods whose file was
     written before the flag existed. */
  function catAssumeSpent(name) { return S.categories.find(c => c.name === name)?.assumeSpent === true; }

  /* What the assume-spent rows come to in a period's budget. Kept separate from
     periodSummary rather than folded into it: `spend` there means "money that
     moved, according to the statements", and a dozen callers — the trend chart,
     the donut, the Tax view, the deficit below — depend on it meaning exactly
     that. This is a budgeting overlay on top, and only the two pages that show
     a budget add it in. */
  function assumedSpend(p) {
    let total = 0;
    for (const b of S.budgets[p] || []) {
      if (b.type === 'income' || b.type === 'transfer') continue;
      if (catAssumeSpent(b.category)) total += b.amount || 0;
    }
    return total;
  }

  /* How far a period ended in the hole: what actually went out, less what
     actually came in. Positive means overspent by that much; zero or less means
     the period paid for itself and there is nothing to carry.

     Real transactions only — deliberately NOT including assumedSpend(p). An
     assume-spent row is this period's provision for an EARLIER period's hole;
     counting it here would carry the same overspend forward a second time, and
     then a third, growing by itself every month with no bank line anywhere
     behind it. The money that dug the hole is already in `spend`, in whichever
     period and category it actually left.

     Read off `net` — the signed sum of every counted row — and NOT off
     `spend - income`, which is the same sentence written a second way and drew
     a different answer. `spend` is gross outgoings and counts an uncategorised
     payment in full; `income` counts only income-TYPED rows, so the deposit
     beside it was credited to nothing. Every period holding uncategorised money
     in was therefore reported deeper in the hole than it was — on the vault
     this was found against, two periods' stated overspend was materially
     wrong, and a third was offered here as a hole to carry for a period
     that had actually finished ahead. Two figures derived by different rules,
     which is this codebase's recurring bug shape; there is now one rule and
     one figure.

     `net`'s flat "every row, one rule" count is what makes THREE separate leak
     classes disappear at once, not three separate fixes: an uncategorised
     deposit (credited to nothing under `spend - income`), a refund inside an
     expense category (nets off inside `byCat` but was never reachable from
     `income` or `spend` either), and a deposit under a category name no file
     answers to (see catKnown — same "credited to nothing" shape as the first).

     It also COVERS a fourth, for free, that was never a bug to fix: a
     two-legged Contribution (CONTEXT.md — money the household moves into
     savings, which "wears the budget category it came from rather than one of
     its own"). The outgoing leg is a real negative row under an ordinary
     category, and the incoming leg on the savings side is a real positive row
     under that same category — neither is transfer-typed, so neither is
     skipped, and `net` counts both. Equal and opposite, they cancel on their
     own; periodDeficit does not need to know a Contribution happened at all.
     That cancellation only holds while both legs are actually counted, though
     — a savings account carrying `budget: false` (a non-budget account, its
     own veto, unrelated to this one) drops its own leg out of `net` entirely,
     which turns a Contribution's outgoing half into what LOOKS like real
     spend. See tests/summary-conservation.test.cjs's two-legged-contribution
     case for both shapes pinned side by side. */
  function periodDeficit(p) {
    /* `0 - net`, not `-net`: negating a zero balance yields NEGATIVE zero,
       which money() formats as "-R0.00" — the same break-even wart this repo
       has already shipped once, on the Accounts hero. Subtracting from zero
       gives the same answer everywhere else and a positive zero here. */
    return 0 - periodSummary(p).net;
  }

  function periodSummary(p) {
    const { start, end } = periodRange(p);
    return summaryInRange(start, end);
  }
  function summaryInRange(start, end) {
    // Excluded rows are the user's per-row veto; the non-budget set is the
    // per-account one. Both drop out of income/spend here and nowhere else —
    // Transactions still lists every row, so nothing goes invisible.
    const skip = nonBudgetLabels();
    const foreignBy = foreignLabels();
    const tx = txInRange(start, end).filter(t =>
      !t.excluded && !skip.has(t.label) && !foreignBy.has(t.label));
    /* Only the folders that actually CONTRIBUTED rows in this window — a
       foreign account with nothing in the period is not something to warn
       about, and a disclosure that fires on every period regardless of the
       data is one readers learn to stop seeing. */
    const foreignHere = new Map();
    for (const t of txInRange(start, end)) {
      if (!t.excluded && !skip.has(t.label) && foreignBy.has(t.label)) {
        foreignHere.set(t.label, foreignBy.get(t.label));
      }
    }
    let income = 0, spend = 0, net = 0, uncategorised = 0, uncatSpend = 0, uncatIncome = 0;
    /* Consumer map, so no half of this object reads as orphaned on a cold
       read: `count`/`names` drive the Dashboard's "Missing categories" stat,
       and `income` its Income-tile disclosure — a deposit under a missing name
       is NOT counted as income, so the omission has to be said where the
       figure is read. `spend` has no tile on purpose: outgoings under a
       missing name are already inside gross `spend` and drawn as their own
       donut slices, so there is no omission to disclose. Its job is the
       conservation identity in tests/summary-conservation.test.cjs, which
       needs both halves to prove every rand landed somewhere. */
    const unknown = { count: 0, spend: 0, income: 0, names: [] };
    const unknownSeen = new Set();
    // Object.create(null): a category named "constructor" or "__proto__"
    // otherwise collides with Object.prototype instead of getting its own
    // slot — src/views/debts.js:224 does the same for the same reason.
    const byCat = Object.create(null);
    for (const t of tx) {
      const type = catType(t.cat);
      /* A transfer is money moving between the reader's own pockets. It leaves
         the arithmetic entirely rather than netting to zero inside it, because
         the two legs need not land in the same period. */
      if (type === 'transfer') continue;

      /* THE LEDGER LINE, taken before any classification can decline the row.

         `net` is the signed sum of everything counted, and periodDeficit reads
         nothing else. That is what stops a classification bug from becoming a
         money bug: a wrong bucket is now a wrong LABEL, where it used to be a
         missing rand. The chain below used to be `if income … else if negative`
         with no final else, so an uncategorised deposit, a refund inside an
         expense category, and money under a name no category file answers to
         each matched nothing and were counted by nothing — while `spend`
         counted their outgoing siblings in full. On the vault this was found
         in, that put five figures of deposits beyond the reach of every total
         built on `income`, and turned a period that had finished ahead into a
         reported overspend — which is the figure the Budget page offers to
         carry forward as money already spent.

         tests/summary-conservation.test.cjs pins the buckets back to this sum,
         so a future branch that swallows a row breaks arithmetic rather than
         quietly shrinking a total. */
      net += t.amount;
      byCat[t.cat || ''] = (byCat[t.cat || ''] || 0) + t.amount;

      /* THREE states, not two. "" is a row nobody has categorised yet. A name
         no category file answers to is a different thing entirely — see
         catKnown above for why both are reachable — and it used to be invisible:
         `uncategorised` did not count it, so nothing on screen said a word.
         Neither state can ever resolve to a transfer type, so counting them
         after that skip changes nothing. */
      if (!t.cat) {
        uncategorised++;
        if (t.amount < 0) uncatSpend += -t.amount; else uncatIncome += t.amount;
      } else if (!catKnown(t.cat)) {
        unknown.count++;
        if (t.amount < 0) unknown.spend += -t.amount; else unknown.income += t.amount;
        /* `names` is first-seen order over this period's transaction rows, not
           a sort — deliberately: the dashboard tile only ever shows the first
           MISSING_NAMES_SHOWN of them (dashboard.js) and any deterministic
           order would do equally well there, so this stays whatever order the
           rows happen to iterate in rather than paying to sort a list nobody
           has asked to read in a particular order. If a future reader needs
           this stable (e.g. two renders of the same period disagreeing on
           which names got cut by "+N more"), sort it here — this comment is
           that decision recorded, not an oversight. */
        if (!unknownSeen.has(t.cat)) { unknownSeen.add(t.cat); unknown.names.push(t.cat); }
      }

      if (type === 'income') income += t.amount;
      else if (t.amount < 0) spend += -t.amount;
    }
    /* `uncatSpend` is the GROSS outgoing half of the uncategorised bucket, and
       it is deliberately not derivable from byCat[''], which is a NET figure. A
       period holding more uncategorised deposits than uncategorised payments
       nets POSITIVE, so byCat[''] reports nothing while `spend` above has
       already counted the whole outgoing half. The Dashboard's donut discloses
       what it left out by subtracting from `spend`, so it needs the same half
       of the bucket that `spend` counted — see renderSplit.

       `uncatIncome` is its other half, and the Dashboard's Income tile
       discloses it for the same reason: money that arrived with no category is
       NOT counted as income (it may be a transfer in from savings, and
       guessing would inflate every ratio built on income), but a figure that
       quietly omits a real deposit has to say so where it is read. */
    /* `foreign` travels WITH the figures, not beside them, so a consumer
       cannot read the totals without having been handed the caveat. Every
       tile, table, chart and aria-label built from this object is expected to
       say something when `foreign.count` is non-zero. */
    return {
      income, spend, net, uncategorised, uncatSpend, uncatIncome, unknown, byCat,
      count: tx.length,
      foreign: {
        count: foreignHere.size,
        labels: [...foreignHere.keys()],
        symbols: [...new Set(foreignHere.values())],
      },
    };
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
    intervalDays, periodKeyValid, catAssumeSpent, catKnown, assumedSpend, periodDeficit,
  });
};
