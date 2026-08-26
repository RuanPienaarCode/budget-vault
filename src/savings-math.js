'use strict';
/* Where a savings or investment balance actually came from.

   Every provider statement in the world reports the same shape:

     Opening + Contributions + Growth − Withdrawals = Closing

   and the app used to report `balance − total_invested`, calling the result
   growth. Those are only the same number while `total_invested` keeps pace with
   every contribution, and nothing makes it. A monthly debit order moves the
   balance and leaves the baseline where it was, so the difference grows by the
   contribution and is then presented as performance. Measured against four real
   accounts it was wrong on all four — most starkly on a tax-free account where
   contributions outweighed real growth by roughly twenty to one.

   So the split is DERIVED from the account's own transactions rather than
   recorded a second time by hand. A transfer into a fund already exists in the
   vault, dated and named; asking the reader to also type it into a
   `## Contributions` table would create a fourth hand-maintained ledger, and
   hand-maintained ledgers in this app die within three weeks of being created.
   See docs/adr/0003.

   THE CLASSIFICATION RULE (ITEM 2, 2026-08-26 — replaces the rule this
   header used to state, see the note below the table for why):

     outflow                                  → withdrawal
     inflow, category flagged `interest: true` → growth
     inflow, anything else (real, non-transfer) → contribution

   Growth is recognised by a category FLAG, not a category name: "Interest
   income" is one vault's English label, and a rule keyed to that string is
   wrong in every other language and in any vault that named it differently.

   WHY A FLAG AND NOT THE `income` TYPE ANY MORE. The rule used to be simpler
   — any income-typed inflow was growth — and it had exactly one known
   weakness, named in this header since the day it shipped: a salary, a
   client payment or a UIF payment landing DIRECTLY in a savings or
   investment account is ALSO an income-type inflow, and was counted as
   growth when it is really a contribution. `type` alone cannot tell the two
   apart — both are income arriving from outside — so the household now
   says so itself: a category is growth-worthy only once it carries
   `interest: true` in its frontmatter (load.js, the same additive,
   opt-in, defaults-false shape `fixed` already uses — see load.js's own
   comment on that field). Every other real, non-transfer inflow is a
   contribution: money the household put in, by hand or by debit order,
   whatever the category is called or typed, income included.

   `typeOf` here is not the household's raw category type any more — every
   caller must inject `poolCatType` (this module's own export, built once
   from `S.categories` and shared by views/savings.js AND views/accounts.js's
   totalReturn() call) rather than `ctx.catType` directly, or an income-typed
   Interest category answers 'income' again here and silently stops being
   growth. poolCatType folds `type === 'income' && category.interest` down to
   the single string 'interest' this rule checks for; every other type passes
   through unchanged.

   BACKWARD COMPATIBILITY, stated rather than hidden: an existing "Interest"
   category (income-typed, `interest` unset) now reads as an ordinary
   contribution until the household ticks the flag — a visible move (the
   category simply stops appearing under "growth from…" and starts appearing
   as money put in), not a silent one, and `growthCategories` below still
   names whatever DOES feed growth so a miscategorised row is never invisible
   either way. Silent misclassification is the failure this module exists to
   end, so it must not introduce one of its own.

   Contributions deliberately have no category of their own. They wear the
   budget category they came FROM — in one real vault "Baby fund Jan" is
   uncategorised, "Emergency savings Dec" is a savings category, and
   "Sam Jan 26 tax" is a personal one. Any rule keyed to a single
   contribution category would be wrong on real data.

   Excluded rows COUNT. Every transaction in a fund account is typically
   `Excluded: yes` — that keeps the money out of income and spend totals, which
   is right, and has nothing to do with whether it entered the account. Skipping
   them would report every fund as having received nothing, ever.

   A split PARENT is the one row that does not count, and for the same reason
   the rest do: its parts are in this list too, carrying the same money under
   finer categories, so honouring the rule above without this exception counts
   the contribution twice. Skipped by role, not by `excluded` — see
   src/tx-role.js.

   Pure — no DOM, no obsidian import. `typeOf` is injected so this module never
   has to know how categories are stored. */

const { ISO_DATE, todayIso, isRealIsoDate } = require('./dates');
const { supersededBySplit } = require('./tx-role');

