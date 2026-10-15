'use strict';
/* Held debit orders: a split charge is grouped once, and a fixed payment to a
   card is left to the card.

   debitOrderCommitments (the 14 Oct 2026 audit's L2a-N05 fix) groups outflows
   by payer, category and amount. Two shapes could be counted twice:

     1. A SPLIT CHARGE. The Dashboard hands committed.js the MERCHANT lens
        (ISSUE 85): the split parent is the bank's line and the parts are
        dropped. Grouped through that lens, a charge split every month is held
        once, at what the bank takes. (A first cut of this fix also filtered
        split parents inside committed.js; with lens rows that dropped the only
        row left, and lane-x-merchant-lens forbids a private split filter here.
        This case pins the contract through the real lens instead.)

     2. A FIXED PAYMENT TO A CARD. A cheque account that pays a settle-monthly
        card a fixed sum each month is a recurring outflow, but what it pays is
        the card's balance, which cardCommitments already holds as the card's
        own commitment. Holding it here too counted the same money twice. The
        other leg is what tells: the same amount landing on a credit card
        within a few days. One leg pairs with ONE outflow, the nearest.

   Synthetic figures.

     node tests/committed-debit-orders-split-and-card.test.cjs */

const assert = require('assert');
const { debitOrderCommitments } = require('../src/committed');
const { stamp, LENSES, keeps } = require('../src/ledger');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const cheque = { name: 'Cheque', type: 'checking', dated: true, inBudget: true, implied: 30000, importedTo: '2026-09-26' };
const card = { name: 'Card', type: 'credit_card', dated: true, inBudget: true, implied: -4000, importedTo: '2026-09-26', settle: 'monthly' };
const DAYS = ['2026-07-01', '2026-08-01', '2026-09-01'];
const base = { services: [], debts: [], from: '2026-10-22', to: '2026-11-21', periodStart: '2026-10-22' };

// 1. split parent + parts, every month, read through the MERCHANT lens
const splitRows = [];
for (const d of DAYS) {
  splitRows.push({ date: d, desc: 'MEDICAL SCHEME', cat: 'Medical aid', amount: -1000, excluded: true, split: 'parent' });
  splitRows.push({ date: d, desc: 'MEDICAL SCHEME', cat: 'Medical A', amount: -600, split: 'part' });
  splitRows.push({ date: d, desc: 'MEDICAL SCHEME', cat: 'Medical B', amount: -400, split: 'part' });
}
const merchant = stamp(splitRows, { catType: () => 'expense', catKnown: () => true })
  .filter(s => keeps(LENSES.MERCHANT, s)).map(s => s.row);
const held = debitOrderCommitments({ ...base, rows: merchant, accountOfRow: new Map(merchant.map(r => [r, cheque])) });
const sum = items => items.reduce((s, i) => s + i.amount, 0);
eq([...new Set(held.map(i => i.name))], ['Medical aid'], 'through the MERCHANT lens the split charge is one order, the bank\'s line');
// the same R1 000 charge, never split: what the split household must equal
const whole = DAYS.map(d => ({ date: d, desc: 'MEDICAL SCHEME', cat: 'Medical aid', amount: -1000 }));
const unsplit = debitOrderCommitments({ ...base, rows: whole, accountOfRow: new Map(whole.map(r => [r, cheque])) });
eq(sum(unsplit) > 0, true, 'control: the unsplit charge is held');
eq(sum(held), sum(unsplit), 'a charge split each month is held for exactly what the unsplit charge is');

// 2. fixed payment to a card, with its other leg on the card
const cardRows = [];
const who2 = new Map();
for (const d of DAYS) {
  const out = { date: d, desc: 'PAYMENT TO CARD', cat: 'Settle card', amount: -2500 };
  const inn = { date: d.slice(0, 8) + '02', desc: 'PAYMENT RECEIVED', cat: 'Settle card', amount: 2500 };
  cardRows.push(out, inn); who2.set(out, cheque); who2.set(inn, card);
}
eq(debitOrderCommitments({ ...base, rows: cardRows, accountOfRow: who2 }).length, 0,
  'a fixed payment whose other leg lands on a card is left to the card commitment');

// control: the same fixed outflow with no card leg is still held
const plain = cardRows.filter(r => r.amount < 0).map(r => ({ ...r, desc: 'GYM CLUB', cat: 'Gym' }));
const who3 = new Map(plain.map(r => [r, cheque]));
eq(debitOrderCommitments({ ...base, rows: plain, accountOfRow: who3 }).length > 0, true,
  'control: the same fixed outflow with no card leg is still held');

/* 3. One card leg pairs with ONE outflow — the closest. On the vault this was
   found on, a one-off transfer settling the card landed on the 2nd, the same
   day it left the cheque account, and a fund debit order of the same amount
   left the cheque account on the 3rd. Pairing "any equal outflow within four
   days" let the card leg claim the fund order too, so that month dropped out
   of the order's run and the whole order stopped being held. */
const fund = { name: 'Fund', type: 'investment', dated: true, inBudget: false, implied: 50000, importedTo: '2026-09-26' };
const mixed = [];
const who4 = new Map();
for (const d of DAYS) {
  const order = { date: d, desc: 'FUND DEBIT ORDER', cat: 'Fund', amount: -1500 };
  mixed.push(order); who4.set(order, cheque);
}
mixed[1].date = '2026-08-03';
const settleOut = { date: '2026-08-02', desc: 'CARD TOP-UP', cat: 'Transfer', amount: -1500, excluded: true };
const settleIn = { date: '2026-08-02', desc: 'CARD TOP-UP', cat: 'Transfer', amount: 1500, excluded: true };
mixed.push(settleOut, settleIn); who4.set(settleOut, cheque); who4.set(settleIn, card);
const kept = debitOrderCommitments({ ...base, rows: mixed, accountOfRow: who4 });
eq(kept.some(i => i.name === 'Fund'), true, 'a same-amount fund order a day after a card settlement is still held');
eq(kept.some(i => /TOP-UP/.test(i.detail || '')), false, 'the settlement itself is paired with its card leg and not held');

console.log(`PASS committed-debit-orders-split-and-card.test.cjs (${checks} checks)`);
