'use strict';
/* The export dialog's preview names exactly the files the click writes, and
   every one of them is a name the filesystem will take.

   2026-10-07 audit:

     L4A-13  a DATE range that no budget period ends inside (2-20 Aug on a
             calendar-month household) wrote a header-only "Budget.csv" the
             preview never named: modelToCsv pushed that file whenever the
             content was 'full', while the dialog listed it only when there
             was a period table to put in it. A file nobody was told about,
             with nothing in it — the "empty file someone will open expecting
             data" modelToCsv's own comment refuses for the Summary CSV.
     L4A-12  up to three picked category names go into the file name, and only
             the COUNT was bounded. Three long names (one of 200 characters)
             made leaves of 262-268 bytes, past the 255-byte limit of APFS,
             ext4 and NTFS: the preview named them happily, the PDF and the
             workbook landed, and the CSVs failed — a partial export. Now the
             name falls back to "(N categories <tag>)" — the shape a pick of
             four already used — whenever the LONGEST leaf the export could
             write would pass 200 bytes of UTF-8, counted in bytes because a
             filesystem counts bytes (a CJK character is three). Decided over
             every file the export could write, not only the ticked formats,
             so a PDF-only and a CSV-only export of one selection still share
             a name and still replace each other.

   The leaves are also created for real in this machine's temp folder.
   Synthetic names only.

     node tests/export-preview-equals-written.test.cjs */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const bx = require('../src/budget-export');
