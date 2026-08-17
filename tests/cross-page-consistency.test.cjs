'use strict';
/* Cross-page consistency: the seams BETWEEN modules, pinned.

   Every module here is well-tested against itself. What nothing pinned until
   now is the seams a reader can actually see: the same period rendered on two
   pages through two independent code paths.

     — The Dashboard hero's "Total Spent" comes from periodSummary() in
       src/period.js: GROSS outgoings, uncategorised and unknown included.
     — The comparison column and trend chart come from periodSpend() in
       src/trend-math.js: NET per named category, refunds folded in,
       uncategorised dropped.
     — The donut draws from periodSummary().byCat with the same net-of-refunds
       reading, and its "not shown" note claims to account for the WHOLE
       difference against the hero.

   Three code paths, one vault, three figures on screen at once. They are
   ALLOWED to differ — net-vs-gross is a design decision the donut's note says
   out loud — but the difference must equal exactly its two documented parts:
   uncategorised gross spend, and refunds netted inside named categories.
   Nothing unexplained, in either direction, ever.

   The identities:

     1. hero spend === donutTotal + uncatSpend + netting
     2. periodSpend(p).whole summed === hero spend − uncatSpend − netting
        (equivalently: the comparison column and the donut agree exactly)
     3. the note's own decomposition — notShown split into uncat + netted the
        way renderSplit computes it — reproduces those same two parts

   `netting` is restated here independently (gross outgoings per named
   non-income/non-transfer category, minus what the donut keeps of it), never
   asked of the code under test — same policy as summary-conservation's
   oracle, for the same reason.

   A future edit to either module's veto handling now breaks arithmetic here
   rather than silently drifting the comparison column away from the hero
   while every per-module test stays green.

   Runs in bare node against the REAL loader, period and trend-math modules.
     node tests/cross-page-consistency.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const ok = (cond, m) => { assert.ok(cond, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const c = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };
const eqMoney = (a, b, m) => eq(c(a), c(b), `${m} (got ${a}, want ${b})`);

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |\n`).join('')}`;

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fun.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Categories/Move.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-08-01\n---\n',
  [`${B}/Accounts/Vault.md`]: '---\ntype: savings\ntx_label: "Vault"\nbudget: false\nbalance: 500.00\nbalance_updated: 2026-08-01\n---\n',
};

async function vault(files) {
  const ctx = makeCtx({ ...BASE, ...files }, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  return ctx;
}

/* The donut's slice set, restated from renderSplit's own selection rule:
   named categories, not income-typed, not transfer-typed, net negative. */
function donutTotal(ctx, sum) {
  let t = 0;
  for (const [cat, amt] of Object.entries(sum.byCat)) {
    if (!cat || ctx.catType(cat) === 'income' || ctx.catType(cat) === 'transfer') continue;
    if (amt < 0) t += -amt;
  }
  return t;
}

/* Independent netting: for each named non-income/non-transfer category, gross
   outgoings from the RAW rows minus what the donut keeps of that category.
   Computed from the same row list the identity ranges over (excluded and
   non-budget vetoes applied, transfers kept out of the named set). */
function nettingOf(ctx, p, sum) {
  const skip = ctx.nonBudgetLabels();
  const { start, end } = ctx.periodRange(p);
  const gross = {};
  for (const t of ctx.txInPeriod(p)) {
    if (t.date < start || t.date > end || t.excluded || skip.has(t.label)) continue;
    const type = ctx.catType(t.cat);
    if (!t.cat || type === 'income' || type === 'transfer') continue;
    if (t.amount < 0) gross[t.cat] = (gross[t.cat] || 0) + -t.amount;
  }
  let netting = 0;
  for (const [cat, g] of Object.entries(gross)) {
    netting += g - Math.max(0, -(sum.byCat[cat] || 0));
  }
  return netting;
}

