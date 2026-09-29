'use strict';
/* The Dashboard drill-through hides what the BUDGET lens holds out — all of it
   (2026-09-29 totals audit, round 2).

   The donut wedge is a BUDGET-lens figure: it leaves out accounts with
   `budget: false`, accounts in another currency, and money paid OUT of an
   earmarked fund (that spending is shown on the hero as funded from savings).
   The drill-through hid only the first, so on a household where a pram was
   paid from the emergency fund the Groceries list added up to R3 900 under a
   R2 400 wedge (found by the reconcile's drill-through check). Each reason now
   has its own sentence in the note, because "outside the budget" is not true
   of an earmarked fund or a euro account.

   Synthetic household; the figures are invented.

     node tests/lane-int-drill-vetoes.test.cjs */
const assert = require('assert');
const { B, tx, base, account, find, hasClass, textOf, renderDash } = require('./helpers/dash-audit.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const sum = rows => Math.round(rows.reduce((t, r) => t + Number(r.amount || 0), 0) * 100) / 100;

function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}
function wire(ctx) {
  ctx.switchView = () => ctx.renderTransactions();
  const sel = realSelect(ctx.$('#txCategory'));
  ctx.$('#txWholeHistory').checked = false;
  return sel;
}
const note = ctx => textOf(ctx.$('#txScopeNote'));
const legendRow = (nodes, name) => find(nodes.get('#dashSplit'), n => n.tagName === 'LI'
  && find(n, m => hasClass(m, 'dl-name') && textOf(m) === name).length)[0];
const click = n => find(n, m => hasClass(m, 'dl-link'))[0]._fire('click');

const household = () => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
  [`${B}/Accounts/Emergency.md`]: account('Emergency', { type: 'savings', emergency_fund: 'true', balance: '30000.00', balance_updated: '2026-09-01' }),
  [`${B}/Accounts/EuroCheque.md`]: account('EuroCheque', { currency: '"€"', balance: '500', balance_updated: '2026-09-01' }),
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([
    ['2026-09-02', 'Checkers', 'Groceries', -2000],
    ['2026-09-03', 'Woolworths', 'Groceries', -400],
  ]),
  [`${B}/Transactions/Emergency/2026-09.md`]: tx([
    ['2026-09-04', 'Pram', 'Groceries', -1500],
  ]),
  [`${B}/Transactions/EuroCheque/2026-09.md`]: tx([
    ['2026-09-05', 'Carrefour', 'Groceries', -60],
  ]),
});

(async () => {
  const { ctx, nodes } = await renderDash(household(), { today: '2026-09-10' });
  const sel = wire(ctx);
  const wedge = legendRow(nodes, 'Groceries');
  ok(wedge, 'the Groceries legend row is rendered');
  const figure = Number(textOf(find(wedge, m => hasClass(m, 'dl-val'))[0]).replace(/[^\d]/g, ''));
  eq(figure, 2400, 'the wedge: Cheque only — not the fund-paid pram, not the euro row');

  click(wedge);
  eq(sel.value, 'Groceries', 'the drill-through selects the category');
  const rows = ctx.filteredRows().rows;
  eq(sum(rows), -figure, 'the rows listed add up to the wedge clicked');
  eq(rows.map(r => r.label).sort(), ['Cheque', 'Cheque'], 'only the budget account\'s rows');
  const n = note(ctx);
  ok(/1 row paid from a savings fund is hidden/.test(n), `the fund-paid row is named for what it is: ${n}`);
  ok(/1 row in another currency is hidden/.test(n), `the euro row too: ${n}`);
  ok(!/outside the budget/.test(n), `neither is called "outside the budget": ${n}`);

  /* Money INTO an earmarked fund is not spending from it; only outflows go. */
  {
    const f = household();
    f[`${B}/Transactions/Emergency/2026-09.md`] = tx([['2026-09-04', 'Refund on pram', 'Groceries', 300]]);
    const r2 = await renderDash(f, { today: '2026-09-10' });
    wire(r2.ctx);
    click(legendRow(r2.nodes, 'Groceries'));
    ok(r2.ctx.filteredRows().rows.some(r => r.label === 'Emergency'), 'an inflow to the fund stays listed');
  }

  /* "Show them" brings every hidden row back. */
  const show = find(ctx.$('#txScopeNote'), x => x.tagName === 'BUTTON')[0];
  show._fire('click');
  eq(ctx.filteredRows().rows.length, 4, 'all four Groceries rows are listed again');
  eq(note(ctx), '', 'and the note is gone');

  /* A category chosen by hand is the page as it always was. */
  {
    const r3 = await renderDash(household(), { today: '2026-09-10' });
    const s3 = wire(r3.ctx);
    r3.ctx.renderTransactions();
    s3.value = 'Groceries';
    r3.ctx.renderTransactions();
    eq(r3.ctx.filteredRows().rows.length, 4, 'hand-picked: every account\'s rows');
  }

  console.log(`PASS lane-int-drill-vetoes (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
