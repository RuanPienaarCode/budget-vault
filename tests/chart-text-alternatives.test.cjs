'use strict';
/* A chart says its figures to a reader who cannot hover over it.

   Every chart here is an <svg role="img">, which a screen reader meets as ONE
   node: its aria-label is the whole of what it says. The Dashboard's trend
   chart and the Food chart also let the arrow keys walk their points and read
   each one out (src/chart.js trackPoints). Two charts did neither well (audit
   of 11 Nov 2026, task 18):

     - the Debt page's payoff curve was labelled "Total owed over the next 5
       years under each payoff plan" — a description of the axes, with not one
       figure in it — and its month-by-month amounts were native <title>
       tooltips inside that single img node, where no keyboard and no screen
       reader reaches them.
     - the Savings page's growth chart named its closing figures in its label
       but its month-by-month shape, which is what the chart is FOR, was
       reachable by nothing.

   Both now follow the trend chart: a label that states figures, and a readout
   the arrow keys walk (src/chart.js pointReadout — a status line under the
   chart, in the page from the start and empty until a point is inspected).

   Pinned on the real views:

     1. Debt: the label states the opening total and where each plan ends —
        the month it clears, or what is still owed — in the reader's language
        (three i18n keys, all twelve tables).
     2. Debt: focusing the chart reads the last month; Home the first, which is
        the opening total again; an arrow steps; leaving clears the line.
     3. Debt: with the readout wired, the per-month <title> strips are gone —
        two tooltips for one point is worse than either. On an engine with no
        PointerEvent the strips are still there and there is no readout line.
     4. Savings: the same readout over the growth chart's months, saying what
        had been put in and what had grown by each one; the last month's
        figures are the ones in the chart's own label.

     node tests/chart-text-alternatives.test.cjs */

