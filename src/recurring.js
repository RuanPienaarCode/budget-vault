'use strict';
/* Matching a listed subscription to the charges actually hitting the account.

   The Services page is a hand-typed list of what the reader BELIEVES they pay.
   The vault holds what was really charged. Nothing compared the two, so the
   page drifted: on the vault this was built against, four of six listed
   services disagreed with the statements — a fibre line listed R80 below its
   real price, a subscription that had quietly risen 19%, and one still marked
   active whose last charge under that name was five months earlier.

   Pure — no DOM, no obsidian import — so tests/recurring.test.cjs drives it in
   bare node, and `today` is injected rather than read off the clock.

   MATCHING IS BY MERCHANT TOKEN, AND REFUSES RATHER THAN GUESSES.

   The tempting rule is "same budget category", and it is wrong: on a real vault
   a phone contract and a cloud-storage subscription share one category, so
   category alone silently attributes one service's charges to the other. Tokens
   from the provider and service name are specific enough to tell them apart,
   and when nothing matches this returns nothing — "no charges found" is a
   useful, honest answer, and far better than confidently pairing a service with
   another company's debit order. */

const { ISO_DATE, isoDayNumber, isoFromDayNumber, isRealIsoDate } = require('./dates');

/* Words that appear in so many service names they cannot identify a merchant. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'plan', 'plus', 'pro', 'premium', 'couple', 'family',
  'monthly', 'annual', 'yearly', 'subscription', 'account', 'service', 'services',
  'fee', 'fees', 'payment', 'debit', 'order', 'card', 'bank', 'insurance', 'data',
]);

/* Lowercase, strip digits and punctuation, collapse whitespace. Digits go
   because a bank suffixes its own reference to the merchant name
   ("FIBRE CO123456789") and those change; the letters do not. */
