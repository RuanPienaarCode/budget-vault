'use strict';
/* The 2026-09-02 calculation audit's VERIFICATION pass — what the two
   read-only reviewers found still open after the seven fix lanes landed,
   pinned so the fixes to their findings cannot quietly undo themselves.

   Three of them, all the same shape the audit was hunting: a rule fixed in
   one place and left as it was one function over.

     1. A budget row's TYPE. budgetTotals() had just been taught to read the
        category's live type instead of the stale cell in Budgets/<p>.md, but
        assumedSpend() in the same file and the Dashboard's budgetVsActualRows
        still read `b.type`. Measured: a category file saying `expense,
        assume_spent: true` whose row still said `income` gave budgetTotals
        {income: 10 000, spend: 1 200} and assumedSpend 0. period.js now
        publishes budgetRowType() and all three read it.

     2. The Report's JSON twin. savingsSummary() narrows `total` to the
        household's currency, so a pool that is ENTIRELY foreign has total 0 —
        and the JSON gated its whole `savings` object on `savings.total`, so
        the `foreign` fact (the one thing that vault needs said) never
        shipped, while the Markdown twin hoists its sentence outside that
        branch for exactly this case.

     3. The Debt section's caveat verb. One helper, one key, two headings:
        "Plus € 100 000 HELD in other currencies" printed under Debt, about a
        bond the household OWES. Same figure, inverted sign for an advisor
        reading the forwarded file. The Debt site now passes its own key.

   Runs in bare node against the REAL loader for (1) and the real report
   builders for (2) and (3).
     node tests/audit-residuals.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const i18n = require('../src/i18n');
const { financialReportMarkdown, financialReportJson } = require('../src/report');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';

/* ---- 1. one reading of a budget row's type ------------------------------ */
(async () => {
  /* Carry's category file says expense + assume_spent; its July row was saved
     back when the category was typed income and still says so. Bonus is the
     mirror case: retyped TO income, row still says expense. */
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Carry.md`]: '---\ntype: expense\nassume_spent: true\ncolor: "#888888"\n---\n',
    [`${B}/Categories/Bonus.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-01\n---\n',
    [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Carry | income | 2500.00 | row saved before the retype |\n'
      + '| Bonus | expense | 5000.00 | row saved before the retype |\n'
      + '| Salary | income | 10000.00 | |\n'
      + '| Groceries | expense | 3000.00 | |\n',
  };
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  S.period = '2026-07';

  eq(S.budgets['2026-07'].map(r => r.type), ['income', 'expense', 'income', 'expense'],
    'the stored Type cells are untouched — the app reads past them, never rewrites them');

  eq(ctx.budgetRowType(S.budgets['2026-07'][0]), 'expense', 'budgetRowType: the live category type wins over the stale cell');
  eq(ctx.budgetRowType({ category: 'Ghost', type: 'housing' }), 'housing', 'budgetRowType: only a category with no file falls back to the stored cell');

  eq(ctx.budgetTotals('2026-07'), { income: 15000, spend: 5500 , setAside: 0 },
    'budgetTotals: Carry (live expense) is spend, Bonus (live income) is income');
  eq(ctx.budgetUsed('2026-07').assumed, 2500,
    'budgetUsed().assumed: the assume-spent row counts by its LIVE type — it read 0 while its stale cell said income');

  console.log(`PASS — audit residuals: one budget-row type rule across budgetTotals and assumedSpend (${checks} checks so far).`);
})().then(() => {
  /* ---- 2. the JSON twin carries the savings caveat on an all-foreign pool ---- */
  const base = {
    generated: '2026-09-02 09:00', periodLabel: 'September 2026', rangeNote: '', detail: 'summary',
    currency: 'R', income: 0, spend: 0, net: 0, budgetIncome: 0, budgetSpend: 0,
    categories: [], spendByCategory: [], categoryGap: { uncat: 0, netted: 0 },
    debts: null, netWorth: { net: 0, assets: 0, liabilities: 0 }, health: null, transactions: null,
  };
  const allForeign = { ...base, savings: {
    growth: 0, rateGrowth: 0, rateCapital: 0, measured: 0, unmeasured: 0, negCapital: 0, total: 0,
    foreign: { count: 2, symbols: ['€'] },
  } };
  const json = JSON.parse(financialReportJson(allForeign));
  ok(json.savings !== null, 'an all-foreign savings pool still yields a savings object in the JSON');
  eq(json.savings.foreign, { count: 2, symbols: ['€'] }, 'and the foreign fact the Markdown twin prints reaches the JSON reader too');
  const none = JSON.parse(financialReportJson({ ...base, savings: { total: 0, foreign: { count: 0, symbols: [] } } }));
  eq(none.savings, null, 'a household with no savings at all still gets null, not an empty object');

  /* ---- 3. the Debt caveat says owed, not held ---------------------------- */
  const money = v => `R ${Number(v).toFixed(2)}`;
  const withForeignDebt = { ...base, debts: {
    count: 2, active: 1, total: 8000, perMonth: 550, interest: 150,
    rows: [{ name: 'Card', balance: 8000, rate: 22.5, interest: 150 }],
    foreign: { count: 1, others: [['€', 100000]] },
  } };
  const md = financialReportMarkdown(withForeignDebt, money);
  const debtSection = md.split(`## ${i18n.t('report.section.debt')}`)[1].split('\n## ')[0];
  ok(debtSection.includes(i18n.t('report.debt.otherCurrencies', { list: '€ 100000' }).trim()),
    'the Debt section names the euro bond as money OWED in another currency');
  ok(!debtSection.includes(i18n.t('acct.hero.otherCurrencies', { list: '€ 100000' }).trim()),
    'and never with the asset-side verb the Net Worth section uses');
  ok(i18n.t('report.debt.otherCurrencies', { list: 'x' }) !== i18n.t('acct.hero.otherCurrencies', { list: 'x' }),
    'the two keys are genuinely different sentences in English');

  console.log(`PASS — audit residuals: budget-row type, JSON savings caveat, Debt caveat verb (${checks} checks).`);
}).catch(e => { console.error(e); process.exit(1); });
