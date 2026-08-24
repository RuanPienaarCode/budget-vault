'use strict';
/* Conservation: no rand may fall through periodSummary without landing
   somewhere.

   THE BUG CLASS THIS EXISTS TO KILL. summaryInRange classifies each row with a
   chain that had no final else:

       if (type === 'income') income += t.amount;
       else if (t.amount < 0) spend += -t.amount;

   A row that is neither income-typed nor negative — an uncategorised deposit, a
   refund inside an expense category, money under a category name no file
   answers to — matched no branch and was counted by nothing. It was still in
   `byCat`, so the donut and the Budget page's Actual column saw it; every
   figure derived from `income` and `spend` did not. periodDeficit was
   documented as "what actually went out, less what actually came in" and was
   computed as `spend - income`, so it inherited the whole gap.

   Measured on the vault this was found in: two periods' stated overspend was
   materially wrong, and a third reported a hole for a period that had
   finished ahead — the uncategorised deposits that paid for it were
   credited to nothing. That figure is what pullPreviousOverspend writes into
   an assume-spent budget row, which is treated as money already spent — so
   the holes were not merely mis-stated, they were funded.

   THE FIX IS AN IDENTITY, NOT A FOURTH BRANCH. `net` is the signed sum of every
   counted row, periodDeficit is exactly `-net`, and the invariant below says
   the buckets must add back up to it. A future branch that swallows a row now
   breaks arithmetic rather than quietly shrinking a total.

   Five invariants:

     1. conservation — net === income - spend + everything-else-that-came-in,
        and net === the sum an INDEPENDENT oracle gets from the same rows
     2. periodDeficit === -net, so an uncategorised deposit, a refund and an
        unknown-category deposit each shrink the hole by their own amount
     3. an unknown category is its OWN state — not silently type-less, not
        lumped in with "uncategorised", and never invisible
     4. the three vetoes (excluded row, non-budget account, transfer category)
        stay OUTSIDE the identity entirely
     5. the identity holds over randomised row sets, not just the hand-picked
        ones above

   Runs in bare node against the REAL loader and the REAL period module.
   Wired into ./build.sh.
     node tests/summary-conservation.test.cjs        # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { periodFlow } = require('../src/money-flow');
const { growthSeries } = require('../src/savings-math');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

/* Money compared in whole cents. Every figure here is a sum of 2dp decimals,
   and binary floating point makes 0.1 + 0.2 a losing comparison.

   Negative zero is folded to zero HERE and nowhere else: -0 is a real defect
   in a figure the user reads (money() renders it "-R0.00"), so the comparison
   helper must not be what hides it. It is asserted directly below instead.
   NaN is deliberately left alone — it must still fail loudly. */
const c = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };
const eqMoney = (a, b, m) => eq(c(a), c(b), `${m} (got ${a}, want ${b})`);

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |\n`).join('')}`;

/* Every figure synthetic — never real statement data in this repo. Only the
   SHAPE is taken from the vault this was found on: a period whose categorised
   rows read as a hole while a large uncategorised deposit sits in the same
   window, uncounted. */
const CATS = {
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Move.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',
};

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  ...CATS,
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-08-01\n---\n',
};

