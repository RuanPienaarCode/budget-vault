'use strict';
/* The reconciliation's own checks, checked.

   A diagnosis pass (2026-09-29) ran scripts/reconcile-page.cjs over a real
   vault and found that EVERY failure it reported was a fault in the checker,
   not the screen it was checking. The gate (tests/reconcile-gate.test.cjs) runs
   the fixture at ONE clock and one period, which is why none of these showed:
   each needs a clock or a household the gate does not use. So each fix is
   pinned here, on the committed synthetic household, at the clock that
   exposes it — and, where a check could pass by never looking, against a
   TAMPERED page it must fail on.

     1. Trend: the current bar was the last bar that printed money, so a running
        period with no rows read the previous month's bar as current.
     2. Score: the flow card and chips are always currentPeriod(); the checks
        compared them to the selected period, by chip position.
     3. Context: keyed by address, so every group total shared one.
     4. Cash on hand: the oracle summed every non-pool type; the app counts
        in-budget, dated, home-currency accounts, pools included.
     5. A conditional note that fails to render was `unverified`, not a failure.
     6. allocated: the checker's own rule instead of the app's allocatedShare.
     7. Transactions: a windowed table (100 of N) failed the row count and
        skipped the sum.
     8. Stale-note drift (magnitude vs signed) and the spending ring's ordinal.
     9. The donut legend's Change = Spent − baseline.

     node tests/reconcile-checker-fixes.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { reconcile, householdVault, runChecks } = require('../scripts/reconcile-page.cjs');
const { SEED, B } = require('./figures/household.cjs');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };
const find = (checks, page, re) => checks.filter(c => c.page === page && re.test(c.name));
const one = (checks, page, re) => {
  const hit = find(checks, page, re);
  assert.strictEqual(hit.length, 1, `exactly one ${page} check matching ${re} (got ${hit.length}: ${hit.map(c => c.name).join(' | ')})`);
  return hit[0];
};
/* The household's one screen bug (the Groceries drill-through listing the
   earmarked pram) is fixed, so every failure counts here again. */
const failed = (checks, page) => checks.filter(c => c.status === 'fail' && (!page || c.page === page)).map(c => `${c.page} :: ${c.name} (page=${c.pageValue} global=${c.globalValue})`);
const clone = x => JSON.parse(JSON.stringify(x));