function normDesc(s) {
  return String(s || '').toLowerCase().replace(/\d+/g, ' ')
    .replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* The words that identify this service's merchant. Provider first — it is the
   name the bank prints — then the service name. */
function serviceTokens(service) {
  const s = service || {};
  const words = normDesc(`${s.provider || ''} ${s.name || ''}`).split(' ');
  return [...new Set(words.filter(w => w.length >= 4 && !STOP.has(w)))];
}

const median = arr => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/* Statistics over one merchant's charges. Amounts are positive magnitudes. */
function chargeStats(charges) {
  if (!charges || !charges.length) return null;
  /* ISSUE 75. Only rows whose date names a real day can ORDER this list, and
     `last` is what the whole cadence is anchored on.

     A single typo'd row poisoned it, because a string sort puts a bad date
     LAST: one `2026-13-05` among four clean charges made `last` "2026-13-05",
     nextExpected returned "2026-14-05", and chargeStatus reported daysSince
     -125 while still calling the service active. `"end of June"` produced
     "NaN-NaN-NaN". views/services.js then offered that as a one-tap correction
     to `Services.md` — gated only on `c.next !== s.next`, with no shape check
     — so the app was ready to WRITE a date that does not exist into the
     household's own file.

     `2026-13-05` and "end of June" are the exact shapes src/reconcile.js
     documents as ordinary and reachable, and load.js applies no date
     validation to transaction rows.

     Amounts are untouched: an undatable charge still happened and still counts
     toward the price. It just cannot say WHEN, so it does not get to. */
  const datable = charges.filter(c => isRealIsoDate(c.date));
  const sorted = [...(datable.length ? datable : [])].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) {
    /* Every charge undatable: there is a price but no cadence. `last` absent
       is the signal nextExpected and chargeStatus already handle. */
    const amts = charges.map(c => Math.abs(c.amount));
    const recent3 = amts.slice(-3);
    const med = median(recent3);
    return { count: charges.length, months: 0, median: median(amts), recent: med,
      varies: med ? (Math.max(...recent3) - Math.min(...recent3)) / med > 0.15 : false,
      first: '', last: '', day: 0, drift: null, undatable: charges.length };
  }
  /* Amounts come from EVERY charge; only the dates are narrowed. */
  const amounts = charges.map(c => Math.abs(c.amount));
  const months = [...new Set(sorted.map(c => c.date.slice(0, 7)))];
  const days = sorted.map(c => Number(c.date.slice(8, 10)));

  /* Drift compares the median of the first few charges against the median of
     the last few, not first against last: a single odd month — a pro-rata
     first bill, a double charge — would otherwise read as a permanent price
     change. Needs enough history on both sides to mean anything. */
  const W = Math.min(6, Math.floor(sorted.length / 2));
  const early = W >= 2 ? median(amounts.slice(0, W)) : null;
  const late = W >= 2 ? median(amounts.slice(-W)) : null;

  /* The CURRENT price is the median of the last three charges, not the median
     of all of them. A subscription that has been running for four years has an
     all-time median from two price rises ago: on the vault this was built
     against, a gym listed at its correct current price looked 97% wrong against
     a four-year median, and a subscription listed at its correct new price
     looked 11% wrong. Comparing a reader's figure against a historical average
     and calling the difference an error is worse than not comparing at all.

     Three, not one: a single charge can be a double-bill or a pro-rata. */
  const recentAmounts = amounts.slice(-3);
  const recent = median(recentAmounts);

  /* Do the recent charges even agree with each other? Two cases produce a
     merchant whose amount is genuinely not a price: prepaid top-ups of whatever
     the reader felt like buying, and a biller that puts the amount INSIDE the
     description — "APPLE.COM/BILL 44.99 ZAR" and "APPLE.COM/BILL 199.99 ZAR"
     normalise to the same merchant, so two unrelated subscriptions land in one
     group. Neither can be untangled from the data, but both can be DECLARED,
     and a page that says "varies" is honest where one asserting a price is not. */
  const spread = recent ? (Math.max(...recentAmounts) - Math.min(...recentAmounts)) / recent : 0;

  return {
    /* ISSUE 75. Every charge, not just the datable ones — an undatable row is
       a charge that happened, and dropping it from the count would understate
       a merchant's history because one date was mistyped. `undatable` says how
       many could not be PLACED, which is a different question and the one a
       caller needs when the cadence looks thin. */
    count: charges.length,
    undatable: charges.length - sorted.length,
    months: months.length,
    median: median(amounts),
    recent,
    varies: spread > 0.15,
    first: sorted[0].date,
    last: sorted[sorted.length - 1].date,
    lastAmount: Math.abs(sorted[sorted.length - 1].amount),
    /* Rounded, unlike every other median here. This one is a DAY OF THE MONTH,
       and on an even number of charges the plain median averages the two middle
       values — so charges on the 10th and the 21st reported day 15.5, which the
       Services tooltip rendered verbatim as "Billed around day 15.5". The amount
       medians must stay unrounded; a date cannot be half a day. */
    day: Math.round(median(days)),
    early, late,
    drift: (early && late) ? (late - early) / early : null,
  };
}

/* Charges belonging to a service, plus any OTHER merchant the tokens also hit.

   Rows matching the tokens are grouped by normalised description and the group
   with the largest total spend wins. That matters on real data: "Spotify" hits
   both the subscription and the bank's international-payment fee on it, and
   without this the reported price is an average of a R95 charge and a R2 one.
   The loser is not discarded — it is a real recurring cost of the same service,
   and worth telling the reader about. */
function matchCharges(service, rows, tokens) {
  const toks = tokens || serviceTokens(service);
  if (!toks.length) return { charges: [], related: [], tokens: toks };

  const groups = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.amount !== 'number' || r.amount >= 0) continue;   // outflows only
    const n = normDesc(r.desc);
    if (!n) continue;
    if (!toks.some(t => n.includes(t))) continue;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(r);
  }
  if (!groups.size) return { charges: [], related: [], tokens: toks };

  const scored = [...groups].map(([key, list]) => ({
    key, list, total: list.reduce((s, r) => s + Math.abs(r.amount), 0),
  })).sort((a, b) => b.total - a.total);

  return {
    charges: scored[0].list,
    related: scored.slice(1).map(g => ({ key: g.key, count: g.list.length, total: g.total })),
    /* Every row the tokens hit, in date order. Price comes from the dominant
       group above; "is this still being charged" must come from ALL of them.
       A merchant that renames its debit order — one real vault has eight
       distinct Vodacom descriptions — would otherwise be reported as cancelled
       while it is still taking money every month. */
    all: [...groups.values()].flat().sort((a, b) => a.date.localeCompare(b.date)),
    tokens: toks,
  };
}