const { budgetRowStatus } = require('../src/money-flow');
const FILES = require('./helpers/views-vault.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const bytes = s => Buffer.byteLength(s, 'utf8');
const leaves = p => [p.pdf, p.xlsx, ...Object.values(p.csv)].map(x => x.split('/').pop());
const row = (cat, type, budget, actual) => ({ cat, type, budget, actual, notes: '', assumed: false, ...budgetRowStatus({ budget, actual, type }) });
const P = [{ key: '2026-06', name: 'June 2026', title: '', start: '2026-06-01', end: '2026-06-30', rows: [row('Food', 'expense', 100, 90)],
  summary: { income: 0, spend: 90, uncatSpend: 0, foreign: { count: 1, labels: ['E'], symbols: ['€'] } }, txs: [] },
{ key: '2026-07', name: 'July 2026', title: '', start: '2026-07-01', end: '2026-07-31', rows: [row('Food', 'expense', 100, 95)], summary: null, txs: [] }];
const META = { generated: '2026-10-07 12:00', currency: 'R' };
const model = cats => bx.buildModel({ periods: P, content: 'full', categories: cats, includeTx: true, ...META });

/* ---------------- L4A-12: names the filesystem will take ---------------- */
const LONG = 'Long-term household maintenance reserve fund '.repeat(5).trim().slice(0, 200);
{
  const p = bx.budgetExportPaths(model([LONG, 'Food', 'Fuel']), 'Exports');
  ok(leaves(p).every(l => bytes(l) <= 200), `every leaf is at most 200 bytes (longest ${Math.max(...leaves(p).map(bytes))})`);
  ok(/^Exports\/Budget June 2026 to July 2026 \(3 categories [0-9a-z]{4,}\)\.pdf$/.test(p.pdf), `three names that do not fit become a count and a tag: ${p.pdf}`);
  eq(bx.budgetExportPaths(model(['Fuel', LONG, 'Food']), 'Exports').pdf, p.pdf, 'the same pick in another order lands on the same name — and replaces it');
  ok(bx.budgetExportPaths(model([LONG, 'Food', 'Rent']), 'Exports').pdf !== p.pdf, 'a different pick does not');

  const short = bx.budgetExportPaths(model(['Fuel', 'Food', 'Rent']), 'Exports');
  eq(short.pdf, 'Exports/Budget June 2026 to July 2026 (Food, Fuel, Rent).pdf', 'three names that fit are still named, as before');

  const one = bx.budgetExportPaths(model(['x'.repeat(230)]), 'Exports');
  ok(/\(1 category [0-9a-z]{4,}\)\.pdf$/.test(one.pdf), `a single name too long for a file name becomes "(1 category <tag>)": ${one.pdf}`);
  ok(leaves(one).every(l => bytes(l) <= 200), 'and fits');

  // bytes, not characters: 25 CJK characters are 75 bytes; 25 Latin ones are 25
  const cjk = ['食费'.repeat(12) + '食', '交通'.repeat(12) + '交', '房租'.repeat(12) + '房'];
  const cjkP = bx.budgetExportPaths(model(cjk), 'Exports');
  ok(/\(3 categories [0-9a-z]{4,}\)/.test(cjkP.pdf) && leaves(cjkP).every(l => bytes(l) <= 200), `three 25-character CJK names are 225 bytes of name — a count and a tag (${Math.max(...leaves(cjkP).map(bytes))} bytes)`);
  const latin = ['a'.repeat(25), 'b'.repeat(25), 'c'.repeat(25)];
  ok(bx.budgetExportPaths(model(latin), 'Exports').pdf.includes(`(${latin.join(', ')})`), 'three 25-character Latin names fit and stay named — the byte count decides, not the character count');

  // the longest leaf decides — including the held-out-currency suffix the CSV names now carry
  const edge = 'e'.repeat(95);
  const withEuro = bx.budgetExportPaths(model([edge, 'Food']), 'Exports');
  ok(leaves(withEuro).every(l => bytes(l) <= 200), `the " - Exact dates (€ not included).csv" leaf is counted too (longest ${Math.max(...leaves(withEuro).map(bytes))})`);

  // and the leaves are names a real filesystem takes
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-vault-names-'));
  for (const l of [...leaves(p), ...leaves(one), ...leaves(cjkP)]) {
    fs.writeFileSync(path.join(dir, l), 'x');
    ok(fs.existsSync(path.join(dir, l)), `created on this machine: ${bytes(l)} bytes`);
  }
}

/* ---------------- L4A-13: no file the preview did not name ---------------- */
{
  const exact = { from: '2026-08-02', to: '2026-08-20', through: '2026-08-20', rows: [row('Food', 'expense', 0, 40)], txs: [] };
  const m = bx.buildModel({ periods: [], content: 'full', categories: null, includeTx: false, ...META, exact });
  eq(bx.modelToCsv(m, {}).map(f => f.kind), ['exact'], 'a date range no period ends inside writes the exact-dates CSV only — no header-only Budget.csv, no empty Summary.csv');
  const full = bx.buildModel({ periods: P, content: 'full', categories: null, includeTx: false, ...META, exact });
  eq(bx.modelToCsv(full, {}).map(f => f.kind), ['exact', 'summary', 'budget'], 'with periods inside the range, all three, as before');
}

/* ---------------- end to end: describe() vs runBudgetExport() ---------------- */
(async () => {
  const B = 'Budget';
  const long = 'Long-term household maintenance reserve fund '.repeat(5).trim().slice(0, 200);
  const ctx = makeCtx({
    ...FILES,
    [`${B}/Categories/Reserve.md`]: `---\nname: "${long}"\ntype: expense\ncolor: "#888888"\n---\n`,
    [`${B}/Categories/Fuel.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Budgets/2026-06.md`]: `---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| ${long} | expense | 300.00 | |\n| Fuel | expense | 900.00 | |\n| Groceries | expense | 4500.00 | |\n| Salary | income | 40000.00 | |\n`,
    [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${FILES.TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n| 2026-06-04 | Grocer | Groceries | -2100.50 |  |  |  |\n'
      + `| 2026-06-05 | Reserve | ${long} | -300.00 |  |  |  |\n| 2026-06-06 | Pump | Fuel | -850.00 |  |  |  |\n`,
  });
  await loadInto(ctx);
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.currentPeriod = () => '2026-08';
  require('../src/views/budget-export')(ctx);

  const pick = { mode: 'months', range: '3', includeCurrent: false, content: 'full', categories: [long, 'Fuel', 'Groceries'], includeTx: true, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };
  const d = ctx.describeBudgetExport(pick);
  ok(!d.problem, `the long pick is exportable: ${d.problem || ''}`);
  ok(d.files.every(f => bytes(f.split('/').pop()) <= 200), 'every file the preview names has a leaf of at most 200 bytes');
  const { written } = await ctx.runBudgetExport(pick);
  eq(written, d.files, 'and those are exactly the files the click wrote');

  const dates = { mode: 'dates', preset: 'custom', from: '2026-07-02', to: '2026-07-20', content: 'full', categories: null, includeTx: false, formats: ['csv'], folder: 'Exports' };
  const dd = ctx.describeBudgetExport(dates);
  ok(!dd.problem, `a short date range is exportable: ${dd.problem || ''}`);
  eq(dd.files, ['Exports/Budget 2026-07-02 to 2026-07-20 - Exact dates.csv'], 'the preview names one file');
  const before = new Set(ctx.vault._store.keys());
  const r = await ctx.runBudgetExport(dates);
  eq(r.written, dd.files, 'and the click writes that one file — not an unannounced header-only Budget.csv beside it');
  eq([...ctx.vault._store.keys()].filter(k => !before.has(k) && !k.endsWith('/.folder')), dd.files, 'nothing else appeared in the vault');
  console.log(`PASS export-preview-equals-written (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
