'use strict';
/* A transaction amount is a FLOW, and prints in the one form this app gives a
   signed flow: "−R 50,00" / "+R 410,00" (2026-10-20 audit, D2-04, D1-12, MT-02).

   The Transactions Amount column used to mix two forms in one column. Income
   read "+R 410,00", the plus drawn by a CSS ::before in
   src/statement/transactions.css; spending read "R -50,00", money()'s BALANCE
   form, with an ASCII hyphen AFTER the symbol. The Dashboard and the Accounts
   page print the same kind of figure — a signed movement of money — as
   "−R 3 922": a true minus (U+2212) BEFORE the symbol. The rule is written in
   the header of src/currency.js: a balance prints "R -500"; a signed flow,
   part or change prints through formatSigned. A row is not a balance; it is
   money that moved.

   The plus was also invisible to everything that reads text rather than
   pixels: generated content is not in textContent, so a copy of the column, a
   test, and (in most readers) a screen reader got "R 410,00" for income and
   "R -50,00" for spending.

   What this pins, through the REAL loader, the REAL renderTransactions and the
   REAL formatter (tests/helpers/figures.cjs mountFor):
     1. every amount cell reads in the flow form — minus or plus BEFORE the
        symbol, U+2212 never U+002D, and no "R -" anywhere in the column;
     2. a figure that rounds to nothing carries no sign, the rule formatSigned
        applies to its minus ("a minus must not outlive the rounding that
        erased the number"), applied to the plus too;
     3. a row on a foreign account carries its own symbol in the same form;
     4. the sign is the cell's own TEXT ahead of the figure, and the figure's
        span starts with the currency symbol — so the statement sheet's
        muted-symbol ::first-letter still lands on the symbol and not on the
        sign;
     5. the colour classes are where they were (income green, `num` first);
     6. the stylesheet no longer draws a sign of its own, keeps the figure a
        block container for ::first-letter, and never lets the sign and the
        figure wrap apart.
   And the file still saves what it read: display only, never the Amount.

     node tests/transactions-amount-flow-sign.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { readRules } = require('./helpers/css-sources.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const MINUS = '−';
const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const CHEQUE = `${B}/Transactions/Cheque/2026-09.md`;
const EURO = `${B}/Transactions/Travel Euro/2026-09.md`;
/* Every figure is made up. */
const CHEQUE_BODY = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD
  + '| 2026-09-01 | Pay | Salary | 410.00 |  |  |\n'
  + '| 2026-09-02 | Corner shop | Groceries | -50.00 |  |  |\n'
  + '| 2026-09-03 | Big shop | Groceries | -12345.60 |  |  |\n'
  + '| 2026-09-04 | Rounding in | Salary | 0.004 |  |  |\n'
  + '| 2026-09-05 | Rounding out | Groceries | -0.004 |  |  |\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1000.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Accounts/Travel Euro.md`]: '---\ntype: savings\ncurrency: "€"\nbalance: 500.00\nbalance_updated: 2026-09-30\n---\n',
  [CHEQUE]: CHEQUE_BODY,
  [EURO]: '---\naccount: "Travel Euro"\nmonth: 2026-09\n---\n\n' + HEAD
    + '| 2026-09-06 | Hotel | Groceries | -900.00 |  |  |\n',
};

