'use strict';
/* Growth is measured on ONE as-of: what the account holds today against what
   was put into it through today.

   The defect this pins (audit of 7 Oct 2026): totalReturn() subtracted capital
   counted to TODAY from a balance STATED on an earlier date. A debit order
   dated after the stated balance sat in "put in" and could not be in the
   balance, so the card reported growth short by exactly that debit order — and
   a withdrawal dated after the statement flipped the error into an
   overstatement. On the vault the audit ran against, one fund's card, the pool
   Growth tile, the Accounts goal cell and drawer, and the Report's savings
   section were all a whole debit order short. The committed household fixture
   carried the same error (its emergency fund read R5 500 of growth for R5 000).

   The rule decided on the day (the audit's default): growth is measured on the
   IMPLIED balance — the stated figure rolled forward by the rows dated after
   it, which is reconcile()'s reading and the one impliedAccounts() hands every
   other page — with capital counted to the same day. "Put in" keeps every
   contribution through today; a row dated after today is in neither.

   Pinned here, each against the real code:
     1. the as-of rule itself, in both directions the old error ran;
     2. the balance it is measured on IS the app's implied balance — read
        through period.js's impliedAccounts() over the committed households,
        so a second spelling of "rolled forward" cannot creep in;
     3. the chart identity on the new basis — capital + posted + undated =
        closing = Σ implied balances — and the bands still window by
        inception_date exactly as the capital sum does;
     4. an account with NO records is told so, rather than "records begin N
        days after it opened";
     5. the Savings page prints all of it, and says what the figure is
        measured on when that is not the balance the reader typed;
     6. a NEGATIVE CONTROL: savings-math.js copied and reverted to the old
        rule fails assertion 1, so this file cannot pass against the bug.

     node tests/savings-growth-as-of-today.test.cjs */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const { totalReturn, growthSeries, growthTotals } = require('../src/savings-math');
const { reconcile } = require('../src/reconcile');

const TODAY = '2026-10-07';
const typeOf = c => (c === 'Interest' ? 'interest' : null);
const row = (date, amount, cat = '') => ({ date, amount, cat });

/* A fund confirmed at R40 000 on 12 August. R30 000 at opening, a R5 000
   transfer in March last year, a R1 500 debit order on 3 September (after the
   confirmation, so not in the R40 000) and one scheduled for 2 November (after
   today, so in nothing yet).

     implied today   40 000 + 1 500                 = 41 500
     put in          30 000 + 5 000 + 1 500         = 36 500
     growth          41 500 − 36 500                =  5 000

   The old rule read 40 000 − (30 000 + 5 000 + 1 500 + 1 000) = 2 500. */
const FUND = {
  name: 'Fund', type: 'investment', balance: 40000, balance_updated: '2026-08-12',
  starting_amount: 30000, inception_date: '2025-02-15',
};
const FUND_ROWS = [row('2025-03-01', 5000), row('2026-09-03', 1500), row('2026-11-02', 1000)];

/* ---- 1. the as-of rule, contributions after the statement ---- */
{
  const r = totalReturn(FUND, FUND_ROWS, typeOf, { today: TODAY });
  eq(r.basis, 'measured', 'fixture: a starting amount and an opening date make this measurable');
  near(r.growth, 5000, 'growth is the implied balance today less what was put in through today');
  near(r.capitalIn, 36500, '"put in" keeps the debit order dated after the statement');
  near(r.balance, 41500, 'and the balance it is measured on is the stated one rolled forward');
  near(r.statedBalance, 40000, 'the balance the reader typed travels with it, unchanged');
  eq(r.balanceBasis, 'implied', 'and the result says which of the two it measured');
  eq(r.sinceStated, 1, 'and how many transactions rolled it forward');
  near(r.capitalIn + r.growth, r.balance, 'put in + growth = the balance it was measured on');
  near(r.returnPct, (5000 / 36500) * 100, 'the return divides the same two figures');
  const oldRule = FUND.balance - (30000 + 5000 + 1500 + 1000);
  ok(Math.abs(r.growth - oldRule) > 1,
    `negative control: the old stated-minus-everything figure (${oldRule}) is not what is reported`);
}