async function vault(files, settings) {
  const ctx = makeCtx({ ...BASE, ...files }, { settings: { month_start_day: 1, ...settings } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  return ctx;
}

/* An INDEPENDENT oracle for what the period holds. It re-states the three
   vetoes rather than calling the code under test, which is the one place in
   this repo where restating a rule is correct: a test that asks the
   implementation what the answer is cannot catch the implementation dropping a
   row. Kept to three lines so it stays readable as a specification. */
function oracle(ctx, p) {
  const skip = ctx.nonBudgetLabels();
  return ctx.txInPeriod(p).filter(t =>
    !t.excluded && !skip.has(t.label) && ctx.catType(t.cat) !== 'transfer');
}

(async () => {

/* ---- 1 + 2. the three leaks, each one a rand that reached no bucket ------ */
{
  const ctx = await vault({
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ['2026-08-02', 'Salary', 'Salary', 30000],
      ['2026-08-04', 'Shop', 'Groceries', -32000],
      // (a) money in with no category at all
      ['2026-08-07', 'Deposit', '', 18000],
      // (b) a refund inside an expense category — money that came back
      ['2026-08-09', 'Refund', 'Groceries', 150],
      // (c) money in under a category name no file answers to
      ['2026-08-11', 'Payout', 'Salaray', 5000],
    ]),
  });
  const sum = ctx.periodSummary('2026-08');

  eqMoney(sum.income, 30000, 'income counts only income-typed rows');
  eqMoney(sum.spend, 32000, 'spend stays GROSS outgoings — the figure the hero shows');

  /* The old code returned spend - income = 2000: a hole, in a period that took
     in 53 150 against 32 000 out. */
  eqMoney(ctx.periodDeficit('2026-08'), -21150,
    'the period finished ahead — every rand that came in is credited, whatever its category');
  ok(ctx.periodDeficit('2026-08') < 0,
    'and so pullPreviousOverspend offers nothing to carry, rather than funding a hole that never existed');

  eqMoney(sum.uncatIncome, 18000, 'money in with no category is reported, not discarded');
  eqMoney(sum.unknown.income, 5000, 'so is money in under a name no category file answers to');

  // The identity, spelled out on a case whose every term is non-zero.
  const inflowOther = 18000 + 150 + 5000;
  eqMoney(sum.net, sum.income - sum.spend + inflowOther, 'net === income - spend + everything else that came in');
  eqMoney(ctx.periodDeficit('2026-08'), -sum.net, 'periodDeficit is exactly -net, by construction');

  // …and against the oracle, which never asked the implementation anything.
  eqMoney(sum.net, oracle(ctx, '2026-08').reduce((t, r) => t + r.amount, 0),
    'net === the sum an independent reader gets from the same rows');
}

/* ---- 3. an unknown category is its own state ---------------------------- */
{
  const ctx = await vault({
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ['2026-08-02', 'Blank out', '', -200],
      ['2026-08-03', 'Blank in', '', 900],
      ['2026-08-04', 'Gone out', 'Deleted Category', -700],
      ['2026-08-05', 'Gone in', 'Deleted Category', 400],
      ['2026-08-06', 'Case', 'groceries', -50],
    ]),
  });
  const sum = ctx.periodSummary('2026-08');

  eq(sum.uncategorised, 2, 'only a BLANK category counts as uncategorised');
  eq(sum.unknown.count, 3, 'a name no category file answers to is counted separately — case-only mismatches included');
  eq(sum.unknown.names.sort(), ['Deleted Category', 'groceries'],
    'and the names are reported, so the page can say WHICH category went missing');

  ok(!sum.unknown.names.includes(''), 'a blank category is never reported as a missing one');
  eqMoney(sum.unknown.spend, 750, 'its outgoings are still spend — money out is money out');
  eqMoney(sum.spend, 950, 'and they are still inside the gross spend figure, exactly as before');
  eqMoney(sum.uncatSpend, 200, 'while the uncategorised half stays the blank-category rows only');

  /* The whole point: before this, "Deleted Category" +400 was counted by
     nothing and announced by nothing. promptDeleteCategory leaves the name on
     the rows on purpose, and there is no rename UI, so this state is reachable
     on two supported paths — it must not be silent on either. */
  eqMoney(sum.unknown.income, 400, 'and its incoming half is reported rather than vanishing');
  eqMoney(sum.net, -200 + 900 - 700 + 400 - 50, 'every row lands in the identity');
}

/* ---- 4. the three vetoes stay outside the identity ---------------------- */
{
  const ctx = await vault({
    [`${B}/Accounts/Vault.md`]: '---\ntype: savings\ntx_label: "Vault"\nbudget: false\nbalance: 500.00\nbalance_updated: 2026-08-01\n---\n',
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ['2026-08-02', 'Kept', 'Groceries', -100],
      ['2026-08-03', 'Vetoed', 'Groceries', -9999, 'yes'],
      ['2026-08-04', 'Shuffle', 'Move', -5000],
      ['2026-08-05', 'Shuffle back', 'Move', 5000],
    ]),
    [`${B}/Transactions/Vault/2026-08.md`]: txFile([
      ['2026-08-06', 'Off budget', 'Groceries', -7777],
    ]),
  });
  const sum = ctx.periodSummary('2026-08');

  eqMoney(sum.net, -100, 'an excluded row, a non-budget account and a transfer are all outside the sum');
  eqMoney(ctx.periodDeficit('2026-08'), 100, 'so the hole is the one real row, and nothing else');
  eqMoney(sum.spend, 100, 'and gross spend agrees');
  eqMoney(sum.net, oracle(ctx, '2026-08').reduce((t, r) => t + r.amount, 0), 'oracle agrees on the same three vetoes');
}

