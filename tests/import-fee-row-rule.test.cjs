'use strict';
/* A generated "(fee)" row is not categorised by its merchant's rule
   (2026-11-25 audit, RUL-6).

   When the balance column shows a fee printed beside an amount was charged on
   top, views/import.js adds a second row, "<description> (fee)". It was
   categorised with matchRule(feeDesc, rules) — and since the merchant's name is
   a substring of the fee row's, the merchant's rule won: a R5 ATM fee filed as
   "Cash withdrawal", a card fee on a grocery purchase filed as "Food".

   Now only a rule that answers for the FEE wording may categorise it — one
   that matches the fee row and not the merchant row on its own (a rule on
   "(fee)", or one for the exact fee description). Otherwise the row is left
   uncategorised for the review; no category name is invented.

     node tests/import-fee-row-rule.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ACC = { name: 'Revolut', tx_label: 'Revolut', type: 'checking', in_budget: true };
const HEAD = 'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance';
const line = (day, desc, amount, fee, balance) =>
  `X,Current,2026-08-0${day} 10:00:00,2026-08-0${day} 10:00:00,${desc},${amount},${fee},EUR,COMPLETED,${balance}`;
const CSV = [HEAD,
  line(1, 'Top-up', '1000.00', '0.00', '1000.00'),
  line(2, 'Shop A', '-20.00', '0.00', '980.00'),
  line(3, 'Cash at ATM', '-200.00', '5.00', '775.00'),
  line(4, 'Shop B', '-30.00', '0.00', '745.00'),
  line(5, 'Shop C', '-40.00', '0.00', '705.00'),
  line(6, 'Shop D', '-50.00', '0.00', '655.00'),
].join('\n') + '\n';

async function review(rules) {
  const v = mountReview({ accounts: [ACC] });
  v.ctx.S.rules = rules;
  const p = await v.load(CSV, 'account-statement.csv');
  return {
    atm: p.items.find(i => i.desc === 'Cash at ATM'),
    fee: p.items.find(i => i.desc === 'Cash at ATM (fee)'),
  };
}

(async () => {
  /* ---- the merchant's rule stays with the merchant -------------------------- */
  {
    const { atm, fee } = await review([{ pattern: 'Cash at ATM', category: 'Cash withdrawal' }]);
    ok(!!fee, 'fixture: the fee is imported as a row of its own');
    eq(atm.cat, 'Cash withdrawal', 'the withdrawal itself is categorised by its rule');
    eq(fee.cat, '', 'the fee row does NOT inherit the merchant\'s rule — left for the review');
    eq(fee.matchedPattern, '', 'and names no rule');
  }

  /* ---- a rule on the fee wording does categorise it ------------------------- */
  {
    const { atm, fee } = await review([{ pattern: 'Cash at ATM', category: 'Cash withdrawal' }, { pattern: '(fee)', category: 'Bank charges' }]);
    eq(atm.cat, 'Cash withdrawal', 'the merchant keeps its own rule');
    eq(fee.cat, 'Bank charges', 'a rule on "(fee)" answers for the fee row');
    eq(fee.matchedPattern, '(fee)', 'and is the rule named under it');
  }

  /* ---- so does an exact rule for the fee description ------------------------ */
  {
    const { fee } = await review([{ pattern: 'Cash at ATM', category: 'Cash withdrawal' }, { pattern: 'Cash at ATM (fee)', category: 'Bank charges' }]);
    eq(fee.cat, 'Bank charges', 'a rule written for the fee description itself categorises it');
  }

  /* ---- a longer merchant rule is still the merchant's ----------------------- */
  {
    const { fee } = await review([{ pattern: 'Cash at ATM', category: 'Cash withdrawal' }, { pattern: 'fee', category: 'Bank charges' }]);
    eq(fee.cat, 'Bank charges', 'a shorter rule that only the fee wording matches still wins over the merchant\'s longer one');
  }

  console.log(`PASS import-fee-row-rule — a generated (fee) row is categorised only by a rule for the fee (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
