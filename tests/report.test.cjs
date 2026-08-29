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
     8. H2 (2026-08-29 audit) — the ROW COUNT of every rendered table is
        pinned, not just membership. `md.includes(...)` survives a serialiser
        that drops the LAST row of a table (proven in the audit: mutating
        budgetTable/categoryTable to iterate `rows.slice(0, -1)` left this
        file's old assertions green). tableBodyRows() below counts the real
        `|`-prefixed data lines under a heading, and one block asserts a
        byte-exact table — the two together are what a slice(0,-1) mutation
        actually fails on (re-proven at the end of this file's own review by
        applying the exact mutation and watching it go red).
     9. C2 (2026-08-29 audit) — the category-spend table used to sum to
        100% while silently leaving out uncategorised spend and refunds
        netted off inside their own category, and an ORPHANED category (no
        matching Categories/ file) printed as an ordinary, unmarked row. The
        `categoryGap` figures and each row's `orphaned` flag are pinned in
        BOTH the Markdown prose and the JSON schema.
    10. H1 (2026-08-29 audit) — Budget vs Actual carries a Type column and
        preserves whatever order the caller handed it (views/report.js sorts
        by typeRank before calling in), so an income row beating its budget
        and a transfer row that never accumulates an actual are both
        readable instead of indistinguishable from an overspend.
    11. M1 (2026-08-29 audit, Phase 3) — managedFolderMatch() refuses a
        report destination that resolves inside one of load.js's own managed
        subfolders (Categories/, Accounts/, Budgets/, Plans/, Tax/,
        Transactions/, Notes/), segment-by-segment off the budget folder, the
        reproduction the audit verified directly ("Budget/Categories" —> the
        generated report is parsed back in as a category on the next load).
    12. R5 (2026-08-29 audit, Phase 3) — Budget vs Actual now marks an
        orphaned category the same way Spend by Category already did (C2),
        and a report spanning more than one period with at least one such
        row carries a caveat that the row MIGHT be a category renamed
        mid-selection — never claiming more certainty than the data actually
        gives (see src/report.js's own R5 comment for why a real merge across
        a rename was judged unsafe to attempt). Gated correctly both ways:
        absent on a single period, absent with nothing orphaned to explain.

   Pure — no DOM, no obsidian, no vault. */

const assert = require('assert');
const {
  REPORT_DIR, REPORT_SPLIT_SLICES, reportPaths, mergeCategoryRows, managedFolderMatch,
  prepareReportData, financialReportMarkdown, financialReportJson, copyBody,
} = require('../src/report');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

i18n.setLanguage('en');
const money = v => `R ${v < 0 ? '-' : ''}${Math.abs(v).toFixed(2)}`;

/* The real data-row lines Markdown renders under a `## Heading` — everything
   between its divider (`|---…`) and the next blank line. Excludes the header
   row itself (the divider is the marker for "table starts here"), so its
   length is exactly the number of RECORDS financialReportMarkdown was handed,
   which is the assertion H2 needed and `md.includes(...)` could never make. */
function tableBodyRows(md, heading) {
  const lines = md.split('\n');
  const hIdx = lines.indexOf(`## ${heading}`);
  assert.ok(hIdx >= 0, `section "${heading}" not found in the document`);
  const rest = lines.slice(hIdx + 1);
  const dividerIdx = rest.findIndex(l => l.startsWith('|---'));
  if (dividerIdx === -1) return [];   // no table rendered — an empty-state line instead
  const body = [];
  for (let i = dividerIdx + 1; i < rest.length; i++) {
    if (!rest[i].startsWith('|')) break;
    body.push(rest[i]);
  }
  return body;
}

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

/* ---- 1b. M1 (2026-08-29 audit): managedFolderMatch — the folder guard ----
   Reproduction the audit verified directly: set the destination to
   "Budget/Categories" and a generated report is parsed back in as an
   ordinary category on the next vault load. This pins the pure predicate
   views/report.js's renderReport()/createReport() both call before writing
   — see src/report.js's own header on this function for the managed-name
   list and why it is deliberately blunt rather than precise about depth. */
{
  const budgetFolder = 'Budget';
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Categories').dir, budgetFolder), 'Categories',
    'THE REPRODUCTION: a report folder resolving straight into Categories/ is caught');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Accounts').dir, budgetFolder), 'Accounts', 'Accounts/ too');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Budgets').dir, budgetFolder), 'Budgets', 'Budgets/ too');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Plans').dir, budgetFolder), 'Plans', 'Plans/ too');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Tax').dir, budgetFolder), 'Tax', 'Tax/ too');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Transactions').dir, budgetFolder), 'Transactions', 'Transactions/ too');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Notes').dir, budgetFolder), 'Notes', 'Notes/ too');
  // Deliberately blunt: any depth under a managed name is refused, not just
  // the exact folder mdFilesIn() itself reads (see this function's own
  // header in src/report.js for why "this nested path happens to be safe
  // today" is not a reason trusted here).
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/Categories/Sub').dir, budgetFolder), 'Categories',
    'nested under a managed name is caught too, even though it is not literally what mdFilesIn reads');

  // Negative controls — the guard must not be trigger-happy.
  eq(managedFolderMatch(reportPaths('Aug 2026', undefined).dir, budgetFolder), null, 'the default Reports/ folder is never flagged');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/MyReports').dir, budgetFolder), null,
    'an unrelated folder INSIDE the budget folder is not flagged — only the seven managed names are');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget/CategoriesOfSpending').dir, budgetFolder), null,
    'a folder name that merely STARTS WITH a managed name is not a prefix-match false positive');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Categories').dir, 'Budget'), null,
    'a folder named "Categories" OUTSIDE the budget folder entirely is not the same thing and is not flagged');
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Budget').dir, 'Budget'), null,
    'the budget folder itself, with nothing after it, is not a managed subfolder');

  // A budget folder that is itself nested — the segment-by-segment
  // comparison must still line up rather than false-negative on depth.
  eq(managedFolderMatch(reportPaths('Aug 2026', 'Finances/Budget/Categories').dir, 'Finances/Budget'), 'Categories',
    'a multi-segment budget folder still catches its own managed subfolders');
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
    { cat: 'Rent', amount: 9000, orphaned: false },
    { cat: 'Groceries', amount: 4200, orphaned: false },
    { cat: 'Extras', amount: 850, orphaned: false },
  ],
  categoryGap: { uncat: 0, netted: 0 },
  savings: { growth: 1250.5, rateGrowth: 1250.5, rateCapital: 30000, measured: 2, unmeasured: 1, negCapital: 1, total: 3 },
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
  /* L4, 2026-08-29 audit (Phase 4b) — `percent` is prepareReportData()'s
     largest-remainder share, the SAME figure the Markdown table's own %
     column prints below — never a second, independent Math.round() a JSON
     consumer would otherwise have had to write themselves. */
  eq(json.categories[0], { category: 'Rent', amount: 9000, percent: 64, orphaned: false },
    'category shape and figure, unchanged from spendByCategory, now carrying L4\'s percent too');
  ok(md.includes(`| Rent | ${money(9000)} |`.replace('||', '|')) || /\|\s*Rent\s*\|/.test(md),
    'the same category appears in the Markdown table');
  ok(md.includes(money(9000)), 'and its amount is the same figure, formatted');
  ok(md.includes('| Rent | ' + money(9000) + ' | 64% |'), 'the SAME 64% appears in the Markdown row, not a second rounding of it');

  eq(json.budgets_vs_actuals.length, DATA.categories.length, 'same number of budget rows');
  const rent = json.budgets_vs_actuals.find(r => r.category === 'Rent');
  eq(rent.budget, 9000); eq(rent.actual, 9000); eq(rent.remaining, 0);
  ok(md.includes(money(9000)), 'the budget table shows the same rand figure');

  eq(json.net_worth, { net: 250000, assets: 300000, liabilities: 50000 }, 'net worth passes through raw');
  ok(md.includes(money(250000)) && md.includes(money(300000)) && md.includes(money(50000)),
    'and the same three figures appear formatted in the Markdown');

  eq(json.savings, {
    growth: 1250.5, rate_growth: 1250.5, rate_capital: 30000, rate_pct: (1250.5 / 30000) * 100,
    measured: 2, unmeasured: 1, neg_capital: 1, total: 3,
  }, 'savings section carries the raw figures, snake_cased, including M4\'s neg_capital and L4\'s rate_pct');
  ok(md.includes(money(1250.5)), 'the same growth figure appears formatted in the Markdown');
  /* L4 — the Markdown row rounds rate_pct to one decimal for display only;
     the raw figure above is the one JSON carries, unrounded. */
  ok(md.includes(`+${((1250.5 / 30000) * 100).toFixed(1)}%`),
    'the Markdown\'s displayed rate is the SAME ratio JSON\'s rate_pct carries, just formatted');

  /* P2 (2026-08-29 audit) — the not-financial-advice line rides in both
     formats, and the health score carries its own honest gloss in both too. */
  ok(md.includes(i18n.t('report.disclaimer')), 'the Markdown carries the not-financial-advice line');
  eq(json.disclaimer, i18n.t('report.disclaimer'), 'the JSON carries the identical sentence, not a second wording of it');
  ok(md.includes(i18n.t('report.health.note')), 'the Markdown glosses what the health score is and is not');
  eq(json.health_score.note, i18n.t('report.health.note'), 'the JSON health_score carries the same gloss');

  /* M4 (2026-08-29 audit) — a drawn-down savings/investment account is
     disclosed the same way views/savings.js's own growthTile() already
     discloses it beside itself, not silently dropped from the report. */
  ok(md.includes(i18n.t('report.savings.negCapital', { count: 1, total: 3 })),
    'a drawn-down account excluded from the rate is disclosed in the document itself');

  eq(json.debts.total, 8000); eq(json.debts.rows[0].name, 'Card debt'); eq(json.debts.rows[0].interest, 150);
  ok(md.includes('Card debt') && md.includes(money(150)), 'the same debt row appears in the Markdown');

  eq(json.health_score, {
    score: 72, months: 3.4, target_months: 6, savings_rate_pct: 12.5, interest_share_pct: 2.1,
    note: i18n.t('report.health.note'),
  });
  ok(md.includes('72'), 'the score appears in the Markdown too');

  eq(json.currency, 'R', 'the currency code rides along in JSON');
  eq(json.period, 'August 2026'); eq(json.range, DATA.rangeNote); eq(json.detail, 'summary');
  eq(json.transactions, null, 'no transaction detail in summary mode, in JSON too');

  ok(!('loans' in json), 'no "loans" section — views/loans.js has no persisted data for one to hold');

  /* H2's actual fix: a ROW COUNT, not membership. This is the assertion the
     audit's slice(0, -1) mutation on either table function turns red — every
     `ok(md.includes(...))` above it stays green even with the last row
     silently dropped, because the row it checks for is never the one that
     went missing. */
  eq(tableBodyRows(md, i18n.t('report.section.category')).length, DATA.spendByCategory.length,
    'every category row is rendered — none silently dropped');
  eq(tableBodyRows(md, i18n.t('report.section.budgetActual')).length, DATA.categories.length,
    'every budget row is rendered — none silently dropped');
}

