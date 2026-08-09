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

const { ISO_DATE, isoDayNumber } = require('./dates');

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
  const sorted = [...charges].sort((a, b) => a.date.localeCompare(b.date));
  const amounts = sorted.map(c => Math.abs(c.amount));
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
    count: sorted.length,
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
function nextExpected(stats, cycle) {
  if (!stats || !stats.last) return null;
  if (cycle === 'annual') {
    const [y, m, d] = stats.last.split('-').map(Number);
    return `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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
  if (!ISO_DATE.test(today || '')) return { state: 'active', daysSince: null };
  const gap = isoDayNumber(today) - isoDayNumber(stats.last);
  const cycleDays = cycle === 'annual' ? 365 : 31;
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

module.exports = {
  normDesc, serviceTokens, matchCharges, chargeStats, nextExpected, chargeStatus, comparePrice,
};
