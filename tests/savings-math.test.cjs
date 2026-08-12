'use strict';
/* Where a savings balance came from.

   The bug this replaces: growth was `balance − total_invested`, which counts
   every contribution as growth the moment the baseline stops being updated by
   hand — and nothing updates it. On a tax-free account with a monthly debit
   order that overstated growth by roughly twenty times.

   src/savings-math.js is pure, so this runs in bare node with no stub.

     node tests/savings-math.test.cjs
*/

const assert = require('assert');
const { splitFlows, accountFlows } = require('../src/savings-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++; };

/* The category table from a real vault: interest is income-type, and the
   categories contributions arrive under are anything but. */
const TYPES = {
  'Interest income': 'income',
  'Ruan pay check': 'income',
  'Christine personal': 'luxuries',
  'Discovery 32 Day notice savings': 'savings',
  'TFS Ninety One (R)': 'investment',
};
const typeOf = c => TYPES[c] || null;
const row = (date, amount, cat) => ({ date, amount, cat: cat || '' });

/* ---- 1. the classification rule ---- */
{
  const f = splitFlows([
    row('2026-01-01', 29.79, 'Interest income'),     // growth
    row('2026-01-01', 84.41, 'Interest income'),     // growth
    row('2026-01-03', 4000, ''),                     // contribution — uncategorised
    row('2026-01-16', -2575, ''),                    // withdrawal
    row('2026-01-31', 700, 'Christine personal'),    // contribution — wears its source category
  ], typeOf);

  near(f.growth, 114.20, 0.001, 'interest is growth');
  eq(f.contributions, 4700, 'every other inflow is a contribution');
  eq(f.withdrawals, 2575, 'outflows are withdrawals, as a positive magnitude');
  eq(f.count, 5, 'every row is accounted for');
  near(f.net, 2239.20, 0.001, 'net is contributions + growth − withdrawals');
}

/* ---- 2. the regression: a pure contribution must not move growth ---- */
{
  const before = splitFlows([row('2026-01-01', 100, 'Interest income')], typeOf);
  const after = splitFlows([
    row('2026-01-01', 100, 'Interest income'),
    row('2026-02-01', 5000, ''),                     // a debit order lands
  ], typeOf);
  eq(after.growth, before.growth, 'a R5 000 contribution leaves growth exactly where it was');
  eq(after.contributions, 5000, 'and shows up as a contribution instead');
}

/* ---- 3. growth is recognised by TYPE, never by name ---- */
{
  // A vault in another language: the category is called something else
  // entirely, and is still income-type.
  const other = c => (c === 'Rente' ? 'income' : null);
  const f = splitFlows([row('2026-01-01', 50, 'Rente'), row('2026-01-02', 900, 'Spaar')], other);
  eq(f.growth, 50, 'an income-type category in any language is growth');
  eq(f.contributions, 900, 'and the rest is contribution');

  // And the English name alone proves nothing without the type.
  const noTypes = splitFlows([row('2026-01-01', 50, 'Interest income')], () => null);
  eq(noTypes.growth, 0, 'without a type, "Interest income" is not assumed to be growth');
  eq(noTypes.contributions, 50, 'it falls to contribution rather than being invented');
}

/* ---- 4. the known weakness is REPORTED, not hidden ----
   A salary paid straight into savings is income-type and will land in growth.
   It cannot be told apart from interest by the data, so the categories that
   fed growth are named for the reader to check. */
{
  const f = splitFlows([
    row('2026-01-01', 84.41, 'Interest income'),
    row('2026-01-25', 30000, 'Ruan pay check'),
  ], typeOf);
  near(f.growth, 30084.41, 0.001, 'a salary into savings does land in growth');
  eq(f.growthCategories.length, 2, 'but both sources are named');
  eq(f.growthCategories[0], { cat: 'Ruan pay check', amount: 30000 }, 'largest first, so the odd one is obvious');
  eq(f.growthCategories[1].cat, 'Interest income', 'alongside the real interest');
}

/* ---- 5. excluded rows are not filtered here ----
   Every row in a fund account is typically Excluded: yes. This module never
   looks at the flag; if it did, every fund would report having received
   nothing, ever. */
{
  const f = splitFlows([
    { date: '2026-01-03', amount: 2000, cat: '', excluded: true },
    { date: '2026-01-31', amount: 472.96, cat: 'Interest income', excluded: true },
  ], typeOf);
  eq(f.contributions, 2000, 'an excluded contribution still entered the account');
  near(f.growth, 472.96, 0.001, 'and excluded interest was still earned');
}

/* ---- 6. the identity holds, by construction ---- */
{
  const flows = accountFlows({ balance: 12084.41 }, [
    row('2026-01-03', 2000, ''),
    row('2026-01-31', 84.41, 'Interest income'),
  ], typeOf);
  eq(flows.basis, 'derived', 'transactions mean a derived split');
  near(flows.opening, 10000, 0.001, 'opening is inferred from the closing balance');
  near(flows.opening + flows.contributions + flows.growth - flows.withdrawals, flows.closing, 0.001,
    'Opening + Contributions + Growth − Withdrawals = Closing');
}

/* ---- 7. an account with no transactions falls back, and SAYS it did ---- */
{
  const f = accountFlows({ balance: 104548.28, total_invested: 96000 }, [], typeOf);
  eq(f.basis, 'stated', 'the fallback is labelled, not passed off as derived');
  near(f.growth, 8548.28, 0.001, 'balance less what was recorded as put in');

  const s = accountFlows({ balance: 500, starting_amount: 400 }, [], typeOf);
  eq(s.basis, 'stated', 'starting_amount is the second-choice baseline');
  eq(s.growth, 100, 'and still yields a figure');

  const n = accountFlows({ balance: 500 }, [], typeOf);
  eq(n.basis, 'none', 'with neither, nothing is claimed');
  eq(n.growth, 0, 'rather than a growth figure invented from zero');
}

/* ---- 8. date windows ---- */
{
  const rows = [
    row('2025-12-31', 1000, ''), row('2026-01-15', 2000, ''), row('2026-02-15', 3000, ''),
  ];
  eq(splitFlows(rows, typeOf, { from: '2026-01-01' }).contributions, 5000, 'from is inclusive');
  eq(splitFlows(rows, typeOf, { to: '2026-01-31' }).contributions, 3000, 'to is inclusive');
  eq(splitFlows(rows, typeOf, { from: '2026-01-01', to: '2026-01-31' }).contributions, 2000, 'both together');
}

/* ---- 9. junk in, zero out ---- */
{
  const f = splitFlows([null, { date: '2026-01-01' }, { amount: 0, date: '2026-01-01' }, undefined], typeOf);
  eq(f.count, 0, 'rows with no usable amount are skipped, not counted as zero-value flows');
  eq(f.net, 0, 'and contribute nothing');
  eq(splitFlows(undefined, typeOf).contributions, 0, 'missing rows behave as none');
  eq(accountFlows(undefined, [], typeOf).basis, 'none', 'missing account does not throw');
}

/* ---- 10. splitFlows reports the earliest row that actually counted ----
   Nobody has to re-derive the filtering (usable amount, split parent, window)
   to find the start of the history — splitFlows does it once, here. */
{
  const gap = [row('2026-02-10', 1000, ''), row('2026-07-10', 1000, '')];
  eq(splitFlows(gap, typeOf).first, '2026-02-10', 'the earliest counted row is reported');
  eq(splitFlows([], typeOf).first, null, 'and is null when nothing counted');
}

/* ══════════════════ total return + the growth series ══════════════════════

   The bug these pin: growth was only ever counted where the account POSTED it
   as a transaction. A market-linked fund posts none — the value moves, the
   balance is retyped — so the fund with the most growth on the page reported
   the least. Working back from the balance catches it, at the cost of a
   dependency on `starting_amount` that has to be stated rather than assumed. */

const { totalReturn, growthSeries } = require('../src/savings-math');
const TODAY = '2026-08-11';

/* ---- 11. growth no transaction ever recorded ----
   R40 000 opening, R110 000 of debit orders, worth R214 300. Not one row says
   "growth", and the answer is R64 300 all the same. */
{
  const rows = [];
  for (let i = 0; i < 55; i++) {
    const mo = String((i % 12) + 1).padStart(2, '0');
    rows.push(row(`${2022 + Math.floor(i / 12)}-${mo}-01`, 2000, ''));
  }
  /* Opens on 2022-01-01 — the month the first debit order lands.

     It said 2022-03-01 until 1.16.1, which contradicted this block's own
     prose. `starting_amount` is the balance AT `inception_date`, so under that
     date the January and February orders were already inside the R40 000 and
     were then counted a second time; the figure only came to R110 000 because
     totalReturn summed the rows unwindowed. The fixture was wrong, not the
     arithmetic — and 11b below now covers the pre-inception case deliberately
     rather than leaving it hidden inside this one. */
  const a = { balance: 214300, starting_amount: 40000, inception_date: '2022-01-01' };
  const r = totalReturn(a, rows, typeOf, { today: TODAY });

  eq(r.basis, 'measured', 'a stated starting amount is a measurable baseline');
  eq(r.contributions, 110000, '55 debit orders of R2 000');
  near(r.capitalIn, 150000, 0.001, 'capital in is the opening plus what went in');
  near(r.growth, 64300, 0.001, 'growth is everything in the balance nobody put there');
  eq(r.postedGrowth, 0, 'and none of it was posted as a transaction');
  near(r.undatedGrowth, 64300, 0.001, 'so all of it is undated');
  near(r.returnPct, 42.8667, 0.001, 'return is measured on capital, not on the balance');
  ok(r.annualisedPct > 8 && r.annualisedPct < 9, `≈8.4%/yr (got ${r.annualisedPct})`);
  eq(r.trust, 'ok', 'nothing predates the opening date, so there is nothing to disclose');
}

/* ---- 11b. money that moved BEFORE the opening date is not counted twice ----
   `starting_amount` is the balance AT `inception_date`. Rows older than that
   date are already inside it, so adding them again inflates capital and
   deflates growth — and unlike the history-gap case the error runs in the
   UNFLATTERING direction, which is why nothing disclosed it: an account that
   really earned R200 reported R0 and looked merely dull.

   Adopting an existing account is the ordinary way in: you import the full
   statement history, and set inception_date to when YOU started tracking. */
{
  const a = { balance: 1500, starting_amount: 1200, inception_date: '2026-01-01' };
  const rows = [row('2025-02-05', 200, ''), row('2026-03-05', 100, '')];
  const r = totalReturn(a, rows, typeOf, { today: '2026-08-12' });

  near(r.capitalIn, 1300, 0.001, 'only the row AFTER the opening date joins the baseline');
  near(r.growth, 200, 0.001, 'so the R200 the account actually earned is visible');
  eq(r.trust, 'pre-inception', 'and the reader is told the record predates the opening date');
  eq(r.gapDays, -330, 'by how far, signed, so the direction is unambiguous');

  /* The negative control for the whole fix: unwindowed, this is what it used
     to say — capital swallowing the growth, and 'ok' printed over it. */
  const naive = 1200 + 200 + 100;
  ok(naive !== r.capitalIn, `negative control: the unwindowed sum (${naive}) is not what is reported`);
}

/* ---- 12. the identity: what is put in plus what it earned IS the balance ----
   The card prints capitalIn and growth beside a balance the reader can see. If
   the three ever stop adding up the page is arguing with itself. */
{
  const cases = [
    { balance: 214300, starting_amount: 40000, inception_date: '2022-03-01' },
    { balance: 96800, starting_amount: 0, inception_date: '2021-04-06' },
    { balance: 31200, starting_amount: 30000, inception_date: '2025-06-01' },
    { balance: 5000, starting_amount: 20000, inception_date: '2024-01-01' },   // a real loss
  ];
  const rows = [row('2025-01-05', 4000, ''), row('2025-02-05', -1500, ''),
    row('2025-03-31', 120, 'Interest income')];
  for (const a of cases) {
    const r = totalReturn(a, rows, typeOf, { today: TODAY });
    near(r.capitalIn + r.growth, a.balance, 0.001,
      `capital + growth = balance for a balance of ${a.balance}`);
    near(r.postedGrowth + r.undatedGrowth, r.growth, 0.001,
      'posted and undated growth account for all of it');
  }
}

/* ---- 13. starting_amount: 0 is a baseline, absent is not ----
   An account opened empty and funded by transfer is fully measurable. Treating
   a written zero as "not set" would drop exactly those accounts. */
{
  const rows = [row('2025-01-05', 10000, '')];
  const zero = totalReturn({ balance: 11000, starting_amount: 0 }, rows, typeOf, { today: TODAY });
  eq(zero.basis, 'measured', 'a written zero is a real opening balance');
  near(zero.growth, 1000, 0.001, 'and the growth is measured against it');

  const absent = totalReturn({ balance: 11000 }, rows, typeOf, { today: TODAY });
  eq(absent.basis, 'none', 'an absent starting amount is not a baseline');
  eq(absent.growth, null, 'and yields no growth figure at all rather than a guess');
}

/* ---- 14. the fallback is no stronger a claim than it ever was ---- */
{
  const r = totalReturn({ balance: 96800, total_invested: 66000 }, [], typeOf, { today: TODAY });
  eq(r.basis, 'stated', 'no baseline and no rows falls back to total_invested');
  near(r.growth, 30800, 0.001, 'which is the old formula, and labelled as such');
  eq(r.postedGrowth, 0, 'nothing about it is derived');
}

/* ---- 15. a history that starts after the account did is FLAGGED ----
   This is the failure mode that overstates growth, and it does it in the
   flattering direction — so it may never pass silently. */
{
  const late = totalReturn(
    { balance: 200000, starting_amount: 50000, inception_date: '2020-01-01' },
    [row('2025-06-01', 3000, '')], typeOf, { today: TODAY });
  eq(late.trust, 'history-gap', 'transactions beginning 5 years late is a gap');
  ok(late.gapDays > 1900, `and the gap is reported in days (got ${late.gapDays})`);

  const clean = totalReturn(
    { balance: 200000, starting_amount: 50000, inception_date: '2025-05-20' },
    [row('2025-06-01', 3000, '')], typeOf, { today: TODAY });
  eq(clean.trust, 'ok', 'a fortnight is not a gap');

  const undated = totalReturn(
    { balance: 200000, starting_amount: 50000 },
    [row('2025-06-01', 3000, '')], typeOf, { today: TODAY });
  eq(undated.trust, 'ok', 'no opening date means nothing to fall short of');
}

/* ---- 16. an annualised rate is withheld where it would be a lie ---- */
{
  const young = totalReturn(
    { balance: 12000, starting_amount: 10000, inception_date: '2026-05-01' },
    [], typeOf, { today: TODAY });
  eq(young.annualisedPct, null, 'under a year, annualising noise is not a rate');
  ok(young.returnPct > 19 && young.returnPct < 21, 'but the total return still stands');

  const drained = totalReturn(
    { balance: 500, starting_amount: 1000 },
    [row('2024-01-05', 2000, ''), row('2024-06-05', -6000, '')], typeOf, { today: TODAY });
  eq(drained.returnPct, null, 'a non-positive capital base yields no percentage');
  eq(drained.annualisedPct, null, 'and no annual rate either');
}

/* ---- 17. the chart identity, and what it refuses to draw ----
   capital + posted + undated must equal the balances of the accounts included,
   or the chart disagrees with the tiles beneath it. And an account that cannot
   be measured is EXCLUDED and COUNTED — never half-drawn. */
{
  const entries = [
    { account: { balance: 214300, starting_amount: 40000, inception_date: '2024-03-01' },
      rows: [row('2024-04-01', 2000, ''), row('2025-04-01', 2000, '')] },
    { account: { balance: 20000, starting_amount: 15000, inception_date: '2025-01-01' },
      rows: [row('2025-02-01', 1000, 'Interest income'), row('2025-03-01', 500, '')] },
    { account: { balance: 412000 }, rows: [] },                      // nothing to measure
    { account: { balance: 96800, total_invested: 66000 }, rows: [] }, // stated: undated entirely
  ];
  const s = growthSeries(entries, typeOf, { today: TODAY });

  eq(s.included, 2, 'only the measurable accounts are drawn');
  eq(s.excluded, 2, 'and the rest are counted, not dropped');
  eq(s.closing, 234300, 'closing is the balance of what was included');

  const last = s.points[s.points.length - 1];
  near(last.capital + last.posted + s.undated, s.closing, 0.001,
    'capital + posted + undated = the balances the reader can see');
  eq(last.month, '2026-08', 'the series runs to the current month');
  ok(s.points.length > 1, 'and has more than one point');

  /* Growth nobody dated is NOT smeared across the months to make a curve. */
  const posted = s.points.map(p => p.posted);
  eq(posted[0], 0, 'the series opens with no posted growth');
  eq(Math.max(...posted), 1000, 'and only ever carries growth a row actually recorded');
  near(s.undated, 234300 - (40000 + 4000) - (15000 + 500) - 1000, 0.001,
    'everything else is reported as undated rather than drawn');
}

/* ---- 18. an empty page does not throw ---- */
{
  const s = growthSeries([], typeOf, { today: TODAY });
  eq(s.points, [], 'no accounts, no series');
  eq(s.closing, 0, 'and no total');
  eq(growthSeries(undefined, typeOf, { today: TODAY }).included, 0, 'missing entries behave as none');
}

/* ---- 19. truncation folds the dropped months in rather than losing them ----
   A curve that starts at zero after truncation would understate every point
   after it, which is worse than starting partway up. */
{
  const rows = [];
  for (let y = 2015; y <= 2026; y++) rows.push(row(`${y}-01-05`, 1000, ''));
  const entries = [{ account: { balance: 20000, starting_amount: 1000, inception_date: '2015-01-01' }, rows }];
  const s = growthSeries(entries, typeOf, { today: TODAY, maxMonths: 24 });

  eq(s.points.length, 24, 'the series is capped');
  ok(s.truncatedFrom, `and says where it was cut (${s.truncatedFrom})`);
  ok(s.points[0].capital >= 11000, `the first point carries the dropped months (got ${s.points[0].capital})`);
  const last = s.points[s.points.length - 1];
  near(last.capital + last.posted + s.undated, 20000, 0.001, 'and the identity survives truncation');
}

console.log(`savings-math.test.cjs — ${checks} checks OK`);
