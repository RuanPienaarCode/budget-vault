'use strict';
/* After a partial import and Undo, an open review judges duplicates against
   the ledger as it now is (2026-11-17 audit, M1).

   The review keeps a dedupe index on S.pendingImport, built when the file was
   read and extended by commitImport as each month file lands. A write that
   fails half way leaves the review open with the landed rows in that index —
   correctly: they ARE in the vault. Undo then takes those rows back out of the
   ledger and never touched the index, so the retry from the same review marked
   every undone row "dup" (a badge with no checkbox, "already in the vault")
   and the statement could only ever be half imported.

   The index is rebuilt from S.txFiles after the Undo rather than subtracted
   from: a same-day, same-amount pair makes subtraction easy to get wrong, and
   the rebuild is the one thing that is right by construction.

   Through the REAL view, loader, commit and undo:
     1. partial import (the second month's write fails) -> Undo -> re-render:
        the undone rows are not dup, are ticked, and importing them lands each
        row exactly once;
     2. a row matching a row ADDED BY HAND is still a dup after the Undo, and
        in a same-day pair (one hand-added copy, one imported copy) exactly one
        of the two is still the dup;
     3. a row the reader unticked keeps that choice through the Undo;
     4. an Undo with no review open is what it always was.

     node tests/import-undo-refreshes-open-review.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null, askSplit: async () => null,
      confirmModal: async () => true,
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');

const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
    + '| 2026-09-01 | Opening coffee | Food | -35.00 |  |  |\n',
};

/* Invented. Two Sept rows then two Oct rows, in date order. */
const CSV = [
  'Date,Description,Amount',
  '2026-09-03,Sept alpha,-100.00',
  '2026-09-09,Sept bravo,-250.00',
  '2026-10-04,Oct charlie,-75.00',
  '2026-10-11,Oct delta,-40.00',
].join('\n');

async function mount(csv, files = FILES) {
  const m = await mountFor(files, { period: '2026-09', budgetFolder: B });
  const { ctx, S } = m;
  ctx.render = () => {};
  ctx.switchView = () => {};
  const failing = new Set();
  for (const fn of ['create', 'modify']) {
    const real = ctx.vault[fn].bind(ctx.vault);
    ctx.vault[fn] = async (a, ...r) => {
      const p = typeof a === 'string' ? a : a.path;
      if (failing.has(p)) throw new Error('simulated disk error');
      return real(a, ...r);
    };
  }
  const file = { name: 'stmt.csv', async arrayBuffer() { return new TextEncoder().encode(csv).buffer; } };
  await ctx.handleStatementFile(file);
  S.pendingImport.label = 'Cheque';
  ctx.renderImportReview();
  return { ...m, failing };
}
const rowsOf = S => Object.values(S.txFiles).flatMap(f => f.rows.map(r => `${r.date} ${r.desc} ${r.amount}`)).sort();
const byDesc = (p, d) => p.items.find(i => i.desc === d);