/* ---- 4b. a period that breaks exactly even reports zero, not minus zero -- */
{
  const ctx = await vault({
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ['2026-08-02', 'In', 'Salary', 1000],
      ['2026-08-03', 'Out', 'Groceries', -1000],
    ]),
  });
  /* periodDeficit negates `net`, and negating zero yields NEGATIVE zero, which
     money() renders as "-R0.00" — a wart this repo has already shipped once on
     the Accounts hero. Object.is, because == and === cannot see the sign. */
  ok(Object.is(ctx.periodDeficit('2026-08'), 0),
    'a break-even period yields positive zero, so nothing renders "-R0.00"');
  ok(Object.is(ctx.periodDeficit('2026-01'), 0),
    'and so does a period with no transactions at all');
}

/* ---- 4c. a two-legged Contribution cancels on its own, when both legs count
   The fourth thing `net`'s flat "every row, one rule" count covers for free —
   see the periodDeficit header. CONTEXT.md: a Contribution "wears the budget
   category it came from rather than one of its own", so both legs sit under
   the SAME ordinary, non-transfer category rather than a transfer-typed one.
   The savings account here is deliberately left WITHOUT `budget: false` (test
   4 above already covers what a non-budget account's OWN vetoed row looks
   like) — "in_budget", so neither leg is skipped and they cancel on their
   own. periodDeficit never has to know a Contribution happened at all. */
{
  const ctx = await vault({
    [`${B}/Accounts/Savings.md`]: '---\ntype: savings\ntx_label: "Savings"\nbalance: 500.00\nbalance_updated: 2026-08-01\n---\n',
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ['2026-08-02', 'Contribution out', 'Groceries', -10000],
    ]),
    [`${B}/Transactions/Savings/2026-08.md`]: txFile([
      ['2026-08-02', 'Contribution in', 'Groceries', 10000],
    ]),
  });
  const sum = ctx.periodSummary('2026-08');

  eqMoney(sum.spend, 10000, 'the outgoing leg is still gross spend — money left the cheque account');
  eqMoney(sum.net, 0, 'the incoming leg on the savings side cancels it exactly, in the same category');
  ok(Object.is(ctx.periodDeficit('2026-08'), 0),
    'periodDeficit reports no hole for a Contribution it was never told about — the cancellation is automatic, not a special case');
  eqMoney(sum.net, oracle(ctx, '2026-08').reduce((t, r) => t + r.amount, 0),
    'and the independent oracle agrees — both legs are ordinary, non-transfer rows to it too');
}

/* ---- 5. the identity over randomised row sets --------------------------- */
{
  // Deterministic PRNG so a failure is reproducible from the seed alone.
  let seed = 20260813;
  const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  // Blank, real, transfer, and two names no category file answers to.
  const NAMES = ['', 'Salary', 'Groceries', 'Move', 'Deleted Category', 'groceries'];

  let rounds = 0;
  for (let round = 0; round < 60; round++) {
    const rows = [];
    for (let i = 0; i < 1 + rnd(14); i++) {
      const amt = (rnd(400000) - 200000) / 100;
      rows.push([`2026-08-${String(1 + rnd(27)).padStart(2, '0')}`, `Row ${i}`,
        NAMES[rnd(NAMES.length)], amt, rnd(6) === 0 ? 'yes' : '']);
    }
    const ctx = await vault({ [`${B}/Transactions/Cheque/2026-08.md`]: txFile(rows) });
    const sum = ctx.periodSummary('2026-08');
    const kept = oracle(ctx, '2026-08');

    const inflowOther = kept
      .filter(t => ctx.catType(t.cat) !== 'income' && t.amount > 0)
      .reduce((t, r) => t + r.amount, 0);

    eqMoney(sum.net, kept.reduce((t, r) => t + r.amount, 0), `round ${round}: net matches an independent sum`);
    eqMoney(sum.net, sum.income - sum.spend + inflowOther, `round ${round}: the buckets add back up to net`);
    eqMoney(ctx.periodDeficit('2026-08'), -sum.net, `round ${round}: deficit is -net`);
    eq(sum.uncategorised + sum.unknown.count <= kept.length, true, `round ${round}: neither counter over-counts`);
    rounds++;
  }
  ok(rounds === 60, 'all 60 randomised rounds ran');
}