/* Builds the `typeOf` classifyRow (and everything downstream of it) actually
   wants: a category's ordinary type, EXCEPT an income-typed category the
   household has flagged `interest: true` reports as the single string
   'interest' instead — the one thing classifyRow now recognises as growth.

   Takes `categories` (S.categories) directly rather than being handed an
   existing `ctx.catType`-style function, so this can be built ONCE, here, and
   shared byte-for-byte by every caller. That sharing is load-bearing, not
   tidiness: views/accounts.js's totalReturn() call feeds the SAME goal-cell
   and drawer growth figure views/savings.js shows for the same account (see
   accounts.js's own comment on that totalReturn() call for the exact bug —
   `balance - total_invested` disagreeing by R60 000 on one real account —
   this repo has already shipped once from two call sites deriving "what this
   account earned" independently). A caller that passes `ctx.catType` straight
   through instead of this wrapper silently reverts to the OLD rule for
   itself alone: every income-typed category, flagged or not, answers
   'income' again, and interest keeps registering as growth on THAT screen
   while the household's own flag is respected everywhere else. */
function poolCatType(categories, name) {
  const c = (categories || []).find(x => x.name === name);
  if (!c) return null;
  return (c.type === 'income' && c.interest) ? 'interest' : c.type;
}

/* THE classification rule, in one place.

   Extracted so splitFlows() and monthlyFlows() below cannot drift: they answer
   different questions — "what does this account total" and "what did it do each
   month" — but a row that is growth to one and a contribution to the other
   would put two irreconcilable figures on the same page. Returns null for a row
   that does not count at all.

   Deliberately does NOT apply the date window: splitFlows filters by date after
   calling this, and the ORDER matters. A split parent excluded here is excluded
   whether or not it falls inside the window, which is what stops a window whose
   edge lands between a parent and its parts from counting the money twice.

   `typeOf` is expected to already be pool-aware — poolCatType() above, not a
   bare category-type lookup — so the ONLY thing that reads as growth here is
   the string 'interest'. Everything else a real, non-transfer inflow answers
   (income included) is a contribution; see this file's own header for why. */
function classifyRow(r, typeOf) {
  if (!r || typeof r.amount !== 'number' || !r.amount) return null;
  if (supersededBySplit(r)) return null;   // its parts are in this same list
  if (r.amount < 0) return 'withdrawal';
  return (typeOf ? typeOf(r.cat) : null) === 'interest' ? 'growth' : 'contribution';
}

/* Split one account's rows. `typeOf(categoryName)` returns the category's type
   or null. Rows are [{ date, amount, cat }] — the shape the loader produces. */
function splitFlows(rows, typeOf, opts) {
  const from = (opts && opts.from) || '';
  const to = (opts && opts.to) || '';
  let contributions = 0, growth = 0, withdrawals = 0, count = 0, first = null;
  const growthCategories = new Map();
  for (const r of rows || []) {
    const kind = classifyRow(r, typeOf);
    if (!kind) continue;
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    count++;
    /* The earliest row that actually COUNTED, reported here rather than
       recomputed by callers — the filtering above (usable amount, split parent,
       window) is the whole reason a caller cannot just take rows[0], and a
       second copy of these four conditions is how the two would drift. */
    if (first === null || r.date < first) first = r.date;
    if (kind === 'withdrawal') { withdrawals += -r.amount; continue; }
    if (kind === 'growth') {
      growth += r.amount;
      const k = r.cat || '(uncategorised)';
      growthCategories.set(k, (growthCategories.get(k) || 0) + r.amount);
    } else {
      contributions += r.amount;
    }
  }
  return {
    contributions, growth, withdrawals, count, first,
    net: contributions + growth - withdrawals,
    growthCategories: [...growthCategories]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amount]) => ({ cat, amount })),
  };
}

/* The account's story end to end.

   `opening` is what the account held before any of these rows — inferred as
   closing less everything that moved, because no file records it. That makes
   the identity hold by construction, which is the point: the figures shown to
   a reader must add up to the balance they can see, or the page is arguing
   with itself.

   `basis` says which figure the growth came from, so the view never presents a
   derived split and a hand-typed one as though they were the same claim:

     'derived'  from the account's own transactions
     'stated'   no transactions — falls back to balance − total_invested, the
                old formula, which is the best available for an account the
                vault holds no history for (a provider-only TFSA, say)
     'none'     neither available */
