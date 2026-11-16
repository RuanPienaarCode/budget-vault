'use strict';
/* Transfer detection after the reader changes the account on the review screen.

   A transfer is "the same amount, the opposite sign" (oppositeLeg). The review
   re-ran applyCounterparties BEFORE signVerdict re-decided the signs for the
   newly chosen account, so on the render that follows the pick it looked for
   the other leg with the previous account's signs: a credit-card payment of 500
   showed as +500 income, not excluded, with no leg found — and only the NEXT
   render (with the signs settled) excluded it. Pressing Import in between
   imported the transfer as income.

   Driven through the real select handler (what the reader actually triggers),
   on a statement that arrives with no account detected and is read as an asset
   ledger until a credit card is chosen. Synthetic figures.

     node tests/import-transfer-after-account-pick.test.cjs */

const assert = require('assert');
const { mountReview } = require('./helpers/import-review-ctx.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const CSV = [
  'Date,Description,Amount,Balance',
  '2026-08-01,WOOLWORTHS,1200.00,1200.00',
  '2026-08-02,ENGEN,340.50,1540.50',
  '2026-08-03,SPOTIFY,99.00,1639.50',
  '2026-08-04,PAYMENT FROM 1234567,-500.00,1139.50',
  '2026-08-05,CHECKERS,210.25,1349.75',
  '2026-08-06,UBER,45.00,1394.75',
].join('\n') + '\n';
const CARD = { name: 'Visa', tx_label: 'Visa', type: 'credit_card', in_budget: true };
const CHQ = { name: 'Cheque', tx_label: 'Cheque', type: 'checking', account_number: '1234567', in_budget: true };

const snapshot = p => JSON.stringify(p.items.map(i => [i.date, i.desc, i.amount, i.excluded, i.transferTo, i.transferLeg]));

(async () => {
  const mk = () => mountReview({
    accounts: [CARD, CHQ], dayFirst: false, thousands: ',',
    accountIndex: () => new Map([[CHQ, { rows: [{ date: '2026-08-04', desc: 'VISA PAYMENT', amount: -500 }] }], [CARD, { rows: [] }]]),
  });

  // 1. one render after the pick is the final state
  {
    const v = mk();
    const p = await v.load(CSV);
    const row = () => p.items.find(i => i.desc.startsWith('PAYMENT'));
    ok(!p.label, 'fixture: no account detected, so the file is read as an asset ledger first');
    const sel = v.els['#impAccount'];
    sel.value = 'Visa';
    sel.onchange();                      // the reader's pick — exactly one render
    eq(row().amount, 500, 'the card reading made the payment money IN (+500)');
    eq(row().excluded, true, 'after the FIRST render the payment is already excluded as a transfer');
    eq(row().transferLeg, '2026-08-04', 'with the cheque account\'s leg cited');
    eq(row().transferTo, 'Cheque', 'and the counterparty named');
    const first = snapshot(p);
    v.ctx.renderImportReview();
    eq(snapshot(p), first, 'a second render changes nothing (idempotent)');
    v.ctx.renderImportReview();
    eq(snapshot(p), first, 'nor a third');
  }

  // 2. the reader's own decision is still respected
  {
    const v = mk();
    const p = await v.load(CSV);
    const row = () => p.items.find(i => i.desc.startsWith('PAYMENT'));
    row().manualExclude = true; row().excluded = false;     // the reader unticked the exclusion by hand
    const sel = v.els['#impAccount'];
    sel.value = 'Visa'; sel.onchange();
    eq(row().excluded, false, 'a row the reader decided by hand (manualExclude) is skipped by the transfer pass');
    eq(row().amount, 500, 'while its sign still follows the account');
  }

  // 3. switching back to the cheque account re-decides in ONE render too
  {
    const v = mk();
    const p = await v.load(CSV);
    const sel = v.els['#impAccount'];
    sel.value = 'Visa'; sel.onchange();
    sel.value = 'Cheque'; sel.onchange();
    const row = p.items.find(i => i.desc.startsWith('PAYMENT'));
    eq(row.amount, -500, 'back on an asset account the file reads as it was printed');
    eq(row.excluded, false, 'and no card transfer is claimed against the cheque account\'s own row');
    const snap = snapshot(p);
    v.ctx.renderImportReview();
    eq(snapshot(p), snap, 'stable here as well');
  }
  console.log(`PASS import-transfer-after-account-pick — the first render after an account pick is the final one (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
