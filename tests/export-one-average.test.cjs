'use strict';
/* One export click, one Average — in the CSV, the workbook and the PDF.

   2026-10-07 audit, L4A-04. An average over periods lands on half a cent
   whenever an odd-cent total is split in two (and often over 4, 6 or 12), and
   the three renderings of ONE model rounded that half three ways: the
   workbook with Math.round(v * 100) / 100 — under a comment claiming it was
   "the same figure" as the CSV — the CSV with toFixed(2), the PDF through
   formatAmount (toFixed too). R0,03 over two months printed 0.01 in the CSV,
   0,01 in the PDF and 0.02 in the workbook; 21.7% of two-period cent totals
   disagreed, negative half-cents too, and on a real vault one category's
   This-tax-year Average differed by R0,01 between files written by the same
   click. "Two figures derived by different rules" is this codebase's most
   repeated bug; this was it, inside one export.

   The owner's ruling: half-up on the DECIMAL value, one helper every rendering
   shares. budget-export.js's roundCents() rounds half a cent away from zero
   (Excel's ROUND, and what "half-up" means for money); buildModel rounds
   every figure once, and each rendering prints the number it is handed. So:

     1. roundCents over the cases binary floating point gets wrong: 0.015 and
        2.675 and 1.005 are stored just BELOW their half, which is why toFixed
        said 0.01 / 2.67 / 1.00 — the decimal value is a tie and rounds up.
     2. The sweep: every cent total from -R5,00 to R5,00 over 2, 3, 4, 6 and
        12 periods, CSV == workbook == PDF == an independent reference written
        in integer cents (no floating point anywhere in it).
     3. One real click over the in-memory vault: the three files agree.

   Synthetic data only.
     node tests/export-one-average.test.cjs */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const bx = require('../src/budget-export');
