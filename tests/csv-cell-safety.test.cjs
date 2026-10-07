'use strict';
/* What a CSV cell written by this app may contain, and how the app's own
   reader takes the spreadsheet guard back off.

   Every CSV the plugin writes goes through csvCell (src/csv.js): the
   transactions export (exporter.transactionsCsv), the budget export
   (budget-export.modelToCsv, whose transactions file is transactionsCsv
   again), the categories export, and Data/Categorisation Rules.csv, the one
   CSV the app also reads back. The 2026-10-07 audit found three problems
   with that one function:

   1. NO C0 CONTROL CHARACTERS (L4A-11). A NUL inside a description went
      straight into both export CSVs, and python's csv module refuses the
      whole file with "line contains NUL". The XLSX already dropped it and the
      PDF stripped it, so only the CSVs carried it. Tab, CR and LF stay: they
      are legal inside a quoted cell and can be real text.

   2. NO FORMULA THE GUARD MISSES (CSV-VARIANTS). The guard caught a leading
      = + - @ tab or CR. It let through ` =1+1` (a reader that trims spaces),
      `　=1+1` and the full-width signs `＝ ＋ － ＠` (readers that fold
      full-width input), and `x;=1+1` / `x<TAB>=1+1`, which a semicolon- or
      tab-splitting reader cuts into a cell that starts with `=`. Now the
      guard looks at the first character that is not whitespace, and a cell
      holding a ; or a tab is quoted, so such a reader keeps it whole.

   3. THE GUARD HAS AN INVERSE (L3-06). The rules file is written by csvCell
      and read back by parseCsv, which had no matching strip. A learned rule
      `@PARKING …` went to disk as `'@PARKING …`, came back with the
      apostrophe, and never matched again. uncsvCell is the reader's half. The
      property below drives random strings through csvCell, parseCsv and
      uncsvCell and expects the original text back, minus only the control
      characters (1).

   Amounts never go through csvCell (exporter.js amountCell and
   budget-export.js num() say why: a guarded "-250.50" reads as text and
   every SUM skips it), so the wider guard cannot reach a number. One check
   below pins that through the real transactions writer.

   Synthetic strings only. Runs in bare node:
     node tests/csv-cell-safety.test.cjs */

const assert = require('assert');
const { csvCell, uncsvCell, stripControls, parseCsv, parseDelimited } = require('../src/csv');
const { transactionsCsv } = require('../src/exporter');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* The value a reader of the app's OWN file gets back for one cell: written,
   parsed with the real parser, unguarded with the real inverse. A leading
   `x,` keeps an empty cell from being parsed as a blank line. */
const roundTrip = v => uncsvCell(parseCsv(`x,${csvCell(v)}\n`)[0][1]);
/* What a spreadsheet sees in that cell: the parsed value, guard included. */
const seen = v => parseCsv(`x,${csvCell(v)}\n`)[0][1];
// Every C0 control character except tab (09), LF (0A) and CR (0D).
const C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/* ---- 1. no C0 control characters reach a written cell ---- */
{
  eq(csvCell('POS\u0000PURCHASE'), 'POSPURCHASE', 'a NUL inside a description is dropped, not kept');
  for (let c = 0; c < 0x20; c++) {
    const ch = String.fromCharCode(c);
    const out = csvCell(`A${ch}B`);
    if (ch === '\t' || ch === '\n' || ch === '\r') {
      ok(out.includes(ch), `control 0x${c.toString(16)} is real text and is kept (inside quotes)`);
    } else {
      ok(!out.includes(ch), `control 0x${c.toString(16)} never reaches the file`);
    }
  }
  eq(stripControls('a\u0000b\u0007c\td\ne\rf\u001Fg'), 'abc\td\ne\rfg', 'stripControls keeps tab, LF and CR only');

  // The real transactions writer, which the budget export's transactions
  // file is too. Every text cell of a row carries a NUL; none survives.
  const csv = transactionsCsv([{
    date: '2026-08-02', desc: 'POS\u0000PURCHASE', label: 'Che\u0001que', cat: 'Fu\u0002el',
    amount: -10, excluded: false, note: 'n\u0000ote', split: '',
  }]);
  ok(!C0.test(csv), 'the transactions CSV carries no C0 control character');
  ok(csv.includes('POSPURCHASE') && csv.includes('Cheque') && csv.includes('Fuel') && csv.includes('note'),
    'and the text around the dropped character is all still there');
}

