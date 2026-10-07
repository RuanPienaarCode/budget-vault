'use strict';
/* A transaction month file keeps everything the household wrote around its
   table — and its own separator row — through every write the app makes.

   serializeTxFile rebuilt the whole file from
   `['---', fm, '---', '', header, sep, ...rows]`, so anything outside the
   table was deleted by the next write of that month: a paragraph above the
   table ("Reconciled against the September statement…"), a `## Queries`
   section below it, a second table. One recategorise and Save, an Add
   transaction, an import into the month, a bulk delete or an import's Undo
   was enough, and nothing on screen said a word (2026-10-07 audit, L3-02:
   0 of 3 prose lines kept on every path). ISSUE 67 taught the budgets, the
   four flat tables, Plans and Tax to keep their lead and trail; the month
   files never got it. The same write also replaced the file's own separator
   row with the app's long one — on the vault audited, the one transaction
   file a no-change Save still rewrote (L3-22, `|---|---|---|---:|---|---|`).

   CONTRACT 1 (fix wave 2): load.js hands every txFile three pieces of its own
   text — lead (between the fence's line break and the header line), trail
   (everything after the last row's line break), sep (its separator row) —
   and serializeTxFile writes them back:
     '---\n' + fm + '\n---\n' + (lead || '\n') + header + '\n'
       + (sep || default) + '\n' + rows + trail
   tests/tx-file-lead-trail-sep.test.cjs pins the loader's half; this pins
   the serializer's half, end to end, through the REAL loader and every write
   path:

     1. a no-change save is byte-identical — prose, short separator and all —
        and a month with nothing outside its table is exactly what the
        serializer has always written;
     2. every write path (Save, Add transaction, import commit, bulk delete,
        Undo) keeps every line outside the table, and the table still renders;
     3. a separator whose cell count no longer matches the header (a split
        added the seventh column) gives way to the default rather than
        leaving a table Obsidian cannot read; a new month gets the default;
     4. negative control: the same paths with the three pieces taken away
        lose the prose and the separator — absent pieces are today's
        behaviour, so sections 1-2 cannot pass vacuously.

   Synthetic fixtures only. Clock pinned.
     node tests/transactions-file-prose-kept.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* ---- the dialogs, answered from a queue --------------------------------
   mountFor() purges src/ from the require cache (its money recorder), so a
   require.cache entry for modal.js would be thrown away; the loader hook is
   the seam that survives it — the same one transactions-file-order uses. */
const SRC = path.join(__dirname, '..', 'src') + path.sep;
const answers = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => answers.shift() || null,
      askSplit: async () => answers.shift() || null,
      confirmModal: async () => true, askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { buildIndex } = require('../src/dedupe');

const B = 'Budget';
const FM = month => `---\naccount: "Cheque"\nmonth: ${month}\ntags: [finance]\n---\n`;
const HEAD6 = '| Date | Description | Category | Amount | Excluded | Note |';
const LONG6 = '|------|-------------|----------|-------:|----------|------|';
const SHORT6 = '|---|---|---|---:|---|---|';
const LONG7 = '|------|-------------|----------|-------:|----------|------|-------|';

const LEAD_LINE = 'Reconciled against the September statement on 2026-10-02.';
const TRAIL_LINES = ['## Queries', '- Coffee charged twice? The bank says no.'];
/* The text between the fence's line break and the header line — as the file
   holds it, and as the loader hands it over. */
const PROSE_BODY_LEAD = `\n${LEAD_LINE}\n\n`;
const PROSE_LEAD = PROSE_BODY_LEAD;
const PROSE_TRAIL = `\n${TRAIL_LINES[0]}\n\n${TRAIL_LINES[1]}\n`;
const PROSE = FM('2026-09') + PROSE_BODY_LEAD + `${HEAD6}\n${SHORT6}\n`
  + '| 2026-09-01 | Coffee | Food | -35.00 |  |  |\n'
  + '| 2026-09-02 | Salary | Salary | 1000.00 |  |  |\n'
  + PROSE_TRAIL;
/* The L3-22 shape: nothing outside the table, only a short separator. */
const SHORT = FM('2026-08') + `\n${HEAD6}\n${SHORT6}\n| 2026-08-03 | Bread | Food | -20.00 |  |  |\n`;
/* Exactly what the serializer has always written — the control. */
const PLAIN = FM('2026-07') + `\n${HEAD6}\n${LONG6}\n| 2026-07-03 | Bread | Food | -20.00 |  |  |\n`;
/* Typed by hand, no frontmatter at all: the lead must not be glued to the
   fence the app adds. */
const NOFM_LINE = 'Cash month, typed by hand.';
const NOFM = `${NOFM_LINE}\n\n${HEAD6}\n${LONG6}\n| 2026-06-03 | Bread | Food | -20.00 |  |  |\n`;

const P = m => `${B}/Transactions/Cheque/${m}.md`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 945.00\nbalance_updated: 2026-09-30\n---\n',
  [P('2026-09')]: PROSE, [P('2026-08')]: SHORT, [P('2026-07')]: PLAIN, [P('2026-06')]: NOFM,
};

