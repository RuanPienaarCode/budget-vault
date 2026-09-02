'use strict';
/* The Savings page, on a vault that holds more than one currency.

   Driven through the REAL view modules over the shared DOM stub, the way
   tests/views-render.test.cjs does — a hand-written mirror of these tiles
   would go green while the page itself said something else, which is the
   failure mode this repo has already paid for twice.

   Three things this file pins, each one a figure that was silently short:

   1. THE NET-WORTH TILE DISCLOSED THE ACCOUNTS ONLY. `worth()` has returned
      `otherCurrencies` — the foreign ASSETS and foreign DEBTS it held out of
      the household total — since ADR-0004 landed, and no page ever read it.
      Every net-worth surface disclosed `splitByCurrency`'s account `others`
      alone, so a €300 000 flat and a €200 000 mortgage vanished from the
      headline figure of the page with nothing said. That is the silent
      exclusion src/currency.js:10 forbids, on the one number that claims to
      be the whole picture.

   2. THE COMPOSITION CHART DREW WHAT ITS OWN HEADING DID NOT COUNT.
      `assetsByType(S.assets)` and `debtsByType(S.debts)` took no household
      symbol, so every foreign row reached a segment; the row heading beside
      it came from `worth(...)`, which holds them out; and `scale` came from
      the same household-only totals. Measured on the fixture below: R2 300 000
      of segments drawn against a R2 100 000 heading on a track scaled to
      R2 100 000 — 109.5% of the bar's own width — and `sharePercents` then
      stated each segment's share against the SEGMENT sum, so a wedge could
      announce a percentage of a total the chart never printed.

   3. THE STALE-VALUATION CAVEAT ADDED CURRENCIES TOGETHER. "R 2 300 000 of
      what you own was last valued over a year ago" where the truth is
      R2 000 000 and €300 000 — the same wrong number the tile above it had,
      one line further down.

     node tests/savings-worth-currency-disclosure.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

const SRC = path.join(__dirname, '..', 'src');
const { worth, assetsByType, debtsByType, otherCurrencyNet } = require(path.join(SRC, 'worth.js'));
const { splitByCurrency } = require(path.join(SRC, 'currency.js'));

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const close = (a, b, m, eps = 0.01) => { assert.ok(Math.abs(a - b) < eps, `${m} (got ${a}, want ~${b})`); checks++; };

/* ------------------------------ the vault -------------------------------
   Synthetic throughout. A rand household with a euro account, a euro flat and
   a euro mortgage — the exact shape ADR-0004 was written for. Both valuations
   are dated 2024, which is over a year old on any day this test is ever run;
   nothing here reads the wall clock for a verdict that could flip. */
const B = 'Budget';
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',

  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\nbalance: 100000.00\nbalance_updated: 2026-08-01\n---\n',
  [`${B}/Accounts/Lisbon current.md`]: '---\ntype: savings\ncurrency: "€"\nbalance: 20000.00\nbalance_updated: 2026-08-01\n---\n',

  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n'
    + '| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n'
    + '| House | property | 2000000.00 | 2024-01-01 | | |\n'
    + '| Lisbon flat | property | 300000.00 | 2024-01-01 | | € |\n',

  [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
    + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes | Currency |\n'
    + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|---|\n'
    + '| Bond | Bank A | home loan | 500000.00 | 800000.00 | 10.50 | 6000.00 | 0.00 | 2020-01-01 | | active | | |\n'
    + '| Lisbon mortgage | Banco | home loan | 200000.00 | 250000.00 | 3.00 | 900.00 | 0.00 | 2021-01-01 | | active | | € |\n',
};

async function mount() {
  const ctx = makeCtx(FILES);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  for (const f of ['dashboard', 'report', 'score', 'transactions', 'budgets', 'plan', 'accounts',
    'savings', 'assets', 'debts', 'owed', 'services', 'tax', 'loans', 'import']) {
    require(`../src/views/${f}`)(ctx);
  }
  return { ctx, S, nodes, $ };
}