(async () => {
  const H = householdVault();

  /* ---- 1. Trend ---------------------------------------------------------- */
  {
    /* October 5th, October selected: the running period holds no rows, so its
       bar's title is the label alone ("Oct 26") and September's is the last bar
       that prints money. */
    const r = await reconcile({ ...H, today: '2026-10-05', period: '2026-10' });
    eq(failed(r.checks, 'dashboard').filter(f => /Trend/.test(f)), [], 'no Trend check fails on a running period with no rows');
    const spent = one(r.checks, 'dashboard', /Trend chart, current bar: spent/);
    eq(spent.status, 'pass', 'the empty current bar is a pass, not a comparison against last month');
    ok(/label only/.test(spent.pageSource), 'and it says WHY: the bar prints its label only');

    /* The request as worded: only the clock moves, September stays selected. */
    const r2 = await reconcile({ ...H, today: '2026-10-05' });
    eq(failed(r2.checks, 'dashboard').filter(f => /Trend/.test(f)), [], 'no failed Trend check with the clock at 2026-10-05 and the fixture period');

    /* Positional, not "whichever slot happens to match". September's bar is
       spent 12100 / budget 15500 / income 30000; swap the tooltip's budget and
       income and every slot is a value some other slot equals. The old
       vals.find(near) picked the matching value WHEREVER it sat and passed. */
    const ok0 = await reconcile({ ...H, today: '2026-09-15' });
    const good = one(ok0.checks, 'dashboard', /Trend chart, current bar: income/);
    eq(good.status, 'pass', 'a covered current bar reads its three series by position');
    const pages = clone(ok0.pages);
    const bars = pages.find(p => p.view === 'dashboard').figures.filter(f => /trendChart\/svg\/rect\[\d+\]\/title/.test(f.address) && f.kind === 'money');
    const lastIdx = Math.max(...bars.map(f => Number(f.address.match(/rect\[(\d+)\]/)[1])));
    const lastBar = bars.filter(f => f.address.includes(`rect[${lastIdx}]`));
    eq(lastBar.length, 3, 'the current bar prints three money figures: spent, budget, income');
    [lastBar[1].raw, lastBar[2].raw] = [lastBar[2].raw, lastBar[1].raw];
    const swapped = runChecks(ok0.G, pages);
    eq(swapped.filter(c => /Trend chart, current bar: (budget|income)/.test(c.name)).map(c => c.status), ['fail', 'fail'],
      'NEGATIVE CONTROL: budget and income swapped in the tooltip fail both — a by-value search would have found each somewhere in the bar');
  }

  /* ---- 2. Score ---------------------------------------------------------- */
  {
    /* August selected on the 2nd of September: the flow card and its chips
       still say September, and September has a budget file where August has
       none, so the two periods disagree on every chip. */
    const r = await reconcile({ ...H, today: H.today, period: '2026-08' });
    eq(failed(r.checks, 'score'), [], 'the Score checks pass with a finished period selected — they read the running one');
    const budgeted = one(r.checks, 'score', /Budget chip: budgeted/);
    eq(budgeted.status, 'pass');
    ok(budgeted.globalValue > 0, `and the seam is September's plan (${budgeted.globalValue}), not August's empty one`);
    for (const re of [/Flow: income in/, /Budget chip: allocated/, /Budget chip: spent/, /Budget chip: budget used/]) {
      eq(one(r.checks, 'score', re).status, 'pass', `${re} passes at a selected period that is not the current one`);
    }

    /* And the exact scenario in the ticket: clock in October, September selected. */
    const r2 = await reconcile({ ...H, today: '2026-10-05', period: '2026-09' });
    eq(failed(r2.checks, 'score'), [], 'the Score checks pass with the clock at 2026-10-05 and September selected');

    /* Addressed by name, so the chip rows moving cannot move the check. */
    const page = r.pages.find(p => p.view === 'score');
    for (const name of ['score-flow-in', 'score-budgeted', 'score-allocated', 'score-spent', 'score-used']) {
      ok(page.figures.some(f => f.address.endsWith(`/@${name}`)), `score.js names ${name} with a data-fig`);
    }

    /* NEGATIVE CONTROL: a chip that printed the wrong number now fails, and it
       fails by NAME rather than being read off a neighbouring row. */
    const pages = clone(r.pages);
    const chip = pages.find(p => p.view === 'score').figures.find(f => f.address.endsWith('/@score-spent'));
    chip.raw = chip.raw + 100; chip.text = 'R 999';
    const bad = runChecks(r.G, pages);
    eq(one(bad, 'score', /Budget chip: spent/).status, 'fail', 'a wrong Score spent chip fails');
  }

  /* ---- 3. Context is per figure ------------------------------------------ */
  {
    const r = await reconcile({ ...H });
    const accounts = r.pages.find(p => p.view === 'accounts');
    const totals = accounts.figures.filter(f => f.address === 'acctTable/@acct-group-total' && f.kind === 'money');
    ok(totals.length >= 2, `the Accounts table prints a total per group (${totals.length})`);
    eq(new Set(totals.map(f => f.context.parent)).size, totals.length, 'each group total carries ITS OWN context, not the last leaf written under the shared address');
    ok(totals.some(f => /^Savings/.test(f.context.parent)) && totals.some(f => /^Bank/.test(f.context.parent)), 'and those contexts name their groups');

    const savings = r.pages.find(p => p.view === 'savings');
    const segs = savings.figures.filter(f => /^savingsWorth\/@worth-owned-seg\//.test(f.address) && f.kind === 'money');
    eq(new Set(segs.map(f => f.context.parent)).size, segs.length, 'each worth-chart segment carries its own context');

    eq(one(r.checks, 'savings', /^Worth chart: "Savings" segment/).status, 'pass', 'the Savings worth-chart segment is found and equals the implied savings total');
    ok(find(r.checks, 'savings', /Σ owned segments/).length === 1 && find(r.checks, 'savings', /Σ owed segments/).length === 1,
      'the two Σ-segment checks run at all (their selector matched nothing, and a .length guard hid that)');
    eq(one(r.checks, 'savings', /KPI "Savings" \(stated\) vs chart/).status, 'info', 'the KPI-vs-chart pair is measurable and differs by the drift');
    eq(one(r.checks, 'accounts', /Group "Savings" \(stated\)/).pageValue, 15000, 'the Accounts "Savings" group reads the Savings group total, not another group\'s');
  }

  /* ---- 4. Cash on hand ---------------------------------------------------- */
  {
    const r = await reconcile({ ...H });
    const cash = one(r.checks, 'dashboard', /cash in your accounts = cash on hand/);
    eq(cash.status, 'pass', 'the oracle and cashOnHand() agree on the fixture');
    eq(cash.pageValue, 28900, 'and the figure counts the pool (emergency fund) account');
    ok(!/confirmed|non-pool/.test(cash.formula), 'the formula text no longer claims "confirmed" or "non-pool"');
    eq(one(r.checks, 'dashboard', /accounts outside the budget - amount/).status, 'pass', 'no budget:false account, nothing held out, nothing printed');

    /* A household with an account it has taken OUT of the budget. */
    const files = { ...SEED, [`${B}/Accounts/Holiday fund.md`]: '---\ntype: checking\ntx_label: "Holiday fund"\nbudget: false\nbalance: 7000.00\nbalance_updated: 2026-09-01\n---\n' };
    const r2 = await reconcile({ files, budgetFolder: B, today: H.today, period: H.period });
    const cash2 = one(r2.checks, 'dashboard', /cash in your accounts = cash on hand/);
    eq(cash2.status, 'pass', 'the card leaves the budget:false account out and the oracle agrees');
    eq(cash2.pageValue, 28900, 'the figure did not move when the account arrived');
    /* What is held out is NAMED on the card ("1 account outside the budget not
       counted (R 7 000)") and the checker compares the sentence to its own
       reading of the same scope. It used to be an `info` row comparing the
       cash figure to itself plus the held-out money, which could not fail. */
    const held = one(r2.checks, 'dashboard', /accounts outside the budget - amount/);
    eq([held.status, held.pageValue, held.globalValue], ['pass', 7000, 7000], 'the sentence states exactly that account\'s money');
    ok(/Holiday fund/.test(held.note) && /Holiday fund/.test(held.globalSource), 'and the check NAMES it');
    const heldCount = one(r2.checks, 'dashboard', /accounts outside the budget - count/);
    eq([heldCount.status, heldCount.pageValue, heldCount.globalValue], ['pass', 1, 1], 'and its count');

    /* NEGATIVE CONTROLS: a sentence that is missing while an account is held out,
       and one that states the wrong amount, both fail. */
    const gone = clone(r2.pages);
    const dp = gone.find(p => p.view === 'dashboard');
    dp.figures = dp.figures.filter(f => !/@left-outside$/.test(f.address));
    eq(one(runChecks(r2.G, gone), 'dashboard', /accounts outside the budget - amount/).status, 'fail', 'no sentence although R7 000 is held out is a FAIL');
    const wrong = clone(r2.pages);
    const wf = wrong.find(p => p.view === 'dashboard').figures.find(f => /@left-outside$/.test(f.address) && f.kind === 'money');
    wf.raw = 700; wf.text = 'R 700';
    eq(one(runChecks(r2.G, wrong), 'dashboard', /accounts outside the budget - amount/).status, 'fail', 'a sentence stating the wrong amount is a FAIL');

    /* NEGATIVE CONTROL: a card that did count the account would now fail. */
    const pages = clone(r2.pages);
    const fig = pages.find(p => p.view === 'dashboard').figures.find(f => f.address === 'leftBody/@left-cash');
    fig.raw = fig.raw + 7000; fig.text = 'R 35 900';
    eq(one(runChecks(r2.G, pages), 'dashboard', /cash in your accounts = cash on hand/).status, 'fail', 'a cash figure that includes the budget:false account fails');
  }

  /* ---- 5. A note that should be there and is not -------------------------- */
  {
    const r = await reconcile({ ...H });
    const note = one(r.checks, 'budgets', /budTotalsTop: uncategorised/);
    eq(note.status, 'pass', 'absent below R1 is absent by design');
    ok(/not rendered/.test(note.pageSource), 'and the check says so');

    /* Give the household R300 of uncategorised spend so the note is drawn. */
    const withUncat = { ...SEED };
    const f = `${B}/Transactions/Cheque/2026-09.md`;
    withUncat[f] = SEED[f] + '| 2026-09-02 | Mystery | | -300.00 |  |  |  |\n';
    const r2 = await reconcile({ files: withUncat, budgetFolder: B, today: H.today, period: H.period });
    const drawn = one(r2.checks, 'budgets', /budTotalsTop: uncategorised/);
    eq([drawn.status, drawn.pageValue, drawn.globalValue], ['pass', 300, 300], 'a drawn note is compared to the seam as before');

    /* NEGATIVE CONTROL: the note vanishes from the page while the seam still
       says R300. This used to read `unverified`, which the gate pins as a
       fixture gap. */
    const pages = clone(r2.pages);
    const bp = pages.find(p => p.view === 'budgets');
    bp.figures = bp.figures.filter(x => !x.address.endsWith('@bud-note-uncat'));
    const gone = one(runChecks(r2.G, pages), 'budgets', /budTotalsTop: uncategorised/);
    eq(gone.status, 'fail', 'a note that fails to render while the seam says R300 is a FAIL');
    ok(/NOT RENDERED/.test(gone.pageSource), 'and the failure says what is missing');

    /* moved-to-funds rides in the set-aside sentence: its gate is set-aside. */
    const ms = one(r.checks, 'budgets', /budTotalsTop: moved to funds/);
    eq(ms.status, 'pass');
    const pages2 = clone(r.pages);
    const bp2 = pages2.find(p => p.view === 'budgets');
    bp2.figures = bp2.figures.filter(x => !x.address.endsWith('@bud-note-setaside'));
    const nosa = runChecks(r.G, pages2);
    eq([one(nosa, 'budgets', /budTotalsTop: set-aside note/).status, one(nosa, 'budgets', /budTotalsTop: moved to funds/).status], ['fail', 'fail'],
      'a missing set-aside sentence fails both the set-aside and the moved figure');
  }

  /* ---- 6. allocated is the app's ------------------------------------------ */
  {
    /* August: finished, actual income, NO budget file. allocatedShare answers
       0% (a zero plan beside real income); the checker's old `budget.income > 0
       ? … : null` answered null and the check went quiet. */
    const r = await reconcile({ ...H, period: '2026-08' });
    eq(r.G.figures.allocated, 0, "allocated is periodFigures.plan.allocated: 0%, not the checker's private null");
    eq(r.G.figures.allocated, r.G.figures.plan.allocated, 'and it IS the plan snapshot, carried through');
    const hero = one(r.checks, 'dashboard', /Hero: allocated of income/);
    ok(hero.status !== 'unverified', `so the Dashboard hero's allocated share is now actually compared (${hero.status})`);
  }

  /* ---- 7. Transactions window --------------------------------------------- */
  {
    /* The constant the checker assumes is the one the page uses. */
    const tx = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'transactions.js'), 'utf8');
    eq(Number((tx.match(/const PAGE = (\d+);/) || [])[1]), 100, 'transactions.js still windows at 100 rows — the checker\'s WINDOW must move with it');

    const f = `${B}/Transactions/Cheque/2026-09.md`;
    let extra = '';
    for (let i = 0; i < 105; i++) extra += `| 2026-09-0${1 + (i % 2)} | Coffee ${i} | Groceries | -${(10 + i).toFixed(2)} |  |  |  |\n`;
    const big = { ...SEED, [f]: SEED[f] + extra };
    const r = await reconcile({ files: big, budgetFolder: B, today: H.today, period: H.period });
    const rendered = one(r.checks, 'transactions', /Rows rendered = rows in the window/);
    eq([rendered.status, rendered.pageValue, rendered.globalValue], ['pass', 100, 100], 'a windowed table (100 of 115) passes on the window it announces');
    ok(/windowed/.test(rendered.note), 'and the note says it is windowed');
    eq(one(r.checks, 'transactions', /Rows selected = rows in period/).status, 'pass', 'the page selects every row in the period');
    const sum = one(r.checks, 'transactions', /Σ rendered amounts = Σ the window/);
    eq(sum.status, 'pass', 'the Σ check RUNS on a windowed table (it was skipped) and passes');
    eq(find(r.checks, 'transactions', /Σ rendered amounts = Σ raw rows/).length, 0, 'the whole-period sum is only claimed when the whole period is on screen');
    eq(failed(r.checks), [], 'and nothing fails on the larger household');

    /* NEGATIVE CONTROL: one amount cell drawn wrong. */
    const pages = clone(r.pages);
    const cell = pages.find(p => p.view === 'transactions').figures.find(x => /^txTable\/tbody\/tr\[\d+\]\/td\.num\[4\]$/.test(x.address) && x.kind === 'money');
    cell.raw = cell.raw + 1;
    eq(one(runChecks(r.G, pages), 'transactions', /Σ rendered amounts = Σ the window/).status, 'fail', 'a wrong amount in the window fails the sum');
  }

  /* ---- 8. The two untraced fails ------------------------------------------ */
  {
    const r = await reconcile({ ...H, today: '2026-10-05' });
    eq(failed(r.checks), [], 'nothing fails on the fixture at 2026-10-05');
    const drift = one(r.checks, 'dashboard', /^Stale note: drift$/);
    eq([drift.status, drift.pageValue, drift.globalValue], ['pass', 6100, 6100], 'the stale note prints the drift as a MAGNITUDE and is compared as one');
    const dir = one(r.checks, 'dashboard', /Stale note: drift direction/);
    eq([dir.status, dir.pageValue, dir.globalValue], ['pass', -1, -1], 'the direction the words carry ("less") matches the sign of the drift');

    /* NEGATIVE CONTROL: the sentence says "more" while the drift is downward. */
    const pages = clone(r.pages);
    const stale = pages.find(p => p.view === 'dashboard').figures.find(x => /^dashStale\//.test(x.address) && x.kind === 'money');
    stale.context.own = stale.context.own.replace(/less/, 'more');
    eq(one(runChecks(r.G, pages), 'dashboard', /Stale note: drift direction/).status, 'fail', 'a note that says "more" for a downward drift fails');
    const gone = clone(r.pages);
    const dp = gone.find(p => p.view === 'dashboard');
    dp.figures = dp.figures.filter(x => !/^dashStale\//.test(x.address));
    eq(one(runChecks(r.G, gone), 'dashboard', /^Stale note: drift$/).status, 'fail', 'a stale note that does not render while a balance is stale and drifted R6 100 fails');

    /* The ring: this household has no fixed-bill category, so the spending row
       reads "45% living costs · 78% budget used" and living costs is the FIRST
       figure, not the second. */
    const living = one(r.checks, 'score', /Ring: living costs/);
    eq([living.status, Math.round(living.pageValue), Math.round(living.globalValue)], ['pass', 45, 45], 'living costs reads the living-costs figure, not the budget-used one after it');
    eq(one(r.checks, 'score', /Ring: budget used \(six-period/).status, 'pass', 'and budget used reads its own');
    eq(one(r.checks, 'score', /spending row prints one percentage/).status, 'pass', 'the row prints one percentage per known measure');
  }

  /* ---- 9. Donut legend arithmetic ------------------------------------------ */
  {
    const r = await reconcile({ ...H, today: '2026-10-05' });
    const legend = one(r.checks, 'dashboard', /Donut legend: Change = Spent/);
    eq(legend.status, 'pass', 'on the fixture the legend adds up');
    ok(legend.globalValue >= 3, `and it compared real rows (${legend.globalValue})`);

    /* NEGATIVE CONTROL: the shape the ticket names — Change not equal to Spent
       minus the baseline printed beside it. */
    const pages = clone(r.pages);
    const delta = pages.find(p => p.view === 'dashboard').figures.find(f => /span\.dl-delta\[/.test(f.address) && f.kind === 'money' && /^−/.test(f.context.own));
    delta.raw = delta.raw + 100; delta.text = 'R 1 500';
    const bad = one(runChecks(r.G, pages), 'dashboard', /Donut legend: Change = Spent/);
    eq(bad.status, 'fail', 'a Change that is not Spent − baseline fails');
    ok(/page prints/.test(bad.pageSource), 'and names the row');
  }

  console.log(`PASS — the reconciliation's checkers are checked: 9 fixes pinned on the synthetic household, each with a negative control where it could pass by not looking (${n} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
