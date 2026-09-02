'use strict';
/* The score is a wall of RATIOS, and a ratio is the one shape where mixing
   currencies does more than overstate a total — it inverts the verdict.

   ISSUE 28's audit narrowed the ACCOUNTS the score reads (health-data.js's
   splitByCurrency call) and wrote a comment saying "the pool is narrowed to
   the household's own currency before any of it is divided". It was not: the
   three transaction walks feeding every DIVISOR — the pass-through pairing,
   the household net, and the saving-rate rows — still read `txInPeriod(p)`
   raw, so a single rupiah holiday account dragged rupiah into every rand
   ratio on the page while the page printed "1 account in another currency
   (Rp) is not in these figures" directly beside them. The disclosure was
   true about the accounts and false about the arithmetic.

   The same gap ran one file over. `debtInterestMonthly(debts)` took no
   household symbol and `active`/`instalments` were unfiltered, while
   `worth()` eight lines below them and views/debts.js both held foreign
   debts out — so a euro mortgage tripled the snapshot's monthly interest
   bill and the score's interest share while the Debt page it was read off
   still printed the rand-only figure. money-flow.js's own `interestRaw`
   carried the identical defect, and its comment already said the two must
   move together.

   THE SHAPE OF EVERY ASSERTION HERE: build one rand vault, then the SAME
   vault with a foreign account (or a foreign debt) added, and require every
   ratio, every cover figure and the score itself to be IDENTICAL. That is
   the only form of this test that cannot be satisfied by a plausible-looking
   wrong number — it needs no expected constant, so nothing about it can be
   tuned to whatever the code happens to do.

   Driven through the REAL loader and the REAL healthSnapshot, because the
   whole defect lives in what health-data hands health-math: a pure test of
   health-math cannot see it at all.

     node tests/score-currency-isolation.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { periodFlow } = require('../src/money-flow');
const { debtInterestMonthly } = require('../src/health-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => {
  assert.ok(Math.abs((a || 0) - (b || 0)) <= tol, `${m} (got ${a}, want ${b}±${tol})`);
  checks++;
};

const B = 'Budget';
const SETTINGS = { month_start_day: 1, currency: 'R', country: 'za' };
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const TX_FM = '---\nkind: transactions\n---';
const table = rows =>
  `${TX_FM}\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n${rows.join('\n')}\n`;

const DEBT_HEAD = '---\nkind: debts\n---\n\n'
  + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
  + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n';

/* A household with something in all five pillars: real cover, real saving, a
   fixed-flagged bill, real net worth, and a real plan to measure spending
   against.

   THE Budgets/ FILES WERE THE LAST ONES ADDED HERE, AND THEY USED TO BE
   ABSENT ON PURPOSE. `budgetUsed` divides `consumptionBudget` by `budgeted`,
   and `consumptionBudget` is built from periodSpend() (src/trend-math.js),
   which filtered `excluded` rows and non-budget accounts but NOT foreign
   ones. Its numerator is a per-category map by the time health-data sees it —
   the labels that say which account each rand came from are already gone — so
   there was nothing this file could filter locally, and a fixture carrying a
   budget could only have pinned the wrong number as expected. Measured on
   this exact fixture the day the budgets went in: the mixed vault read
   budgetUsed 102 954% against the rand vault's 97%, the loudest figure
   ISSUE 28 left behind.

   periodSpend now narrows by the SAME `foreignLabels()` predicate
   summaryInRange and healthSnapshot already used, so the omission is no
   longer needed — and keeping it would leave the one pillar that was still
   broken untested. The equality in part 1 is what pins it here;
   tests/trend-foreign-isolation.test.cjs pins the helper itself. */
function randVault() {
  const files = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
    [`${B}/Categories/Rent.md`]: '---\ntype: housing\nfixed: true\n---\n',
    [`${B}/Categories/Invest.md`]: '---\ntype: savings\n---\n',
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 100000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
    [`${B}/Accounts/Emergency Fund.md`]:
      '---\ntype: savings\nbalance: 60000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\ntx_label: "Emergency Fund"\n---\n',
    [`${B}/Accounts/Investments.md`]:
      '---\ntype: investment\nbalance: 200000.00\nbalance_updated: 2026-08-01\ntx_label: "Investments"\n---\n',
  };
  for (const m of MONTHS) {
    files[`${B}/Transactions/Cheque/${m}.md`] = table([
      `| ${m}-01 | Salary | Salary | 45000.00 | | | |`,
      `| ${m}-05 | Groceries | Groceries | -9000.00 | | | |`,
      `| ${m}-03 | Rent | Rent | -8000.00 | | | |`,
      `| ${m}-06 | To investments | Invest | -5000.00 | | | |`,
    ]);
    files[`${B}/Transactions/Investments/${m}.md`] = table([
      `| ${m}-06 | From cheque | Invest | 5000.00 | | | |`,
    ]);
    /* The plan, one file per period the trailing average walks. Its numbers
       are the rand vault's own actuals, near enough that `budgetUsed` lands
       either side of 100% rather than at a round figure that could coincide
       with a wrong one by accident — Groceries budgeted a little under what
       was spent, Rent exactly on it. Invest is deliberately budgeted too:
       health-data's `consumptionBudget` excludes savings/investment-typed
       spend from the NUMERATOR while budgetTotals counts every non-income row
       in the DENOMINATOR, and a fixture with no savings row in the plan
       cannot tell a numerator bug from a denominator one. */
    files[`${B}/Budgets/${m}.md`] = '---\nkind: budget\n---\n\n'
      + '| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
      + '| Groceries | expense | 8500.00 | |\n'
      + '| Rent | housing | 8000.00 | |\n'
      + '| Invest | savings | 5000.00 | |\n'
      + '| Salary | income | 45000.00 | |\n';
  }
  return files;
}

