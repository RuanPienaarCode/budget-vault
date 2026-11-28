'use strict';
/* Saving a row on Transactions with both a category and a subcategory teaches
   the pair, and the next import of the same description applies both with
   nothing picked by hand (ADR-0010 section 5, issue #185).

   The REAL Transactions view, its category and subcategory controls, the real
   Save, the real rules writer and — for the last block — the real import view
   over the same book, read through the DOM stub. A pick is made the way a
   reader makes it: press the cell's button, choose in the <select> it becomes.
   Only the dialogs are scripted. Synthetic merchants only.

   Pinned:
     1. a row picked to a category and a subcategory teaches both on Save, and
        so does a row that arrived with a category and is given a subcategory;
     2. a later save of the same description with a different subcategory
        updates the rule instead of adding one, and says so;
     3. a category alone teaches the category alone, in a file that has the
        column, as an empty cell;
     4. a pick the rows no longer stand behind teaches nothing, the subcategory
        half included (the 2026-11-16 rule, tx-learn-only-what-still-stands);
     5. nothing is written to the rules file when nothing was taught;
     6. the next import of the same description applies both, in memory and
        after a reload from the bytes written.
     node tests/transactions-learn-subcategory.test.cjs */

const assert = require('assert');
const Module = require('module');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const fakeModal = {
  askFields: async () => null, confirmModal: async () => false, askSubcategories: async () => undefined,
  askSplit: async () => null, askRulesCleanup: async () => null, askBudgetReslice: async () => null,
};
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === '../modal' || req === './modal') return fakeModal;
  return origLoad.call(this, req, ...rest);
};
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { find, hasClass, textOf } = require('./helpers/dash-audit.cjs');

const B = 'Budget';
const RULES = `${B}/Data/Categorisation Rules.csv`;
const PERIOD = '2026-09';
const HEAD = '---\naccount: "Cheque"\nmonth: 2026-09\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Subcategory |\n|---|---|---|---:|---|---|---|\n';
const TX = HEAD
  + '| 2026-09-01 | Engen Rondebosch | | -500.00 |  |  |  |\n'          // arrives uncategorised
  + '| 2026-09-02 | Shell Kloof | Car | -300.00 |  |  |  |\n'           // arrives categorised, no rule
  + '| 2026-09-03 | Total Road | Car | -200.00 |  |  | Fuel |\n'        // arrives with a rule's pair
  + '| 2026-09-04 | Alpha Bakery | | -40.00 |  |  |  |\n'              // category alone
  + '| 2026-09-05 | Mountain Road | | -80.00 |  |  |  |\n'            // picked, then thought better of
  + '| 2026-09-06 | River Deli | | -90.00 |  |  |  |\n';               // picked, then changed under the pick
const RULES_3 = 'pattern,category,subcategory\nTotal Road,Car,Fuel\n';
const files = (rules = RULES_3) => ({
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000.00\nbalance_updated: 2026-08-31\n---\n',
  [`${B}/Categories/Car.md`]: '---\ntype: expense\ncolor: "#123456"\nsubcategories: "Fuel, Services"\n---\n\n# Car\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Home.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Budgets/${PERIOD}.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Car | expense | 2000.00 |  |\n| Groceries | expense | 3000.00 |  |\n| Home | expense | 1000.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: TX,
  ...(rules === null ? {} : { [RULES]: rules }),
});

