'use strict';
/* On the Score, a share of HOUSEHOLD income says so (2026-10-07 audit, L2a-06).

   One page, two incomes behind the words "of income". The saving share and the
   net-worth multiple divide by BUDGET income — the Dashboard's figure, Excluded
   windfalls out (the 29 Sep 2026 decision: "from our normal income"). The
   fixed-bills and living-costs shares, and the "under 70% of your income" trim,
   divide by HOUSEHOLD income, because their numerators are HOUSEHOLD-lens
   spend, which keeps Excluded rows and accounts outside the budget (pinned by
   tests/lane-int-health-scopes.test.cjs). On the audited vault the household
   base was about a fifth larger, and nothing on screen said which was which.

   The default taken: keep household income for those shares, and NAME it — "of
   household income", with what it holds and how much it is, so a reader holding
   the Dashboard's income figure can see why the percentages do not divide by
   it. The saving line keeps its own wording: it divides by budget income.

   Rendered through the REAL loader and views/score.js, clock pinned. Synthetic
   household with an Excluded windfall, so the two incomes differ.

     node tests/score-household-income-named.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor } = require('./helpers/figures.cjs');
const { descend } = require('./helpers/dom-stub.cjs');
const { atAuditDate } = require('./_audit-seed.cjs');
const { sharePercentLabel } = require('../src/share-percents');
const { FULL_MARKS } = require('../src/health-math');
const i18n = require('../src/i18n');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const B = 'Budget';
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const table = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |  |`).join('\n') + '\n';
const files = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Windfall.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: housing\nfixed: true\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 60000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  [`${B}/Accounts/Emergency Fund.md`]: '---\ntype: savings\nbalance: 50000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\ntx_label: "Emergency Fund"\n---\n',
};
/* 40 000 of salary every month and a 30 000 payout in one month, marked
   Excluded: budget income averages 40 000, household income 45 000. */
for (const m of MONTHS) {
  const rows = [[`${m}-01`, 'Salary', 'Salary', 40000], [`${m}-02`, 'Landlord', 'Rent', -10000], [`${m}-05`, 'Checkers', 'Groceries', -25000]];
  if (m === '2026-04') rows.push([`${m}-20`, 'Payout', 'Windfall', 30000, 'yes']);
  files[`${B}/Transactions/Cheque/${m}.md`] = table(rows);
}

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? e.textContent : '');
const KEYS = ['score.now.fixedHousehold', 'score.now.livingHousehold', 'score.now.householdIncome', 'dash.health.why.fixTrimHousehold'];

atAuditDate(async () => {
  for (const k of KEYS) ok(i18n.t(k) !== k, `en.js carries ${k}`);
  const { ctx, nodes } = await mountFor(files, { period: '2026-08' });
  ctx.renderScore();
  const M = ctx.healthSnapshot().metrics;
  near(M.monthlyIncome, 40000, 'fixture check: budget income leaves the Excluded payout out');
  near(M.monthlyHouseholdIncome, 45000, 'fixture check: household income keeps it');
  near(M.consumptionShare, 35000 / 45000, 'living costs divide by household income, as decided');
  const pct = v => `${sharePercentLabel(v, ctx.locale().decimal)}%`;

  /* ---- 1. the ring's spending row names its base, and its size ---------- */
  const row = descend(nodes.get('#scoreHero')).find(e => hasCls(e, 'score-ring-row') && e.getAttribute('data-k') === 'spending');
  const now = textOf(descend(row).find(e => hasCls(e, 'score-ring-row-now')));
  ok(now.includes(i18n.t('score.now.fixedHousehold', { pct: pct(M.fixedShare) })), `fixed bills are a share of household income — got: ${now}`);
  ok(now.includes(i18n.t('score.now.livingHousehold', { pct: pct(M.consumptionShare) })), `and so are living costs — got: ${now}`);
  ok(now.includes(i18n.t('score.now.householdIncome', { amount: ctx.money(M.monthlyHouseholdIncome, 0) })),
    `and the row says what household income holds, and how much it is — got: ${now}`);
  ok(/household income/i.test(now) && /budget/i.test(i18n.t('score.now.householdIncome', { amount: '' })),
    'in words: "household income", defined against the budget');
  ok(!now.includes(i18n.t('score.now.fixed', { pct: pct(M.fixedShare) })), 'the unqualified "of income" wording is gone from this row');

  /* ---- 2. the saving row keeps budget income, and says "of income" ------ */
  const saving = descend(nodes.get('#scoreHero')).find(e => hasCls(e, 'score-ring-row') && e.getAttribute('data-k') === 'saving');
  const savingNow = textOf(descend(saving).find(e => hasCls(e, 'score-ring-row-now')));
  ok(!/household/i.test(savingNow), `the saving share divides by budget income and does not borrow the household name — got: ${savingNow}`);

  /* ---- 3. the trim says which income the 70% is of ---------------------- */
  const gap = descend(nodes.get('#scoreWork')).filter(e => hasCls(e, 'score-gap'))
    .find(g => textOf(descend(g).find(e => hasCls(e, 'score-gap-name'))) === i18n.t('dash.health.why.name.spending'));
  ok(!!gap, 'the spending pillar is short of full marks here, so it has a gap row');
  const trim = 35000 - FULL_MARKS.consumptionFloor * 45000;
  eq(textOf(descend(gap).find(e => hasCls(e, 'score-gap-do'))),
    i18n.t('dash.health.why.fixTrimHousehold', { amount: ctx.money(trim, 0), pct: Math.round(FULL_MARKS.consumptionFloor * 100) }),
    'the trim: R 3 500 less a month to bring living costs under 70% of HOUSEHOLD income');

  console.log(`PASS score-household-income-named (${checks} checks)`);
}, '2026-08-15').catch(e => { console.error(e); process.exit(1); });