/* The SAME vault plus one small rupiah holiday account. Small in rupiah terms
   is enormous in rand terms, which is the entire point: nothing about the
   figure is wrong except that it is being added to rands. */
function plusForeignAccount() {
  const files = randVault();
  files[`${B}/Accounts/Holiday.md`] =
    '---\ntype: checking\nbalance: 5000000.00\nbalance_updated: 2026-08-01\ncurrency: "Rp"\ntx_label: "Holiday"\n---\n';
  for (const m of MONTHS) {
    files[`${B}/Transactions/Holiday/${m}.md`] = table([
      `| ${m}-02 | Freelance | Salary | 20000000.00 | | | |`,
      `| ${m}-08 | Villa | Rent | -15000000.00 | | | |`,
      `| ${m}-09 | Market | Groceries | -3000000.00 | | | |`,
    ]);
  }
  return files;
}

async function snap(files) {
  const ctx = makeCtx(files, { budgetFolder: B, settings: SETTINGS });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  return ctx.healthSnapshot();
}

/* ---- 1. a foreign ACCOUNT changes nothing the score divides ---- */
async function part1() {
  const home = await snap(randVault());
  const mixed = await snap(plusForeignAccount());

  ok(home.metrics.score && home.metrics.score.value > 0,
    'the fixture actually scores — an all-null snapshot would pass every check below vacuously');

  /* The emergency-cover figure the audit measured: rand fund over a
     rupiah-polluted essential average printed months of cover in the
     hundredths where the truth was in the units. */
  near(mixed.metrics.monthlyEssential, home.metrics.monthlyEssential, 0.01,
    'essential spend is the household\'s own currency only — a rupiah villa is not a rand bill this fund has to cover');
  near(mixed.metrics.months, home.metrics.months, 0.01,
    'so months of cover reads the same with and without the holiday account');

  /* Every share of income. Each is a ratio, and each had BOTH halves polluted
     by the same unfiltered walk — which is worse than one, because the error
     does not even cancel in a predictable direction. */
  for (const k of ['monthlyIncome', 'monthlyEssential', 'monthlySavings', 'monthlyConsumption', 'monthlyFixed']) {
    near(mixed.metrics[k], home.metrics[k], 0.01, `${k} is unchanged by a foreign account`);
  }
  for (const k of ['savingsRate', 'consumptionShare', 'fixedShare']) {
    near(mixed.metrics[k], home.metrics[k], 1e-9, `${k} is unchanged by a foreign account`);
  }

  /* THE BUDGET PILLAR — the one this file could not carry until periodSpend
     learned the predicate. `budgetUsed` is `consumptionBudget / budgeted`,
     and only the numerator ever saw a transaction row: the plan is written in
     the household's currency by construction, so a rupiah market trip landed
     in the numerator with nothing on the other side of the division to
     balance it. Anchored first, because a pillar that scores `null` on both
     vaults would satisfy the equality below without measuring anything. */
  ok(home.metrics.budgetUsed !== null && home.metrics.budgetUsed > 0,
    'the rand vault actually measures a budget-used figure — the fixture carries a plan for every period walked');
  near(mixed.metrics.budgetUsed, home.metrics.budgetUsed, 1e-9,
    'budget used is the household\'s own plan against the household\'s own spending — a rupiah villa is in neither half');

  eq(mixed.metrics.score.value, home.metrics.score.value,
    'and the score itself — the one figure a reader acts on — is identical');
  eq(mixed.breakdown, home.breakdown,
    'and so is every line of the breakdown the reader opens to explain it');

  /* currency.js:14 forbids excluding an account silently, and "left out of a
     score" is an exclusion however good the reason. The held-out account has
     to still be NAMED, or this fix trades a wrong number for a hidden one. */
  eq(mixed.otherCurrencies, [['Rp', 5000000]],
    'the account held out of every figure above is still named on the snapshot, so the page can say what it left out');
  eq(home.otherCurrencies, [],
    'and a single-currency vault says nothing, because there is nothing to say');

  console.log(`PASS  score-currency-isolation.test.cjs / part 1  (${checks} checks)`);
}