function realSelect(sel) {
  Object.defineProperty(sel, 'options', {
    configurable: true,
    get() { return sel.children.filter(c => c.tagName === 'OPTION').map(o => ({ value: o.attrs.value, textContent: o.textContent })); },
  });
  return sel;
}
async function open(f) {
  const M = await mountFor(f, { period: PERIOD, budgetFolder: B });
  M.ctx.$('#txWholeHistory').checked = false;
  realSelect(M.ctx.$('#txCategory'));
  realSelect(M.ctx.$('#txSubcategory'));
  M.ctx.renderTransactions();
  return M;
}
const tbody = M => find(M.ctx.$('#txTable'), n => n.tagName === 'TBODY')[0];
const trs = M => tbody(M).children.filter(n => n.tagName === 'TR');
const rowFor = (M, desc) => trs(M).find(tr => textOf(tr.children[1]) === desc);
const catTd = tr => tr.children[3];
const subCell = tr => find(catTd(tr), n => hasClass(n, 'sub-cell'))[0] || null;
const fileRow = (M, desc) => M.S.txFiles['Cheque/2026-09'].rows.find(r => r.desc === desc);
/* The reader picking a category in the cell. */
function pickCategory(M, desc, cat) {
  const tr = rowFor(M, desc);
  const open = find(catTd(tr), n => hasClass(n, 'cat-cell-btn') && !hasClass(n, 'sub-cell-btn'))[0];
  if (open) open.click();
  const sel = find(catTd(tr), n => n.tagName === 'SELECT' && hasClass(n, 'category-select') && !hasClass(n, 'sub-select'))[0];
  sel.value = cat;
  sel._fire('change');
}
/* ... and a subcategory, in the dropdown that cell grows. */
function pickSub(M, desc, name) {
  const cell = subCell(rowFor(M, desc));
  const btn = find(cell, n => n.tagName === 'BUTTON')[0];
  if (btn) btn.click();
  const sel = find(subCell(rowFor(M, desc)), n => n.tagName === 'SELECT')[0];
  sel.value = name;
  sel._fire('change');
}
const onDisk = M => M.ctx.vault._store.get(RULES);
const toastOf = M => (M.ctx._toasts[M.ctx._toasts.length - 1] || {}).msg || '';
const rulesWrites = M => {
  const n = { count: 0 };
  for (const fn of ['create', 'modify']) {
    const real = M.ctx.vault[fn].bind(M.ctx.vault);
    M.ctx.vault[fn] = async (a, ...r) => { if ((typeof a === 'string' ? a : a.path) === RULES) n.count++; return real(a, ...r); };
  }
  return n;
};

