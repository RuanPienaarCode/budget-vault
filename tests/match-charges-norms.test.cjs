'use strict';
/* matchCharges normalises each rows array once, and must never answer from a
   stale normalisation.

   The Services page and the dashboard call matchCharges once per service over
   the same rows array, so 1.56.x normalised services × rows descriptions per
   render (~1.0 s of a 1.2 s Services render on an 80k-row synthetic
   household). recurring.js now keeps one normalised copy per array, held
   weakly. The first cut was a string-keyed cache with a 50k cap, which review
   measured SLOWER than no cache once a bank's unique per-line references
   pushed a vault past the cap — so the cache is pinned here by behaviour,
   not by speed: the same answers as a fresh array, and an in-place edit or an
   appended row is seen on the very next call. */

const assert = require('assert');
const { matchCharges } = require('../src/recurring');

const svc = { name: 'Fibre', provider: 'Vumatel', cycle: 'monthly' };
const rows = () => [
  { date: '2026-07-01', desc: 'VUMATEL FIBRE 123', amount: -699 },
  { date: '2026-08-01', desc: 'VUMATEL FIBRE 456', amount: -699 },
  { date: '2026-08-03', desc: 'Checkers', amount: -400 },
  { date: '2026-08-05', desc: 'Salary', amount: 30000 },
];
const keys = m => m.all.map(r => `${r.date} ${r.desc}`);

// 1. Same answer on a reused array as on a fresh one, call after call.
const shared = rows();
const fresh = matchCharges(svc, rows());
for (let i = 0; i < 3; i++) assert.deepStrictEqual(keys(matchCharges(svc, shared)), keys(fresh), `call ${i + 1} on a reused array`);
assert.strictEqual(fresh.all.length, 2, 'both Vumatel debits match; Checkers and the inflow do not');

// 2. A row edited in place is re-normalised, not read from the earlier answer.
shared[2].desc = 'VUMATEL FIBRE ROUTER';
assert.strictEqual(matchCharges(svc, shared).all.length, 3, 'an in-place edit that now matches is seen');
shared[0].desc = 'Woolworths';
assert.strictEqual(matchCharges(svc, shared).all.length, 2, 'an in-place edit that no longer matches is dropped');

// 3. An array grown or shrunk since the last call.
shared.push({ date: '2026-09-01', desc: 'VUMATEL FIBRE 789', amount: -699 });
assert.strictEqual(matchCharges(svc, shared).all.length, 3, 'an appended row is seen');
shared.length = 2;
assert.deepStrictEqual(keys(matchCharges(svc, shared)), ['2026-08-01 VUMATEL FIBRE 456'], 'a truncated array forgets its tail');

// 4. Absent rows still answer "no charges", as before.
assert.strictEqual(matchCharges(svc, null).all, undefined);
assert.strictEqual(matchCharges(svc, []).charges.length, 0);

console.log('PASS — matchCharges reuses its per-array normalisation without going stale (4 cases).');
