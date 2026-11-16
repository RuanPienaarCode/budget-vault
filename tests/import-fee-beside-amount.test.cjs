'use strict';
/* A Fee column beside an Amount on the SAME row is never silently dropped.

   views/import.js read the Fee column only when the row had no amount (a
   Capitec charge sits alone in `Fee`). A bank that prints both on one row
   (-200.00 ATM withdrawal, 5.00 fee, balance moved by 205) lost the 5.00, and
   reconcileAmounts' 80% slack let the one row the balance disagreed on through
   under the green "amounts check out" banner.

   Now: where there is a balance column, the fee-carrying rows' own balance
   movement decides — fee already inside the amount (add nothing), or charged on
   top (a second "(fee)" row, the ledger accounting for it so the verdict is
   honest). Where it cannot be decided, amounts are untouched and the review
   says how many rows carry a fee and what it comes to, and that it was not
   added — never the plain green sentence.

   Fee-only rows (a Capitec charge) and signed reversals (+30.00 in the Fee
   column) keep behaving exactly as before.

     node tests/import-fee-beside-amount.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');
const { reconcileFeesBesideAmount } = require('../src/statement');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const GREEN = 'Amounts check out against this statement’s own balance column.';
const ACC = { name: 'Revolut', tx_label: 'Revolut', type: 'checking', in_budget: true };
const sum = items => Math.round(items.reduce((n, i) => n + i.amount, 0) * 100) / 100;

/* Revolut-shaped: Amount and Fee on the same row. */
const HEAD = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance';
const line = (day, desc, amount, fee, balance) =>
  `X,Current,2026-08-0${day} 10:00:00,2026-08-0${day} 10:00:00,${desc},${amount},${fee},EUR,COMPLETED,${balance}`;
const csv = rows => [HEAD, ...rows].join('\n') + '\n';

async function review(text) {
  const v = mountReview({ accounts: [ACC] });
  const p = await v.load(text, 'account-statement.csv');
  p.label = 'Revolut'; v.ctx.renderImportReview();
  return { v, p, warn: v.els['#impReconcile'].classList.contains('imp-reconcile-warn') };
}

