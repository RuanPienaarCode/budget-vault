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
const { ISO_DATE: DATE_KEY, isoOf, todayIso, isoDayNumber: dayNum, isoFromDayNumber: isoFromDayNum, isRealIsoDate } = require('./dates');
const { reconcile } = require('./reconcile');
/* ISSUE 43. The score already answers "how much did this household actually
   put aside" and it does it by PAIRING the two legs of a movement, so money
   shuffled between two funds is not counted as fresh saving. That reading is
   reused rather than re-spelled: a second answer to the same question is the
   defect this whole audit keeps finding. */
const { savedFromOutside } = require('./savings-math');
const { budgetUsedShare, budgetSpent, assumedProvision } = require('./money-flow');

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
  /* ISSUE 61. One folded-key lookup built ONCE per index, instead of
     accountForLabel's linear scan once per transaction FILE.

     accountForLabel is O(accounts) with two safeSeg calls per account, and
     accountIndex called it per file — O(files x accounts), rebuilt around
     fifteen times per Dashboard render. Measured with the row count held
     constant at 9 600: 2 accounts 6 ms, 40 accounts 47 ms for the fifteen
     rebuilds, and over a million safeSeg calls per render at 40. Desktop V8
     shrugs; the iOS 15 floor this plugin targets does not.

     EXACTLY equivalent to the scan it replaces, not approximately. find()
     returns the first account (in array order) for which ANY of four tests
     holds — exact tx_label, exact name, folded tx_label, folded name. An
     exact match implies a folded match (safeSeg(x).toLowerCase() of an equal
     string IS the key), so the folded tests are a superset, and a map from
     folded key to the FIRST account claiming it gives the same answer for
     every label, colliding vaults included (#72 is about those). */
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

  /* Every account with the balance it should read RIGHT NOW, rather than the
     one last confirmed — ISSUE 44.

     The Dashboard held two as-of dates at once and said so in its own copy.
     "Money you have right now" ran every account through reconcile(), so a
     R1 200 Checkers shop on 2 September was inside its R41 800. Net worth,
     four tiles along, called worth() on the raw `balance` fields and printed
     R120 000 built on a R43 000 cash pile that still read as of 1 September.
     One card, one household, two answers to "as of when" — and the second one
     was captioned "these do not move with the period", which is true and does
     not mean "these do not move".

     `reconcile()` is the app's one definition of "what this account should
     read now" and it is not restated here: a drift verdict carries `implied`
     and every other verdict means nothing readable has moved since the
     confirmation, in which case the stated figure IS the current one.

     Returns NEW objects rather than mutating S.accounts. The account files are
     the source of truth and a stated balance is "a claim with an age, never a
     fact" — writing a derived figure back onto the model would make the claim
     unrecoverable and the next save would persist a number nobody typed. */
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

  /* ISSUE 41. Transaction folders belonging to money the household has already
     said is set aside — a savings or investment account, or one carrying an
     `emergency_fund` earmark.

     On the `BudgetAudit` vault the baby fund (type savings, opening R8 000)
     held `Pram | Groceries | -5000`. That R5 000 went into Total Spent, into
     the Groceries envelope and therefore into "budget remaining", so buying a
     pram out of an earmarked fund read on screen exactly like blowing the
     grocery budget at Checkers — and the same R8 000 was simultaneously being
     counted as emergency cover by the health card. One fund, spent twice, in
     two directions.

     OUTGOINGS ONLY, and the asymmetry is deliberate. Money LEAVING a fund was
     funded by an earlier period's income and is not this period's household
     spending; money ARRIVING in one is arriving now and is income like any
     other — a bonus paid straight into savings would otherwise vanish from the
     figure it belongs in. The three vetoes above this one are whole-row
     because their subject is the ROW (a per-row veto, an opted-out account, an
     unconvertible currency); this one's subject is a DIRECTION.

     `in_budget_stated` is the opt-out's opt-out. A household that genuinely
     runs its spending through an account it has typed savings writes
     `budget: true` on it and is taken at its word — an absent key is not
     consent, which is why load.js records whether the question was answered
     rather than only what the answer was. */
  /* WHAT COUNTS AS A DECLARATION, and why `type: savings` alone is not one.

     This veto removes a row from the budget entirely — out of `spend`, out of
     `byCat`, and therefore off the per-category Budget table as well as the
     hero. That is a strong response, and it was keyed on the account's TYPE,
     which is a classification of what kind of account it is and not a statement
     about whether its money is spoken for.

     Measured on a household whose only account is a high-interest transactional
     account (a real and ordinary South African product) typed `savings`, with a
     R35 000 salary in and R4 250 of real spending out: `periodSummary().spend`
     read R0, every category row read R0 of its budget, and the hero offered the
     whole R7 000 budget as still available. The budget stopped measuring
     anything, silently, off one frontmatter word — worse than the defect this
     veto was added to fix.

     So the veto now requires the household to have SAID the money is set
     aside, using fields this app already has and already asks for:

       — `emergency_fund` (true, or an amount): the explicit flag.
       — a savings/investment account with a GOAL on it (`goal_amount`,
         `target_date` or `monthly_contribution`). A baby fund has a goal; a
         transactional account does not.

     A bare `type: savings` still earmarks the balance against "actually free"
     (committed.js) — there the deduction is a named, visible term the reader
     can disagree with in one glance — and its outgoings are still LABELLED as
     funded from savings on the hero. What it no longer does is silently delete
     them from the budget. The strength of the response now matches the
     strength of the declaration. */
  const EARMARKED_ACCOUNT_TYPES = new Set(['savings', 'investment']);
  function isEarmarkedAccount(a) {
    if (!a || a.in_budget_stated) return false;
    const ef = a.emergency_fund;
    if (ef === true || (typeof ef === 'number' && ef > 0)) return true;
    if (!EARMARKED_ACCOUNT_TYPES.has(String(a.type || '').trim().toLowerCase())) return false;
    return (a.goal_amount > 0) || !!a.target_date || (a.monthly_contribution > 0);
  }

  /* The category type ONLY where the household stated one. `catType` answers
     "what type does this category behave as", and its `expense` default is
     right for every consumer that buckets a row. It is wrong for the one
     consumer that reads the type as EVIDENCE OF INTENT — savedFromOutside's
     ISSUE 32 rule, which treats a non-internal type as the household saying
     "this was a purchase". A default is not a statement, and null here means
     "they have not said", which that rule already handles by leaving the row
     matchable. */
  function declaredCatType(name) {
    const c = (S.categories || []).find(x => x.name === name);
    return c && c.type_stated ? c.type : null;
  }
  /* ISSUE 43. What the household ACTUALLY moved into its own funds this
     period — the figure the budget could not see.

     On the `BudgetAudit` vault, Emergency and Investing are budgeted R2 000
     each. The funding is a matched pair of rows, `To emergency fund` out of the
     cheque account and `From cheque` into the fund, and BOTH are categorised
     Transfer. summaryInRange skips transfer-typed rows entirely — correctly:
     a transfer is money moving between the reader's own pockets and folding it
     into income or spend would count one rand twice. So the envelopes' actuals
     stayed at R0 and the budget went on reporting R4 000 still to set aside
     after the household had already moved half of it. Not a wrong total: a
     figure that says you have not done the thing you did this morning.

     There is no link from a transfer row to a budget CATEGORY — the cheque leg
     says "Transfer", the envelope says "Emergency", and matching them on the
     description would mean guessing at free text, which this repo refuses to
     do for the reason worth.js's cardOverlap sets out. What CAN be answered
     without guessing is the aggregate: how much arrived in the household's own
     funds from outside them. That is what this returns, and the Dashboard
     states it beside the budgeted figure so the reader compares two totals
     rather than being told a false zero per envelope.

     savedFromOutside() pairs the legs, so a shuffle between two funds is not
     counted as fresh saving — the same reading the score's own saving rate
     takes, from the same function. */
  function movedToFunds(p, todayArg) {
    const { start, end } = periodRange(p);
    const labels = new Map();
    for (const f of Object.values(S.txFiles)) {
      const a = accountForLabel(f.label);
      if (isEarmarkedAccount(a) || (a && EARMARKED_ACCOUNT_TYPES.has(String(a.type || '').trim().toLowerCase()))) {
        labels.set(f.label, a);
      }
    }
    if (!labels.size) return 0;
    /* Injected like periodSummary's, and for the same reason. */
    const today = DATE_KEY.test(todayArg || '') ? todayArg : todayIso();
    /* Windowed the way periodSummary is (ISSUE 35), so "budgeted R4 000,
       moved R2 000" cannot be a comparison against a figure that includes next
       week's standing order.

       A period that has not STARTED yet moves nothing, and returning its whole
       window would read as "you have already set aside R7 000" beside a
       budgeted R4 000 — a forecast wearing the past tense. periodSummary can
       state a future window because it hands back `scheduled` alongside to say
       what the figure is; this is a single number with nowhere to put that
       caveat, so it answers the question it was asked. */
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

  /* THE type of a budget row: the category's live type, and only when no
     category file answers (catType null — no category named, or the file
     gone) the cell the row itself stored.

     One function because there were three readers of a budget row's type and
     the 2026-09-02 audit found them disagreeing: budgetTotals() had just been
     taught to read the live type, while the Budget page's assumed overlay and the
     Dashboard's budgetVsActualRows still read `b.type` — the cell
     serializeBudgetFile writes back verbatim, so it never heals after a
     category is retyped. Measured through the real loader: a category file
     saying `expense, assume_spent: true` whose July row still said `income`
     gave budgetTotals {income: 10 000, spend: 1 200} and assumedSpend 0 —
     two figures on one page from two rules. `??`, not `||`: null is the only
     value that means "no live answer". */
  function budgetRowType(b) {
    return catType(b.category) ?? b.type;
  }

  /* How far a period ended in the hole: what actually went out, less what
     actually came in. Positive means overspent by that much; zero or less means
     the period paid for itself and there is nothing to carry.

     Real transactions only — deliberately NOT including the assume-spent overlay. An
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

  /* ISSUE 35. "What has happened", not "what this calendar month contains".

     On 2026-09-02 the `BudgetAudit` household's Dashboard read Income R40 000
     and Spent R11 590 for September. Inside those figures were a family gift
     dated 28 SEPTEMBER and three gym charges dated the 10th, 17th and 24th —
     money that had not moved, on a card whose every other figure is present
     tense. The arithmetic was right for the question "what does this month's
     ledger add up to"; nobody reading a dashboard on the 2nd is asking that
     one. On the 2nd, the month was already padded with future money and
     future bills, and the reader had no way to see it.

     So the window closes at TODAY whenever the period contains today, and the
     rest of the period is handed back separately as `scheduled` rather than
     dropped — the money is real, it is just not yet spent, and this app does
     not remove a figure without naming it.

     Done HERE rather than in each card, and that is the load-bearing part.
     Every period figure on the Dashboard — the hero, the donut, the budget
     table's actuals — comes through this one function, and
     tests/cross-page-consistency.test.cjs pins an exact identity between
     them. Narrowing the window in the hero alone would have satisfied this
     issue and broken that identity in the same edit, which is how "two
     figures derived by different rules" gets to eight-plus occurrences.

     A FINISHED period is untouched: `end` is already behind today, so the
     clamp is a no-op and `scheduled` comes back empty. A period in the FUTURE
     is untouched for the opposite reason — clamping it to today would empty
     it, so a window that starts after today keeps its own range and reports
     the whole of itself as scheduled, which is exactly what it is. */
  /* `today` INJECTED, defaulting to the clock — CLAUDE.md's rule for this
     codebase is "`today` injected rather than read off the clock", and
     committed.js already honours it (whatsLeft, serviceCommitments and
     debtCommitments all take it as an argument the caller supplies). This
     function read the clock directly when it gained its as-of boundary, which
     left every guard test around that boundary having to monkeypatch the
     GLOBAL Date constructor to say anything at all — a test that fakes the
     clock proves the arithmetic and never the seam, and there was no seam.

     Optional, so every existing caller is unchanged and production still reads
     the real day. What it buys is that the boundary can now be DRIVEN: a test
     names the date as an argument, which is also the only shape in which a
     future caller (a report generated "as at" a stated date, a what-if) can
     ask this question at all. */
  function periodSummary(p, todayArg) {
    const { start, end } = periodRange(p);
    const today = DATE_KEY.test(todayArg || '') ? todayArg : todayIso();
    if (today < start || today >= end) {
      /* Behind us, or entirely ahead of us. Either way there is no "so far"
         boundary inside this window to draw. */
      const whole = summaryInRange(start, end);
      if (today < start) {
        /* ISSUE 73. Entirely ahead of us: NOTHING has happened yet, so the
           headline figures are zero and the whole window is `scheduled`. This
           used to hand back the whole window in BOTH — the hero then printed
           "Income R40 000 · Spent R6 590" and, under it, "R46 590 more is
           dated later this period": the same money twice, one line apart,
           captioned "Up to today" on a period today is not in. A future period
           is a plan, and a plan's figures live in the scheduled half. */
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
  /* ISSUE 40. The two category types that mean "moved, not consumed". One
     copy, read by both halves of the ratio — the budgeted envelopes and the
     actual outgoings — because a set of types that drifted between the two
     would produce exactly the mismatch this issue is about, one level down.
     health-data.js's own `consumption` walk excludes the same pair for the
     same reason, and states it there for a reader who lands only in that
     file. */
  const SET_ASIDE_TYPES = new Set(['savings', 'investment']);

  /* Frozen so every caller that reads `scheduled` off a finished period gets
     the same object shape rather than a fresh literal each render — and so
     nothing downstream can mutate one period's disclosure into another's. */
  const EMPTY_SCHEDULED = Object.freeze({ income: 0, spend: 0, count: 0, from: null });
  /* One day on, as an ISO string. Day arithmetic goes through dates.js's day
     numbering rather than through Date: a `new Date(iso)` here parses as UTC
     while periodRange's own boundaries are built from LOCAL getters, and the
     two disagree by a day either side of midnight in half the world. */
  const nextDay = iso => isoFromDayNum(dayNum(iso) + 1);

  function summaryInRange(start, end) {
    // Excluded rows are the user's per-row veto; the non-budget set is the
    // per-account one. Both drop out of income/spend here and nowhere else —
    // Transactions still lists every row, so nothing goes invisible.
    const skip = nonBudgetLabels();
    const foreignBy = foreignLabels();
    /* ISSUE 41. The fourth veto, and the only one that reads a row's SIGN —
       see earmarkedLabels() for why. Counted on the way past rather than
       silently dropped: `fundedFromSavings` is what the Dashboard names, so a
       R5 000 pram that stopped burning the grocery envelope does not simply
       cease to exist on screen. */
    const earmarked = earmarkedLabels();
    const fundedOut = t => t.amount < 0 && earmarked.has(t.label);
    const fundedFromSavings = { spend: 0, count: 0 };
    for (const t of txInRange(start, end)) {
      if (t.excluded || skip.has(t.label) || foreignBy.has(t.label)) continue;
      if (!fundedOut(t)) continue;
      if (catType(t.cat) === 'transfer') continue;
      fundedFromSavings.spend += -t.amount;
      fundedFromSavings.count++;
    }
    const tx = txInRange(start, end).filter(t =>
      !t.excluded && !skip.has(t.label) && !foreignBy.has(t.label) && !fundedOut(t));
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
    /* ISSUE 40. The part of `spend` that is money the household MOVED rather
       than money it consumed — outgoings under a category the household has
       typed savings or investment.

       Kept INSIDE `spend` rather than taken out of it, so every existing
       consumer, the conservation identity in
       tests/summary-conservation.test.cjs and the donut's own gap note are all
       unchanged. It is a second reading of the same rows, offered to the one
       caller that has to answer "how much is left to SPEND" — a question
       funding your own emergency fund is not an answer to. */
    let setAside = 0;
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
      if (t.amount < 0 && SET_ASIDE_TYPES.has(type)) { setAside += -t.amount; }
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
      setAside, fundedFromSavings,
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
  /* What a period's budget FILE adds up to, bucketed by the category's type as
     it reads TODAY — not by the Type cell the file happens to carry.

     That cell is written on save and never again: there is no re-type UI, so
     correcting a category means editing Categories/<name>.md, and
     serializeBudgetFile writes `r.type` back verbatim, so every row saved under
     the old type stays stale until its own next save. views/budgets.js has read
     the live answer since the stale-type fix (`catType(d.category) ?? d.type`,
     in the totals strip and again for the group bars — see
     tests/budget-stale-type-guard.test.cjs); this function did not, so the two
     disagreed about the same file with no save in between. And this is the one
     the rest of the app believes: the Dashboard hero's remaining line, the
     trend chart's budget line, money-flow's budgetUsed denominator,
     health-data.js's budget pillar in the score, and the Report.

     Measured on the fixture in tests/period-budget-totals-live-type.test.cjs
     (Bonus retyped to income in its category file, its July row still saying
     expense): the Budget page's own tiles read income 15 000 / budgeted 3 000
     while this returned {income: 10 000, spend: 8 000} — so the Dashboard
     printed "R 6 800 remaining", R 5 000 too high, on the very period the
     Budget page had just described correctly.

     `?? `, not `||`, for the reason views/budgets.js gives: catType returns
     null both for "this row names no category" and for "the category has no
     file", and only then may the row's own stored cell stand in. One predicate,
     computed once per row, so income and spend can never bucket the same row
     two different ways — which a pair of independent filters could. */
  /* ISSUE 40. "Budget remaining" was counting envelopes the household never
     meant to spend.

     On the `BudgetAudit` vault, September budgeted R14 500 — Groceries 6 000,
     Gym 1 000, Medical 3 500, and Emergency 2 000 + Investing 2 000. Against
     R11 590 of spending that left R2 910 under a hero reading "Budget
     remaining this period". It was not money left to spend: it was R4 000 of
     unfilled savings envelopes less R1 090 of grocery overspend, and the two
     had cancelled each other into a number that looked like headroom. A
     household reading that figure spends the emergency fund's allocation on
     groceries and the card calls it fine.

     So a budget row typed savings or investment is `setAside`, not `spend`.
     Both are budgeted and both are shown; only one of them answers "how much
     is left to spend".

     `budgetRowType` is the ONE reading of a row's type — the same one
     views/dashboard.js's budgetVsActualRows takes — so the hero, the table and
     the Budget page cannot bucket one row three ways. A category with no file
     falls through to the row's own `type` cell, and a household that has typed
     neither gets exactly what it always got: the row counts as spend, because
     nothing it has written says otherwise. */
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

  /* ADR-0005. "Budget used" for one period, by the one rule in
     money-flow.js's budgetUsedShare(): (spend − setAside + assumed) / budgeted.
     Returns the two operands with the share, because every surface that
     prints the percentage prints the rand figure beside it, and the two must
     be the same reading — the Dashboard hero's "spent", the Budget page's
     "Total spent" tile and the Score ring's per-period numerator are all
     `spent` here. `opts.today` passes through to periodSummary so an as-of
     reading can be driven the way that function's own note describes;
     `opts.rows` lets the Budget page measure its unsaved draft. */
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
    /* The one reading of a budget row's type — views/dashboard.js's
       budgetVsActualRows reads it too, so the table, the hero and the Budget
       page cannot bucket one row three ways. */
    budgetRowType,
  });
};
