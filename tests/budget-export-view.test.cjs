'use strict';
/* Budget export, end to end — the REAL view over the REAL loader, in bare node.

   tests/budget-export.test.cjs pins the model against hand-built rows. That
   proves the arrangement and nothing about the wiring: a view that fed the
   model the wrong period, a draft instead of the saved budget, or rows from a
   second derivation would pass every check in that file. This one mounts
   io + period + trend-math + figures + load over the shared synthetic
   household and runs runBudgetExport() — the same function the dialog's
   Export button calls — then opens what landed in the vault.

     1. A NUMBER IN THE FILE IS THE NUMBER ON THE SCREEN. The CSV's Actual for
        a category equals budgetVsActualRows(p)'s, read off the same ctx — not
        a figure this test re-derives, which would only prove two copies agree.
     2. The split parent's R900 is NOT in Groceries' actual (it is excluded;
        its parts are counted) but IS in the transactions listing, flagged —
        CLAUDE.md's "excluded means out of the totals, not ignore this row",
        both halves, in one export.
     3. Binary files are BYTES. A PDF written through vault.modify() would be
        UTF-8-encoded on the way and every xref offset after the first high
        byte would be wrong; the file would exist and open nowhere.
     4. The preview names exactly the files a click writes.
     5. Every refusal is made BEFORE the click: no finished period, nothing
        ticked, a managed folder.
     6. A category the built-in PDF font cannot draw takes the image path —
        and in bare node, where there is no canvas, that must surface as a
        failure that still reports the files already written, never as a PDF
        full of question marks.
     7. Nothing is remembered from an export that was never made.

   Every figure is synthetic. */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const FILES = require('./helpers/views-vault.cjs');