(async () => {
  const unpin = pinClock('2026-09-15');
  try {
    /* ---- 1-3. what Save teaches ---------------------------------------------- */
    {
      const M = await open(files());
      pickCategory(M, 'Engen Rondebosch', 'Car');
      pickSub(M, 'Engen Rondebosch', 'Fuel');                 // arrived uncategorised: category, then subcategory
      pickSub(M, 'Shell Kloof', 'Services');                  // arrived categorised: a subcategory alone
      pickSub(M, 'Total Road', 'Services');                   // a rule already answers this description with Fuel
      pickCategory(M, 'Alpha Bakery', 'Groceries');           // a category with no subcategory to give
      await M.ctx.saveTransactions();
      eq(onDisk(M).split('\n').slice(0, -1), [
        'pattern,category,subcategory',
        'Total Road,Car,Services',
        'Engen Rondebosch,Car,Fuel',
        'Alpha Bakery,Groceries,',
        'Shell Kloof,Car,Services',
      ], 'the rule that answered Total Road is updated in place; the others are added after it (category picks first, then subcategory-only picks), a category alone with an empty cell');
      ok(/learned 3 new rules/.test(toastOf(M)), `the toast counts the three rules added: ${toastOf(M)}`);
      ok(/updated 1 rule\b/.test(toastOf(M)), `and says the one it updated: ${toastOf(M)}`);
      eq([fileRow(M, 'Engen Rondebosch').cat, fileRow(M, 'Engen Rondebosch').subcategory], ['Car', 'Fuel'], 'the rows themselves are saved as picked');
    }

    /* ---- 2. an update alone ----------------------------------------------------- */
    {
      const M = await open(files());
      const w = rulesWrites(M);
      pickSub(M, 'Total Road', 'Services');
      await M.ctx.saveTransactions();
      eq(onDisk(M), 'pattern,category,subcategory\nTotal Road,Car,Services\n', 'a later save with a different subcategory updates the rule; none is added');
      eq(w.count, 1, 'in one write');
      ok(/updated 1 rule\b/.test(toastOf(M)) && !/learned/.test(toastOf(M)), `and the toast says updated, not learned: ${toastOf(M)}`);
    }

    /* ---- 5. nothing taught, nothing written ------------------------------------------ */
    {
      const M = await open(files());
      const w = rulesWrites(M);
      pickSub(M, 'Total Road', 'Fuel');                       // the subcategory it already has
      M.S.txFiles['Cheque/2026-09'].dirty = true;
      await M.ctx.saveTransactions();
      eq(w.count, 0, 'saying what the rule already says writes no rules file');
      eq(onDisk(M), RULES_3, 'and leaves it as it was');
      ok(!/learned|updated/.test(toastOf(M)), `and the toast does not claim a rule: ${toastOf(M)}`);
    }

    /* ---- 4. a pick the rows no longer stand behind teaches nothing --------------------- */
    {
      const M = await open(files());
      pickCategory(M, 'Mountain Road', 'Car');
      pickSub(M, 'Mountain Road', 'Fuel');
      pickSub(M, 'Mountain Road', '');                         // thought better of it: back to none
      pickCategory(M, 'River Deli', 'Car');
      pickSub(M, 'River Deli', 'Services');
      const live = fileRow(M, 'River Deli');                   // a bulk re-categorise, say: the row says something else now
      live.cat = 'Home'; delete live.subcategory;
      pickSub(M, 'Shell Kloof', 'Fuel');
      delete fileRow(M, 'Shell Kloof').subcategory;            // and a row whose label was cleared some other way
      await M.ctx.saveTransactions();
      eq(onDisk(M), 'pattern,category,subcategory\nTotal Road,Car,Fuel\nMountain Road,Car,\n',
        'Mountain Road teaches its category alone (the subcategory was taken back); River Deli and Shell Kloof, which no row stands behind, teach nothing');
    }

    /* ---- 4b. a category changed after the subcategory was picked ---------------------- */
    {
      const M = await open(files());
      pickCategory(M, 'River Deli', 'Car');
      pickSub(M, 'River Deli', 'Fuel');
      pickCategory(M, 'River Deli', 'Home');                   // the label belonged to Car: gone with it
      await M.ctx.saveTransactions();
      eq(onDisk(M), 'pattern,category,subcategory\nTotal Road,Car,Fuel\nRiver Deli,Home,\n', 'Home is learned alone: Fuel is not taught under it');
    }

    /* ---- a book with a two-column rules file that never uses a subcategory ---------------- */
    {
      const M = await open(files('pattern,category\nTotal Road,Car\n'));
      pickCategory(M, 'Alpha Bakery', 'Groceries');
      await M.ctx.saveTransactions();
      eq(onDisk(M), 'pattern,category\nTotal Road,Car\nAlpha Bakery,Groceries\n', 'a category alone is learned into a two-column file as it always was');
    }

    /* ---- 6. the next import applies both, nothing picked by hand --------------------------- */
    {
      const M = await open(files());
      pickCategory(M, 'Engen Rondebosch', 'Car');
      pickSub(M, 'Engen Rondebosch', 'Fuel');
      await M.ctx.saveTransactions();
      eq(onDisk(M), 'pattern,category,subcategory\nTotal Road,Car,Fuel\nEngen Rondebosch,Car,Fuel\n', 'precondition: the pair is a rule');

      const STATEMENT = ['Date,Description,Amount', '2026-10-06,ENGEN RONDEBOSCH 0099,-512.00', '2026-10-07,TOTAL ROAD 7731,-210.00'].join('\n');
      const importWith = async (m, stmt) => {
        m.ctx.render = () => {}; m.ctx.switchView = () => {};
        await m.ctx.handleStatementFile({ name: 'stmt.csv', async arrayBuffer() { return new TextEncoder().encode(stmt).buffer; } });
        const p = m.ctx.S.pendingImport;
        p.label = 'Cheque';
        return p;
      };
      // In memory, straight after the save.
      let p = await importWith(M, STATEMENT);
      eq(p.items.map(i => [i.cat, i.subcategory, !!i.manual]), [['Car', 'Fuel', false], ['Car', 'Fuel', false]],
        'the next import files the same merchant under both, with nothing picked by hand');

      // And from the bytes the app wrote.
      const back = await open(Object.fromEntries(M.ctx.vault._store));
      p = await importWith(back, STATEMENT);
      eq(p.items.map(i => [i.cat, i.subcategory, !!i.manual]), [['Car', 'Fuel', false], ['Car', 'Fuel', false]], 'and so does a reload');
      back.ctx.$('#impRemember').checked = false;
      await back.ctx.commitImport();
      const imported = Object.values(back.S.txFiles).flatMap(f => f.rows).filter(r => r.date >= '2026-10-01');
      eq(imported.map(r => [r.desc, r.cat, r.subcategory]), [['ENGEN RONDEBOSCH 0099', 'Car', 'Fuel'], ['TOTAL ROAD 7731', 'Car', 'Fuel']],
        'the rows written carry both');
    }

    console.log(`PASS — transactions-learn-subcategory: Save teaches the pair, a later save updates it, the next import applies both (${checks} assertions).`);
  } finally { unpin(); }
})().catch(err => { console.error(err); process.exit(1); });
