'use strict';
/* Savings & Investments, and the Financial-health saving-rate pillar — an
   account's own `type` compared raw, found independently in both files.

   `load.js` only defaults `type` when the key is ABSENT (see its own header);
   a present-but-unrecognised casing — `type: Savings`, `type: ' savings '`,
   `type: INVESTMENT` — reaches every reader exactly as written in the file.
   worth.js sums every account into net worth by balance SIGN regardless of
   type (worth.js:122-141 names this exact shape: "`type: Savings` with a
   capital S, which is the same bug wearing a hat"), so an account like that
   counted toward net worth while:

     1. views/savings.js's own KPI tile and account-section grid showed ZERO
        accounts and R0 for it — the tile and the net-worth figure beside it
        disagreeing on one screen.

     2. health-data.js's saving-rate pillar silently dropped its
        contributions, understating the household's own saving rate.

   views/dashboard.js was already fixed for this in 1.23.0 (accountsOfType,
   case-folded and trimmed); these two were missed.

   A THIRD guard below pins views/assets.js's `VALUED_STALE_DAYS` actually
   being the one threshold both pages read — views/savings.js used to
   hand-declare its own copy, so changing the constant on the Assets page
   changed nothing on this one.

     node tests/savings-account-type-casing.test.cjs
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

/* Pinned clock — the stale-valuation guard (part 3) measures a real day gap
   off `daysSince(a.valued)`, which reads off `new Date()` at call time. */
