'use strict';
/* Statement and household text in the Transactions export's Markdown is shown,
   never obeyed — escaped exactly once, in one place.

   Whoever writes an EFT reference or a card descriptor writes a transaction's
   Description, and import keeps it verbatim. The export's row template
   (exporter.js transactionRow, which the Report's detail table draws through
   too) escaped only `|` and line breaks, so `EFT ![x](https://attacker.example
   /p.png)` made Obsidian fetch that URL every time the exported note was
   opened, `![[Settings]]` transcluded a note, `#word` joined the tag index and
   a category called "Home <Garden>" lost "<Garden>" to the HTML parser
   (2026-10-07 audit, L4B-MD-INJECT). The Report escaped its own copy first
   (markdown.js escMdText) as a stopgap; now the row template does it for both
   documents, and the Report's pre-escape is gone — so the Report is still
   escaped exactly once (tests/report-markdown-escape.test.cjs pins that).

   The audit's default: GENERATED notes are escaped now; the vault's own month files
   keep their format (their escape pair must round-trip through unescMd, and
   ADR-0003's golden gate pins those bytes) — so a month file still holds the
   household's text exactly as before, and the CSV, which is not Markdown,
   keeps it raw (behind its formula guard).

   Pinned:
     1. transactionRow: every text cell is escMdText(cell), once; the currency
        cell is the household's own symbol and is not touched; a pipe can never
        split a cell;
     2. transactionsMarkdown's "Filtered by" line and categoriesMarkdown's
        names, colours and type headings get the same escape (a colour
        "#22c55e" was a tag);
     3. end to end through the REAL loader and exportTransactions: nothing
        active survives in either Markdown file, the CSV keeps the raw text,
        and the month file is written exactly as it was read.
     node tests/transactions-export-markdown-escape.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const folders = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => (folders.length ? { folder: folders.shift() } : null),
      askSplit: async () => null, confirmModal: async () => true,
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { escMdText, parseMdTable } = require('../src/markdown');
const { transactionRow, transactionsMarkdown, categoriesMarkdown, txHeaderLines } = require('../src/exporter');

const E = escMdText;
const money = v => `R ${Number(v).toFixed(2)}`;
const DESC = 'EFT ![x](https://attacker.example/p.png)';
const CAT = 'Home <Garden>';
const NOTE = '#invoice %% hidden';
const LABEL = 'Card [[Smart Budget]]';
const PIPE = 'Split | payment';
const ACTIVE = [DESC, '![x](', '<Garden>', '[[Smart Budget]]', '%%', '<img'];

(async () => {
  /* ---- 1. the row template ---------------------------------------------- */
  {
    const row = { date: '2026-09-02', desc: DESC, label: LABEL, cat: CAT, amount: -50, excluded: true, note: NOTE, split: 'part' };
    const line = transactionRow(row, money, () => '$');
    const cells = parseMdTable(`${txHeaderLines().join('\n')}\n${line}`)[1];
    eq(cells.length, txHeaderLines()[0].split('|').length - 2, 'the row keeps the header\'s cell count');
    eq([cells[1], cells[2], cells[3], cells[7]], [E(DESC), E(LABEL), E(CAT), E(NOTE)],
      'description, account, category and note are each escMdText(cell) — the statement\'s text, shown, not obeyed');
    eq(cells[4], '$', 'the currency cell is the household\'s own symbol, printed as part of a figure, and is not escaped');
    eq([cells[5], cells[6], cells[8]], ['R -50.00', 'yes', 'part'], 'the app\'s own values are untouched');
    for (const raw of ACTIVE) ok(!line.includes(raw), `nothing active survives in the row: ${JSON.stringify(raw)}`);
    ok(!line.includes('\\\\'), 'and nothing is escaped twice');
    const piped = transactionRow({ ...row, desc: PIPE }, money, () => '');
    eq(parseMdTable(`${txHeaderLines().join('\n')}\n${piped}`)[1].length, cells.length, 'a pipe in a description cannot split its cell');
    ok(piped.includes(E(PIPE)), 'it is written as &#124;, which renders as a pipe');
  }

  /* ---- 2. the rest of the two generated notes ---------------------------- */
  {
    const md = transactionsMarkdown([{ date: '2026-09-02', desc: 'Bread', label: 'Cheque', cat: 'Food', amount: -20, excluded: false, note: '' }],
      { range: 'September 2026', filters: [`category: ${CAT}`, 'search: "#tag"'], generated: '2026-10-07 09:00' }, money);
    const line = md.split('\n').find(l => l.startsWith('Filtered by:'));
    eq(line, `Filtered by: ${E(`category: ${CAT}`)} · ${E('search: "#tag"')}`, 'the filters line escapes the names and the search text it repeats');
    const cats = categoriesMarkdown([{ name: CAT, type: 'needs <review>', color: '#22c55e' }, { name: 'Food', type: 'expense', color: '#888888' }], 'x');
    ok(cats.includes(`| ${E(CAT)} | ${E('#22c55e')} |`), 'a category name and its colour are escaped — "#22c55e" was a tag in the exported note');
    ok(cats.includes(`## ${E('needs <review>')}`), 'and a type heading too');
    for (const raw of ['<Garden>', '<review>', '| #22c55e']) ok(!cats.includes(raw), `categories note: nothing active survives: ${JSON.stringify(raw)}`);
  }

  /* ---- 3. end to end: export escaped, CSV raw, month file as it was -------- */
  const B = 'Budget';
  const MONTH = `${B}/Transactions/Cheque/2026-09.md`;
  const TEXT = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
    + `| 2026-09-02 | ${DESC} | ${CAT} | -50.00 |  | ${NOTE} |\n`
    + `| 2026-09-03 | ${PIPE.replace('|', '\\|')} | ${CAT} | -20.00 |  |  |\n`;
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Home Garden.md`]: `---\nname: "${CAT}"\ntype: expense\ncolor: "#55aa55"\n---\n`,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
    [MONTH]: TEXT,
  };
  const unpin = pinClock('2026-10-07');
  try {
    const { ctx, S } = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
    eq(S.txFiles['Cheque/2026-09'].rows[0].desc, DESC, 'fixture: the description loads verbatim');
    folders.push('Exports');
    await ctx.exportTransactions();
    const keys = [...ctx.vault._store.keys()];
    const md = ctx.vault._store.get(keys.find(k => k.startsWith('Exports/Transactions') && k.endsWith('.md')));
    const csv = ctx.vault._store.get(keys.find(k => k.startsWith('Exports/Transactions') && k.endsWith('.csv')));
    const catsMd = ctx.vault._store.get('Exports/Categories.md');
    ok(md && csv && catsMd, 'the export wrote its files');
    for (const raw of ACTIVE) ok(!md.includes(raw) && !catsMd.includes(raw), `exported Markdown: nothing active survives: ${JSON.stringify(raw)}`);
    ok(md.includes(`| ${E(DESC)} |`) && md.includes(`| ${E(CAT)} |`) && md.includes(`| ${E(NOTE)} |`), 'each cell is escaped exactly once');
    ok(!md.includes('\\\\!') && !md.includes('\\\\['), 'never twice');
    ok(csv.includes(DESC) && csv.includes(CAT), 'the CSV is not Markdown: it keeps the statement\'s text exactly');

    S.txFiles['Cheque/2026-09'].dirty = true;
    await ctx.saveTransactions();
    eq(ctx.vault._store.get(MONTH), TEXT, 'and the month file is written exactly as it was read — its own format is a separate decision');
  } finally { unpin(); }

  console.log(`PASS transactions-export-markdown-escape — the export's Markdown shows statement text and never obeys it (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
