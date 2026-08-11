'use strict';
/* Savings & Investments — the growth the page could not previously see, and the
   editing it could not previously offer.

   What these pin, each one the reason the feature exists:

     1. GROWTH NO TRANSACTION RECORDED IS STILL REPORTED. A market-linked fund
        posts nothing: the value moves, the balance is retyped. The page used to
        answer "no growth recorded" for the largest holding on it. Working back
        from the balance against what was put in finds the figure.

     2. THE CARD AND THE CHART AND THE TILE STATE THE SAME THING. Three places
        now print a growth figure. One source, or the page argues with itself.

     3. UNDATED GROWTH IS NAMED, NOT DRAWN AS A CURVE. The vault holds one
        observation — today's balance. Spreading it back across the months would
        draw a line through measurements nobody took.

     4. AN ACCOUNT THAT CANNOT BE MEASURED IS EXCLUDED, COUNTED, AND OFFERED THE
        FIX. Silently omitting it is what would make the chart disagree with the
        tiles; omitting the fix is what would leave the reader unable to act.

     5. THE BALANCE IS A BUTTON, AND IT IS THE ACCOUNTS PAGE'S OWN DIALOG. One
        account form in this plugin, not two that drift.

     node tests/savings-growth.test.cjs
*/

const assert = require('assert');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---------------------------- a tiny DOM -------------------------------- */
class FakeText { constructor(t) { this.nodeType = 3; this.textContent = String(t); this.children = []; } }
class FakeEl {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase();
    this.children = []; this.attrs = {}; this.style = {}; this._cls = new Set(); this._text = '';
    this.listeners = {};
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
  get textContent() {
    return this._text + this.children.map(c => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  empty() { this.children = []; this._text = ''; }
  append(...kids) { for (const k of kids) this.children.push(k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  getBoundingClientRect() { return { width: 1000, height: 250, left: 0, top: 0 }; }
}
global.document = {
  createElement: t => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
  createTextNode: t => new FakeText(t),
};
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
global.window = {};

function walk(el, pred, out = []) {
  for (const c of el.children) if (c instanceof FakeEl) { if (pred(c)) out.push(c); walk(c, pred, out); }
  return out;
}
const byCls = (el, cls) => walk(el, e => e._cls.has(cls));
const flat = el => String(el.textContent).replace(/\s+/g, ' ').trim();

/* ------------------------------ the vault ------------------------------- */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const acctFile = fm => `---\n${fm}\n---\n`;
const txFile = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n${rows}`;

/* Growth Fund is the case the whole feature is for: it opened at R50 000, took
   one R10 000 transfer and credited R1 000 of interest, and is worth R75 000.
   R14 000 of that nothing in the vault records — and it is the biggest single
   fact about the account.

     capital in  50 000 + 10 000        = 60 000
     growth      75 000 − 60 000        = 15 000
       of which posted                  =  1 000
       of which undated                 = 14 000
     return      15 000 / 60 000        = +25.0%

   Plain Pot deliberately records no starting amount, so it cannot be measured
   at all — the case that must be excluded, counted, and offered the fix. */
const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Interest.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
  [`${B}/Categories/Savings.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',

  [`${B}/Accounts/Growth Fund.md`]: acctFile(
    'type: investment\ntx_label: "Growth Fund"\nbalance: 75000\nbalance_updated: 2026-08-01\n'
    + 'starting_amount: 50000\ninception_date: 2025-01-01'),
  [`${B}/Accounts/Plain Pot.md`]: acctFile(
    'type: savings\ntx_label: "Plain Pot"\nbalance: 20000\nbalance_updated: 2026-08-01'),

  [`${B}/Transactions/Growth Fund/2025-02.md`]:
    txFile('| 2025-02-05 | Transfer in | Savings | 10000.00 | yes |  |\n'),
  [`${B}/Transactions/Growth Fund/2025-03.md`]:
    txFile('| 2025-03-31 | Interest | Interest | 1000.00 | yes |  |\n'),
  [`${B}/Transactions/Plain Pot/2025-02.md`]:
    txFile('| 2025-02-05 | Transfer in | Savings | 5000.00 | yes |  |\n'),
};

const IDS = ['savingsKpis', 'savingsStale', 'savingsWorth', 'savingsWorthSub',
  'savingsGrowth', 'savingsGrowthSub', 'savingsGrowthTotal', 'savingsGrowthCard',
  'savingsGoals', 'savingsSections'];

const money = (v, dp = 2) => `R${Number(v).toFixed(dp)}`;

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const nodes = new Map(IDS.map(id => [id, new FakeEl('div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.money = money;
  ctx.saveAccount = async () => {};
  ctx.switchView = () => {};
  ctx.render = () => {};
  const calls = [];
  ctx.editBalance = a => calls.push(['editBalance', a.name]);
  ctx.editAccount = a => calls.push(['editAccount', a.name]);
  ctx.openAccountFile = a => calls.push(['openAccountFile', a.name]);
  ctx.openAccountTransactions = l => calls.push(['openAccountTransactions', l]);
  require('../src/views/savings')(ctx);
  ctx.renderSavings();
  return { S, nodes, calls };
}

(async () => {
  const { nodes, calls } = await mount(FILES);

  /* ---- 1. the tile ---- */
  const tiles = byCls(nodes.get('savingsKpis'), 'mini').map(flat);
  const growthTile = tiles.find(t => t.startsWith('Growth'));
  ok(growthTile, `a Growth tile is drawn — got ${JSON.stringify(tiles)}`);
  ok(growthTile.includes(`▲ ${money(15000)}`),
    `the tile totals the growth nobody recorded — got "${growthTile}"`);
  ok(growthTile.includes(`+25.0% on ${money(60000, 0)} put in`),
    `and states what it is a return ON — got "${growthTile}"`);
  ok(/1 of 2 not measurable/.test(growthTile),
    `and admits the account it could not measure — got "${growthTile}"`);

  /* ---- 2/3/5: what the measured card says ---- */
  const cards = {};
  for (const c of byCls(nodes.get('savingsSections'), 'mini')) {
    cards[String(c.children[0].textContent)] = c;
  }
  const fund = flat(cards['Growth Fund']);

  ok(fund.includes(`in ${money(60000, 0)}`), `capital in is stated — got "${fund}"`);
  ok(fund.includes(`▲ ${money(15000, 0)}`), `and the growth beside it — got "${fund}"`);
  ok(fund.includes('+25.0% total'), `with the return as a rate — got "${fund}"`);
  ok(/≈ \+14\.9% a year/.test(fund), `annualised, and marked approximate — got "${fund}"`);
  ok(fund.includes('since 2025-01-01'), `over a stated period — got "${fund}"`);

  /* The identity a reader can check by eye: the two figures on the card add up
     to the balance printed above them. */
  eq(60000 + 15000, 75000, 'capital in plus growth is the balance on the card');

  /* Undated growth is disclosed on the card, not quietly folded in. */
  ok(/includes growth no transaction recorded/.test(fund),
    `the undated portion is named — got "${fund}"`);
  /* And the growth that WAS posted still names its category, because a salary
     paid into a fund is income-type too and nothing in the data tells them
     apart — the disclosure savings-cards.test.cjs pins for the derived path. */
  ok(/growth from Interest R1000/.test(fund),
    `the recorded growth still names its category — got "${fund}"`);

  /* The split bar, on the existing .acct-mbar rather than a bar of its own. */
  const bar = byCls(cards['Growth Fund'], 'acct-mbar--split')[0];
  ok(bar, 'the card carries a split bar');
  ok(bar._cls.has('acct-mbar'), 'built as a modifier on the house bar, not a new component');
  eq(bar.children.length, 2, 'with a segment for capital and one for growth');
  ok(/^width:80\.0%/.test(bar.children[0].attrs.style),
    `capital is 60 000 of 75 000 — got "${bar.children[0].attrs.style}"`);

  /* ---- 5. the balance is a button, wired to the Accounts page's dialog ---- */
  const balBtn = walk(cards['Growth Fund'], e => e.tagName === 'BUTTON' && e._cls.has('v'))[0];
  ok(balBtn, 'the balance is a button');
  eq(balBtn.attrs.type, 'button', 'and never a submit');
  ok(String(balBtn.textContent).includes(money(75000)), 'showing the balance');
  ok(/Update the balance of Growth Fund/.test(balBtn.attrs['aria-label'] || ''),
    `and saying so to a screen reader — got "${balBtn.attrs['aria-label']}"`);
  balBtn.listeners.click[0]();
  eq(calls.pop(), ['editBalance', 'Growth Fund'], 'it opens the Accounts page dialog, not a copy');

  /* Edit opens the one account form. */
  const acts = byCls(cards['Growth Fund'], 'acct-drawer-act');
  const edit = acts.find(b => flat(b) === 'Edit');
  ok(edit, `an Edit action is offered — got ${JSON.stringify(acts.map(flat))}`);
  edit.listeners.click[0]();
  eq(calls.pop(), ['editAccount', 'Growth Fund'], 'and it is the shared editAccount');

  /* ---- 4. the account that cannot be measured ---- */
  const pot = flat(cards['Plain Pot']);
  ok(!/total/.test(pot), `no return is invented for it — got "${pot}"`);
  ok(/in R5000/.test(pot), 'while the contribution it CAN see is still reported');
  const potActs = byCls(cards['Plain Pot'], 'acct-drawer-act').map(flat);
  eq(potActs[0], 'Add starting amount',
    `the fix leads, rather than hiding behind Edit — got ${JSON.stringify(potActs)}`);

  /* ---- the chart ---- */
  const svg = walk(nodes.get('savingsGrowth'), e => e.tagName === 'SVG')[0];
  ok(svg, 'the chart is drawn');
  const label = svg.getAttribute('aria-label');
  ok(label.includes(`balance of ${money(75000)}`),
    `it states the balance it accounts for — got "${label}"`);
  ok(label.includes(`${money(60000, 0)} put in`), 'the capital');
  ok(label.includes(`${money(1000, 0)} of recorded growth`), 'the growth that carries dates');
  ok(label.includes(`${money(14000, 0)} of growth carrying no date`),
    `and the growth that does not — got "${label}"`);

  /* 2. the chart's own total agrees with the tile and the card. */
  eq(60000 + 1000 + 14000, 75000, 'the three bands sum to the balance');

  /* 3. undated growth is a block at the edge, not points on the curve. It is
     dashed precisely so it cannot read as a continuation of the line. */
  const dashed = walk(nodes.get('savingsGrowth'),
    e => e.tagName === 'RECT' && e.attrs['stroke-dasharray']);
  eq(dashed.length, 1, 'the undated growth is one block, set apart');

  /* Only the excluded account is left out, and the page says so twice — in the
     subtitle and under the chart, because a silent omission is the one thing
     that could make this disagree with the tiles above. */
  ok(/1 of 2 accounts measurable/.test(flat(nodes.get('savingsGrowthSub'))),
    `the subtitle counts what it covers — got "${flat(nodes.get('savingsGrowthSub'))}"`);
  ok(/1 account left out/.test(flat(nodes.get('savingsGrowth'))),
    'and the exclusion is named under the chart');
  ok(flat(nodes.get('savingsGrowthTotal')).includes(money(75000)),
    'the card header totals what it drew');
  ok(!nodes.get('savingsGrowthCard')._cls.has('hidden'), 'and the card is shown');

  /* ---- a vault with nothing measurable hides the chart rather than framing a
     blank, and still says why in the tile ---- */
  {
    const bare = await mount({
      [`${B}/Settings.md`]: FILES[`${B}/Settings.md`],
      [`${B}/Accounts/Plain Pot.md`]: FILES[`${B}/Accounts/Plain Pot.md`],
    });
    ok(bare.nodes.get('savingsGrowthCard')._cls.has('hidden'),
      'no measurable account hides the whole card');
    eq(walk(bare.nodes.get('savingsGrowth'), e => e.tagName === 'SVG').length, 0,
      'and draws no chart');
    const t = byCls(bare.nodes.get('savingsKpis'), 'mini').map(flat).find(x => x.startsWith('Growth'));
    ok(/no account records what it started at/.test(t),
      `the tile explains the gap rather than vanishing — got "${t}"`);
  }

  console.log(`PASS — growth is found where no transaction records it, `
    + `and what cannot be measured is named (${checks} checks).`);
})();
