'use strict';
/* Undoing an import takes back the month files the import CREATED.

   undoImport rewrote every month file the import had touched from "its rows
   minus the imported ones" — including a month the import itself had brought
   into existence. So import → Undo was not a no-op: it left a header-only
   Transactions/<account>/<month>.md behind, an empty month in memory, and a
   second Undo changed nothing (2026-10-07 audit, L3-19; on the audited copy,
   a Credit Card month two years ahead of anything real).

   commitImport now records, per month, whether the file existed before it
   wrote — asked of the vault the way the filesystem answers (io.js
   pathTaken, case-folded), not only of the in-memory model, so a month that
   reached disk some other way since the last load is never mistaken for one
   this import made. An Undo that leaves such a file with no rows moves it to
   the vault's own trash (io.js trashFile: recoverable, never the system
   trash) and drops it from memory; a month that existed before, or that has
   gained rows of the reader's own since, is rewritten as it always was.

   Through the REAL loader, commit and undo:
     1. an import into an account with no months, then Undo: the vault is
        byte-identical to before (folder markers aside) and memory holds no
        month for that account;
     2. an import into a month that already existed, then Undo: the file
        stays, byte for byte what it was;
     3. a created month that gained a row of the reader's own (Add
        transaction) before the Undo is rewritten, not trashed;
     4. what the confirmation says: which files are rewritten and which go to
        the trash.

     node tests/import-undo-removes-created-file.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const answers = [];
const confirms = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => answers.shift() || null,
      askSplit: async () => null,
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

const B = 'Budget';
const CHEQUE_SEPT = `${B}/Transactions/Cheque/2026-09.md`;
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Accounts/Card.md`]: '---\ntype: credit_card\nbalance: 0.00\nbalance_updated: 2026-09-30\n---\n',
  [CHEQUE_SEPT]: '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n'
    + '| 2026-09-01 | Coffee | Food | -35.00 |  |  |\n',
};

async function mount() {
  const m = await mountFor(FILES, { period: '2026-09', budgetFolder: B });
  m.ctx.render = () => {};
  m.ctx.switchView = () => {};
  const trashed = [];
  const realTrash = m.ctx.vault.trash.bind(m.ctx.vault);
  m.ctx.vault.trash = async (f, system) => { trashed.push({ path: f.path, system }); return realTrash(f, system); };
  return { ...m, trashed };
}
const files = ctx => new Map([...ctx.vault._store].filter(([k]) => !k.endsWith('/.folder')));
const importInto = async (ctx, S, label, items) => {
  S.pendingImport = { label, filename: `${label.toLowerCase()}.csv`, index: buildIndex(S.txFiles),
    items: items.map(([date, desc, amount]) => ({ date, desc, cat: 'Food', amount, excluded: false, include: true, dup: false })) };
  await ctx.commitImport();
};

(async () => {
  const unpin = pinClock('2026-10-07');
  try {
    /* ---- 1. created months go back to the trash ---------------------------- */
    {
      const { ctx, S, trashed } = await mount();
      const before = files(ctx);
      await importInto(ctx, S, 'Card', [['2026-09-11', 'Fuel', -800], ['2026-10-02', 'Books', -240]]);
      ok(ctx.vault._store.has(`${B}/Transactions/Card/2026-09.md`) && ctx.vault._store.has(`${B}/Transactions/Card/2026-10.md`),
        'fixture: the import created two Card months');
      await ctx.undoImport();
      eq([...files(ctx).keys()], [...before.keys()], 'import → Undo leaves no file behind (L3-19: a header-only month was left)');
      ok([...before].every(([k, v]) => files(ctx).get(k) === v), 'and every file that was there is byte-identical');
      eq(Object.keys(S.txFiles).filter(k => k.startsWith('Card/')), [], 'memory holds no month for Card either — it models what the disk has');
      eq(trashed.map(t => t.path).sort(), [`${B}/Transactions/Card/2026-09.md`, `${B}/Transactions/Card/2026-10.md`],
        'both went through the vault trash');
      ok(trashed.every(t => t.system === false), 'the vault\'s own .trash, recoverable from inside Obsidian — never the system trash');
      eq(S.lastImport, null, 'the offer is spent');
      const said = confirms[confirms.length - 1].message;
      ok(/2 files? this import created/.test(said) && /trash/.test(said), `the confirmation says the created files go to the trash: ${JSON.stringify(said)}`);
    }

    /* ---- 2. a month that existed before is rewritten, not removed ---------- */
    {
      const { ctx, S, trashed } = await mount();
      await importInto(ctx, S, 'Cheque', [['2026-09-12', 'Fuel', -400]]);
      ok(ctx.vault._store.get(CHEQUE_SEPT).includes('| Fuel |'), 'fixture: the import landed in the existing month');
      await ctx.undoImport();
      eq(ctx.vault._store.get(CHEQUE_SEPT), FILES[CHEQUE_SEPT], 'the month that was already there is back to its own bytes');
      eq(trashed, [], 'and nothing was trashed');
      eq(S.txFiles['Cheque/2026-09'].rows.map(r => r.desc), ['Coffee'], 'its own row is still in memory');
    }

    /* ---- 3. a created month with a row of the reader's own is kept --------- */
    {
      const { ctx, S, trashed } = await mount();
      await importInto(ctx, S, 'Card', [['2026-09-11', 'Fuel', -800]]);
      answers.push({ date: '2026-09-20', desc: 'Parking', label: 'Card', dir: 'out', amount: '15', cat: 'Food', note: '' });
      await ctx.addTransaction();
      await ctx.undoImport();
      const out = ctx.vault._store.get(`${B}/Transactions/Card/2026-09.md`);
      ok(out && out.includes('| Parking |') && !out.includes('| Fuel |'), 'the month keeps the row the reader added, and loses only the imported one');
      eq(trashed, [], 'so it is rewritten, never trashed');
      eq(S.txFiles['Card/2026-09'].rows.map(r => r.desc), ['Parking'], 'and memory agrees');
    }
  } finally { unpin(); }
  console.log(`PASS import-undo-removes-created-file — an import's Undo takes back the month files it made (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
