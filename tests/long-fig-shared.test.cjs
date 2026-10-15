'use strict';
/* The size step-down for a figure of seven or more digits was two copies, one
   in views/dashboard.js and one in views/budgets.js, and the Dashboard's was
   pinned by nothing: a mutation of it (threshold 7 -> 99) survived the whole
   suite (2026-10-14 audit, L8-06). It is one helper in src/dom.js now, both
   pages import it, and this pins the helper and one real Dashboard render.

     node tests/long-fig-shared.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { B, tx, base, account, find, hasClass, renderDash } = require('./helpers/dash-audit.cjs');
const { longFig } = require('../src/dom');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- the helper: digits, not characters ---- */
eq(longFig('R 123 456'), '', 'six digits fit');
eq(longFig('R 1 234 567'), ' is-long', 'seven digits step down');
eq(longFig('R 12 345,67'), ' is-long', 'a figure printed to cents counts its decimals: 7 digits');
eq(longFig('R 1 234,56'), '', '... and 6 do not');
eq(longFig('R -1 234 567'), ' is-long', 'the sign and symbol are not digits');
eq(longFig(''), '', 'empty is short');
eq(longFig(undefined), '', 'undefined is short');
eq(longFig(1234567), ' is-long', 'a bare number is stringified');

/* ---- one copy: neither view declares its own ---- */
for (const f of ['dashboard', 'budgets']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', `${f}.js`), 'utf8');
  ok(!/const longFig\s*=/.test(src), `${f}.js declares no longFig of its own`);
  ok(/\blongFig\b[^;\n]*\} = require\('\.\.\/dom'\)/.test(src), `${f}.js imports it from dom.js`);
}

/* ---- one real Dashboard render: the hero figure steps down at seven digits ---- */
const vault = budget => ({
  ...base(),
  [`${B}/Accounts/Cheque.md`]: account('Cheque', { balance: '5000.00', balance_updated: '2026-09-01' }),
  [`${B}/Budgets/2026-09.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + `| Salary | income | 30000.00 |  |\n| Groceries | expense | ${budget} |  |\n`,
  [`${B}/Transactions/Cheque/2026-09.md`]: tx([['2026-09-01', 'Salary', 'Salary', 30000], ['2026-09-05', 'Checkers', 'Groceries', -250]]),
});
(async () => {
  const heroNum = async budget => {
    const d = await renderDash(vault(budget), { today: '2026-09-20', period: '2026-09' });
    return find(d.nodes.get('#heroCard'), n => hasClass(n, 'hero-num'))[0];
  };
  const big = await heroNum('2000000.00');
  ok(hasClass(big, 'is-long'), 'a R1 999 750 remainder carries is-long on the hero figure');
  const small = await heroNum('5000.00');
  ok(!hasClass(small, 'is-long'), 'a R4 750 remainder does not');

  console.log(`PASS long-fig-shared — one longFig in dom.js, read by both pages, and the Dashboard hero steps down at seven digits (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
