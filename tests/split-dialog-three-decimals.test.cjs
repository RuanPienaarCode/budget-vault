'use strict';
/* The split dialog balances against the SAME cents the chip checks
   (2026-11-17 audit, split lane S2).

   The schema keeps three-decimal amounts (a fuel slip, -912.345), but the
   dialog's `total` was Math.abs(amount) with no rounding, while its allocated()
   and remainder() round to cents. So for 912.345 both 912.34 and 912.35 passed
   as balanced and 912.35 then showed "R0.01 unaccounted" on the row's chip; for
   58.125 no cent amount balances, so Split never enabled and said nothing.

   The dialog now takes its total in whole cents from tx-role.js amountCents —
   the same rounding splitShortfall uses for the parent. That is one shared
   helper because the obvious second spelling disagrees: Math.round rounds a
   half toward +infinity, so -912.345 is -91234 cents but Math.abs() then round
   gives 91235.

     1. the dialog total equals the cents the chip rule uses, for both signs
     2. exactly one total balances; it is reachable by typing cent amounts
     3. a split the dialog accepts never shows a shortfall
     4. a set one cent off is refused
     5. a plain two-decimal amount behaves as before
     6. the parent row's stored amount is not changed

     node tests/split-dialog-three-decimals.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { SplitModal } = require('../src/modal');
const { splitShortfall, amountCents } = require('../src/tx-role');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const money = v => `R ${v.toFixed(2)}`;
/* The real dialog class, driven the way the inputs would: onOpen()/refresh()
   need a DOM, the arithmetic does not. */
function dialog(amount) {
  const tx = { date: '2026-07-30', desc: 'FUEL SLIP', label: 'Cheque', amount, cat: 'Fuel' };
  const m = new SplitModal({}, { tx, categories: ['Fuel', 'Household'], money }, () => {});
  m.close = () => {};
  m.refresh = () => {};
  return { m, tx };
}
/* Type these cent amounts into the parts, press Split; what the row would hold. */
function attempt(amount, mags) {
  const { m, tx } = dialog(amount);
  m.parts = mags.map(mag => ({ mag, cat: 'Fuel', note: '' }));
  m.submit();
  return { result: m.result, tx, m };
}

for (const amount of [-912.345, 912.345, -58.125, 58.125]) {
  const label = String(amount);
  const sign = amount < 0 ? -1 : 1;
  const cents = Math.abs(amountCents(amount));
  const { m, tx } = dialog(amount);

  /* ---- 1. same cents as the chip ---- */
  eq(Math.round(m.total * 100), cents, `${label}: the dialog total is the cents the chip rule uses for the parent`);
  eq(Math.abs(amountCents(amount)) * sign, amountCents(amount), `${label}: the shared helper keeps the sign`);
  eq(m.sign, sign, `${label}: the direction is the parent's`);
  eq(m.parts[0].mag, cents / 100, `${label}: the seeded first part is the whole rounded total`);
  eq(m.remainder(), 0, `${label}: the seeded state is balanced to the cent`);

  /* ---- 2. exactly one total balances, and typing cents reaches it ---- */
  const half = Math.floor(cents / 2);
  const good = [half / 100, (cents - half) / 100];
  const balanced = [];
  for (const total of [cents - 1, cents, cents + 1]) {
    const x = dialog(amount).m;
    x.parts = [{ mag: total / 100 - 0.01, cat: '', note: '' }, { mag: 0.01, cat: '', note: '' }];
    if (x.remainder() === 0) balanced.push(total);
  }
  eq(balanced, [cents], `${label}: of the neighbouring cent totals only the chip's total balances`);

  /* ---- 3. what the dialog accepts never shows a shortfall ---- */
  const done = attempt(amount, good);
  ok(done.result, `${label}: parts typed to sum to the total are accepted`);
  eq(done.result.reduce((s, p) => s + Math.round(p.amount * 100), 0), sign * cents, `${label}: they sum to the signed total in cents`);
  eq(splitShortfall(tx, done.result), 0, `${label}: splitShortfall of the result is 0, so no "unaccounted" chip`);
  eq(tx.amount, amount, `${label}: the parent row's stored amount is not changed`);

  /* ---- 4. one cent off, either way, is refused ---- */
  eq(attempt(amount, [good[0] + 0.01, good[1]]).result, null, `${label}: one cent over is refused`);
  eq(attempt(amount, [good[0] - 0.01, good[1]]).result, null, `${label}: one cent under is refused`);
  // And the neighbouring total the OLD dialog also called balanced.
  const other = cents % 2 ? cents + 1 : cents - 1;
  eq(attempt(amount, [(other - 1) / 100, 0.01]).result, null, `${label}: the other cent total the unrounded dialog let through is refused`);
}

/* ---- 5. a plain two-decimal amount is exactly as it was ---- */
{
  const { m, tx } = dialog(-297.22);
  eq(m.total, 297.22, 'two decimals: the total is the magnitude, unchanged');
  eq(m.sign, -1, 'and the sign is the parent\'s');
  const r = attempt(-297.22, [200, 97.22]);
  eq(r.result.map(p => p.amount), [-200, -97.22], 'a balanced two-decimal split comes out signed as before');
  eq(splitShortfall(tx, r.result), 0, 'with no shortfall');
  eq(attempt(-297.22, [200, 97.21]).result, null, 'one cent off is refused, as before');
  eq(dialog(1200).m.total, 1200, 'a whole-rand amount is untouched');
  // splitShortfall keeps its answers: the refactor to the shared helper moved no figure.
  eq(splitShortfall({ amount: -1240.85 }, [{ amount: -800 }, { amount: -440.85 }]), 0, 'splitShortfall: float noise still reads 0');
  eq(splitShortfall({ amount: -1200 }, [{ amount: -800 }, { amount: -300 }]), -100, 'splitShortfall: a missing slice is still signed like the parent');
}

/* ---- 6. an amount that rounds to nothing is refused before the dialog opens ---- */
{
  eq(amountCents(0.004), 0, '0.004 is zero cents');
  eq(dialog(0.004).m.total, 0, 'so the dialog could never be balanced with a part');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'views', 'transactions.js'), 'utf8');
  ok(/!r\.amount \|\| !amountCents\(r\.amount\)\) return toast\(i18n\.t\('tx\.split\.zero'\)/.test(src),
    'the Transactions view says so (tx.split.zero) instead of opening it (source pin)');
}

console.log(`PASS split-dialog-three-decimals — the split dialog balances to the cents the chip checks (${checks} checks)`);
