'use strict';
/* "On this plan it would be R… by now" is not printed from a stand-in Original.

   A debt whose Original cell is blank gets an original equal to its balance
   "for arithmetic only" (ADR-0007) and the loader records that as
   `originalStated: false`. The Paid off cell's second line - where the
   schedule says the debt should be today - ran expectedBalance() on that
   stand-in: it started a schedule at TODAY'S balance on the debt's START DATE,
   and then told the household their own figure disagreed with it. On a bond
   whose Original had been left blank the line read as a finding ("From R 900
   000.00 at 10.5% paying … since 2020-01-01 …") about a starting balance the
   household never gave. The tooltip even names it: "From <Original>".

   The same fact already switches off the Paid off share (L2b-08, tests/
   debts-paid-off-unstated-original.test.cjs). It switches this off too, in a
   book where no Original is stated and in one where some are: the derivation
   is false either way, and the "(since you added it)" header covers only the
   percentage. A debt that DOES state its Original keeps the line.

   Real loader, real view, DOM stub.
     node tests/debts-implied-balance-needs-stated-original.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const HEAD = '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n';
const files = rows => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Debts.md`]: `---\nkind: debts\n---\n\n${HEAD}${rows.join('\n')}\n`,
});
const BOND = '| Bond | Bank A | home | 900000.00 |  | 10.5 | 9500.00 | 0.00 | 2020-01-01 |  | active |  |  |';
const CARD = '| Card | Bank B | credit_card | 25000.00 | 30000.00 | 21.5 | 1500.00 | 0.00 | 2025-01-15 |  | active |  |  |';
const BOND_STATED = '| Bond | Bank A | home | 900000.00 | 1100000.00 | 10.5 | 9500.00 | 0.00 | 2020-01-01 |  | active |  |  |';

const walk = (n, f, out = []) => { for (const c of (n && n.children) || []) { if (c.nodeType === 1) { if (f(c)) out.push(c); walk(c, f, out); } } return out; };
const text = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();

async function implied(rows) {
  const ctx = makeCtx(files(rows));
  const S = await loadInto(ctx);
  S.period = '2026-10';
  const { $, nodes } = makeDom();
  $('#debtExtra').value = '0'; $('#debtStrategy').value = 'avalanche';
  ctx.$ = $; ctx.root = $('#root');
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/debts')(ctx);
  ctx.renderDebts();
  const table = nodes.get('#debtTable');
  const lines = {};
  for (const name of S.debts.map(d => d.name)) {
    const tr = walk(table, n => n.tagName === 'TR' && n.children.some(c => c.tagName === 'TD'))
      .find(r => walk(r, x => x.tagName === 'BUTTON').some(x => x.attrs['aria-label'] === `Remove ${name}`));
    lines[name] = walk(tr, n => n._cls && n._cls.has('debt-implied')).map(text);
  }
  return { S, lines };
}

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. the control: a debt that states its Original keeps the line ---- */
    {
      const r = await implied([BOND_STATED, CARD]);
      ok(r.lines.Card.length === 1 && /on this plan it would be/.test(r.lines.Card[0]),
        `a stated Original with a material gap still prints the line (${JSON.stringify(r.lines.Card)})`);
      ok(r.lines.Bond.length === 1, `and so does the bond once its Original is stated (${JSON.stringify(r.lines.Bond)})`);
    }
    /* ---- 2. a blank Original: no derivation from the stand-in ---- */
    {
      const r = await implied([BOND, CARD]);
      eq(r.S.debts.map(d => d.originalStated), [false, true], 'the loader marks the blank Original as not stated');
      eq(r.lines.Bond, [], 'a stand-in Original prints no "on this plan it would be" line');
      eq(r.lines.Card.length, 1, 'the neighbouring debt that states one is unaffected');
    }
    /* ---- 3. same when no debt in the book states one ---- */
    {
      const r = await implied([BOND]);
      eq(r.lines.Bond, [], 'and in a book where none does');
    }
    console.log(`PASS debts-implied-balance-needs-stated-original (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