(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    /* ---- 1. partial import, Undo, retry from the same review ---------------- */
    {
      const { ctx, S, failing } = await mount(CSV);
      const p = S.pendingImport;
      eq(p.items.length, 4, 'fixture: four rows read');
      ok(p.items.every(i => !i.dup), 'fixture: nothing is a duplicate to begin with');
      failing.add(`${B}/Transactions/Cheque/2026-10.md`);
      await ctx.commitImport();
      ok(S.pendingImport === p, 'fixture: the review stays open after a stopped import');
      ok(S.lastImport && S.lastImport.count === 2, 'fixture: the two Sept rows landed and are undoable');
      ok(byDesc(p, 'Sept alpha').dup && byDesc(p, 'Sept bravo').dup,
        'while they are in the vault the landed rows ARE duplicates (the index is right before the Undo)');
      failing.clear();
      await ctx.undoImport();
      eq(rowsOf(S), ['2026-09-01 Opening coffee -35'], 'fixture: Undo took both landed rows out of the ledger');
      ctx.renderImportReview();
      ok(!byDesc(p, 'Sept alpha').dup && !byDesc(p, 'Sept bravo').dup, 'after the Undo the undone rows are not labelled duplicates');
      ok(byDesc(p, 'Sept alpha').include && byDesc(p, 'Sept bravo').include, 'and they are ticked again, importable');
      ok(/4 new · 0 duplicates skipped/.test(ctx.$('#impStats').textContent), `the header agrees: ${ctx.$('#impStats').textContent}`);
      await ctx.commitImport();
      eq(rowsOf(S), ['2026-09-01 Opening coffee -35', '2026-09-03 Sept alpha -100', '2026-09-09 Sept bravo -250',
        '2026-10-04 Oct charlie -75', '2026-10-11 Oct delta -40'], 'the retry imports every statement row exactly once');
      eq(S.pendingImport, null, 'and the review closes');
    }

    /* ---- 2. rows really in the vault are still flagged ---------------------- */
    {
      const csv = [
        'Date,Description,Amount',
        '2026-09-01,Opening coffee,-35.00',   // same as a row already in the ledger
        '2026-09-05,Twin fee,-9.00',          // the statement lists the same fee twice on one day...
        '2026-09-05,Twin fee,-9.00',
        '2026-10-04,Oct charlie,-75.00',
      ].join('\n');
      // ...and the reader had already added ONE copy of it by hand, before the file was read.
      const handAdded = { ...FILES, [`${B}/Transactions/Cheque/2026-09.md`]: FILES[`${B}/Transactions/Cheque/2026-09.md`]
        + '| 2026-09-05 | Twin fee | Food | -9.00 |  |  |\n' };
      const { ctx, S, failing } = await mount(csv, handAdded);
      const p = S.pendingImport;
      const [coffee, twin1, twin2] = p.items;
      ok(coffee.dup && twin1.dup && !twin2.dup, 'fixture: the ledger row and the hand-added twin are duplicates, the second twin is new');
      failing.add(`${B}/Transactions/Cheque/2026-10.md`);
      await ctx.commitImport();   // Sept month writes (the second twin), Oct fails
      ok(S.lastImport && S.lastImport.count === 1, 'fixture: the one new Sept row landed');
      ok(twin1.dup && twin2.dup, 'both twins are in the vault now');
      failing.clear();
      await ctx.undoImport();
      ctx.renderImportReview();
      ok(coffee.dup, 'a row matching the ledger\'s own row is still a duplicate after the Undo');
      ok(twin1.dup && !twin2.dup, 'of the same-day pair exactly one is still a duplicate: the hand-added copy is still there, the undone one is not');
      ok(twin2.include, 'and the undone copy is ticked');
      await ctx.commitImport();
      eq(rowsOf(S).filter(r => r.includes('Twin fee')), ['2026-09-05 Twin fee -9', '2026-09-05 Twin fee -9'],
        'the retry leaves two twins in the vault: the hand-added one and the re-imported one');
      eq(rowsOf(S).filter(r => r.includes('Opening coffee')).length, 1, 'the already-present row was never imported again');
    }

    /* ---- 3. a hand-made untick survives the Undo ---------------------------- */
    {
      const { ctx, S, failing } = await mount(CSV);
      const p = S.pendingImport;
      byDesc(p, 'Oct delta').include = false;
      failing.add(`${B}/Transactions/Cheque/2026-10.md`);
      await ctx.commitImport();
      failing.clear();
      await ctx.undoImport();
      ctx.renderImportReview();
      ok(byDesc(p, 'Oct delta').include === false, 'the row the reader unticked is still unticked');
      ok(byDesc(p, 'Sept alpha').include && byDesc(p, 'Oct charlie').include, 'the others are ticked');
      await ctx.commitImport();
      ok(!rowsOf(S).some(r => r.includes('Oct delta')), 'and it was not imported');
      eq(rowsOf(S).length, 4, 'the other three rows plus the one already there');
    }

    /* ---- 4. no review open: an Undo is what it always was ------------------- */
    {
      const { ctx, S } = await mount(CSV);
      ctx.S.pendingImport.label = 'Cheque';
      await ctx.commitImport();
      eq(S.pendingImport, null, 'fixture: a complete import closes the review');
      eq(rowsOf(S).length, 5, 'fixture: all four rows landed');
      await ctx.undoImport();
      eq(S.pendingImport, null, 'Undo with no review open does not conjure one');
      eq(rowsOf(S), ['2026-09-01 Opening coffee -35'], 'and takes back exactly the imported rows');
      eq(S.lastImport, null, 'the offer is spent');
    }
  } finally { unpin(); }
  console.log(`PASS import-undo-refreshes-open-review — an open review judges duplicates against the ledger after an Undo (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
