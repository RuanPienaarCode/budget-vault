'use strict';
/* Phone-width tables keep their column names and their table semantics
   (2026-09-29 audit, round 2).

   Under 600px the Transactions and Budget tables stack each row into a small
   card (src/styles.css, "stacked rows"), so a row's controls are reachable
   without a sideways swipe. Two things go missing in that layout unless the
   markup carries them: the column headers (the card prints each cell's
   `data-label` instead), and the table semantics VoiceOver reads from
   display:table (a grid <tr> is no longer a row to it, so the ARIA roles say
   so explicitly). tableCells() in src/dom.js stamps both.

   Synthetic household; the figures are invented.

     node tests/lane-int-table-labels.test.cjs */
const assert = require('assert');
const { B, tx, base, account, renderDash } = require('./helpers/dash-audit.cjs');
const i18n = require('../src/i18n');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const kids = n => (n.children || []).filter(c => c && c.tagName);

function checkTable(table, labels, name) {
  eq(table.attrs.role, 'table', `${name}: the table says it is one`);
  const groups = kids(table);
  ok(groups.length >= 2, `${name}: thead and tbody`);
  for (const g of groups) eq(g.attrs.role, 'rowgroup', `${name}: ${g.tagName} is a rowgroup`);
  const [thead, tbody] = groups;
  for (const th of kids(kids(thead)[0])) eq(th.attrs.role, 'columnheader', `${name}: a header cell is a columnheader`);
  let rows = 0;
  for (const tr of kids(tbody)) {
    eq(tr.attrs.role, 'row', `${name}: a body row is a row`);
    const cells = kids(tr);
    cells.forEach((td, i) => {
      eq(td.attrs.role, 'cell', `${name}: a body cell is a cell`);
      if ('colspan' in td.attrs) { ok(!('data-label' in td.attrs), `${name}: a spanning row carries no label`); return; }
      if (labels[i]) eq(td.attrs['data-label'], labels[i], `${name}: column ${i + 1} is labelled "${labels[i]}"`);
      else ok(!('data-label' in td.attrs), `${name}: the actions cell is not labelled`);
    });
    if (!cells.some(td => 'colspan' in td.attrs)) rows++;
  }
  ok(rows > 0, `${name}: at least one data row was checked`);
}

(async () => {
  const files = {
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '10000.00', balance_updated: '2026-09-01' }),
    [`${B}/Transactions/Cheque/2026-09.md`]: tx([
      ['2026-09-02', 'Checkers', 'Groceries', -400],
      ['2026-09-03', 'Salary', 'Salary', 20000],
    ]),
    [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Salary | income | 20000.00 |  |\n| Groceries | expense | 3000.00 |  |\n',
  };
  const { ctx } = await renderDash(files, { today: '2026-09-10' });

  ctx.$('#txWholeHistory').checked = false;
  ctx.renderTransactions();
  checkTable(ctx.$('#txTable'), ['tx.col.date', 'tx.col.desc', 'tx.col.account', 'tx.col.category', 'tx.col.amount',
    'tx.col.excl', 'tx.col.note', null].map(k => (k ? i18n.t(k) : null)), 'Transactions');

  ctx.renderBudgets();
  checkTable(ctx.$('#budTable'), ['bud.col.category', 'bud.col.type', 'bud.col.amount', 'bud.col.actual', 'bud.col.notes', null]
    .map(k => (k ? i18n.t(k) : null)), 'Budget');

  console.log(`PASS lane-int-table-labels (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