function accountFlows(account, rows, typeOf, opts) {
  const a = account || {};
  const balance = typeof a.balance === 'number' ? a.balance : 0;
  const has = (rows || []).length > 0;

  if (has) {
    const f = splitFlows(rows, typeOf, opts);
    return {
      basis: 'derived',
      opening: balance - f.net,
      contributions: f.contributions,
      growth: f.growth,
      withdrawals: f.withdrawals,
      closing: balance,
      count: f.count,
      growthCategories: f.growthCategories,
    };
  }

  /* The same two rules totalReturn applies below, in the same order —
     starting_amount first, and a WRITTEN zero is a real baseline. This used
     to read `a.total_invested || a.starting_amount || 0`, which both
     reversed the precedence and falsy-skipped `starting_amount: 0` (an
     account opened empty and funded by transfer fell through to 'none',
     growth 0). Masked today only because the sole consumer prefers
     totalReturn wherever the two would disagree — a new consumer would have
     inherited the bug. fmNum writes null for an absent key and a number for
     a written one, so `typeof` is the "was it written" test. */
  const baseline = typeof a.starting_amount === 'number' ? a.starting_amount
    : typeof a.total_invested === 'number' ? a.total_invested : null;
  if (baseline !== null) {
    return {
      basis: 'stated',
      opening: baseline,
      contributions: 0,
      growth: balance - baseline,
      withdrawals: 0,
      closing: balance,
      count: 0,
      growthCategories: [],
    };
  }
  return {
    basis: 'none', opening: balance, contributions: 0, growth: 0,
    withdrawals: 0, closing: balance, count: 0, growthCategories: [],
  };
}

/* ── total return ─────────────────────────────────────────────────────────
   accountFlows() answers "what did this account RECORD". On a market-linked
   fund the answer is "nothing" — the value moves, the balance is retyped, and
   no row is ever written — so the card it feeds reads "no growth recorded",
   which on the largest holdings on the page is the least useful sentence it
   could print.

   This answers a different question: what is the account WORTH against what
   was put into it. It works backwards from the balance —

     growth = balance − starting_amount − contributions + withdrawals

   — because anything in the balance the household did not put there is, by
   definition, what the account earned. That catches growth no transaction
   records, which is the whole point.

   It buys that with a dependency the derived figure does not have, and the
   dependency is the reason `trust` exists:

     · `starting_amount` must be the balance AT `inception_date`, not a rough
       recollection;
     · the vault must hold the account's transactions FROM that date onward.

   Where the history starts well after inception, contributions are undercounted
   and growth is OVERSTATED — silently, and in the flattering direction. So the
   gap is measured and reported rather than left for the reader to notice. */

const HISTORY_GAP_DAYS = 45;
const MS_PER_DAY = 86400000;
const DAYS_PER_YEAR = 365.2425;   // Gregorian mean, so leap years do not drift the rate

