'use strict';
/* The loader hands every transaction month file three pieces of its own text,
   so the transactions serializer can put back what it does not model.

   serializeTxFile rebuilt the whole body from `['---', fm, '---', '', header,
   sep, rows…]`, so a paragraph above the table, a `## Queries` section below
   it, and a separator row in any shape but the plugin's own were deleted or
   rewritten by the next write of the month — a recategorise + Save, Add
   transaction, an import, a bulk delete (2026-10-07 round-trip audit, L3-02 and
   the separator half of L3-22). ISSUE 67 gave every other file a lead/trail
   capture; month files never got one.

   CONTRACT 1, the loader's half (load.js verbatimAroundTable), LF-normalised:

     txFile.lead  the text between the frontmatter fence's line break and the
                  table's header line — '\n' for the blank line every month
                  file carries, '' when the header follows the fence, all of it
                  when there is no table;
     txFile.trail everything after the last row's line break ('' if nothing);
     txFile.sep   the file's own separator row as written ('' if none);

   so that '---\n' + fm + '\n---\n' + (lead || '\n') + header + '\n' +
   (sep || default) + '\n' + rows + trail is the file again, byte for byte.
   The serializer's half (views/transactions.js) writes exactly that, keeping
   `sep` only while it still fits the header — so a month with none of the
   three is byte-identical to every file already on disk. Section 1 pins the
   loader's fields; section 2 pins the round trip through the REAL serializer,
   which is where the contract is kept or broken.

   Synthetic. Real loader, real serializer.
     node tests/tx-file-lead-trail-sep.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { headerLines, SCHEMAS } = require('../src/table-schema');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const FM = ['account: "Cheque"', 'month: 2026-09'];
const HEADER = '| Date | Description | Category | Amount | Excluded | Note |';
const [, DEFAULT_SEP] = headerLines({ ...SCHEMAS.transactions, columns: SCHEMAS.transactions.columns.slice(0, 6) });
const ROWS = ['| 2026-09-01 | Coffee | Food | -35.00 |  |  |', '| 2026-09-02 | Salary | Salary | 1000.00 |  |  |'];

async function load(text) {
  const ctx = makeCtx({
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\n---\n',
    [`${B}/Transactions/Cheque/2026-09.md`]: text,
  });
  const S = await loadInto(ctx);
  require('../src/views/transactions')(ctx);
  const f = S.txFiles['Cheque/2026-09'];
  return { f, save: () => ctx.serializeTxFile(f) };
}

const PLAIN = ['---', ...FM, '---', '', HEADER, DEFAULT_SEP, ...ROWS, ''].join('\n');
const PROSE = ['---', ...FM, 'tags: [finance]', '---', '', 'Reconciled against the September statement on 2026-10-02.', '',
  HEADER, DEFAULT_SEP, ...ROWS, '', '## Queries', '', '- Coffee charged twice? Bank says no (ref 4471).', ''].join('\n');
const SHORT_SEP = '|---|---|---|---:|---|---|';
const SHORT = ['---', ...FM, '---', '', HEADER, SHORT_SEP, ...ROWS, ''].join('\n');

(async () => {
  /* ---- 1. what the loader hands over ---- */
  {
    const { f } = await load(PLAIN);
    eq([f.lead, f.trail, f.sep], ['\n', '', DEFAULT_SEP],
      'a plain month file: one blank line above the table, nothing after it, the plugin\'s own separator');
  }
  {
    const { f } = await load(PROSE);
    eq(f.lead, '\nReconciled against the September statement on 2026-10-02.\n\n',
      'the paragraph above the table, with its blank lines, verbatim');
    eq(f.trail, '\n## Queries\n\n- Coffee charged twice? Bank says no (ref 4471).\n', 'everything after the last row, verbatim');
  }
  eq((await load(SHORT)).f.sep, SHORT_SEP, 'a short separator is handed over as written, not as the plugin would write it');
  eq((await load(['---', ...FM, '---', HEADER, DEFAULT_SEP, ...ROWS, ''].join('\n'))).f.lead, '',
    'a header directly under the fence has an empty lead (the serializer then writes its usual blank line)');
  {
    const { f } = await load(['---', ...FM, '---', '', 'Nothing imported yet.', ''].join('\n'));
    eq([f.lead, f.trail, f.sep], ['\nNothing imported yet.\n', '', ''],
      'a month file with no table: all of it is lead, so a first row lands under the prose');
  }
  eq((await load(['---', ...FM, '---', '', HEADER, ...ROWS, ''].join('\n'))).f.sep, '', 'a table with no separator row hands over none');
  eq((await load(['---', ...FM, '---', '', HEADER, DEFAULT_SEP, ...ROWS].join('\n'))).f.trail, '', 'a file ending on its last row has an empty trail');
  {
    const crlf = ['---', ...FM, '---', '', 'Note above.', '', HEADER, DEFAULT_SEP, ...ROWS, '', 'Note below.', ''].join('\r\n');
    const { f } = await load(crlf);
    eq([f.lead, f.trail, f.sep], ['\nNote above.\n\n', '\nNote below.\n', DEFAULT_SEP],
      'a CRLF month file\'s pieces carry no carriage returns — the serializer writes LF throughout');
  }

  /* ---- 2. the round trip through the real serializer ---- */
  for (const [name, text] of [['plain', PLAIN], ['prose above and below', PROSE], ['short separator', SHORT]]) {
    const { save } = await load(text);
    eq(save(), text, `${name}: a no-change write of the month gives the file back byte for byte`);
  }
  {
    const { f, save } = await load(PROSE);
    f.rows[0].cat = 'Salary';
    const out = save();
    eq(out, PROSE.replace('| 2026-09-01 | Coffee | Food |', '| 2026-09-01 | Coffee | Salary |'),
      'a recategorise changes its own cell and keeps the paragraph, the section below and the separator');
  }

  console.log(`PASS tx-file-lead-trail-sep (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