const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { descend, installDom } = require('./helpers/dom-stub.cjs');
const { mountFor, pinClock } = require('./helpers/figures.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

installDom();
const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const DEBTS = '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
  + '| Card | Bank A | credit card | 8000.00 | 12000.00 | 22.50 | 800.00 | 0.00 | 2024-03-01 | | active | |\n'
  + '| Loan | Bank B | personal | 30000.00 | 40000.00 | 14.00 | 1500.00 | 0.00 | 2023-01-15 | | active | |\n';
const TX_HEAD = '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n';
const SAVINGS = {
  [`${B}/Settings.md`]: SETTINGS,
  [`${B}/Categories/Transfer.md`]: '---\ntype: transfer\ncolor: "#666666"\n---\n',
  [`${B}/Accounts/Growth Fund.md`]: '---\ntype: investment\ntx_label: "Growth Fund"\nbalance: 26000\n'
    + 'balance_updated: 2026-10-01\nstarting_amount: 20000\ninception_date: 2026-06-01\n---\n',
  [`${B}/Transactions/Growth Fund/2026-07.md`]: TX_HEAD + '| 2026-07-05 | Deposit | Transfer | 2000.00 |  |  |  |\n',
  [`${B}/Transactions/Growth Fund/2026-08.md`]: TX_HEAD + '| 2026-08-05 | Deposit | Transfer | 3000.00 |  |  |  |\n',
};

const svgIn = node => descend(node).find(e => e.tagName === 'SVG');
const readoutIn = node => descend(node).find(e => e._cls.has('chart-readout'));
const titles = svg => descend(svg).filter(e => e.tagName === 'TITLE');
const digits = s => (String(s).match(/\d/g) || []).length;

(async () => {
  const unpin = pinClock('2026-10-15');
  try {
    /* ============ with a PointerEvent: the readout is wired ================= */
    global.window.PointerEvent = function PointerEvent() {};

    /* ---- 1 + 2 + 3. the Debt payoff curve -------------------------------- */
    {
      const M = await mountFor({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Debts.md`]: DEBTS }, { period: '2026-10', budgetFolder: B });
      const { ctx } = M;
      ctx.renderDebts();
      const wrap = ctx.$('#debtCurve');
      const svg = svgIn(wrap);
      ok(svg, 'the payoff curve is drawn');
      const label = svg.getAttribute('aria-label');
      const opening = ctx.money(38000, 0);
      ok(label.includes(opening), `the label states the opening total (${opening}): ${label}`);
      for (const plan of ['Minimum only', 'Snowball', 'Avalanche']) {
        ok(label.includes(`${plan}:`), `the label says where the ${plan} plan ends`);
      }
      ok(/20\d\d/.test(label), 'with the month a plan clears');
      ok(digits(label) >= 12, 'so it carries figures, where it used to carry none');

      const i18n = require('../src/i18n');
      const said = i18n.t('debt.curve.aria', { from: 'A', to: 'B', start: 'C', plans: 'D' });
      ok(label.startsWith(said.split('A')[0]), 'and it is built from the debt.curve.aria key, not a literal');

      const readout = readoutIn(wrap);
      ok(readout, 'a readout line sits under the chart');
      eq(readout.getAttribute('role'), 'status', 'it is a status region, in the page before anything is written to it');
      eq(readout.textContent, '', 'and empty until a point is inspected');
      eq(svg.getAttribute('tabindex'), '0', 'the chart takes focus');
      eq(titles(svg).length, 0, 'with the readout wired there are no per-month <title> strips to double it');

      svg._fire('focus');
      const end = readout.textContent;
      ok(/^\w{3} 20\d\d — /.test(end), `focusing the chart reads a month: ${end}`);
      for (const plan of ['Minimum only', 'Snowball', 'Avalanche']) ok(end.includes(plan), `with the ${plan} figure`);
      svg._fire('keydown', { key: 'Home' });
      const start = readout.textContent;
      ok(start.startsWith('Oct 2026 — '), `Home reads the first month, which is this one: ${start}`);
      eq((start.match(new RegExp(opening.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 3,
        'where all three plans stand at the opening total');
      svg._fire('keydown', { key: 'ArrowRight' });
      ok(readout.textContent !== start && /20\d\d — /.test(readout.textContent), 'an arrow steps to the next point');
      svg._fire('blur');
      eq(readout.textContent, '', 'and leaving the chart clears the line');
    }

    /* ---- 4. the Savings growth chart --------------------------------------- */
    {
      const M = await mountFor(SAVINGS, { period: '2026-10', budgetFolder: B });
      const { ctx } = M;
      ctx.renderSavings();
      const wrap = ctx.$('#savingsGrowth');
      const svg = descend(wrap).find(e => e.tagName === 'SVG' && e._cls.has('growth-svg'));
      ok(svg, 'the growth chart is drawn');
      const readout = readoutIn(wrap);
      ok(readout, 'a readout line sits under the growth chart');
      eq([readout.getAttribute('role'), readout.textContent], ['status', ''], 'a status region, empty at rest');
      eq(svg.getAttribute('tabindex'), '0', 'the chart takes focus');

      svg._fire('focus');
      const last = readout.textContent;
      ok(/^2026-\d\d — Put in /.test(last), `focusing reads the last month: ${last}`);
      const putIn = /Put in ([^·]+?)(?: ·|$)/.exec(last)[1].trim();
      ok(svg.getAttribute('aria-label').includes(`${putIn} put in`),
        'and its put-in figure is the one the chart\'s own label closes on');
      svg._fire('keydown', { key: 'Home' });
      const first = readout.textContent;
      ok(/^2026-06 — Put in /.test(first), `Home reads the month the account opened: ${first}`);
      ok(first !== last, 'which is a different figure from the last month\'s');
      svg._fire('keydown', { key: 'Escape' });
      eq(readout.textContent, '', 'Escape clears the line');
    }

    /* ============ without one: the old tooltips, and no empty line ========== */
    delete global.window.PointerEvent;
    {
      const M = await mountFor({ [`${B}/Settings.md`]: SETTINGS, [`${B}/Debts.md`]: DEBTS }, { period: '2026-10', budgetFolder: B });
      M.ctx.renderDebts();
      const wrap = M.ctx.$('#debtCurve');
      const svg = svgIn(wrap);
      ok(titles(svg).length > 0, 'an engine with no PointerEvent keeps the per-month <title> strips');
      eq(readoutIn(wrap), undefined, 'and gets no readout line it could never fill');
      ok(digits(svg.getAttribute('aria-label')) >= 12, 'the label states the figures either way');
    }
  } finally {
    unpin();
    delete global.window.PointerEvent;
  }

  console.log(`PASS chart-text-alternatives — the debt and savings charts state their figures in a label and read each point to the keyboard (${checks} checks)`);
})().catch(e => { console.error(e); process.exit(1); });
