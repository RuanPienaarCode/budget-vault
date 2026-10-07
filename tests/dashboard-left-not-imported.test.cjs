'use strict';
/* The What's-left card, rendered: a debit order that fell due after its
   account's last import is held in "still committed" and named, and the cash
   figure says how fresh it is.

   The pure rule is pinned in tests/committed-not-imported.test.cjs. This file
   pins the half that file cannot see: that the Dashboard hands committed.js
   the facts it decides with (each account's newest row, its confirmed balance
   date, which account every row belongs to), and that the card prints what
   comes back — the held rows by name, their count beside "still committed",
   and the date the cash figure is known to. Synthetic household, real loader,
   real view, clock pinned.

     node tests/dashboard-left-not-imported.test.cjs */

const assert = require('assert');
const { B, tx, base, account, cat, find, hasClass, textOf, figNumber, renderDash } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const TODAY = '2026-10-07';

/* A payday month (22nd to 21st), so on 7 October the period opened on
   22 September and three debit orders fell due on 1 October in between. */
function household(extraCardRows = [], extraChequeRows = []) {
  const svc = '---\nkind: services\n---\n\n'
    + '| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes | Currency |\n'
    + '|---|---|---:|---|---|---|---|---|---|\n'
    + '| Gym | GymCo | 300.00 | monthly |  | Bills | yes |  |  |\n'
    + '| Fibre | FibreCo | 600.00 | monthly |  | Bills | yes |  |  |\n'
    + '| Stream | StreamCo | 100.00 | monthly |  | Bills | yes |  |  |\n';
  return {
    ...base(),
    [`${B}/Settings.md`]: '---\nmonth_start_day: 22\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Bills.md`]: cat('expense'),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-09-10' }),
    /* A card in credit is cash like any other positive balance. */
    [`${B}/Accounts/Card.md`]: account('Card', { type: 'credit_card', balance: '1000.00', balance_updated: '2026-09-10' }),
    [`${B}/Services.md`]: svc,
    [`${B}/Transactions/Cheque/2026-07.md`]: tx([['2026-07-01', 'FIBRECO 4471', 'Bills', -600]]),
    [`${B}/Transactions/Cheque/2026-08.md`]: tx([['2026-08-01', 'FIBRECO 4471', 'Bills', -600]]),
    /* Last imported row: the 26th. */
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([
      ['2026-09-01', 'FIBRECO 4471', 'Bills', -600],
      ['2026-09-26', 'Corner shop', 'Groceries', -200],
    ]),
    [`${B}/Transactions/Cheque/2026-10.md`]: tx(extraChequeRows),
    [`${B}/Transactions/Card/2026-07.md`]: tx([['2026-07-01', 'GYMCO DEBIT', 'Bills', -300]]),
    [`${B}/Transactions/Card/2026-08.md`]: tx([
      ['2026-08-01', 'GYMCO DEBIT', 'Bills', -300],
      ['2026-08-15', 'STREAMCO', 'Bills', -100],
    ]),
    /* Last imported row: the 29th. */
    [`${B}/Transactions/Card/2026-09.md`]: tx([
      ['2026-09-01', 'GYMCO DEBIT', 'Bills', -300],
      ['2026-09-15', 'STREAMCO', 'Bills', -100],
      ['2026-09-29', 'Coffee', 'Groceries', -50],
    ]),
    [`${B}/Transactions/Card/2026-10.md`]: tx(extraCardRows),
  };
}

const metaOf = (body, fig) => {
  const tile = find(body, n => hasClass(n, 'left-fig') && find(n, x => x.attrs && x.attrs['data-fig'] === fig).length)[0];
  return tile ? textOf(find(tile, n => hasClass(n, 'lm'))[0]) : '';
};
const discRows = body => find(body, n => n.tagName === 'TR' && find(n, x => hasClass(x, 'dn')).length)
  .map(tr => textOf(tr).replace(/\s+/g, ' '));

