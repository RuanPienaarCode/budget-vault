'use strict';
/* The Savings net-worth chart's "held in other currencies is not drawn here"
   sentence names the basis when the two readings of a foreign account differ.

   Wave A's currency.otherHoldings() made the Net worth TILE on this page print
   the implied (rolled-forward) amount and, when the balance the reader typed
   reads differently, name that one too (tests/other-currencies-one-basis.test.cjs,
   audit L8-05). The chart's caption a few inches below it - same page, same
   account, same ledgers - still printed the implied amount alone, so a dollar
   account with a deposit dated after its typed balance read "$ 1 500" in the
   chart note and "$ 1 000 as typed" on the tile, and nothing on the caption
   said which of the two it was. It now asks the same helper, with the same
   fold, and says the same thing.

   Real loader and real view over the committed household
   (tests/figures/household.cjs): a dollar account typed at $1 000 on 1 Sep,
   with and without a $500 deposit dated 2 Sep.

     node tests/savings-worth-chart-names-both-readings.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { mountFor, pinClock, leaves, ownText } = require('./helpers/figures.cjs');
const { SEED, PERIOD, TODAY, B } = require('./figures/household.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const HEAD = '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';

async function page(files) {
  const unpin = pinClock(TODAY);
  try {
    const { ctx, nodes } = await mountFor(files, { period: PERIOD });
    ctx.switchView = () => {};
    ctx.renderSavings();
    const text = sel => {
      const r = nodes.get(sel);
      return r ? [...leaves(r)].map(l => ownText(l)).join(' ').replace(/\s+/g, ' ') : '';
    };
    return { ctx, chart: text('#savingsWorthSub'), tile: text('#savingsKpis') };
  } finally { unpin(); }
}

(async () => {
  const withDeposit = { ...SEED, [`${B}/Transactions/Dollar savings/2026-09.md`]: HEAD + '| 2026-09-02 | Invoice | Salary | 500.00 |  |  |  |\n' };
  const p = await page(withDeposit);
  const money = p.ctx.moneyIn;
  const typed = money('$', 1000, 0), rolled = money('$', 1500, 0);

  ok(p.chart.includes(`${rolled} held in other currencies is not drawn here`),
    `the chart caption still names the rolled-forward amount it always did (got "${p.chart}")`);
  ok(p.chart.includes(typed),
    `and now names the amount as typed beside it, because the readings differ (got "${p.chart}")`);
  ok(/as typed/.test(p.chart), `with the words that say which is which (got "${p.chart}")`);
  ok(p.tile.includes(rolled) && p.tile.includes(typed), 'the tile above carries both too, so the page tells one story');

  /* No deposit: the readings agree, and the caption is the one it always was. */
  const q = await page(SEED);
  ok(q.chart.includes(`${money('$', 1000, 0)} held in other currencies is not drawn here`),
    `where the readings agree the caption names the one amount (got "${q.chart}")`);
  ok(!/as typed|That counts/.test(q.chart), `and adds nothing about a basis (got "${q.chart}")`);

  console.log(`PASS savings-worth-chart-names-both-readings (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
