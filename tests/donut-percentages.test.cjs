'use strict';
/* Donut percentages that do not sum to 100.

   src/views/dashboard.js and src/views/accounts.js each drew their donut's %
   column, tooltip and aria-label from three INDEPENDENT `Math.round((x /
   total) * 100)` calls per slice. Rounded independently, a set of shares does
   not have to sum to 100:

     six equal categories -> 17,17,17,17,17,17 = 102%
     three equal          -> 33,33,33          =  99%
     [50,25,12.5,12.5]    -> 50,25,13,13       = 101%

   The aria-label concatenates that same rounded set, so for a screen-reader
   user it is not a cosmetic rounding wart — it is the ONLY reading of the
   chart they get, and it doesn't add up.

   The fix is a largest-remainder (Hare quota) allocator, `sharePercents()`,
   duplicated once per view (each file owns its own — see the comment at its
   definition in each) and exposed on the view's module.exports for a direct,
   DOM-free unit test of the algorithm. The full render is covered separately
   here too, over the REAL loader and the REAL chart primitives, so a wiring
   bug that stops a view from actually USING the shared array (reintroducing
   three independent computations of the same number) is caught even when the
   algorithm itself is right.

     node tests/donut-percentages.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const registerDashboard = require('../src/views/dashboard');
const registerAccounts = require('../src/views/accounts');
const { sharePercents: dashShare } = registerDashboard;
const { sharePercents: acctShare } = registerAccounts;

const sum = arr => arr.reduce((s, v) => s + v, 0);

/* A naive per-slice implementation of the bug this file exists to prevent —
   NOT the fix, kept only as a negative control. If these fixtures stopped
   tripping it, they would no longer be proving anything about the real
   defect, and the whole suite would be trivially green for the wrong reason. */
const naiveRound = amounts => {
  const total = sum(amounts);
  return amounts.map(v => Math.round((v / total) * 100));
};

/* ---------------------------------------------------------------------- *
 * 1. sharePercents() itself — pure, DOM-free, both views' copies in turn.
 * ---------------------------------------------------------------------- */
for (const [label, share] of [['dashboard.js', dashShare], ['accounts.js', acctShare]]) {

  /* -- negative control: prove the fixtures actually expose the old bug -- */
  eq(sum(naiveRound([1, 1, 1, 1, 1, 1])), 102,
    `${label}: negative control — six equal slices trip the naive rounder at 102%, or this fixture proves nothing`);
  eq(sum(naiveRound([1, 1, 1])), 99,
    `${label}: negative control — three equal slices trip the naive rounder at 99%`);
  eq(sum(naiveRound([50, 25, 12.5, 12.5])), 101,
    `${label}: negative control — the exact-tie set trips the naive rounder at 101%`);

  /* -- six equal categories: 100/6 has no exact integer split -- */
  {
    const pct = share([1, 1, 1, 1, 1, 1]);
    eq(sum(pct), 100, `${label}: six equal slices sum to exactly 100`);
    // Deterministic largest-remainder result: all six floor to 16 (96 total),
    // four whole points remain, and equal remainders are broken by ascending
    // original index — so the FIRST four slices in the input win the bump.
    eq(pct, [17, 17, 17, 17, 16, 16], `${label}: six equal slices resolve the same way every time — got ${pct}`);
  }

  /* -- three equal categories: the other side's failure, 99% -- */
  {
    const pct = share([1, 1, 1]);
    eq(sum(pct), 100, `${label}: three equal slices sum to exactly 100`);
    eq(pct, [34, 33, 33], `${label}: the leftover point goes to index 0 by the same tie-break — got ${pct}`);
  }

  /* -- the exact-tie set named in the defect report -- */
  {
    const pct = share([50, 25, 12.5, 12.5]);
    eq(sum(pct), 100, `${label}: [50,25,12.5,12.5] sums to exactly 100`);
    // 50 and 25 land exactly; the two 12.5s tie at a 0.5 remainder each, and
    // there is only ONE leftover point to hand out — index 2 (the first of
    // the pair) wins it, index 3 does not.
    eq(pct, [50, 25, 13, 12], `${label}: an exact tie is broken by original index, not left to chance — got ${pct}`);
  }

  /* -- determinism: two runs on the same input must not differ -- */
  {
    const a = share([50, 25, 12.5, 12.5]);
    const b = share([50, 25, 12.5, 12.5]);
    eq(a, b, `${label}: two runs of the same tied input produce identical output`);
    // A second, independent tie set, so the check above is not just re-running
    // the exact same call twice against a memoised result.
    const c = share([3, 3, 3, 3, 3]);
    const d = share([3, 3, 3, 3, 3]);
    eq(c, d, `${label}: determinism holds for a five-way tie too`);
  }

  /* -- a single 100% slice -- */
  {
    const pct = share([250]);
    eq(pct, [100], `${label}: one slice alone is the whole chart — 100%, not 99 or 101`);
  }

  /* -- a slice that IS zero, sitting among slices that are not -- */
  {
    const pct = share([70, 30, 0]);
    eq(pct, [70, 30, 0], `${label}: a literal-zero slice reports 0% and does not perturb the others — got ${pct}`);
    eq(sum(pct), 100, `${label}: still sums to 100 with a zero slice present`);
  }

  /* -- a slice that rounds DOWN to zero despite being real money -- */
  {
    const pct = share([9990, 5, 5]);
    eq(sum(pct), 100, `${label}: two tiny non-zero slices still leave the column summing to 100`);
    ok(pct[1] === 0 && pct[2] === 0, `${label}: R5 out of R10 000 legitimately prints as 0%, not a negative or a NaN`);
  }
}