/* ===========================================================================
   6. MONEY-FLOW BANDS CONSERVE INCOME — AND ARE ALLOWED NOT TO, IN A DEFICIT

   periodFlow()'s own header states the identity and its one exception in the
   same breath: the four bands (committed, living, saving, notYetSpent) sum
   to income whenever the household stayed inside it, because notYetSpent is
   built to absorb exactly the remainder — but `notYetSpent` FLOORS at zero,
   so a period that committed, lived and saved MORE than it earned cannot pay
   that floor back. The bands then sum to what actually left the household,
   not to income — and money-flow.js's own comment on `bandPercents` says the
   percentages are allowed past 100 for the same reason and must not be
   force-fitted back to it.

   Restated independently: `net += periodFlow()` is not asked what its own
   sum is — this derives the expected total from the SAME clamp rule
   (`Math.max(income, committed+living+saving)`) written out here, and checks
   the four bands against it, and separately checks that a deficit round's
   OWN rounded percentages are never silently renormalised to 100. */
{
  let seed = 0x5eed01 ^ 20260824;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;

  // ---- anchor: a hand-picked deficit, spelled out ----
  {
    const flow = periodFlow({
      income: 20000, spentTotal: 25000, budgeted: 22000,
      spendByCat: { Rent: 8000, Groceries: 17000 },
      fixedCats: new Set(['Rent']), catType: cat => (cat === 'Rent' ? 'housing' : null),
      savingContribution: 0, debts: [],
    });
    const { committed, living, saving, notYetSpent } = flow.bands;
    eqMoney(committed + living + saving + notYetSpent, 25000,
      'anchor: a deficit period is spent MORE than it earned; the bands sum to what left, not to income');
    eqMoney(notYetSpent, 0, 'anchor: nothing is left unspent to report');
    const pctSum = flow.bands.percents.committed + flow.bands.percents.living
      + flow.bands.percents.saving + flow.bands.percents.notYetSpent;
    ok(pctSum > 100, `anchor: the percentages of income legitimately exceed 100 (got ${pctSum})`);
  }

  // ---- randomised rounds — zero income, a period with no budget at all,
  //      a household that saves more than it spends, a pure surplus ----
  let rounds = 0, deficits = 0, gateSlips = 0;
  for (let round = 0; round < 60; round++) {
    const income = rnd() < 0.1 ? 0 : Math.round(rnd() * 45000 * 100) / 100;
    const spentTotal = Math.round(rnd() * 55000 * 100) / 100;
    const budgeted = rnd() < 0.15 ? 0 : Math.round(rnd() * 40000 * 100) / 100;
    const savingContribution = rnd() < 0.4 ? 0 : Math.round(rnd() * 8000 * 100) / 100;
    const rentSpend = Math.round(rnd() * spentTotal * 100) / 100;
    const spendByCat = { Rent: rentSpend, Other: Math.max(0, spentTotal - rentSpend) };
    const fixedCats = new Set(rnd() < 0.5 ? ['Rent'] : []);
    const catType = cat => (cat === 'Rent' ? 'housing' : null);
    const debts = rnd() < 0.3 ? [{ status: 'active', balance: Math.round(rnd() * 80000), rate: 20 }] : [];

    const flow = periodFlow({ income, spentTotal, budgeted, spendByCat, fixedCats, catType, savingContribution, debts });
    const { committed, living, saving, notYetSpent } = flow.bands;

    eqMoney(notYetSpent, Math.max(0, income - committed - living - saving),
      `flow round ${round}: notYetSpent is exactly the income remainder, floored at zero`);
    const expectedSum = Math.max(income, committed + living + saving);
    eqMoney(committed + living + saving + notYetSpent, expectedSum,
      `flow round ${round}: the four bands sum to income, or to what actually left in a deficit — never silently short`);

    const p = flow.bands.percents;
    const pctSum = p.committed + p.living + p.saving + p.notYetSpent;
    /* Mirrors money-flow.js's OWN gate EXACTLY — `rawSum <= 100.0001`, not the
       mathematically-equivalent `committed+living+saving > income`. The two
       are equal on paper but NOT in floating point: `rawSum` is summed from
       FOUR independent divisions rather than derived from the amounts the
       equality above proves equal, and an ordinary SURPLUS period can still
       land a float ULP over 100 — 100.00000000000001 was measured on the
       exact fixture round 22 below used to reproduce. A bare `<= 100` gate
       took the DEFICIT branch (independent Math.round per band) on that
       period, reintroducing the "17+17+17=102%" defect largestRemainder
       exists to prevent on a household that was never in deficit at all.
       Fixed by widening the gate to a hundredth of a percent — far below
       anything the card renders and far above float noise — rather than by
       deriving `rawSum` differently, so this mirror has to widen with it or
       it goes on asserting the OLD, narrower boundary against the NEW code. */
    const GATE_EPS = 100.0001;
    const rawPercents = [committed, living, saving, notYetSpent].map(a => (income > 0 ? (a / income) * 100 : 0));
    const rawSum = rawPercents.reduce((s, v) => s + v, 0);
    const isDeficit = income > 0 && committed + living + saving > income;
    if (isDeficit) deficits++;
    const takesDeficitBranch = income > 0 && rawSum > GATE_EPS;
    /* Now a genuine regression guard rather than a tally to report and move
       on from: with the gate epsilon-widened, a round that is NOT a real
       deficit by the bands' own money should never still exceed GATE_EPS —
       float noise here is documented at one ULP, thirteen orders of
       magnitude below the epsilon. A round landing here would mean the float
       gap has grown past what the epsilon absorbs, which is worth failing
       loudly on rather than logging quietly. */
    if (income > 0 && !isDeficit && takesDeficitBranch) gateSlips++;

    if (takesDeficitBranch) {
      // The deficit branch rounds each percentage on its OWN, independent of
      // the others — see money-flow.js's own comment on why largestRemainder
      // (which only means something over one shared whole) is skipped here.
      // Reached only by a REAL deficit now that the gate is epsilon-wide, so
      // this is pinned as a general claim without a gate-slip carve-out.
      eq([p.committed, p.living, p.saving, p.notYetSpent], rawPercents.map(v => Math.round(v)),
        `flow round ${round}: once the code's own gate falls through, percentages are each rounded independently, not force-fit to 100`);
      ok(isDeficit, `flow round ${round}: the independent-rounding branch was reached by a round that is `
        + 'NOT a real deficit — the exact gate-slip this suite\'s epsilon exists to absorb');
      ok(pctSum > 99, `flow round ${round}: a real deficit's percentages of income are allowed past 100 (got ${pctSum})`);
    } else if (income > 0) {
      // Inside the gate now includes the marginal, epsilon-sized "deficits"
      // that only clear zero by float noise — the code force-fits those to
      // 100 exactly like an ordinary surplus, which is the correct call: a
      // deficit too small for the card to render is not one worth giving its
      // own rounding rule.
      eq(pctSum, 100, `flow round ${round}: inside the code's own gate, the percentages still sum to exactly 100`);
    } else {
      eq(pctSum, 0, `flow round ${round}: no income means no percentage of it to report`);
    }
    rounds++;
  }
  ok(rounds === 60, 'money-flow: all 60 randomised rounds ran');
  ok(deficits >= 5, `money-flow: enough of the 60 rounds actually landed in deficit to exercise the >100% branch (got ${deficits})`);
  ok(gateSlips === 0, `money-flow: no ordinary-surplus round was mis-routed into the deficit rounding branch `
    + `(got ${gateSlips}/${rounds}) — a non-zero count here means the epsilon gate needs widening again`);
  console.log(`  ok — money-flow bands conserve income, or openly exceed it in a deficit (${rounds} randomised rounds, ${deficits} deficits, plus the anchor)`);
}

