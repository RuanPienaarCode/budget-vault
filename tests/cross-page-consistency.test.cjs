'use strict';
/* Cross-page consistency: the seams BETWEEN modules, pinned.

   Every module here is well-tested against itself. What nothing pinned until
   now is the seams a reader can actually see: the same period rendered on two
   pages through two independent code paths.

     — The Dashboard hero's "Total Spent" comes from periodSummary() in
       src/period.js: GROSS outgoings, uncategorised and unknown included.
     — The comparison column and trend chart come from periodSpend() in
       src/trend-math.js: NET per named category, refunds folded in,
       uncategorised dropped.
     — The donut draws from periodSummary().byCat with the same net-of-refunds
       reading, and its "not shown" note claims to account for the WHOLE
       difference against the hero.

   Three code paths, one vault, three figures on screen at once. They are
   ALLOWED to differ — net-vs-gross is a design decision the donut's note says
   out loud — but the difference must equal exactly its two documented parts:
   uncategorised gross spend, and refunds netted inside named categories.
   Nothing unexplained, in either direction, ever.

   The identities:

     1. hero spend === donutTotal + uncatSpend + netting
     2. periodSpend(p).whole summed === hero spend − uncatSpend − netting
        (equivalently: the comparison column and the donut agree exactly)
     3. the note's own decomposition — notShown split into uncat + netted the
        way renderSplit computes it — reproduces those same two parts

   `netting` is restated here independently (gross outgoings per named
   non-income/non-transfer category, minus what the donut keeps of it), never
   asked of the code under test — same policy as summary-conservation's
   oracle, for the same reason.

   donutTotal() USED TO be a second restatement in that same spirit: named
   categories, not income-typed, not transfer-typed, net negative — a hand
   copy of renderSplit's own selection rule (src/views/dashboard.js). That
   made this file's own header claim ("the seams a reader can actually see")
   false for exactly this leg: renderSplit could drift from the copy and this
   suite would stay green, because neither side was ever the shipped code.
   `netting`'s independent-oracle policy is fine for a NUMBER nothing else
   computes; it was the wrong call for a SELECTION RULE something else already
   implements and ships. donutTotal() now mounts the REAL registerDashboard
   view (same DOM-stub approach as tests/dashboard-cards.test.cjs) and reads
   the total straight out of #dashSplitSub, the element renderSplit itself
   writes — so a change to the selection rule shows up here whether or not
   anyone thought to update a second copy of it.

   A future edit to either module's veto handling now breaks arithmetic here
   rather than silently drifting the comparison column away from the hero
   while every per-module test stays green.

   Runs in bare node against the REAL loader, period, trend-math and
   dashboard-view modules.
     node tests/cross-page-consistency.test.cjs      # non-zero exit on failure */

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { worth } = require('../src/worth');
const { netByOwner } = require('../src/owners');
const { normalizeAmount } = require('../src/amount');
const { financialScore, scoreBreakdown } = require('../src/health-math');

