'use strict';
/* A Split column the file already has is never dropped, and a word in it the
   app does not know is written back while nothing has replaced it.

   serializeTxFile wrote the Split column only while some row still carried a
   role — so a month whose Split column held nothing but a hand-typed `todo`
   lost the word AND the column on the next save of anything in that month
   (2026-10-07 audit, L3-10: "Split column DROPPED"). The column is the
   reader's: it was on disk when the month was loaded (load.js records that
   as `splitHeaderPresent`), and dropping it is a rewrite of their table's
   shape that nothing on screen announces.

   The word itself is read through tx-role.js's splitRole, which reads
   anything but `parent`/`part` as '' — on purpose, it is the one door to the
   role. The schema's Split column now keeps the cell's own text as
   `splitRaw` and writes it back while the row's role is still the default it
   produced, the vocab()/money() raw contract the flat tables already follow
   (table-schema.js, the tables lane's half). That raw needs a column to land
   in, which is the serializer's half: it no longer drops the column a file
   was loaded with.

   Pinned here, through the REAL loader and serializer:
     1. a seven-column month with no role left keeps its seven columns on a
        save; a six-column month still gets no Split column (golden tx6's
        shape) — absent stays absent;
     2. a row carrying `splitRaw` is written back with its own word while its
        role is '', with the role once one is assigned, and with the word
        again once the role is gone;
     3. end to end: the loader keeps `todo`, and a save writes it back.

     node tests/transactions-split-column-kept.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const B = 'Budget';
const HEAD7 = '| Date | Description | Category | Amount | Excluded | Note | Split |';
const HEAD6 = '| Date | Description | Category | Amount | Excluded | Note |';
const SEVEN = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD7 + '\n'
  + '|------|-------------|----------|-------:|----------|------|-------|\n'
  + '| 2026-09-01 | Windfall | Salary | 9000.00 |  | one-off |  |\n'
  + '| 2026-09-03 | Salary | Salary | 30000.00 |  |  | todo |\n';
const SIX = '---\naccount: "Cheque"\nmonth: 2026-08\n---\n\n' + HEAD6 + '\n'
  + '|------|-------------|----------|-------:|----------|------|\n'
  + '| 2026-08-03 | Salary | Salary | 30000.00 |  |  |\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 0.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: SEVEN,
  [`${B}/Transactions/Cheque/2026-08.md`]: SIX,
};

async function mount() {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  require('../src/categories')(ctx);
  require('../src/views/transactions')(ctx);
  return { ctx, S };
}
const splitCells = text => text.split('\n').filter(l => /^\| \d{4}-/.test(l)).map(l => l.split('|')[7] === undefined ? null : l.split('|')[7].trim());

(async () => {
  /* ---- 1. the column a file already has stays; absent stays absent ------- */
  {
    const { ctx, S } = await mount();
    const sept = S.txFiles['Cheque/2026-09'];
    ok(sept.splitHeaderPresent, 'fixture: the loader saw the Split header on the September file');
    ok(!sept.rows.some(r => r.split), 'fixture: and no row in it carries a role');
    const out = ctx.serializeTxFile(sept);
    ok(out.split('\n').includes(HEAD7), 'a month loaded with a Split column keeps it on save (L3-10: the column was dropped)');
    eq(out.split('\n').filter(l => /^\| \d{4}-/.test(l)).map(l => l.split('|').length - 2), [7, 7],
      'every row keeps its seventh cell, so the table keeps its shape');
    const six = ctx.serializeTxFile(S.txFiles['Cheque/2026-08']);
    ok(six.split('\n').includes(HEAD6) && !six.includes('| Split |'),
      'a month that never had a Split column still gets none — never-split files keep their six columns');
    eq(six, SIX, 'and is written back byte for byte');
  }

  /* ---- 2. the serializer half of the raw contract ------------------------ */
  {
    const { ctx, S } = await mount();
    const f = S.txFiles['Cheque/2026-09'];
    const row = f.rows.find(r => r.desc === 'Salary');
    row.splitRaw = row.splitRaw || 'todo';       // what the schema read keeps
    eq(splitCells(ctx.serializeTxFile(f))[1], 'todo', 'a word the role reader does not know is written back while the role is still the default');
    row.split = 'parent'; row.excluded = true;   // a real split assigned since
    eq(splitCells(ctx.serializeTxFile(f))[1], 'parent', 'and a real role replaces it once one is assigned');
    row.split = '';
    eq(splitCells(ctx.serializeTxFile(f))[1], 'todo', 'back to the default (an un-split), the reader\'s own word is what the cell held');
    delete row.splitRaw; row.excluded = false;
    eq(splitCells(ctx.serializeTxFile(f))[1], '', 'negative control: with no raw kept the cell is blank — the old behaviour, not a guess');
  }

  /* ---- 3. end to end: the loader keeps the word, a save writes it back ---- */
  {
    const { ctx, S } = await mount();
    const row = S.txFiles['Cheque/2026-09'].rows.find(r => r.desc === 'Salary');
    eq(row.splitRaw, 'todo', 'the loader keeps the word it could not read as a role');
    eq(ctx.serializeTxFile(S.txFiles['Cheque/2026-09']), SEVEN, 'and a save writes the month back byte for byte — column, word and all');
  }

  console.log(`PASS transactions-split-column-kept — a Split column the file has is kept, and its unknown words are written back (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