/* ---- 1b. the error ran the other way after a withdrawal ---- */
{
  const r = totalReturn({ ...FUND, name: 'Drawn' },
    [row('2025-03-01', 5000), row('2026-09-03', -3000)], typeOf, { today: TODAY });
  near(r.balance, 37000, 'a withdrawal after the statement lowers the implied balance');
  near(r.capitalIn, 32000, 'and the capital by the same amount');
  near(r.growth, 5000, 'so growth is unmoved by it, as it must be');
  ok(Math.abs(r.growth - (40000 - 32000)) > 1, 'negative control: not the old overstated 8 000');
}

/* ---- 1c. a confirmed balance is measured exactly as before ---- */
{
  const r = totalReturn({ ...FUND, balance_updated: '2026-10-01' },
    [row('2025-03-01', 5000), row('2026-09-03', 1500)], typeOf, { today: TODAY });
  eq(r.balanceBasis, 'stated', 'nothing dated after the confirmation: the stated balance is the measure');
  near(r.balance, 40000, 'so nothing is rolled forward');
  near(r.growth, 40000 - 36500, 'and growth is the stated balance less what was put in');
  eq(r.sinceStated, 0, 'with nothing counted since');
}

/* ---- 1d. the measured balance is reconcile()'s, not a second spelling ---- */
{
  const rec = reconcile(FUND, FUND_ROWS, TODAY);
  eq(rec.state, 'drift', 'fixture: the 3 September row is a drift against the 12 August balance');
  near(totalReturn(FUND, FUND_ROWS, typeOf, { today: TODAY }).balance, rec.implied,
    'the balance growth is measured on is reconcile()\'s implied figure, to the cent');
}

/* ---- 2. the chart identity on the new basis, and the shared window ----
   Five accounts chosen to break it: a drift (FUND), a drift that withdrew, a
   confirmed one, one with rows before its opening date, and one carrying an
   undatable row. Σ implied is computed with reconcile() directly, so the
   identity is checked against the app's seam rather than against growthSeries
   itself. */
{
  const entries = [
    { account: FUND, rows: FUND_ROWS },
    { account: { ...FUND, name: 'Drawn' }, rows: [row('2025-03-01', 5000), row('2026-09-03', -3000)] },
    { account: { ...FUND, name: 'Confirmed', balance_updated: '2026-10-01' }, rows: [row('2025-03-01', 5000), row('2026-09-03', 1500)] },
    { account: { ...FUND, name: 'Early', inception_date: '2026-01-01', starting_amount: 35000 },
      rows: [row('2025-03-01', 5000), row('2026-02-01', 500, 'Interest'), row('2026-09-03', 1500)] },
    /* 30 February and month 13: no month to bucket either under, so both
       take the pending path into the first point — the second although its
       string sorts after today, because a date that names no day is not
       "after" anything (savings-math.js's pastAsOf). */
    { account: { ...FUND, name: 'Odd', balance_updated: '2026-08-12' },
      rows: [row('2025-03-01', 5000), row('2026-02-30', 300), row('2026-13-05', 150), row('2026-09-15', 1000)] },
  ];
  const s = growthSeries(entries, typeOf, { today: TODAY });
  eq(s.included, 5, 'every account is measurable and placeable');
  const last = s.points[s.points.length - 1];
  near(last.capital + last.posted + s.undated, s.closing, 'capital + posted + undated = closing');
  const impliedSum = entries.reduce((t, e) => {
    const rec = reconcile(e.account, e.rows, TODAY);
    return t + (rec.state === 'drift' ? rec.implied : e.account.balance);
  }, 0);
  near(s.closing, impliedSum, 'and closing is the sum of the IMPLIED balances, the same as-of as the cards');

  const rs = entries.map(e => totalReturn(e.account, e.rows, typeOf, { today: TODAY }));
  near(last.capital, rs.reduce((t, r) => t + r.capitalIn, 0),
    'the capital band ends on Σ capitalIn: the bands window by inception_date and today exactly as the sum does');
  near(last.posted, rs.reduce((t, r) => t + r.postedGrowth, 0), 'and the posted band on Σ posted growth');
  near(s.undated, rs.reduce((t, r) => t + r.undatedGrowth, 0), 'and undated is what the cards call undated');
  eq(last.month, '2026-10', 'the walk ends on today\'s month: nothing after today is in a band any more');
  near(rs[4].capitalIn, 30000 + 5000 + 300 + 150 + 1000,
    'an undatable row is counted whatever its string sorts against today — only a REAL later date is held out');

  const g = growthTotals(entries, typeOf, { today: TODAY });
  near(g.growth, rs.reduce((t, r) => t + r.growth, 0), 'the pool total is the sum of the cards');
  near(g.growth + last.capital, s.closing, 'and the tile, the chart and the cards are one reading');
}