/* When the next charge is due, predicted from the last one and the cycle.
   Beats the hand-typed field it replaces, every value of which was months in
   the past on the vault this was built against — a date nobody updates is not
   a prediction, it is a fossil. */
/* ISSUE 33. Sub-monthly cadences step in DAYS, through dates.js's day
   numbering rather than through Date: a `new Date(iso)` parses as UTC while
   every period boundary in this app is built from local getters, and the two
   disagree by a day either side of midnight in half the world. */
const STEP_DAYS = { weekly: 7, fortnightly: 14 };
function nextExpected(stats, cycle) {
  /* ISSUE 75. A shape check, not just a presence check. Everything below does
     string arithmetic on `last` and hands the result to a view that offers to
     write it into the user's file; "NaN-NaN-NaN" must never get that far. */
  if (!stats || !stats.last || !ISO_DATE.test(stats.last)) return null;
  const step = STEP_DAYS[cycle];
  if (step) { return isoFromDayNumber(isoDayNumber(stats.last) + step); }
  if (cycle === 'annual') {
    // Same clamp as the monthly branch below: "+1 year, same month/day" WOULD
    // land on 2029-02-29 for a service last charged 2028-02-29, a date that
    // does not exist — which is why the clamp is here. It returns 2029-02-28.
    const [y, m, d] = stats.last.split('-').map(Number);
    const ny = y + 1;
    const lastDay = new Date(Date.UTC(ny, m, 0)).getUTCDate();
    return `${ny}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
  }
  // Monthly: same day next month, clamped to a short month's last day so
  // "the 31st" does not roll into the month after.
  const [y, m, d] = stats.last.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/* Has this service stopped being charged?

   Deliberately generous — two full cycles of silence before it is worth
   mentioning, because a bank can post a charge late and an annual subscription
   is silent for eleven months by design. The wording it drives should be a
   question, never an assertion: this cannot know about a cancellation, only
   about an absence.

     'unseen'   the tokens matched nothing at all
     'active'   charged within the expected window
     'overdue'  nothing for more than two cycles */
function chargeStatus(stats, cycle, today) {
  if (!stats) return { state: 'unseen', daysSince: null };
  if (!ISO_DATE.test(today || '') || !ISO_DATE.test(stats.last || '')) {
    /* ISSUE 75. An unanchorable history is not a healthy one — it is one
       nothing can measure, and reporting `active` with a NaN age was how a
       weekly service silent for weeks read as fine. */
    return { state: 'active', daysSince: null };
  }
  const gap = isoDayNumber(today) - isoDayNumber(stats.last);
  /* ISSUE 33 follow-up. This read `cycle === 'annual' ? 365 : 31` — written
     when `monthly` and `annual` were the only two cycles that existed, and
     left behind when weekly and fortnightly arrived. So a weekly gym silent
     for forty days — six missed charges — reported "active", because forty is
     less than two 31-day cycles. The doc above says "two full cycles"; this
     now measures the cycle the household actually stated, off the same
     STEP_DAYS table nextExpected steps by, so the two cannot disagree about
     how long a fortnight is. */
  const cycleDays = cycle === 'annual' ? 365 : (STEP_DAYS[cycle] || 31);
  return { state: gap > cycleDays * 2 ? 'overdue' : 'active', daysSince: gap };
}

/* What the service SAYS against what the statements show. `null` where there is
   nothing to compare, so a caller never renders a difference it cannot support. */
function comparePrice(service, stats) {
  const stated = Math.abs(Number((service || {}).amount) || 0);
  if (!stats || !stated) return null;
  // A merchant whose recent charges disagree with each other has no price to
  // compare against, so none is claimed.
  if (stats.varies) return { stated, actual: null, varies: true, diff: null, pct: null, agrees: null };
  const actual = stats.recent;
  const diff = actual - stated;
  return {
    stated, actual, diff, varies: false,
    pct: stated ? diff / stated : null,
    /* 4%, not 2%: a subscription billed in another currency moves a little
       every month with the exchange rate, and flagging that as the reader's
       error each time would train them to ignore the flag entirely. Wide enough
       to absorb a currency wobble, narrow enough that a real price change —
       a fibre line R40 above its listed figure — still shows. */
    agrees: Math.abs(diff) <= Math.max(2, stated * 0.04),
  };
}

/* ------------------------- repeating INCOME ----------------------------- */

/* The salary, found the same way a subscription is — and refusing on the same
   terms.

   Everything above matches a charge the reader has ALREADY LISTED. This has
   nothing to match against: no vault names its income, so the pattern has to be
   discovered in the rows themselves. That makes the refusal rule matter more,
   not less.

   IT MUST NEVER RETURN AN AVERAGE. A four-month mean of everything landing in
   one real account came to R61 000 against a true salary of R40 240 — it had
   quietly folded in a second earner who stopped in February, a R40 000 payment
   that arrived on the 6th and left again on the 7th, and two insurance claims.
   Every one of those inflates a mean and not one of them is coming again. A
   figure the reader can check against their own payslip earns trust; a mean
   they cannot reproduce is the Services page all over again.

   So the bar is deliberately high, and `null` is a perfectly good answer:

     - THREE occurrences at least. Two is a coincidence with a witness.
     - A MONTHLY rhythm. Median gap 26-35 days, which absorbs weekends and the
       difference between February and July without admitting a quarterly bonus.
     - A STABLE amount. The last three within 15% of each other, the same test
       `varies` applies to a price. A salary that swings is not predictable, and
       a card that says "about R40 000, give or take twelve" helps nobody.
     - NOT excluded. An excluded row is vetoed from income by the reader's own
       hand, which is exactly how transfers between their own accounts and that
       UIF pass-through get out of the way.

   Descriptions are normalised, which is what separates a real salary from a
   dated one: "CASHFOCUS SALARIS" repeats verbatim and groups, while "SALARY SEP
   2025" / "SALARY OCT 2025" lose their digits and still differ by month name,
   so they never reach three and are never claimed.

   Returns { desc, amount, day, last, next, count } or null. */
const CREDIT_MIN_COUNT = 3;
const CREDIT_GAP_MIN = 26, CREDIT_GAP_MAX = 35;
const CREDIT_SPREAD = 0.15;

function findRecurringCredit(rows, today) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.amount !== 'number' || r.amount <= 0) continue;   // inflows only
    if (r.excluded) continue;                                            // the reader's own veto
    if (!ISO_DATE.test(r.date || '')) continue;
    const n = normDesc(r.desc);
    if (!n) continue;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(r);
  }

  let best = null;
  for (const [desc, list] of groups) {
    if (list.length < CREDIT_MIN_COUNT) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));

    // Monthly rhythm, measured on the median gap so one late payment cannot
    // disqualify a year of regular ones.
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(isoDayNumber(sorted[i].date) - isoDayNumber(sorted[i - 1].date));
    const gap = median(gaps);
    if (gap < CREDIT_GAP_MIN || gap > CREDIT_GAP_MAX) continue;

    // A stable amount, judged on the RECENT three — a raise last year must not
    // disqualify a salary that has been steady since.
    const recent = sorted.slice(-3).map(r => r.amount);
    const amount = median(recent);
    if (!(amount > 0)) continue;
    if ((Math.max(...recent) - Math.min(...recent)) / amount > CREDIT_SPREAD) continue;

    const last = sorted[sorted.length - 1].date;
    const cand = {
      desc, amount, count: sorted.length, last,
      day: Math.round(median(sorted.map(r => Number(r.date.slice(8, 10))))),
      next: nextExpected({ last }, 'monthly'),
    };
    // The largest repeating credit wins: a household with a salary and a small
    // regular transfer wants the salary named, not the transfer.
    if (!best || cand.amount > best.amount) best = cand;
  }
  if (!best) return null;

  /* A salary that stopped is not a salary that is coming. Two whole cycles of
     silence is the same generosity chargeStatus extends to a subscription, and
     for the same reason: a bank can post late, and this must not go quiet on a
     payment that is merely a few days behind. */
  if (ISO_DATE.test(today || '') && isoDayNumber(today) - isoDayNumber(best.last) > 62) return null;
  return best;
}

module.exports = {
  normDesc, serviceTokens, matchCharges, chargeStats, nextExpected, chargeStatus, comparePrice,
  /* ISSUE 33/47. Exported so committed.js walks the SAME cadence table
     nextExpected steps by — a second copy of "how long is a fortnight" is
     precisely the shape this repo keeps finding. */
  STEP_DAYS,
  findRecurringCredit,
};
