'use strict';
/* The Assets page: what "stale" means, and which rows a rand percentage is a
   percentage OF.

   Driven through the real view module over the shared DOM stub — the caveat
   under the tiles is assembled inside renderAssetStale(), so a test that
   re-derived its arithmetic would be guarding a copy.

   Two defects, both of them a figure that was quietly qualified by rows it did
   not describe:

   1. A VALUATION DATED INTO THE FUTURE READ AS CURRENT. `isStaleValuation`
      answered `d !== null && d > VALUED_STALE_DAYS`, and `d` is signed — so a
      `valued: 2099-01-01` typo produced a NEGATIVE age, failed the `>` test,
      and the tile said "Needs a new valuation: 0 — every value is current"
      directly above a row whose own caption (valuedAge, which has always had
      the `d < 0` branch) read "valued ahead of today". reconcile.js:63 closed
      exactly this hole for a bank balance in 1.23.1; two more functions were
      answering the same question by their own rule and neither was patched.
      The rule now has ONE spelling, in reconcile.js beside isStale.

   2. THE CAVEAT'S PERCENTAGE MIXED CURRENCIES. The tile above it prints
      `assetTotal(S.assets, S.settings.currency)` — household rows only — while
      the caveat computed `assetTotal(stale) / assetTotal(S.assets)` with the
      household argument dropped on BOTH sides. The share is gated at 50%, so a
      large foreign asset in the denominator could push a genuinely dominant
      stale rand asset under the gate and suppress the disclosure entirely:
      R1 000 000 of R1 000 000 rand assets is 100% and says so; add a €5 000 000
      flat and the same page computes 17% and says nothing.

     node tests/assets-valuation-age-and-currency.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom } = require('./helpers/dom-stub.cjs');

const SRC = path.join(__dirname, '..', 'src');
const { isStaleValuation } = require(path.join(SRC, 'reconcile.js'));

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';

/* Dates chosen so no assertion here can change its answer with the wall clock:
   2024 is over a year before any day this suite will run, and 2099 is ahead of
   it. views/assets.js reads the clock directly (daysSince with no `today`),
   which is why the fixture rather than the test carries that guarantee. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n'
    + '| Item | Kind | Value | Valued | Notes | Currency |\n|---|---|---:|---|---|---|\n'
    + '| House | property | 1000000.00 | 2024-01-01 | | |\n'
    + '| Lisbon flat | property | 5000000.00 | 2099-01-01 | | € |\n',
};

async function mount(files = FILES) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $ } = makeDom();
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
  return { ctx, S, $ };
}

(async () => {
  /* ---- 1. the shared rule ----
     The threshold travels as an argument: views/assets.js declares
     VALUED_STALE_DAYS = 365 as its documented single source (see
     tests/vocabulary.test.cjs, TERM 10) and publishes it on ctx. This module
     owns the RULE; that file owns the NUMBER. */
  {
    const Y = 365;
    eq(isStaleValuation('2024-01-01', '2026-09-02', Y), true, 'two years old is stale');
    eq(isStaleValuation('2026-08-01', '2026-09-02', Y), false, 'last month is current');
    eq(isStaleValuation('2099-01-01', '2026-09-02', Y), true,
      'a valuation dated ahead of today is not a current figure — the 1.23.1 hole, on the longer clock');
    eq(isStaleValuation('', '2026-09-02', Y), false,
      '"I cannot read this date" is a different claim, and assets.js states it separately');
  }

  /* ---- 2. the KPI tile counts the future-dated row ----
     "Needs a new valuation: 0 — every value is current" above a row captioned
     "valued ahead of today" is the page contradicting itself on one screen. */
  {
    const { ctx, $ } = await mount();
    ctx.renderAssets();
    const kpis = $('#assetKpis').textContent;
    /* The 3 Sep 2026 hero (variant B) states this as a badge rather than a
       zero-count tile: "every value current" or "N need a new valuation". */
    ok(/new valuation|every value current/.test(kpis), 'the badge is on the page');
    ok(!/every value current/.test(kpis),
      `a valuation dated ahead of today needs a new one — got: ${JSON.stringify(kpis)}`);
    ok(/2 need a new valuation/.test(kpis),
      'both rows need one: the 2024 house and the 2099 flat');
  }

  /* ---- 3. the caveat's share is a share of the household total ----
     One stale rand asset of R1 000 000 against R1 000 000 of rand assets is
     100%. The €5 000 000 flat is not in the numerator and may not be in the
     denominator either — the tile directly above states the household figure,
     and a percentage stated against a different total than the figure it sits
     under is the "two figures derived by different rules" shape this repo
     keeps paying for. */
  {
    const { ctx, $ } = await mount();
    ctx.renderAssets();
    const note = $('#assetStale').textContent;
    ok(/over a year old/.test(note), `the caveat names the stale row — got: ${JSON.stringify(note)}`);
    ok(/100% of the total/.test(note),
      `the whole rand total rests on a stale figure and the page says so — got: ${JSON.stringify(note)}`);
    ok(!/17% of the total/.test(note),
      'the euro flat is not allowed to dilute a rand percentage');
  }

  /* ---- 4. a single-currency vault is unchanged ----
     The negative control for the whole currency argument: a household with no
     foreign row must read exactly as it always did, or this fix has quietly
     altered every vault instead of the few it is for. */
  {
    const { ctx, $ } = await mount({
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
      [`${B}/Assets.md`]: '---\nkind: assets\n---\n\n'
        + '| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n'
        + '| House | property | 1000000.00 | 2024-01-01 | |\n'
        + '| Car | vehicle | 3000000.00 | 2026-08-01 | |\n',
    });
    ctx.renderAssets();
    const kpis = $('#assetKpis').textContent;
    const note = $('#assetStale').textContent;
    ok(/1 needs a new valuation/.test(kpis), 'one of the two rows is stale');
    ok(/1 of 2 values are over a year old/.test(note), 'and the caveat counts it');
    ok(!/% of the total/.test(note),
      'a quarter of the total is under the 50% gate, so the share is not stated — unchanged behaviour');
  }

  console.log(`assets-valuation-age-and-currency.test.cjs — ${checks} checks OK`);
})().catch(e => { console.error(e); process.exit(1); });
