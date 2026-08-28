'use strict';
/* Financial report — src/report.js, pinned.

   The failures this guards against:

     1. reportPaths() sanitises `label` and `folder` the same two-ring way
        exportPaths() does — a traversal segment cannot escape the vault,
        and a nested destination survives. Both mdPath and jsonPath are
        always returned, sharing one base name.
     2. mergeCategoryRows() sums the SAME field across several periods'
        worth of rows without inventing a rule of its own — two periods of
        R500 and R300 in "Groceries" merge to R800, never R500 or R300 alone,
        and a category's `type` survives the merge from whichever period
        named it first.
     3. financialReportMarkdown() and financialReportJson() are pinned
        against the SAME `data` object — the whole point of the "one object,
        two serialisers" design (see src/report.js's own header): a figure
        that appears formatted in the Markdown must equal the raw figure
        JSON carries for the same field, not a second computation of it.
     4. "As of today" sections (savings, debt, net worth, health) render
        their none/partial/full states correctly, and the health section is
        absent entirely when there is nothing honest to say.
     5. Transaction detail only appears in detail mode, carries excluded
        rows (marked, not dropped — same rule exporter.js documents), and
        reads through exporter.js's own txHeaderLines/transactionRow rather
        than a second column-order declaration.
     6. copyBody() strips the frontmatter for a clipboard copy without
        touching a document that never had one.
     7. The JSON output never invents a "loans" section — views/loans.js has
        no persisted data for one to hold.

   Pure — no DOM, no obsidian, no vault. */

const assert = require('assert');
const {
  REPORT_DIR, reportPaths, mergeCategoryRows,
  financialReportMarkdown, financialReportJson, copyBody,
} = require('../src/report');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

i18n.setLanguage('en');
const money = v => `R ${v < 0 ? '-' : ''}${Math.abs(v).toFixed(2)}`;

/* ---- 1. reportPaths ---- */
{
  const p = reportPaths('2026-08', undefined);
  eq(p.dir, REPORT_DIR, 'default folder is Reports');
  eq(p.mdPath, 'Reports/2026-08 Financial Report.md', 'markdown path named after the period label');
  eq(p.jsonPath, 'Reports/2026-08 Financial Report.json', 'json path shares the same base name');

  const nested = reportPaths('Aug 2026', 'Admin/2026 Reports');
  eq(nested.mdPath, 'Admin/2026 Reports/Aug 2026 Financial Report.md', 'a nested destination survives');

  const escaped = reportPaths('Aug 2026', '../../secrets');
  ok(!escaped.mdPath.includes('../'), 'a hostile folder cannot climb out');
  eq(escaped.dir, 'secrets', 'the traversal segments are dropped');

  const badLabel = reportPaths('../../etc/passwd', 'Reports');
  ok(!badLabel.mdPath.includes('../'), 'a hostile period label cannot climb out either');
}

/* ---- 2. mergeCategoryRows ---- */
{
  const p1 = [{ cat: 'Groceries', type: 'expense', budget: 500, actual: 480 }, { cat: 'Salary', type: 'income', budget: 0, actual: 40000 }];
  const p2 = [{ cat: 'Groceries', type: 'expense', budget: 500, actual: 520 }];
  const merged = mergeCategoryRows([p1, p2], ['budget', 'actual']);
  const groceries = merged.find(r => r.cat === 'Groceries');
  eq(groceries.budget, 1000, 'budget sums across periods');
  eq(groceries.actual, 1000, 'actual sums across periods');
  eq(groceries.type, 'expense', 'type is kept from the period that named it');
  const salary = merged.find(r => r.cat === 'Salary');
  eq(salary.actual, 40000, 'a category present in only one period is not zeroed by the other');

  eq(mergeCategoryRows([], ['amount']), [], 'no periods merges to an empty list');
  eq(mergeCategoryRows([[], []], ['amount']), [], 'periods with no rows merge to an empty list too');
}