const rowsOf = node => {
  const out = [];
  (function walk(n) { if (n.tagName === 'TR') out.push(n); (n.children || []).forEach(walk); })(node);
  return out;
};
const cellsOf = tr => (tr.children || []).filter(c => c.tagName === 'TD');
const spans = n => (n.children || []).filter(c => c.tagName === 'SPAN');
const AMOUNT = 4;

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const { ctx, S } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
    ctx.renderTransactions();
    const table = ctx.$('#txTable');
    const byDesc = d => {
      const tr = rowsOf(table).find(r => cellsOf(r).some(c => c.textContent === d));
      assert.ok(tr, `row ${d} rendered`);
      return cellsOf(tr)[AMOUNT];
    };

    /* ---- 1-3. the printed text of every amount cell ---- */
    const WANT = [
      ['Pay', '+R 410,00', '+'],
      ['Corner shop', `${MINUS}R 50,00`, MINUS],
      ['Big shop', `${MINUS}R 12 345,60`, MINUS],
      ['Rounding in', 'R 0,00', ''],
      ['Rounding out', 'R 0,00', ''],
      ['Hotel', `${MINUS}€ 900,00`, MINUS],
    ];
    for (const [desc, text, sign] of WANT) {
      const cell = byDesc(desc);
      eq(cell.textContent, text, `${desc}: the amount prints as a flow, "${text}" (got "${cell.textContent}")`);
      const kids = cell.children || [];
      const fig = spans(cell).find(s => s.classList.contains('tx-amt'));
      ok(spans(cell).length === 1 && fig, `${desc}: the figure is the cell's one span, .tx-amt`);
      if (sign) {
        ok(kids.length === 2 && kids[0].tagName === '#TEXT' && kids[0].textContent === sign && kids[1] === fig,
          `${desc}: the sign is the cell's own text, ahead of the figure — never a stylesheet ::before`);
      } else {
        ok(kids.length === 1 && kids[0] === fig,
          `${desc}: a figure that rounds to nothing carries no sign at all — not "+R 0,00", not "${MINUS}R 0,00"`);
      }
      ok(/^(R|€) /.test(fig.textContent),
        `${desc}: the figure's span STARTS with the symbol, so ::first-letter mutes the symbol and not the sign (got "${fig.textContent}")`);
    }

    const amounts = rowsOf(table).map(cellsOf).filter(c => c.length > AMOUNT).map(c => c[AMOUNT].textContent);
    eq(amounts.length, WANT.length, 'every row of the period is on the page');
    ok(amounts.every(a => !/[R€] -/.test(a)), `no amount prints the BALANCE form "R -50,00": ${JSON.stringify(amounts)}`);
    ok(amounts.every(a => !a.includes('-')), 'and no amount carries an ASCII hyphen as its minus');

    /* ---- 5. the colour classes are where they were ---- */
    ok(byDesc('Pay').classList.contains('text-success'), 'income keeps its green');
    ok(!byDesc('Corner shop').classList.contains('text-success'), 'spending does not');
    ok(byDesc('Pay').className.split(' ')[0] === 'num' && byDesc('Hotel').className.split(' ')[0] === 'num',
      '`num` stays the cell\'s first class (the figures harness addresses the cell by it)');
    ok(byDesc('Corner shop').classList.contains('st-cur1'), 'a one-character household symbol still gets the muted-symbol class');

    /* ---- display only: the file is written back byte for byte ---- */
    eq(ctx.serializeTxFile(S.txFiles['Cheque/2026-09']).split('\n').filter(l => l.startsWith('| 2026')),
      CHEQUE_BODY.split('\n').filter(l => l.startsWith('| 2026')),
      'saving writes every Amount exactly as it was read — the flow form is display, never data');
  } finally { unpin(); }

  /* ---- 6. the stylesheet ---- */
  const rules = readRules();
  const tx = rules.filter(r => r.selectors.some(s => s.includes('#view-transactions')));
  const drawnSign = tx.filter(r => r.selectors.some(s => /td\.num[^,]*::?before$/.test(s))
    && r.decls.some(d => d.prop === 'content' && /['"][+−-]['"]/.test(d.value)));
  eq(drawnSign.map(r => r.prelude), [], 'the stylesheet draws no sign of its own on the amount cell — the sign is text now, and drawing it too would print it twice');
  const firstLetter = tx.filter(r => r.selectors.some(s => /td\.num\.st-cur1 \.tx-amt::first-letter$/.test(s)));
  ok(firstLetter.length === 1, 'the muted-symbol ::first-letter rule targets the figure\'s own span, whose first letter is the symbol');
  const block = tx.filter(r => r.selectors.some(s => /td\.num \.tx-amt$/.test(s)) && r.decls.some(d => d.prop === 'display' && d.value === 'inline-block'));
  ok(block.length >= 1, 'the figure\'s span is an inline-block — ::first-letter only applies to a block container');
  const nowrap = tx.filter(r => r.selectors.some(s => /td\.num(:not\(\.text-warning\))?$/.test(s)) && r.decls.some(d => d.prop === 'white-space' && d.value === 'nowrap'));
  ok(nowrap.length >= 1, 'the amount cell does not wrap, so the sign and its figure can never land on two lines');

  console.log(`PASS transactions-amount-flow-sign — every row amount prints as a flow ("${MINUS}R 50,00" / "+R 410,00"), the sign is text, and the symbol keeps its muted first letter (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
