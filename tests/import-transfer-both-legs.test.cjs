'use strict';
/* A transfer between two of the household's own accounts ends up out of the
   budget on BOTH legs, whichever statement is imported first — or the review
   says which half is still counted (2026-11-25 audit, IMP-5).

   applyCounterparties excludes the incoming row when the account its
   description names already holds the other leg. But that vault leg was
   imported earlier, when its partner did not exist yet, so it went in
   counted, and nothing reached back to it: import Cheque
   ("TRANSFER TO 62000000001  -5 000"), then Savings
   ("TRANSFER FROM 1234567890  +5 000"), and the Savings row was written
   Excluded "yes" while the Cheque row stayed in spending. R5 000 of spend
   that was never spent, on no screen.

   Now the review names that vault leg (account, date, description, amount)
   with a ticked-by-default choice to mark it excluded as part of this
   import. On commit the chosen legs are marked excluded in their own month
   files — `excluded` only; a category the reader set stays — through the
   import's own writer, and the receipt holds them so Undo import counts them
   again. Unticked, the vault leg is left exactly as it was and the sentence
   stays as the warning. A split row is named and never touched: its parts
   are the reader's own slices. How a leg is MATCHED is not changed.

   Through the REAL loader, import view, commit and undo, reloading from the
   bytes the app wrote. Synthetic accounts and rows only.
     node tests/import-transfer-both-legs.test.cjs */

const assert = require('assert');
const Module = require('module');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SRC = path.join(__dirname, '..', 'src') + path.sep;
const asked = [];
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC) && /(^|\/)modal(\.js)?$/.test(request)) {
    return {
      askFields: async () => null, askSplit: async () => null,
      confirmModal: async (app, opts) => { asked.push(opts); return true; },
      askRulesCleanup: async () => false, askBudgetReslice: async () => null,
    };
  }
  return origLoad.call(this, request, parent, ...rest);
};

const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { transferLegStanding } = require('../src/statement');

