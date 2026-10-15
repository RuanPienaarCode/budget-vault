'use strict';
/* A Services amount typed below zero counts as 0 on the Dashboard too.

   The Services page keeps a typed negative in the field and the file and
   counts it as 0 in Per month / Per year, with the row saying so (the 7 Oct
   2026 rule for Assets, Owed and Debts, carried to Services by the 14 Oct
   audit, L6-02). serviceCommitments read the same cell as Math.abs(amount),
   so a service with no charge history typed "-50" was held as a R50
   commitment in "actually free" while its own page said it counted as 0 —
   one cell, two rules. Typed figures here are floored the way the page
   floors them; a charge history, when there is one, still decides.

     node tests/committed-negative-service-counts-as-zero.test.cjs */

const assert = require('assert');
const { serviceCommitments } = require('../src/committed');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const base = {
  rows: [], from: '2026-10-05', to: '2026-10-21', periodStart: '2026-10-01',
  accountOfRow: () => null,
};
const svc = (amount) => ({ name: 'Streaming', provider: 'Box', amount, cycle: 'monthly', next: '2026-10-15', active: true });

const neg = serviceCommitments({ ...base, services: [svc(-50)] });
eq(neg.length, 0, 'a service typed -50 with no charge history commits nothing');

const pos = serviceCommitments({ ...base, services: [svc(50)] });
eq(pos.length, 1, 'control: the same service typed 50 is committed');
eq(pos[0].amount, 50, 'control: for its typed amount');

const zero = serviceCommitments({ ...base, services: [svc(0)] });
eq(zero.length, 0, 'a service typed 0 commits nothing, as before');

console.log(`PASS committed-negative-service-counts-as-zero.test.cjs (${checks} checks)`);
