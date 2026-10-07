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
  /* Two amount lists, because two different questions are being asked of them.

     `amounts` is EVERY charge in the order the caller handed them over. That is
     all the all-time median needs — where a charge sits in the list cannot move
     a median — and an undatable row is still money that left the account, so it
     belongs in the price even though it cannot be placed in the history.

     `orderedAmounts` is the datable charges IN DATE ORDER, and every SLICE below
     — early, late, the last three — must come from it. Rows reach this function
     account-major, one transaction file at a time (`Object.values(S.txFiles)` in
     views/services.js, the whole-vault list in committed.js), so a merchant
     billed from two accounts interleaves and the caller's order is not the
     merchant's history. On the vault this was built against, a subscription that
     rose from R699 to R899 when it moved onto the newer card had the R899 rows
     FIRST: slicing `amounts` read R699 off the tail and called it the current
     price, so a correctly-listed R899 was reported R200 too high, a +29% rise
     printed as a -22% fall, and committed.js carried the service R200 light —
     which inflates "actually free" on the Dashboard hero. `lastAmount` below,
     which already read from `sorted`, printed R899 on that same card, so the two
     figures on one row disagreed with each other.

     It also keeps the window honest: W is measured off `sorted.length`, so
     slicing anything longer than `sorted` reached past the charges W counted. */
  const amounts = charges.map(c => Math.abs(c.amount));
  const orderedAmounts = sorted.map(c => Math.abs(c.amount));
  const months = [...new Set(sorted.map(c => c.date.slice(0, 7)))];
  const days = sorted.map(c => Number(c.date.slice(8, 10)));

  /* Drift compares the median of the first few charges against the median of
     the last few, not first against last: a single odd month — a pro-rata
     first bill, a double charge — would otherwise read as a permanent price
     change. Needs enough history on both sides to mean anything. */
  const W = Math.min(6, Math.floor(sorted.length / 2));
  const early = W >= 2 ? median(orderedAmounts.slice(0, W)) : null;
  const late = W >= 2 ? median(orderedAmounts.slice(-W)) : null;

  /* The CURRENT price is the median of the last three charges, not the median
     of all of them. A subscription that has been running for four years has an
     all-time median from two price rises ago: on the vault this was built
     against, a gym listed at its correct current price looked 97% wrong against
     a four-year median, and a subscription listed at its correct new price
     looked 11% wrong. Comparing a reader's figure against a historical average
     and calling the difference an error is worse than not comparing at all.

     Three, not one: a single charge can be a double-bill or a pro-rata. */
  const recentAmounts = orderedAmounts.slice(-3);
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

/* The group of charges that says what the service costs TODAY.

   `matchCharges` names the dominant description by lifetime total, and that is
   right for telling a subscription from the bank's fee on it. It is wrong for
   the AMOUNT once the merchant has renamed its debit order: on the vault this
   was audited against, a phone contract printed "last charged" at the price of
   an old description whose final charge was months back, while the current
   debit order was higher, and a hosting subscription printed the old group's
   price while its latest charge, which had landed under a variant of the
   description, was different. "Still committed" came out light.

   So a group that has been charged MORE RECENTLY than the dominant one takes
   over, provided its charges are the same KIND of charge: within a factor of
   two of the dominant group's usual amount. The band is what keeps the
   Spotify fee (R2 against R95, posted the same day or the day after) from
   taking the price over — that is a rider on the service, not the service —
   while still admitting a real price rise. A renamed order whose amount moved
   by more than that is left with the dominant group, exactly as before: there
   is no way to tell it from a different charge, and "no answer" beats a guess.

   Ties on the most recent date go to the larger lifetime total, so the
   dominant group is only ever displaced by strictly newer evidence. */
