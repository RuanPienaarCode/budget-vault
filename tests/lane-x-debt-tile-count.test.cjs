'use strict';
/* The Debt tile's account count and its amount are one figure (2026-09-29
   audit).

   The amount is worth().fromAccounts: IMPLIED balances (stated plus the rows
   dated after them), home currency only, unreadable balances held out. The
   count beside it ("all on N accounts") came from bookFigures().overdrawn,
   which counted STATED balances below zero across EVERY currency. On a
   household with an overdrawn card, a cheque account whose stated overdraft a
   later deposit has cleared, and an overdrawn euro card, the tile read one
   rand account's debt under the words "all on 3 accounts".

   Pinned on a synthetic household of exactly that shape.

     node tests/lane-x-debt-tile-count.test.cjs */
const assert = require('assert');
const { B, tx, base, account, figNumber, renderDash } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

(async () => {
  const files = {
    ...base(),
    /* Stated overdrawn, but a deposit dated after the statement clears it:
       implied +R1 500. Not a debt on the basis the amount is built on. */
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '-500.00', balance_updated: '2026-09-01' }),
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-05', 'Refund', 'Salary', 2000]]),
    /* Overdrawn on both bases: the one real debt, R300. */
    [`${B}/Accounts/Card.md`]: account('Card', { type: 'credit_card', balance: '-300.00', balance_updated: '2026-09-01' }),
    /* Overdrawn, but in euro: never part of a rand total. */
    [`${B}/Accounts/EuroCard.md`]: account('EuroCard', { type: 'credit_card', currency: '"€"', balance: '-100.00', balance_updated: '2026-09-01' }),
    /* Unreadable: unknown, held out of the amount and so out of the count. */
    [`${B}/Accounts/Vague.md`]: account('Vague', { balance: '"minus about 50"', balance_updated: '2026-09-01' }),
  };
  const M = await renderDash(files, { today: '2026-09-29' });
  const { ctx, nodes, t } = M;

  eq(figNumber(nodes.get('#dashPositionKpis'), 'pos-debt'), -300, 'the amount: the one home, readable, implied-negative account');
  const book = ctx.bookFigures();
  eq(book.overdrawn, 1, 'the count uses the same basis and scope: implied, home currency, readable');
  const tile = t('#dashPositionKpis');
  ok(/all on 1 account\b/.test(tile), `and the tile says so: ${tile}`);
  ok(!/all on [23] accounts/.test(tile), 'not the stated, every-currency count');
  console.log(`PASS - lane X, Debt tile count follows the amount's basis and scope (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
