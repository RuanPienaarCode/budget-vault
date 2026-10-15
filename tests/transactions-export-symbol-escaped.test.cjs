'use strict';
/* The Currency column of the Transactions export's markdown is text the
   household typed, so it is escaped like every other text cell
   (2026-10-14 audit, L4b-03).

   An account's currency symbol comes from its frontmatter `currency:` — a
   cell any hand-edit, sync partner or imported note can set. exporter.js
   transactionRow ran it through escMd (pipes and line breaks only) on the
   reasoning that a symbol is "printed as part of a figure" and `$ 1 000`
   cannot open inline maths. That holds for a real symbol and for nothing
   else: `$![s](https://attacker.example/p.png)` is a "symbol" too, and in the
   exported note it became an image Obsidian fetches every time the note is
   opened (the other text cells were closed to exactly this in 2026-10-07,
   tests/transactions-export-markdown-escape.test.cjs). The symbol goes
   through escMdText now — a benign symbol (R, €, kr) comes out byte for
   byte as before, and `$` comes out as `\$`, which every reader renders as
   `$`.

     node tests/transactions-export-symbol-escaped.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { escMdText, parseMdTable } = require('../src/markdown');
const { transactionRow, transactionsMarkdown, txHeaderLines } = require('../src/exporter');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SYM = '$![s](https://attacker.example/p.png)';
const money = v => String(v);
const row = { date: '2026-01-02', desc: 'SHOP', label: 'Dollar', cat: 'Food', amount: -2, excluded: false, note: '', split: '' };

/* ---- the repro: the markdown note, three rows ------------------------------ */
{
  const rows = [1, 2, 3].map(i => ({ ...row, date: '2026-01-0' + i, amount: -i }));
  const md = transactionsMarkdown(rows, { range: { start: '2026-01-01', end: '2026-01-31' }, filters: [], generated: '2026-10-14' }, money, () => SYM);
  eq(md.split(SYM).length - 1, 0, 'the raw symbol payload appears nowhere in the exported note');
  eq(md.split(escMdText(SYM)).length - 1, 4, 'the three rows and the "Rows in … are listed" line carry it inert, as escMdText writes it');
  ok(!md.includes('![s]('), 'no image syntax survives');
}

/* ---- the cell is one cell, whatever the symbol holds ------------------------ */
{
  const width = txHeaderLines()[0].split('|').length - 2;
  for (const sym of [SYM, 'a|b', 'two\nlines', '<img src=x>', '[[Smart Budget]]', '#tag', '%% hidden %%']) {
    const line = transactionRow(row, money, () => sym);
    const cells = parseMdTable(`${txHeaderLines().join('\n')}\n${line}`)[1];
    eq(cells.length, width, `${JSON.stringify(sym)}: the row keeps the header's cell count`);
    eq(cells[4], escMdText(sym), `${JSON.stringify(sym)}: the Currency cell is escMdText(symbol)`);
  }
}

/* ---- real symbols are not disturbed ------------------------------------------ */
{
  for (const sym of ['R', '€', '£', 'kr', 'Rp', 'CHF', 'US$ ', '']) {
    const line = transactionRow(row, money, () => sym);
    const cells = parseMdTable(`${txHeaderLines().join('\n')}\n${line}`)[1];
    eq(cells[4], escMdText(sym), `${JSON.stringify(sym)}: written as escMdText writes any text`);
  }
  for (const sym of ['R', '€', '£', 'kr', 'Rp', 'CHF', '']) {
    eq(escMdText(sym), sym, `${JSON.stringify(sym)}: a plain symbol comes out byte for byte`);
  }
  eq(escMdText('$'), '\\$', 'a dollar sign is written `\\$`, which renders as `$`');
  // a caller that pre-stamps _symbol still gets the same escape
  const stamped = transactionRow({ ...row, _symbol: SYM }, money);
  ok(!stamped.includes(SYM), 'the pre-stamped _symbol path is escaped too');
}

console.log(`PASS transactions-export-symbol-escaped — the Currency cell is escaped like every other text cell (${checks} checks)`);