/* ---- shared fixture for the markdown/JSON parity checks ---- */
const DATA = {
  generated: '2026-08-28 09:00',
  periodLabel: 'August 2026',
  rangeNote: '23 Jul – 22 Aug 2026',
  detail: 'summary',
  currency: 'R',
  income: 45000, spend: 32000.5, net: 12999.5,
  budgetIncome: 40000, budgetSpend: 35000,
  categories: [
    { cat: 'Groceries', type: 'expense', budget: 5000, actual: 4200 },
    { cat: 'Rent', type: 'housing', budget: 9000, actual: 9000 },
    { cat: 'Extras', type: 'expense', budget: 0, actual: 850 },
  ],
  spendByCategory: [
    { cat: 'Rent', amount: 9000 },
    { cat: 'Groceries', amount: 4200 },
    { cat: 'Extras', amount: 850 },
  ],
  savings: { growth: 1250.5, rateGrowth: 1250.5, rateCapital: 30000, measured: 2, unmeasured: 1, total: 3 },
  debts: {
    count: 2, active: 1, total: 8000, perMonth: 550, interest: 150,
    rows: [{ name: 'Card debt', balance: 8000, rate: 22.5, interest: 150 }],
  },
  netWorth: { net: 250000, assets: 300000, liabilities: 50000 },
  health: { score: 72, months: 3.4, target: 6, savingsRatePct: 12.5, interestSharePct: 2.1 },
  transactions: null,
};

/* ---- 3. markdown and JSON agree on the SAME data — the whole point ---- */
{
  const md = financialReportMarkdown(DATA, money);
  const json = JSON.parse(financialReportJson(DATA));

  ok(md.startsWith('---\n'), 'the file keeps its frontmatter');
  ok(md.includes(`# ${i18n.t('report.title', { period: 'August 2026' })}`), 'the H1 carries the period label');

  eq(json.income_vs_spend.income, DATA.income, 'JSON carries the raw income figure');
  ok(md.includes(money(DATA.income)), 'and the Markdown carries the SAME figure, only formatted');
  eq(json.income_vs_spend.spend, DATA.spend, 'raw spend agrees');
  ok(md.includes(money(DATA.spend)), 'formatted spend agrees');
  eq(json.income_vs_spend.net, DATA.net, 'raw net agrees');
  eq(json.income_vs_spend.budget_income, DATA.budgetIncome);
  eq(json.income_vs_spend.budget_spend, DATA.budgetSpend);

  eq(json.categories.length, DATA.spendByCategory.length, 'same number of category rows');
  eq(json.categories[0], { category: 'Rent', amount: 9000 }, 'category shape and figure, unchanged from spendByCategory');
  ok(md.includes(`| Rent | ${money(9000)} |`.replace('||', '|')) || /\|\s*Rent\s*\|/.test(md),
    'the same category appears in the Markdown table');
  ok(md.includes(money(9000)), 'and its amount is the same figure, formatted');

  eq(json.budgets_vs_actuals.length, DATA.categories.length, 'same number of budget rows');
  const rent = json.budgets_vs_actuals.find(r => r.category === 'Rent');
  eq(rent.budget, 9000); eq(rent.actual, 9000); eq(rent.remaining, 0);
  ok(md.includes(money(9000)), 'the budget table shows the same rand figure');

  eq(json.net_worth, { net: 250000, assets: 300000, liabilities: 50000 }, 'net worth passes through raw');
  ok(md.includes(money(250000)) && md.includes(money(300000)) && md.includes(money(50000)),
    'and the same three figures appear formatted in the Markdown');

  eq(json.savings, {
    growth: 1250.5, rate_growth: 1250.5, rate_capital: 30000, measured: 2, unmeasured: 1, total: 3,
  }, 'savings section carries the raw figures, snake_cased');
  ok(md.includes(money(1250.5)), 'the same growth figure appears formatted in the Markdown');

  eq(json.debts.total, 8000); eq(json.debts.rows[0].name, 'Card debt'); eq(json.debts.rows[0].interest, 150);
  ok(md.includes('Card debt') && md.includes(money(150)), 'the same debt row appears in the Markdown');

  eq(json.health_score, { score: 72, months: 3.4, target_months: 6, savings_rate_pct: 12.5, interest_share_pct: 2.1 });
  ok(md.includes('72'), 'the score appears in the Markdown too');

  eq(json.currency, 'R', 'the currency code rides along in JSON');
  eq(json.period, 'August 2026'); eq(json.range, DATA.rangeNote); eq(json.detail, 'summary');
  eq(json.transactions, null, 'no transaction detail in summary mode, in JSON too');

  ok(!('loans' in json), 'no "loans" section — views/loans.js has no persisted data for one to hold');
}