function daysBetween(fromIso, toIso) {
  if (!ISO_DATE.test(fromIso || '') || !ISO_DATE.test(toIso || '')) return null;
  const a = new Date(`${fromIso}T00:00:00`), b = new Date(`${toIso}T00:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/* isRealIsoDate, not ISO_DATE — ISO_DATE is SHAPE-only ("2026-13-45 passes",
   per its own comment in dates.js) and this key feeds a month WALK below that
   rolls 12 to the next year's 01 and stops at the last real month reached. A
   row dated '2025-13-05' — the ordinary day/month-swap typo, the real date
   meant being 2025-05-13 — used to slip past this test, get bucketed under
   the unwalkable key '2025-13' by monthlyFlows, and then never be visited by
   any point on the chart: not in a band, not in `undated`, just gone, and
   `capital + posted + undated = closing` broke under fuzzing on exactly this
   input class (64/4000 vaults) and no other. Falling back to '' here routes
   the row into the existing UNDATABLE/pending path instead, which already
   folds an unplaceable row into the first point — the fix is entirely this
   one gate. */
const monthOf = iso => (isRealIsoDate(iso) ? String(iso).slice(0, 7) : '');

function nextMonth(m) {
  let y = +m.slice(0, 4), mo = +m.slice(5, 7) + 1;
  if (mo > 12) { mo = 1; y++; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/* `basis`:
     'measured'  starting_amount is set — the formula above, growth included
     'stated'    no starting_amount, no transactions: balance − total_invested,
                 the same fallback accountFlows() makes and no stronger a claim
     'none'      nothing to measure the balance against

   `trust`:
     'ok'           the record covers the period
     'history-gap'  the transactions begin well after the account did, so
                    contributions are undercounted and growth overstated
     'none'         basis 'none' — there is no figure to trust or distrust */
function totalReturn(account, rows, typeOf, opts) {
  const a = account || {};
  const today = (opts && opts.today) || todayIso();
  const balance = typeof a.balance === 'number' ? a.balance : 0;

  /* `starting_amount` is the balance AT `inception_date` — so it ALREADY
     contains everything that happened before that date. Summing the rows
     unwindowed added those contributions a second time, and the error runs in
     the UNFLATTERING direction: capital too high, growth too low, a fund that
     earned R200 reporting R0. Nothing disclosed it, because the trust check
     below only fires when history starts LATE.

     Reached by importing an account's full statement history into an account
     whose `inception_date` marks when tracking started rather than when the
     account opened — which is the ordinary way to adopt an existing account.

     `all` stays unwindowed: `f.first` and the gap test have to see the whole
     record to answer "when does the history actually begin". Only the capital
     sums are windowed. */
  const all = splitFlows(rows, typeOf);
  const from = ISO_DATE.test(a.inception_date || '') ? a.inception_date : '';
  const f = from ? splitFlows(rows, typeOf, { from }) : all;

  /* fmNum writes null for an absent key and a number for a written one, so a
     deliberate `starting_amount: 0` — an account opened empty and funded by
     transfer — is a real baseline and must not fall through to 'none'. */
  const hasBaseline = typeof a.starting_amount === 'number';
  /* typeof, not a trailing truthiness test — the exact bug the comment above
     `baseline` in accountFlows() forbids for `starting_amount`, reached here
     via `total_invested` instead: a written `total_invested: 0` is a real
     baseline (an account funded entirely by transfer, nothing invested up
     front by any other name), and the truthy test used to read it as absent.
     accountFlows() already got this right with the bare `typeof` test; this
     one had drifted from it. */
  const stated = !hasBaseline && !f.count && typeof a.total_invested === 'number';

  let basis, baseline, capitalIn, postedGrowth;
  if (hasBaseline) {
    basis = 'measured';
    baseline = a.starting_amount;
    capitalIn = baseline + f.contributions - f.withdrawals;
    postedGrowth = f.growth;
  } else if (stated) {
    basis = 'stated';
    baseline = a.total_invested;
    capitalIn = baseline;
    postedGrowth = 0;
  } else {
    return {
      basis: 'none', trust: 'none', baseline: null, capitalIn: null, growth: null,
      postedGrowth: 0, undatedGrowth: 0, returnPct: null, annualisedPct: null,
      years: null, since: null, gapDays: null, balance,
      contributions: f.contributions, withdrawals: f.withdrawals,
      growthCategories: f.growthCategories, count: f.count,
    };
  }

  const growth = balance - capitalIn;

  /* Growth that no row carries a date for. The chart cannot draw a curve
     through it — see growthSeries — and the card must not imply it arrived
     evenly, so it is reported as its own figure rather than folded in. */
  const undatedGrowth = growth - postedGrowth;

  /* Return ON CAPITAL, and only where capital is positive. An account that has
     had more taken out of it than was ever put in has a negative or zero
     denominator, and a percentage against that is arithmetic noise, not a
     return. */
  const returnPct = capitalIn > 0 ? (growth / capitalIn) * 100 : null;

  const since = ISO_DATE.test(a.inception_date || '') ? a.inception_date : f.first;
  const days = since ? daysBetween(since, today) : null;
  const years = days !== null && days > 0 ? days / DAYS_PER_YEAR : null;

  /* Annualised, and flagged by every caller as approximate — it is NOT
     money-weighted. A contribution made last month is treated as though it had
     been invested since inception, which understates the true annual rate. A
     correct IRR needs a dated cash flow for every contribution, and the whole
     reason this function exists is accounts that date nothing.

     Withheld under a year outright: annualising four months of a fund's noise
     produces a number like "+180% a year" that is arithmetically defensible and
     completely false as a description. */
  const annualisedPct = years !== null && years >= 1 && capitalIn > 0 && balance > 0
    ? (Math.pow(balance / capitalIn, 1 / years) - 1) * 100
    : null;

  /* The gap is measured against the account's OWN opening date, so an account
     with no `inception_date` never reports one — there is nothing to be short
     of. An account that opened long ago and holds no transactions at all is the
     same failure as one whose history starts late, and gets the same flag. */
  let trust = 'ok', gapDays = null;
  if (ISO_DATE.test(a.inception_date || '')) {
    /* Against the UNWINDOWED first row: the question is when the record
       begins, and the window above deliberately hides everything before
       inception, so asking `f` would always answer "on or after inception"
       and the gap could never be seen. */
    const g = daysBetween(a.inception_date, all.first || today);
    if (g !== null && g > HISTORY_GAP_DAYS) { trust = 'history-gap'; gapDays = g; }
    /* The mirror case, which used to pass silently as 'ok'. Rows exist BEFORE
       the stated opening date, so either the date is wrong or the baseline is
       not the balance at it — and both mean the split between capital and
       growth is a guess. Named rather than swallowed; the figure is still
       shown, because it is the best one available.

       Gated on `all.first` being real: the `|| today` fallback above exists so
       an account with NO transactions at all still gets the history-gap flag
       when its inception is old (see the comment on that branch). But this
       branch reads a NEGATIVE gap as "records begin before opening", and with
       no records `g` is manufactured from `today` rather than from a row — a
       future `inception_date` on an account with zero transactions measured
       the distance to today and asserted records exist that do not. */
    else if (all.first !== null && g !== null && g < 0) { trust = 'pre-inception'; gapDays = g; }
  }

  return {
    basis, trust, baseline, capitalIn, growth, postedGrowth, undatedGrowth,
    returnPct, annualisedPct, years, since, gapDays, balance,
    contributions: f.contributions, withdrawals: f.withdrawals,
    growthCategories: f.growthCategories, count: f.count,
  };
}

/* One account's rows folded into monthly buckets, by the SAME rule splitFlows
   uses. `capital` is money the household moved (contributions less
   withdrawals, so a withdrawal month is negative); `posted` is growth the
   account actually wrote down. */
/* A row whose date this cannot place lands under this key rather than being
   dropped. splitFlows counts such a row (it filters on `from`/`to`, not on
   shape), so discarding it here put money in the total that appears nowhere in
   the bands — the identity the chart's whole trustworthiness rests on, broken
   silently and in a direction nobody would think to check. `date` is stored
   verbatim by the loader, so an unparseable one is a hand-edit away. */
const UNDATABLE = '';

function monthlyFlows(rows, typeOf, opts) {
  const from = (opts && opts.from) || '';
  const to = (opts && opts.to) || '';
  const out = new Map();
  for (const r of rows || []) {
    const kind = classifyRow(r, typeOf);
    if (!kind) continue;
    /* The SAME window splitFlows applies, character for character — including
       the raw string comparison, which is the point. totalReturn windows its
       capital sum from `inception_date`; if the month buckets did not window
       identically, a row one side of that line would be counted by one and not
       the other, and the chart would disagree with the tiles above it by
       exactly that row. Which it did: windowing the sum without windowing the
       buckets was how a non-ISO date cell put R200 in the bands that the total
       had already accounted for as undated growth. */
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    const m = monthOf(r.date);          // '' when the date is not a real ISO date
    if (!out.has(m)) out.set(m, { capital: 0, posted: 0 });
    const b = out.get(m);
    if (kind === 'growth') b.posted += r.amount;
    else b.capital += r.amount;          // withdrawals are already negative
  }
  return out;
}

/* ── what built the balance, month by month ───────────────────────────────
   `entries` is [{ account, rows }] for the accounts the page is showing.

   WHAT THIS DELIBERATELY DOES NOT DO: draw a growth curve. Growth that no
   transaction records has no date — a fund's value moved every day for four
   years and the vault holds one number, today's. Spreading that across the
   months to make a smooth line would be inventing the very measurements this
   module exists because nobody took. So the series carries only what is dated,
   and the undated remainder is returned separately for the view to show at the
   right-hand edge, labelled as undated.

   The identity that makes the card trustworthy:

     closing = capital + posted + undated = Σ balances of included accounts

   so the chart cannot disagree with the tiles beneath it. That is what forces
   the exclusion below: an account whose growth cannot be measured would put its
   contributions in the bar and its growth nowhere, and the identity would fail
   quietly. It is left out and COUNTED, never silently dropped. */
/* Whether growthSeries below would actually draw this account into the
   chart's totals: 'measured' basis (starting_amount set — 'stated' accounts
   have no transactions at all and would draw a flat step from a date nobody
   wrote down) AND a month it can be placed at, from inception_date or the
   first row totalReturn counted.

   Exported so the Growth tile (views/savings.js) counts the SAME set the
   chart draws. It used to count anything `basis !== 'none'`, which included
   'stated' accounts the chart has always excluded — a vault could read
   "measured 2, unmeasured 0" in the tile and "1 of 2 accounts measurable" in
   the chart's own subtitle, on the same screen, about the same two
   accounts. */
function chartable(account, r) {
  const at = monthOf((account || {}).inception_date) || monthOf(r.since);
  return r.basis === 'measured' && !!at;
}

function growthSeries(entries, typeOf, opts) {
  const today = (opts && opts.today) || todayIso();
  const maxMonths = (opts && opts.maxMonths) || 60;

  const deltas = new Map();
  let firstMonth = '', undated = 0, included = 0, excluded = 0, closing = 0;

  /* Money that counts toward the total but carries no placeable date. Held
     here and folded into the first point once that point is known — the same
     treatment truncation already gives the months it drops, and for the same
     reason: the curve starting partway up is honest, money missing from it is
     not. Dropping these was one of the two ways the identity could fail. */
  const pending = { capital: 0, posted: 0 };

  const bump = (m, key, amt) => {
    if (!amt) return;
    if (!m) { pending[key] += amt; return; }
    if (!deltas.has(m)) deltas.set(m, { capital: 0, posted: 0 });
    deltas.get(m)[key] += amt;
    if (!firstMonth || m < firstMonth) firstMonth = m;
  };

  for (const e of entries || []) {
    const a = (e && e.account) || {};
    const rows = (e && e.rows) || [];
    const r = totalReturn(a, rows, typeOf, { today });
    /* 'stated' accounts are excluded too: they have no transactions at all, so
       every figure they carry is undated and they would contribute a flat step
       from a date nobody wrote down. */
    /* The opening capital sits AT the opening date. Where there is no
       inception_date it sits at the first month the account did anything,
       which is the earliest point the vault can honestly place it. */
    const at = monthOf(a.inception_date) || monthOf(r.since);
    /* …and where it can be placed NOWHERE — no opening date, and no
       transaction to borrow a date from — the account is not chartable, so it
       is excluded rather than half-included. It used to be counted into
       `closing` while its baseline went nowhere, which is how a fund with
       R60 000 of opening capital printed a R95 000 total over bands that
       topped out at R35 000 and called the difference "growth carrying no
       date". Exactly the market-linked holding this whole feature exists for:
       `inception_date` is optional and nothing cross-validates it against
       `starting_amount`, so filling one and not the other is one keystroke.

       The guard used to read `r.baseline && !at` — testing the BASELINE for
       truthiness rather than testing `at` alone. A 'measured' account always
       has `r.baseline !== null` (that is what 'measured' means), but a
       deliberate `starting_amount: 0` — the same real baseline
       accountFlows() defends a few screens up — made `r.baseline` falsy, so
       an unplaceable zero-baseline account skipped this exclusion and was
       counted INCLUDED while contributing nothing to `closing` or `undated`:
       `closing = Σ balances of included` broke for exactly this account. A
       'measured' account's baseline is never null, so testing `at` alone is
       both simpler and correct. */
    if (!chartable(a, r)) { excluded++; continue; }
    included++;
    closing += r.balance;
    bump(at, 'capital', r.baseline);
    /* Windowed exactly as totalReturn windows its capital sum — see the note
       in monthlyFlows. The baseline already contains everything before the
       opening date, so counting those rows again in the bands would draw money
       the total does not have. */
    const from = ISO_DATE.test(a.inception_date || '') ? a.inception_date : '';
    for (const [m, b] of monthlyFlows(rows, typeOf, from ? { from } : undefined)) {
      bump(m, 'capital', b.capital);
      bump(m, 'posted', b.posted);
    }
    undated += r.undatedGrowth;
  }

  if (!firstMonth) {
    return { points: [], undated: 0, closing: 0, included, excluded, truncatedFrom: '' };
  }

  /* Everything that could not be dated joins the first point. */
  if (pending.capital || pending.posted) {
    const d = deltas.get(firstMonth);
    d.capital += pending.capital;
    d.posted += pending.posted;
  }

  /* The walk has to reach the LAST month anything happens in, not merely
     today. A row dated next month is counted by splitFlows and bucketed by
     monthlyFlows, but a walk that stopped at today never accumulated it into
     any point — the second way the identity could fail. Future dates are not
     hypothetical: a scheduled transfer captured in advance, or a typo in the
     year, and the loader stores `date` verbatim. */
  let lastMonth = monthOf(today) || firstMonth;
  for (const m of deltas.keys()) if (m > lastMonth) lastMonth = m;
  const months = [];
  for (let m = firstMonth; m <= lastMonth; m = nextMonth(m)) months.push(m);
  if (!months.length) months.push(firstMonth);

  /* Truncation folds the dropped months' totals INTO the first point kept,
     rather than discarding them — the curve then starts partway up, which is
     honest, instead of starting at zero and understating everything after it.
     The month it starts from is returned so the caller can say so. */
  let truncatedFrom = '';
  let kept = months;
  if (months.length > maxMonths) {
    truncatedFrom = months[months.length - maxMonths];
    kept = months.slice(-maxMonths);
  }

  let capital = 0, posted = 0;
  const points = [];
  for (const m of months) {
    const d = deltas.get(m);
    if (d) { capital += d.capital; posted += d.posted; }
    if (m >= kept[0]) points.push({ month: m, capital, posted });
  }

  return { points, undated, closing, included, excluded, truncatedFrom };
}


/* WHAT CROSSED INTO THE SAVINGS POOL FROM OUTSIDE IT, for one period.

   Lives here, and is called from BOTH health-data.js (which averages it over
   six periods for the score's savings rate) and views/score.js (which shows
   this period's figure on the "Where the money went" card), because the two
   used to answer "how much did you save" differently on one screen. The card
   read splitFlows' gross contributions and reported R4 270 for a period in
   which R4 270 had simply moved from a baby fund into an emergency fund; the
   score, applying the rule below, said R0. Same money, same screen, same day.

   `saverLabels` maps a transaction label to the pool account it belongs to,
   so a caller decides what counts as the pool and this decides what crossed
   into it.
*/
function savedFromOutside(rows, saverLabels) {
  let savings = 0;
  const labels = saverLabels instanceof Map ? saverLabels : new Map(saverLabels || []);
  const householdRows = rows || [];
const inflows = [], outflows = [];
{
  for (const r of householdRows) {
    if (!r || typeof r.amount !== 'number' || !r.amount) { continue; }
    if (supersededBySplit(r)) { continue; }   // its parts are in this same list
    const a = labels.get(r.label);
    if (!a) { continue; }                     // not a savings or investment account
    /* NOTHING IS SKIPPED HERE ON THE STRENGTH OF THE ROW'S OWN FLAGS,
       and the reason is worth writing down because two releases got it
       wrong in opposite directions.

       The old rule paired the legs of a movement household-wide and
       dropped both, to stop a R40 000 UIF payment counting as saving
       "while the same rand is not counted as income". That premise was
       never true. `income` further down is built from householdNet,
       which filters transfer-typed rows and paired pass-throughs and
       NOTHING ELSE — it does not look at `excluded` at all. Measured on
       the vault the rule was written for, August income reads R91 627
       against R44 850-R57 984 in every other month: the UIF is in the
       base, and always was.

       So the honest reading is the plain one. The household received
       R40 000 and put it in a fund. Income counts it once, saving counts
       it once, and the rate that month is 100% because that is what
       happened. Dropping the savings leg while income kept it was the
       inconsistency, not the cure for one.

       A replacement rule — skip anything income-typed AND excluded —
       was written, tested and reverted for the same reason: it moved the
       error from one side of the ratio to the other, and would have
       taken R1 402 of interest credited into savings accounts out of the
       numerator while income went on counting it.

       What remains is the pool boundary alone, tested just below: money
       is saved if it arrived from outside the pool, and merely moved if
       its matching leg left another account inside it. */
    (r.amount > 0 ? inflows : outflows).push({ acct: a, row: r });
  }
}
const spent = new Set();
for (const { acct, row } of inflows) {
  /* MONEY THAT CROSSED INTO THE SAVINGS POOL FROM OUTSIDE IT. Not gross
     inflow, and not net-of-everything — both of those shipped, and both
     were wrong in opposite directions.

     Gross contributions (to 1.23.0) counted a rand moved from one
     savings account to another as fresh saving in the receiving account,
     with nothing taken off the sending one. On a real vault that
     overstated the rate by R1 250 a month.

     Netting ALL outflows (1.23.1) fixed that and broke something worse:
     it treated a sinking fund doing its job as dis-saving. A household
     that had been paying into a Baby Fund and a Car Fund for months, and
     then bought the pram and serviced the car, was told it was saving
     NOTHING — R12 022 a month of "Subaru maintenance", "Private room &
     pram" and "Baby carrier" came straight off a real R12 224 a month of
     saving and drove the whole pillar to zero. Spending a fund you built
     on purpose is the fund working, not a failure to save; the STOCK
     going down is a different statement from the RATE going negative,
     and the Savings page already tells that first story properly.

     So: count what arrives from outside the pool, and ignore movement
     WITHIN it in both directions. The vault distinguishes them cleanly
     without guessing — an internal transfer carries a savings- or
     investment-typed category (the receiving vehicle's own name), while
     spending a fund carries a real expense category. Both legs of an
     internal move are skipped, so a transfer can neither inflate the
     rate on the way in nor deflate it on the way out.

     Read off the rows directly rather than through splitFlows' buckets:
     classifyRow sorts a positive row into `growth` purely because its
     category is income-typed, which is right for the Savings page's
     growth chart and wrong here — a salary or a UIF reimbursement paid
     into a savings account is exactly the household putting money aside.
     supersededBySplit is the same split-parent guard splitFlows applies,
     imported from the same module so the two cannot drift.

     KNOWN LIMIT, stated rather than hidden: money paid in and spent
     straight back out within the window still counts in full, because
     nothing in the data separates "spending what I just put in" from
     "drawing on a fund I built last year" — both are an expense-typed
     row leaving a savings account. This is the conventional reading of a
     savings RATE (what share of income was set aside) and it is the one
     that does not punish a sinking fund, which is the shape real
     households actually use. The other story — the balance itself going
     down — is not lost: the Savings page's growth chart and its
     per-account "in / out" lines tell it directly, and tell it better
     than a single ratio could. */
  /* THE OTHER LEG is the only honest signal for an internal move, and
     deliberately the ONLY test applied here.

     A first attempt also skipped any inflow whose CATEGORY was
     savings-typed, reasoning that such a category names the vehicle the
     money came out of. On one real vault it did. In general it does not,
     and a guard fixture caught it: a household moving R10 000 a month
     from its CHEQUE account into Investments categorises that
     `Investing` — a savings-typed category naming the DESTINATION, which
     is the ordinary way people label it. That is new saving from outside
     the pool, and the category rule silently threw it away, taking a
     genuinely strong vault out of its band.

     So the pairing does the work instead: an equal and opposite row, in
     a DIFFERENT savings account, within a few days. Matched legs cancel
     and neither counts; each outflow can only cancel one inflow, so two
     genuine deposits are never swallowed by one withdrawal. A
     sinking-fund purchase has no such counterpart — the money went to a
     shop, not to another account of yours — so it never matches and
     never reduces the rate. And money arriving from a cheque account has
     no counterpart in the pool either, so it counts, whatever it is
     called. */
  const j = outflows.findIndex((o, i) => !spent.has(i)
    && o.acct !== acct
    && Math.abs(-o.row.amount - row.amount) < 0.005);
  if (j !== -1) { spent.add(j); continue; }

  savings += row.amount;
}
  return savings;
}

module.exports = { splitFlows, savedFromOutside, accountFlows, totalReturn, growthSeries, classifyRow, chartable, poolCatType };