function assertIdentities(ctx, p, label) {
  const sum = ctx.periodSummary(p);
  const donut = donutTotal(ctx, sum);
  const netting = nettingOf(ctx, p, sum);

  eqMoney(sum.spend, donut + sum.uncatSpend + netting,
    `${label}: hero spend === donut + uncategorised + netting`);

  const whole = ctx.periodSpend(p, null).whole;
  const trendTotal = Object.values(whole).reduce((t, v) => t + v, 0);
  eqMoney(trendTotal, sum.spend - sum.uncatSpend - netting,
    `${label}: trend/comparison total === hero − uncategorised − netting`);
  eqMoney(trendTotal, donut, `${label}: the comparison column and the donut agree exactly`);

  /* renderSplit's note, restated: the decomposition it prints must name the
     same two parts the identity is built from. */
  const notShown = Math.max(0, sum.spend - donut);
  const uncat = Math.min(sum.uncatSpend || 0, notShown);
  eqMoney(uncat, sum.uncatSpend, `${label}: the note's uncategorised part is the whole uncategorised figure`);
  eqMoney(notShown - uncat, netting, `${label}: the note's netted part is exactly the refund-netting`);
}

(async () => {

/* ---- 1. hand-picked: every term of both identities non-zero -------------- */
{
  const ctx = await vault({
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ['2026-08-01', 'Salary', 'Salary', 30000],
      ['2026-08-02', 'Shop', 'Groceries', -5000],
      ['2026-08-03', 'Shop again', 'Groceries', -3000],
      // a refund inside a category that stays net-negative: netted, still shown
      ['2026-08-04', 'Refund', 'Groceries', 150],
      // a category the refund flips net-POSITIVE: donut drops it whole
      ['2026-08-05', 'Tickets', 'Fun', -200],
      ['2026-08-06', 'Tickets refunded twice over', 'Fun', 900],
      // uncategorised, both directions
      ['2026-08-07', 'Mystery out', '', -700],
      ['2026-08-08', 'Mystery in', '', 400],
      // a category name no file answers to, both directions
      ['2026-08-09', 'Ghost out', 'Ghost', -800],
      ['2026-08-10', 'Ghost in', 'Ghost', 100],
      // the three vetoes, present so the identity is proven over them
      ['2026-08-11', 'Shuffle', 'Move', -2500],
      ['2026-08-12', 'Shuffle back', 'Move', 2500],
      ['2026-08-13', 'Vetoed', 'Groceries', -9999, 'yes'],
    ]),
    [`${B}/Transactions/Vault/2026-08.md`]: txFile([
      ['2026-08-14', 'Off budget', 'Groceries', -7777],
    ]),
  });
  const sum = ctx.periodSummary('2026-08');

  // Anchor the fixture before trusting identities proven on it.
  eqMoney(sum.spend, 9700, 'gross spend counts every outgoing: 5000+3000+200+700+800');
  eqMoney(donutTotal(ctx, sum), 8550, 'donut keeps Groceries net 7850 and Ghost net 700, drops Fun and the blanks');
  eqMoney(sum.uncatSpend, 700, 'uncategorised gross outgoing');
  eqMoney(nettingOf(ctx, '2026-08', sum), 450, 'netting: 150 in Groceries + all 200 of Fun + 100 of Ghost');

  assertIdentities(ctx, '2026-08', 'hand-picked');
}

/* ---- 2. randomised rounds: the identities, not the example --------------- */
{
  /* Seeded LCG so a failure is reproducible from the log, same as running
     any fixed fixture — Math.random would make a red run unrepeatable. */
  let seed = 0xb0dca7 ^ 20260817;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const pick = a => a[Math.floor(rnd() * a.length)];

  const CATS = ['Salary', 'Groceries', 'Fun', 'Move', 'Ghost', ''];
  for (let round = 0; round < 30; round++) {
    const rows = [];
    const n = 5 + Math.floor(rnd() * 25);
    for (let i = 0; i < n; i++) {
      const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
      const amount = Math.round((rnd() * 4000 - 2000) * 100) / 100;
      if (amount === 0) continue;
      rows.push([`2026-08-${day}`, `row ${round}.${i}`, pick(CATS), amount, rnd() < 0.1 ? 'yes' : '']);
    }
    if (!rows.length) continue;
    const ctx = await vault({ [`${B}/Transactions/Cheque/2026-08.md`]: txFile(rows) });
    assertIdentities(ctx, '2026-08', `round ${round}`);
  }
}

console.log(`PASS — the pages agree: hero, donut, note and comparison column reconcile exactly (${checks} assertions, 30 randomised rounds).`);
})().catch(e => { console.error(e); process.exit(1); });
