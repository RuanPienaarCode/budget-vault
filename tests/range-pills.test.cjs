'use strict';
/* The dashboard's range pills, pinned against the size of the vault.

   The pills are not a fixed menu. A long range only appears once there is
   enough imported history for it to draw something the range beside it does
   not — otherwise 1Y, 5Y and All are the same picture three times over, and a
   reader clicking between identical charts learns only that the control is
   broken.

   Four invariants, each a build failure:

     1. FLOOR. Under a year of history offers 3M/6M/1Y and nothing longer. This
        is the old comment in chart.js kept honest: a 5Y pill on eight months of
        statements would draw four flat-zero years and read as "you spent
        nothing until last year", which is a lie the chart would be telling on
        our behalf.

     2. ALL EARNS ITS PLACE AT A YEAR. Past twelve months, "All" appears — the
        point at which "everything" stops being a synonym for 1Y — and 5Y still
        does not, because on three years of data it would be All wearing a
        misleading label.

     3. 5Y EARNS ITS PLACE AT FIVE. Past sixty months both appear, in order, and
        only then are they two different pictures.

     4. ALL IS SIZED BY THE DATA. Its `months` is the span actually held, so the
        caller asks for the history it has rather than a fixed number it would
        have to clamp — and its label is whatever the active language calls it,
        never a hardcoded English "All" beside translated siblings.

   Then the same rule proved end-to-end THROUGH THE REAL VIEW, on both cards
   that carry pills — the trend chart and "Where it went" — because the table
   above is only half the claim. The other half is that the pill lit on screen
   is the range the card actually used, which is where a saved-but-no-longer-
   offered range would show up as a row of pills with none of them active.

     node tests/range-pills.test.cjs
*/

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');

stubObsidian();

const SRC = path.join(__dirname, '..', 'src');
const { historicalRanges, RANGES, rangeFor } = require(path.join(SRC, 'chart.js'));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const keys = span => historicalRanges(span, 'All').map(r => r.key);

/* ---- 1. under a year: the short ranges only ---- */
eq(keys(0), ['3m', '6m', '1y'], 'an empty vault offers only the short ranges');
eq(keys(1), ['3m', '6m', '1y'], 'one month of history offers only the short ranges');
eq(keys(12), ['3m', '6m', '1y'], 'exactly a year is still 1Y, not All — same chart');

/* ---- 2. past a year, All appears and 5Y does not ---- */
eq(keys(13), ['3m', '6m', '1y', 'all'], 'thirteen months earns All');
eq(keys(36), ['3m', '6m', '1y', 'all'], 'three years is All, not a mislabelled 5Y');
eq(keys(60), ['3m', '6m', '1y', 'all'], 'exactly five years is All — 5Y would draw the same');

/* ---- 3. past five years, both, longest last ---- */
eq(keys(61), ['3m', '6m', '1y', '5y', 'all'], 'past five years 5Y and All are different pictures');
eq(keys(240), ['3m', '6m', '1y', '5y', 'all'], 'twenty years does not add anything beyond All');

/* ---- 4. All is sized and labelled by the caller ---- */
const all = historicalRanges(97, 'Alles').find(r => r.key === 'all');
eq(all.months, 97, 'All asks for the span actually held, not a fixed number');
eq(all.label, 'Alles', 'All wears the active language, not a hardcoded English label');
ok(all.historical === true, 'All is a historical range');

/* The pill order must follow the length of the span it covers, or the row reads
   as an arbitrary list rather than a scale. */
for (const span of [0, 13, 61, 240]) {
  const months = historicalRanges(span, 'All').map(r => r.months);
  eq(months, [...months].sort((a, b) => a - b), `ranges ascend by span at ${span} months`);
}

/* The forward-projected table is a different question and must not have been
   dragged along: 10Y stays off the historical menu at every span, and the debts
   view's dropdown still sees the whole five-entry table. */
for (const span of [0, 61, 600]) {
  ok(!keys(span).includes('10y'), `10Y never appears historically (span ${span})`);
}
eq(RANGES.map(r => r.key), ['3m', '6m', '1y', '5y', '10y'], 'the projection table is unchanged');
ok(rangeFor('5y').months === 60, 'rangeFor still resolves 5Y for the debts projection');

/* ------------------- the same rule, through the real view ------------------
   A DOM thin enough to render into and read back. Deliberately not shared with
   dashboard-cards.test.cjs: that file's FakeEl carries failure-injection hooks
   this test has no use for, and a shared harness is how one test's convenience
   becomes another's silent assumption. */
class FakeText { constructor(t) { this.nodeType = 3; this.textContent = String(t); this.children = []; } }
class FakeEl {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase();
    this.children = []; this.attrs = {}; this.style = {}; this._cls = new Set();
    this._text = ''; this._listeners = {};
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._cls.add(x)),
      remove: (...c) => c.forEach(x => self._cls.delete(x)),
      toggle: (c, on) => (on ? self._cls.add(c) : self._cls.delete(c)),
      contains: c => self._cls.has(c),
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  empty() { this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids) this.children.push(k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
}
global.document = {
  createElement: t => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
  createTextNode: t => new FakeText(t),
};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });

