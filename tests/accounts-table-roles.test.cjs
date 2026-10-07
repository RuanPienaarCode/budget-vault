'use strict';
/* The Accounts table states its own table semantics (audit of 7 Oct 2026).

   At phone width (<600px) the Accounts rows become cards: each <tr> is laid
   out as a grid. WebKit drops the implicit table roles from a <tr> that is no
   longer display:table-row, so VoiceOver on an iPhone stops reading it as a
   table — the house note above dom.js tableCells, and the reason Transactions
   and Budget already stamp the roles explicitly. src/styles.css therefore gates
   the Accounts card layout on `#acctTable[role='table']`: without the roles the
   page keeps a (narrower) table rather than trading the reader's semantics for
   layout. This pins the half that lives in views/accounts.js — the roles are
   stamped on every render, on the body rows the page actually drew.

     node tests/accounts-table-roles.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX = rows => '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n'
  + `|---|---|---|---:|---|---|\n${rows.map(r => `| ${r[0]} | ${r[1]} |  | ${r[2].toFixed(2)} |  |  |`).join('\n')}\n`;
const acctFile = fm => `---\n${fm}\n---\n`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: acctFile('type: checking\nbalance: 1000.00\nbalance_updated: 2026-10-01'),
  [`${B}/Transactions/Cheque/2026-09.md`]: TX([['2026-09-15', 'Shop', -100]]),
  [`${B}/Accounts/Pot.md`]: acctFile('type: savings\nbalance: 500.00\nbalance_updated: 2026-10-01'),
  [`${B}/Transactions/Pot/2026-09.md`]: TX([['2026-09-20', 'Transfer in', 100]]),
};

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const ctx = makeCtx({ ...FILES });
    const S = await loadInto(ctx);
    S.period = '2026-10';
    const { $ } = makeDom();
    ctx.$ = $;
    ctx.$$ = () => [];
    ctx.root = $('#root');
    ctx.view = { containerEl: $('#root') };
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
    ctx.switchView = () => {};
    const { el } = require('../src/dom');
    ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
    require('../src/categories')(ctx);
    require('../src/views/accounts')(ctx);
    ctx.renderAccounts();

    const table = $('#acctTable');
    ok(table, 'the Accounts table rendered');
    ok(table.getAttribute('role') === 'table', `#acctTable carries role="table" (got ${table.getAttribute('role')})`);
    const rows = descend(table).filter(n => n._cls && n._cls.has('acct-row'));
    ok(rows.length === 2, `both accounts drew a row (got ${rows.length})`);
    for (const tr of rows) {
      ok(tr.getAttribute('role') === 'row', 'each account row carries role="row"');
      ok(tr.children.length > 0 && tr.children.every(td => td.getAttribute('role') === 'cell'),
        'and every cell in it carries role="cell"');
    }
    const heads = descend(table).filter(n => n.tagName === 'TH');
    ok(heads.length > 0 && heads.every(th => th.getAttribute('role') === 'columnheader'),
      'the header cells carry role="columnheader"');

    /* A re-render (filter, sort, drawer) rebuilds the body — the roles must
       follow, or the cards would fall back to a table after the first tap. */
    ctx.renderAccounts();
    const again = descend($('#acctTable')).filter(n => n._cls && n._cls.has('acct-row'));
    ok(again.length === 2 && again.every(tr => tr.getAttribute('role') === 'row'),
      'the roles are stamped again on every render');
  } finally {
    unpin();
  }
  console.log(`PASS — the Accounts table states its own table roles for the phone card layout (${checks} checks)`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
