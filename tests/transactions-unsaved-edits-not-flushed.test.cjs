'use strict';
/* Add transaction and an import's commit no longer write a month's UNSAVED
   edits to disk.

   Both write a month file whole, from its live in-memory model —
   `{ ...existing, rows: existing.rows.concat(added) }` — so a recategorise or
   an Excluded tick sitting unsaved in that month reached disk with the new
   row, Save never pressed, and "Reload from disk" stopped being a way back
   from it (2026-10-07 audit, L3-26: the disk said "Coffee | Salary" while the
   reader had only ever pressed Add). The page's own rules already said this
   was wrong: a delete, a split and an un-split stay in memory for exactly this
   reason, and the bulk delete and the export refuse while anything is unsaved.

   The fix REFUSES, with a sentence, while the month the new rows would land
   in has unsaved edits — the one choice that cannot lose either change. The
   alternative, writing the new rows onto the file's on-disk content, needs
   the month as it was last read; that is the loader's job, and a second copy
   of its column mapping inside the view is the mirror CLAUDE.md warns
   against. Refusing loses nothing: the edits stay in memory and stay unsaved,
   the import review stays on screen untouched, and Add transaction keeps the
   entry the reader typed for the next time it opens.

   Pinned, through the REAL loader, page and import commit:
     1. Add transaction into a month with unsaved edits writes nothing, keeps
        the edit in memory and dirty, says why, and reopens with the entry;
     2. an import that would write into such a month writes nothing at all
        (not even its other months), keeps the review, and says which month;
     3. controls: a clean month is written as before, and an edit in ANOTHER
        month never blocks an add or an import — only the months written.

     node tests/transactions-unsaved-edits-not-flushed.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const answers = [];
const asked = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async (app, title, fields) => { asked.push({ title, fields }); return answers.shift() || null; },
      askSplit: async () => null,
      confirmModal: async () => true, askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { buildIndex } = require('../src/dedupe');
const i18n = require('../src/i18n');

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const SEPT = `${B}/Transactions/Cheque/2026-09.md`;
const AUG = `${B}/Transactions/Cheque/2026-08.md`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [SEPT]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n' + HEAD + '| 2026-09-01 | Coffee | Food | -35.00 |  |  |\n',
  [AUG]: '---\naccount: "Cheque"\nmonth: 2026-08\n---\n\n' + HEAD + '| 2026-08-01 | Bread | Food | -20.00 |  |  |\n',
};
const BAKERY = { date: '2026-09-05', desc: 'Bakery', label: 'Cheque', dir: 'out', amount: '20', cat: 'Food', note: 'cash' };

async function mount() {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.switchView = () => {};
  return m;
}
/* An unsaved recategorise, the way the table's category control makes one. */
function editUnsaved(S, key) {
  const f = S.txFiles[key];
  f.rows[0].cat = 'Salary';
  f.dirty = true;
  return f;
}
const lastToast = ctx => ctx._toasts[ctx._toasts.length - 1] || {};
const pendingWith = (S, items) => ({ label: 'Cheque', filename: 'cheque.csv', index: buildIndex(S.txFiles), items });
const item = (date, desc, amount) => ({ date, desc, cat: 'Food', amount, excluded: false, include: true, dup: false });

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. Add transaction into a month with unsaved edits ---------------- */
    {
      const { ctx, S } = await mount();
      const f = editUnsaved(S, 'Cheque/2026-09');
      answers.push({ ...BAKERY });
      await ctx.addTransaction();
      eq(ctx.vault._store.get(SEPT), FILES[SEPT], 'nothing reaches disk — the unsaved recategorise is not written behind the reader\'s back (L3-26)');
      eq(f.rows.map(r => [r.desc, r.cat]), [['Coffee', 'Salary']], 'the edit is still in memory, and the new row was not added there either');
      ok(f.dirty, 'and the month is still marked unsaved, so Save still offers it');
      const t = lastToast(ctx);
      ok(t.bad, 'the refusal is said, as an error');
      eq(t.msg, i18n.t('tx.add.dirty', { file: 'Transactions/Cheque/2026-09.md' }), 'naming the file that has the unsaved changes');
      ok(t.msg.includes('Transactions/Cheque/2026-09.md'), 'with the path filled in (the key exists in lang/en.js)');

      /* The entry is kept: the next Add transaction opens with it. */
      answers.push(null);
      await ctx.addTransaction();
      const fields = asked[asked.length - 1].fields;
      const val = k => (fields.find(x => x.key === k) || {}).value;
      eq([val('date'), val('desc'), val('label'), val('dir'), val('amount'), val('cat'), val('note')],
        [BAKERY.date, BAKERY.desc, BAKERY.label, BAKERY.dir, BAKERY.amount, BAKERY.cat, BAKERY.note],
        'the dialog reopens with what was typed, so refusing cost the reader nothing');
      answers.push(null);
      await ctx.addTransaction();
      eq((asked[asked.length - 1].fields.find(x => x.key === 'desc') || {}).value, undefined,
        'once used (here: cancelled), the kept entry is gone — the next dialog is a fresh one');

      /* After Save, the same add goes through — and writes both, deliberately. */
      await ctx.saveTransactions();
      answers.push({ ...BAKERY });
      await ctx.addTransaction();
      const disk = ctx.vault._store.get(SEPT);
      ok(disk.includes('| Coffee | Salary |') && disk.includes('| Bakery |'), 'with the edits saved, Add transaction writes the new row as before');
    }

    /* ---- 2. an import into a month with unsaved edits ---------------------- */
    {
      const { ctx, S } = await mount();
      editUnsaved(S, 'Cheque/2026-09');
      const before = new Map(ctx.vault._store);
      S.pendingImport = pendingWith(S, [item('2026-09-12', 'Fuel', -400), item('2026-10-02', 'Fuel', -300)]);
      const pending = S.pendingImport;
      await ctx.commitImport();
      eq(ctx.vault._store.get(SEPT), FILES[SEPT], 'the dirty month is not written');
      eq([...ctx.vault._store.keys()].filter(k => !before.has(k)), [], 'and nor is any OTHER month the import would have created — it is all or nothing');
      eq(S.pendingImport, pending, 'the review stays on screen, every pick on it intact');
      ok(pending.items.every(it => it.include), 'no row was marked as landed');
      eq(S.lastImport || null, null, 'and there is nothing to undo, because nothing happened');
      const t = lastToast(ctx);
      ok(t.bad && t.msg.includes('Transactions/Cheque/2026-09.md'), 'the refusal names the month with the unsaved changes');
    }

    /* ---- 3. controls -------------------------------------------------------- */
    {
      const { ctx, S } = await mount();
      editUnsaved(S, 'Cheque/2026-08');            // unsaved, but in ANOTHER month
      answers.push({ ...BAKERY });
      await ctx.addTransaction();
      ok(ctx.vault._store.get(SEPT).includes('| Bakery |'), 'control: an edit in August does not block an add in September');
      eq(ctx.vault._store.get(AUG), FILES[AUG], 'and August\'s unsaved edit stays unsaved');
      S.pendingImport = pendingWith(S, [item('2026-09-12', 'Fuel', -400)]);
      await ctx.commitImport();
      ok(ctx.vault._store.get(SEPT).includes('| Fuel |'), 'control: nor an import that only writes September');
      eq(ctx.vault._store.get(AUG), FILES[AUG], 'August still untouched on disk');
      ok(S.txFiles['Cheque/2026-08'].dirty, 'and still waiting for Save');
    }
  } finally { unpin(); }
  console.log(`PASS transactions-unsaved-edits-not-flushed — Add transaction and an import never save edits the reader has not saved (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
