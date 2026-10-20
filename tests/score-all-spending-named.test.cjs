'use strict';
/* One page, one name per quantity: the Spending row's inclusive measure is "all
   spending", and "Living costs" stays the flow band's (2026-10-20 audit, M1-06).

   The Spending row printed "living costs N% of household income". That figure
   is health-math.js's consumption measure, ledger.js tally's `consumption`:
   every rand of spend bar set-aside, fixed bills INCLUDED. Further down the
   same page the flow card's "Living costs" band is what is left of spend AFTER
   "Committed & fixed bills" and saving (money-flow.js periodFlow), so one name
   stood for two quantities: a band a fraction of income in one place, and
   nearly all of household income in another. The gap advice, "Spend R X less a month on day-to-day living",
   was computed on the inclusive figure too.

   The rule now: the inclusive measure is "all spending (fixed bills included)",
   and the advice says it is spending in all, fixed bills included, that has to
   come down; "Living costs" names only the band.

   Rendered through the REAL loader and views/score.js, clock pinned.

     node tests/score-all-spending-named.test.cjs */
const assert = require('assert');
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
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const B = 'Budget';
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
};
/* Six completed months: 40 000 in, rent 10 000 (fixed) and groceries 25 000
   out, and one 30 000 payout marked Excluded, so household income averages
   45 000. The running month (August): 40 000 in, rent 10 000, groceries 5 000. */
for (const m of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) {
  const rows = [[`${m}-01`, 'Salary', 'Salary', 40000], [`${m}-02`, 'Landlord', 'Rent', -10000], [`${m}-05`, 'Checkers', 'Groceries', -25000]];
  if (m === '2026-04') rows.push([`${m}-20`, 'Payout', 'Windfall', 30000, 'yes']);
  files[`${B}/Transactions/Cheque/${m}.md`] = table(rows);
}
files[`${B}/Transactions/Cheque/2026-08.md`] = table([
  ['2026-08-01', 'Salary', 'Salary', 40000], ['2026-08-02', 'Landlord', 'Rent', -10000], ['2026-08-05', 'Checkers', 'Groceries', -5000],
]);

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const textOf = e => (e ? readable(e.textContent) : '');

(async () => {
  for (const k of ['score.now.allSpendHousehold', 'score.gap.fixTrim']) ok(i18n.t(k) !== k, `en.js carries ${k}`);
  const unpin = pinClock('2026-08-15');
  process.on('exit', unpin);
  const { ctx, nodes } = await mountFor(files, { period: '2026-08' });
  ctx.switchView = () => {};
  ctx.renderScore();
  const M = ctx.healthSnapshot().metrics;
  near(M.monthlyConsumption, 35000, 'fixture check: the measure holds groceries AND the fixed rent');
  near(M.monthlyFixed, 10000, 'fixture check: of which fixed bills');
  near(M.monthlyHouseholdIncome, 45000, 'fixture check: household income');
  const pct = v => `${sharePercentLabel(v, ctx.locale().decimal)}%`;

  /* ---- 1. the Spending row names the inclusive measure for what it is ---- */
  const row = descend(nodes.get('#scoreHero')).find(e => hasCls(e, 'score-ring-row') && e.getAttribute('data-k') === 'spending');
  const now = textOf(descend(row).find(e => hasCls(e, 'score-ring-row-now')));
  ok(now.includes(i18n.t('score.now.allSpendHousehold', { pct: pct(M.consumptionShare) })),
    `all spending, fixed bills included, as a share of household income — got: ${now}`);
  ok(/fixed bills included/.test(i18n.t('score.now.allSpendHousehold', { pct: '' })), 'in words: fixed bills are inside it');
  ok(!/living costs/i.test(now), `"living costs" no longer names it — got: ${now}`);
  const how = textOf(descend(row).find(e => hasCls(e, 'score-ring-row-how')));
  ok(!/living costs/i.test(how), `nor does the line explaining the part — got: ${how}`);

  /* ---- 2. "Living costs" is the flow band, and it leaves fixed bills out -- */
  const view = nodes.get('#view-score');
  const bands = {};
  for (const r of descend(view).filter(e => hasCls(e, 'score-flow-m-row'))) {
    bands[textOf(descend(r).find(e => hasCls(e, 'score-flow-m-name')))] = textOf(descend(r).find(e => hasCls(e, 'score-flow-m-amt')));
  }
  eq(bands[i18n.t('score.flow.living')], readable(ctx.money(5000, 0)), 'the Living costs band is groceries alone, after the fixed rent');
  eq(bands[i18n.t('score.flow.committed')], readable(ctx.money(10000, 0)), 'the rent is its own band');

  /* ---- 3. the advice names what it is computed on ----------------------- */
  const gap = descend(nodes.get('#scoreWork')).filter(e => hasCls(e, 'score-gap'))
    .find(g => textOf(descend(g).find(e => hasCls(e, 'score-gap-name'))) === i18n.t('dash.health.why.name.spending'));
  ok(!!gap, 'the spending pillar is short of full marks here, so it has a gap row');
  const trim = 35000 - FULL_MARKS.consumptionFloor * 45000;
  const said = textOf(descend(gap).find(e => hasCls(e, 'score-gap-do')));
  eq(said, i18n.t('score.gap.fixTrim', { amount: readable(ctx.money(trim, 0)), pct: Math.round(FULL_MARKS.consumptionFloor * 100) }),
    'the trim: R 3 500 less a month, all spending, against 70% of household income');
  ok(!/day-to-day/.test(said) && /fixed bills included/.test(said), `and it says fixed bills are in it — got: ${said}`);

  console.log(`PASS score-all-spending-named (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
