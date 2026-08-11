'use strict';
/* Matching a listed subscription to its real charges.

   Every case here is drawn from the shapes a real vault produced: a bank
   suffixing its own reference to a merchant name, two services sharing one
   budget category, an international-payment fee riding alongside the
   subscription it belongs to, and a service still marked active whose last
   charge was months ago.

   src/recurring.js is pure, so this runs in bare node with no stub.

     node tests/recurring.test.cjs
*/

const assert = require('assert');
const {
  normDesc, serviceTokens, matchCharges, chargeStats, nextExpected, chargeStatus, comparePrice,
} = require('../src/recurring');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++; };

const chg = (date, amount, desc, cat) => ({ date, amount: -Math.abs(amount), desc, cat: cat || '' });
const svc = (name, provider, amount, cycle, category) =>
  ({ name, provider, amount, cycle: cycle || 'monthly', category: category || '' });

/* ---- 1. the bank's own reference must not defeat the match ---- */
{
  eq(normDesc('FIBRE CO123456789 PAYNET'), 'fibre co paynet', 'digits and case are stripped');
  eq(normDesc('SpotifyZA 94.99 ZAR'), 'spotifyza zar', 'amounts in the description go too');
  eq(normDesc('   '), '', 'blank stays blank');
  eq(normDesc(null), '', 'missing does not throw');
}

/* ---- 2. tokens identify a merchant, and skip words that identify nothing ---- */
{
  eq(serviceTokens(svc('Fiber 70 / 70', 'Cool Ideas')).sort(), ['cool', 'fiber', 'ideas'],
    'provider words plus any service word specific enough to name a merchant');
  eq(serviceTokens(svc('Spotify Couple', 'Spotify')), ['spotify'], '"couple" is not a merchant');
  eq(serviceTokens(svc('Airtime and Data', 'Vodacom')), ['vodacom', 'airtime'],
    '"and" and "data" are dropped — they name no merchant — but "airtime" is kept');
  eq(serviceTokens(svc('', '')), [], 'nothing to go on');
  eq(serviceTokens(svc('Gym', 'Virgin Active')).includes('virgin'), true, 'short service name, useful provider');
}

/* ---- 3. two services sharing a category are NOT confused ----
   This is why matching is by token and not by budget category: on a real vault
   a phone contract and cloud storage both sit under one category. */
{
  const rows = [
    chg('2026-05-07', 675, 'VODACOM MINI APPS PMT EN', 'Cellphone and storage'),
    chg('2026-06-07', 675, 'VODACOM MINI APPS PMT EN', 'Cellphone and storage'),
    chg('2026-05-30', 199, 'APPLE.COM/BILL ICLOUD', 'Cellphone and storage'),
    chg('2026-06-30', 199, 'APPLE.COM/BILL ICLOUD', 'Cellphone and storage'),
  ];
  const phone = matchCharges(svc('Airtime and Data', 'Vodacom', 675, 'monthly', 'Cellphone and storage'), rows);
  eq(phone.charges.length, 2, 'the phone contract matches only its own charges');
  ok(phone.charges.every(c => c.desc.includes('VODACOM')), 'and none of the storage ones');

  const cloud = matchCharges(svc('iCloud Storage', 'Apple', 199, 'monthly', 'Cellphone and storage'), rows);
  eq(cloud.charges.length, 2, 'and cloud storage matches only its own');
  ok(cloud.charges.every(c => c.desc.includes('ICLOUD')), 'despite the shared category');
}

/* ---- 4. a rider fee does not distort the price ----
   "Spotify" hits both the subscription and the bank's fee ON it. The dominant
   merchant by total spend wins; the other is reported, not discarded. */
{
  const rows = [];
  for (const m of ['03', '04', '05', '06']) {
    rows.push(chg(`2026-${m}-15`, 94.99, 'SpotifyZA 94.99 ZAR', 'Spotify'));
    rows.push(chg(`2026-${m}-15`, 2.37, 'Intl payment fee SpotifyZA', 'Bank charges & fees'));
  }
  const m = matchCharges(svc('Spotify Couple', 'Spotify', 94.99), rows);
  eq(m.charges.length, 4, 'the subscription itself is the match');
  near(chargeStats(m.charges).median, 94.99, 0.001, 'so the price is not averaged with the fee');
  eq(m.related.length, 1, 'the fee is reported as related');
  eq(m.related[0].count, 4, 'with its own count — it is a real cost of the same service');
}