const B = 'Budget';
const HEAD = '| Date | Description | Category | Amount | Excluded | Note |\n|------|-------------|----------|-------:|----------|------|\n';
const SPLIT_HEAD = '| Date | Description | Category | Amount | Excluded | Note | Split |\n|------|-------------|----------|-------:|----------|------|-------|\n';
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Saving.md`]: '---\ntype: savings\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\naccount_number: "1234567890"\nbalance: 1.00\nbalance_updated: 2026-09-30\n---\n',
  [`${B}/Accounts/Savings.md`]: '---\ntype: savings\naccount_number: "62000000001"\nbalance: 0.00\nbalance_updated: 2026-09-30\n---\n',
};
const CHEQUE_CSV = 'Date,Description,Amount\n2026-11-25,SALARY ACME,30000.00\n2026-11-26,TRANSFER TO 62000000001,-5000.00\n';
const SAVINGS_CSV = 'Date,Description,Amount\n2026-11-26,TRANSFER FROM 1234567890,5000.00\n';
const CHEQUE_FILE = `${B}/Transactions/Cheque/2026-11.md`;
const SAVINGS_FILE = `${B}/Transactions/Savings/2026-11.md`;

async function mount(files) {
  const m = await mountFor(files, { period: '2026-11', budgetFolder: B });
  const { ctx } = m;
  ctx.render = () => {}; ctx.switchView = () => {}; ctx.renderTransactions = () => {};
  m.open = async (csv, name, label) => {
    await ctx.handleStatementFile({ name, async arrayBuffer() { return new TextEncoder().encode(csv).buffer; } });
    const p = ctx.S.pendingImport;
    p.label = label;
    ctx.renderImportReview();
    return p;
  };
  m.lastToast = () => (ctx._toasts[ctx._toasts.length - 1] || {}).msg || '';
  m.review = () => ctx.$('#impTable').textContent + ' ' + ctx.$('#impStats').textContent;
  return m;
}
/* The row of `file` whose description starts with `desc`, as the REAL loader
   reads the bytes the app left on disk. */
async function reloaded(ctx) {
  const c = makeCtx(Object.fromEntries(ctx.vault._store), { budgetFolder: B });
  await loadInto(c);
  return c.S;
}
const rowIn = (S, key, desc) => ((S.txFiles[key] || {}).rows || []).find(r => r.desc.startsWith(desc));

(async () => {
  const unpin = pinClock('2026-12-05');
  try {
    /* ---- 0. the pure question ----------------------------------------------- */
    {
      eq(transferLegStanding({ amount: -5000, excluded: false }, []), 'counted', 'an ordinary counted row is counted');
      eq(transferLegStanding({ amount: -5000, excluded: true }, []), 'excluded', 'an excluded one is not');
      const parent = { date: '2026-11-26', desc: 'X', amount: -5000, excluded: true, split: 'parent' };
      const parts = [{ date: '2026-11-26', desc: 'X', amount: -3000, excluded: false, split: 'part' },
        { date: '2026-11-26', desc: 'X', amount: -2000, excluded: false, split: 'part' }];
      eq(transferLegStanding(parent, [parent, ...parts]), 'split', 'a split parent whose parts are counted is "split" — named, never changed');
      eq(transferLegStanding(parent, [parent, ...parts.map(x => ({ ...x, excluded: true }))]), 'excluded', 'a split whose parts are all excluded is out already');
      eq(transferLegStanding(parts[0], [parent, ...parts]), 'split', 'and a part is never an ordinary row either');
    }

    /* ---- 1. Cheque first, then Savings: both legs end excluded -------------- */
    {
      asked.length = 0;
      const { ctx, S, open, review, lastToast } = await mount({ ...BASE });
      let p = await open(CHEQUE_CSV, 'cheque.csv', 'Cheque');
      const out = p.items.find(i => i.desc === 'TRANSFER TO 62000000001');
      eq(out.excluded, false, 'precondition: with nothing in Savings yet, the Cheque leg is counted (correct at that moment)');
      out.cat = 'Saving'; out.manual = true;   // the reader files it by hand
      await ctx.commitImport();
      eq(rowIn(await reloaded(ctx), 'Cheque/2026-11', 'TRANSFER TO').excluded, false, 'and it is written counted');

      p = await open(SAVINGS_CSV, 'savings.csv', 'Savings');
      eq(p.items[0].excluded, true, 'the Savings leg finds its other half and arrives excluded, as before');
      const said = review();
      ok(/other half of this transfer is still counted in Cheque/.test(said),
        `the review names the vault leg that is still counted (IMP-5: it said nothing): ${said}`);
      ok(said.includes('TRANSFER TO 62000000001') && said.includes('2026-11-26'), 'with its description and date');
      ok(/−R ?5 ?000[.,]00/.test(said.replace(/[\u00a0\u202f]/g, ' ')), `and its amount, as the flow it was (money out of Cheque): ${said}`);
      const box = ctx.$('#impTable').querySelector('[data-focus-key="leg:0"]');
      ok(box && box.attrs.checked !== undefined, 'the choice to mark it excluded is offered, ticked by default');
      await ctx.commitImport();

      const disk = await reloaded(ctx);
      const chequeLeg = rowIn(disk, 'Cheque/2026-11', 'TRANSFER TO');
      eq(chequeLeg.excluded, true, 'after the commit the Cheque leg is excluded on disk');
      eq(chequeLeg.cat, 'Saving', 'and keeps the category the reader gave it');
      eq(chequeLeg.note || '', '', 'with nothing else about the row changed');
      eq(rowIn(disk, 'Savings/2026-11', 'TRANSFER FROM').excluded, true, 'the Savings leg is excluded too: both halves out of the budget');
      eq(rowIn(disk, 'Cheque/2026-11', 'SALARY').excluded, false, 'the rest of the Cheque month is untouched');
      eq(rowIn(S, 'Cheque/2026-11', 'TRANSFER TO').excluded, true, 'memory agrees with the disk');
      eq((S.lastImport.legs || []).reduce((n, l) => n + l.rows.length, 0), 1, 'the receipt holds the one vault leg it changed');
      ok(/Cheque/.test(lastToast()) && /excluded/.test(lastToast()), `the toast says what it marked: ${lastToast()}`);

      /* ---- 3. Undo counts it again ---- */
      asked.length = 0;
      await ctx.undoImport();
      ok(asked.length === 1 && /Cheque/.test(asked[0].message), `the Undo dialog says the Cheque leg will be counted again: ${(asked[0] || {}).message}`);
      const after = await reloaded(ctx);
      eq(rowIn(after, 'Savings/2026-11', 'TRANSFER FROM'), undefined, 'Undo takes the Savings row back out');
      eq(rowIn(after, 'Cheque/2026-11', 'TRANSFER TO').excluded, false, 'and the Cheque leg is counted again, as the import found it');
      eq(rowIn(after, 'Cheque/2026-11', 'TRANSFER TO').cat, 'Saving', 'category still the reader\'s');
      eq(rowIn(S, 'Cheque/2026-11', 'TRANSFER TO').excluded, false, 'in memory too');
    }

    /* ---- 2. Savings first, then Cheque: the same end --------------------------- */
    {
      const { ctx, open } = await mount({ ...BASE });
      let p = await open(SAVINGS_CSV, 'savings.csv', 'Savings');
      eq(p.items[0].excluded, false, 'precondition: Savings first, nothing in Cheque, counted');
      await ctx.commitImport();
      p = await open(CHEQUE_CSV, 'cheque.csv', 'Cheque');
      eq(p.items.find(i => i.desc.startsWith('TRANSFER TO')).excluded, true, 'the Cheque leg arrives excluded');
      await ctx.commitImport();
      const disk = await reloaded(ctx);
      eq([rowIn(disk, 'Cheque/2026-11', 'TRANSFER TO').excluded, rowIn(disk, 'Savings/2026-11', 'TRANSFER FROM').excluded], [true, true],
        'whichever is imported first, both legs end excluded');
    }

    /* ---- 4. unticked: the vault leg is left counted, and the review says so --- */
    {
      const { ctx, open, review, lastToast } = await mount({ ...BASE });
      await open(CHEQUE_CSV, 'cheque.csv', 'Cheque');
      await ctx.commitImport();
      const before = ctx.vault._store.get(CHEQUE_FILE);
      await open(SAVINGS_CSV, 'savings.csv', 'Savings');
      const box = ctx.$('#impTable').querySelector('[data-focus-key="leg:0"]');
      box.checked = false; box._fire('change');
      ok(/still counted in Cheque/.test(review()), 'unticked, the sentence stays as the warning');
      await ctx.commitImport();
      eq(ctx.vault._store.get(CHEQUE_FILE), before, 'the Cheque month file is not rewritten at all');
      eq(rowIn(await reloaded(ctx), 'Cheque/2026-11', 'TRANSFER TO').excluded, false, 'its leg stays counted');
      ok(/still counted/.test(lastToast()), `and the commit says so too: ${lastToast()}`);
      eq((ctx.S.lastImport.legs || []).length, 0, 'the receipt holds no leg');
    }

    /* ---- 5. the Exclude untick on the incoming row withdraws the offer -------- */
    {
      const { ctx, open, review } = await mount({ ...BASE });
      await open(CHEQUE_CSV, 'cheque.csv', 'Cheque');
      await ctx.commitImport();
      const before = ctx.vault._store.get(CHEQUE_FILE);
      const p = await open(SAVINGS_CSV, 'savings.csv', 'Savings');
      // The reader says this is not a transfer: they count it.
      const exc = ctx.$('#impTable').querySelector('[data-focus-key="exc:0"]');
      exc.checked = false; exc._fire('change');
      eq(p.items[0].excluded, false, 'precondition: the incoming row is counted');
      ok(!/still counted in Cheque/.test(review()), 'a row the reader counts makes no offer about its other half');
      await ctx.commitImport();
      eq(ctx.vault._store.get(CHEQUE_FILE), before, 'and the Cheque file is left alone');
    }

    /* ---- 6. a split vault leg is named and never modified -------------------- */
    {
      const files = { ...BASE, [CHEQUE_FILE]: '---\naccount: "Cheque"\nmonth: 2026-11\n---\n\n' + SPLIT_HEAD
        + '| 2026-11-26 | TRANSFER TO 62000000001 | Saving | -5000.00 | yes |  | parent |\n'
        + '| 2026-11-26 | TRANSFER TO 62000000001 | Saving | -3000.00 |  |  | part |\n'
        + '| 2026-11-26 | TRANSFER TO 62000000001 | Food | -2000.00 |  |  | part |\n' };
      const { ctx, open, review } = await mount(files);
      const before = ctx.vault._store.get(CHEQUE_FILE);
      const p = await open(SAVINGS_CSV, 'savings.csv', 'Savings');
      eq(p.items[0].excluded, true, 'the split parent is the bank\'s line and proves the transfer, as before');
      ok(/split/.test(review()) && /Cheque/.test(review()), `the review names the split leg in Cheque: ${review()}`);
      eq(ctx.$('#impTable').querySelector('[data-focus-key="leg:0"]'), null, 'with no offer to change it');
      await ctx.commitImport();
      eq(ctx.vault._store.get(CHEQUE_FILE), before, 'the split rows are never modified');
      eq((ctx.S.lastImport.legs || []).length, 0, 'and the receipt holds nothing of them');
    }

    /* ---- 7. a month with unsaved edits is not written behind the reader ------ */
    {
      const { ctx, S, open, lastToast } = await mount({ ...BASE });
      await open(CHEQUE_CSV, 'cheque.csv', 'Cheque');
      await ctx.commitImport();
      await open(SAVINGS_CSV, 'savings.csv', 'Savings');
      S.txFiles['Cheque/2026-11'].dirty = true;
      const before = [...ctx.vault._store];
      await ctx.commitImport();
      ok(/Cheque\/2026-11/.test(lastToast()) && /Nothing was imported/.test(lastToast()),
        `the import is refused while the leg's month has unsaved edits: ${lastToast()}`);
      eq([...ctx.vault._store], before, 'and nothing is written');
    }

    console.log(`PASS import-transfer-both-legs — a transfer is out of the budget on both legs, whichever is imported first (${checks} checks)`);
  } finally { unpin(); }
})().catch(e => { console.error(e); process.exit(1); });
