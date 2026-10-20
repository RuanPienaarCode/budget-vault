'use strict';
/* The Report's income rows say what the Budget page says, and compare like
   with like (2026-10-20 audit, M1-03 and M1-04).

   M1-03. The Budget vs Actual table printed Remaining = budget − actual for
   every row, so an income row that beat its plan printed a negative figure
   ("R -8 000,00", read by anyone as an overspend) and income still to come
   printed like money left to spend. The Budget page and the Dashboard table
   have worded the same row as "R X more than planned" / "R X still to come" /
   "received as planned" since the 2026-09-29 audit (incomeRemainingText in
   views/budgets.js). The JSON carried the same bare signed figure with nothing
   to say which way it points, and a figure for income rows with no plan at all
   where the Markdown prints a blank cell.

   M1-04. The like-for-like rule (2026-10-14 audit, L2b-01) compared a period's
   SPEND only where the period has a spending budget, but compared income
   against every one of those periods whether or not its budget planned any
   income. On the vault this was found on, several months of budget files carry
   no income row, and a 12-month report set twelve months of pay against a few
   months of plan: the pay row's actual came out at about twice its budget.
   Now an income row is compared only over the periods whose budget plans that
   income, "Budgeted income" covers the same periods, and the periods whose
   budget plans no income at all are named, as the spend side names its own.

   Worked BY HAND over the committed household, through the REAL loader and
   views, with three more income categories:

     September plan   Salary 30 000 · Bonus 1 000 · Rental 4 000
     September in     Salary 30 000 · Bonus 3 000 · Rental 1 500 · Interest 120
       Salary    30 000 of 30 000   received as planned        remaining 0
       Bonus      3 000 of  1 000   R 2 000,00 more than planned  -2 000
       Rental     1 500 of  4 000   R 2 500,00 still to come      2 500
       Interest     120, no plan    blank                          null

     3 months, August budgeted for spending but NOT for income, August paid
     Salary 30 000 and Interest 80:
       Salary    actual 30 000 against 30 000 (old: 60 000, "R -30 000,00")
       Interest  no period plans it: actual over every compared period, 200
       August named as planning no income; Budgeted income 35 000

     3 months, August's budget plans Rental 4 000 (and no Salary), August
     received Rental 4 000:
       Salary    still September only: 30 000 of 30 000
       Rental    both periods: 5 500 of 8 000 -> R 2 500,00 still to come
       nothing named: every compared period plans some income

     node tests/report-income-rows.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { pinClock, readable } = require('./helpers/figures.cjs');
const { mountFor, createReport, section } = require('./helpers/report-page.cjs');
const { SEED, B, TODAY, PERIOD } = require('./figures/household.cjs');
const report = require('../src/report');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const SEP_BUDGET = `${B}/Budgets/2026-09.md`;
const SEP_TX = `${B}/Transactions/Cheque/2026-09.md`;
const AUG_TX = `${B}/Transactions/Cheque/2026-08.md`;
const BUDGET_HEAD = '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n';
const AUG_SPEND = '| Groceries | expense | 4000.00 |  |\n| Rent | expense | 9000.00 |  |\n| Gym | expense | 1000.00 |  |\n';

const files = (over) => ({
  ...SEED,
  [`${B}/Categories/Bonus.md`]: '---\ntype: income\ncolor: "#55bb77"\n---\n',
  [`${B}/Categories/Rental.md`]: '---\ntype: income\ncolor: "#77bb55"\n---\n',
  [`${B}/Categories/Interest.md`]: '---\ntype: income\ncolor: "#99bb33"\n---\n',
  [SEP_BUDGET]: SEED[SEP_BUDGET] + '| Bonus | income | 1000.00 |  |\n| Rental | income | 4000.00 |  |\n',
  [SEP_TX]: SEED[SEP_TX]
    + '| 2026-09-01 | Bonus | Bonus | 3000.00 |  |  |  |\n'
    + '| 2026-09-01 | Tenant | Rental | 1500.00 |  |  |  |\n'
    + '| 2026-09-01 | Interest | Interest | 120.00 |  |  |  |\n',
  ...(over || {}),
});

async function run(f, pill) {
  const unpin = pinClock(TODAY);
  try {
    const M = await mountFor(f, { period: PERIOD, budgetFolder: B });
    return { M, ...(await createReport(M, { pill })) };
  } finally { unpin(); }
}
/* One Budget vs Actual row of the Markdown, by category: its five cells. */
const mdRow = (md, cat) => {
  const sec = section(md, i18n.t('report.section.budgetActual')) || '';
  const line = sec.split('\n').find(l => l.startsWith(`| ${cat} |`));
  return line ? line.replace(/^\||\|$/g, '').split('|').map(c => c.trim()) : null;
};
const jRow = (json, cat) => json.budgets_vs_actuals.find(r => r.category === cat);