/* ---- 5. no match returns nothing, and never guesses ---- */
{
  const rows = [chg('2026-06-01', 500, 'WOOLWORTHS CAPE TOWN', 'Food')];
  const m = matchCharges(svc('iCloud Storage', 'Apple', 199), rows);
  eq(m.charges.length, 0, 'an unmatched service reports no charges');
  eq(chargeStats(m.charges), null, 'and no statistics are invented');
  eq(matchCharges(svc('X', 'Y'), []).charges.length, 0, 'empty vault');
  eq(matchCharges(svc('', ''), rows).charges.length, 0, 'no tokens means no match, not every row');
}

/* ---- 6. statistics, and drift that a single odd month cannot fake ---- */
{
  const rows = [];
  for (const m of ['01', '02', '03', '04', '05', '06']) rows.push(chg(`2026-${m}-02`, 859, 'FIBRE CO123456789 PAYNET'));
  const s = chargeStats(rows);
  eq(s.count, 6, 'every charge counted');
  eq(s.months, 6, 'across six months');
  eq(s.median, 859, 'the real price');
  eq(s.day, 2, 'billed on the 2nd');
  eq(s.last, '2026-06-02', 'and last seen in June');
  eq(s.drift, 0, 'a steady price has no drift');

  // A genuine increase, six charges each side.
  const rise = [];
  for (const m of ['01', '02', '03', '04', '05', '06']) rise.push(chg(`2025-${m}-15`, 80, 'SpotifyZA'));
  for (const m of ['01', '02', '03', '04', '05', '06']) rise.push(chg(`2026-${m}-15`, 95, 'SpotifyZA'));
  near(chargeStats(rise).drift, 0.1875, 0.001, 'a real rise shows as +19%');

  // One double-billed month must not read as a permanent change.
  const blip = [];
  for (const m of ['01', '02', '03', '04', '05', '06']) blip.push(chg(`2026-${m}-15`, 100, 'X Ltd'));
  blip.push(chg('2026-06-16', 200, 'X Ltd'));
  const b = chargeStats(blip);
  ok(Math.abs(b.drift) < 0.2, 'a single double charge does not become a price rise');

  eq(chargeStats([{ date: '2026-01-01', amount: -50, desc: 'x' }]).drift, null,
    'too little history to claim any drift at all');
}

/* ---- 7. next billing is predicted, not remembered ---- */
{
  eq(nextExpected({ last: '2026-07-02' }, 'monthly'), '2026-08-02', 'same day next month');
  eq(nextExpected({ last: '2026-12-15' }, 'monthly'), '2027-01-15', 'across the year boundary');
  eq(nextExpected({ last: '2026-01-31' }, 'monthly'), '2026-02-28', 'the 31st clamps into February');
  eq(nextExpected({ last: '2024-01-31' }, 'monthly'), '2024-02-29', 'and knows a leap year');
  eq(nextExpected({ last: '2026-03-10' }, 'annual'), '2027-03-10', 'annual adds a year');
  // A subscription last charged on a leap day: naive "+1 year, same month/day"
  // lands on 2029-02-29, a date that does not exist. The monthly branch above
  // already clamps to the real last day of the target month — the annual
  // branch must do the same.
  eq(nextExpected({ last: '2028-02-29' }, 'annual'), '2029-02-28', 'a Feb 29 anniversary in a non-leap year clamps to the 28th');
  eq(nextExpected({ last: '2027-02-28' }, 'annual'), '2028-02-28', 'an ordinary Feb 28 anniversary is untouched even into a leap year');
  eq(nextExpected(null, 'monthly'), null, 'nothing to predict from');
}

/* ---- 8. "has this stopped?" is generous, because a late post is not a
   cancellation and an annual bill is silent for eleven months ---- */
{
  const monthly = { last: '2026-07-02' };
  eq(chargeStatus(monthly, 'monthly', '2026-08-07').state, 'active', 'a month-old charge is fine');
  eq(chargeStatus({ last: '2026-06-20' }, 'monthly', '2026-08-07').state, 'active',
    'and so is seven weeks — banks post late');
  eq(chargeStatus({ last: '2026-02-07' }, 'monthly', '2026-08-07').state, 'overdue',
    'six months of silence is worth asking about');
  eq(chargeStatus({ last: '2025-10-01' }, 'annual', '2026-08-07').state, 'active',
    'an annual subscription is silent for most of the year by design');
  eq(chargeStatus({ last: '2024-01-01' }, 'annual', '2026-08-07').state, 'overdue',
    'two years is not');
  eq(chargeStatus(null, 'monthly', '2026-08-07').state, 'unseen', 'never charged at all');
  eq(chargeStatus(monthly, 'monthly', '').state, 'active', 'with no usable today, nothing is accused');
}