let checks = 0;
const ok = (cond, m) => { assert.ok(cond, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const c = v => { const n = Math.round(v * 100); return n === 0 ? 0 : n; };
const eqMoney = (a, b, m) => eq(c(a), c(b), `${m} (got ${a}, want ${b})`);

/* --------------------------- minimal DOM stub ---------------------------
   Same shape as tests/dashboard-cards.test.cjs's FakeEl/FakeText — copied
   rather than shared, matching this repo's convention of each bare-node test
   file being self-contained. Only what registerDashboard's renderSplit
   actually touches: element creation, classList, textContent, append/empty,
   attributes and event listeners. */
class FakeText {
  constructor(t) { this.nodeType = 3; this.textContent = String(t); this.children = []; }
}
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
      add: (...cl) => cl.forEach(x => self._cls.add(x)),
      remove: (...cl) => cl.forEach(x => self._cls.delete(x)),
      toggle: (cl, on) => (on ? self._cls.add(cl) : self._cls.delete(cl)),
      contains: cl => self._cls.has(cl),
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._text + this.children.map(ch => ch.textContent).join(''); }
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
// Empty throughout, so chart.js's themeColors() takes its documented hex
// fallbacks rather than depending on a stylesheet this test does not load.
global.getComputedStyle = () => ({ getPropertyValue: () => '' });
function hasClass(el, cls) {
  if (el._cls && el._cls.has(cls)) return true;
  return (el.children || []).some(c => hasClass(c, cls));
}

const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
const txFile = rows => `---\n${TX_FM}\n---\n${HEAD}${rows.map(
  r => `| ${r[0]} | ${r[1]} | ${r[2] || ''} | ${r[3].toFixed(2)} | ${r[4] || ''} |  |\n`).join('')}`;

const BASE = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#888888"\n---\n',
  [`${B}/Categories/Fun.md`]: '---\ntype: expense\ncolor: "#aa3366"\n---\n',
  [`${B}/Categories/Move.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',
  [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-08-01\n---\n',
  [`${B}/Accounts/Vault.md`]: '---\ntype: savings\ntx_label: "Vault"\nbudget: false\nbalance: 500.00\nbalance_updated: 2026-08-01\n---\n',
};

async function vault(files) {
  const ctx = makeCtx({ ...BASE, ...files }, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';

  /* Mount the real dashboard view onto this same ctx, so donutTotal() below
     reads renderSplit's own output rather than a second copy of its rule.
     Minimal wiring: only #dashSplit/#splitRange/#dashSplitSub are ever
     touched by renderSplit's happy path. money() is overridden to a plain,
     exactly-invertible format — same trick tests/dashboard-cards.test.cjs
     uses — so the rendered figure can be parsed back without fighting the
     locale's thousands/decimal separators. */
  const nodes = new Map(['dashSplit', 'splitRange', 'dashSplitSub'].map(id => [id, new FakeEl('div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  require('../src/views/dashboard')(ctx);
  ctx._dashNodes = nodes;
  return ctx;
}

/* The donut's total, read from the REAL rendered view rather than restated.
   renderSplit() (guarded, as ctx.renderSplit) writes #dashSplitSub as
   "{money(total)} across {n} categories · {month}{gapNote}" when total > 0,
   or just "{month}{gapNote}" when it is exactly 0 — so a missing "across"
   match means the real total was 0, not that the test failed to find it.

   renderSplit() itself reads S.period, not an argument — this function takes
   `p` and stamps it onto S.period before rendering so the donut it reads back
   is provably for the SAME period assertIdentities is comparing against.
   Every caller today happens to set S.period to the one `p` it ever passes
   (see the mount() call sites below), so this was latent rather than live —
   but nothing stopped a future multi-period case from calling this with a
   `p` that had drifted from S.period and silently comparing one page's
   current-period donut against another page's named-period identity. */
function donutTotal(ctx, p) {
  ctx.S.period = p;
  ctx.renderSplit();
  const dashSplit = ctx._dashNodes.get('dashSplit');
  ok(!hasClass(dashSplit, 'text-danger'),
    'the donut card rendered without its guard catching a failure — a caught failure would silently read as a R0 total below');
  const sub = ctx._dashNodes.get('dashSplitSub').textContent;
  const m = /^R\s*(-?[\d.]+)\s+across/.exec(sub);
  return m ? Number(m[1]) : 0;
}

/* Independent netting: for each named non-income/non-transfer category, gross
   outgoings from the RAW rows minus what the donut keeps of that category.
   Computed from the same row list the identity ranges over (excluded,
   non-budget AND foreign vetoes applied, transfers kept out of the named set).

   THREE vetoes, not two. The currency one is the newest and was the last to
   reach every consumer: summaryInRange() has held foreign rows out of income
   and spend since ISSUE 28, and periodSpend() (src/trend-math.js) joined it
   only in the third pass. An oracle that restates the arithmetic over a WIDER
   row population than the code under test is not an independent check of that
   code, it is a different question — so this walks the same three, reading
   each off ctx rather than re-deriving any of them. Section 8 below is where
   that third one is actually exercised; on a single-currency vault
   `foreignLabels()` is empty and this line costs nothing. */
function nettingOf(ctx, p, sum) {
  const skip = ctx.nonBudgetLabels();
  const foreign = ctx.foreignLabels();
  const { start, end } = ctx.periodRange(p);
  const gross = {};
  for (const t of ctx.txInPeriod(p)) {
    if (t.date < start || t.date > end || t.excluded || skip.has(t.label) || foreign.has(t.label)) continue;
    const type = ctx.catType(t.cat);
    if (!t.cat || type === 'income' || type === 'transfer') continue;
    if (t.amount < 0) gross[t.cat] = (gross[t.cat] || 0) + -t.amount;
  }
  let netting = 0;
  for (const [cat, g] of Object.entries(gross)) {
    netting += g - Math.max(0, -(sum.byCat[cat] || 0));
  }
  return netting;
}

function assertIdentities(ctx, p, label) {
  const sum = ctx.periodSummary(p);
  const donut = donutTotal(ctx, p);
  const netting = nettingOf(ctx, p, sum);

  eqMoney(sum.spend, donut + sum.uncatSpend + netting,
    `${label}: hero spend === donut + uncategorised + netting`);

  const whole = ctx.periodSpend(p, null).whole;
  const trendTotal = Object.values(whole).reduce((t, v) => t + v, 0);
  eqMoney(trendTotal, sum.spend - sum.uncatSpend - netting,
    `${label}: trend/comparison total === hero − uncategorised − netting`);
  eqMoney(trendTotal, donut, `${label}: the comparison column and the donut agree exactly`);

  /* renderSplit's note, restated: the decomposition it prints must name the
     same two parts the identity is built from. */
  const notShown = Math.max(0, sum.spend - donut);
  const uncat = Math.min(sum.uncatSpend || 0, notShown);
  eqMoney(uncat, sum.uncatSpend, `${label}: the note's uncategorised part is the whole uncategorised figure`);
  eqMoney(notShown - uncat, netting, `${label}: the note's netted part is exactly the refund-netting`);
}

/* --------------------- second DOM stub, for Accounts/Budgets ---------------
   Accounts and Budgets touch dozens of ids (drag-resize columns, owner chips,
   the ring's own SVG) rather than the Dashboard's fixed handful, so an
   auto-vivifying `$` stands in instead of hand-listing every container. It
   is the SAME FakeEl class already declared above — proven against both
   views (accounts.js and budgets.js render clean over it) rather than
   pulling in tests/helpers/dom-stub.cjs's own document, which would race
   this file's `global.document = {...}` assignment above it: whichever runs
   first wins, and reusing that second stub's `$`/FakeEl pairing without its
   OWN document underneath would hand a view elements it never actually
   built. One document per process; this file already claimed it. */
function autoDom() {
  const nodes = new Map();
  return sel => {
    const id = sel.slice(1);
    if (!nodes.has(id)) nodes.set(id, new FakeEl('div'));
    return nodes.get(id);
  };
}
function descendAll(el) {
  const out = [el];
  for (const c of (el && el.children) || []) out.push(...descendAll(c));
  return out;
}
function findByClass(root, cls) { return root && descendAll(root).find(n => n._cls && n._cls.has(cls)); }
function findAllByClass(root, cls) { return root ? descendAll(root).filter(n => n._cls && n._cls.has(cls)) : []; }
/* First "R <number>" substring, wherever it sits in a node's rendered text —
   the ring's excluded note and the owner rows carry prose or an asterisk
   around the figure this test actually wants. */
function moneyFrom(text) {
  const m = /R\s*(-?[\d.]+)/.exec(String(text || ''));
  return m ? Number(m[1]) : NaN;
}

async function mountAccounts(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  ctx.$ = autoDom();
  ctx.$$ = () => [];
  ctx.root = ctx.$('#root');
  ctx.view = { containerEl: ctx.root };
  /* Full precision REGARDLESS of the dp a call site passes. The ring's own
     centre and legend intentionally round to whole currency for a reader
     (money(sum, 0)) — this test needs the exact figure underneath that
     rounding, and money() is a test-owned stub, so overriding it to always
     answer at full precision is fair: the view never inspects its own
     formatter's return value, only displays it. */
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.moneyIn = (sym, v) => `${sym} ${Number(v).toFixed(2)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/accounts')(ctx);
  return ctx;
}

async function mountBudget(files) {
  const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
  await loadInto(ctx);
  ctx.S.period = '2026-08';
  ctx.$ = autoDom();
  ctx.$$ = () => [];
  ctx.root = ctx.$('#root');
  ctx.view = { containerEl: ctx.root };
  ctx.money = v => `R ${Number(v).toFixed(2)}`;
  ctx.moneyIn = (sym, v) => `${sym} ${Number(v).toFixed(2)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = type => el('span', { class: `category-badge badge-${type}` }, type);
  require('../src/categories')(ctx);
  require('../src/views/budgets')(ctx);
  return ctx;
}

(async () => {

/* ---- 1. hand-picked: every term of both identities non-zero -------------- */
{
  const ctx = await vault({
    [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
      ['2026-08-01', 'Salary', 'Salary', 30000],
      ['2026-08-02', 'Shop', 'Groceries', -5000],
      ['2026-08-03', 'Shop again', 'Groceries', -3000],
      // a refund inside a category that stays net-negative: netted, still shown
      ['2026-08-04', 'Refund', 'Groceries', 150],
      // a category the refund flips net-POSITIVE: donut drops it whole
      ['2026-08-05', 'Tickets', 'Fun', -200],
      ['2026-08-06', 'Tickets refunded twice over', 'Fun', 900],
      // uncategorised, both directions
      ['2026-08-07', 'Mystery out', '', -700],
      ['2026-08-08', 'Mystery in', '', 400],
      // a category name no file answers to, both directions
      ['2026-08-09', 'Ghost out', 'Ghost', -800],
      ['2026-08-10', 'Ghost in', 'Ghost', 100],
      // the three vetoes, present so the identity is proven over them
      ['2026-08-11', 'Shuffle', 'Move', -2500],
      ['2026-08-12', 'Shuffle back', 'Move', 2500],
      ['2026-08-13', 'Vetoed', 'Groceries', -9999, 'yes'],
    ]),
    [`${B}/Transactions/Vault/2026-08.md`]: txFile([
      ['2026-08-14', 'Off budget', 'Groceries', -7777],
    ]),
  });
  const sum = ctx.periodSummary('2026-08');

  // Anchor the fixture before trusting identities proven on it.
  eqMoney(sum.spend, 9700, 'gross spend counts every outgoing: 5000+3000+200+700+800');
  eqMoney(donutTotal(ctx, '2026-08'), 8550, 'donut keeps Groceries net 7850 and Ghost net 700, drops Fun and the blanks');
  eqMoney(sum.uncatSpend, 700, 'uncategorised gross outgoing');
  eqMoney(nettingOf(ctx, '2026-08', sum), 450, 'netting: 150 in Groceries + all 200 of Fun + 100 of Ghost');

  assertIdentities(ctx, '2026-08', 'hand-picked');
}

/* ---- 2. randomised rounds: the identities, not the example --------------- */
{
  /* Seeded LCG so a failure is reproducible from the log, same as running
     any fixed fixture — Math.random would make a red run unrepeatable. */
  let seed = 0xb0dca7 ^ 20260817;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const pick = a => a[Math.floor(rnd() * a.length)];

  const CATS = ['Salary', 'Groceries', 'Fun', 'Move', 'Ghost', ''];
  for (let round = 0; round < 30; round++) {
    const rows = [];
    const n = 5 + Math.floor(rnd() * 25);
    for (let i = 0; i < n; i++) {
      const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
      const amount = Math.round((rnd() * 4000 - 2000) * 100) / 100;
      if (amount === 0) continue;
      rows.push([`2026-08-${day}`, `row ${round}.${i}`, pick(CATS), amount, rnd() < 0.1 ? 'yes' : '']);
    }
    if (!rows.length) continue;
    const ctx = await vault({ [`${B}/Transactions/Cheque/2026-08.md`]: txFile(rows) });
    assertIdentities(ctx, '2026-08', `round ${round}`);
  }
}

/* ===========================================================================
   3. NET WORTH ACROSS ACCOUNTS, ASSETS, DEBTS, SAVINGS AND SCORE

   Four figures, three of them literal calls to worth() (savings.js and
   health-data.js's healthSnapshot() both call it unfiltered; accounts.js
   filters out an unreadable balance first) plus one that is not a worth()
   call at all — the Accounts hero, Assets' own "Total value" and the Debts
   page's own "Total debt" are each read by a DIFFERENT part of the app and
   have to reconcile by addition, not by sharing one function underneath.

     Accounts hero net + Assets total − Debt total
       === Savings' own "Net worth" tile (worth(accounts, debts, assets).net)
       === Score's own wealth-pillar input (healthSnapshot().metrics.netWorth)

   assetsTotal/debtsTotal are restated here from the raw S.assets/S.debts
   lists rather than asked of worth.js's own assetTotal()/activeDebts() — same
   policy this file's header states for `netting`, applied to a different
   pair. Both floor a negative figure at zero, matching worth.js's own
   documented reasoning (a possession or a debt cannot be worth less than
   nothing) — table-schema.js's `floor: true` on both columns means the clamp
   never actually fires today, but the identity should hold on its own stated
   terms, not on an accident of the loader upstream of it. */
{
  const oracleAssetsTotal = assets => (assets || []).reduce((t, a) => t + Math.max(0, a.value || 0), 0);
  const oracleDebtsTotal = debts => (debts || [])
    .filter(d => d.status !== 'paid')
    .reduce((t, d) => t + Math.max(0, d.balance || 0), 0);
  // The same one-line predicate views/accounts.js defines as unreadableBalance
  // — a balance load.js's strict parse rejected outright. Its fallback value
  // is 0 either way (src/amount.js's parseNum), which is WHY excluding the
  // account here and simply including it at 0 everywhere else never disagree
  // — see the comment on the accounts.js original for the fuller argument.
  const unreadableBalance = a => a.balanceRaw != null && normalizeAmount(a.balanceRaw) === null;

  function netWorthFiles(accounts, debts, assets, settingsFm) {
    const f = { [`${B}/Settings.md`]: `---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n${settingsFm || ''}---\n` };
    accounts.forEach((a, i) => {
      f[`${B}/Accounts/A${i}.md`] = `---\ntype: ${a.type}\nbalance: ${a.balanceRaw != null ? a.balanceRaw : a.balance.toFixed(2)}\n`
        + `balance_updated: 2026-08-01\n---\n`;
    });
    if (debts.length) {
      f[`${B}/Debts.md`] = '---\nkind: debts\n---\n\n'
        + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
        + debts.map((d, i) => `| Debt ${i} |  | loan | ${d.balance.toFixed(2)} |  | 0 | 0 |  |  |  | ${d.status} |  |\n`).join('');
    }
    if (assets.length) {
      f[`${B}/Assets.md`] = '---\nkind: assets\n---\n\n'
        + '| Item | Kind | Value | Valued | Notes |\n|---|---|---:|---|---|\n'
        + assets.map((a, i) => `| Asset ${i} | other | ${a.value.toFixed(2)} |  |  |\n`).join('');
    }
    return f;
  }

  async function assertNetWorth(accounts, debts, assets, label) {
    const ctx = await mountAccounts(netWorthFiles(accounts, debts, assets));
    ctx.renderAccounts();
    const heroNet = moneyFrom(findByClass(ctx.$('#acctSummary'), 'hero-num').textContent);
    const oracleHero = worth(ctx.S.accounts.filter(a => !unreadableBalance(a)), null, null).net;
    const assetsTotal = oracleAssetsTotal(assets);
    const debtsTotal = oracleDebtsTotal(debts);
    const savingsNet = worth(ctx.S.accounts, ctx.S.debts, ctx.S.assets).net;
    const scoreNet = ctx.healthSnapshot().metrics.netWorth;

    eqMoney(heroNet, oracleHero, `${label}: the rendered Accounts hero matches worth() over the same filtered accounts`);
    eqMoney(heroNet + assetsTotal - debtsTotal, savingsNet,
      `${label}: Accounts hero net + Assets total - Debt total reconciles to Savings' Net worth tile`);
    eqMoney(savingsNet, scoreNet, `${label}: Savings' Net worth and Score's wealth-pillar input are the same figure`);
  }

  {
    // ---- anchor: the task's own worked example ----
    await assertNetWorth(
      [{ type: 'checking', balance: 172210.25 }, { type: 'savings', balance: 200000.00 }],
      [{ balance: 185600.00, status: 'active' }],
      [{ value: 2890000.00 }],
      'anchor',
    );
    eqMoney(worth([{ balance: 172210.25 }, { balance: 200000.00 }], null, null).net, 372210.25,
      'anchor: the accounts alone sum to the task\'s own stated figure');

    // ---- randomised rounds — zero income, no debts, one account, a
    //      household worth less than nothing, an unreadable balance ----
    let seed = 0x9e17b0 ^ 20260824;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const TYPES = ['checking', 'savings', 'investment', 'credit_card', 'cash', 'other'];
    let rounds = 0;
    for (let round = 0; round < 30; round++) {
      const accounts = [];
      const n = 1 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) {
        const a = { type: pick(TYPES), balance: Math.round((rnd() * 60000 - 20000) * 100) / 100 };
        // ~1 in 7: a balance load.js cannot parse at all.
        if (rnd() < 0.15) { a.balanceRaw = 'TBC'; a.balance = 0; }
        accounts.push(a);
      }
      const debts = [];
      for (let i = 0; i < Math.floor(rnd() * 4); i++) {
        debts.push({ balance: Math.round(rnd() * 50000 * 100) / 100, status: rnd() < 0.3 ? 'paid' : 'active' });
      }
      const assets = [];
      for (let i = 0; i < Math.floor(rnd() * 4); i++) assets.push({ value: Math.round(rnd() * 3000000 * 100) / 100 });
      await assertNetWorth(accounts, debts, assets, `net-worth round ${round}`);
      rounds++;
    }
    ok(rounds === 30, 'net-worth: all 30 randomised rounds ran');
    console.log(`  ok — net worth reconciles across Accounts, Assets, Debts, Savings and Score (${rounds + 1} vaults)`);
  }
}

/* ===========================================================================
   4. ACCOUNTS OWNER SPLIT === ACCOUNTS HERO NET

   tests/account-owner.test.cjs already pins one hand-picked vault for this.
   This is the same identity restated as a fuzz: netByOwner (src/owners.js,
   the exact function views/accounts.js's whoseItIs() calls) against worth()
   (the exact call renderSummary's hero makes), over many random ownership
   shapes rather than one. netByOwner does not filter an unreadable balance
   the way worth()'s caller does — see the note on unreadableBalance above for
   why that never shows up as a numeric difference. */
{
  const unreadableBalance = a => a.balanceRaw != null && normalizeAmount(a.balanceRaw) === null;
  let seed = 0x0ceac0 ^ 20260824;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const OWNERS = ['Alex', 'Sam', 'joint', '', 'Ouma'];  // Ouma: undeclared, on purpose

  let rounds = 0;
  for (let round = 0; round < 30; round++) {
    const files = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nowners: "Alex, Sam"\n---\n' };
    const n = 1 + Math.floor(rnd() * 7);
    for (let i = 0; i < n; i++) {
      const owner = pick(OWNERS);
      const raw = rnd() < 0.1 ? 'TBC' : null;
      const balance = raw ? 0 : Math.round((rnd() * 40000 - 15000) * 100) / 100;
      files[`${B}/Accounts/A${i}.md`] = `---\ntype: checking\nbalance: ${raw || balance.toFixed(2)}\n`
        + `balance_updated: 2026-08-01\n${owner ? `owner: ${owner}\n` : ''}---\n`;
    }
    const ctx = makeCtx(files, { settings: { month_start_day: 1 } });
    await loadInto(ctx);
    const rows = netByOwner(ctx.S.accounts, ctx.S.settings.owners);
    const heroNet = worth(ctx.S.accounts.filter(a => !unreadableBalance(a)), null, null).net;

    eqMoney(rows.reduce((s, r) => s + r.net, 0), heroNet, `owner-split round ${round}: the split sums to the hero net`);
    eq(rows.reduce((s, r) => s + r.count, 0), ctx.S.accounts.length,
      `owner-split round ${round}: every account is counted in exactly one bucket`);
    rounds++;
  }
  ok(rounds === 30, 'owner-split: all 30 randomised rounds ran');
  console.log(`  ok — the "Whose it is" split sums to the Accounts hero net (${rounds} randomised rounds)`);
}

/* ===========================================================================
   5. ACCOUNTS RING CENTRE − EXCLUDED === HERO NET

   whereItSits() draws only the POSITIVE group totals (a donut cannot draw a
   negative wedge) and, whenever a group nets negative, names it AND states
   the amount left out — see the "excluded" note in views/accounts.js. The
   ring's own legend total minus that stated exclusion has to land back on
   the same net figure the hero states two cards up.

   ACCT_GROUPS itself is not exported, so this reads the REAL rendered legend
   and note rather than re-deriving which type belongs to which group — the
   same donut-selection-rule lesson this file's header already draws about
   donutTotal(). Every round below guarantees at least one clearly positive
   account so the ring always draws something and the exclusion note (when it
   fires) always carries a figure to compare against. */
{
  let seed = 0x5ca1ab1e ^ 20260824;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const NEG_TYPES = ['checking', 'credit_card', 'investment', 'other'];

  let rounds = 0;
  for (let round = 0; round < 30; round++) {
    const files = { [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n' };
    // Always at least one solidly positive savings account, so `sum` (the
    // ring's own drawn total) is never zero — see the comment below the loop
    // for the sum === 0 case this generator deliberately never reaches.
    files[`${B}/Accounts/Anchor.md`] = `---\ntype: savings\nbalance: ${(5000 + rnd() * 20000).toFixed(2)}\nbalance_updated: 2026-08-01\n---\n`;
    const n = Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const balance = Math.round((rnd() * 30000 - 15000) * 100) / 100;
      files[`${B}/Accounts/N${i}.md`] = `---\ntype: ${pick(NEG_TYPES)}\nbalance: ${balance.toFixed(2)}\nbalance_updated: 2026-08-01\n---\n`;
    }

    const ctx = await mountAccounts(files);
    ctx.renderAccounts();
    const summary = ctx.$('#acctSummary');
    const heroNet = moneyFrom(findByClass(summary, 'hero-num').textContent);
    const ring = findByClass(summary, 'acct-ring');
    ok(ring, `ring round ${round}: the ring card renders`);
    const legendSum = findAllByClass(ring, 'dl-val').reduce((s, n) => s + moneyFrom(n.textContent), 0);
    const note = findByClass(ring, 'acct-ring-note');
    const excluded = note ? moneyFrom(note.textContent) : 0;
    // moneyFrom returns NaN when the negative note fired but stated NO
    // figure — see the live gap reported alongside this file (the sum === 0
    // "every group is negative" path never reaches this note at all, so it
    // is out of this generator's reach; a note that DOES fire here must
    // always be the excluded-with-amount one, per views/accounts.js).
    ok(!Number.isNaN(excluded), `ring round ${round}: the negative note states an amount when it fires`);
    eqMoney(legendSum - (excluded || 0), heroNet,
      `ring round ${round}: legend total minus the excluded note reconciles to the hero net`);
    rounds++;
  }
  ok(rounds === 30, 'ring: all 30 randomised rounds ran');
  console.log(`  ok — the ring's legend total, minus what it excludes, matches the Accounts hero net (${rounds} randomised rounds)`);
}

/* ===========================================================================
   6. BUDGET PAGE "TOTAL SPENT" — vs the Dashboard hero, and vs its own table

   Two seams at once, because they share the same restated raw material:

     (a) Budget's "Total spent" is sum.spend (the Dashboard hero's own GROSS
         figure, unmodified) PLUS an assume-spent overlay — but that overlay
         is the SHORTFALL beyond real spend (max(0, budgeted − realSpend)),
         never the raw budgeted amount. period.js exports a SECOND function
         under the name `assumedSpend(p)` that returns the raw, unclamped
         total — and nothing in src/ ever calls it (grep confirms: the only
         call site left is tests/assume-spent.test.cjs, on a fixture where
         the assumed category has zero real spend, so the two formulas
         happen to agree there and only there). The two diverge the moment a
         category is BOTH flagged assume-spent AND has a real transaction —
         reported separately below, since fixing period.js is out of this
         suite's lane.

     (b) The rendered Actual column has to sum back to that same tile, given
         the two parts the tile's own gapNote already discloses (uncategorised
         + unknown-name spend, and refund-netting inside a named category —
         the SAME `gapUncat`/`gapNetted` split section 1's `netting` already
         proves). A row's own Actual is UNCLAMPED (it can print negative, for
         a category that netted a refund) while the tile's internal
         `namedNetSpend` clamps each category at zero before summing — so the
         column is summed here with the same clamp, and the money that clamp
         would otherwise hide is named as its own term rather than dropped. */
{
  const CATS = ['Groceries', 'Fun', 'Rent'];   // fixed, unambiguous names — no one a prefix of another
  let seed = 0xb00c5 ^ 20260824;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const pick = a => a[Math.floor(rnd() * a.length)];

  function budgetFiles({ budgeted, txRows }) {
    const f = {
      [`${B}/Settings.md`]: '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\noverspend_lag: 1\n---\n',
      [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#33aa66"\n---\n',
      [`${B}/Categories/Move.md`]: '---\ntype: transfer\ncolor: "#6c757d"\n---\n',
      [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000.00\nbalance_updated: 2026-08-01\n---\n',
    };
    // Every named category gets a FILE regardless of whether it is chosen
    // into `budgeted` below — budgetDraft() seeds a row from S.categories
    // whether or not the period file mentions it, so an unbudgeted category
    // still has to exist as a category to prove that seeding.
    for (const cat of CATS) {
      const meta = budgeted[cat];
      f[`${B}/Categories/${cat}.md`] = `---\ntype: expense\ncolor: "#888888"\n${meta && meta.assumed ? 'assume_spent: true\n' : ''}---\n`;
    }
    const rows = [
      '| Salary | income | 10000.00 | |',
      ...Object.entries(budgeted).map(([cat, meta]) => `| ${cat} | expense | ${meta.amount.toFixed(2)} | |`),
    ];
    f[`${B}/Budgets/2026-08.md`] = `---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n${rows.join('\n')}\n`;
    const HEAD = '\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n';
    f[`${B}/Transactions/Cheque/2026-08.md`] = '---\ntags: [finance, finance/budget, finance/budget/transactions]\n---\n' + HEAD
      + txRows.map(r => `| ${r[0]} | row | ${r[1] || ''} | ${r[2].toFixed(2)} | ${r[3] || ''} |  |\n`).join('');
    return f;
  }

  let rounds = 0;
  for (let round = 0; round < 30; round++) {
    const budgeted = {};
    for (const cat of CATS) {
      // Every category not chosen here still gets a draft row — budgetDraft()
      // seeds one from S.categories regardless — so leaving a category out
      // is exactly the "budgeted 0, unbudgeted" shape, not an absent row.
      if (rnd() < 0.7) budgeted[cat] = { amount: Math.round(rnd() * 5000 * 100) / 100, assumed: rnd() < 0.4 };
    }
    const txRows = [];
    const n = 4 + Math.floor(rnd() * 16);
    for (let i = 0; i < n; i++) {
      const day = String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
      // '' (blank), 'Ghost' (unknown-name), Move (transfer) and the three
      // named expense categories — every state periodSummary tracks.
      const cat = pick(['', 'Ghost', 'Move', ...CATS]);
      const amount = Math.round((rnd() * 3000 - 1500) * 100) / 100;
      if (!amount) continue;
      txRows.push([`2026-08-${day}`, cat, amount, rnd() < 0.08 ? 'yes' : '']);
    }
    if (!txRows.length) continue;

    const ctx = await mountBudget(budgetFiles({ budgeted, txRows }));
    ctx.renderBudgets();
    const sum = ctx.periodSummary('2026-08');

    /* An assume-spent category that ALSO nets a REFUND this period (more came
       back than went out) used to be SKIPPED here, and the skip named a second
       live bug as the reason: the tile's overlay subtracted an unclamped
       `realSpend`, so a negative one counted the refund's own excess as extra
       shortfall on top of the full budgeted amount — budgeted R1 000 against a
       net refund of R700 gave an overlay of R1 700 for a row the table beneath
       showed at R1 000.

       That bug is fixed (views/budgets.js clamps at zero, and the overlay is
       now DERIVED from the row's own assumedActual() rather than restated), so
       the skip has to go — a suite that keeps stepping around a repaired
       defect stops guarding it, and this is the round that would catch it
       coming back. The oracle below clamps the same way the code does, which
       is the whole assertion: two clamps, one answer. */

    // ---- (a) Budget vs Dashboard, decomposed by the REAL overlay ----
    let realOverlay = 0;
    for (const [cat, meta] of Object.entries(budgeted)) {
      if (!meta.assumed) continue;
      const realSpend = -(sum.byCat[cat] || 0);
      /* Math.max(0, realSpend), restated independently rather than imported:
         a refunded category contributes NOTHING to what was really spent, not
         a negative slice of it, so the shortfall the assumption still has to
         cover is the whole budgeted amount. */
      realOverlay += Math.max(0, meta.amount - Math.max(0, realSpend));
    }
    const tiles = findAllByClass(ctx.$('#budTotalsTop'), 'bud-total');
    const spentTileText = tiles[tiles.length - 1] && findByClass(tiles[tiles.length - 1], 'bud-total-v').textContent;
    const spentTileValue = moneyFrom(spentTileText);
    /* ADR-0005: the tile is the hero's numerator — gross spend less set-aside
       — plus the overlay. `setAside` restated from the summary, not asked of
       budgetUsed(), for the same oracle policy as everything else here. */
    const dashboardSpend = Math.max(0, sum.spend - (sum.setAside || 0));

    eqMoney(spentTileValue, dashboardSpend + realOverlay,
      `budget round ${round}: Total spent === the hero's spend-less-set-aside + the SHORTFALL-clamped overlay`);
    eqMoney(ctx.budgetUsed('2026-08').spent, spentTileValue,
      `budget round ${round}: and budgetUsed().spent is that same figure`);

    // ---- (b) the table's Actual column, clamped and decomposed ----
    const bodyRows = (ctx.$('#budTable').children[1] && ctx.$('#budTable').children[1].children) || [];
    /* Every named row's Actual, CLAMPED at zero before summing — the same
       clamp budgetTotalsStrip's own namedNetSpend applies (a category that
       netted a refund contributes nothing to "how much was spent", not a
       negative slice of it). `clampLoss` is the money that clamp hides —
       named on its own rather than silently dropped, though under the guard
       above it can only ever come from a NON-assumed category here. */
    let clampedColumn = 0, clampLoss = 0, seenCats = 0;
    for (const tr of bodyRows) {
      if (tr._cls && tr._cls.has('type-row')) continue;
      const cells = tr.children || [];
      if (cells.length < 4) continue;
      const catCell = (cells[0].textContent || '');
      const cat = CATS.find(c => catCell.startsWith(c));
      if (!cat) continue;   // Salary's own row, or none matched
      seenCats++;
      const actual = moneyFrom(cells[3].textContent);
      if (actual < 0) clampLoss += -actual; else clampedColumn += actual;
    }
    eq(seenCats, CATS.length, `budget round ${round}: every named expense category has its own row, budgeted or not`);

    const namedNetSpendOracle = CATS.reduce((t, cat) => t + Math.max(0, -(sum.byCat[cat] || 0)), 0);
    eqMoney(clampedColumn, namedNetSpendOracle + realOverlay,
      `budget round ${round}: the clamped Actual column equals the named net spend plus the assume-spent overlay`);
    ok(clampLoss >= 0, `budget round ${round}: clamping never hides a negative amount of hidden money`);

    const grossGap = Math.max(0, sum.spend - namedNetSpendOracle);
    const gapUncat = Math.min((sum.uncatSpend || 0) + (sum.unknown.spend || 0), grossGap);
    const gapNetted = grossGap - gapUncat;
    eqMoney(spentTileValue, clampedColumn + gapUncat + gapNetted,
      `budget round ${round}: Total spent === the clamped Actual column + the tile's own uncategorised/netted disclosure`);

    rounds++;
  }
  ok(rounds >= 25, 'budget-vs-dashboard: enough randomised rounds ran');
  console.log(`  ok — Budget's "Total spent" reconciles to the Dashboard hero and to its own Actual column (${rounds} randomised rounds)`);

  /* ---- reported, not asserted: the documented helper the two pages were
     supposed to share (period.js's assumedSpend(p)) is dead code — grep
     finds no call site outside this file's own probe and
     tests/assume-spent.test.cjs — and it returns the RAW budgeted amount,
     not the shortfall. On a category flagged assume-spent that ALSO carries
     a real transaction, assumedSpend(p) overstates the actual overlay by
     exactly that category's real spend. See this run's final report for the
     worked example. */
}

/* ===========================================================================
   7. SCORE PILLARS: headline vs popup — Σ shownPoints, Σ shownMax, and no
      pillar ever printing more than its own maximum ("saving 27 of 26")

   Pure arithmetic on src/health-math.js — scoreBreakdown's own header already
   names the exact failure mode this guards: two independent largest-remainder
   allocations (one for shownMax, a second rounding `points` on its own)
   could round one pillar's ceiling down while rounding that SAME pillar's
   points up. Fuzzed directly at the FRACTIONS layer (financialScore's own
   input) rather than through a synthetic vault: every combination of which
   measures a vault can and cannot answer is reachable this way, where a vault
   fuzzer would have to get lucky to hit the same corners. */
{
  const KEYS = ['cover', 'rate', 'interest', 'instalments', 'fixed', 'consumption', 'budget', 'networth'];
  let seed = 0xf1a7 ^ 20260824;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000;

  // ---- anchor: the exact shape the code comment names ----
  {
    const score = financialScore({ cover: 1, rate: 0.63, interest: null, instalments: null, fixed: 0.71, consumption: 0.44, budget: null, networth: null });
    const b = scoreBreakdown({ score }, 6);
    eq(b.pillars.reduce((s, p) => s + p.shownMax, 0), 100, 'anchor: shownMax sums to 100');
    eq(b.pillars.reduce((s, p) => s + p.shownPoints, 0), score.value, 'anchor: shownPoints sums to the headline');
    for (const p of b.pillars) ok(p.shownPoints <= p.shownMax, `anchor: ${p.key} never prints more than its own maximum (got ${p.shownPoints} of ${p.shownMax})`);
  }

  let rounds = 0, live = 0;
  for (let round = 0; round < 60; round++) {
    const fractions = {};
    for (const k of KEYS) fractions[k] = rnd() < 0.2 ? null : Math.round(rnd() * 100) / 100;
    const score = financialScore(fractions);
    if (!score) continue;   // nothing measurable this round — financialScore itself returns null
    live++;
    const b = scoreBreakdown({ score }, 6);

    eq(b.pillars.reduce((s, p) => s + p.shownMax, 0), 100, `score round ${round}: shownMax sums to 100`);
    eq(b.pillars.reduce((s, p) => s + p.shownPoints, 0), score.value, `score round ${round}: shownPoints sums to the headline`);
    for (const p of b.pillars) {
      ok(Number.isInteger(p.shownMax) && Number.isInteger(p.shownPoints), `score round ${round}: ${p.key}'s shown figures are whole numbers`);
      ok(p.shownPoints >= 0 && p.shownPoints <= p.shownMax,
        `score round ${round}: ${p.key} never prints more than its own maximum (got ${p.shownPoints} of ${p.shownMax})`);
    }
    rounds++;
  }
  ok(rounds >= 20, 'score-pillars: enough live-scoring randomised rounds ran');
  console.log(`  ok — score pillars: headline and popup always add up, no pillar ever over its own maximum (${rounds} of ${60} rounds scored something measurable)`);
}

/* ===========================================================================
   8. THE SAME THREE IDENTITIES, WITH A SECOND CURRENCY IN THE VAULT

   Sections 1 and 2 prove the hero, the donut and the comparison column
   reconcile on a rand vault. They could not see the last hole ISSUE 28 left
   open, because a single-currency vault has no foreign row for anything to
   leak: `summaryInRange()` (src/period.js) held foreign rows out of the hero
   and the donut, and `periodSpend()` (src/trend-math.js) went on adding them
   into the comparison column and the trend chart. Two pages, one period, and
   a Rp 3 000 000 market trip drawn as rand groceries on exactly one of them.

   So this is the same fixture as section 1, plus one rupiah account spending
   under the household's OWN categories — the shape that lands inside an
   existing bar and reads as a real month of overspending, rather than adding
   an obviously foreign row somebody would notice. Every identity
   assertIdentities already makes must survive it unchanged, and the hero's
   own figure must be unchanged by the account's presence at all: nothing
   about a rupiah row belongs in a rand comparison, in either direction.

   The two vaults are compared rather than checked against constants, for the
   reason tests/score-currency-isolation.test.cjs states in its own header: an
   equality between two loads needs no expected number, so nothing about it
   can be tuned to whatever the code happens to do. --------------------- */
{
  const HOUSEHOLD_ROWS = [
    ['2026-08-01', 'Salary', 'Salary', 30000],
    ['2026-08-02', 'Shop', 'Groceries', -5000],
    ['2026-08-04', 'Refund', 'Groceries', 150],
    ['2026-08-05', 'Tickets', 'Fun', -200],
    ['2026-08-07', 'Mystery out', '', -700],
    ['2026-08-09', 'Ghost out', 'Ghost', -800],
  ];
  const files = { [`${B}/Transactions/Cheque/2026-08.md`]: txFile(HOUSEHOLD_ROWS) };

  const home = await vault(files);
  const mixed = await vault({
    ...files,
    [`${B}/Accounts/Holiday.md`]:
      '---\ntype: checking\ncurrency: "Rp"\ntx_label: "Holiday"\nbalance: 5000000.00\nbalance_updated: 2026-08-01\n---\n',
    [`${B}/Transactions/Holiday/2026-08.md`]: txFile([
      ['2026-08-03', 'Freelance', 'Salary', 20000000],
      ['2026-08-06', 'Market', 'Groceries', -3000000],
      ['2026-08-08', 'Villa', 'Fun', -15000000],
    ]),
  });

  /* The identities themselves, over the mixed vault. Each of the three terms
     is computed by a different module, and the currency filter had reached
     only two of them. */
  assertIdentities(mixed, '2026-08', 'foreign account present');

  /* And the figures are not merely CONSISTENT with each other, they are the
     household's own. Three pages could agree perfectly on a wrong number —
     that is what a shared leak looks like — so each is compared against the
     same vault without the rupiah account in it. */
  const hs = home.periodSummary('2026-08');
  const ms = mixed.periodSummary('2026-08');
  eqMoney(ms.spend, hs.spend, 'the hero\'s Total Spent is unchanged by a rupiah account');
  eqMoney(donutTotal(mixed, '2026-08'), donutTotal(home, '2026-08'),
    'and so is the donut it is drawn beside');
  const total = ctx => Object.values(ctx.periodSpend('2026-08', null).whole).reduce((t, v) => t + v, 0);
  eqMoney(total(mixed), total(home),
    'and so is the comparison column — a rupiah market trip is not rand groceries');

  /* The anchor. Without it every equality above would hold on a pair of
     vaults that both read zero, which is the one way this section could pass
     while measuring nothing. */
  ok(total(home) > 0 && hs.spend > 0,
    'the household vault really does spend something for the comparisons above to be about');
  console.log('  ok — a second currency changes none of the three figures, and the identities hold over it');
}

console.log(`PASS — the pages agree: hero, donut, note and comparison column reconcile exactly (${checks} assertions, 30 randomised rounds).`);
})().catch(e => { console.error(e); process.exit(1); });