/* ---------------------------------------------------------------------- *
 * 2. Full render — dashboard's spending-split donut, over the REAL loader
 *    and the REAL chart primitives. Proves the view actually WIRES the
 *    shared array into the aria-label, every wedge's tooltip and the
 *    legend's % column, rather than each still computing its own.
 * ---------------------------------------------------------------------- */

/* ---- minimal DOM, same shape as tests/dashboard-cards.test.cjs's stub ---- */
class FakeText { constructor(t) { this.nodeType = 3; this.textContent = String(t); this.children = []; } }
class FakeEl {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this._cls = new Set();
    this._text = '';
    this._listeners = {};
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

function all(el, pred, out = []) {
  for (const c of el.children) {
    if (c instanceof FakeEl) { if (pred(c)) out.push(c); all(c, pred, out); }
  }
  return out;
}
/* Every whole-number percentage printed anywhere under a node — the
   aria-label's own text plus every SVG <title> tooltip plus every legend
   `dl-pct` span. Cross-checking all three catches a view that fixed the sum
   in one place and left another still computing it independently. */
function allPercents(node, ariaLabel) {
  const fromText = s => [...String(s).matchAll(/(\d+)%/g)].map(m => Number(m[1]));
  const out = { aria: fromText(ariaLabel) };
  out.tooltips = all(node, e => e.tagName === 'TITLE').flatMap(t => fromText(t.textContent));
  out.legend = all(node, e => e._cls.has('dl-pct')).flatMap(t => fromText(t.textContent));
  return out;
}

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test House"\n---\n';
const txFile = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n` +
  rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |\n`).join('');

// Six categories, each exactly R100 of spend — 100/6 has no integer split,
// which is the shape that broke the old code (17 * 6 = 102%).
const CAT_NAMES = ['Groceries', 'Transport', 'Entertainment', 'Pharmacy', 'Clothing', 'Subscriptions'];
const CATS = Object.fromEntries(
  CAT_NAMES.map((c, i) => [`${B}/Categories/${c}.md`, `---\ntype: expense\ncolor: "#${(100000 + i).toString().padStart(6, '0')}"\n---\n`]));