const { budgetRowStatus } = require('../src/money-flow');
const { formatAmount } = require('../src/currency');
const { PROFILES } = require('../src/locale');
const FILES = require('./helpers/views-vault.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const ZA = PROFILES.za;
const fmt = v => formatAmount('R', v, 2, ZA);              // the household formatter, exactly as the PDF gets it
const plain = v => formatAmount('', v, 2, ZA).trim();      // the month-by-month cells' formatter

/* ---- 1. the rule ---- */
{
  ok(typeof bx.roundCents === 'function', 'budget-export.js exports the one rounding helper');
  const r = bx.roundCents;
  eq(r(0.015), 0.02, '0.015 is stored as 0.01499999… — the DECIMAL value is a tie, and a tie rounds up');
  eq(r(-0.015), -0.02, 'a negative tie rounds away from zero, as Excel\'s ROUND does');
  eq(r(2.675), 2.68, '2.675 (stored as 2.67499999…) rounds to 2.68, not the 2.67 toFixed prints');
  eq(r(1.005), 1.01, '1.005 rounds to 1.01, not the 1.00 both Math.round(v*100) and toFixed print');
  eq(r(0.1 + 0.2), 0.3, 'float drift is not a figure: 0.30000000000000004 is 0.30');
  eq(r(10 / 3), 3.33, 'a non-tie rounds to nearest');
  eq(r(0.005), 0.01, 'half a cent is a cent');
  eq(r(0.0049), 0, 'just under half a cent is none');
  ok(Object.is(r(-0.004), 0), 'a negative that rounds to nothing is zero, never -0');
  eq(r(1234567.005), 1234567.01, 'large amounts keep their cents');
  eq(r(-250.5), -250.5, 'a cent value is unchanged');
  ok(Number.isNaN(r(NaN)), 'NaN passes through for each rendering to treat as it always has');
  eq(r(Infinity), Infinity, 'and so does Infinity');
  eq(r(1e-7), 0, 'a millionth is zero');
}

/* ---- 2. the sweep: three renderings and an integer reference ---- */
const row = (cat, type, budget, actual) => ({ cat, type, budget, actual, notes: '', assumed: false, ...budgetRowStatus({ budget, actual, type }) });
const period = (i, rows) => ({ key: `2026-0${i + 1}`, name: `P${i + 1}`, title: '', start: '', end: '', rows, summary: null, txs: [] });
/* Integer cents, half away from zero: no floating point between the total and the answer. */
const refAverage = (totalCents, n) => {
  const sign = totalCents < 0 ? -1 : 1;
  const q = Math.floor((2 * Math.abs(totalCents) + n) / (2 * n));
  const c = sign * q;
  const s = String(Math.abs(c)).padStart(3, '0');
  return `${c < 0 ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
};
const val = c => (c && typeof c === 'object' ? c.v : c);
let compared = 0, ties = 0;
for (const n of [2, 3, 4, 6, 12]) {
  for (let cents = -500; cents <= 500; cents++) {
    // the whole total in the first period, nothing in the rest — the shape of the audit's R0,03 case
    const periods = Array.from({ length: n }, (_, i) => period(i, [row('Parking', 'expense', 0, i === 0 ? cents / 100 : 0)]));
    const m = bx.buildModel({ periods, content: 'summary', categories: null, includeTx: false, generated: '2026-10-07 12:00', currency: 'R' });
    const want = refAverage(cents, n);
    if ((2 * Math.abs(cents)) % (2 * n) === n) ties++;
    const csv = bx.modelToCsv(m, {})[0].text.split('\n')[1].split(',');
    const csvAvg = csv[csv.length - 2];
    const sheet = bx.modelToSheets(m, {})[0];
    const xlsAvg = val(sheet.rows[1][2 + n + 1]);
    const doc = bx.modelToDoc(m, { money: fmt, plainMoney: plain });
    const table = doc.blocks.filter(b => b.type === 'table')[0];
    const pdfAvg = n > bx.PDF_MAX_PERIOD_COLS ? null : table.rows[0][table.rows[0].length - 2];
    if (csvAvg !== want || xlsAvg.toFixed(2) !== want || pdfAvg !== want.replace('.', ',')) {
      assert.fail(`${cents / 100} over ${n} periods: CSV ${csvAvg}, workbook ${xlsAvg}, PDF ${pdfAvg}, decimal half-up ${want}`);
    }
    compared++;
  }
}
eq(compared, 5005, 'every cent total from -R5 to R5 over 2, 3, 4, 6 and 12 periods was compared');
ok(ties > 300, `and the sweep holds plenty of exact half-cent ties (${ties}) — the cases that split before`);
checks++;

/* ---- 2b. the model is rounded ONCE, so subtotals add up the printed rows ---- */
{
  const periods = [period(0, [row('A', 'expense', 0, 0.03), row('B', 'expense', 0, 0.05)]), period(1, [])];
  const m = bx.buildModel({ periods, content: 'summary', categories: null, includeTx: false, generated: '2026-10-07 12:00', currency: 'R' });
  eq(m.summary.rows.map(r => [r.cat, r.total, r.average]), [['A', 0.03, 0.02], ['B', 0.05, 0.03]], 'each row\'s average is the rounded figure the files print');
  eq(m.summary.subtotals[0].average, 0.04, 'and the subtotal\'s is ITS total over the periods (0.08 / 2), rounded the same way');
  const sub = bx.buildModel({ periods: [period(0, [row('A', 'expense', 10.005, 10.005), row('B', 'expense', 0, 10.005)])], content: 'full', categories: null, includeTx: false, generated: '2026-10-07 12:00', currency: 'R' });
  eq(sub.budgets[0].rows.map(r => r.actual), [10.01, 10.01], 'a hand-typed sub-cent figure is rounded where it enters the model');
  eq(sub.budgets[0].subtotals[0].actual, 20.02, 'so the subtotal is the sum of the two printed rows, not 20.01 from the unrounded pair');
}

/* ---- 3. one real click: the three files agree ---- */
(async () => {
  const B = 'Budget';
  const ctx = makeCtx({
    ...FILES,
    [`${B}/Categories/Parking.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Budgets/2026-06.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Parking | expense | 10.00 | |\n| Salary | income | 40000.00 | |\n',
    [`${B}/Transactions/Cheque/2026-06.md`]: `---\n${FILES.TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
      + '| 2026-06-01 | Salary | Salary | 40000.00 |  |  |  |\n| 2026-06-02 | Meter | Parking | -0.03 |  |  |  |\n',
  });
  await loadInto(ctx);
  ctx.money = v => fmt(v);
  ctx.moneyIn = (sym, v) => formatAmount(sym, v, 2, ZA);
  ctx.currentPeriod = () => '2026-08';
  require('../src/views/budget-export')(ctx);
  const answer = { range: '2', includeCurrent: false, content: 'summary', categories: null, includeTx: false, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };
  const { written, model } = await ctx.runBudgetExport(answer);
  eq(model.periods.map(p => p.key), ['2026-06', '2026-07'], 'two finished periods: R0,03 in June, nothing in July');
  const csv = ctx.vault._store.get(written.find(p => p.endsWith('Summary.csv'))).split('\n');
  const head = csv[0].split(',');
  const parking = csv.find(l => l.startsWith('Parking,')).split(',');
  eq(parking[head.indexOf('Average')], '0.02', 'CSV Average: 0.02');
  const xlsx = Buffer.from(new Uint8Array(ctx.vault._store.get(written.find(p => p.endsWith('.xlsx'))))).toString('utf8');
  const sheet1 = xlsx.slice(xlsx.indexOf('<worksheet'), xlsx.indexOf('</worksheet>'));
  const prow = [...sheet1.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].find(m => m[2].includes('>Parking<'));
  const cell = col => (new RegExp(`<c r="${col}${prow[1]}"[^>]*><v>([^<]*)</v>`).exec(prow[2]) || [])[1];
  eq(cell('F'), '0.02', 'workbook Average: the numeric cell holds 0.02');
  const pdf = Buffer.from(new Uint8Array(ctx.vault._store.get(written.find(p => p.endsWith('.pdf'))))).toString('latin1');
  const drawn = [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1]);
  const at = drawn.indexOf('Parking');
  eq(drawn.slice(at, at + 6), ['Parking', '0,03', '0,00', '0,03', '0,02', '10,00'], 'PDF summary row: June 0,03 · July 0,00 · total 0,03 · average 0,02 · budgeted 10,00');
  console.log(`PASS export-one-average (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
