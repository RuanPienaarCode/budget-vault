'use strict';
/* Issues #67/#69 — markdown.js carries two loops that restate parseMdTable's
   "first table only, a non-`|` line ends it" rule: parseMdTableWithSeparator
   (which keeps the header and separator parseMdTable drops) and
   splitAroundTable (which wants the boundary, not the rows). Both comments
   point here as the thing that stops them drifting from parseMdTable without
   anything going red — so every fixture below is read by all three, and they
   must agree about the rows and about where the table starts and stops.

     node tests/markdown-preserve.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { parseMdTable, parseMdTableWithSeparator, splitAroundTable } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const FIXTURES = {
  plain: '| A | B |\n|---|--:|\n| 1 | 2 |\n| 3 | 4 |\n',
  proseAround: 'Intro line.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n## My own notes\nkept\n',
  noTrailingPipe: '| A | B\n|---|---\n| 1 | 2\n',
  escapedPipe: '| A | B |\n|---|---|\n| x \\| y | 2 |\n',
  twoTables: '| A |\n|---|\n| 1 |\n\n| C |\n|---|\n| 9 |\n',
  noNewlineAtEnd: '# T\n\n| A |\n|---|\n| 1 |',
  crlf: 'x\r\n| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\ntail\r\n',
  noTable: '# Nothing here\n\njust prose\n',
  headerOnly: '| A | B |\n|---|---|\n',
  // A row with more cells than the header — #69's surplus case.
  ragged: '| A |\n|---|\n| 1 | extra |\n',
};

for (const [name, text] of Object.entries(FIXTURES)) {
  const rows = parseMdTable(text);
  const withSep = parseMdTableWithSeparator(text);

  // The rows agree: header is parseMdTable's first row, data the rest.
  eq(withSep.header, rows[0], `${name}: header`);
  eq(withSep.dataRows, rows.slice(1), `${name}: data rows`);

  // The boundary agrees: re-parsing only the table lines splitAroundTable
  // cut out gives parseMdTable's rows back, and the text around it holds no
  // line of the first table.
  // splitAroundTable joins with \n, so compare against the \n form of the text.
  const lf = text.replace(/\r\n/g, '\n');
  const { before, after } = splitAroundTable(text);
  if (before === text) {
    eq(rows, [], `${name}: no cut means no table`);
    continue;
  }
  eq(lf.startsWith(before) && lf.endsWith(after), true, `${name}: the cut is a prefix and a suffix of the file`);
  const tableText = lf.slice(before.length, lf.length - after.length);
  eq(parseMdTable(tableText), rows, `${name}: splitAroundTable's cut holds exactly the parsed table`);
  // …and nothing else: parseMdTable stops at the first table on its own, so
  // the check above would stay green if the cut swallowed the prose after it.
  eq(tableText.split('\n').filter(l => l.trim() && !l.trim().startsWith('|')), [],
    `${name}: the cut holds only table lines`);
  eq(parseMdTable(before), [], `${name}: nothing of the table above the cut`);
  if (rows.length && after) {
    const next = after.split('\n')[0].trim();
    eq(next.startsWith('|'), false, `${name}: the text after the cut starts off the table`);
  }
}

// The separator is the one under the header, cells kept as written.
eq(parseMdTableWithSeparator(FIXTURES.plain).sep, ['---', '--:'], 'plain: separator cells');
eq(parseMdTableWithSeparator(FIXTURES.noTable).sep, null, 'noTable: no separator');

// Negative control: a boundary rule that swallows the second table (the
// pre-fix parseMdTable) must disagree with the real one on `twoTables`.
const greedy = t => t.split(/\r?\n/).filter(l => l.trim().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()));
assert.notStrictEqual(greedy(FIXTURES.twoTables).length, parseMdTable(FIXTURES.twoTables).length,
  'negative control: a greedy boundary would have been caught');
checks++;

console.log(`PASS markdown-preserve (${checks} checks)`);