/* ---- 3. no records at all is its own caveat ----
   A fund opened with a starting amount and never imported: the old code
   measured the "gap" to today and said records begin N days after opening.
   There are no records. */
{
  const none = totalReturn({ name: 'Lump', type: 'investment', balance: 23000, balance_updated: '2026-09-14',
    starting_amount: 20000, inception_date: '2025-06-20' }, [], typeOf, { today: TODAY });
  eq(none.trust, 'no-records', 'an account with no transactions at all is flagged as having none');
  eq(none.gapDays, 474, 'with the days since it opened');
  near(none.growth, 3000, 'and its figure is still shown — the balance less the starting amount');

  const late = totalReturn({ ...FUND, inception_date: '2025-01-01' }, FUND_ROWS, typeOf, { today: TODAY });
  eq(late.trust, 'history-gap', 'a record that starts late is still the history gap it always was');
  eq(late.gapDays, 59, 'measured to the first real row');

  const young = totalReturn({ ...FUND, inception_date: '2026-09-20' }, [], typeOf, { today: TODAY });
  eq(young.trust, 'ok', 'an account opened a fortnight ago with nothing yet is not a gap of any kind');
}

/* ---- 4. the committed households: the fixture figure, and seam parity ----
   Loaded through the REAL loader, with the clock pinned to each fixture's own
   day, and compared against period.js's impliedAccounts() — the seam every
   other page reads balances through. */
