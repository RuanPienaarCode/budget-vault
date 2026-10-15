'use strict';
/* A debt whose Original was never stated does not show "Paid off 0%".

   L2b-08 (Low). The loader gives a debt with a blank Original cell an original
   equal to its balance, "for arithmetic only" (ADR-0007), and records that with
   `originalStated: false`. The Debts table's "Paid off" column then computed
   (original - balance) / original from that stand-in and printed "0%" against a
   mortgage that has been paid down for years - in a book where the other debts
   state an Original and show a real share. A zero that means "we do not know"
   read exactly like a zero that means "nothing paid".

   Now a row with `originalStated === false` prints the em dash the column
   already uses for "no original" - but only when other debts DO state one. When
   no debt states an Original the column header already says "(since you added
   it)", which labels every 0% in it honestly, and that behaviour is unchanged.

   Real loader, real view, DOM stub.
     node tests/debts-paid-off-unstated-original.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

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
const MIXED = [
  '| Bond | Bank A | home | 900000.00 |  | 10.5 | 9500.00 | 0.00 | 2020-01-01 |  | active |  |  |',
  '| Card | Bank B | credit_card | 25000.00 | 30000.00 | 21.5 | 1500.00 | 0.00 | 2025-01-15 |  | active |  |  |',
  '| Car | Bank C | vehicle | 120000.00 | 200000.00 | 12.25 | 4800.00 | 0.00 | 2023-03-10 |  | active |  |  |',
];
const NONE_STATED = [
  '| Bond | Bank A | home | 900000.00 |  | 10.5 | 9500.00 | 0.00 | 2020-01-01 |  | active |  |  |',
  '| Card | Bank B | credit_card | 25000.00 |  | 21.5 | 1500.00 | 0.00 | 2025-01-15 |  | active |  |  |',
];

const walk = (n, f, out = []) => { for (const c of (n && n.children) || []) { if (c.nodeType === 1) { if (f(c)) out.push(c); walk(c, f, out); } } return out; };
const text = n => String((n && n.textContent) || '').replace(/\s+/g, ' ').trim();

async function render(rows) {
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
  const head = walk(table, n => n.tagName === 'TH').map(text);
  const col = head.findIndex(h => /^Paid off/.test(h));
  const cell = name => {
    // The row whose Remove button is labelled for exactly this name ("Car" is a prefix of "Card").
    const tr = walk(table, n => n.tagName === 'TR' && n.children.some(c => c.tagName === 'TD'))
      .find(r => walk(r, x => x.tagName === 'BUTTON').some(x => x.attrs['aria-label'] === `Remove ${name}`));
    const tds = tr.children.filter(c => c.tagName === 'TD');
    // The share itself is the cell's first child; a row can carry a second line
    // under it (the schedule's implied balance), which is a different claim.
    return text(tds[col].children[0]);
  };
  return { S, head: head[col], cell };
}

(async () => {
  /* ---- 1. a mixed book: the unstated debt gets a dash, the stated ones a share ---- */
  {
    const r = await render(MIXED);
    eq(r.S.debts.map(d => d.originalStated), [false, true, true], 'the loader marks the blank Original as not stated');
    eq(r.head, 'Paid off', 'a mixed book keeps the plain header');
    eq(r.cell('Bond'), '—', 'a debt with no stated Original prints the dash, not "0%"');
    ok(/^\d+%$/.test(r.cell('Card')) && r.cell('Card') !== '0%', `a debt that states one still shows its share (${r.cell('Card')})`);
    eq(r.cell('Car'), '40%', 'and the share is computed from the stated Original (200 000 -> 120 000)');
  }
  /* ---- 2. nothing stated anywhere: the header carries the explanation, rows unchanged ---- */
  {
    const r = await render(NONE_STATED);
    eq(r.head, 'Paid off (since you added it)', 'when no debt states an Original the header says the share counts from today');
    eq(r.cell('Bond'), '0%', 'and the rows keep the 0% that header labels');
  }
  console.log(`PASS debts-paid-off-unstated-original (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
