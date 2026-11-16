'use strict';
/* Undo import takes the split parts of an imported row with it.

   The undo receipt holds the ROW OBJECTS commitImport pushed. A row split after
   the import is mutated in place into the parent (so it is still on the
   receipt), but its parts are NEW row objects made on the Transactions page —
   so Undo removed the parent and left the parts behind: orphaned rows
   describing a charge that no longer existed, counted as ordinary spend, and a
   created month file that never counted as emptied.

   The parts are found the way the Transactions page finds them (tx-role.js
   splitPartsOf: same file, role `part`, same date and description). The one case
   that cannot be settled by looking — another split parent with the same date
   and description that is NOT part of this import — keeps the parts and says so.

     1. 3 imported rows, one split in 2 → all 5 gone, the created month trashed
     2. an un-split import undoes exactly as before (no mention of parts)
     3. the ambiguous case keeps the parts and reports it
     4. a row the reader added in the same month still survives
     5. the lookup itself, in tx-role.js

     node tests/import-undo-removes-split-parts.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const confirms = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null, askSplit: async () => null,
      confirmModal: async (app, opts) => { confirms.push(opts); return true; },
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { buildIndex } = require('../src/dedupe');
const { applySplit, splitPartsOf, splitParentsSharingKey } = require('../src/tx-role');

const B = 'Budget';
const CARD_SEPT = `${B}/Transactions/Card/2026-09.md`;
const HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#aa8888"\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\nbalance: 0.00\nbalance_updated: 2026-09-30\n---\n',
};

async function mount() {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.switchView = () => {};
  m.ctx.renderTransactions = () => {};
  // the harness records every toast on ctx._toasts as { msg, bad }
  m.lastToast = () => (m.ctx._toasts[m.ctx._toasts.length - 1] || {}).msg;
  return m;
}
const importInto = async (ctx, S, label, items) => {
  S.pendingImport = { label, filename: 'card.csv', index: buildIndex(S.txFiles),
    items: items.map(([date, desc, amount]) => ({ date, desc, cat: 'Food', amount, excluded: false, include: true, dup: false })) };
  await ctx.commitImport();
};
/* What the Transactions page does to a row: applySplit mutates the parent in
   place and the new part rows are appended to the same file. */
