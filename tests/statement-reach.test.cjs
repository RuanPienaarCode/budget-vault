'use strict';
/* committed.js statementReach / statementsStopShort — the one rule for how far
   the statements reach (2026-11-25 audit, NUM-1/NUM-2/NUM-3), in bare node.

   The health card has left a half-imported period out of its averages since
   L1-04; the Dashboard hero now says the same thing about the same accounts,
   and the set-aside sentence asks the same question of the savings funds. One
   rule, so the three cannot disagree about which accounts count or how far
   they reach. The rendered halves are pinned in
   tests/dashboard-statements-reach.test.cjs and
   tests/health-incomplete-period.test.cjs.

     node tests/statement-reach.test.cjs */

const assert = require('assert');
const { statementReach, statementsStopShort } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const rows = {
  Cheque: [{ date: '2026-11-15' }, { date: '2026-10-05' }, { date: '2026-12-01' } /* dated after today */],
  Card: [{ date: '2026-11-20' }],
  Fund: [{ date: '2026-09-25' }],
  Old: [{ date: '2025-01-10' }],
  Euro: [{ date: '2026-11-01' }],
  Joint: [{ date: '2026-11-02' }],
};
const accounts = [
  { name: 'Cheque', type: 'checking' },
  { name: 'Card', type: 'credit_card' },
  { name: 'Fund', type: 'savings', in_budget: false },
  { name: 'Old', type: 'checking' },
  { name: 'Euro', type: 'checking', currency: '€' },
  { name: 'Joint', type: 'checking', in_budget: false },
  { name: 'Wallet', type: 'cash' },
];
const base = { accounts, rowsOf: a => rows[a.name] || [], currency: 'R', windowStart: '2026-05-22', today: '2026-11-26' };

{
  const r = statementReach(base);
  eq(r.feeders.map(f => [f.name, f.through]), [['Cheque', '2026-11-15'], ['Card', '2026-11-20']],
    'in-budget, household-currency accounts with a row in the window; a row after today does not count');
  eq(r.through, '2026-11-15', 'the earliest of them is how far the statements reach');
  eq(r.funds.map(f => [f.name, f.through]), [['Fund', '2026-09-25']], 'a fund outside the budget is still a fund');
  eq(r.fundsThrough, '2026-09-25', 'and its date is the funds\' reach');
}
{
  const r = statementReach({ ...base, manual: true });
  eq([r.feeders, r.funds, r.through, r.fundsThrough], [[], [], null, null], 'manual entry has no import to be behind');
}

/* statementsStopShort(through, start, end, today) */
eq(statementsStopShort('2026-11-15', '2026-11-22', '2026-12-21', '2026-11-26'), '2026-11-15', 'running period, statements before today');
eq(statementsStopShort('2026-11-26', '2026-11-22', '2026-12-21', '2026-11-26'), null, 'imported up to today: nothing to say');
eq(statementsStopShort('2026-11-15', '2026-10-22', '2026-11-21', '2026-11-26'), '2026-11-15', 'finished period, statements before its end');
eq(statementsStopShort('2026-11-21', '2026-10-22', '2026-11-21', '2026-11-26'), null, 'finished period imported to its last day');
eq(statementsStopShort('2026-11-15', '2026-12-22', '2027-01-21', '2026-11-26'), null, 'a period not yet begun holds nothing to import');
eq(statementsStopShort(null, '2026-11-22', '2026-12-21', '2026-11-26'), null, 'no importing accounts, nothing to say');

console.log(`PASS statement-reach (${checks} checks)`);