(async () => {
  for (const name of ['household', 'household2']) {
    const { SEED, TODAY: DAY } = require(`./figures/${name}.cjs`);
    const unpin = pinClock(DAY);
    try {
      const ctx = makeCtx({ ...SEED });
      const S = await loadInto(ctx);
      const idx = ctx.accountIndex();
      const implied = ctx.impliedAccounts(DAY);
      const { poolCatType } = require('../src/savings-math');
      const pool = c => poolCatType(S.categories, c);
      for (const a of S.accounts.filter(x => ['savings', 'investment'].includes(String(x.type).toLowerCase()))) {
        const r = totalReturn(a, (idx.get(a) || {}).rows || [], pool, { today: DAY });
        near(r.balance, implied.find(x => x.name === a.name).balance,
          `${name}: ${a.name} is measured on impliedAccounts()'s own balance`);
        if (name === 'household' && a.name === 'Emergency fund') {
          near(r.growth, 5000, 'household.cjs: the emergency fund earned R5 000, not the R5 500 the old rule read');
          near(r.capitalIn, 9500, 'household.cjs: on R9 500 put in');
        }
      }
    } finally { unpin(); }
  }

  /* ---- 5. the Savings page ---- */
  const B = 'Budget';
  const TX = rows => '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n'
    + `|---|---|---|---:|---|---|\n${rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} | yes |  |`).join('\n')}\n`;
  const FILES = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
    [`${B}/Categories/Interest.md`]: '---\ntype: income\ninterest: true\ncolor: "#27ae60"\n---\n',
    [`${B}/Accounts/Fund.md`]: '---\ntype: investment\ntx_label: "Fund"\nbalance: 40000.00\nbalance_updated: 2026-08-12\n'
      + 'starting_amount: 30000.00\ninception_date: 2025-02-15\n---\n',
    [`${B}/Accounts/Lump.md`]: '---\ntype: investment\nbalance: 23000.00\nbalance_updated: 2026-09-14\n'
      + 'starting_amount: 20000.00\ninception_date: 2025-06-20\n---\n',
    [`${B}/Transactions/Fund/2025-03.md`]: TX([['2025-03-01', 'Transfer in', '', 5000]]),
    [`${B}/Transactions/Fund/2026-09.md`]: TX([['2026-09-03', 'Debit order', '', 1500]]),
    [`${B}/Transactions/Fund/2026-11.md`]: TX([['2026-11-02', 'Debit order', '', 1000]]),
  };
  const unpin = pinClock(TODAY);
  try {
    const ctx = makeCtx(FILES);
    const S = await loadInto(ctx);
    S.period = '2026-10';
    const { $ } = makeDom();
    ctx.$ = $;
    ctx.root = $('#root');
    ctx.money = (v, dp = 2) => `R${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (sym, v, dp = 2) => `${sym}${Number(v).toFixed(dp)}`;
    ctx.switchView = () => {};
    ctx.render = () => {};
    require('../src/views/savings')(ctx);
    ctx.renderSavings();

    const flat = n => String(n.textContent).replace(/\s+/g, ' ').trim();
    const tile = descend($('#savingsKpis')).filter(n => n._cls.has('mini')).map(flat).find(t => t.startsWith('Growth'));
    ok(tile && tile.includes('▲ R8000.00'),
      `the Growth tile sums R5 000 + R3 000 on the as-of rule (got "${tile}")`);
    ok(tile.includes('on R56500 put in'), `on every rand put in through today (got "${tile}")`);

    const card = name => descend($('#savingsSections')).find(n => n._cls.has('mini')
      && String(n.children[0] && n.children[0].textContent) === name);
    const fund = flat(card('Fund'));
    ok(fund.includes('put in R36500 · ▲ R5000'), `the card states put in and growth on one as-of (got "${fund}")`);
    ok(/measured on R41500 — your 2026-08-12 balance plus 1 transaction since/.test(fund),
      `and says what it measured on, since that is not the balance typed (got "${fund}")`);
    ok(!/records begin/.test(fund), 'a fund whose records start on time carries no gap caveat');

    const lump = flat(card('Lump'));
    ok(/no transactions recorded in the 474 days since it opened/.test(lump),
      `an account with no records says exactly that (got "${lump}")`);
    ok(!/records begin/.test(lump), 'and never that records begin after it opened — there are none');
    ok(!/measured on/.test(lump), 'nothing rolled forward on a confirmed balance with no rows, so no basis caveat');

    const total = flat($('#savingsGrowthTotal'));
    ok(total.includes('R64500.00'), `the chart totals the implied balances, 41 500 + 23 000 (got "${total}")`);
    /* …and says so beside it, because the cards above print the TYPED R40 000:
       a total R1 500 above the balances on screen, unexplained, is the page
       contradicting itself. */
    const sub = flat($('#savingsGrowthSub'));
    ok(/as of today — R1500 more than the stated balances, from transactions recorded since/.test(sub),
      `the chart names the roll-forward its total includes (got "${sub}")`);
  } finally { unpin(); }

  /* ---- 6. NEGATIVE CONTROL: the old rule, reverted in a scratch copy ----
     The two lines that ARE the fix — the measured balance and the as-of bound
     on the capital sum — swapped back to what shipped in 1.49.1. Section 1's
     central assertion must then fail, or this file proves nothing. A missing
     target throws, so a refactor cannot turn this control into a no-op. */
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savings-as-of-nc-'));
    fs.cpSync(SRC, dir, { recursive: true });
    const file = path.join(dir, 'savings-math.js');
    let src = fs.readFileSync(file, 'utf8');
    const swap = (find, replace) => {
      if (!src.includes(find)) throw new Error(`negative control: "${find}" no longer in savings-math.js — update the control`);
      src = src.replace(find, replace);
    };
    swap("const balance = rec.state === 'drift' ? rec.implied : stated;", 'const balance = stated;');
    swap('const f = splitFlows(rows, typeOf, { from, to: today });', 'const f = held;');
    fs.writeFileSync(file, src);
    const reverted = require(file).totalReturn(FUND, FUND_ROWS, typeOf, { today: TODAY });
    ok(Math.abs(reverted.growth - 5000) > 1,
      `NEGATIVE CONTROL: with the old rule restored, growth reads ${reverted.growth}, so section 1 would fail`);
    near(reverted.growth, 2500, 'NEGATIVE CONTROL: exactly the old stated-minus-everything figure');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`PASS — growth is measured on one as-of, implied balance against capital to today (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