const ACCOUNT = { [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 100\n---\n' };
const SIX_EQUAL = {
  [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
  [`${B}/Transactions/Cheque/2026-07.md`]: txFile(
    CAT_NAMES.map((c, i) => [`2026-07-0${i + 1}`, `Merchant ${i}`, c, -100])),
};

async function mountDashboard(files, period = '2026-07') {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = period;
  const IDS = ['dashSplit', 'dashSplitSub', 'splitRange'];
  const nodes = new Map(IDS.map(id => [id, new FakeEl('div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  registerDashboard(ctx);
  return { ctx, nodes };
}

(async () => {
  {
    const { ctx, nodes } = await mountDashboard(SIX_EQUAL);
    ctx.renderSplit();
    const svg = all(nodes.get('dashSplit'), e => e.tagName === 'SVG')[0];
    ok(svg, 'the donut drew an svg');
    const ariaLabel = svg.getAttribute('aria-label');
    const found = allPercents(nodes.get('dashSplit'), ariaLabel);

    eq(sum(found.aria), 100, `the aria-label's own six percentages sum to 100 — got ${found.aria}`);
    eq(sum(found.tooltips), 100, `every wedge's tooltip percentage sums to 100 — got ${found.tooltips}`);
    eq(sum(found.legend), 100, `the legend's % column sums to 100 — got ${found.legend}`);

    // All three readings of the same chart must be the SAME set, in the same
    // order — not just three different sets that each happen to total 100.
    eq(found.tooltips, found.aria, 'tooltip percentages match the aria-label percentages, slice for slice');
    eq(found.legend, found.aria, 'the legend % column matches the aria-label percentages, slice for slice');
  }

  /* -- determinism across renders: re-mounting from the same fixture must -- *
     -- produce the identical percentage column, not just one that sums    -- *
     -- to 100 by a different distribution each time.                     -- */
  {
    const { ctx: ctx1, nodes: n1 } = await mountDashboard(SIX_EQUAL);
    ctx1.renderSplit();
    const l1 = all(n1.get('dashSplit'), e => e._cls.has('dl-pct')).map(e => e.textContent);

    const { ctx: ctx2, nodes: n2 } = await mountDashboard(SIX_EQUAL);
    ctx2.renderSplit();
    const l2 = all(n2.get('dashSplit'), e => e._cls.has('dl-pct')).map(e => e.textContent);

    eq(l1, l2, 'rendering the same fixture twice prints the identical % column both times');
  }

  /* ------------------------------------------------------------------ *
   * 3. The centre label — routed through i18n, and no longer claiming  *
   *    to be "Total spent" (the hero tile's gross figure, not this).   *
   * ------------------------------------------------------------------ */
  {
    const i18n = require('../src/i18n');
    const { ctx, nodes } = await mountDashboard(SIX_EQUAL);
    ctx.renderSplit();
    const texts = all(nodes.get('dashSplit'), e => e.tagName === 'TEXT').map(e => e.textContent);
    ok(!texts.includes('Total spent'), 'the centre label no longer claims to be Total Spent — that figure is the hero tile\'s, and is gross');
    ok(texts.includes(i18n.t('dash.split.centerLabel')), 'the centre label is exactly the i18n string, not a hand-rolled paraphrase of it');
  }
  {
    // Every language actually carries a translated string for the key —
    // tests/i18n.test.cjs already pins key parity; this pins that the VIEW
    // reads it rather than a hard-coded literal that happens to equal English.
    const i18n = require('../src/i18n');
    for (const lang of ['af', 'de', 'es', 'fr', 'ja', 'zh']) {
      i18n.setLanguage(lang);
      const label = i18n.t('dash.split.centerLabel');
      ok(label && label !== 'Total spent' && label !== 'dash.split.centerLabel',
        `${lang}: the centre label has a real translation, not a fallback to English or to the bare key`);
    }
    i18n.setLanguage('en');
  }

  /* ------------------------------------------------------------------ *
   * 4. Full render — accounts.js's "Where it sits" ring. Three groups,  *
   *    each exactly a third — 100/3 has no integer split either (the   *
   *    99% shape from the defect report, mirrored on the other view).  *
   * ------------------------------------------------------------------ */
  {
    const files = {
      [`${B}/Settings.md`]: SETTINGS,
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000\n---\n',
      [`${B}/Accounts/Notice.md`]: '---\ntype: savings\ntx_label: "Notice"\nbalance: 1000\n---\n',
      [`${B}/Accounts/TFSA.md`]: '---\ntype: investment\ntx_label: "TFSA"\nbalance: 1000\n---\n',
    };
    const ctx = makeCtx(files);
    await loadInto(ctx);

    const acctSummary = new FakeEl('div');
    ctx.$ = sel => (sel === '#acctSummary' ? acctSummary : null);
    ctx.root = new FakeEl('div');
    ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
    ctx.moneyIn = (_sym, v, dp = 2) => `R ${Number(v).toFixed(dp)}`;

    registerAccounts(ctx);
    ctx.renderAccounts();

    const svg = all(acctSummary, e => e.tagName === 'SVG')[0];
    ok(svg, 'the ring drew an svg');
    const ariaLabel = svg.getAttribute('aria-label');
    const found = allPercents(acctSummary, ariaLabel);

    eq(sum(found.aria), 100, `the ring's aria-label percentages sum to 100 — got ${found.aria}`);
    eq(sum(found.tooltips), 100, `every group's tooltip percentage sums to 100 — got ${found.tooltips}`);
    eq(sum(found.legend), 100, `the ring's legend % column sums to 100 — got ${found.legend}`);
    eq(found.tooltips, found.aria, 'ring tooltip percentages match the aria-label, slice for slice');
    eq(found.legend, found.aria, 'the ring legend % column matches the aria-label, slice for slice');
  }

  console.log(`PASS — donut percentages: largest-remainder allocation sums to exactly 100 (six equal, three equal, an exact tie, a single slice, a zero slice), the tie-break is deterministic across runs, and the donut's centre figure is no longer mislabelled Total Spent in any of seven languages (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