/* ---- 2. a foreign DEBT changes nothing either ---- */
async function part2() {
  const base = randVault();
  const RAND_DEBT = '| Car | Bank A | vehicle | 40000.00 | 60000.00 | 10.00 | 1200.00 | 0.00 | 2024-01-01 | | active | | |\n';
  const EURO_DEBT = '| Lisbon bond | Banco B | home loan | 200000.00 | 250000.00 | 4.00 | 900.00 | 0.00 | 2023-01-01 | | active | | € |\n';

  const home = await snap({ ...base, [`${B}/Debts.md`]: DEBT_HEAD + RAND_DEBT });
  const mixed = await snap({ ...base, [`${B}/Debts.md`]: DEBT_HEAD + RAND_DEBT + EURO_DEBT });

  ok(home.debtInterest > 0, 'the rand debt really does cost something, so the comparison below has something to compare');
  near(mixed.debtInterest, home.debtInterest, 0.01,
    'the monthly interest bill is the rand book only — worth() and views/debts.js already read it that way, and this is the third copy');
  near(mixed.metrics.interestShare, home.metrics.interestShare, 1e-9,
    'so the score\'s interest share is unchanged by a euro mortgage');
  near(mixed.metrics.instalmentShare, home.metrics.instalmentShare, 1e-9,
    'and so is the instalment share — a €900 repayment is not R900 of commitment');
  eq(mixed.metrics.score.value, home.metrics.score.value, 'and the score is identical');

  /* The optional-symbol contract worth() and owedSummary() already carry:
     absent means "add everything", exactly as this function always behaved,
     so a caller that has not been taught about currencies is unchanged rather
     than quietly altered. */
  const DEBTS = [
    { name: 'Car', balance: 40000, rate: 10, status: 'active', currency: '' },
    { name: 'Lisbon bond', balance: 200000, rate: 4, status: 'active', currency: '€' },
  ];
  const both = debtInterestMonthly(DEBTS);
  const randOnly = debtInterestMonthly(DEBTS, 'R');
  ok(both > randOnly, 'no household symbol still adds every debt — the old callers are unchanged');
  near(randOnly, 40000 * 0.10 / 12, 0.01, 'a household symbol holds the euro bond out');

  console.log(`PASS  score-currency-isolation.test.cjs / part 2  (${checks} checks)`);
}

/* ---- 3. money-flow's second copy of the same figure moves with it ----

   money-flow.js:171-184 already says in prose that its `interestRaw` and
   health-data's `debtInterest` "must be updated together or the two figures
   on this page will drift apart again" — the Score page draws both. This is
   that sentence as a test. */
function part3() {
  const DEBTS = [
    { name: 'Car', balance: 40000, rate: 12, status: 'active', currency: '' },
    { name: 'Lisbon bond', balance: 200000, rate: 6, status: 'active', currency: '€' },
  ];
  const args = debts => ({
    income: 45000, spentTotal: 22000, budgeted: 20000,
    spendByCat: { Repayments: 5000, Groceries: 9000, Rent: 8000 },
    fixedCats: new Set(['Repayments']), catType: c => (c === 'Repayments' ? 'debt' : null),
    savingContribution: 0, debts, budgetIncome: 45000, periodFinished: false,
  });
  const mixed = periodFlow({ ...args(DEBTS), household: 'R' });
  const home = periodFlow({ ...args([DEBTS[0]]), household: 'R' });
  near(mixed.committedDetail.interest, home.committedDetail.interest, 0.01,
    'the flow card\'s "of which interest" is the rand book only, the same as the score breakdown beneath it');
  near(home.committedDetail.interest, 40000 * 0.12 / 12, 0.01,
    'and it is the rand debt\'s own monthly interest, not a mixed sum');

  const untaught = periodFlow(args(DEBTS));
  ok(untaught.committedDetail.interest > home.committedDetail.interest,
    'a caller that passes no household symbol is unchanged — same optional contract as debtInterestMonthly');

  console.log(`PASS  score-currency-isolation.test.cjs / part 3  (${checks} checks)`);
}

/* Sequenced rather than fired off as three independent IIFEs: part 3 is
   synchronous and would otherwise run — and fail the whole file — before
   either loader-driven part had reached its first assertion, hiding whichever
   of the three actually broke. */
part1().then(part2).then(part3).catch(e => { console.error(e); process.exit(1); });