(async () => {
  const { ctx, S, $ } = await mount();

  /* Sanity on the fixture itself. If the loader ever stops reading the
     appended Currency column these assertions fail here rather than
     masquerading as a rendering bug forty lines further down. */
  {
    eq(S.settings.currency, 'R', 'the household is a rand household');
    eq(S.assets.map(a => a.currency), ['', '€'], 'the Assets file states one foreign row');
    eq(S.debts.map(d => d.currency), ['', '€'], 'and the Debt file states one foreign row');
  }

  const { primary: homeAccounts, others: worthOthers } = splitByCurrency(S.accounts, 'R');
  const w = worth(homeAccounts, S.debts, S.assets, 'R');

  /* ---- 1. the household arithmetic, unchanged ---- */
  {
    eq(w.ownedAccounts, 100000, 'the euro account is not added into a rand total');
    eq(w.ownedAssets, 2000000, 'nor is the euro flat');
    eq(w.fromDebts, 500000, 'nor is the euro mortgage');
    eq(w.net, 1600000, 'so net worth is the rand position');
    eq(worthOthers, [['€', 20000]], 'the accounts half of the disclosure');
    eq(w.otherCurrencies.assets, [['€', 300000]], 'the assets half');
    eq(w.otherCurrencies.debts, [['€', 200000]], 'the debts half');
  }

  /* ---- 2. every held-out ledger reaches ONE disclosure ---- */
  {
    eq(otherCurrencyNet(w, worthOthers), [['€', 120000]],
      'accounts + assets − debts, per symbol: 20 000 + 300 000 − 200 000');
  }

  /* ---- 3. the Net worth tile says so ----
     `worthOthers` alone printed "€ 20000" — a disclosure that named a fifth of
     what it was disclosing, which reads as complete and is not. */
  {
    ctx.renderSavings();
    const txt = $('#savingsKpis').textContent;
    ok(/Net worth/.test(txt), 'the tile is on the page at all');
    /* Scoped to the Net worth tile's own caption. The Savings and Investments
       tiles beside it keep their accounts-only "plus € 20000" on purpose —
       those two figures ARE account sums, so the accounts half is the whole
       of what they hold out. Only the net-worth tile spans three ledgers. */
    const tile = txt.slice(txt.indexOf('Net worth'), txt.indexOf('Savings'));
    ok(tile.includes('€ 120000'),
      `the net-worth tile discloses every ledger held out of it — got: ${JSON.stringify(tile)}`);
    ok(!/€ 20000/.test(tile),
      'and does not print the accounts-only figure there, which would understate the held-out position fivefold');
  }

  /* ---- 4. the chart draws what its heading counts ----
     The identity, not the case: the sum of the segments in a row must equal
     the total printed at the end of that row. Anything else overflows the
     track it is drawn on and makes every share in the row a share of a
     denominator the reader was never shown. */
  {
    eq(assetsByType(S.assets, 'R').reduce((t, a) => t + a.amount, 0), w.ownedAssets,
      'the asset segments sum to the asset figure worth() states');
    eq(debtsByType(S.debts, 'R').reduce((t, d) => t + d.amount, 0), w.fromDebts,
      'the debt segments sum to the debt figure worth() states');

    /* Absent household symbol MUST mean "add everything", exactly as before —
       views/dashboard.js and views/report.js call these two functions without
       one and may not be quietly altered by this change. */
    eq(assetsByType(S.assets).reduce((t, a) => t + a.amount, 0), 2300000,
      'a caller that has not been taught about currencies is unchanged');
    eq(debtsByType(S.debts).reduce((t, d) => t + d.amount, 0), 700000,
      'the same on the debt side');
  }

  /* ---- 5. and the rendered chart agrees with itself ----
     Read off the svg's own aria-label, which is the only reading a
     screen-reader user gets and is built from the same arrays the rects are:
     "Net worth R X: assets R A against debts R B. Owned: … . Owed: …". */
  {
    ctx.renderWorth();
    const svg = $('#savingsWorth').querySelectorAll('svg')[0]
      || require('./helpers/dom-stub.cjs').descend($('#savingsWorth')).find(e => e.tag === 'svg');
    ok(svg, 'the composition chart rendered');
    const label = svg.attrs['aria-label'];
    /* The decimals are matched explicitly rather than with a lazy [\d.]+ —
       the sentence separator is a full stop, so a greedy character class
       swallows it and turns "R 500000.00." into NaN. */
    const MONEY = /R (-?\d+(?:\.\d+)?)/g;
    const sum = s => (s.match(MONEY) || []).reduce((t, m) => t + Number(m.slice(2)), 0);
    const owned = (label.split('Owned:')[1] || '').split('. Owed:')[0];
    const owed = (label.split('. Owed:')[1] || '');
    const headA = Number((label.match(/assets R (-?\d+(?:\.\d+)?)/) || [])[1]);
    const headD = Number((label.match(/against debts R (-?\d+(?:\.\d+)?)/) || [])[1]);

    eq(headA, 2100000, 'the "what you own" heading is the household figure');
    eq(headD, 500000, 'and so is "what you owe"');
    close(sum(owned), headA, 'every owned segment drawn sums to the heading above it');
    close(sum(owed), headD, 'every owed segment drawn sums to the heading above it');
    ok(!/Lisbon flat/.test(label), 'the euro flat is not drawn on a rand scale');
    ok(!/Lisbon mortgage/.test(label), 'nor is the euro mortgage');
  }

  /* ---- 6. what the chart could not draw is NAMED under it ----
     A bar cannot carry a disclosure inside a wedge, so the subtitle carries
     it. Dropping the row from the chart and saying nothing would be the
     silent exclusion again, one surface along. */
  {
    const sub = $('#savingsWorthSub').textContent;
    ok(/€/.test(sub), `the subtitle names the currency the bar could not draw — got: ${JSON.stringify(sub)}`);
    ok(sub.includes('€ 120000'), 'and states the same held-out position the tile does');
  }

  /* ---- 7. the stale-valuation caveat states one currency ----
     Both valuations are 2024, so both are stale; only the rand one belongs in
     a rand sentence. */
  {
    ctx.renderSavings();
    const note = $('#savingsStale').textContent;
    ok(/last valued/.test(note), 'the caveat is on the page');
    ok(note.includes('R 2000000'),
      `the rand figure is the rand rows only — got: ${JSON.stringify(note)}`);
    ok(!note.includes('R 2300000'), 'the euro flat is never added into a rand figure');
    ok(note.includes('€ 300000'), 'and it is named beside it rather than dropped');
  }

  console.log(`savings-worth-currency-disclosure.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
