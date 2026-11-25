'use strict';
/* Import rows and Undo import run once at a time, and the receipt an Undo is
   built from covers exactly what the file it names put in the vault
   (2026-11-25 audit, IMP-2, IMP-3, IMP-8).

   IMP-2. commitImport and undoImport had no in-flight guard. On a slow
   (iCloud) vault a second tap on "Import rows" while the first was still
   writing started a second commit: memory got every row twice, and Undo then
   removed one copy and reported success while the disk still held the rows.

   IMP-3. A retry after a partial failure REPLACED the receipt, so Undo took
   back only the retried rows and the first attempt's stayed with no way back.
   And when the very first write failed, the toast offered "Undo it" — pointing
   at the receipt of an EARLIER import, a different file.

   IMP-8. The Undo bar's time was UTC: at 14:00 in Johannesburg it said 12:00.

   Through the REAL view, loader, commit and undo, with the vault's writes
   delayed or failed on purpose. Everything is synthetic.

     node tests/import-commit-receipt.test.cjs */

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
const CSV = ['Date,Description,Amount', '2026-09-03,Sept alpha,-100.00', '2026-09-09,Sept bravo,-250.00',
  '2026-10-04,Oct charlie,-75.00', '2026-10-11,Oct delta,-40.00'].join('\n');
const EARLIER = ['Date,Description,Amount', '2026-09-20,Earlier one,-11.00'].join('\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mount() {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  const { ctx } = m;
  ctx.render = () => {};
  ctx.switchView = () => {};
  ctx.renderTransactions = () => {};
  // The harness records every toast on ctx._toasts as { msg, bad }; the view
  // took `toast` off the ctx when it registered, so that list is the one to read.
  const toasts = { get length() { return ctx._toasts.length; } };
  const toastAt = i => (ctx._toasts[i] || {}).msg || '';
  const failing = new Set();
  let delay = 0;
  for (const fn of ['create', 'modify']) {
    const real = ctx.vault[fn].bind(ctx.vault);
    ctx.vault[fn] = async (a, ...r) => {
      const p = typeof a === 'string' ? a : a.path;
      if (delay) await sleep(delay);
      if (failing.has(p)) throw new Error('simulated disk error');
      return real(a, ...r);
    };
  }
  const open = async (csv, name) => {
    await ctx.handleStatementFile({ name, async arrayBuffer() { return new TextEncoder().encode(csv).buffer; } });
    ctx.S.pendingImport.label = 'Cheque';
    ctx.renderImportReview();
    return ctx.S.pendingImport;
  };
  return { ...m, toasts, toastAt, failing, open, setDelay: d => { delay = d; } };
}
const memRows = S => Object.values(S.txFiles).flatMap(f => f.rows.map(r => `${r.date} ${r.desc}`)).sort();
const diskRows = ctx => [...ctx.vault._store].filter(([k]) => k.includes('/Transactions/'))
  .flatMap(([, v]) => v.split('\n').filter(l => l.startsWith('| 2')).map(l => l.split('|').slice(1, 3).map(s => s.trim()).join(' '))).sort();
const ORIGINAL = ['2026-09-01 Opening coffee'];
const ALL = ['2026-09-01 Opening coffee', '2026-09-03 Sept alpha', '2026-09-09 Sept bravo', '2026-10-04 Oct charlie', '2026-10-11 Oct delta'];

(async () => {
  const unpin = pinClock('2026-10-20');
  try {
    /* ---- IMP-2. a second tap while the first commit is writing ------------- */
    {
      const { ctx, S, open, setDelay } = await mount();
      await open(CSV, 'stmt.csv');
      setDelay(25);
      const first = ctx.commitImport();
      await sleep(5);
      ok(ctx.$('#impCommit').disabled, 'the Import button is off while the rows are being written');
      const second = ctx.commitImport();
      await Promise.all([first, second]);
      eq(memRows(S), ALL, 'memory holds every statement row exactly once');
      eq(diskRows(ctx), ALL, 'and so does the disk');
      eq(S.lastImport && S.lastImport.count, 4, 'the receipt counts the four rows once');
      ok(!ctx.$('#impCommit').disabled, 'the button is given back when the commit is done');
      const u1 = ctx.undoImport();
      await sleep(5);
      const u2 = ctx.undoImport();
      await Promise.all([u1, u2]);
      eq(memRows(S), ORIGINAL, 'Undo takes every imported row out of memory');
      eq(diskRows(ctx), ORIGINAL, 'and off the disk — no copy left behind');
    }

    /* ---- IMP-2. the button comes back even when the commit throws early ---- */
    {
      const { ctx, open, failing } = await mount();
      await open(CSV, 'stmt.csv');
      failing.add(`${B}/Transactions/Cheque/2026-09.md`);
      await ctx.commitImport();
      ok(!ctx.$('#impCommit').disabled, 'a failed commit gives the button back too');
    }

    /* ---- IMP-3. a retry adds to the receipt of the same import ------------- */
    {
      const { ctx, S, open, failing, toasts, toastAt } = await mount();
      await open(CSV, 'stmt.csv');
      failing.add(`${B}/Transactions/Cheque/2026-10.md`);
      await ctx.commitImport();
      eq(S.lastImport && S.lastImport.count, 2, 'fixture: the two Sept rows landed');
      ok(/Undo it/.test(toastAt(toasts.length - 1)), `and the toast offers Undo for them: ${ctx._toasts.map(t => t.msg).join(' / ')}`);
      failing.clear();
      await ctx.commitImport();
      eq(diskRows(ctx), ALL, 'fixture: the retry landed the October rows');
      eq(S.lastImport.count, 4, 'the receipt now covers both attempts');
      await ctx.undoImport();
      eq(diskRows(ctx), ORIGINAL, 'so one Undo takes back every row this file put in the vault');
      eq(memRows(S), ORIGINAL, 'in memory as well');
    }

    /* ---- IMP-3. nothing from this file landed: no Undo offered for it ------ */
    {
      const { ctx, S, open, failing, toasts, toastAt } = await mount();
      await open(EARLIER, 'earlier.csv');
      await ctx.commitImport();
      const earlier = S.lastImport;
      ok(earlier && earlier.filename === 'earlier.csv', 'fixture: an earlier import left its receipt');
      await open(CSV, 'stmt.csv');
      failing.add(`${B}/Transactions/Cheque/2026-09.md`);
      await ctx.commitImport();
      const said = toastAt(toasts.length - 1);
      ok(!/Undo/.test(said), `the toast does not offer an Undo for a file of which nothing landed: ${said}`);
      ok(/Nothing was imported/.test(said), 'it says nothing was imported');
      ok(S.lastImport === earlier, 'the earlier import\'s receipt is left as it was, still naming its own file');
    }

    /* ---- IMP-8. the Undo bar's time is local ------------------------------- */
    {
      const { ctx, S, open } = await mount();
      process.env.TZ = 'Africa/Johannesburg';   // pinned clock reads 12:00Z: 14:00 here
      await open(EARLIER, 'earlier.csv');
      await ctx.commitImport();
      eq(S.lastImport.at, '14:00', 'the receipt is stamped in local time, the way the reader\'s clock reads');
      process.env.TZ = 'UTC';
    }
  } finally { unpin(); }
  console.log(`PASS import-commit-receipt — one commit or undo at a time, and the receipt covers what its file landed (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
