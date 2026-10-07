'use strict';
/* The CSVs from one export click carry the caveats the PDF and the workbook
   from the SAME click print — in places a pivot table cannot trip over.

   2026-10-07 audit, L4A-05. The PDF and the workbook say three things beside
   the figures: the running period is a PART period (and pulls the Average
   down), accounts in another currency are held out of every figure, and a
   category pick means the totals cover only those categories. The CSVs said
   none of it — and a CSV is the copy most likely to be read by something
   that never saw the other two.

   Where each caveat goes, and why none of them can break a pivot:

     in progress   on the running period's OWN LABEL: its column header in the
                   Summary CSV ("October 2026 (in progress)"), its Period value
                   in the long-format Budget CSV. No column is added or moved,
                   no number changes, and every row of that period carries the
                   same label — so grouping, pivoting and SUM by Period work
                   exactly as before. The label is the part that IS partial.
     other money   in the FILE NAME of each CSV whose figures held it out —
                   "… - Summary (€ not included).csv". A program never reads a
                   file name as data. The Transactions CSV lists every row with
                   its own Currency column, holds nothing out, and is not
                   renamed.
     a pick        already in every file name ("(Groceries)", or "(4
                   categories 1x2y)"), and the Category column names each row.

   The prose sentences stay in the PDF and the workbook, which are read by a
   person. Header and file-name words are English, like every CSV header and
   file name here (budgetExportPaths explains why a file name must not move
   with the interface language). Read back with python's csv module where the
   machine has it. Synthetic data only.

     node tests/export-csv-caveats.test.cjs */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const bx = require('../src/budget-export');
const { budgetRowStatus } = require('../src/money-flow');
const FILES = require('./helpers/views-vault.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const row = (cat, type, budget, actual) => ({ cat, type, budget, actual, notes: '', assumed: false, ...budgetRowStatus({ budget, actual, type }) });
const P = [
  { key: '2026-08', name: 'August 2026', title: '', start: '2026-08-01', end: '2026-08-31', rows: [row('Salary', 'income', 40000, 40000), row('Food', 'expense', 3000, 2900)],
    summary: { income: 40000, spend: 2900, uncatSpend: 0, foreign: { count: 0, labels: [], symbols: [] } }, txs: [] },
  { key: '2026-09', name: 'September 2026', title: '', start: '2026-09-01', end: '2026-09-30', rows: [row('Salary', 'income', 40000, 40000), row('Food', 'expense', 3000, 3100)],
    summary: { income: 40000, spend: 3100, uncatSpend: 0, foreign: { count: 1, labels: ['Euro Card'], symbols: ['€'] } }, txs: [] },
  { key: '2026-10', name: 'October 2026', title: '', start: '2026-10-01', end: '2026-10-31', rows: [row('Salary', 'income', 40000, 40000), row('Food', 'expense', 3000, 700)],
    summary: { income: 40000, spend: 700, uncatSpend: 0, foreign: { count: 0, labels: [], symbols: [] } }, txs: [] },
];
const META = { generated: '2026-10-07 12:00', currency: 'R' };
const lines = f => f.text.trim().split('\n');

/* ---- in progress: the running period's own label ---- */
{
  const running = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: false, ...META, inProgress: '2026-10' });
  const finished = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: false, ...META, inProgress: null });
  const [sum, bud] = bx.modelToCsv(running, {});
  const [sum0, bud0] = bx.modelToCsv(finished, {});
  eq(lines(sum)[0], 'Category,Type,Currency,August 2026,September 2026,October 2026 (in progress),Total,Average,Budgeted',
    'Summary CSV: the running period\'s column header says it is in progress — and only that one');
  eq(lines(sum0)[0], 'Category,Type,Currency,August 2026,September 2026,October 2026,Total,Average,Budgeted', 'a finished range is labelled as before');
  eq(lines(sum).slice(1), lines(sum0).slice(1), 'every data row is byte-for-byte the same — not one number moved');
  const oct = lines(bud).filter(l => l.startsWith('October 2026'));
  ok(oct.length === 2 && oct.every(l => l.startsWith('October 2026 (in progress),2026-10-01,2026-10-31,')), 'Budget CSV: every row of the running period carries the same marked Period value');
  ok(lines(bud).filter(l => l.startsWith('August 2026,')).length === 2, 'finished periods keep their plain label');
  eq(lines(bud).map(l => l.split(',').length), lines(bud0).map(l => l.split(',').length), 'no column was added or removed anywhere');
  eq(lines(bud).map(l => l.split(',').slice(1)), lines(bud0).map(l => l.split(',').slice(1)), 'and every cell after the Period label is unchanged');

  /* the one thing a pivot does with Period: group by it */
  const groups = new Set(lines(bud).slice(1).map(l => l.split(',')[0]));
  eq([...groups], ['August 2026', 'September 2026', 'October 2026 (in progress)'], 'grouping by Period still yields exactly one group per period');
}

