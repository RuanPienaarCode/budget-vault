'use strict';
/* "Budget used" is ONE figure, derived by ONE rule, wherever it is printed.

   The rule, decided on 2026-09-03 (docs/adr/0005-budget-used-is-one-figure.md):

       used = (periodSummary(p).spend − periodSummary(p).setAside) / budgetTotals(p).spend

   — the Dashboard hero's reading. Money moved into the household's own funds
   is not spending, so it comes out of the numerator; the envelopes for that
   money (budgetTotals().setAside) are not "budget to spend", so they are not
   in the denominator. What is left is what the household consumed against
   what it planned to consume.

   Before this file, the same phrase was computed FOUR ways on three pages:
     · the Dashboard hero — the rule above;
     · the Score flow chip — money-flow.js rediscovered set-aside from
       periodSpend()'s NET-by-category map, which only shows a savings-typed
       outflow when the receiving account is out of the budget. Flag the fund
       account `budget: false` and the chip moved from 51% to 38% on the same
       rows; the hero read 38% either way;
     · the Score ring — health-data.js summed that same net map (refunds
       netted, uncategorised dropped), so it differed from the hero by exactly
       those two parts even with a single counted period, which the caption
       under the chip blamed on the six-period window;
     · the Budget page's totals strip — gross spend INCLUDING set-aside, plus
       assumed spend, over envelopes EXCLUDING set-aside: a numerator and a
       denominator built by different rules on one tile.

   The fixture below is built so the four rules disagree: a savings account
   inside the budget (so the contribution's two legs net to zero in the
   category map), a refund inside an expense category, and an uncategorised
   withdrawal. Every printed "used" must be the hero's, to the cent.

     node tests/budget-used-one-rule.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { periodFlow, budgetUsedShare } = require('../src/money-flow');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m) => ok(a !== null && Math.abs(a - b) < 1e-9, `${m} (got ${a}, want ${b})`);

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |\n`).join('')}`;
const P = '2026-07';
const files = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\nfixed: true\n---\n',
  [`${B}/Categories/Emergency.md`]: '---\ntype: savings\ncolor: "#888888"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-07-31\n---\n',
  // IN the budget on purpose: both legs of the contribution are then visible
  // to periodSpend(), and the savings-typed category nets to zero there.
  [`${B}/Accounts/Fund.md`]: '---\ntype: savings\ntx_label: "Fund"\nbalance: 5000.00\nbalance_updated: 2026-07-31\n---\n',
  [`${B}/Budgets/${P}.md`]: '---\ntags: [finance, finance/budget]\n---\n\n| Category | Type | Amount |\n|---|---|---:|\n| Salary | income | 30000.00 |\n| Groceries | expense | 15000.00 |\n| Emergency | savings | 2000.00 |\n',
  [`${B}/Transactions/Cheque/${P}.md`]: txFile([
    ['2026-07-01', 'Salary', 'Salary', 30000],
    ['2026-07-03', 'Woolworths', 'Groceries', -5000],
    ['2026-07-04', 'Woolworths refund', 'Groceries', 400],
    ['2026-07-07', 'Cash withdrawal', '', -700],
    ['2026-07-10', 'To emergency fund', 'Emergency', -2000],
  ]),
  [`${B}/Transactions/Fund/${P}.md`]: txFile([['2026-07-10', 'From cheque', 'Emergency', 2000]]),
};

(async () => {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = P;

  /* ---- 1. the rule, stated once ---------------------------------------- */
  const sum = ctx.periodSummary(P, '2026-09-03');
  const bud = ctx.budgetTotals(P);
  // gross 7 700 (5 000 + 700 + 2 000) less set-aside 2 000, over 15 000
  const HERO = (7700 - 2000) / 15000;
  near(budgetUsedShare({ spend: sum.spend, setAside: sum.setAside, budgeted: bud.spend }), HERO,
    'budgetUsedShare is the Dashboard hero rule: (spend − setAside) / budgeted');
  const one = ctx.budgetUsed(P, { today: '2026-09-03' });
  near(one.used, HERO, 'ctx.budgetUsed(p) hands back the same share');
  near(one.spent, 5700, 'and the numerator it was built from');
  near(one.budgeted, 15000, 'and the denominator');
  near(one.assumed, 0, 'no assume-spent rows here, so no provision');
  near(budgetUsedShare({ spend: 7700, setAside: 2000, assumed: 1500, budgeted: 15000 }), 7200 / 15000,
    'an assume-spent provision joins the numerator — the Budget page\'s tile and the hero agree on it');

  /* ---- 2. the Score flow chip reads it, whatever periodSpend nets ------- */
  const spend = ctx.periodSpend(P, null);
  ok(!('Emergency' in spend.whole),
    'fixture check: the contribution nets to zero in the category map, so the OLD chip rule could not see it');
  const flow = periodFlow({
    income: sum.income, spentTotal: sum.spend, setAsideSpent: sum.setAside, assumedSpent: one.assumed,
    budgeted: bud.spend, budgetSetAside: bud.setAside,
    spendByCat: spend.whole, fixedCats: new Set(['Groceries']), catType: ctx.catType,
    savingContribution: 0, debts: [], household: 'R', budgetIncome: bud.income, periodFinished: true,
  });
  near(flow.budget.budgetUsed, HERO, 'Score flow chip: budgetUsed is the hero figure');
  near(flow.budget.spent, 5700, 'and the rand figure the chip prints beside it is the hero\'s spent');
  const flowNoSetAside = periodFlow({
    income: sum.income, spentTotal: sum.spend,
    budgeted: bud.spend, budgetSetAside: bud.setAside,
    spendByCat: spend.whole, fixedCats: new Set(['Groceries']), catType: ctx.catType,
    savingContribution: 0, debts: [], household: 'R', budgetIncome: bud.income, periodFinished: true,
  });
  near(flowNoSetAside.budget.budgetUsed, 7700 / 15000,
    'a caller that does not say what was set aside gets gross over budget — never a guess from the category map');

  /* ---- 3. the Score ring reads it (one counted period, so no averaging) - */
  ctx.S.period = ctx.currentPeriod();
  const snap = ctx.healthSnapshot();
  ok(snap.metrics.countedPeriods === 1, `fixture check: exactly one counted period (got ${snap.metrics.countedPeriods})`);
  near(snap.metrics.budgetUsed, HERO, 'Score ring: the six-period budgetUsed over one period IS the hero figure');

  /* ---- 4. the pages print it, not a private copy ----------------------- */
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  for (const [f, expr] of [
    ['views/dashboard.js', 'budgetUsed('],
    ['views/budgets.js', 'budgetUsed('],
    ['views/score.js', 'setAsideSpent:'],
    ['health-data.js', 'budgetUsed('],
  ]) {
    ok(src(f).includes(expr), `${f} reaches the one rule (expects "${expr}")`);
  }
  for (const [f, expr] of [
    ['views/budgets.js', 'spent / budgetedSpend'],
    ['money-flow.js', 'consumptionThisPeriod / bud'],
  ]) {
    ok(!src(f).includes(expr), `${f} no longer carries its own copy ("${expr}")`);
  }
  /* The dead seam. Published on ctx, exported, called by nothing; the Budget
     page computed its own assumed figure by a different rule. Gone. */
  ok(!src('period.js').includes('function assumedSpend'), 'period.js: assumedSpend deleted');
  ok(!('assumedSpend' in ctx), 'ctx no longer publishes assumedSpend');

  console.log(`budget-used-one-rule — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
