'use strict';
/* The budget export does not call a counted row a "split parent"
   (wave 2 of the 2026-11-11 audit; follows tests/budget-export-transaction-flags).

   A split is reversible by hand, and tx-role.js says how: untick Excluded and
   delete the parts. What is left is a row with `parent` still in its Split
   cell and nothing in its Excluded cell — and since wave 1 that row is, to
   the ledger and to every reader of raw rows, an ordinary counted
   transaction: supersededBySplit requires the parent role AND the Excluded
   tick, precisely so that unticking means "this row is real again"
   everywhere at once.

   The export's listing did not ask it. flagKeys read the Split cell alone
   (`role === 'parent'`), so the reversed row was printed with the flag
   "split parent" under a note that says flagged rows "are not part of the
   budget figures above" — while the figure above it counted the row. The
   check the note invites, adding up a category's unflagged rows, came out
   short by exactly that row.

   Expected flags are written by hand from the fixture:

     Reversed shop   (Split: parent, Excluded empty)             counted     (no flag)
     Takealot        (Split: parent, Excluded ticked, 2 parts)    split parent
     Reversed later  (the same shape, dated after today)          scheduled
     Reversed joint  (the same shape, in a budget:false account)  non-budget account

   — the last two because a reversed parent is an ORDINARY row, so whatever
   else keeps an ordinary row out of the figures still does, and is what the
   listing names.

     node tests/budget-export-reversed-split-parent.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const bx = require('../src/budget-export');
const { supersededBySplit } = require('../src/tx-role');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const CHEQUE = `${B}/Transactions/Cheque/2026-09.md`;
const files = {
  ...SEED,
  [CHEQUE]: SEED[CHEQUE]
    + '| 2026-09-02 | Reversed shop | Groceries | -250.00 |  |  | parent |\n'
    + '| 2026-09-20 | Reversed later | Groceries | -70.00 |  |  | parent |\n',
  [`${B}/Accounts/Joint.md`]: '---\ntype: checking\ntx_label: "Joint"\nbudget: false\nbalance: 500.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Transactions/Joint/2026-09.md`]: HEAD + '| 2026-09-02 | Reversed joint | Groceries | -33.00 |  |  | parent |\n',
};
const ANSWER = { mode: 'months', range: '1', includeCurrent: true, content: 'full', categories: null, includeTx: true, formats: ['xlsx', 'pdf'], folder: 'Exports' };
const val = c => (c && typeof c === 'object' ? c.v : c);

(async () => {
  const unpin = pinClock(TODAY);
  try {
    /* The same household without the reversed row: what Groceries came to
       before it, so the row's own R250 is what the figure must move by. */
    const base = await mountFor({ ...SEED }, { period: PERIOD, budgetFolder: B });
    require('../src/views/budget-export')(base.ctx);
    const before = (await base.ctx.runBudgetExport(ANSWER)).model.budgets[0].rows.find(r => r.cat === 'Groceries').actual;

    const M = await mountFor(files, { period: PERIOD, budgetFolder: B });
    require('../src/views/budget-export')(M.ctx);
    const { model } = await M.ctx.runBudgetExport(ANSWER);
    const groceries = model.budgets[0].rows.find(r => r.cat === 'Groceries');
    eq(groceries.actual, Math.round((before + 250) * 100) / 100,
      'fixture: the ledger counts the reversed parent — Groceries moved by its R250, and by neither of the other two');

    /* ---- the workbook ---- */
    const sheet = bx.modelToSheets(model, { symbolFor: () => 'R' }).find(s => s.name === 'Transactions');
    const head = sheet.rows[0].map(val);
    const col = head.indexOf('Flag');
    const flagsOf = desc => sheet.rows.slice(1).filter(r => val(r[1]) === desc).map(r => val(r[col])).sort();
    eq(flagsOf('Reversed shop'), [''], 'a parent whose Excluded tick was removed is a counted row: no flag');
    eq(flagsOf('Takealot'), ['split parent', 'split part', 'split part'], 'a parent still superseded by its parts is still named for what it is');
    eq(flagsOf('Reversed later'), ['scheduled'], 'a reversed parent dated after today is flagged for the reason it is out — its date');
    eq(flagsOf('Reversed joint'), ['non-budget account'], 'and one in an account outside the budget, for that');

    /* ---- the PDF and the CSV carry the same answer ---- */
    const doc = bx.modelToDoc(model, { money: v => `R ${Number(v).toFixed(2)}` });
    const pdf = doc.blocks.filter(b => b.type === 'table').pop();
    const pdfFlag = new Map(pdf.rows.filter(r => /^Reversed/.test(r[1])).map(r => [r[1], r[5]]));
    eq([...pdfFlag.entries()].sort(), [['Reversed joint', 'non-budget account'], ['Reversed later', 'scheduled'], ['Reversed shop', '']],
      'the PDF listing flags the three the same way');
    const why = new Map(model.transactions.filter(t => /^Reversed/.test(t.desc)).map(t => [t.desc, t.why]));
    eq(why.get('Reversed shop'), [], 'the model itself holds no reason for the reversed row, so every rendering agrees');

    /* ---- the note's promise, held to its word ---- */
    const counted = new Map();
    for (const r of sheet.rows.slice(1)) {
      const flag = val(r[col]);
      if (flag && flag !== 'split part') continue;
      counted.set(val(r[3]), (counted.get(val(r[3])) || 0) + val(r[5]));
    }
    eq(Math.round(-counted.get('Groceries') * 100) / 100, groceries.actual,
      `the unflagged Groceries rows add up to the category's Actual (${groceries.actual}) — the check the note invites`);
  } finally { unpin(); }

  /* ---- hand-built rows, no env: the row's own two cells decide ---- */
  {
    const tx = (desc, excluded, split) => ({ date: '2026-05-02', desc, label: 'Cheque', cat: 'Fuel', amount: -5, excluded, note: '', split });
    const rows = [tx('reversed', false, 'parent'), tx('superseded', true, 'parent'), tx('part', false, 'part'), tx('vetoed', true, ''), tx('typed', false, 'Parent ')];
    const P = [{ key: 'p', name: 'P', title: 't', start: '2026-05-01', end: '2026-05-31', rows: [],
      summary: { income: 0, spend: 0, foreign: { count: 0, labels: [], symbols: [] } }, txs: rows }];
    const m = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: true, generated: 'g', currency: 'R' });
    const sheet = bx.modelToSheets(m, {}).find(s => s.name === 'Transactions');
    const flag = new Map(sheet.rows.slice(1).map(r => [val(r[1]), val(r[6])]));
    eq(flag.get('reversed'), '', 'no env: a parent without the tick is unflagged');
    eq(flag.get('superseded'), 'split parent', 'no env: a parent with it is a split parent');
    eq(flag.get('part'), 'split part', 'no env: a part is a part');
    eq(flag.get('vetoed'), 'excluded', 'no env: an Excluded row is excluded');
    eq(flag.get('typed'), '', 'no env: the Split cell is read the way tx-role reads it, case and spaces included');
    /* The export and tx-role give one answer about every one of them. */
    for (const r of rows) eq(flag.get(r.desc) === 'split parent', supersededBySplit(r), `${r.desc}: "split parent" exactly when tx-role says the row is superseded`);
  }

  /* ---- and it asks, rather than re-deriving ---- */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'budget-export.js'), 'utf8');
    const body = src.slice(src.indexOf('function flagKeys('), src.indexOf('\n}\n', src.indexOf('function flagKeys(')));
    ok(/supersededBySplit\(t\)/.test(body), 'flagKeys asks tx-role whether the row is superseded');
    ok(!/role === 'parent'/.test(body), 'and does not read the parent role off the Split cell alone');
  }

  console.log(`PASS budget-export-reversed-split-parent (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