const proseKept = text => [LEAD_LINE, ...TRAIL_LINES].filter(l => text.split('\n').includes(l)).length;
const rowLines = text => text.split('\n').filter(l => /^\| \d{4}-/.test(l));
const tableOk = text => {
  const lines = text.split('\n');
  const h = lines.findIndex(l => l.startsWith('| Date |'));
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').length;
  return h >= 0 && cells(lines[h]) === cells(lines[h + 1]) && /^\|[\s:|-]+\|$/.test(lines[h + 1]);
};

async function mount(strip) {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.switchView = () => {};
  m.ctx.renderTransactions();
  if (strip) for (const f of Object.values(m.S.txFiles)) { delete f.lead; delete f.trail; delete f.sep; }
  return m;
}
const get = (ctx, month) => ctx.vault._store.get(P(month));

/* Every write path, run against one mount each. */
const PATHS = {
  async save(ctx, S) {
    S.txFiles['Cheque/2026-09'].rows[0].cat = 'Salary';
    S.txFiles['Cheque/2026-09'].dirty = true;
    await ctx.saveTransactions();
  },
  async add(ctx) {
    answers.push({ date: '2026-09-05', desc: 'Bakery', label: 'Cheque', dir: 'out', amount: '20', cat: 'Food', note: '' });
    await ctx.addTransaction();
  },
  async import(ctx, S) {
    S.pendingImport = { label: 'Cheque', filename: 'cheque.csv', index: buildIndex(S.txFiles), items: [
      { date: '2026-09-10', desc: 'Fuel', cat: 'Food', amount: -400, excluded: false, include: true, dup: false }] };
    await ctx.commitImport();
  },
  async bulkDelete(ctx) {
    ctx.$('#txSearch').value = 'coffee';
    await ctx.deleteFilteredTransactions();
  },
  async undo(ctx, S) {
    await PATHS.import(ctx, S);
    await ctx.undoImport();
  },
};

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 0. the loader hands over the contract's three pieces ------------- */
    {
      const { S } = await mount();
      const sept = S.txFiles['Cheque/2026-09'];
      eq([sept.lead, sept.trail, sept.sep], [PROSE_LEAD, PROSE_TRAIL, SHORT6], 'the prose month arrives with its lead, its trail and its own separator (load.js, CONTRACT 1)');
      eq([S.txFiles['Cheque/2026-07'].lead, S.txFiles['Cheque/2026-07'].trail], ['\n', ''], 'a plain month: one blank line above, nothing below');
    }

    /* ---- 1. a no-change save is byte-identical, prose, separator and all -- */
    {
      const { ctx, S } = await mount();
      for (const f of Object.values(S.txFiles)) f.dirty = true;
      await ctx.saveTransactions();
      eq(get(ctx, '2026-09'), PROSE, 'the prose month comes back byte for byte: its paragraph, its ## Queries and its own short separator');
      eq(get(ctx, '2026-08'), SHORT, 'a short separator is the file\'s own and is kept (L3-22: the last no-change rewrite on the audited vault)');
      eq(get(ctx, '2026-07'), PLAIN, 'a file with nothing outside its table and the default separator is exactly what the serializer always wrote');
      const nofm = get(ctx, '2026-06');
      ok(nofm.split('\n').includes(NOFM_LINE), 'a hand-typed month with no frontmatter keeps its paragraph');
      ok(!nofm.includes(`---${NOFM_LINE}`), 'and the fence the app adds is never glued onto it');
      ok(nofm.indexOf(NOFM_LINE) < nofm.indexOf(HEAD6), 'the paragraph stays above the table');
      /* Idempotent through the real loader: what was written loads back to
         the same pieces and writes the same bytes again. */
      const ctx2 = makeCtx(Object.fromEntries(ctx.vault._store), { budgetFolder: B });
      const S2 = await loadInto(ctx2);
      require('../src/views/transactions')(ctx2);
      for (const m of ['2026-09', '2026-08', '2026-07', '2026-06']) {
        eq(ctx2.serializeTxFile(S2.txFiles[`Cheque/${m}`]), get(ctx, m), `${m}: written → loaded → written again is a fixed point`);
      }
    }

    /* ---- 2. every write path keeps every line outside the table ---------- */
    for (const [name, run] of Object.entries(PATHS)) {
      const { ctx, S } = await mount();
      await run(ctx, S);
      const out = get(ctx, '2026-09');
      eq(proseKept(out), 3, `${name}: all 3 lines outside the table survive (L3-02 kept 0 of 3)`);
      ok(out.split('\n').includes(SHORT6), `${name}: and the file keeps its own separator row`);
      ok(tableOk(out), `${name}: the header and separator still agree, so the table still renders`);
      ok(out.indexOf(LEAD_LINE) < out.indexOf(HEAD6) && out.indexOf(TRAIL_LINES[0]) > out.lastIndexOf('| 2026-09-'),
        `${name}: the paragraph stays above the table and the queries below it`);
    }
    {
      const { ctx, S } = await mount();
      await PATHS.save(ctx, S);
      const before = PROSE.split('\n'), after = get(ctx, '2026-09').split('\n');
      eq(after.length, before.length, 'a recategorise adds and removes no line');
      eq(after.filter((l, i) => l !== before[i]), ['| 2026-09-01 | Coffee | Salary | -35.00 |  |  |'],
        'and the only line that differs is the one edited');
    }
    {
      const { ctx, S } = await mount();
      await PATHS.undo(ctx, S);
      eq(get(ctx, '2026-09'), PROSE, 'import then Undo leaves the prose month byte-identical');
    }
    {
      const { ctx, S } = await mount();
      await PATHS.add(ctx);
      const ctx2 = makeCtx(Object.fromEntries(ctx.vault._store), { budgetFolder: B });
      const S2 = await loadInto(ctx2);
      eq(S2.txFiles['Cheque/2026-09'].rows.map(r => [r.date, r.desc, r.cat, r.amount]),
        S.txFiles['Cheque/2026-09'].rows.map(r => [r.date, r.desc, r.cat, r.amount]),
        'the prose around the table does not leak into the rows the loader reads back');
      eq(rowLines(get(ctx, '2026-09')).length, 3, 'three rows on disk, the new one among them');
    }

    /* ---- 3. a separator that no longer fits gives way to the default ----- */
    {
      const { ctx, S } = await mount();
      const f = S.txFiles['Cheque/2026-08'];
      answers.push([{ amount: -12, cat: 'Food', note: '' }, { amount: -8, cat: 'Salary', note: '' }]);
      await ctx.splitTransaction({ _row: f.rows[0], _file: f, label: 'Cheque' });
      await ctx.saveTransactions();
      const out = get(ctx, '2026-08');
      ok(out.includes('| Split |'), 'fixture: the split added the seventh column');
      ok(out.split('\n').includes(LONG7), 'the six-cell short separator gives way to the seven-cell default');
      ok(!out.split('\n').includes(SHORT6), 'rather than leaving a separator one cell short of its header');
      ok(tableOk(out), 'so the table still renders');
    }
    {
      const { ctx } = await mount();
      answers.push({ date: '2026-10-02', desc: 'Bakery', label: 'Cheque', dir: 'out', amount: '20', cat: 'Food', note: '' });
      await ctx.addTransaction();
      const out = get(ctx, '2026-10');
      ok(out && out.split('\n').includes(LONG6), 'a month the app creates gets the default separator');
      eq(out.split('\n').slice(0, 7).join('\n'),
        '---\ntags: [finance, finance/budget, finance/budget/transactions]\naccount: "Cheque"\nmonth: 2026-10\n---\n\n' + HEAD6,
        'and the same opening lines a new month always had');
    }
    /* A month file holding only prose (typed by hand, nothing imported yet):
       all of it is lead, so its first row lands under the prose — with a blank
       line between, because a table written straight under a paragraph line
       is not a table to a Markdown renderer. With and without a final line
       break, and stable from the second save on. */
    for (const [label, text] of [['ends with a line break', '\nNothing imported yet.\n'], ['ends without one', '\nNothing imported yet.']]) {
      const files = { ...FILES, [P('2026-05')]: FM('2026-05') + text };
      const m = await mountFor(files, { period: '2026-05', budgetFolder: B });
      m.ctx.render = () => {}; m.ctx.switchView = () => {};
      answers.push({ date: '2026-05-04', desc: 'Bakery', label: 'Cheque', dir: 'out', amount: '20', cat: 'Food', note: '' });
      await m.ctx.addTransaction();
      const out = m.ctx.vault._store.get(P('2026-05'));
      eq(out, FM('2026-05') + '\nNothing imported yet.\n\n' + `${HEAD6}\n${LONG6}\n| 2026-05-04 | Bakery | Food | -20.00 |  |  |\n`,
        `a table-less month (${label}): the prose stays, a blank line, then the first row's table`);
      const ctx2 = makeCtx(Object.fromEntries(m.ctx.vault._store), { budgetFolder: B });
      const S2 = await loadInto(ctx2);
      require('../src/views/transactions')(ctx2);
      eq(ctx2.serializeTxFile(S2.txFiles['Cheque/2026-05']), out, `(${label}) and the next save writes the same bytes`);
    }

    /* ---- 4. negative control: without the pieces, the same paths lose it all */
    {
      const { ctx, S } = await mount('strip');
      for (const f of Object.values(S.txFiles)) f.dirty = true;
      await ctx.saveTransactions();
      eq(proseKept(get(ctx, '2026-09')), 0, 'negative control: with no lead/trail the prose is gone — sections 1-2 have teeth');
      ok(get(ctx, '2026-08').split('\n').includes(LONG6), 'negative control: with no sep the short separator is replaced');
      eq(get(ctx, '2026-07'), PLAIN, 'and a file with nothing to keep is unchanged either way — absent pieces are today\'s behaviour');
    }
  } finally { unpin(); }
  console.log(`PASS transactions-file-prose-kept — the lines around a month's table and its own separator survive every write (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