/* ---- 9. stated against the CURRENT price, not the all-time average ----
   A four-year-old subscription's all-time median is from two price rises ago.
   Comparing a reader's correct figure against it and calling the difference an
   error is worse than not comparing at all — on a real vault that made a gym
   listed at exactly the right price look 97% wrong. */
{
  const stats = { median: 859, recent: 859, varies: false };
  const c = comparePrice(svc('Fiber', 'Cool Ideas', 779), stats);
  eq(c.stated, 779, 'what the page claims');
  eq(c.actual, 859, 'what the bank charged');
  eq(c.diff, 80, 'the gap');
  eq(c.agrees, false, 'which is too big to call agreement');

  // The regression: price rose over the years, the reader updated their entry.
  const risen = chargeStats([
    chg('2023-01-15', 80, 'X'), chg('2023-02-15', 80, 'X'), chg('2023-03-15', 80, 'X'),
    chg('2026-05-15', 95, 'X'), chg('2026-06-15', 95, 'X'), chg('2026-07-15', 95, 'X'),
  ]);
  eq(risen.median, 87.5, 'the all-time median sits between the two prices');
  eq(risen.recent, 95, 'but the current price is the recent one');
  ok(comparePrice(svc('X', 'Y', 95), risen).agrees,
    'so an entry updated to the new price is reported as correct, not as an 8% error');

  ok(comparePrice(svc('X', 'Y', 100), { recent: 101, varies: false }).agrees, 'a rand of rounding still agrees');
  ok(comparePrice(svc('X', 'Y', 1000), { recent: 1015, varies: false }).agrees, 'and so does 1.5%');
  ok(!comparePrice(svc('X', 'Y', 1000), { recent: 1100, varies: false }).agrees, '10% does not');
  eq(comparePrice(svc('X', 'Y', 0), { recent: 50 }), null, 'no stated price, nothing to compare');
  eq(comparePrice(svc('X', 'Y', 100), null), null, 'no charges, nothing to compare');
}

/* ---- 10. a merchant with no stable price says so ----
   Prepaid top-ups of whatever the reader felt like buying, and billers that put
   the amount inside the description so two products merge into one merchant. */
{
  const topups = chargeStats([
    chg('2026-05-07', 300, 'VODACOM BUNDLES'),
    chg('2026-06-07', 1200, 'VODACOM BUNDLES'),
    chg('2026-07-07', 650, 'VODACOM BUNDLES'),
  ]);
  ok(topups.varies, 'wildly different recent amounts are not a price');
  const c = comparePrice(svc('Airtime', 'Vodacom', 675), topups);
  eq(c.actual, null, 'so no actual price is claimed');
  eq(c.agrees, null, 'and no verdict is passed on the reader\'s figure');
  eq(c.varies, true, 'the page is told to say "varies" instead');

  const steady = chargeStats([chg('2026-05-02', 859, 'X'), chg('2026-06-02', 859, 'X'), chg('2026-07-02', 862, 'X')]);
  ok(!steady.varies, 'a few rand of movement is still a price');
}

/* ---- 11. "still being charged?" follows the MERCHANT, not one description ----
   A merchant that renames its debit order would otherwise look cancelled while
   it is still taking money every month. One real vault has eight distinct
   Vodacom descriptions. */
{
  const rows = [
    chg('2024-01-07', 675, 'VODACOM MINI APPS PMT EN'),
    chg('2024-02-07', 675, 'VODACOM MINI APPS PMT EN'),
    chg('2026-07-07', 700, 'VODACOM BUNDLES'),          // same merchant, new wording
  ];
  const m = matchCharges(svc('Airtime', 'Vodacom', 675), rows);
  eq(m.charges.length, 2, 'the price still comes from the dominant description');
  eq(m.all.length, 3, 'but every matched row is available for the liveness check');
  eq(m.all[m.all.length - 1].date, '2026-07-07', 'in date order, newest last');
  eq(chargeStatus(chargeStats(m.all), 'monthly', '2026-08-07').state, 'active',
    'so a renamed debit order is not reported as cancelled');
  eq(chargeStatus(chargeStats(m.charges), 'monthly', '2026-08-07').state, 'overdue',
    'which the single-description view would have got wrong');
}

