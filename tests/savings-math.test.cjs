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
const { splitFlows, accountFlows, contributionRate } = require('../src/savings-math');

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

/* ---- 9. contribution rate ignores the unfinished month ----
   Checked in the first week of August, the window must END in July. Counting
   an incomplete August would report a shortfall that has not happened. */
{
  const rows = [];
  for (const m of ['02', '03', '04', '05', '06', '07']) rows.push(row(`2026-${m}-03`, 1000, ''));
  rows.push(row('2026-08-01', 5, ''));              // the part-month, must be ignored

  const r = contributionRate(rows, typeOf, 6, '2026-08-07');
  ok(r, 'six whole months of history is enough to speak');
  eq(r.from, '2026-02-01', 'the window starts six months before last month');
  eq(r.to, '2026-07-31', 'and ends at the end of last month, not today');
  eq(r.total, 6000, 'the August row is outside it');
  eq(r.perMonth, 1000, 'so the average is the real one');

  eq(contributionRate([], typeOf, 6, '2026-08-07'), null, 'no history says nothing');
  eq(contributionRate(rows, typeOf, 6, ''), null, 'and neither does an unusable date');
  eq(contributionRate(rows, typeOf, 0, '2026-08-07'), null, 'nor a zero-month window');

  // January must not roll the year back incorrectly.
  const jan = contributionRate([row('2025-12-10', 800, '')], typeOf, 1, '2026-01-15');
  ok(jan, 'a January check reads December');
  eq(jan.from, '2025-12-01', 'crossing the year boundary');
  eq(jan.to, '2025-12-31', 'correctly');
}

/* ---- 10. junk in, zero out ---- */
{
  const f = splitFlows([null, { date: '2026-01-01' }, { amount: 0, date: '2026-01-01' }, undefined], typeOf);
  eq(f.count, 0, 'rows with no usable amount are skipped, not counted as zero-value flows');
  eq(f.net, 0, 'and contribute nothing');
  eq(splitFlows(undefined, typeOf).contributions, 0, 'missing rows behave as none');
  eq(accountFlows(undefined, [], typeOf).basis, 'none', 'missing account does not throw');
}

console.log(`savings-math.test.cjs — ${checks} checks OK`);
