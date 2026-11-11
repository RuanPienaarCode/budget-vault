'use strict';
/* View maths, moved into the pure modules. 2026-11-11 audit, task 23.

   Two pieces of arithmetic sat inside views, between the strings, where no
   bare-node guard could reach them:

     - the Savings Growth tile's pool: which entries are in the household's
       currency, the totals over them, and how many of them "may be
       overstated" (views/savings.js growthTile). Now savings-math.js
       growthTileFigures and isHomeEntry, with `today` handed in.
     - the figure each Accounts row leads with (views/accounts.js
       liveBalance). Now figures.js liveBalance.

   A move, not a rewrite — so each is compared here with the code it replaced,
   restated from the commit before, on the committed households and on
   generated inputs chosen to reach every branch. And each is then held to the
   thing it has to agree with, which is what moving it was for: the growth
   tile's count to the pool its total is taken over, the row figure to the
   balance book the hero above it sums.

     node tests/view-maths-moved.test.cjs */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, harvestView, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const code = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

(async () => {
  const sm = require('../src/savings-math');
  const { growthTileFigures, isHomeEntry, growthTotals, totalReturn, chartable, poolCatType } = sm;
  const { splitByCurrency } = require('../src/currency');
  const { liveBalance, balanceReadable } = require('../src/figures');
  const { reconcile } = require('../src/reconcile');

  /* ---- 1. the growth tile's pool, against views/savings.js at 9a68c18 ----- */
  /* growthTile's three statements, with the view's closures made arguments:
     split = accts => splitByCurrency(accts, S.settings.currency),
     ret = e => totalReturn(e.account, e.rows, poolType, { today: todayIso() }). */
  function asItWas(entries, poolType, today, currency) {
    const split = accts => splitByCurrency(accts, currency);
    const ret = e => totalReturn(e.account, e.rows, poolType, { today });
    const homeEntry = e => !split([e.account]).others.length;
    const foreignEntries = entries.filter(e => !homeEntry(e));
    const g = growthTotals(entries.filter(homeEntry), poolType, { today });
    const overstated = entries.filter(homeEntry)
      .filter(e => { const r = ret(e); return chartable(e.account, r) && (r.trust === 'history-gap' || r.trust === 'no-records'); })
      .length;
    return { totals: g, overstated, foreign: foreignEntries };
  }

  /* Hand-built entries: one of each thing the pool has to decide about. */
  const poolType = name => ({ Interest: 'interest', Transfer: 'transfer', Salary: 'income' }[name] || 'expense');
  const row = (date, amount, cat = 'Transfer') => ({ date, amount, cat, desc: 'x' });
  const acct = (name, extra) => ({ name, type: 'savings', balance: 12000, balance_updated: '2026-08-31', ...extra });
  const ENTRIES = [
    /* measured, records from the start */
    { account: acct('Measured', { inception_date: '2026-01-01', starting_amount: 10000 }), rows: [row('2026-01-01', 10000), row('2026-03-01', 1000), row('2026-06-30', 400, 'Interest')] },
    /* measured, but its records begin long after it did */
    { account: acct('Late records', { inception_date: '2024-01-01', starting_amount: 5000 }), rows: [row('2026-07-01', 500)] },
    /* measured, no records at all */
    { account: acct('No records', { inception_date: '2025-01-01', starting_amount: 9000 }), rows: [] },
    /* no starting amount: unmeasured */
    { account: acct('Unmeasured'), rows: [row('2026-02-01', 2000)] },
    /* took out more than went in */
    { account: acct('Drawn down', { inception_date: '2026-01-01', starting_amount: 0, balance: 500 }), rows: [row('2026-02-01', 1000), row('2026-03-01', -3000)] },
    /* another currency: out of the pool, named */
    { account: acct('Dollars', { currency: '$', inception_date: '2026-01-01', starting_amount: 800, balance: 1000 }), rows: [] },
    /* the household's symbol, a foreign code: a conflict, and foreign */
    { account: acct('Conflicted', { currency: 'R', currency_code: 'USD', currency_conflict: { code: 'USD' }, inception_date: '2026-01-01', starting_amount: 100 }), rows: [] },
    /* the household's symbol stated outright, and with stray spaces */
    { account: acct('Stated home', { currency: ' R ', inception_date: '2026-01-01', starting_amount: 11000 }), rows: [] },
  ];
  /* Every subset of those eight, on three clocks and two household currencies. */
  let compared = 0;
  for (let mask = 0; mask < (1 << ENTRIES.length); mask++) {
    const entries = ENTRIES.filter((_, i) => mask & (1 << i));
    for (const today of ['2026-09-02', '2026-01-15', '2030-01-01']) {
      for (const currency of ['R', '$']) {
        eq(growthTileFigures(entries, poolType, { today, currency }), asItWas(entries, poolType, today, currency),
          `growthTileFigures equals the tile's own arithmetic (subset ${mask}, today ${today}, household ${currency})`);
        compared++;
      }
    }
  }
  ok(compared === 256 * 6, `${compared} pools compared`);

  /* Not a comparison of two empty answers: on the full list the tile has
     something to say on every line it prints. */
  const full = growthTileFigures(ENTRIES, poolType, { today: '2026-09-02', currency: 'R' });
  eq(full.foreign.map(e => e.account.name), ['Dollars', 'Conflicted'], 'the dollar account and the conflicted one are left out, in order, and named');
  ok(full.totals.measured >= 3 && full.totals.unmeasured >= 1 && full.totals.negCapital >= 1, `the pool holds measured, unmeasured and drawn-down accounts (${JSON.stringify(full.totals)})`);
  ok(full.overstated >= 2, `and two of the measured ones may be overstated — records that start late, and none at all (${full.overstated})`);
  ok(full.overstated <= full.totals.measured, 'the overstated count is taken over the pool the total is taken over: it can never exceed "measured", which the tile prints it against');

  eq(ENTRIES.map(e => isHomeEntry(e, 'R')), [true, true, true, true, true, false, false, true], 'isHomeEntry: a foreign symbol and a conflicted code are out; a stated home symbol, padded or not, is in');
  eq(ENTRIES.map(e => isHomeEntry(e, 'R')), ENTRIES.map(e => !splitByCurrency([e.account], 'R').others.length), 'and it is the test the view made through splitByCurrency');

  /* `today` is the argument's, never the clock's: the same pool on two days
     can differ, and on one day cannot. */
  const unpinA = pinClock('2031-06-01');
  const onA = growthTileFigures(ENTRIES, poolType, { today: '2026-09-02', currency: 'R' });
  unpinA();
  const unpinB = pinClock('2026-01-02');
  const onB = growthTileFigures(ENTRIES, poolType, { today: '2026-09-02', currency: 'R' });
  unpinB();
  eq(onA, onB, 'handed the same `today`, the answer is the same whatever the wall clock says');
  eq(onA, full, 'and it is the answer for that day');

  /* ---- 2. liveBalance, against views/accounts.js at 9a68c18 --------------- */
  const was = (a, rec) => {
    const unreadableBalance = x => !balanceReadable(x);
    if (unreadableBalance(a)) return a.balance;
    return rec && rec.state === 'drift' ? rec.implied : a.balance;
  };
  const ACCOUNTS = [
    { balance: 100 }, { balance: 0 }, { balance: -250.5 },
    { balance: 0, balanceRaw: 'about 300' },          // unreadable: parsed to 0, text kept
    { balance: 1234.56, balanceRaw: '1 234,56' },     // kept text that IS real money
    { balance: undefined }, {},
  ];
  const VERDICTS = [undefined, null, {}, { state: 'clean', implied: 7 }, { state: 'drift', implied: 7 }, { state: 'drift', implied: 0 },
    { state: 'drift', implied: -3.2 }, { state: 'drift' }, { state: 'no-date', implied: 9 }, { state: 'stale', implied: 9 }];
  for (const a of ACCOUNTS) for (const rec of VERDICTS) {
    eq(liveBalance(a, rec), was(a, rec), `liveBalance equals the view's rule for ${JSON.stringify(a)} / ${JSON.stringify(rec)}`);
  }
  eq(liveBalance({ balance: 100 }, { state: 'drift', implied: 80 }), 80, 'a drifted account reads its implied balance');
  eq(liveBalance({ balance: 100 }, { state: 'clean', implied: 80 }), 100, 'any other verdict leaves the stated one');
  eq(liveBalance({ balance: 0, balanceRaw: 'about 300' }, { state: 'drift', implied: -500 }), 0,
    'an unreadable balance is never rolled forward — a fabricated zero plus real rows is a number nobody ever had');
  eq(liveBalance({ balance: 1234.56, balanceRaw: '1 234,56' }, { state: 'drift', implied: 1000 }), 1000,
    'while a balance typed with a comma is real money and rolls forward like any other');

  /* ---- 3. on the households: the row figure is the book's ----------------- */
  for (const name of ['household', 'household2', 'household-fx']) {
    const H = require(`./figures/${name}.cjs`);
    const unpin = pinClock(H.TODAY);
    try {
      const M = await mountFor(H.SEED, { period: H.PERIOD, budgetFolder: H.B });
      const { ctx, S } = M;
      const book = ctx.bookFigures();
      const implied = new Map(ctx.impliedAccounts().map(a => [a.name, a.balance]));
      let drifted = 0;
      for (const a of S.accounts) {
        const rec = book.reconciled.get(a);
        if (rec.state === 'drift') drifted++;
        eq(liveBalance(a, rec), was(a, rec), `${name} / ${a.name}: the moved rule and the view's agree`);
        eq(liveBalance(a, rec), implied.get(a.name), `${name} / ${a.name}: the row's live figure is impliedAccounts()'s — one rule for "what this account reads now"`);
        eq(liveBalance(a, rec), liveBalance(a, reconcile(a, (ctx.accountIndex().get(a) || {}).rows || [], H.TODAY)), `${name} / ${a.name}: and it does not depend on who reconciled`);
      }
      ok(drifted >= 1, `${name}: at least one account has drifted, so "implied" and "stated" were different figures to choose between (${drifted})`);
      /* The page prints it: every row's balance is one of these figures. */
      const rows = harvestView(ctx, M.nodes, M.raws, { view: 'accounts', fn: 'renderAccounts' }).figures
        .filter(f => f.address === 'acctTable/@acct-bal').map(f => f.raw).sort((x, y) => x - y);
      eq(rows, S.accounts.filter(balanceReadable).map(a => liveBalance(a, book.reconciled.get(a))).sort((x, y) => x - y),
        `${name}: the balance column on the Accounts page is liveBalance of each readable account`);

      /* And the growth tile's pool, on a real household's own savings entries. */
      const typeOf = n => poolCatType(S.categories, n);
      const idx = ctx.accountIndex();
      const entries = S.accounts.filter(a => ['savings', 'investment'].includes(String(a.type).toLowerCase()))
        .map(a => ({ account: a, rows: (idx.get(a) || {}).rows || [] }));
      eq(growthTileFigures(entries, typeOf, { today: H.TODAY, currency: S.settings.currency }), asItWas(entries, typeOf, H.TODAY, S.settings.currency),
        `${name}: growthTileFigures equals the tile's own arithmetic over the household's ${entries.length} pool account(s)`);
      M.restore();
    } finally { unpin(); }
  }

  /* ---- 4. and it is gone from the views ----------------------------------- */
  const savings = code('src/views/savings.js');
  ok(/=\s*growthTileFigures\(entries, poolType, \{ today: todayIso\(\), currency: S\.settings\.currency \}\);/.test(savings), 'views/savings.js growthTile reads its pool from growthTileFigures, handing the clock in');
  eq(/r\.trust === 'history-gap'/.test(savings.slice(savings.indexOf('function growthTile'), savings.indexOf('function growthTile') + 6000)), false,
    'and no longer counts the overstated accounts itself');
  eq(/growthTotals\(/.test(savings), false, 'nor pools growthTotals itself');
  ok(/const homeEntry = e => isHomeEntry\(e, S\.settings\.currency\);/.test(savings), 'its homeEntry is savings-math.js isHomeEntry');
  const accounts = code('src/views/accounts.js');
  eq(/function liveBalance\(/.test(accounts), false, 'views/accounts.js no longer defines liveBalance');
  ok(/liveBalance \} = require\('\.\.\/figures'\)/.test(accounts) && /live: liveBalance\(a, st\.rec\)/.test(accounts), 'it imports figures.js liveBalance and leads each row with it');

  console.log(`PASS view-maths-moved — the growth tile's pool and the Accounts live balance are pure, and equal the code they replaced (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