const RealDate = Date;
class PinnedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(2026, 7, 12, 12, 0, 0); }
  static now() { return new PinnedDate().getTime(); }
}
global.Date = PinnedDate;

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ${b}±${tol})`); checks++; };

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
const money = (v, dp = 2) => `R${Number(v).toFixed(dp)}`;

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';

const IDS = ['savingsKpis', 'savingsStale', 'savingsWorth', 'savingsWorthSub',
  'savingsGrowth', 'savingsGrowthSub', 'savingsGrowthTotal', 'savingsGrowthCard',
  'savingsGoals', 'savingsSections'];

async function mountSavings(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const nodes = new Map(IDS.map(id => [id, new FakeEl('div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.money = money;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.saveAccount = async () => {};
  ctx.switchView = () => {};
  ctx.render = () => {};
  ctx.editBalance = () => {};
  ctx.editAccount = () => {};
  ctx.openAccountFile = () => {};
  ctx.openAccountTransactions = () => {};
  require('../src/views/savings')(ctx);
  return { ctx, S, nodes };
}

(async () => {
  /* ------ 1. the KPI tile and the section grid, against a mistyped type --- */
  {
    const FILES = {
      [`${B}/Settings.md`]: SETTINGS,
      [`${B}/Accounts/Cheque.md`]:
        '---\ntype: checking\nbalance: 5000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
      // Capital S — present, not absent, so load.js's default never fires.
      [`${B}/Accounts/Nest.md`]:
        '---\ntype: Savings\nbalance: 55000.00\nbalance_updated: 2026-08-01\ntx_label: "Nest"\n---\n',
      // Padded and upper-cased.
      [`${B}/Accounts/Fund.md`]:
        '---\ntype: " INVESTMENT "\nbalance: 20000.00\nbalance_updated: 2026-08-01\ntx_label: "Fund"\n---\n',
    };
    const { ctx, nodes } = await mountSavings(FILES);
    ctx.renderSavings();

    const tiles = byCls(nodes.get('savingsKpis'), 'mini').map(flat);
    const tile = label => tiles.find(t => t.startsWith(label));

    ok(tile('Savings') && tile('Savings').includes(money(55000)),
      `the Savings tile counts the capital-S account — got tiles ${JSON.stringify(tiles)}`);
    ok(tile('Investments') && tile('Investments').includes(money(20000)),
      `the Investments tile counts the padded/upper-cased account — got tiles ${JSON.stringify(tiles)}`);
    ok(tile('Net worth') && tile('Net worth').includes(money(80000)),
      `net worth already counted both mistyped accounts (worth() sums by sign, `
      + `not by type) — the bug was the tiles beside it disagreeing, not this one`);

    // Both accounts must also reach the per-account section grid below the
    // tiles, not just the summed KPI — a filter fixed only for the total and
    // not for the list underneath it would still show "R75 000 / 0 accounts".
    const cards = byCls(nodes.get('savingsSections'), 'mini');
    eq(cards.length, 2, `both mistyped-type accounts reach the Savings/Investments `
      + `section grid — got ${cards.length} card(s)`);
  }

  /* ------ 2. health-data.js's saving-rate pillar, same mistyped type ------ */
  {
    const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
    const table = rows =>
      `---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n${rows.join('\n')}\n`;
    const FILES = {
      [`${B}/Settings.md`]: SETTINGS,
      [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
      [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
      [`${B}/Accounts/Cheque.md`]:
        '---\ntype: checking\nbalance: 100000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
      [`${B}/Accounts/Nest.md`]:
        '---\ntype: Savings\nbalance: 55000.00\nbalance_updated: 2026-08-01\ntx_label: "Nest"\n---\n',
    };
    for (const m of MONTHS) {
      FILES[`${B}/Transactions/Cheque/${m}.md`] = table([
        `| ${m}-01 | Salary | Salary | 45000.00 | | | |`,
        `| ${m}-05 | Groceries | Groceries | -30000.00 | | | |`,
      ]);
      // R5,000 a month put into the capital-S account.
      FILES[`${B}/Transactions/Nest/${m}.md`] = table([
        `| ${m}-15 | Payday transfer | Groceries | 5000.00 | | | |`,
      ]);
    }
    const ctx = makeCtx(FILES);
    await loadInto(ctx);
    ctx.S.period = '2026-08';
    const H = ctx.healthSnapshot().metrics;

    near(H.monthlySavings, 5000, 0.01,
      `contributions into the capital-S account count toward the saving rate — got ${H.monthlySavings}`);
    ok(H.savingsRate > 0, `so the savings rate pillar is not silently zeroed — got ${H.savingsRate}`);
  }

  console.log(`PASS  savings-account-type-casing.test.cjs / part 1+2  (${checks} checks)`);
})();

/* ---- 3. the stale-valuation threshold is READ from views/assets.js, not
   re-declared — and a zero-valued asset stays out of THIS caveat on purpose
   (see views/savings.js's own comment on staleAssets for why) ---------- */
(async () => {
  const FILES = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 5000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
    [`${B}/Assets.md`]:
      '---\nkind: assets\n---\n\n| Name | Type | Value | Valued | Notes |\n|---|---|---:|---|---|\n'
      // 40 days old on the pinned clock (2026-08-12): stale under a 30-day
      // threshold, but NOT under the 365-day default the old hand-declared
      // constant always used regardless of what this test sets.
      + '| Boat | vehicle | 90000 | 2026-07-03 |  |\n'
      // Zero-valued and much older than either threshold — real per
      // assets.js's own isStaleValuation, but deliberately excluded from a
      // caveat stated in money terms (see the comment on staleAssets).
      + '| Timeshare | property | 0 | 2024-01-01 |  |\n',
  };
  const { ctx, nodes } = await mountSavings(FILES);
  // Simulates views/assets.js publishing a LOWERED threshold — the plumbing
  // this guards is that savings.js reads it live off ctx rather than a
  // constant baked in at its own registration.
  ctx.VALUED_STALE_DAYS = 30;
  ctx.renderSavings();

  const caveats = byCls(nodes.get('savingsStale'), 'kpi-caveat-txt').map(flat);
  const assetCaveat = caveats.find(t => t.includes('was last valued over a year ago'));

  ok(assetCaveat,
    `a 40-day-old valuation is flagged once ctx.VALUED_STALE_DAYS is 30 — `
    + `the old hand-declared 365-day constant could never see this. Caveats: ${JSON.stringify(caveats)}`);
  ok(assetCaveat && assetCaveat.includes(money(90000, 0)),
    `the money figure is the R90,000 boat only — got "${assetCaveat}"`);
  ok(assetCaveat && !assetCaveat.includes(money(0, 0)) && !/R0(?!\d)/.test(assetCaveat),
    `the zero-valued, older-still Timeshare is deliberately left out of a caveat `
    + `stated in Rand — got "${assetCaveat}"`);

  console.log(`PASS  savings-account-type-casing.test.cjs / part 3  (${checks} checks)`);
})();