/* ===========================================================================
   7. SAVINGS GROWTH CHART: capital + posted + undated === closing, FUZZED
      OVER THE INPUT CLASS THAT BROKE IT

   src/savings-math.js's own header on `monthOf` names the exact defect: a
   row dated with a shape-valid but not-real month ('2025-13-05' — ISO_DATE
   is shape-only, per its own comment in dates.js) used to bucket under an
   unwalkable key that growthSeries' month walk (which only ever produces
   REAL months, 01-12) could never reach — so that row's money left `closing`
   (it is still inside the account's own balance) but joined neither a band
   nor `undated`. It just vanished. Fixed by having monthOf fall back to ''
   (routing the row into the same UNDATABLE/pending path a truly undated row
   already takes) whenever isRealIsoDate rejects the shape.

   tests/savings-math.test.cjs already covers this identity over well-formed
   dates; this is the one input class that broke it and was untested — month
   numbers from 13 to 99, which the shape-only regex accepts without
   complaint, mixed in with ordinary real dates so a fuzzed vault is not ALL
   one or the other. */
{
  let seed = 0x9017 ^ 20260824;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  // ~35% of dates carry a shape-valid, not-real month (13-99) — mixed with
  // ordinary real ones so the fixture is not a pathological all-invalid case.
  const randDate = () => {
    const year = 2020 + Math.floor(rnd() * 6);
    const month = String(1 + Math.floor(rnd() * (rnd() < 0.35 ? 99 : 12))).padStart(2, '0');
    const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const typeOf = cat => (cat === 'Growth' ? 'income' : null);

  // ---- anchor: the exact shape the header names ----
  {
    const entries = [{
      account: { balance: 10450, starting_amount: 10000, inception_date: '2025-01-01' },
      rows: [
        { date: '2025-02-01', amount: 300, cat: 'Fund' },
        { date: '2025-13-05', amount: 150, cat: 'Fund' },   // the row that used to vanish
      ],
    }];
    const s = growthSeries(entries, typeOf, { today: '2030-01-01' });
    const last = s.points[s.points.length - 1] || { capital: 0, posted: 0 };
    eqMoney(last.capital + last.posted + s.undated, s.closing,
      'anchor: a row dated month 13 is folded into the first point instead of falling out of every total');
  }

  let rounds = 0;
  for (let round = 0; round < 50; round++) {
    const numAccounts = 1 + Math.floor(rnd() * 3);
    const entries = [];
    for (let a = 0; a < numAccounts; a++) {
      const account = {
        balance: Math.round(rnd() * 80000 * 100) / 100,
        starting_amount: Math.round(rnd() * 50000 * 100) / 100,
        inception_date: rnd() < 0.8 ? randDate() : undefined,
      };
      const rows = [];
      const n = 1 + Math.floor(rnd() * 14);
      for (let i = 0; i < n; i++) {
        const amount = Math.round((rnd() * 4000 - 1000) * 100) / 100;
        if (!amount) continue;
        rows.push({ date: randDate(), amount, cat: rnd() < 0.3 ? 'Growth' : 'Fund' });
      }
      entries.push({ account, rows });
    }
    const s = growthSeries(entries, typeOf, { today: '2030-01-01' });
    const last = s.points[s.points.length - 1] || { capital: 0, posted: 0 };
    eqMoney(last.capital + last.posted + s.undated, s.closing,
      `growth round ${round}: capital + posted + undated === closing, with month-13-to-99 rows mixed in`);
    rounds++;
  }
  ok(rounds === 50, 'savings-growth: all 50 randomised rounds ran');
  console.log(`  ok — capital + posted + undated === closing, fuzzed over shape-valid-but-not-real months (${rounds} randomised rounds, plus the anchor)`);
}

console.log(`PASS — every rand lands somewhere: the summary buckets add back up to the ledger (${checks} assertions, 60 randomised rounds).`);
})().catch(e => { console.error(e); process.exit(1); });
