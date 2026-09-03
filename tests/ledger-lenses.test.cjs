'use strict';
/* The ledger and its lenses, as properties. Phase 2 of ADR-0006.

   What this suite pins is not any one figure — those have suites already —
   but the shape that makes "two figures derived by different rules"
   impossible to write by accident:

     1. CONSERVATION, under every lens: every rand a lens keeps lands in
        exactly one bucket, and the buckets add back to `net`. The oracle is
        an independent filter over the same rows, restating each lens's
        vetoes in three lines, the way tests/summary-conservation.test.cjs
        does for the one walk it covers.
     2. DIFFERENCE IS EXACTLY THE VETOES: for any two lenses, the gap between
        their nets is the signed sum of the rows lensDifference() names, and
        nothing else. A fourth lens written tomorrow inherits this test.
     3. THE OLD SEAMS ARE THE NEW TALLY: summaryInRange, periodSpend and the
        household walk in healthSnapshot return exactly what tally() returns
        under BUDGET, TREND and HOUSEHOLD — proved against the real loader on
        randomised vaults, not on a fixture chosen to agree.
     4. THE LENSES SAY WHAT THEY DROP: BUDGET and TREND differ by exactly
        earmarkedOut on any vault (the ISSUE 41 gap, preserved and named).

     node tests/ledger-lenses.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { stamp, tally, LENSES, lensDifference, keeps } = require('../src/ledger');
const { supersededBySplit } = require('../src/tx-role');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const c = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };
const eqMoney = (a, b, m) => eq(c(a), c(b), `${m} (got ${a}, want ${b})`);

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  | ${r[5] || ''} |\n`).join('')}`;
const CATS = ['Salary', 'Groceries', 'Rent', 'Emergency', 'Move', 'Ghost', ''];
const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\nfixed: true\n---\n',
  [`${B}/Categories/Rent.md`]: '---\ntype: housing\ncolor: "#888888"\nfixed: true\n---\n',
  [`${B}/Categories/Emergency.md`]: '---\ntype: savings\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Move.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-08-31\n---\n',
  [`${B}/Accounts/Joint.md`]: '---\ntype: checking\ntx_label: "Joint"\nbudget: false\nbalance: 1000.00\nbalance_updated: 2026-08-31\n---\n',
  [`${B}/Accounts/Fund.md`]: '---\ntype: savings\ntx_label: "Fund"\ngoal_amount: 50000\nbalance: 5000.00\nbalance_updated: 2026-08-31\n---\n',
  [`${B}/Accounts/Euro.md`]: '---\ntype: checking\ntx_label: "Euro"\ncurrency: "€"\nbalance: 100.00\nbalance_updated: 2026-08-31\n---\n',
};
const LABELS = ['Cheque', 'Joint', 'Fund', 'Euro'];

/* Deterministic PRNG so a failure names a round that reproduces. */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function randomVault(rnd) {
  const files = { ...BASE };
  const per = {}; for (const L of LABELS) per[L] = [];
  const n = 8 + Math.floor(rnd() * 20);
  for (let i = 0; i < n; i++) {
    const L = LABELS[Math.floor(rnd() * LABELS.length)];
    const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
    const cat = CATS[Math.floor(rnd() * CATS.length)];
    let amount = Math.round((rnd() * 4000 - 2500) * 100) / 100;
    if (!amount) amount = 10;
    per[L].push([`2026-08-${day}`, `row ${i}`, cat, amount, rnd() < 0.15 ? 'yes' : '', '']);
  }
  /* A pass-through pair: an excluded outflow on one account and its equal
     excluded inflow on another — the shape HOUSEHOLD drops as one movement. */
  if (rnd() < 0.7) {
    per.Cheque.push(['2026-08-14', 'card settle', '', -1234.56, 'yes', '']);
    per.Joint.push(['2026-08-14', 'card settle', '', 1234.56, 'yes', '']);
  }
  /* A split: the parent (excluded, split=parent) and its two parts. */
  if (rnd() < 0.5) {
    per.Cheque.push(['2026-08-20', 'big shop', 'Groceries', -900, 'yes', 'parent']);
    per.Cheque.push(['2026-08-20', 'big shop', 'Groceries', -600, '', 'part']);
    per.Cheque.push(['2026-08-20', 'big shop', 'Rent', -300, '', 'part']);
  }
  for (const L of LABELS) if (per[L].length) files[`${B}/Transactions/${L}/2026-08.md`] = txFile(per[L]);
  return files;
}

