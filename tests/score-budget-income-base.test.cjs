'use strict';
/* On the Score, a figure measured against BUDGET income says so, and the
   net-worth multiple prints the income it divides by (2026-10-20 audit, M1-05).

   "worth N years of income" divided by budget income — the Dashboard's
   figure, Excluded windfalls out (health-math.js healthMetrics, the 29 Sep 2026
   decision). The only income the page printed was HOUSEHOLD income, in the
   Spending row, about a fifth larger on the audited vault; a reader checking
   the arithmetic against it got a multiple a fifth smaller. The saving and debt lines
   divide by budget income too and said only "of income".

   The rule now: the net-worth line names its base and prints it ("worth 2,4
   years of budget income (R X a month)"), so printed net worth ÷ (12 × printed
   income) is the printed multiple; the saving and debt lines, and the two gap
   sentences built on budget income, say "budget income". The comment in
   health-data.js that claimed the debt and net-worth shares keep household
   scope is corrected (only the two spending shares do).

   Rendered through the REAL loader and views/score.js, clock pinned. Synthetic
   household with an Excluded windfall, so the two incomes differ, and a rated
   debt, so the debt line prints.

     node tests/score-budget-income-base.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock } = require('./helpers/figures.cjs');
const { descend, readable } = require('./helpers/dom-stub.cjs');
const { sharePercentLabel } = require('../src/share-percents');
const { FULL_MARKS } = require('../src/health-math');
const i18n = require('./helpers/dom-stub.cjs').readingI18n(require('../src/i18n'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b} ± ${tol})`); checks++; };

const B = 'Budget';
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const table = rows => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |  |`).join('\n') + '\n';
const files = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ninput_mode: manual\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Windfall.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: housing\nfixed: true\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 60000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  [`${B}/Accounts/Emergency Fund.md`]: '---\ntype: savings\nbalance: 50000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\ntx_label: "Emergency Fund"\n---\n',
  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n'
    + '| Card | Bank | credit card | 20000.00 | 25000.00 | 20.00 | 1000.00 | 0.00 | 2025-01-01 | | active | | |\n',
};
/* 40 000 of salary every month and a 30 000 payout in one month, marked
   Excluded: budget income averages 40 000, household income 45 000. */
for (const m of MONTHS) {
  const rows = [[`${m}-01`, 'Salary', 'Salary', 40000], [`${m}-02`, 'Landlord', 'Rent', -10000], [`${m}-05`, 'Checkers', 'Groceries', -25000]];
  if (m === '2026-04') rows.push([`${m}-20`, 'Payout', 'Windfall', 30000, 'yes']);
  files[`${B}/Transactions/Cheque/${m}.md`] = table(rows);
}

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? readable(e.textContent) : '');
const randOf = t => Number(String(t).replace(/[^\d]/g, ''));

(async () => {
  for (const k of ['score.now.wealthBase', 'score.gap.fixMonthly', 'score.gap.fixBuild']) ok(i18n.t(k) !== k, `en.js carries ${k}`);
  /* Pinned for the whole run: healthSnapshot() below reads the clock too. */
  const unpin = pinClock('2026-08-15');
  process.on('exit', unpin);
  const { ctx, nodes } = await mountFor(files, { period: '2026-08' });
  ctx.switchView = () => {};
  ctx.renderScore();
  const M = ctx.healthSnapshot().metrics;
  near(M.monthlyIncome, 40000, 0.005, 'fixture check: budget income leaves the Excluded payout out');
  near(M.monthlyHouseholdIncome, 45000, 0.005, 'fixture check: household income keeps it');
  ok(M.netWorthMultiple !== null && M.interestShare !== null && M.savingsRate !== null, 'fixture check: wealth, debt and saving all measured');
  const hero = nodes.get('#scoreHero');
  const now = key => textOf(descend(descend(hero).find(e => hasCls(e, 'score-ring-row') && e.getAttribute('data-k') === key))
    .find(e => hasCls(e, 'score-ring-row-now')));
  const pct = v => `${sharePercentLabel(v, ctx.locale().decimal)}%`;

  /* ---- 1. the net-worth line names its base, and prints it ------------- */
  const wealth = now('wealth');
  ok(wealth.startsWith(i18n.t('score.now.wealthBase', {
    amount: readable(ctx.money(M.netWorth, 0)), times: '§', income: readable(ctx.money(M.monthlyIncome, 0)),
  }).split('§')[0]), `the wealth line opens with the net worth and "worth" — got: ${wealth}`);
  const m = wealth.match(/worth (\d+(?:,\d+)?) years of budget income \(R ([\d ]+) a month\)/);
  ok(!!m, `"years of budget income (R X a month)" — got: ${wealth}`);
  const times = Number(m[1].replace(',', '.'));
  const printedIncome = randOf(m[2]);
  eq(printedIncome, Math.round(M.monthlyIncome), 'the base printed is budget income, the figure the multiple divides by');
  const printedWorth = randOf(wealth.match(/Now: R ([\d ]+) net worth/)[1]);
  near(times, printedWorth / (12 * printedIncome), 0.05,
    'a reader dividing the printed net worth by twelve printed months gets the printed multiple');
  ok(!/years of income/.test(wealth), 'the unqualified "years of income" is gone');

  /* ---- 2. saving and debt say which income ----------------------------- */
  eq(now('saving'), i18n.t('score.now.saving', { pct: pct(M.savingsRate), amount: readable(ctx.money(M.monthlySavings || 0, 0)) }),
    'the saving line is the saving key');
  ok(/of budget income saved/.test(now('saving')), `the saving share says budget income — got: ${now('saving')}`);
  ok(/of budget income going to interest/.test(now('debt')), `the interest share says budget income — got: ${now('debt')}`);

  /* ---- 3. the gap sentences built on budget income say so -------------- */
  const gapDo = name => textOf(descend(descend(nodes.get('#scoreWork')).filter(e => hasCls(e, 'score-gap'))
    .find(g => textOf(descend(g).find(e => hasCls(e, 'score-gap-name'))) === i18n.t(`dash.health.why.name.${name}`)) || { children: [] })
    .find(e => hasCls(e, 'score-gap-do')));
  const saveGap = gapDo('saving');
  eq(saveGap, i18n.t('score.gap.fixMonthly', {
    amount: readable(ctx.money(FULL_MARKS.savingsRate * M.monthlyIncome - (M.monthlySavings || 0), 0)), pct: Math.round(FULL_MARKS.savingsRate * 100),
  }), 'the saving gap: save R X more to reach 20% of BUDGET income');
  ok(/budget income/.test(saveGap), 'in words');
  const buildGap = gapDo('wealth');
  ok(/years of budget income/.test(buildGap), `the wealth gap names the base too — got: ${buildGap}`);

  /* ---- 4. the stale comment is gone ------------------------------------ */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'health-data.js'), 'utf8');
  ok(!/spending, debt and net-worth shares keep household scope/.test(src),
    'health-data.js no longer claims the debt and net-worth shares divide by household income');

  console.log(`PASS score-budget-income-base (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
