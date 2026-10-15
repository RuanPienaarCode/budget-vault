'use strict';
/* The budget export's transaction listing flags every row the budget figures
   above it do NOT count, and names the reason.

   The note under the listing says "Excluded, transfer and split-parent rows
   are listed and flagged; they are not part of the budget figures above" —
   and the flag column only ever knew two things: the row's own Excluded cell
   and its split role. A transfer, a row in an account marked `budget: false`,
   a row in another currency, an outflow from an earmarked fund and a row dated
   later than today (the running period's figures close at today) were all
   listed with a BLANK flag and are all out of the figures. On the vault this
   was found on, unflagged rows in a category did not add up to that category's
   Actual, and the note's own promise was the thing a reader checked it by
   (2026-10-14 audit, L4A-02).

   The flag now comes from the ledger's BUDGET veto itself — stamp() over the
   rows with the household's own env, as exporter.js's markdown totals do — so
   the listing can never again keep a row the figures drop, or the reverse.

   Expected flags are written BY HAND from the fixture (the committed synthetic
   household plus four rows added for this test), not read from the lens:

     Salary / Landlord / Checkers / To unit trust    counted           (no flag)
     To emergency fund (Transfer, -1 000)            transfer
     From cheque       (Transfer, +1 000)            transfer
     Takealot parent                                  split parent
     Takealot parts                                   split part        (counted)
     Pram (Emergency fund, earmarked, -1 500)         paid from a fund
     Joint account row    (budget: false)             non-budget account
     Dollar savings row   ($ account)                 other currency
     Gift (Excluded cell set)                         excluded
     Debit order dated 20 Sep (today is the 2nd)      scheduled

   and the claim the note makes is held to its word: for every category in the
   period table, the rows with no flag (or only "split part") add up to that
   category's Actual.

     node tests/budget-export-transaction-flags.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const bx = require('../src/budget-export');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const files = {
  ...SEED,
  [`${B}/Transactions/Cheque/2026-09.md`]: SEED[`${B}/Transactions/Cheque/2026-09.md`]
    + '| 2026-09-02 | Gift | Groceries | -300.00 | yes |  |  |\n'
    + '| 2026-09-20 | Debit order | Groceries | -777.00 |  |  |  |\n',
  [`${B}/Accounts/Joint.md`]: '---\ntype: checking\ntx_label: "Joint"\nbudget: false\nbalance: 500.00\nbalance_updated: 2026-09-01\n---\n',
  [`${B}/Transactions/Joint/2026-09.md`]: HEAD + '| 2026-09-02 | Joint shop | Groceries | -123.00 |  |  |  |\n',
  [`${B}/Transactions/Dollar savings/2026-09.md`]: HEAD + '| 2026-09-02 | Dollar shop | Groceries | -45.00 |  |  |  |\n',
};
const WANT = {
  Salary: '', Landlord: '', Checkers: '', 'To unit trust': '',
  'To emergency fund': 'transfer', 'From cheque': 'transfer',
  Pram: 'paid from a fund',
  'Joint shop': 'non-budget account', 'Dollar shop': 'other currency',
  Gift: 'excluded', 'Debit order': 'scheduled',
};
const ANSWER = { mode: 'months', range: '1', includeCurrent: true, content: 'full', categories: null, includeTx: true, formats: ['xlsx', 'pdf'], folder: 'Exports' };
const val = c => (c && typeof c === 'object' ? c.v : c);

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(files, { period: PERIOD, budgetFolder: B });
    require('../src/views/budget-export')(M.ctx);
    const { ctx } = M;
    const { model } = await ctx.runBudgetExport(ANSWER);

    /* ---- the workbook's Flag column, by description -------------------------- */
    const sheets = bx.modelToSheets(model, { symbolFor: () => 'R' });
    const sheet = sheets.find(s => s.name === 'Transactions');
    const head = sheet.rows[0].map(val);
    const col = head.indexOf('Flag');
    ok(col >= 0, 'fixture: the Transactions sheet has a Flag column');
    const flagOf = new Map();
    for (const r of sheet.rows.slice(1)) {
      const d = val(r[1]);
      if (d === 'Takealot') continue;
      flagOf.set(d, val(r[col]));
    }
    for (const [desc, want] of Object.entries(WANT)) {
      eq(flagOf.get(desc), want, `${desc}: flagged "${want}"`);
    }
    const takealot = sheet.rows.slice(1).filter(r => val(r[1]) === 'Takealot').map(r => val(r[col])).sort();
    eq(takealot, ['split parent', 'split part', 'split part'], 'the split: one parent, two counted parts');

    /* ---- the PDF table carries the same flag text ---------------------------- */
    const doc = bx.modelToDoc(model, { money: v => `R ${Number(v).toFixed(2)}` });
    const tx = doc.blocks.filter(b => b.type === 'table').pop();
    const pdfFlag = new Map(tx.rows.map(r => [r[1], r[5]]));
    eq(pdfFlag.get('Pram'), 'paid from a fund', 'the PDF names the reason too');
    eq(pdfFlag.get('Joint shop'), 'non-budget account', 'including an account kept out of the budget');

    /* ---- the note's promise, held to its word -------------------------------- */
    const rows = model.budgets[0].rows;
    const counted = new Map();
    for (const r of sheet.rows.slice(1)) {
      const flag = val(r[col]);
      if (flag && flag !== 'split part') continue;
      const cat = val(r[3]);
      counted.set(cat, (counted.get(cat) || 0) + val(r[5]));
    }
    for (const r of rows.filter(x => x.type !== 'income' && !x.assumed && x.actual > 0)) {
      eq(Math.round(-counted.get(r.cat) * 100) / 100, r.actual, `${r.cat}: the unflagged rows add up to the category's Actual (${r.actual})`);
    }

    /* ---- the note says what it now does --------------------------------------- */
    ok(!/Excluded, transfer and split-parent rows/.test(bx.LABELS.noteTx), 'the note no longer lists three reasons and flags five');
    ok(/reason/.test(bx.LABELS.noteTx), 'it says each flagged row carries its reason');
  } finally { unpin(); }

  /* ---- hand-built rows with no env fall back to the two flags they always had ---- */
  {
    const P = [{
      key: 'p', name: 'P', title: 't', start: '2026-05-01', end: '2026-05-31', rows: [],
      summary: { income: 0, spend: 0, foreign: { count: 0, labels: [], symbols: [] } },
      txs: [{ date: '2026-05-02', desc: 'x', label: 'Cheque', cat: 'Fuel', amount: -5, excluded: true, note: '', split: '' }],
    }];
    const m = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: true, generated: 'g', currency: 'R' });
    const sheet = bx.modelToSheets(m, {}).find(s => s.name === 'Transactions');
    eq(val(sheet.rows[1][6]), 'excluded', 'with no household env to stamp against, the row\'s own Excluded cell still flags it');
  }

  console.log(`PASS budget-export-transaction-flags (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