const splitRow = (file, desc, shares) => {
  const parent = file.rows.find(r => r.desc === desc);
  const parts = applySplit(parent, shares.map(([amount, cat]) => ({ amount, cat, note: '' })), 'Split');
  file.rows.push(...parts);
  return parent;
};
const descs = file => file.rows.map(r => `${r.desc}|${r.amount}|${r.split || ''}`);

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    const IMPORT = [['2026-09-11', 'Fuel Station', -800], ['2026-09-12', 'Grocer', -300], ['2026-09-13', 'Pharmacy', -150]];

    /* ---- 1. parts go with the parent; the created month counts as emptied ---- */
    {
      const { ctx, S, lastToast } = await mount();
      confirms.length = 0;
      await importInto(ctx, S, 'Card', IMPORT);
      const file = S.txFiles['Card/2026-09'];
      eq(file.rows.length, 3, 'fixture: three rows imported');
      splitRow(file, 'Fuel Station', [[-500, 'Fuel'], [-300, 'Food']]);
      eq(file.rows.length, 5, 'fixture: the split added two parts');
      const trashed = [];
      const realTrash = ctx.vault.trash.bind(ctx.vault);
      ctx.vault.trash = async (f, system) => { trashed.push(f.path); return realTrash(f, system); };
      await ctx.undoImport();
      eq(S.txFiles['Card/2026-09'], undefined, 'all five rows are gone and the month this import created left memory');
      eq(trashed, [CARD_SEPT], 'and the created month file went to the trash — it counted as emptied');
      ok(!ctx.vault._store.has(CARD_SEPT), 'nothing is left on disk');
      const said = confirms[confirms.length - 1];
      ok(/2 split parts/.test(said.message) && /Remove the 3 rows/.test(said.message), `the confirmation names the parts: ${JSON.stringify(said.message)}`);
      eq(said.confirmText, 'Remove 5 rows', 'and the button says how many rows really go');
      ok(/2 split parts included/.test(lastToast()), `the result says so too: ${JSON.stringify(lastToast())}`);
    }

    /* ---- 2. an un-split import undoes exactly as before ---- */
    {
      const { ctx, S, lastToast } = await mount();
      confirms.length = 0;
      await importInto(ctx, S, 'Card', IMPORT);
      await ctx.undoImport();
      eq(S.txFiles['Card/2026-09'], undefined, 'the created month is taken back');
      const said = confirms[confirms.length - 1];
      ok(!/split/.test(said.message) && said.confirmText === 'Remove 3 rows', 'the confirmation does not mention parts when there are none');
      ok(/^Undone — 3 rows removed from 1 file$/.test(lastToast()), `and the result is the old sentence: ${JSON.stringify(lastToast())}`);
    }

    /* ---- 3. ambiguous: another parent with the same date + description stays ---- */
    {
      const { ctx, S, lastToast } = await mount();
      // The reader already holds a split Fuel Station charge on the same day in
      // the same month (their own row, not part of the import).
      const own = ['2026-09-11', 'Fuel Station'];
      S.txFiles['Card/2026-09'] = { label: 'Card', month: '2026-09', dirty: false, fmRaw: 'tags: [finance]',
        rows: [{ date: own[0], desc: own[1], cat: 'Fuel', amount: -800, excluded: false, note: '', split: '' }] };
      const ownParent = splitRow(S.txFiles['Card/2026-09'], 'Fuel Station', [[-500, 'Fuel'], [-300, 'Food']]);
      await ctx.writeFile(`${B}/Transactions/Card/2026-09.md`, ctx.serializeTxFile(S.txFiles['Card/2026-09']));
      confirms.length = 0;
      await importInto(ctx, S, 'Card', IMPORT);
      const file = S.txFiles['Card/2026-09'];
      const importedFuel = file.rows.filter(r => r.desc === 'Fuel Station' && r !== ownParent && !r.split)[0];
      ok(!!importedFuel, 'fixture: the import added its own Fuel Station row beside the reader\'s split one');
      // …which the reader then split too: now two parents and four parts share a key.
      importedFuel.excluded = true; importedFuel.split = 'parent';
      file.rows.push({ date: own[0], desc: own[1], cat: 'Fuel', amount: -400, excluded: false, note: '', split: 'part' },
        { date: own[0], desc: own[1], cat: 'Food', amount: -400, excluded: false, note: '', split: 'part' });
      eq(file.rows.filter(r => r.split === 'part').length, 4, 'fixture: four parts, two parents, one key');
      await ctx.undoImport();
      const left = S.txFiles['Card/2026-09'];
      eq(left.rows.filter(r => r.split === 'part').length, 4, 'the parts are LEFT in place: they cannot be told apart');
      ok(left.rows.includes(ownParent), 'and the reader\'s own parent is untouched');
      ok(!left.rows.includes(importedFuel), 'while the imported parent is removed as the receipt says');
      ok(!left.rows.some(r => r.desc === 'Grocer' || r.desc === 'Pharmacy'), 'and the other imported rows are gone');
      const said = confirms[confirms.length - 1].message;
      ok(/4 split parts could not be told apart/.test(said), `the confirmation says so: ${JSON.stringify(said)}`);
      ok(/4 split parts could not be told apart/.test(lastToast()) && /stay in place/.test(lastToast()),
        `and so does the result: ${JSON.stringify(lastToast())}`);
    }

    /* ---- 4. a reader-added ordinary row in the same month survives ---- */
    {
      const { ctx, S, lastToast } = await mount();
      await importInto(ctx, S, 'Card', IMPORT);
      const file = S.txFiles['Card/2026-09'];
      splitRow(file, 'Fuel Station', [[-500, 'Fuel'], [-300, 'Food']]);
      file.rows.push({ date: '2026-09-20', desc: 'Parking', cat: 'Food', amount: -15, excluded: false, note: '', split: '' });
      await ctx.undoImport();
      const left = S.txFiles['Card/2026-09'];
      eq(descs(left), ['Parking|-15|'], 'only the reader\'s own row remains — the month is rewritten, not trashed');
      ok(ctx.vault._store.get(CARD_SEPT).includes('| Parking |') && !ctx.vault._store.get(CARD_SEPT).includes('Fuel Station'),
        'and the file on disk agrees');
    }

    /* ---- 5. the lookup ---- */
    {
      const P = { date: '2026-09-11', desc: 'X', amount: -10, split: 'parent', excluded: true };
      const mk = (o = {}) => ({ date: '2026-09-11', desc: 'X', amount: -5, split: 'part', ...o });
      const rows = [P, mk(), mk(), mk({ date: '2026-09-12' }), mk({ desc: 'Y' }), mk({ split: '' }), mk({ split: 'parent' })];
      eq(splitPartsOf(rows, P).length, 2, 'parts: role part, same date, same description — nothing else');
      eq(splitParentsSharingKey(rows, P).length, 1, 'sharing a key: another parent with the same date and description');
      eq(splitPartsOf(null, P), [], 'no rows, no parts');
    }
  } finally { unpin(); }
  console.log(`PASS import-undo-removes-split-parts — Undo import takes a split row's parts with it (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
