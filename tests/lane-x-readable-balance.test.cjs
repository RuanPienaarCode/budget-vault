'use strict';
/* One rule for "is this account's balance readable" (2026-09-29 audit).

   The loader parses "about 300" to 0 and keeps the text in `balanceRaw`. An
   unreadable balance is UNKNOWN, not zero - so it is held out of net worth,
   out of the what's-left cash (where "0 plus the rows since" would be a figure
   the reader never wrote) and named on the Accounts page. The predicate that
   says so existed three times: figures.js balanceBook(), the Dashboard's
   account list (added last wave) and accounts.js. It is now exported once
   from figures.js and the other two import it.

   `balanceRaw != null` alone is the wrong test: it is set on "1 234,56" too,
   which normalizeAmount reads correctly, and that balance is real money.

     node tests/lane-x-readable-balance.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { B, tx, base, account, find, hasClass, textOf, figNumber, renderDash } = require('./helpers/dash-audit.cjs');
const registerFigures = require('../src/figures');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1. the predicate, exported ------------------------------------------- */
{
  const { balanceReadable } = registerFigures;
  ok(typeof balanceReadable === 'function', 'figures.js exports the predicate');
  eq(balanceReadable({ balance: 300 }), true, 'no raw text kept: readable');
  eq(balanceReadable({ balance: 300, balanceRaw: null }), true, 'a null raw cell: readable');
  eq(balanceReadable({ balance: 1234.56, balanceRaw: '1 234,56' }), true,
    'raw text kept for a decimal comma that normalizeAmount reads: readable');
  eq(balanceReadable({ balance: 0, balanceRaw: 'about 300' }), false, 'prose in the cell: unreadable');
  eq(balanceReadable({ balance: 0, balanceRaw: 'N/A' }), false, 'N/A: unreadable');
}

/* ---- 2. no second spelling anywhere but figures.js --------------------------- */
{
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const f of ['views/dashboard.js', 'views/accounts.js']) {
    ok(!/normalizeAmount\(\s*\w+\.balanceRaw/.test(src(f)), `${f} does not re-spell the predicate`);
    ok(/balanceReadable/.test(src(f)), `${f} imports it`);
  }
  ok(/balanceReadable/.test(src('figures.js')), 'figures.js owns it');
}

/* ---- 3. one account, three surfaces, one verdict ------------------------------ */
(async () => {
  const files = {
    ...base(),
    [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '20000.00', balance_updated: '2026-09-27' }),
    /* Unreadable, and it holds a row dated after its confirmation: were it
       counted, cash and net worth would each read R500 higher. */
    [`${B}/Accounts/Vague.md`]: account('Vague', { balance: '"about 300"', balance_updated: '2026-08-15' }),
    [`${B}/Transactions/Vague/2026-08.md`]: tx([['2026-08-20', 'Cash in', 'Transfer', 500]]),
    /* Readable, though written in a non-canonical format: counted everywhere. */
    [`${B}/Accounts/Comma.md`]: account('Comma', { balance: '"1 234,56"', balance_updated: '2026-09-27' }),
  };
  const M = await renderDash(files, { today: '2026-09-29' });
  const { ctx, nodes, t } = M;

  eq(figNumber(nodes.get('#leftBody'), 'left-cash'), 21235, 'the what\'s-left cash holds Vague out and keeps Comma');
  ok(/1 account balance could not be read/.test(t('#leftBody')), 'and names exactly one unreadable balance');

  eq(figNumber(nodes.get('#dashPositionKpis'), 'pos-net'), 21235, 'net worth holds Vague out and keeps Comma');

  ctx.renderAccounts();
  const acct = textOf(ctx.$('#acctSummary'));
  ok(/1 account balance could not be read/.test(acct), `the Accounts page names the same single account: ${acct}`);
  const hero = find(ctx.$('#acctSummary'), n => hasClass(n, 'hero-num'))[0];
  eq(textOf(hero).replace(/[^\d]/g, ''), '2123456', `and its hero sums the same two readable balances (${textOf(hero)})`);

  console.log(`PASS - lane X, one readable-balance rule across net worth, cash and Accounts (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
