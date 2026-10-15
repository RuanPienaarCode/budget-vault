'use strict';
/* "N days · R x/day" counts today.

   whatsLeft measured the days left as the distance from today to the period's
   last day, so the last day of a period read "0 days" and the day before it
   "1 day" — while the commitments in the same card start AT today (a charge
   due today is still to come, committed.js's window opens on `now`). The card
   was spending today's money across tomorrow's days: on the 20th of a period
   ending on the 21st it divided by 1 day where two days remain to spend in,
   and on the 21st it printed no per-day figure at all
   (2026-10-14 audit, L2a-N12). Both ends are inclusive now: the 21st of a
   period ending on the 21st has ONE day left.

     node tests/committed-days-left-inclusive.test.cjs */

const assert = require('assert');
const { whatsLeft } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const P_START = '2026-10-01', P_END = '2026-10-21';
const accounts = [{ name: 'Cheque', type: 'checking', dated: true, inBudget: true, implied: 1000 }];
const left = today => whatsLeft({ accounts, services: [], debts: [], rows: [], periodStart: P_START, periodEnd: P_END, today });

eq(left('2026-10-14').days, 8, '14 to 21 October inclusive is 8 days');
eq(left('2026-10-20').days, 2, 'the day before the last is 2 days, not 1');
eq(left('2026-10-21').days, 1, 'the last day has one day left, not 0');
eq(left('2026-10-22').days, 0, 'a day after the period has none');
eq(left('2026-10-21').perDay, 1000, 'so the last day still states what can be spent that day');
eq(left('2026-10-14').perDay, 125, 'and the per-day figure divides by the same inclusive count');
eq(left('').days, null, 'no today, no count');
eq(left('2026-10-22').perDay, null, 'and a finished period states no per-day figure');

console.log(`PASS committed-days-left-inclusive.test.cjs (${checks} checks)`);