/* ---- 3b. H2: one byte-exact table block, mutation-proofed ----
   Row count alone would not catch a REORDERED row (typeRank in H1's own
   fix), so this pins the literal rendered lines for a small, hand-checked
   fixture — income, transfer and expense together, plus a two-row category
   table with one orphaned entry — rather than a larger DATA blob where a
   single wrong row is easy to miss reading the assertion. */
{
  const small = {
    ...DATA,
    categories: [
      { cat: 'Salary', type: 'income', budget: 40000, actual: 45000 },
      { cat: 'Move to savings', type: 'transfer', budget: 10000, actual: 0 },
      { cat: 'Groceries', type: 'expense', budget: 5000, actual: 1200 },
    ],
    spendByCategory: [
      { cat: 'Groceries', amount: 1200, orphaned: false },
      { cat: 'GoneCategory', amount: 300, orphaned: true },
    ],
    categoryGap: { uncat: 900, netted: 50 },
  };
  const md = financialReportMarkdown(small, money);
  const json = JSON.parse(financialReportJson(small));

  /* H1 — the Type column, and typeRank order preserved exactly as handed
     in (an income row over budget and a transfer row with a zero actual are
     both readable now, not indistinguishable from an overspend). */
  const expectedBudget = [
    `| ${i18n.t('report.col.category')} | ${i18n.t('report.col.type')} | ${i18n.t('report.col.budget')} | ${i18n.t('report.col.actual')} | ${i18n.t('report.col.remaining')} |`,
    '|---|---|---:|---:|---:|',
    `| Salary | income | ${money(40000)} | ${money(45000)} | ${money(-5000)} |`,
    `| Move to savings | transfer | ${money(10000)} | ${money(0)} | ${money(10000)} |`,
    `| Groceries | expense | ${money(5000)} | ${money(1200)} | ${money(3800)} |`,
  ].join('\n');
  ok(md.includes(expectedBudget),
    'Budget vs Actual is byte-exact: income over budget reads -5000 next to "income" — not a bare, ambiguous overspend — ' +
    'and the transfer row is visibly a transfer, not a category nothing was spent on');

  /* C2 — the orphaned row is marked, in order, amounts unchanged. */
  const expectedCategory = [
    `| ${i18n.t('report.col.category')} | ${i18n.t('report.col.amount')} | ${i18n.t('report.col.percent')} |`,
    '|---|---:|---:|',
    `| Groceries | ${money(1200)} | 80% |`,
    `| GoneCategory * | ${money(300)} | 20% |`,
  ].join('\n');
  ok(md.includes(expectedCategory), 'Spend by Category is byte-exact: the orphaned row is marked with *');

  eq(tableBodyRows(md, i18n.t('report.section.budgetActual')).length, 3, 'three budget rows, none dropped, none duplicated');
  eq(tableBodyRows(md, i18n.t('report.section.category')).length, 2, 'two category rows, none dropped, none duplicated');

  eq(json.budgets_vs_actuals, [
    { category: 'Salary', type: 'income', budget: 40000, actual: 45000, remaining: -5000, orphaned: false },
    { category: 'Move to savings', type: 'transfer', budget: 10000, actual: 0, remaining: 10000, orphaned: false },
    { category: 'Groceries', type: 'expense', budget: 5000, actual: 1200, remaining: 3800, orphaned: false },
  ], 'JSON carries the same three rows, same order, same type field the Markdown just proved — plus R5\'s orphaned flag, false here');
  eq(json.categories, [
    { category: 'Groceries', amount: 1200, percent: 80, orphaned: false },
    { category: 'GoneCategory', amount: 300, percent: 20, orphaned: true },
  ], 'JSON marks the orphaned row too, and carries the SAME 80/20 the Markdown table above just proved — the two formats are equally interpretable');
}

