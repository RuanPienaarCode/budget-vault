'use strict';
/* The donut legend's one-unit case, and the minus every signed part prints
   with (2026-10-14 audit, L2a-N08 and the Dashboard half of L2a-N09;
   2026-10-20 audit, M1-01).

   The Spent column is allocated by largest remainder so it sums to the centre
   total, and that can lift one row by a whole unit. The 2026-10-14 audit saw a
   category that cost exactly the same to the cent in every period print a
   Spent one unit above its baseline and a Change of "+R 1", and took the
   Change from the category's unrounded amount instead — the rule this file is
   named after. The 2026-10-20 audit reversed that (M1-01): the Change is
   printed Spent − printed baseline again, because a reader checks it against
   the two figures beside it and the repo's reconciliation does too, and on
   that rule the unrounded Change failed real rows. What answers the original
   complaint now is the deadband: a one-unit difference is what two roundings
   produce on their own, so the lifted row prints "+R 1" and reads FLAT — no
   colour, not a movement. This file pins that case;
   tests/dash-donut-printed-figures.test.cjs pins the rule across every row.

   Minus style (L2a-N09, Dashboard half): the Change column's "−R 2 300" is the
   household's one form for a signed part (currency.js formatSigned), and the
   what's-left card's confirmation-day sentence printed its net as "R -12 000"
   beside it. That sentence now uses the same form; the second half of this
   file pins it.

   Synthetic household: three categories whose cents force the allocation to lift
   the first row by one unit.

     node tests/donut-change-from-printed.test.cjs */
const assert = require('assert');
const { B, tx, base, account, textOf, find, hasClass, renderDash } = require('./helpers/dash-audit.cjs');
const { formatSigned } = require('../src/currency');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the helper: a part of a sum, sign decided from the rounded magnitude ---- */
{
  const za = { thousands: ' ', decimal: ',' }, us = { thousands: ',', decimal: '.' };
  eq(formatSigned('R', -2300, 0, za), '\u2212R 2 300', 'a negative part: the minus before the symbol');
  eq(formatSigned('R', 1261, 0, za), 'R 1 261', 'a positive part carries no sign');
  eq(formatSigned('R', -0.4, 0, za), 'R 0', 'a part that rounds to nothing carries no minus');
  eq(formatSigned('R', -0.4, 2, us), '\u2212R 0.40', 'but keeps it while a digit survives');
  eq(formatSigned('R', NaN, 0, za), 'R 0', 'non-finite reads 0, as formatAmount does');
}

(async () => {
  const files = {
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
  };
  /* Three earlier periods, each with the same early-month spend. Groceries is
     1250.48 in every one of them (so the true change is exactly nothing), Phone
     and Car loan carry the cents that decide who gets the allocated unit. */
  for (const mm of ['06', '07', '08']) {
    files[`${B}/Transactions/Cheque/2026-${mm}.md`] = tx([
      [`2026-${mm}-02`, 'Checkers', 'Groceries', -1250.48],
      [`2026-${mm}-02`, 'Airtime', 'Phone', -100.40],
      [`2026-${mm}-02`, 'Instalment', 'Car loan', -100.30],
    ]);
  }
  files[`${B}/Transactions/Cheque/2026-09.md`] = tx([
    ['2026-09-03', 'Checkers', 'Groceries', -1250.48],
    ['2026-09-03', 'Airtime', 'Phone', -100.40],
    ['2026-09-03', 'Instalment', 'Car loan', -100.30],
  ]);
  const { nodes } = await renderDash(files, { today: '2026-09-10' });
  const rows = find(nodes.get('#dashSplit'), n => n.tagName === 'LI' && n._parent && hasClass(n._parent, 'donut-legend')
    && !hasClass(n, 'donut-legend-head'));
  const cell = (li, cls) => textOf(find(li, n => hasClass(n, cls))[0]);
  const groceries = rows.find(li => /Groceries/.test(cell(li, 'dl-name')));
  ok(groceries, 'the Groceries legend row is rendered');
  /* The allocation did lift this row (that is the premise): the Change is the
     printed sum, and it reads flat — no colour, so not a movement. */
  eq(cell(groceries, 'dl-val'), 'R 1 251', 'premise: the Spent column was allocated one unit above plain rounding');
  eq(cell(groceries, 'dl-base'), 'R 1 250', 'premise: the baseline is the plain rounded average');
  eq(cell(groceries, 'dl-delta'), '+R 1', 'the Change is 1 251 − 1 250, the sum the reader does');
  ok(hasClass(find(groceries, n => hasClass(n, 'dl-delta'))[0], 'is-flat'), 'and reads flat: the category cost what it always costs');

  /* Every row nothing moved in reads flat, whatever the allocation did to it. */
  for (const li of rows) {
    const name = cell(li, 'dl-name');
    if (['Groceries', 'Phone', 'Car loan'].includes(name)) {
      ok(hasClass(find(li, n => hasClass(n, 'dl-delta'))[0], 'is-flat'), `${name}: nothing moved, nothing is coloured`);
    }
  }
  ok(!/−/.test(textOf(nodes.get('#dashSplit'))), 'no typographic minus in the donut legend');

  /* A real fall and a real rise print in money()'s one form. */
  const moved = { ...files };
  moved[`${B}/Transactions/Cheque/2026-09.md`] = tx([
    ['2026-09-03', 'Checkers', 'Groceries', -2250.48],     // +1000 against a 1250,48 baseline
    ['2026-09-03', 'Airtime', 'Phone', -50.40],            // -50 against 100,40
    ['2026-09-03', 'Instalment', 'Car loan', -100.30],
  ]);
  const r2 = await renderDash(moved, { today: '2026-09-10' });
  const rows2 = find(r2.nodes.get('#dashSplit'), n => n.tagName === 'LI' && n._parent && hasClass(n._parent, 'donut-legend')
    && !hasClass(n, 'donut-legend-head'));
  const byName = n => rows2.find(li => new RegExp(n).test(cell(li, 'dl-name')));
  eq(cell(byName('Groceries'), 'dl-delta'), '+R 1 001', 'a rise: an explicit plus before the symbol (2 251 − 1 250 as printed)');
  eq(cell(byName('Phone'), 'dl-delta'), '−R 50', 'a fall: the typographic minus before the symbol');

  /* The what's-left card's confirmation-day net: a signed part, in the same form
     (it printed "R -2 800" beside the legend's "−R 50"). */
  const left = await renderDash({
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '9000.00', balance_updated: '2026-09-10' }),
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-10', 'Rent', 'Groceries', -2500], ['2026-09-10', 'Gym', 'Groceries', -300]]),
  }, { today: '2026-09-20', period: '2026-09' });
  const leftText = left.t('#leftBody');
  ok(/2 rows on a confirmation day \(\u2212R 2 800\)/.test(leftText), `the net reads as a signed part — got: ${leftText}`);
  ok(!/R -2 800/.test(leftText), 'and not in the balance form');

  console.log(`PASS donut-change-from-printed — the allocation's one-unit lift prints in the Change as the printed sum and reads flat, and a change reads as a signed part (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