function walk(el, pred, out = []) {
  for (const c of el.children) if (c instanceof FakeEl) { if (pred(c)) out.push(c); walk(c, pred, out); }
  return out;
}
const tagCount = (el, tag) => walk(el, e => e.tagName === tag).length;

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test House"\n---\n';
const CATS = {
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#c0392b"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
};
const ACCOUNT = { [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 100\n---\n' };
const txFile = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n` +
  rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |\n`).join('');

/* A vault whose transactions run for `months` calendar months, ending 2026-08.
   Every month carries spend AND income: a month with no rows at all is a month
   the vault does not cover, and the baseline deliberately skips those. */
function vaultOf(months) {
  const files = { [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT };
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(2026, 7 - i, 1));
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    files[`${B}/Transactions/Cheque/${m}.md`] = txFile([
      [`${m}-05`, 'Woolworths', 'Groceries', -800 - i],
      [`${m}-25`, 'Payday', 'Salary', 20000],
    ]);
  }
  return files;
}

const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'healthCard', 'healthBody', 'healthSub',
  'leftCard', 'leftBody', 'leftSub', 'dashSplit', 'dashSplitSub', 'splitRange',
  'dashBudget', 'dashBudgetSub', 'dashPositionCard', 'dashPositionKpis',
  'dashPositionSub', 'dashPositionNote'];

async function mount(files, trendSaved, splitSaved) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = {
    ...ctx.plugin.settings, chartTrendRange: trendSaved, splitCompareRange: splitSaved,
  };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();
  return nodes;
}

const pillsOf = (nodes, id) => walk(nodes.get(id), e => e.tagName === 'BUTTON')
  .map(b => ({ label: b.textContent, on: b.getAttribute('aria-pressed') === 'true' }));
const labels = p => p.map(x => x.label);
const active = p => (p.find(x => x.on) || {}).label;
/* The baseline column header on the donut card — the one that read "12M" over
   a pill saying "1Y" until it was taught to quote the pill instead. */
const baseHead = nodes => (walk(nodes.get('dashSplit'), e => e._cls.has('dl-base'))[0] || {}).textContent;

(async () => {
  /* Under a year: neither card offers a long range. */
  {
    const n = await mount(vaultOf(8), '6m', '3m');
    eq(labels(pillsOf(n, 'trendRange')), ['3M', '6M', '1Y'], 'eight months: trend offers three');
    eq(labels(pillsOf(n, 'splitRange')), ['Last month', '3M', '6M', '1Y'],
      'eight months: the donut offers four');
  }

  /* Past a year: All on both, 5Y on neither. */
  {
    const n = await mount(vaultOf(25), '6m', '3m');
    eq(labels(pillsOf(n, 'trendRange')), ['3M', '6M', '1Y', 'All'], 'two years: trend gains All');
    eq(labels(pillsOf(n, 'splitRange')), ['Last month', '3M', '6M', '1Y', 'All'],
      'two years: the donut gains All');
  }

  /* Past five: both, longest last. */
  {
    const n = await mount(vaultOf(70), '6m', '3m');
    eq(labels(pillsOf(n, 'trendRange')), ['3M', '6M', '1Y', '5Y', 'All'], 'six years: trend gains 5Y');
    eq(labels(pillsOf(n, 'splitRange')), ['Last month', '3M', '6M', '1Y', '5Y', 'All'],
      'six years: the donut gains 5Y');
  }

  /* All really reaches back to the start — 25 months of data, 25 points — and
     draws no "history stops here" note, because nothing was cut short. */
  {
    const n = await mount(vaultOf(25), 'all', 'all');
    eq(active(pillsOf(n, 'trendRange')), 'All', 'All is the lit trend pill');
    ok(/25 periods/.test(n.get('trendSub').textContent),
      `All plots every period held, got "${n.get('trendSub').textContent}"`);
    ok(!/history/i.test(n.get('trendSub').textContent),
      'All draws no shortened-range note — it asked for exactly what it got');
    eq(baseHead(n), 'All', 'the donut baseline column names the All pill');
  }

  /* A saved range the vault no longer earns falls back rather than lighting
     nothing: five years saved, two years of data. */
  {
    const n = await mount(vaultOf(25), '5y', '5y');
    eq(active(pillsOf(n, 'trendRange')), '6M', 'a stale 5Y trend range falls back to 6M');
    eq(active(pillsOf(n, 'splitRange')), '3M', 'a stale 5Y comparison range falls back to 3M');
    eq(baseHead(n), '3M', 'the baseline column follows the fallback, not the saved key');
  }

  /* And when the vault does earn it, the saved range is honoured on both. */
  {
    const n = await mount(vaultOf(70), '5y', '5y');
    eq(active(pillsOf(n, 'trendRange')), '5Y', '5Y is honoured once six years are held');
    eq(active(pillsOf(n, 'splitRange')), '5Y', 'the donut honours 5Y too');
    eq(baseHead(n), '5Y', 'the baseline column reads 5Y, never "60M"');
  }

  /* Every case above must still have drawn both charts: a card that threw would
     leave the pills asserted and the chart missing, which is not a pass. */
  for (const [months, tr, sp] of [[8, '6m', '3m'], [25, 'all', 'all'], [70, '5y', '5y']]) {
    const n = await mount(vaultOf(months), tr, sp);
    eq(tagCount(n.get('trendChart'), 'SVG'), 1, `trend drew at ${months} months`);
    eq(tagCount(n.get('dashSplit'), 'SVG'), 1, `donut drew at ${months} months`);
    eq(pillsOf(n, 'trendRange').filter(x => x.on).length, 1, `one lit trend pill at ${months} months`);
    eq(pillsOf(n, 'splitRange').filter(x => x.on).length, 1, `one lit donut pill at ${months} months`);
  }

  console.log(`PASS — range pills follow the size of the vault, on both cards (${checks} checks).`);
})().catch(e => { console.error(e); process.exit(1); });