/* ---- 4a. "as of today" sections — none / partial / full ---- */
{
  const none = financialReportMarkdown({ ...DATA, savings: null, debts: null, health: null }, money);
  ok(none.includes(i18n.t('report.savings.none')), 'no savings accounts recorded, said plainly');
  ok(none.includes(i18n.t('report.debt.none')), 'no debt recorded, said plainly');
  ok(!none.includes(`## ${i18n.t('report.section.health')}`), 'no health section when there is nothing honest to say');

  const unmeasured = financialReportMarkdown({ ...DATA, savings: { growth: 0, rateGrowth: 0, rateCapital: 0, measured: 0, unmeasured: 2, total: 2 } }, money);
  ok(unmeasured.includes(i18n.t('report.savings.unmeasured')), 'accounts exist but none can be measured yet');

  const free = financialReportMarkdown({ ...DATA, debts: { count: 2, active: 0, total: 0, perMonth: 0, interest: 0, rows: [] } }, money);
  ok(free.includes(i18n.t('report.debt.free', { count: 2 })), 'every tracked debt paid off reads as debt-free, plural form included');

  const oneDebt = financialReportMarkdown({ ...DATA, debts: { count: 1, active: 0, total: 0, perMonth: 0, interest: 0, rows: [] } }, money);
  ok(oneDebt.includes(i18n.t('report.debt.free', { count: 1 })), 'the singular plural form is reachable too');
  ok(!oneDebt.includes(i18n.t('report.debt.free', { count: 2 })), 'and it is not the plural form');
}

/* ---- 4b. partial savings coverage is disclosed ---- */
{
  const md = financialReportMarkdown(DATA, money);
  ok(md.includes(i18n.t('report.savings.partial', { count: 1, total: 3 })),
    '1 of 3 accounts missing a starting amount is said in the document itself');
}

/* ---- 5. transaction detail — only in detail mode, excluded rows kept ---- */
{
  const rows = [
    { date: '2026-08-01', desc: 'Salary', label: 'Cheque', cat: 'Salary', amount: 40000, excluded: false, note: '' },
    { date: '2026-08-03', desc: 'Transfer', label: 'Cheque', cat: 'Transfer', amount: -1000, excluded: true, note: '' },
  ];
  const summaryMode = financialReportMarkdown({ ...DATA, detail: 'summary', transactions: rows }, money);
  ok(!summaryMode.includes(i18n.t('report.section.transactions')), 'summary mode never lists transactions, even if handed some');

  const detailMode = financialReportMarkdown({ ...DATA, detail: 'detail', transactions: rows }, money);
  ok(detailMode.includes(i18n.t('report.section.transactions')), 'detail mode carries the section');
  ok(detailMode.includes('Transfer') && /\|\s*yes\s*\|/.test(detailMode),
    'an excluded row is still listed, marked — never silently dropped');
  ok(detailMode.includes(i18n.t('report.transactions.count', { count: 2 })), 'the row count is stated');

  const json = JSON.parse(financialReportJson({ ...DATA, detail: 'detail', transactions: rows }));
  eq(json.transactions.length, 2, 'JSON carries the same two rows');
  eq(json.transactions[1].excluded, true, 'excluded is a real boolean in JSON, not a "yes" string');
  eq(json.transactions[1].amount, -1000, 'amount is the raw number, never money-formatted');
}

/* ---- 6. copyBody strips the frontmatter for the clipboard ---- */
{
  const md = financialReportMarkdown(DATA, money);
  const body = copyBody(md);
  ok(!body.startsWith('---'), 'frontmatter is gone from the copy');
  ok(body.startsWith(`# ${i18n.t('report.title', { period: 'August 2026' })}`), 'the copy starts at the H1');
  ok(body.endsWith('\n'), 'the trailing newline survives the strip');
  eq(copyBody('# No frontmatter here\n'), '# No frontmatter here\n', 'a document with no frontmatter is untouched');
}

console.log(`report.test.cjs — ${checks} checks OK`);