const CURRENT_BAND = 2;
function lastDateOf(list) {
  let last = '';
  for (const r of list) if (isRealIsoDate(r.date) && r.date > last) last = r.date;
  return last;
}
function typicalOf(list) {
  const dated = list.filter(r => isRealIsoDate(r.date)).sort((a, b) => a.date.localeCompare(b.date));
  return median((dated.length ? dated : list).slice(-3).map(r => Math.abs(r.amount)));
}
function currentCharges(scored) {
  const dominant = scored[0];
  const domLast = lastDateOf(dominant.list);
  const domTypical = typicalOf(dominant.list);
  if (!(domTypical > 0)) return dominant.list;
  let best = null;
  for (const g of scored.slice(1)) {
    const last = lastDateOf(g.list);
    if (!last || last <= domLast) continue;
    const typical = typicalOf(g.list);
    if (!(typical > 0)) continue;
    const ratio = typical / domTypical;
    if (ratio > CURRENT_BAND || ratio < 1 / CURRENT_BAND) continue;
    if (!best || last > best.last || (last === best.last && g.total > best.g.total)) best = { g, last };
  }
  return best ? best.g.list : dominant.list;
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
  if (!toks.length) return { charges: [], current: [], related: [], tokens: toks };

  const groups = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.amount !== 'number' || r.amount >= 0) continue;   // outflows only
    const n = normDesc(r.desc);
    if (!n) continue;
    if (!toks.some(t => n.includes(t))) continue;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(r);
  }
  if (!groups.size) return { charges: [], current: [], related: [], tokens: toks };

  const scored = [...groups].map(([key, list]) => ({
    key, list, total: list.reduce((s, r) => s + Math.abs(r.amount), 0),
  })).sort((a, b) => b.total - a.total);

  return {
    charges: scored[0].list,
    /* What the service is charging NOW, which `charges` is not always: the
       dominant group is the one with the largest LIFETIME total, and a
       merchant that renames its debit order leaves that group behind with the
       history while the money moves to a smaller one. */
    current: currentCharges(scored),
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

/* How far a charge may sit from the listed price and still agree with it.

   4%, not 2%: a subscription billed in another currency moves a little every
   month with the exchange rate, and flagging that as the reader's error each
   time would train them to ignore the flag entirely. Wide enough to absorb a
   currency wobble, narrow enough that a real price change — a fibre line R40
   above its listed figure — still shows.

   The floor of 2 is the household's money: the few-rand wobble a cheap
   subscription moves by, which 4% of R15 would flag. It used to be 2 units of
   ANY currency, which stopped being harmless when the Services page learned
   to price-check a service in its own currency (2026-10-07 audit, SVC-1): a
   subscription listed at $15.99 and billed $17.99 — a 12.5% rise, R36 a
   month — read as agreeing, because $2 is "within 2". So the floor applies
   where a service is in the household's own currency, which a blank Currency
   cell means (ADR-0004; the Services page writes the household's own symbol
   back as blank), and nowhere else: this app has no measure of what a trivial
   amount of another currency is, and the 4% band means the same thing in all
   of them. Every household-currency verdict is the one this always gave
   (tests/services-price-floor-currency.test.cjs sweeps it against the
   released formula). */
const PRICE_BAND = 0.04;
const HOUSEHOLD_FLOOR = 2;
function agreementBand(service, stated) {
  const ownCurrency = String((service && service.currency) || '').trim();
  return ownCurrency ? stated * PRICE_BAND : Math.max(HOUSEHOLD_FLOOR, stated * PRICE_BAND);
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
    agrees: Math.abs(diff) <= agreementBand(service, stated),
  };
}

/* ------------------- the Services page's own two readings -------------------

   2026-10-07 audit, SVC-2 and SVC-3. Both are ADDED beside the functions they
   refine rather than folded into them, and that is load-bearing: committed.js
   prices the Dashboard's "still committed" off comparePrice's inputs and dates
   it off nextExpected, one cycle from the last charge, and its figures are
   pinned by the reconciliation. The Services page asks a different question —
   "what should the reader put in this row" — so it gets its own two answers,
   and the Dashboard's stay exactly as they were. */