(async () => {
  /* The Budget page's own sentence for an income row — the function the
     Dashboard table and the Budget page both call. Read off the module, not
     re-spelled here, so a rewording on the page fails this suite. */
  const { incomeRemainingText } = require('../src/views/budgets');

  /* ---- M1-03: one period, the three states and the unplanned row ---------- */
  {
    const r = await run(files(), 'current');
    const money = r.M.ctx.money;
    const page = rem => readable(incomeRemainingText(rem, money));

    const want = {
      Salary: [0, page(0), 'as_planned'],
      Bonus: [-2000, page(-2000), 'more_than_planned'],
      Rental: [2500, page(2500), 'still_to_come'],
    };
    eq(page(-2000), `${readable(money(2000))} more than planned`, 'CONTROL: the Budget page words a beaten plan this way');
    eq(page(2500), `${readable(money(2500))} still to come`, 'CONTROL: and income still to come this way');
    for (const [cat, [rem, text, dir]] of Object.entries(want)) {
      const cells = mdRow(r.md, cat);
      ok(cells, `${cat} has a Budget vs Actual row`);
      eq(cells[1], 'income', `${cat} is an income row`);
      eq(cells[4], text, `${cat}: Remaining reads as the Budget page reads it — "${text}"`);
      const j = jRow(r.json, cat);
      eq([j.remaining, j.direction], [rem, dir], `${cat}: the JSON keeps the signed figure and says which way it points`);
    }
    ok(!/\| income \|[^\n]*R -/.test(section(r.md, i18n.t('report.section.budgetActual'))),
      'no income row prints a negative Remaining');

    const interest = mdRow(r.md, 'Interest');
    eq([interest[2], interest[3], interest[4]], ['—', readable(money(120)), ''], 'Interest has no plan: a dash, its actual, and a blank Remaining');
    eq([jRow(r.json, 'Interest').remaining, jRow(r.json, 'Interest').direction], [null, null],
      'and the JSON says nothing either — null where the Markdown is blank, not -120');

    const groceries = jRow(r.json, 'Groceries');
    eq([groceries.remaining, groceries.direction], [5000 - 2400, null], 'an expense row keeps its figure and has no income direction');
  }

  /* ---- M1-04: August budgets spending but no income ------------------------ */
  {
    const r = await run(files({
      [`${B}/Budgets/2026-08.md`]: BUDGET_HEAD + AUG_SPEND,
      [AUG_TX]: SEED[AUG_TX] + '| 2026-08-02 | Interest | Interest | 80.00 |  |  |  |\n',
    }), '3m');
    const money = r.M.ctx.money;
    eq(r.json.period_count, 2, 'fixture: the report covers August and September');
    eq(r.json.income_vs_spend.budget_periods, { compared: 2, total: 2, left_out: [] }, 'fixture: both periods budget spending, so the spend side compares both');

    const sal = jRow(r.json, 'Salary');
    eq([sal.budget, sal.actual, sal.remaining, sal.direction], [30000, 30000, 0, 'as_planned'],
      'Salary is compared over September only — the one period whose budget plans it (not 60 000 against 30 000)');
    eq(mdRow(r.md, 'Salary')[4], readable(i18n.t('bud.remaining.incomeAsPlanned')), 'and the Markdown says it arrived as planned');
    eq(jRow(r.json, 'Interest').actual, 200, 'an income no period plans is listed over every compared period, actuals only');
    eq(jRow(r.json, 'Groceries').actual, 6400, 'expense rows are untouched: both periods, 4 000 + 2 400');

    eq(r.json.income_vs_spend.budget_income, 35000, 'Budgeted income: September\'s Salary + Bonus + Rental');
    eq(r.json.income_vs_spend.income, 30080 + 34620, 'Income stays the plain total over every period (August 30 000 + 80, September 30 000 + 3 000 + 1 500 + 120)');
    eq(r.json.income_vs_spend.income_periods, { compared: 1, total: 2, left_out: ['August 2026'] },
      'the JSON says which compared periods plan no income');
    const note = i18n.t('report.budget.incomeLeftOut', { count: 1, total: 2, names: 'August 2026' });
    ok(section(r.md, i18n.t('report.section.incomeSpend')).includes(note), `the document names August under Income & spend — expected "${note}"`);
    ok(/income above covers every period/.test(note), 'in words that say what the plain Income total covers');
  }

  /* ---- M1-04, per row: August plans Rental but not Salary ------------------ */
  {
    const r = await run(files({
      [`${B}/Budgets/2026-08.md`]: BUDGET_HEAD + AUG_SPEND + '| Rental | income | 4000.00 |  |\n',
      [AUG_TX]: SEED[AUG_TX] + '| 2026-08-02 | Tenant | Rental | 4000.00 |  |  |  |\n',
    }), '3m');
    const money = r.M.ctx.money;
    const sal = jRow(r.json, 'Salary');
    eq([sal.budget, sal.actual], [30000, 30000], 'Salary: still September against September — August\'s budget never planned it');
    const rent = jRow(r.json, 'Rental');
    eq([rent.budget, rent.actual, rent.remaining, rent.direction], [8000, 5500, 2500, 'still_to_come'], 'Rental: both periods plan it, so both are compared');
    eq(mdRow(r.md, 'Rental')[4], readable(i18n.t('bud.remaining.incomeToCome', { amount: money(2500) })), 'worded as the Budget page words it');
    eq(r.json.income_vs_spend.income_periods, { compared: 2, total: 2, left_out: [] }, 'every compared period plans some income');
    ok(!/no income in (its|their) budget/.test(r.md), 'so nothing is named');
  }

  /* ---- the pure rule --------------------------------------------------------- */
  {
    const P = (rows) => rows.map(([cat, type, budget, actual]) => ({ cat, type, budget, actual }));
    const rows = report.budgetRowsCompared([
      P([['Pay', 'income', 0, 100], ['Food', 'expense', 50, 40], ['Tips', 'income', 0, 5]]),
      P([['Pay', 'income', 100, 100], ['Food', 'expense', 50, 60], ['Tips', 'income', 0, 7]]),
      P([['Pay', 'income', 100, 90], ['Food', 'expense', 0, 30]]),
    ], [0, 1, 2]);
    const by = Object.fromEntries(rows.map(r => [r.cat, [r.budget, r.actual]]));
    eq(by.Pay, [200, 190], 'an income row is merged over the periods that plan it');
    eq(by.Food, [100, 130], 'an expense row over every compared period, as before');
    eq(by.Tips, [0, 12], 'an income nobody plans over every compared period');
    eq(report.budgetRowsCompared([P([['Pay', 'income', 10, 20]]), P([['Pay', 'income', 0, 30]])], [1]).map(r => r.actual), [30],
      'only the periods handed in are read');
    eq(report.incomeDirection(0.0000000004), 'as_planned', 'to the cent: float residue is on plan');
    eq([report.incomeDirection(-0.01), report.incomeDirection(0.01)], ['more_than_planned', 'still_to_come'], 'a real cent is a direction');
  }

  console.log(`PASS report-income-rows (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