/* ---- held-out money and the pick: in the file names ---- */
{
  const m = bx.buildModel({ periods: P, content: 'full', categories: ['Food'], includeTx: true, ...META, inProgress: '2026-10' });
  eq(m.foreignSymbols, ['€'], 'the model knows € was held out');
  const p = bx.budgetExportPaths(m, 'Exports');
  eq(p.csv.summary, 'Exports/Budget August 2026 to October 2026 (Food) - Summary (€ not included).csv', 'Summary CSV: the pick AND the held-out currency, in its name');
  eq(p.csv.budget, 'Exports/Budget August 2026 to October 2026 (Food) - Budget (€ not included).csv', 'Budget CSV: the same');
  eq(p.csv.transactions, 'Exports/Budget August 2026 to October 2026 (Food) - Transactions.csv', 'Transactions CSV lists every row in its own currency and holds nothing out — not renamed');
  eq([p.pdf, p.xlsx], ['Exports/Budget August 2026 to October 2026 (Food).pdf', 'Exports/Budget August 2026 to October 2026 (Food).xlsx'],
    'the PDF and the workbook say it in sentences, inside; their names do not move');
  const two = bx.buildModel({ periods: [{ ...P[0], summary: { ...P[0].summary, foreign: { count: 2, labels: ['A', 'B'], symbols: ['$', '€'] } } }], content: 'summary', categories: null, includeTx: false, ...META });
  eq(bx.budgetExportPaths(two, '').csv.summary, 'Exports/Budget summary August 2026 - Summary ($, € not included).csv', 'two held-out currencies are both named');
  const sol = bx.buildModel({ periods: [{ ...P[0], summary: { ...P[0].summary, foreign: { count: 1, labels: ['A'], symbols: ['S/.'] } } }], content: 'summary', categories: null, includeTx: false, ...META });
  const solPath = bx.budgetExportPaths(sol, 'Exports').csv.summary;
  eq(solPath.split('/').length, 2, `a symbol with a slash in it ("S/.") cannot add a folder to the name: ${solPath}`);
  ok(solPath.endsWith(' - Summary (S-. not included).csv'), 'it is sanitised the way every other part of a name is');
  const none = bx.buildModel({ periods: [P[0]], content: 'summary', categories: null, includeTx: false, ...META });
  eq(bx.budgetExportPaths(none, '').csv.summary, 'Exports/Budget summary August 2026 - Summary.csv', 'nothing held out: the name is exactly as before');
  const exact = bx.buildModel({ periods: P, content: 'summary', categories: null, includeTx: false, ...META,
    exact: { from: '2026-08-01', to: '2026-10-31', through: '2026-10-07', rows: [row('Food', 'expense', 0, 6700)], txs: [] } });
  eq(bx.budgetExportPaths(exact, '').csv.exact, 'Exports/Budget summary 2026-08-01 to 2026-10-31 - Exact dates (€ not included).csv', 'the exact-dates CSV too');
}

/* ---- one real click: the dialog names exactly these files, and they say what the PDF says ---- */
(async () => {
  const B = 'Budget';
  const ctx = makeCtx({
    ...FILES,
    [`${B}/Accounts/Euro Card.md`]: '---\ntype: checking\ntx_label: "Euro Card"\ncurrency: "€"\nbalance: 500.00\nbalance_updated: 2026-07-01\n---\n',
    [`${B}/Transactions/Euro Card/2026-07.md`]: `---\n${FILES.TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-07-04 | Abroad | Groceries | -90.00 |  |  |  |\n',
    [`${B}/Budgets/2026-06.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4500.00 | |\n| Salary | income | 40000.00 | |\n',
    [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${FILES.TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n| 2026-06-04 | Grocer | Groceries | -2100.50 |  |  |  |\n',
  });
  await loadInto(ctx);
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.currentPeriod = () => '2026-07';
  require('../src/views/budget-export')(ctx);
  const answer = { range: '3', includeCurrent: true, content: 'full', categories: ['Groceries'], includeTx: true, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };
  const d = ctx.describeBudgetExport(answer);
  ok(!d.problem, `exportable: ${d.problem || ''}`);
  const { written, model } = await ctx.runBudgetExport(answer);
  eq(written, d.files, 'the preview names exactly the files the click writes — markers included');
  eq([model.inProgress, model.foreignSymbols, model.filtered], ['2026-07', ['€'], true], 'the model carries all three caveats');
  const base = 'Exports/Budget June 2026 to July 2026 (Groceries)';
  eq(written.filter(p => p.endsWith('.csv')), [`${base} - Summary (€ not included).csv`, `${base} - Budget (€ not included).csv`, `${base} - Transactions.csv`],
    'each figure CSV names the held-out currency; the listing does not');
  const sumCsv = ctx.vault._store.get(`${base} - Summary (€ not included).csv`);
  eq(sumCsv.split('\n')[0], 'Category,Type,Currency,June 2026,July 2026 (in progress),Total,Average,Budgeted', 'the running July is marked in the Summary CSV header');
  const budCsv = ctx.vault._store.get(`${base} - Budget (€ not included).csv`);
  ok(budCsv.split('\n').filter(l => l.startsWith('July 2026')).every(l => l.startsWith('July 2026 (in progress),')), 'and on every July row of the Budget CSV');

  /* an outside reader: python's csv module — same column count on every row, numbers parse */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-vault-csv-caveats-'));
  const f = path.join(dir, 'budget.csv');
  fs.writeFileSync(f, budCsv);
  let py = null;
  try {
    py = execFileSync('python3', ['-c', [
      'import csv,sys,json', 'r=list(csv.reader(open(sys.argv[1],encoding="utf-8",newline="")))',
      'h=r[0]; rows=r[1:]', 'w=set(len(x) for x in r)',
      'nums=[float(x[h.index(c)]) for x in rows for c in ("Budget","Actual","Remaining")]',
      'print(json.dumps({"widths":sorted(w),"periods":sorted(set(x[0] for x in rows)),"n":len(nums)}))'].join('\n'), f],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) { py = null; }
  if (py) {
    const r = JSON.parse(py);
    eq(r.widths, [10], 'python csv: every row has the header\'s ten columns');
    eq(r.periods, ['July 2026 (in progress)', 'June 2026'], 'python csv: one Period value per period');
    ok(r.n > 0, 'python csv: every Budget/Actual/Remaining cell parses as a number');
  } else console.log('export-csv-caveats: python3 not found — csv read-back skipped');
  console.log(`PASS export-csv-caveats (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