const { B, TX_FM } = FILES;

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const JUNE = {
  [`${B}/Budgets/2026-06.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4500.00 | tight month |\n| Salary | income | 40000.00 | |\n',
  [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
    + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n'
    + '| 2026-06-04 | =HYPERLINK("x") Grocer | Groceries | -2100.50 |  |  |  |\n',
};

async function mount(extra, today = '2026-07') {
  const ctx = makeCtx({ ...FILES, ...JUNE, ...(extra || {}) });
  await loadInto(ctx);
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  /* The wall clock is the one thing this export reads that a fixture cannot
     hold still. Assigned before the view registers, because the view — like
     every module here — destructures off ctx at register time. */
  ctx.currentPeriod = () => today;
  require('../src/views/budget-export')(ctx);
  return ctx;
}
const ANSWER = { range: '3', includeCurrent: true, content: 'full', categories: null, includeTx: true, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };
const text = (ctx, p) => ctx.vault._store.get(p);

(async () => {
  /* ---- 1–4: a full export, all three formats ---- */
  {
    const ctx = await mount();
    const preview = ctx.describeBudgetExport(ANSWER);
    ok(!preview.problem, `nothing to refuse: ${preview.problem || ''}`);
    const { written, raster, model } = await ctx.runBudgetExport(ANSWER);
    eq(written, preview.files, 'the preview named exactly the files the click wrote, in order');
    eq(raster, false, 'a Latin-script household gets the real-text PDF');
    eq(model.periods.map(p => p.key), ['2026-06', '2026-07'], 'three months asked for, two exist — no invented April/May');
    eq(model.inProgress, '2026-07', 'the current period is flagged as in progress');

    const base = 'Exports/Budget June 2026 to July 2026';
    const budget = text(ctx, `${base} - Budget.csv`).split('\n');
    const screen = ctx.budgetVsActualRows('2026-07').find(r => r.cat === 'Groceries');
    const line = budget.find(l => l.startsWith('July 2026,') && l.includes(',Groceries,'));
    ok(line, 'July Groceries is in the long-format CSV');
    const cells = line.split(',');
    eq(Number(cells[7]), screen.actual, 'CSV Actual === budgetVsActualRows(p).actual, the figure the Budget page prints');
    eq(Number(cells[8]), screen.remaining, 'and Remaining is the row\'s own');
    eq(screen.actual, 1700, 'which is 1200 + the 500 split PART — the excluded 900 parent is not in it');
    ok(budget.some(l => l.startsWith('June 2026,2026-06-01,2026-06-30,Groceries,expense,R,4500.00,2100.50,2399.50,tight month')),
      'June row: dates, budget, actual, remaining and the budget note');

    const summary = text(ctx, `${base} - Summary.csv`).split('\n');
    eq(summary[0], 'Category,Type,Currency,June 2026,July 2026,Total,Average,Budgeted', 'one column per period');
    ok(summary.includes('Groceries,expense,R,2100.50,1700.00,3800.50,1900.25,9500.00'), 'month columns, total, average, budgeted');

    const txs = text(ctx, `${base} - Transactions.csv`);
    ok(/Split parent,Cheque,Groceries,R,-900\.00,yes,Split into 2,parent/.test(txs), 'the excluded split parent is LISTED, flagged yes + parent');
    ok(txs.includes(`"'=HYPERLINK(""x"") Grocer"`), 'a description that would execute is defused in the CSV');
    ok(!/'-\d/.test(txs), 'and no amount is');

    const pdf = text(ctx, `${base}.pdf`);
    ok(pdf instanceof ArrayBuffer, 'the PDF went through createBinary as an ArrayBuffer, not through create() as a string');
    const pb = new Uint8Array(pdf);
    eq(String.fromCharCode(...pb.slice(0, 5)), '%PDF-', 'PDF magic');
    ok(String.fromCharCode(...pb.slice(-6)).includes('%%EOF'), 'PDF trailer');
    const latin1 = Array.from(pb, c => String.fromCharCode(c)).join('');
    ok(latin1.includes('Groceries'), 'category text is in the content stream — real text, not an image');
    ok(!latin1.includes('/DCTDecode'), 'no page images on the vector path');

    const xlsx = new Uint8Array(text(ctx, `${base}.xlsx`));
    eq([xlsx[0], xlsx[1], xlsx[2], xlsx[3]], [0x50, 0x4B, 0x03, 0x04], 'workbook is a zip (PK\\x03\\x04)');
    const xs = Array.from(xlsx, c => String.fromCharCode(c)).join('');
    ok(xs.includes('<v>1700</v>'), 'July Groceries is a NUMERIC cell in the stored (uncompressed) sheet XML');
    ok(xs.includes('=HYPERLINK(&quot;x&quot;) Grocer') && !xs.includes('<f>'), 'the formula-shaped description is an inert inline string; the workbook has no formula cells at all');

    eq(ctx._toasts.filter(t => t.bad), [], 'no error toasts');
  }

  /* ---- finished periods only, summary only, one category, CSV only ---- */
  {
    const ctx = await mount();
    const a = { ...ANSWER, includeCurrent: false, content: 'summary', categories: ['Groceries'], includeTx: false, formats: ['csv'] };
    const d = ctx.describeBudgetExport(a);
    eq(d.files, ['Exports/Budget summary June 2026 (Groceries) - Summary.csv'], 'one file, named for its content and its filter');
    const { written, model } = await ctx.runBudgetExport(a);
    eq(written, d.files, 'and that is what was written');
    eq(model.periods.map(p => p.key), ['2026-06'], 'July is in progress, so "finished only" stops at June');
    eq(text(ctx, written[0]).trim().split('\n').length, 2, 'header + the one category');
  }

  /* ---- 5. refusals, before the click ---- */
  {
    const ctx = await mount(null, '2026-06');   // June is current: no finished period has data
    ok(/current period/i.test(ctx.describeBudgetExport({ ...ANSWER, includeCurrent: false }).problem || ''), 'no finished period yet — says to include the current one');
    ok(!ctx.describeBudgetExport(ANSWER).problem, 'and with it included there is something to export');
    ok(/at least one/i.test(ctx.describeBudgetExport({ ...ANSWER, categories: [] }).problem || ''), 'nothing ticked');
    ok(ctx.describeBudgetExport({ ...ANSWER, folder: `${B}/Categories` }).problem, 'a folder the loader reads back as vault data is refused');
    ok(ctx.describeBudgetExport({ ...ANSWER, categories: ['No such category'] }).problem, 'a pick that matches nothing is refused rather than exported empty');
  }

  /* ---- 5b. an export REPLACES what is at its path, so the preview must say so ----
     writeVaultFile/writeVaultBinary modify in place — right for re-exporting a
     selection you just corrected, and silent data loss for the household
     member who keeps their own hand-edited "Budget June 2026 to July 2026.xlsx"
     in Exports/. views/tax.js refuses to overwrite a certificate; an export
     cannot refuse (overwriting is its contract), so it discloses, per file,
     BEFORE the click. */
  {
    const ctx = await mount();
    eq(ctx.describeBudgetExport(ANSWER).replaces, [], 'a first export replaces nothing');
    await ctx.runBudgetExport({ ...ANSWER, formats: ['xlsx'] });
    eq(ctx.describeBudgetExport(ANSWER).replaces, ['Exports/Budget June 2026 to July 2026.xlsx'],
      'a second one names exactly the file already there — not the PDF and CSVs that are new');
  }

  /* ---- 5c. Obsidian's own config folder is not an export destination ---- */
  {
    const ctx = await mount();
    ctx.app.vault.configDir = '.obsidian';
    ok(ctx.describeBudgetExport({ ...ANSWER, folder: '.obsidian/plugins' }).problem, 'a folder inside the config directory is refused');
    ok(ctx.describeBudgetExport({ ...ANSWER, folder: '.obsidian' }).problem, 'and the directory itself');
    ok(!ctx.describeBudgetExport({ ...ANSWER, folder: '.obsidian-notes' }).problem, 'a folder that merely STARTS with the same characters is not — segments, not prefixes');
    let err = null;
    try { await ctx.runBudgetExport({ ...ANSWER, folder: '.obsidian', formats: ['csv'] }); } catch (e) { err = e; }
    ok(err, 'and the write refuses a second time, independently of the dialog');
    ok(![...ctx.vault._store.keys()].some(k => k.startsWith('.obsidian/')), 'nothing was written there');
  }

  /* ---- 5d. the checklist offers every category a TRANSACTION can carry ----
     Transfer-typed categories are never a budget row, so the first checklist
     left them out — and then "every box ticked" (no filter) listed transfer
     transactions while unticking any one unrelated box made them vanish, with
     nothing on the page to say why. */
  {
    const ctx = await mount();
    ok(ctx.budgetExportCategories().some(c => c.type === 'transfer'), 'transfer categories are in the list');
    eq(ctx.budgetExportCategories().length, ctx.S.categories.length, 'so "all ticked" and "no filter" are the same set of named categories');
  }

  /* ---- 5e. a DATE range: exact dates for money, whole periods for budgets ----
     10 Jun – 4 Jul cuts through both fixture months. The exact-date Groceries
     is the 3 Jul R1 200 alone: the 4 Jun R2 100,50 is before the range and the
     5 Jul split part is after it. The only period ENDING inside the range is
     June — whose own table still says R2 100,50, because a budget period is
     never cut. Two different numbers for "Groceries", both right, and the
     export is only honest if it carries both AND says which is which. */
  {
    const ctx = await mount();
    const a = { ...ANSWER, mode: 'dates', from: '2026-06-10', to: '2026-07-04', formats: ['csv'] };
    const d = ctx.describeBudgetExport(a);
    ok(!d.problem, `a date range is exportable: ${d.problem || ''}`);
    const { written, model } = await ctx.runBudgetExport(a);
    eq(written, d.files, 'preview == written, in date mode too');
    eq(model.periods.map(p => p.key), ['2026-06'], 'whole periods: only June ENDS inside 10 Jun – 4 Jul');
    const base = 'Exports/Budget 2026-06-10 to 2026-07-04';
    const exact = text(ctx, `${base} - Exact dates.csv`);
    ok(exact.includes('Groceries,expense,R,2026-06-10,2026-07-04,1200.00'), 'exact-date Groceries is the one purchase inside the dates');
    const same = ctx.categoryActualsInRange('2026-06-10', '2026-07-04').rows.find(r => r.cat === 'Groceries');
    eq(same.actual, 1200, 'and it is figures.js\'s own answer for that window, not one computed here');
    ok(text(ctx, `${base} - Budget.csv`).includes('June 2026,2026-06-01,2026-06-30,Groceries,expense,R,4500.00,2100.50'), 'while June\'s budget table is June, whole');
    const txs = text(ctx, `${base} - Transactions.csv`).trim().split('\n').slice(1).map(l => l.slice(0, 10));
    eq(txs, ['2026-07-01', '2026-07-03'], 'transactions are the exact-date ones: nothing from 1–9 June, nothing after 4 July');

    ok(/date/i.test(ctx.describeBudgetExport({ ...a, from: '2026-07-04', to: '2026-06-10' }).problem || ''), 'from after to is refused before the click');
    ok(ctx.describeBudgetExport({ ...a, from: '2026-13-45' }).problem, 'as is a date that is not one');
    ok(ctx.describeBudgetExport({ ...a, from: '2019-01-01', to: '2019-12-31' }).problem, 'and a range with nothing in it');

    const pre = ctx.budgetExportPresets();
    eq(pre.map(x => x.key), ['taxThis', 'taxLast', 'calThis', 'calLast'], 'the fixture household is ZA, so it is offered tax years');
    ok(pre[0].from.endsWith('-03-01'), 'starting 1 March');
  }

  /* ---- 6. text Helvetica cannot draw ---- */
  {
    const ctx = await mount({
      [`${B}/Categories/食费.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
      [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 | |\n| 食费 | expense | 800.00 | |\n| Salary | income | 40000.00 | |\n',
    });
    // CSV and workbook are UTF-8 and unaffected.
    const { written } = await ctx.runBudgetExport({ ...ANSWER, formats: ['xlsx', 'csv'] });
    ok(text(ctx, written.find(p => p.endsWith('Summary.csv'))).includes('食费'), 'the CSV carries the name as typed');
    // The PDF must NOT come out as vector text full of "?". With no canvas in
    // bare node the image path cannot run, so it has to fail — loudly.
    let err = null;
    try { await ctx.runBudgetExport({ ...ANSWER, formats: ['csv', 'pdf'] }); } catch (e) { err = e; }
    ok(err, 'no canvas here, so the image path throws rather than silently writing a wrong PDF');
    eq(err.written, [], 'PDF is written first, so nothing had landed — and the error says so');
    ok(!ctx.vault._store.has('Exports/Budget June 2026 to July 2026.pdf'), 'and no half-made PDF was left in the vault');
  }

  /* ---- 7. nothing remembered without an export ---- */
  {
    const ctx = await mount();
    eq(ctx.plugin.settings.budgetExport, undefined, 'runBudgetExport is the write, not the remembering — that is exportBudget\'s, after success');
  }

  console.log(`PASS budget-export-view — ${checks} checks`);
})().catch(e => { console.error(e); process.exit(1); });