(async () => {
  /* ---- 1. both 1 October orders held, named, and taken off "free" ---- */
  {
    const { nodes } = await renderDash(household(), { today: TODAY });
    const body = nodes.get('#leftBody');
    /* Cash: Cheque 20 000 − 200 since its confirmation, Card 1 000 − 150. */
    eq(figNumber(body, 'left-cash'), 20650, 'cash is the two implied balances');
    eq(figNumber(body, 'left-committed'), 1000, 'still committed holds Fibre 600 and Gym 300 beside Stream 100');
    eq(figNumber(body, 'left-free'), 19650, '"actually free" = cash − committed, including the held orders');

    const rows = discRows(body);
    const fibre = rows.find(r => /^Fibre/.test(r)) || '';
    const gym = rows.find(r => /^Gym/.test(r)) || '';
    const stream = rows.find(r => /^Stream/.test(r)) || '';
    ok(/due 2026-10-01 — not imported yet/.test(fibre), `Fibre is named as not imported yet: ${fibre}`);
    ok(/due 2026-10-01 — not imported yet/.test(gym), `Gym is named as not imported yet: ${gym}`);
    ok(/usually about R 300/.test(gym), `and priced from its charges: ${gym}`);
    ok(/expected 2026-10-15/.test(stream) && !/not imported/.test(stream), `Stream is simply still to come: ${stream}`);

    const com = metaOf(body, 'left-committed');
    ok(/3 debit orders · 2 not imported yet/.test(com), `the committed tile counts the held orders: ${com}`);
    const cashMeta = metaOf(body, 'left-cash');
    ok(/2 accounts · as of 2026-09-26/.test(cashMeta), `the cash figure names its earliest import: ${cashMeta}`);
  }

  /* ---- 2. NEGATIVE CONTROL: the card imported past the 1st -------------
     Gym has now been imported past its due date with no charge, so it is
     missing, not pending: dropped exactly as before. Fibre's account is
     still behind, so Fibre stays held. */
  {
    const { nodes, t } = await renderDash(household([['2026-10-03', 'Coffee', 'Groceries', -20]]), { today: TODAY });
    const body = nodes.get('#leftBody');
    eq(figNumber(body, 'left-committed'), 700, 'Fibre 600 + Stream 100: Gym is missing, not held');
    ok(!discRows(body).some(r => /^Gym/.test(r)), `Gym is not listed: ${t('#leftBody')}`);
    ok(/as of 2026-09-26/.test(metaOf(body, 'left-cash')), 'the cheque account still dates the cash figure');
  }

  /* ---- 3. a charge that landed is cash, not committed ------------------ */
  {
    const { nodes } = await renderDash(household(
      [['2026-10-01', 'GYMCO DEBIT', 'Bills', -300]],
      [['2026-10-01', 'FIBRECO 4471', 'Bills', -600]]), { today: TODAY });
    const body = nodes.get('#leftBody');
    eq(figNumber(body, 'left-committed'), 100, 'both orders were imported, so only Stream is still to come');
    ok(!/not imported/.test(metaOf(body, 'left-committed')), 'and nothing is counted as held');
    eq(figNumber(body, 'left-cash'), 20650 - 900, 'the two charges are in cash now, once');
    ok(/as of 2026-10-01/.test(metaOf(body, 'left-cash')), 'and the cash figure is dated by the newer import');
  }

  /* ---- 4. no as-of line when the cash figure is current to today ------- */
  {
    const { nodes } = await renderDash(household(
      [['2026-10-07', 'Coffee', 'Groceries', -20]],
      [['2026-10-07', 'Corner shop', 'Groceries', -20]]), { today: TODAY });
    ok(!/as of/.test(metaOf(nodes.get('#leftBody'), 'left-cash')), 'a figure known up to today has nothing to qualify');
  }

  console.log(`PASS dashboard-left-not-imported (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
