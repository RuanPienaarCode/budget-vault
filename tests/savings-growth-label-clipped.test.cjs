'use strict';
/* THE GROWTH CHART DRAWS NO TEXT THAT ITS OWN CLIP CUTS OFF
   (left over from the 14 Oct 2026 audit fix wave).

   On a desktop the Savings growth chart wrote "Growth with" / "no date" over
   the dashed block of undated growth, two lines at 9.5 units, the first 17
   units above the block's top. The block's top is the series top whenever the
   undated growth is what the balance closes on, and the series top sits only
   ~15 units under the plot's top edge (the 1.08 headroom in `span`) — so the
   first line's baseline landed ABOVE the plot, inside the band that the
   worth-wipe clip (a rect from padT down) discards. "Growth with" was cut off
   and "no date" stood alone over the block, a caption that says less than
   nothing. The phone path has never drawn either line, because the legend
   under the chart already names the block in full ("Growth with no date"); the
   desktop now does the same.

   Rendered, not read: the REAL registerSavings over the dom-stub, a synthetic
   fund whose balance the one deposit does not explain (so the undated block is
   drawn), desktop geometry. Two holds — no in-chart caption, and the general
   form of the defect: no text inside the clipped band starts above the clip.

     node tests/savings-growth-label-clipped.test.cjs */
const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const BASE = require('./helpers/views-vault.cjs');
const FILES = {
  ...BASE,
  'Budget/Accounts/Growth Fund.md': '---\ntype: investment\ntx_label: "Growth Fund"\nbalance: 30000\nbalance_updated: 2026-07-01\n'
    + 'starting_amount: 20000\ninception_date: 2025-01-01\n---\n',
  'Budget/Transactions/Growth Fund/2025-02.md': '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n\n'
    + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
    + '| 2025-02-05 | Deposit | Transfer | 5000.00 |  |  |  |\n',
};

(async () => {
  const ctx = makeCtx({ ...FILES });
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $ } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.switchView = () => {};
  ctx.render = () => {};
  ctx.reloadFromDisk = async () => {};
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  require('../src/views/savings')(ctx);

  /* A desktop: no .is-phone on the body, no narrow viewport. */
  global.document.body = { classList: { contains: () => false, add() {}, remove() {} } };
  global.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  ctx.renderSavings();

  const host = $('#savingsGrowth');
  const svg = descend(host).find(n => (n.getAttribute('class') || '') === 'growth-svg');
  ok(svg, 'the household draws the growth chart');
  /* el() keeps its classes in the stub's _cls; createChart sets the svg's with setAttribute. */
  const legend = descend(host).filter(n => n._cls && n._cls.has('dl-name')).map(n => n.textContent);
  ok(legend.includes('Growth with no date'),
    `the undated block is drawn and named in the legend (the control: legend ${JSON.stringify(legend)})`);

  /* The general form: text inside the wipe-clipped band must start inside the
     clip rect, or the clip eats it. A glyph's top is ~0.75 em over its baseline. */
  const rect = descend(svg).find(n => n.tagName === 'RECT' && (n.getAttribute('class') || '') === 'worth-wipe');
  const band = descend(svg).find(n => n.tagName === 'G' && /url\(#.*-wipe\)/.test(n.getAttribute('clip-path') || ''));
  ok(rect && band, 'the chart has its wipe clip and the band it clips');
  const top = Number(rect.getAttribute('y'));
  for (const t of descend(band).filter(n => n.tagName === 'TEXT')) {
    const y = Number(t.getAttribute('y')), size = Number(t.getAttribute('font-size') || 12);
    ok(y - 0.75 * size >= top,
      `"${t.textContent}" starts at ${(y - 0.75 * size).toFixed(1)}, above the clip's top edge at ${top}: the clip cuts it off`);
  }

  const texts = descend(svg).filter(n => n.tagName === 'TEXT').map(n => n.textContent);
  ok(!texts.includes('Growth with') && !texts.includes('no date'),
    `the desktop chart draws no in-chart caption over the undated block (drew ${JSON.stringify(texts)})`);

  console.log(`PASS savings-growth-label-clipped (${checks} checks)`);
})().catch(e => { console.error(e.message || e); process.exit(1); });