(async () => {
  /* ---- 1. the fee is charged on top: a (fee) row, and the totals tie ---- */
  const ON_TOP = csv([
    line(1, 'Top-up', '1000.00', '0.00', '1000.00'),
    line(2, 'Shop A', '-20.00', '0.00', '980.00'),
    line(3, 'Cash at ATM', '-200.00', '5.00', '775.00'),
    line(4, 'Shop B', '-30.00', '0.00', '745.00'),
    line(5, 'Shop C', '-40.00', '0.00', '705.00'),
    line(6, 'Shop D', '-50.00', '0.00', '655.00'),
  ]);
  {
    const { v, p, warn } = await review(ON_TOP);
    const fee = p.items.find(i => i.desc === 'Cash at ATM (fee)');
    ok(!!fee, 'a "(fee)" row exists, described from the original');
    eq([fee.date, fee.amount], ['2026-08-03', -5], 'same date as the withdrawal, and -5.00 — the sign that reconciles');
    eq(p.items.find(i => i.desc === 'Cash at ATM').amount, -200, 'the withdrawal itself is untouched');
    eq(sum(p.items), 655, 'the items sum to the statement\'s own net (1000 → 655 means +655)');
    ok(p.reconcile.verified && !p.reconcile.inverted && !p.reconcile.unchecked, 'the verdict is verified');
    eq(p.reconcile.agreement, p.reconcile.pairs, 'on EVERY pair — the fee row no longer hides inside the 80% slack');
    ok(v.banner().startsWith(GREEN) && /“\(fee\)” row/.test(v.banner()), `and the banner says a fee row was added: ${JSON.stringify(v.banner())}`);
    ok(!warn, 'which is not a warning');
    eq(p.feeNote, { added: true, count: 1, total: 5 }, 'the pending import records what was done');
    // Re-rendering keeps it (idempotent): nothing is added twice.
    v.ctx.renderImportReview();
    eq(p.items.filter(i => /\(fee\)$/.test(i.desc)).length, 1, 'a second render does not add it again');
  }

  /* ---- 2. the amount already includes the fee: nothing extra ---- */
  {
    const INSIDE = csv([
      line(1, 'Top-up', '1000.00', '0.00', '1000.00'),
      line(2, 'Shop A', '-20.00', '0.00', '980.00'),
      line(3, 'Cash at ATM', '-205.00', '5.00', '775.00'),
      line(4, 'Shop B', '-30.00', '0.00', '745.00'),
      line(5, 'Shop C', '-40.00', '0.00', '705.00'),
      line(6, 'Shop D', '-50.00', '0.00', '655.00'),
    ]);
    const { v, p, warn } = await review(INSIDE);
    ok(!p.items.some(i => /\(fee\)/.test(i.desc)), 'no extra item when the balance moved by the amount alone');
    eq(sum(p.items), 655, 'the items still sum to the net');
    eq(v.banner(), GREEN, 'and the banner is exactly the plain green sentence');
    ok(!warn && p.feeNote === null, 'no warning, no note');
  }

  /* ---- 3. fee-only rows and a signed reversal behave as before ---- */
  {
    const MIXED = csv([
      line(1, 'Top-up', '1000.00', '0.00', '1000.00'),
      line(2, 'Cash at ATM', '-200.00', '5.00', '795.00'),
      line(3, 'SMS fee', '', '-0.35', '794.65'),
      line(4, 'Correction: SMS fee', '', '+30.00', '824.65'),
      line(5, 'Shop B', '-30.00', '0.00', '794.65'),
      line(6, 'Shop C', '-40.00', '0.00', '754.65'),
    ]);
    const { p } = await review(MIXED);
    eq(p.items.map(i => `${i.desc}|${i.amount}`), [
      'Top-up|1000', 'Cash at ATM|-200', 'Cash at ATM (fee)|-5', 'SMS fee|-0.35', 'Correction: SMS fee|30', 'Shop B|-30', 'Shop C|-40',
    ], 'fee-only rows keep the cell\'s own sign (a reversal stays +30.00); the beside-fee row gains its fee row');
    ok(p.reconcile.verified && p.reconcile.agreement === p.reconcile.pairs, 'and the whole file reconciles');
  }

  /* ---- 4. no balance column: warned, nothing added ---- */
  {
    const NOBAL = ['Date,Description,Amount,Fee',
      '2026-08-01,Top-up,1000.00,0.00', '2026-08-02,Shop A,-20.00,0.00', '2026-08-03,Cash at ATM,-200.00,5.00',
      '2026-08-04,Shop B,-30.00,0.00', '2026-08-05,Wire out,-100.00,7.50'].join('\n') + '\n';
    const { v, p, warn } = await review(NOBAL);
    eq(p.items.map(i => i.amount), [1000, -20, -200, -30, -100], 'amounts are exactly as read; nothing added');
    eq(p.feeNote, { added: false, count: 2, total: 12.5 }, 'two rows carry a fee, totalling 12.50');
    const b = v.banner();
    ok(/2 rows carry a fee beside its amount \(R 12\.50 in total\)/.test(b) && /NOT added/.test(b), `the review says how many, how much, and that it was not added: ${JSON.stringify(b)}`);
    ok(warn && b !== GREEN, 'it is a warning, not the green sentence');
  }

  /* ---- 5. the fee rows disagree with each other: unproven ---- */
  {
    const DISAGREE = csv([
      line(1, 'Top-up', '1000.00', '0.00', '1000.00'),
      line(2, 'Shop A', '-20.00', '0.00', '980.00'),
      line(3, 'Cash at ATM', '-200.00', '5.00', '775.00'),   // on top
      line(4, 'Shop B', '-30.00', '0.00', '745.00'),
      line(5, 'Wire out', '-100.00', '7.50', '645.00'),      // inside
      line(6, 'Shop C', '-40.00', '0.00', '605.00'),
      line(7, 'Shop D', '-50.00', '0.00', '555.00'),
    ]);
    const { v, p, warn } = await review(DISAGREE);
    ok(!p.items.some(i => /\(fee\)/.test(i.desc)), 'no fee row is invented on a split decision');
    eq(p.feeNote.added, false, 'and the note says it was not added');
    ok(warn && v.banner() !== GREEN && /NOT added/.test(v.banner()), 'with a warning banner, never plain green');
  }

  /* ---- 6. signed fee column, and a newest-first statement ---- */
  {
    // newest first: the balance steps the other way down the file
    const REV = csv([
      line(6, 'Shop D', '-50.00', '0.00', '655.00'),
      line(5, 'Shop C', '-40.00', '0.00', '705.00'),
      line(4, 'Shop B', '-30.00', '0.00', '745.00'),
      line(3, 'Cash at ATM', '-200.00', '-5.00', '775.00'),
      line(2, 'Shop A', '-20.00', '0.00', '980.00'),
      line(1, 'Top-up', '1000.00', '0.00', '1000.00'),
    ]);
    const { p } = await review(REV);
    eq(p.items.find(i => /\(fee\)/.test(i.desc)).amount, -5, 'a newest-first statement is read the right way round');
    eq(sum(p.items), 655, 'and ties');
    // a signed fee that is a CREDIT (positive beside a debit): the balance moved by amount + fee
    const CREDIT = csv([
      line(1, 'Top-up', '1000.00', '0.00', '1000.00'),
      line(2, 'Shop A', '-20.00', '0.00', '980.00'),
      line(3, 'Cash at ATM', '-200.00', '5.00', '785.00'),
      line(4, 'Shop B', '-30.00', '0.00', '755.00'),
      line(5, 'Shop C', '-40.00', '0.00', '715.00'),
      line(6, 'Shop D', '-50.00', '0.00', '665.00'),
    ]);
    const { p: q } = await review(CREDIT);
    eq(q.items.find(i => /\(fee\)/.test(i.desc)).amount, 5, 'a fee the balance shows as money IN is imported as +5.00 — the evidence, not an assumption that fees are charges');
  }

  /* ---- 7. the decision function on its own ---- */
  {
    const R = (amount, fee, balance) => ({ amount, fee, balance });
    const base = [R(1000, 0, 1000), R(-20, 0, 980), R(-200, 5, 775), R(-30, 0, 745), R(-40, 0, 705), R(-50, 0, 655)];
    eq(reconcileFeesBesideAmount(base).reading, 'extra', 'charged on top');
    eq(reconcileFeesBesideAmount(base).items, [null, null, -5, null, null, null], 'with the fee in the row it belongs to');
    eq(reconcileFeesBesideAmount(base.map(r => ({ ...r, fee: 0 }))).reading, 'none', 'no fee column values, nothing to decide');
    eq(reconcileFeesBesideAmount(base.slice(0, 3)).reading, 'unproven', 'too few rows to prove an orientation');
    eq(reconcileFeesBesideAmount(base.map(r => ({ ...r, balance: null }))).reading, 'unproven', 'no balances, no proof');
    eq(reconcileFeesBesideAmount(base.map(r => ({ ...r, balance: r.balance + 3 * (r.amount % 7) }))).reading, 'unproven',
      'balances that do not line up even on the clean rows prove nothing');
  }

  console.log(`PASS import-fee-beside-amount — a fee beside an amount is added, shown to be inside it, or reported (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