/* The price a merchant has SETTLED on, or null.

   chargeStats' `varies` refuses a price whose last three charges spread by more
   than 15%, which is right for prepaid top-ups and for two products billed
   under one name — and wrong for the commonest change there is, a price that
   moved and then held. A fibre line billed 799, 799, 649, 649 has a last three
   of 799 / 649 / 649: a 23% spread, reported "varies" under a tooltip blaming
   top-ups, while the two newest charges agreed to the cent.

   So: when the LAST TWO charges are within 4% of each other, they are the
   price (their median). Two, not one — a single new amount is as likely a
   pro-rata or a double bill as a new price, which is the reason chargeStats
   reads three. 4% is the band comparePrice already allows a listed price, so a
   merchant counts as having settled by the same tolerance it is judged by.

   Date order, datable rows only, for the reason chargeStats' own header gives:
   rows reach this account-major, so a merchant billed from two accounts
   arrives interleaved, and the caller's order is not the merchant's history. */
const SETTLED_BAND = 0.04;
function settledPrice(charges) {
  const dated = (charges || []).filter(c => c && isRealIsoDate(c.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (dated.length < 2) return null;
  const a = Math.abs(dated[dated.length - 2].amount);
  const b = Math.abs(dated[dated.length - 1].amount);
  const mid = (a + b) / 2;
  if (!(mid > 0)) return null;
  return Math.abs(a - b) / mid <= SETTLED_BAND ? mid : null;
}

/* comparePrice, with the settled price above taking the place of a "varies"
   refusal. Everywhere comparePrice HAD an answer this returns that answer
   unchanged; where it refused, and the last two charges agree, the verdict is
   comparePrice's own, asked of the settled figure — one agreement rule, not a
   second spelling of the 4% band. `settled: true` lets the caller say what the
   verdict rests on. `charges` are the ones `stats` was computed from. */
function comparePriceNow(service, stats, charges) {
  const base = comparePrice(service, stats);
  if (!base || !base.varies) return base;
  const settled = settledPrice(charges);
  if (settled == null) return base;
  return { ...comparePrice(service, { ...stats, varies: false, recent: settled }), settled: true };
}

/* `n` cycles on from `iso`, ANCHORED on iso rather than on the previous step:
   the 31st stepped one month at a time through February comes back to the 31st
   in March instead of drifting to the 28th for good. n = 1 is nextExpected's
   own step, for every cycle (tests/services-next-billing-hint.test.cjs pins
   the agreement); the clamps are the same ones, for the same short months. */
function addCycles(iso, cycle, n) {
  const step = STEP_DAYS[cycle];
  if (step) return isoFromDayNumber(isoDayNumber(iso) + step * n);
  const [y, m, d] = iso.split('-').map(Number);
  let ny = y + n, nm = m;
  if (cycle !== 'annual') {
    const k = (m - 1) + n;
    ny = y + Math.floor(k / 12);
    nm = (k % 12) + 1;
  }
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/* The next billing date to OFFER the reader: the first cycle date, stepped
   from the last charge, that is not already in the past.

   nextExpected answers "when was the next charge due", and the Services page
   offered that as a correction even when it had passed — "due 2026-10-01" on
   7 October, for every service whose newest statement was not imported yet.
   A next billing date in the past is not a correction, it is a second fossil.

   Returns { date, first, skipped, last } so the caller can say what the date
   rests on: `last` is the charge it steps from, `first` the date nextExpected
   gives, `skipped` how many cycle dates had already passed. null wherever
   nextExpected is null. `today` must be YYYY-MM-DD; without one nothing is
   stepped. Terminates because every step moves the date strictly forward. */
function nextDue(stats, cycle, today) {
  const first = nextExpected(stats, cycle);
  if (!first) return null;
  let date = first, skipped = 0;
  if (ISO_DATE.test(today || '')) {
    while (date < today) { skipped++; date = addCycles(stats.last, cycle, skipped + 1); }
  }
  return { date, first, skipped, last: stats.last };
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
  /* 2026-10-07 audit — the Services page's readings, added beside the ones
     committed.js consumes rather than changing them (see their header). */
  settledPrice, comparePriceNow, nextDue,
};