async function mount(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  return ctx;
}

/* The independent oracle: each lens's vetoes restated from the stamps a
   reader can see on the raw row and the account files, never asked of
   tally() or of the seams. */
function oracleKeeps(ctx, lensName, t, paired) {
  const a = ctx.accountForLabel(t.label);
  const nonBudget = !!a && !a.in_budget;
  const foreign = !!a && !!a.currency && a.currency !== ctx.S.settings.currency;
  const earmarkedOut = t.amount < 0 && !!a && ctx.earmarkedLabels().has(t.label);
  const transfer = ctx.catType(t.cat) === 'transfer';
  switch (lensName) {
    case 'BUDGET': return !t.excluded && !nonBudget && !foreign && !earmarkedOut && !transfer;
    case 'TREND': return !t.excluded && !nonBudget && !foreign && !transfer;
    case 'HOUSEHOLD': return !foreign && !transfer && !supersededBySplit(t)
      && !paired.has(`${t.label}|${t.date}|${(t.amount || 0).toFixed(2)}|${t.desc || ''}`);
    default: throw new Error(lensName);
  }
}

(async () => {
  const rnd = rng(20260903);
  let rounds = 0;
  for (let round = 0; round < 40; round++) {
    const ctx = await mount(randomVault(rnd));
    const rows = ctx.txInPeriod('2026-08');
    if (!rows.length) continue;
    rounds++;
    const stamped = ctx.ledger('2026-08-01', '2026-08-31');
    eq(stamped.length, rows.length, `round ${round}: every row is stamped, none invented`);
    const { passthroughPairs } = require('../src/ledger');
    const paired = passthroughPairs(rows);

    /* ---- 1. conservation under every lens ------------------------------ */
    for (const lens of Object.values(LENSES)) {
      const t = tally(stamped, lens);
      const oracle = rows.filter(r => oracleKeeps(ctx, lens.name, r, paired));
      eqMoney(t.net, oracle.reduce((s, r) => s + r.amount, 0), `round ${round} ${lens.name}: net === an independent sum over the rows the lens keeps`);
      const inflowOther = t.uncatIncome + t.unknown.income
        + t.kept.filter(s => s.cat && s.known && s.type !== 'income' && s.amount > 0).reduce((s, x) => s + x.amount, 0);
      eqMoney(t.net, t.income - t.spend + inflowOther, `round ${round} ${lens.name}: income − spend + everything else in === net`);
      eqMoney(Object.values(t.byCat).reduce((s, v) => s + v, 0), t.net, `round ${round} ${lens.name}: byCat sums to net`);
      eqMoney(t.inflow + t.outflow, t.net, `round ${round} ${lens.name}: signed halves sum to net`);
      eq(t.kept.length, oracle.length, `round ${round} ${lens.name}: the oracle and the tally keep the same number of rows`);
    }

    /* ---- 2. the difference between two lenses is exactly its rows ------- */
    const names = Object.keys(LENSES);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const A = LENSES[names[i]], Bl = LENSES[names[j]];
      const d = lensDifference(stamped, A, Bl);
      const gap = tally(stamped, A).net - tally(stamped, Bl).net;
      const named = d[A.name].reduce((s, x) => s + x.amount, 0) - d[Bl.name].reduce((s, x) => s + x.amount, 0);
      eqMoney(gap, named, `round ${round}: ${A.name} − ${Bl.name} is exactly the rows lensDifference names`);
    }

    /* ---- 3. the old seams ARE the tally --------------------------------- */
    const sum = ctx.periodSummary('2026-08');   // finished period: the whole window, no as-of clamp
    const tb = tally(stamped, LENSES.BUDGET);
    for (const k of ['income', 'spend', 'net', 'setAside', 'uncategorised', 'uncatSpend', 'uncatIncome', 'count']) {
      eqMoney(sum[k], tb[k], `round ${round}: summaryInRange.${k} === tally(BUDGET).${k}`);
    }
    eq(sum.unknown, tb.unknown, `round ${round}: unknown buckets agree, names in first-seen order`);
    eq(sum.foreign, tb.foreign, `round ${round}: foreign disclosure agrees`);
    eq(sum.fundedFromSavings, tb.fundedFromSavings, `round ${round}: funded-from-savings disclosure agrees`);
    eq(Object.keys(sum.byCat).sort(), Object.keys(tb.byCat).sort(), `round ${round}: byCat keys agree`);
    for (const k of Object.keys(sum.byCat)) eqMoney(sum.byCat[k], tb.byCat[k], `round ${round}: byCat[${k}] agrees`);

    const sp = ctx.periodSpend('2026-08', null);
    const tt = tally(stamped, LENSES.TREND);
    eq(sp.count, tt.count, `round ${round}: periodSpend.count === tally(TREND).count`);
    eq(Object.keys(sp.whole).sort(), Object.keys(tt.spendByCat).sort(), `round ${round}: periodSpend.whole keys === tally(TREND).spendByCat keys`);
    for (const k of Object.keys(sp.whole)) eqMoney(sp.whole[k], tt.spendByCat[k], `round ${round}: periodSpend.whole[${k}] agrees`);

    /* ---- 4. BUDGET and TREND differ by exactly earmarkedOut -------------- */
    const d = lensDifference(stamped, LENSES.BUDGET, LENSES.TREND);
    eq(d.BUDGET, [], `round ${round}: nothing is in BUDGET and not in TREND`);
    ok(d.TREND.every(s => s.earmarkedOut), `round ${round}: every row TREND keeps and BUDGET drops is a fund outflow (ISSUE 41)`);
  }
  ok(rounds >= 30, `enough non-empty rounds ran (${rounds})`);

  /* ---- 5. the household walk, on a vault built to exercise every stamp --- */
  {
    const ctx = await mount({
      ...BASE,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-01', 'Salary', 'Salary', 30000],
        ['2026-07-03', 'Shop', 'Groceries', -5000],
        ['2026-07-04', 'Refund', 'Groceries', 400],
        ['2026-07-05', 'Car service', 'Groceries', -3000, 'yes'],
        ['2026-07-06', 'Deposit', '', 2500],
        ['2026-07-07', 'Cash', '', -700],
        ['2026-07-10', 'To fund', 'Emergency', -2000],
        ['2026-07-14', 'Card settle', '', -1234.56, 'yes'],
        ['2026-07-15', 'Shuffle', 'Move', -100],
      ]),
      [`${B}/Transactions/Fund/2026-07.md`]: txFile([['2026-07-10', 'From cheque', 'Emergency', 2000], ['2026-07-22', 'Pram', 'Groceries', -1500]]),
      [`${B}/Transactions/Joint/2026-07.md`]: txFile([['2026-07-02', 'Rent', 'Rent', -9000], ['2026-07-14', 'Card settle', '', 1234.56, 'yes']]),
      [`${B}/Transactions/Euro/2026-07.md`]: txFile([['2026-07-09', 'Coffee', 'Groceries', -3]]),
    });
    const stamped = ctx.ledger('2026-07-01', '2026-07-31');
    const h = tally(stamped, LENSES.HOUSEHOLD);
    // kept: everything but the euro row, the Move row and the two settle legs
    eqMoney(h.net, 30000 - 5000 + 400 - 3000 + 2500 - 700 - 2000 + 2000 - 1500 - 9000, 'HOUSEHOLD keeps the excluded car service and the joint rent, drops the settle pair');
    eqMoney(h.consumption, 4600 + 3000 + 1500 + 9000 - 0, 'consumption: net Groceries (5000−400+3000+1500) + Rent; Emergency nets to zero and is set-aside anyway');
    eqMoney(h.fixed, 4600 + 3000 + 1500 + 9000, 'fixed: Groceries and Rent are flagged');
    eqMoney(h.netIncome, 30000, 'netIncome is positive income-typed categories only');
    const b = tally(stamped, LENSES.BUDGET);
    eqMoney(b.spend, 5000 + 700 + 2000, 'BUDGET gross spend: shop, cash, fund contribution; the pram left the fund (earmarkedOut) and is disclosed, not counted');
    eqMoney(b.fundedFromSavings.spend, 1500, '…as fundedFromSavings');
    eq(b.foreign, { count: 1, labels: ['Euro'], symbols: ['€'] }, '…and the euro account is named as excluded');
    eqMoney(b.setAside, 2000, 'set-aside is the fund contribution');

    ctx.S.period = ctx.currentPeriod();
    const snap = ctx.healthSnapshot();
    eqMoney(snap.metrics.monthlyConsumption, h.consumption, 'healthSnapshot: the Score\'s consumption IS tally(HOUSEHOLD).consumption');
    eqMoney(snap.metrics.monthlyFixed, h.fixed, 'healthSnapshot: fixed likewise');
    eqMoney(snap.metrics.monthlyIncome, h.netIncome, 'healthSnapshot: income likewise');
  }

  /* ---- 5b. a split is one purchase under every lens ---------------------- */
  {
    const ctx = await mount({
      ...BASE,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-20', 'big shop', 'Groceries', -900, 'yes', 'parent'],
        ['2026-07-20', 'big shop', 'Groceries', -600, '', 'part'],
        ['2026-07-20', 'big shop', 'Rent', -300, '', 'part'],
      ]),
    });
    const st = ctx.ledger('2026-07-01', '2026-07-31');
    eqMoney(tally(st, LENSES.BUDGET).spend, 900, 'BUDGET: the parts, not the parent (excluded)');
    eqMoney(tally(st, LENSES.TREND).spendByCat.Groceries + tally(st, LENSES.TREND).spendByCat.Rent, 900, 'TREND likewise');
    const h = tally(st, LENSES.HOUSEHOLD);
    eqMoney(h.consumption, 900, 'HOUSEHOLD: the parent is superseded by its parts and dropped by name — this read R1 800 on 1.38.0');
    eq(h.spendByCat, { Groceries: 600, Rent: 300 }, 'HOUSEHOLD: and the parts land in their own categories once');
    ctx.S.period = ctx.currentPeriod();
    eqMoney(ctx.healthSnapshot().metrics.monthlyEssential, 900, 'so the Score\'s essential spend is the purchase, not double it');
  }

  /* ---- 6. the lenses are data ------------------------------------------ */
  {
    ok(Object.isFrozen(LENSES) && Object.values(LENSES).every(l => Object.isFrozen(l) && Object.isFrozen(l.drop)), 'lenses are frozen data');
    const s = { excluded: true, nonBudget: false, foreign: false, earmarkedOut: false, transfer: false, passthrough: false };
    ok(!keeps(LENSES.BUDGET, s) && keeps(LENSES.HOUSEHOLD, s), 'an excluded row is out of BUDGET and in HOUSEHOLD, by data');
  }

  console.log(`PASS — ledger lenses: conservation, exact differences and the old seams as tallies (${checks} checks over ${rounds} rounds)`);
})().catch(e => { console.error(e); process.exit(1); });
