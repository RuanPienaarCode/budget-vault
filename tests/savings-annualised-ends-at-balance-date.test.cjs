'use strict';
/* The annualised return runs over the same stretch of time the growth it
   annualises was measured over (audit 2026-10-14, L2a-N10).

   Growth is the balance the reader typed, less what went in. That balance is a
   fact about ONE day (`balance_updated`), but `years` ran from the opening date
   to TODAY, so an account nobody touched for a year read a lower rate every
   morning: +7.5% a year on the day it was typed, +6.5% two months later, +4.2%
   ten months after that, for growth that had not changed by a cent. The rule,
   decided on the audit's default: the period ends on the balance's own date
   when no row follows it, and on the later date (the last row dated after the
   balance, up to today) when rows do.

   Pinned against the real totalReturn(), with the inputs a reader controls:
     1. no rows after the balance: the rate is the same on every reading date;
     2. rows after the balance: the period runs to the last of them, and a row
        dated in the future (after today) does not stretch it;
     3. an account with no readable balance date keeps the old reading (today);
     4. the figure is the compound rate over exactly that stretch;
     5. NEGATIVE CONTROL: savings-math.js copied with the old end date fails (1).

     node tests/savings-annualised-ends-at-balance-date.test.cjs */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m, eps = 1e-9) => { assert.ok(Math.abs(a - b) < eps, `${m} (got ${a}, want ${b})`); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const { totalReturn } = require('../src/savings-math');
const typeOf = () => null;
const DAYS_PER_YEAR = 365.2425;
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const rate = (bal, cap, d) => (Math.pow(bal / cap, 1 / (d / DAYS_PER_YEAR)) - 1) * 100;

/* Synthetic fund: R40 000 at opening, typed at R44 000 on its balance date. */
const FUND = {
  name: 'Fund', type: 'investment', balance: 44000, balance_updated: '2025-07-11',
  starting_amount: 40000, inception_date: '2024-03-11',
};

/* ---- 1. no row after the balance: one rate, whatever day it is read ---- */
{
  const a = totalReturn(FUND, [], typeOf, { today: '2025-09-17' });
  const b = totalReturn(FUND, [], typeOf, { today: '2026-07-11' });
  near(a.annualisedPct, b.annualisedPct, 'the same typed balance reads the same yearly rate on any later day');
  near(a.annualisedPct, rate(44000, 40000, days('2024-03-11', '2025-07-11')),
    'and it is the compound rate over opening date -> balance date');
  ok(a.annualisedPct > 7 && a.annualisedPct < 8, `about 7.5% a year, not the run-to-today ~6.5% (got ${a.annualisedPct})`);
  near(a.years, days('2024-03-11', '2025-07-11') / DAYS_PER_YEAR, 'the years it was measured over end on the balance date');
}

/* ---- 2. rows after the balance date: to the last of them ---- */
{
  /* A R1 000 debit order on 14 Aug: capital and the implied balance both move
     by it, growth does not; the period now runs to 14 Aug. */
  const rows = [{ date: '2025-08-14', amount: 1000, cat: '' }];
  const r = totalReturn(FUND, rows, typeOf, { today: '2025-09-17' });
  near(r.years, days('2024-03-11', '2025-08-14') / DAYS_PER_YEAR, 'with a row after the balance the period runs to that row');
  /* A row dated after today is in no balance yet and does not stretch the period. */
  const future = totalReturn(FUND, [...rows, { date: '2025-11-04', amount: 1000, cat: '' }], typeOf, { today: '2025-09-17' });
  near(future.years, r.years, 'a row dated after today does not stretch the period');
  /* A row ON the balance date is already inside the balance: same end date. */
  const same = totalReturn(FUND, [{ date: '2025-07-11', amount: 500, cat: '' }], typeOf, { today: '2025-09-17' });
  near(same.years, days('2024-03-11', '2025-07-11') / DAYS_PER_YEAR, 'a row on the balance date is already in it');
}

/* ---- 3. no readable balance date: nothing to anchor on, today stands ---- */
{
  const undated = { ...FUND, balance_updated: '' };
  const r = totalReturn(undated, [], typeOf, { today: '2025-09-17' });
  near(r.years, days('2024-03-11', '2025-09-17') / DAYS_PER_YEAR, 'with no balance date the period still ends today');
}

/* ---- 5. NEGATIVE CONTROL ---- */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annualised-nc-'));
  fs.cpSync(SRC, dir, { recursive: true });
  const file = path.join(dir, 'savings-math.js');
  const src = fs.readFileSync(file, 'utf8');
  const marker = 'const days = since ? daysBetween(since, endIso) : null;';
  if (!src.includes(marker)) throw new Error('negative control: the end-date line is no longer in savings-math.js — update the control');
  fs.writeFileSync(file, src.replace(marker, 'const days = since ? daysBetween(since, today) : null;'));
  const old = require(file).totalReturn;
  const a = old(FUND, [], typeOf, { today: '2025-09-17' });
  const b = old(FUND, [], typeOf, { today: '2026-07-11' });
  ok(Math.abs(a.annualisedPct - b.annualisedPct) > 1,
    `NEGATIVE CONTROL: with the run-to-today end restored the rate moves with the reading date (${a.annualisedPct.toFixed(2)} vs ${b.annualisedPct.toFixed(2)})`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`PASS — the annualised return ends where the growth was measured (${checks} checks).`);