/* ---- a billing day is a whole day ----
   `median` averages the two middle values on an even count, which is right for
   an amount and wrong for a date: charges on the 10th and the 21st gave day
   15.5, and the Services tooltip rendered it verbatim as "Billed around day
   15.5". Rounded at the source; the amount medians stay untouched. */
{
  const s = chargeStats([chg('2026-05-10', 100, 'GYM'), chg('2026-06-21', 100, 'GYM')]);
  eq(s.day, 16, 'an even number of charges still reports a whole day of the month');
  ok(Number.isInteger(s.day), 'always');
  eq(chargeStats([chg('2026-05-10', 100, 'GYM'), chg('2026-06-20', 100, 'GYM')]).day, 15,
    'and an exact midpoint is unmoved by the rounding');
  // The amount median must NOT be rounded — a price has cents.
  eq(chargeStats([chg('2026-05-10', 100.25, 'X'), chg('2026-06-10', 100.75, 'X')]).median, 100.5,
    'amounts keep their cents');
}

/* ---- finding the salary, and refusing far more often than answering ----

   This is the only matcher in the file with nothing to match AGAINST: no vault
   names its income, so the pattern is discovered in the rows. That makes the
   refusals the real contract. Each case below is a shape that broke a
   hand-written four-month average on a real vault, which came to R61 000
   against a true salary of R40 240. */
{
  const { findRecurringCredit } = require('../src/recurring');
  const c = (date, amount, desc, excluded) => ({ date, amount, desc, excluded: !!excluded });
  const T = '2026-08-09';
  const SAL = 'CASHFOCUS SALARIS / SALARY';

  const found = findRecurringCredit(
    [c('2026-05-23', 40240.20, SAL), c('2026-06-23', 40240.20, SAL), c('2026-07-23', 40240.20, SAL)], T);
  ok(found, 'three steady monthly credits are a salary');
  eq(found.amount, 40240.20, 'reported at the amount actually paid, never an average of everything');
  eq(found.day, 23, 'on the day it actually lands');
  eq(found.next, '2026-08-23', 'and the next one is a real date');
  eq(found.count, 3, 'with the evidence count carried so the card can show its working');

  const no = (rows, why, today) => eq(findRecurringCredit(rows, today || T), null, why);
  no([c('2026-06-23', 40240, SAL), c('2026-07-23', 40240, SAL)], 'two occurrences is a coincidence with a witness');
  no([c('2025-11-28', 38025, 'SALARY NOV 2025'), c('2025-12-19', 38025, 'SALARY DEC 2025'), c('2026-01-23', 45901, 'SALARY JAN 2026')],
    'a description carrying its own month never groups, so a second earner is never predicted');
  no([c('2026-08-06', 40000, 'UIF payment')], 'a one-off payment is not a rhythm');
  no([c('2026-05-23', 40240, SAL, 1), c('2026-06-23', 40240, SAL, 1), c('2026-07-23', 40240, SAL, 1)],
    'an excluded row is the reader vetoing it as income — transfers and pass-throughs leave this way');
  no([c('2026-05-23', 20000, 'COMMISSION'), c('2026-06-23', 48000, 'COMMISSION'), c('2026-07-23', 31000, 'COMMISSION')],
    'an amount that swings is not predictable, and "about R33 000, give or take fifteen" helps nobody');
  no([c('2026-01-23', 5000, 'DIVIDEND'), c('2026-04-23', 5000, 'DIVIDEND'), c('2026-07-23', 5000, 'DIVIDEND')],
    'quarterly is not monthly');
  no([c('2026-01-23', 40240, SAL), c('2026-02-23', 40240, SAL), c('2026-03-23', 40240, SAL)],
    'a salary that stopped five months ago is not money that is coming');
  no([c('2026-05-23', -40240, 'RENT'), c('2026-06-23', -40240, 'RENT'), c('2026-07-23', -40240, 'RENT')],
    'an outflow is never income, however regular');
  eq(findRecurringCredit([], T), null, 'no rows, no claim');
  eq(findRecurringCredit(null, T), null, 'a missing list is not a crash');

  // A raise last year must not disqualify a salary that has been steady since.
  const raised = findRecurringCredit([
    c('2026-03-23', 30000, SAL), c('2026-04-23', 30000, SAL),
    c('2026-05-23', 40240, SAL), c('2026-06-23', 40240, SAL), c('2026-07-23', 40240, SAL)], T);
  eq(raised.amount, 40240, 'stability is judged on the RECENT three, so an old raise is history not noise');

  // Two repeating credits: the salary is the one worth naming.
  const both = findRecurringCredit([
    c('2026-05-23', 40240, SAL), c('2026-06-23', 40240, SAL), c('2026-07-23', 40240, SAL),
    c('2026-05-01', 500, 'POCKET MONEY'), c('2026-06-01', 500, 'POCKET MONEY'), c('2026-07-01', 500, 'POCKET MONEY')], T);
  eq(both.amount, 40240, 'the largest repeating credit wins');
}

console.log(`recurring.test.cjs — ${checks} checks OK`);