/* ---- 2. the formula guard sees past whitespace and full-width signs ---- */
{
  const dressed = [
    '=1+1', '+1+1', '-1+1', '@SUM(1+1)', '\t=1+1', '\r=1+1',     // already guarded before
    ' =1+1', '  +1+1', '　=1+1', ' -1', '\n=1+1',         // leading whitespace
    '＝1+1', '＋1+1', '－1', '＠SUM(1)',           // full-width = + - @
    ' ＝1+1',                                                  // both at once
  ];
  for (const v of dressed) {
    ok(seen(v).startsWith("'"), `a formula start is neutralised in the cell a spreadsheet reads: ${JSON.stringify(v)}`);
    eq(roundTrip(v), v, `and the app's own reader gets the text back unchanged: ${JSON.stringify(v)}`);
  }

  // Ordinary text is left exactly alone, including a sign that is not first.
  for (const v of ['Corner Mart', 'A-B', 'PAY 5+5', 'half=half', 'x @ y', '12.50', '2026-08-01']) {
    eq(csvCell(v), v, `an ordinary cell is written unchanged: ${JSON.stringify(v)}`);
  }
}

/* ---- 2b. a ; or a tab inside a cell is quoted, so a splitting reader keeps it whole ---- */
{
  for (const [v, delim] of [['x;=1+1', ';'], ['x\t=1+1', '\t'], ['a;b', ';']]) {
    const line = `${csvCell(v)}\n`;
    ok(line.startsWith('"'), `a cell holding ${JSON.stringify(delim)} is quoted: ${JSON.stringify(v)}`);
    const cells = parseDelimited(line, delim)[0];
    eq(cells.length, 1, `a reader splitting on ${JSON.stringify(delim)} sees ONE cell, not two: ${JSON.stringify(v)}`);
    ok(!/^\s*=/.test(cells[0]), `and that cell does not start with =: ${JSON.stringify(v)}`);
    eq(roundTrip(v), v, `while the app's own comma reader still gets it back: ${JSON.stringify(v)}`);
  }
}

/* ---- 2c. amounts are numbers, never guarded ---- */
{
  const csv = transactionsCsv([{ date: '2026-08-01', desc: ' -REVERSAL', label: 'Cheque', cat: '', amount: -250.5, excluded: false, note: '', split: '' }]);
  const head = csv.split('\n')[0].split(',');
  const row = parseCsv(csv)[1];
  eq(row[head.indexOf('Amount')], '-250.50', 'the Amount cell is a bare negative number');
  ok(row[head.indexOf('Description')].startsWith("'"), 'while a description dressed as a formula is still guarded');
}

/* ---- 3. uncsvCell is the exact inverse, over random strings ---- */
{
  // A file the OLD writer produced reads back without its guard too.
  eq(uncsvCell("'@PARKING CITYVILLE"), '@PARKING CITYVILLE', 'an old guarded cell loses its apostrophe on read');
  eq(uncsvCell("'-ATM FEE"), '-ATM FEE', 'whatever the guarded sign');
  eq(uncsvCell("'tis the season"), "'tis the season", 'an apostrophe that guards nothing is text, and stays');
  eq(uncsvCell("O'Brien"), "O'Brien", 'and one in the middle is never touched');
  // A cell that STARTS with an apostrophe before a formula sign is written
  // with a second one, so the strip on read can only ever take the guard.
  eq(roundTrip("'=1+1"), "'=1+1", 'a literal leading apostrophe survives the round trip');
  eq(roundTrip("''@x"), "''@x", 'so do two of them');

  // Deterministic PRNG, so a failure reproduces from the seed alone.
  let seed = 20261007;
  const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const ALPHABET = ["'", '=', '+', '-', '@', '＝', '＋', '－', '＠', ' ', '　', ' ',
    '\t', '\r', '\n', '"', ',', ';', '\u0000', '\u0007', '\u001F', 'a', 'B', '7', '.', '|'];
  let rounds = 0;
  for (let i = 0; i < 3000; i++) {
    const len = rnd(7);
    let v = '';
    for (let k = 0; k < len; k++) v += ALPHABET[rnd(ALPHABET.length)];
    const back = roundTrip(v);
    assert.strictEqual(back, stripControls(v), `round trip changed ${JSON.stringify(v)} into ${JSON.stringify(back)} (seed 20261007)`);
    assert.ok(!C0.test(csvCell(v)), `csvCell let a control character through for ${JSON.stringify(v)}`);
    const cell = seen(v);
    // Past the guard, nothing a spreadsheet would start a formula with.
    assert.ok(cell.startsWith("'") || !/^\s*[=+\-@＝＋－＠]/.test(cell) && !/^[\t\r]/.test(cell),
      `a formula start reached the cell for ${JSON.stringify(v)}: ${JSON.stringify(cell)}`);
    rounds++;
  }
  ok(rounds === 3000, 'every random round ran');
}

console.log(`PASS — csv-cell-safety: no control characters, no missed formula starts, and the guard has an exact inverse (${checks} assertions).`);