/* ---- 3d. R5: Budget vs Actual marks orphaned rows too, and the rename
   caveat only ever appears when it could actually apply ----

   R5 in the 2026-08-29 audit: mergeCategoryRows keys on the category's
   display string, and a rename mid-selection genuinely splits one category
   into two rows with no stable identity to merge them back on (see
   src/report.js's own R5 comment for why a real merge was judged unsafe to
   guess at). This pins the disclosure that shipped instead: the SAME
   orphaned marker "Spend by Category" already had (C2) now also applies to
   "Budget vs Actual", and a caveat explaining what a `*` MIGHT mean prints
   only when it is possible for R5 to have happened at all — more than one
   period merged, AND at least one row is actually marked. */
{
  const oneOrphanedBudget = {
    ...DATA,
    periodCount: 2,
    categories: [
      { cat: 'OldName', type: 'expense', budget: 0, actual: 300, orphaned: true },
      { cat: 'Rent', type: 'housing', budget: 9000, actual: 9000, orphaned: false },
    ],
    spendByCategory: [],
    categoryGap: { uncat: 0, netted: 0 },
  };
  const md = financialReportMarkdown(oneOrphanedBudget, money);
  const json = JSON.parse(financialReportJson(oneOrphanedBudget));

  const expectedBudget = [
    `| ${i18n.t('report.col.category')} | ${i18n.t('report.col.type')} | ${i18n.t('report.col.budget')} | ${i18n.t('report.col.actual')} | ${i18n.t('report.col.remaining')} |`,
    '|---|---|---:|---:|---:|',
    `| OldName * | expense | — | ${money(300)} | ${money(-300)} |`,
    `| Rent | housing | ${money(9000)} | ${money(9000)} | ${money(0)} |`,
  ].join('\n');
  ok(md.includes(expectedBudget), 'Budget vs Actual is byte-exact: an orphaned row is marked * the same way Spend by Category already marks one');
  ok(md.includes(i18n.t('report.category.orphaned', { names: 'OldName' })),
    'the orphaned name under Budget vs Actual is named in prose, not just a bare *, same as the category table');
  ok(md.includes(i18n.t('report.category.renameCaveat')),
    'periodCount > 1 AND an orphaned row present — the rename caveat is shown');

  eq(json.budgets_vs_actuals.find(r => r.category === 'OldName').orphaned, true, 'JSON carries the same orphaned flag');
  eq(json.period_count, 2, 'JSON carries the raw period count the Markdown caveat gated on');

  const singlePeriod = financialReportMarkdown({ ...oneOrphanedBudget, periodCount: 1 }, money);
  ok(!singlePeriod.includes(i18n.t('report.category.renameCaveat')),
    'a single-period report can never exhibit R5 (nothing to split across) — no caveat, even with an orphaned row present');

  const noOrphans = financialReportMarkdown({ ...DATA, periodCount: 3, categories: DATA.categories.map(r => ({ ...r, orphaned: false })), spendByCategory: DATA.spendByCategory.map(r => ({ ...r, orphaned: false })) }, money);
  ok(!noOrphans.includes(i18n.t('report.category.renameCaveat')),
    'more than one period but nothing orphaned — the caveat would have nothing to explain, so it does not print');
}

