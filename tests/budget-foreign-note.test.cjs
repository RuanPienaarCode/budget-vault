'use strict';
/* "Every consumer must say something when foreign.count is non-zero."

   period.js:517-520 says exactly that, in the return statement itself: the
   `foreign` caveat travels WITH the totals rather than beside them, "so a
   consumer cannot read the totals without having been handed the caveat".
   summaryInRange holds transactions from foreign accounts out of income and
   spend, because a rand total cannot include a euro and this vault stores no
   rate to convert with — and holding out silently is the one thing
   currency.js:14 forbids.

   The Dashboard hero honours it (views/dashboard.js, 'dash.foreignExcluded').
   The Budget page reads the SAME periodSummary for its "Total spent" tile and
   said nothing at all — so a household with a euro account saw a spend figure
   on the Budget page that quietly omitted every euro row, with no way to know
   it had, while the Dashboard one screen away disclosed it. Two readings of
   one object, one of them silent.

   Same key as the Dashboard's, so the two screens cannot word one fact
   differently, and appended to the tile's existing note rather than replacing
   it: the uncategorised/netted gap note is about a DIFFERENT omission and both
   are true at once.
     node tests/budget-foreign-note.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const txFile = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n`
  + rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |\n`).join('');

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#c0392b"\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000\nbalance_updated: 2026-08-01\n---\n',
  [`${B}/Budgets/2026-08.md`]:
    '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n'
    + '| Groceries | expense | 4000.00 |  |\n',
  [`${B}/Transactions/Cheque/2026-08.md`]: txFile([['2026-08-04', 'Shop', 'Groceries', -1200]]),
};

/* The euro account and, crucially, rows IN THE PERIOD — period.js only warns
   about folders that actually contributed, because a disclosure that fires on
   every period regardless of the data is one readers learn to stop seeing. */
const WITH_EURO = {
  ...BASE,
  [`${B}/Accounts/EuroSave.md`]:
    '---\ntype: checking\ncurrency: "€"\ntx_label: "EuroSave"\nbalance: 900\nbalance_updated: 2026-08-01\n---\n',
  [`${B}/Transactions/EuroSave/2026-08.md`]: txFile([['2026-08-06', 'Lidl', 'Groceries', -60]]),
};

/* The euro account exists but spent nothing this period: no caveat, because
   there is nothing this period's figures left out. */
const EURO_IDLE = {
  ...BASE,
  [`${B}/Accounts/EuroSave.md`]:
    '---\ntype: checking\ncurrency: "€"\ntx_label: "EuroSave"\nbalance: 900\nbalance_updated: 2026-08-01\n---\n',
  [`${B}/Transactions/EuroSave/2026-07.md`]: txFile([['2026-07-06', 'Lidl', 'Groceries', -60]]),
};

async function mount(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
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
  require('../src/categories')(ctx);
  require('../src/views/budgets')(ctx);
  return { ctx, $ };
}

const byClass = (root, cls) => descend(root).filter(n => n._cls && n._cls.has(cls));
/* The "Total spent" tile is the last of the strip's tiles — the same reading
   tests/cross-page-consistency.test.cjs takes of the same strip. */
function spentTile($) {
  const tiles = byClass($('#budTotalsTop'), 'bud-total');
  const t = tiles[tiles.length - 1];
  return t && {
    value: (byClass(t, 'bud-total-v')[0] || {}).textContent,
    note: (byClass(t, 'bud-total-n')[0] || {}).textContent || '',
  };
}

(async () => {
  {
    const { ctx, $ } = await mount(WITH_EURO);
    ctx.renderBudgets();
    const tile = spentTile($);
    ok(tile, 'the Budget page draws its Total spent tile');
    eq(tile.value, 'R 1200.00',
      'the figure is the rand spending alone — periodSummary already holds the euro row out');
    ok(/another currency|other currencies/.test(tile.note),
      `and the tile SAYS the figure leaves something out — got "${tile.note}"`);
    ok(/€/.test(tile.note),
      `naming the currency, so the reader knows where to look — got "${tile.note}"`);

    /* The same sentence the Dashboard prints for the same period, from the
       same key — a fact worded two ways on two screens is two facts to a
       reader. */
    const sum = ctx.periodSummary('2026-08');
    const i18n = require('../src/i18n');
    const dashboardSentence = i18n.t('dash.foreignExcluded', {
      count: sum.foreign.count, symbols: sum.foreign.symbols.join(' · '),
    });
    ok(tile.note.includes(dashboardSentence),
      `worded exactly as the Dashboard words it — wanted "${dashboardSentence}", got "${tile.note}"`);
  }

  /* A vault with nothing held out says nothing extra — the caveat is about an
     omission, and there isn't one. */
  {
    const { ctx, $ } = await mount(EURO_IDLE);
    ctx.renderBudgets();
    const note = spentTile($).note;
    ok(!/another currency|other currencies/.test(note),
      `a period no foreign account contributed to carries no caveat — got "${note}"`);
  }
  {
    const { ctx, $ } = await mount(BASE);
    ctx.renderBudgets();
    const note = spentTile($).note;
    ok(!/another currency|other currencies/.test(note),
      `and neither does a single-currency vault — got "${note}"`);
  }

  console.log(`PASS — the Budget page's Total spent tile discloses the foreign rows periodSummary held out, in the Dashboard's own words (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
