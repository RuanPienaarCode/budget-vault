'use strict';
/* Statement and household text in a generated note is shown, never obeyed.

   Whoever writes an EFT reference or a card descriptor writes a transaction's
   Description, and import keeps it verbatim. The Report's Markdown wrote it,
   and category and debt names, with only `|` and newlines escaped — so
   `EFT ![x](https://attacker.example/p.png)` made Obsidian fetch that URL
   every time the report was opened, `![[Settings]]` transcluded another
   note, `#word` joined the tag index, `%%` hid the rest of the line, and a
   category called "Home <Garden>" lost "<Garden>" to the HTML parser.

   escMdText() in src/markdown.js is the escape for GENERATED notes (the
   Report now, the Transactions export next; month files, which must round
   trip through unescMd, are a separate decision). Pinned here:

     1. the contract: every markdown-active character backslash-escaped, `|`
        as `&#124;`, every newline as `<br>`, trimmed;
     2. it COMPOSES with escMd — escMd(escMdText(s)) === escMdText(s) — so a
        caller can escape a field before handing it to code that still runs
        escMd (exporter.transactionRow) without doubling it into `\\|`,
        which ends a table cell; and its output can never break a table row;
     3. escMd and unescMd are unchanged (the vault's own month files read
        and write through them);
     4. the Report, end to end over the REAL loader and views: every
        household/statement name in the Markdown is escaped exactly once,
        nothing active survives, the detail table keeps its column count —
        and the JSON sibling keeps the raw text (JSON is not Markdown).

     node tests/report-markdown-escape.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock } = require('./helpers/figures.cjs');
const { mountFor, createReport, section } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const PAYLOADS = [
  'EFT ![x](https://attacker.example/p.png)',
  'EFT <img src="https://attacker.example/q.png">',
  'EFT <iframe src="https://attacker.example/f"></iframe>',
  'EFT ![[Settings]]',
  'EFT [[Smart Budget]]',
  'EFT #invoice',
  'EFT %% hidden',
  'EFT `$= dv.pages()`',
  'EFT $x^2$ and \\*not bold\\*',
  'EFT **bold** _it_ ~~gone~~',
  'Split | payment',
  'two\nlines', 'cr\r\nlf', 'lone\rcr',
  '  padded  ',
];

(async () => {
  const { escMdText, escMd, unescMd } = require('../src/markdown');
  ok(typeof escMdText === 'function', 'src/markdown.js exports escMdText');

  /* ---- 1. the contract ---------------------------------------------------- */
  eq(escMdText(null), '', 'null is empty');
  eq(escMdText(undefined), '', 'undefined is empty');
  eq(escMdText(12.5), '12.5', 'a number is its text');
  eq(escMdText('Corner Shop Groceries'), 'Corner Shop Groceries', 'plain text is unchanged');
  for (const ch of '\\`*_[]!<>#%$') eq(escMdText(`a${ch}b`), `a\\${ch}b`, `${JSON.stringify(ch)} is backslash-escaped`);
  eq(escMdText('a|b'), 'a&#124;b', 'a pipe becomes &#124;, which renders as | and splits no table cell');
  eq(escMdText('a\nb'), 'a<br>b', 'LF becomes <br>');
  eq(escMdText('a\r\nb'), 'a<br>b', 'CRLF becomes ONE <br>');
  eq(escMdText('a\rb'), 'a<br>b', 'a lone CR — a line ending to CommonMark — becomes <br> too');
  eq(escMdText('  x  '), 'x', 'trimmed, like escMd');
  eq(escMdText('EFT ![x](https://attacker.example/p.png)'), 'EFT \\!\\[x\\](https://attacker.example/p.png)', 'the remote image is inert');
  eq(escMdText('Home <Garden>'), 'Home \\<Garden\\>', 'an angle-bracketed word is text, not a tag');
  eq(escMdText('![[Settings]]'), '\\!\\[\\[Settings\\]\\]', 'an embed is inert');
  eq(escMdText('a<br>b'), 'a\\<br\\>b', 'a literal "<br>" typed into a description stays visible text');

  /* ---- 2. composes with escMd, and is always table-safe --------------------- */
  for (const p of PAYLOADS) {
    const e = escMdText(p);
    eq(escMd(e), e, `escMd(escMdText(${JSON.stringify(p)})) leaves it alone`);
    ok(!/[|\r\n]/.test(e), `${JSON.stringify(p)} → no pipe, no line break: cannot end a cell or a row`);
  }

  /* ---- 3. the month-file pair is untouched ---------------------------------- */
  eq(escMd('a|b\nc'), 'a\\|b<br>c', 'escMd is what it was');
  eq(unescMd('a\\|b<br>c'), 'a|b\nc', 'and unescMd still inverts it');

  /* ---- 4. the Report -------------------------------------------------------- */
  const CAT = 'Home <Garden>';
  const DESC = 'EFT ![x](https://attacker.example/p.png)';
  const PIPE = 'Split | payment';
  const NOTE = '#invoice';
  const ORPHAN = 'Ghost_*star*';
  const DEBT = 'Card [[Smart Budget]]';
  const SEP = `${B}/Transactions/Cheque/2026-09.md`;
  const files = {
    ...SEED,
    [`${B}/Categories/Home Garden.md`]: `---\nname: "${CAT}"\ntype: expense\ncolor: "#55aa55"\n---\n`,
    [`${B}/Budgets/2026-09.md`]: SEED[`${B}/Budgets/2026-09.md`] + `| ${CAT} | expense | 100.00 |  |\n`,
    [SEP]: SEED[SEP]
      + `| 2026-09-02 | ${DESC} | ${CAT} | -50.00 |  | ${NOTE} |  |\n`
      + `| 2026-09-02 | ${PIPE.replace('|', '\\|')} | ${CAT} | -20.00 |  |  |  |\n`
      + `| 2026-09-02 | Stall | ${ORPHAN} | -10.00 |  |  |  |\n`,
    [`${B}/Debts.md`]: SEED[`${B}/Debts.md`].replace('| Card | FNB |', `| ${DEBT} | FNB |`),
  };
  const unpin = pinClock(TODAY);
  let r;
  try {
    const M = await mountFor(files, { period: PERIOD, budgetFolder: B });
    eq(M.S.categories.some(c => c.name === CAT), true, 'fixture: the category loads under its angle-bracketed name');
    r = { M, ...(await createReport(M, { detail: 'detail' })), i18n: require('../src/i18n') };
  } finally { unpin(); }
  const { md, json, i18n } = r;
  ok(md && json, 'both documents were written');

  const E = escMdText;
  ok(section(md, i18n.t('report.section.category')).includes(`| ${E(CAT)} |`), 'Spend by Category prints the escaped category');
  ok(section(md, i18n.t('report.section.budgetActual')).includes(`| ${E(CAT)} | expense |`), 'Budget vs Actual too');
  ok(section(md, i18n.t('report.section.debt')).includes(`| ${E(DEBT)} |`), 'the debt table prints the escaped debt name');
  ok(md.includes(i18n.t('report.category.orphaned', { names: E(ORPHAN) })), 'the orphaned-names sentence prints the escaped name');

  const detail = section(md, i18n.t('report.section.transactions'));
  ok(detail, 'the transaction detail section is present');
  const rows = detail.split('\n').filter(l => l.startsWith('| '));
  const { parseMdTable } = require('../src/markdown');
  const table = parseMdTable(rows.join('\n'));
  ok(table.length > 3, 'fixture: the detail table has rows');
  for (const row of table) eq(row.length, table[0].length, `every detail row keeps the header's ${table[0].length} cells`);
  const descRow = table.find(cells => cells.includes(E(DESC)));
  ok(descRow, `the description cell is escMdText(description), exactly — got rows like ${JSON.stringify(table[table.length - 1])}`);
  ok(descRow.includes(E(NOTE)), 'and the note cell is escaped the same way');
  ok(descRow.includes(E(CAT)), 'and the category cell');
  ok(table.some(cells => cells.includes(E(PIPE))), 'a pipe in a description stays inside its cell');

  for (const raw of [DESC, '![x](', '<Garden>', '[[Smart Budget]]', '%%', 'Ghost_*star*']) {
    ok(!md.includes(raw), `nothing active survives in the Markdown: ${JSON.stringify(raw)}`);
  }
  ok(!/(^|\s)#invoice/.test(md), 'the note does not become a tag');
  ok(!md.includes('\\\\!') && !md.includes('\\\\['), 'escaped exactly ONCE — never a doubled backslash');

  eq(json.transactions.find(t => t.amount === -50).description, DESC, 'JSON keeps the raw description');
  eq(json.transactions.find(t => t.amount === -50).note, NOTE, 'and the raw note');
  ok(json.categories.some(c => c.category === CAT), 'and the raw category name');
  ok(json.debts.rows.some(d => d.name === DEBT), 'and the raw debt name');

  console.log(`PASS report-markdown-escape (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