/* ---- 3c. C2: the uncategorised / netted gap, and the orphaned-name line ---- */
{
  const gapData = {
    ...DATA,
    spendByCategory: [
      { cat: 'Groceries', amount: 1200, orphaned: false },
      { cat: 'GoneCategory', amount: 300, orphaned: true },
    ],
    categoryGap: { uncat: 900, netted: 50 },
  };
  const md = financialReportMarkdown(gapData, money);
  const json = JSON.parse(financialReportJson(gapData));

  ok(md.includes(i18n.t('report.category.uncat', { amount: money(900) })),
    'the uncategorised gap is stated in the document itself, the same fact the Dashboard donut discloses beside it');
  ok(md.includes(i18n.t('report.category.netted', { amount: money(50) })),
    'the netted-refund gap is stated too');
  ok(md.includes(i18n.t('report.category.orphaned', { names: 'GoneCategory' })),
    'the orphaned category name is named, not just marked with an unexplained *');

  eq(json.category_gap, { uncategorised: 900, netted: 50 }, 'the same two figures ride in JSON, snake_cased');

  /* A period that is ENTIRELY uncategorised spend has no rows to show at
     all — spendByCategory only ever holds recognised, non-transfer,
     non-income categories — so "No spending recorded" would flatly
     contradict the gap note underneath it. */
  const allGap = { ...DATA, spendByCategory: [], categoryGap: { uncat: 500, netted: 0 } };
  const allGapMd = financialReportMarkdown(allGap, money);
  ok(!allGapMd.includes(i18n.t('report.category.empty')),
    'a period that spent every rand, all of it uncategorised, must not say "No spending recorded"');
  ok(allGapMd.includes(i18n.t('report.category.uncat', { amount: money(500) })),
    'the gap note explains where the spend actually went instead');

  const trulyEmpty = { ...DATA, spendByCategory: [], categoryGap: { uncat: 0, netted: 0 } };
  ok(financialReportMarkdown(trulyEmpty, money).includes(i18n.t('report.category.empty')),
    'a genuinely empty period (no spend, no gap) still says so');
}

