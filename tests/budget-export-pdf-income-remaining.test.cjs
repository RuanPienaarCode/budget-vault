'use strict';
/* The budget export's PDF words an income row's Remaining the way the Budget
   page and the Report do (2026-10-20 audit, D2-05 / M1-03, the "Report/PDF
   Remaining" shape).

   The PDF's period tables printed Remaining = budget − actual for every row,
   so an income line that beat its plan printed "R -2 000,00" — read by anyone
   as an overspend — and income still to come printed like money left to
   spend. The Budget page has said "R X more than planned" / "R X still to
   come" / "received as planned" since the 2026-09-29 audit, and the Report
   since M1-03, by one rule: src/report.js incomeDirection, to the cent. The
   PDF is the rendering a person reads, so it now says the same words, by the
   same rule, from the same keys (bud.remaining.*). An income SUBTOTAL is an
   income row that happens to be a sum, and reads the same way.

   The workbook and the CSV keep the signed number: they are data a
   spreadsheet adds up, and a sentence in a money column sums to zero. Pinned
   here so the words never leak into them.

   Over the committed household through the REAL loader, view and writers,
   with two more income categories, worked by hand:

     September plan  Salary 30 000 · Bonus 1 000 · Rental 4 000
     September in    Salary 30 000 · Bonus 3 000 · Rental 1 500
       Salary   received as planned                     CSV/XLSX  0
       Bonus    R 2 000,00 more than planned            CSV/XLSX  -2 000
       Rental   R 2 500,00 still to come                CSV/XLSX  2 500
       Total income  35 000 planned, 34 500 in -> R 500,00 still to come

     node tests/budget-export-pdf-income-remaining.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, mountFor, readable } = require('./helpers/figures.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const bx = require('../src/budget-export');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const FILES = {
  ...SEED,
  [`${B}/Categories/Bonus.md`]: '---\ntype: income\ncolor: "#55bb77"\n---\n',
  [`${B}/Categories/Rental.md`]: '---\ntype: income\ncolor: "#77bb55"\n---\n',
  [`${B}/Budgets/2026-09.md`]: SEED[`${B}/Budgets/2026-09.md`] + '| Bonus | income | 1000.00 |  |\n| Rental | income | 4000.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-09.md`]: SEED[`${B}/Transactions/Cheque/2026-09.md`]
    + '| 2026-09-01 | Bonus | Bonus | 3000.00 |  |  |  |\n'
    + '| 2026-09-01 | Tenant | Rental | 1500.00 |  |  |  |\n',
};
const ANSWER = { mode: 'months', range: '1', includeCurrent: true, content: 'full', categories: null, includeTx: false, formats: ['pdf', 'xlsx', 'csv'], folder: 'Exports' };

const pdfText = bytes => readable([...Buffer.from(bytes).toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
  .map(m => m[1].replace(/\\(.)/g, '$1')).join(' ')).replace(/\s+/g, ' ');
const xmlOf = bytes => Buffer.from(bytes).toString('utf8');

(async () => {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(FILES, { period: PERIOD, budgetFolder: B });
    require('../src/views/budget-export')(M.ctx);
    const { ctx } = M;
    const money = v => readable(ctx.money(v));
    /* The Budget page's own function, read off the module — the words the
       PDF must match. */
    const { incomeRemainingText } = require('../src/views/budgets');
    const page = rem => readable(incomeRemainingText(rem, ctx.money));
    eq(page(-2000), `${money(2000)} more than planned`, 'CONTROL: the Budget page words a beaten plan this way');

    const { model, written } = await ctx.runBudgetExport(ANSWER);

    /* ---- the PDF's period table --------------------------------------------- */
    const doc = bx.modelToDoc(model, {
      money: ctx.money,
      labels: { incomeMore: i18n.t('bud.remaining.incomeMore', { amount: '{amount}' }), incomeToCome: i18n.t('bud.remaining.incomeToCome', { amount: '{amount}' }), incomeAsPlanned: i18n.t('bud.remaining.incomeAsPlanned') },
    });
    const table = doc.blocks.filter(b => b.type === 'table').pop();
    const remOf = cat => readable((table.rows.find(r => r[0] === cat) || [])[4]);
    eq(remOf('Salary'), page(0), 'Salary: "received as planned"');
    eq(remOf('Bonus'), page(-2000), 'Bonus: "R 2 000,00 more than planned" — not "R -2 000,00"');
    eq(remOf('Rental'), page(2500), 'Rental: "R 2 500,00 still to come"');
    eq(remOf('Total income'), page(500), 'the income subtotal reads the same way: 35 000 planned, 34 500 in');
    eq(remOf('Groceries'), money(2600), 'an expense row keeps its figure');
    ok(!table.rows.some(r => r[1] === 'income' && /R -/.test(readable(r[4]))), 'no income row prints a negative Remaining');

    /* …and in the bytes the view actually wrote, in the household's language. */
    const pdf = pdfText(ctx.vault._store.get(written.find(p => p.endsWith('.pdf'))));
    for (const s of [page(0), page(-2000), page(2500), page(500)]) ok(pdf.includes(s), `the written PDF says "${s}"`);
    ok(!pdf.includes(`R -2 000,00`), 'and nowhere prints the beaten plan as a negative');

    /* ---- the CSV and the workbook stay numbers --------------------------------- */
    const csv = ctx.vault._store.get(written.find(p => p.endsWith('- Budget.csv'))).split('\n');
    const head = csv[0].split(',');
    const cell = (cat, col) => csv.find(l => l.split(',')[3] === cat).split(',')[head.indexOf(col)];
    eq([cell('Salary', 'Remaining'), cell('Bonus', 'Remaining'), cell('Rental', 'Remaining')], ['0.00', '-2000.00', '2500.00'],
      'the Budget CSV keeps the signed figure: it is data a spreadsheet adds up');
    const xlsx = xmlOf(new Uint8Array(ctx.vault._store.get(written.find(p => p.endsWith('.xlsx')))));
    ok(!/more than planned|still to come|received as planned/.test(xlsx), 'and no sentence reaches the workbook');
    ok(/<v>-2000<\/v>/.test(xlsx), 'whose Bonus Remaining is the number -2000');
    eq(model.budgets[0].rows.find(r => r.cat === 'Bonus').remaining, -2000, 'the model itself is unchanged: the words are the PDF\'s rendering only');

    /* ---- in the household's language --------------------------------------------- */
    {
      const raw = require('../src/i18n');
      raw.setLanguage('af');
      try {
        const af = await ctx.runBudgetExport({ ...ANSWER, formats: ['pdf'], folder: 'Exports/af' });
        const text = pdfText(ctx.vault._store.get(af.written[0]));
        const want = readable(raw.t('bud.remaining.incomeMore', { amount: '{amount}' })).replace('{amount}', money(2000));
        ok(want !== `${money(2000)} more than planned`, 'fixture: Afrikaans words it differently');
        ok(text.includes(want), `an Afrikaans household's PDF says "${want}" — the view hands the page's own keys in`);
      } finally { raw.setLanguage('en'); }
    }

    /* ---- a bare caller gets the English words ------------------------------------ */
    const bare = bx.modelToDoc(model, {});
    eq(bare.blocks.filter(b => b.type === 'table').pop().rows.find(r => r[0] === 'Bonus')[4], '2000.00 more than planned',
      'with no formatter or labels handed in, the default English words over the plain number');
  } finally { unpin(); }
  console.log(`PASS budget-export-pdf-income-remaining (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