/* ---- 3e. L1/L4 (2026-08-29 audit, Phase 4b) — the percent-column caveat
   and prepareReportData()'s single source of truth ---- */
{
  /* L1 — the caveat only prints past REPORT_SPLIT_SLICES (=8) spend rows,
     the same threshold the Dashboard donut collapses its tail at. Built
     from REPORT_SPLIT_SLICES itself rather than a hardcoded "9" — this test
     is pinned to the CONSTANT's contract ("past this many rows the caveat
     appears"), not to today's value of it. */
  eq(REPORT_SPLIT_SLICES, 8, 'the constant this test (and the Dashboard donut) both key off');
  const manyRows = n => Array.from({ length: n }, (_, i) => ({ cat: `Cat${i}`, amount: 100, orphaned: false }));

  const atLimit = financialReportMarkdown({ ...DATA, spendByCategory: manyRows(REPORT_SPLIT_SLICES) }, money);
  ok(!atLimit.includes(i18n.t('report.category.percentNote', { count: REPORT_SPLIT_SLICES })),
    `exactly ${REPORT_SPLIT_SLICES} rows — the Dashboard donut would not have collapsed anything yet, so no caveat`);

  const overLimit = financialReportMarkdown({ ...DATA, spendByCategory: manyRows(REPORT_SPLIT_SLICES + 1) }, money);
  ok(overLimit.includes(i18n.t('report.category.percentNote', { count: REPORT_SPLIT_SLICES })),
    `THE L1 FIX: ${REPORT_SPLIT_SLICES + 1} rows — past the Dashboard donut's own collapse point — states the caveat`);

  const few = financialReportMarkdown({ ...DATA, spendByCategory: manyRows(2) }, money);
  ok(!few.includes(i18n.t('report.category.percentNote', { count: REPORT_SPLIT_SLICES })),
    'well under the limit — no caveat, nothing to explain');

  /* L4 — prepareReportData() is the ONE place `pct`/`rate` are computed;
     financialReportMarkdown()/financialReportJson() each call it themselves
     rather than trusting a caller to have done so, so a bare fixture (this
     file's own DATA, never built through views/report.js's buildReportData)
     still gets correct figures — pinned directly, not just observed as a
     side effect of the earlier assertions. */
  const prepared = prepareReportData(DATA);
  eq(prepared.spendByCategory.map(r => r.pct), [64, 30, 6], 'the exact largest-remainder split categoryTable prints, computed once');
  eq(prepared.savings.rate, (1250.5 / 30000) * 100, 'the exact ratio the savings section prints, computed once');

  /* rate is null exactly when the Markdown row is omitted (rateCapital <= 0
     — every measured account drawn down), never 0 or NaN — the same
     "null means honestly unknown, not zero" rule this codebase applies
     everywhere else (see CLAUDE.md / null-vs-zero.test.cjs). */
  const drawnDown = prepareReportData({ ...DATA, savings: { growth: -500, rateGrowth: 0, rateCapital: 0, measured: 1, unmeasured: 0, negCapital: 1, total: 1 } });
  eq(drawnDown.savings.rate, null, 'a fully drawn-down savings book has no rate to state, in JSON as much as in Markdown');
  const drawnDownJson = JSON.parse(financialReportJson({ ...DATA, savings: { growth: -500, rateGrowth: 0, rateCapital: 0, measured: 1, unmeasured: 0, negCapital: 1, total: 1 } }));
  eq(drawnDownJson.savings.rate_pct, null, 'and the JSON sibling carries the identical null, not 0 or NaN');

  // Idempotent and called from both formats independently — running it twice
  // on the SAME input produces byte-identical output, which is the whole
  // reason calling it from each serialiser separately is safe.
  eq(prepareReportData(DATA), prepareReportData(DATA), 'prepareReportData is pure: same input, same output, every time');
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
