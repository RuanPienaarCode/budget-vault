'use strict';
/* The dashboard's four cards, and what each one is allowed to do to the others.

   Reported as "the Where it went graph doesn't update when the numbers
   change". Two separate things in this file produce exactly that sentence, and
   neither of them is a staleness bug, which is why looking for one found
   nothing:

     1. renderDashboard used to be four bare calls in a row with no try/catch
        anywhere between it and controller.js's render(). A throw while
        building the trend meant renderSplit() and the budget table never ran.
        They did not go BLANK — both had already been drawn once, so they held
        the PREVIOUS period's picture while the hero above them, built first,
        updated normally. A chart frozen on plausible old data is worse than a
        missing one: it reads as "not updating" rather than as an error, so the
        exception behind it is never looked for. Each card now renders behind
        its own guard, and a failure says so where the card was.

     2. The donut counts categorised spending only. The hero's Total Spent
        counts everything. A vault whose spending is largely uncategorised
        therefore has a hero that moves on every import and a donut that
        genuinely does not — the two disagreeing by exactly the uncategorised
        figure, with nothing on screen to say so. The donut now names what it
        is leaving out.

   Both are pinned here against the REAL loader, the REAL periodSummary and the
   REAL renderDashboard, over a minimal DOM stub — same approach as
   onboarding-render.test.cjs. Bare node; wired into ./build.sh.
     node tests/dashboard-cards.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* --------------------------------- DOM ---------------------------------- */
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
    /* Two injection points, for the two shapes a card failure really takes.

       failNextAppend fails the card AFTER it has cleared itself, which is
       where a real bug lands: every render* empties its container first and
       then builds. One-shot, so the guard's own recovery append still works
       and the on-screen message can be asserted.

       explode fails empty() itself — the nastier case, where the guard cannot
       clear or repaint either. Nothing can be shown there, and the only thing
       that matters is that the failure does not cascade to the other cards. */
    this.failNextAppend = null;
    this.explode = null;
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
  empty() { if (this.explode) throw new Error(this.explode); this.children = []; this._text = ''; }
  append(...kids) {
    if (this.failNextAppend) { const m = this.failNextAppend; this.failNextAppend = null; throw new Error(m); }
    for (const k of kids) this.children.push(k);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
}
global.document = {
  createElement: t => new FakeEl(t),
  createElementNS: (_ns, t) => new FakeEl(t),
  createTextNode: t => new FakeText(t),
};
// Empty values throughout, so themeColors() takes its documented hex fallbacks
// rather than depending on a stylesheet this test does not load.
global.getComputedStyle = () => ({ getPropertyValue: () => '' });

/* Depth-first over real element children. */
function all(el, pred, out = []) {
  for (const c of el.children) {
    if (c instanceof FakeEl) { if (pred(c)) out.push(c); all(c, pred, out); }
  }
  return out;
}
const has = (el, cls) => all(el, e => e._cls.has(cls)).length > 0;
const tagCount = (el, tag) => all(el, e => e.tagName === tag).length;

/* ------------------------------- fixture -------------------------------- */
/* month_start_day: 1 so a period key IS its calendar month and the dates below
   need no arithmetic to read. */
const B = 'Budget';
const TX_FM = 'tags: [finance, finance/budget, finance/budget/transactions]';
const SETTINGS = `---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\nhousehold: "Test House"\n---\n`;

const CATS = {
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#c0392b"\n---\n',
  [`${B}/Categories/Transport.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
};
const ACCOUNT = { [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 100\n---\n' };
const BUDGET = {
  [`${B}/Budgets/2026-07.md`]:
    '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n' +
    '| Groceries | expense | 5000.00 |  |\n| Transport | expense | 1000.00 |  |\n',
};

const txFile = rows =>
  `---\n${TX_FM}\n---\n\n| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n` +
  rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3].toFixed(2)} |  |  |\n`).join('');

/* Two categorised spends, one uncategorised spend, one income. The trend needs
   a second period to draw at all, so June is populated too. */
const MIXED = {
  [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,
  [`${B}/Transactions/Cheque/2026-06.md`]: txFile([
    ['2026-06-05', 'Woolworths', 'Groceries', -800],
    ['2026-06-25', 'Payday', 'Salary', 20000],
  ]),
  [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
    ['2026-07-03', 'Woolworths', 'Groceries', -1200],
    ['2026-07-08', 'Uber', 'Transport', -300],
    ['2026-07-11', 'EFT 4471', '', -500],          // uncategorised: hero counts it, donut cannot
    ['2026-07-25', 'Payday', 'Salary', 20000],
  ]),
};

/* Same period, but nothing is categorised at all — the shape where the donut
   is legitimately empty forever while the hero climbs on every import. */
const ALL_UNCAT = {
  [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,
  [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
    ['2026-07-03', 'Woolworths', '', -1200],
    ['2026-07-08', 'Uber', '', -300],
  ]),
};

/* ------------------------------- mounting ------------------------------- */
/* Every card container renderDashboard touches. A card missing from here still
   "passes" — its guard catches the null and the suite stays green — so the
   card is then being tested only for the fact that it fails safely, which is
   not what anyone reading this file would assume. Add new cards here as they
   land. */
const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'dashSplit', 'dashSplitSub', 'dashBudget', 'dashBudgetSub'];

/* The four cards that own a container of their own and must survive each
   other, with the marker proving each one really drew. The fixture's single
   account carries no balance_updated, so the staleness card has something to
   say rather than returning early. */
const CARDS = [
  ['heroCard', 'hero-grid'],
  ['dashStale', 'kpi-caveat-txt'],
  ['trendChart', null],
  ['dashSplit', null],
  ['dashBudget', null],
];

async function mount(files) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);            // real io + period + load
  S.period = '2026-07';

  const nodes = new Map(IDS.map(id => [id, new FakeEl(id === 'dashBudget' ? 'table' : 'div')]));
  ctx.$ = sel => nodes.get(sel.slice(1)) || null;
  ctx.root = new FakeEl('div');
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  // money() must be recognisable in a rendered string for the donut assertions.
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;

  require('../src/views/dashboard')(ctx);
  return { ctx, S, nodes };
}

(async () => {
  /* ------------------- 1. baseline: all four cards draw ------------------ */
  {
    const { ctx, nodes } = await mount(MIXED);
    ctx.renderDashboard();

    ok(has(nodes.get('heroCard'), 'hero-grid'), 'hero card draws');
    ok(has(nodes.get('dashStale'), 'kpi-caveat-txt'), 'staleness card draws');
    eq(tagCount(nodes.get('trendChart'), 'SVG'), 1, 'trend card draws one svg');
    eq(tagCount(nodes.get('dashSplit'), 'SVG'), 1, 'donut card draws one svg');
    ok(tagCount(nodes.get('dashBudget'), 'TR') > 2, 'budget table draws rows');
    for (const [id] of CARDS) {
      ok(!has(nodes.get(id), 'text-danger'), `${id} reports no failure on the happy path`);
    }
  }

  /* ---------------- 2. one card throwing spares the rest ---------------- *
     The regression itself. Each card is failed in turn and the other three
     must still be there — including, specifically, the donut when the TREND
     is what broke, which is the reported bug. */
  for (const mode of ['failNextAppend', 'explode']) {
    for (const [broken] of CARDS) {
      const { ctx, nodes } = await mount(MIXED);
      nodes.get(broken)[mode] = `boom in ${broken}`;

      // Must not escape to render(), which has no catch of its own.
      assert.doesNotThrow(() => ctx.renderDashboard(),
        `a ${mode} throw in ${broken} must not escape renderDashboard`);
      checks++;

      const why = `${broken} threw (${mode})`;
      for (const [id, marker] of CARDS) {
        if (id === broken) continue;
        if (marker) ok(has(nodes.get(id), marker), `${id} survives — ${why}`);
        else if (id === 'dashBudget') ok(tagCount(nodes.get(id), 'TR') > 2, `the budget table survives — ${why}`);
        // The reported bug, in one line.
        else eq(tagCount(nodes.get(id), 'SVG'), 1, `${id} survives — ${why}`);
      }
    }
  }

  /* -------------- 3. a broken card SAYS so, where it was ---------------- *
     A silently empty card is the failure mode this whole fix exists to end:
     the user must be able to see, and screenshot, that something threw —
     there is no console to open on a phone. */
  {
    const { ctx, nodes } = await mount(MIXED);
    nodes.get('dashSplit').failNextAppend = 'donut exploded';
    ctx.renderDashboard();
    const err = all(nodes.get('dashSplit'), e => e._cls.has('text-danger'))[0];
    ok(err && /Could not draw the spending split/.test(err.textContent),
      'a failed donut says so where the donut was');
    ok(/donut exploded/.test(err.textContent),
      'and carries the actual message, so a phone screenshot is enough to diagnose it');
  }
  {
    // The table target needs a row, not a bare <p> — no engine renders a <p>
    // dropped straight into a <table>.
    const { ctx, nodes } = await mount(MIXED);
    nodes.get('dashBudget').failNextAppend = 'table exploded';
    ctx.renderDashboard();
    const err = all(nodes.get('dashBudget'), e => e._cls.has('text-danger'))[0];
    ok(err && err.tagName === 'TD', 'the budget table reports its failure as a table cell');
  }
  {
    /* When empty() itself is what threw, the guard cannot clear or repaint —
       it logs and stands down. Documented, and the only requirement is that
       it does not take the sibling cards with it (covered above). Pinned here
       so the silence is a decision rather than a surprise. */
    const { ctx, nodes } = await mount(MIXED);
    nodes.get('dashSplit').explode = 'donut container is gone';
    ctx.renderDashboard();
    ok(!has(nodes.get('dashSplit'), 'text-danger'),
      'a card whose own container throws reports to the console only');
  }

  /* ------------- 4. renderTrend / renderSplit are guarded too ----------- *
     applyTheme() calls these two directly on a theme flip, bypassing
     renderDashboard. Unguarded there, the same throw freezes the same cards. */
  {
    const { ctx, nodes } = await mount(MIXED);
    nodes.get('trendChart').failNextAppend = 'boom';
    nodes.get('dashSplit').failNextAppend = 'boom';
    assert.doesNotThrow(() => { ctx.renderTrend(); ctx.renderSplit(); },
      'the ctx-exposed chart renderers must be the guarded ones');
    checks++;
  }

  /* --------------- 5. the donut owns up to what it hides ---------------- */
  {
    const { ctx, S, nodes } = await mount(MIXED);
    ctx.renderDashboard();

    const sum = ctx.periodSummary(S.period);
    eq(sum.spend, 2000, 'hero Total Spent counts the uncategorised row');
    eq(sum.uncategorised, 1, 'and flags it as one uncategorised row');

    const sub = nodes.get('dashSplitSub').textContent;
    ok(/1500\.00 across 2 categories/.test(sub), `donut totals only categorised spend — got: ${sub}`);
    ok(/R 500\.00 uncategorised, not shown/.test(sub),
      `donut names the spend it is leaving out — got: ${sub}`);

    /* The invariant behind the whole complaint: hero and donut differ by
       exactly the uncategorised figure, and that figure is now on screen. */
    eq(sum.spend - 1500, 500, 'hero minus donut IS the uncategorised amount');
  }

  /* Nothing categorised at all: the empty state must explain why a donut is
     missing while the numbers above it are not zero. The old copy — "Nothing
     categorised as spending in this period yet" — is true but reads as "no
     spending", which is the opposite of what happened. */
  {
    const { ctx, nodes } = await mount(ALL_UNCAT);
    ctx.renderDashboard();
    eq(tagCount(nodes.get('dashSplit'), 'SVG'), 0, 'no slices to draw');
    const note = nodes.get('dashSplit').textContent;
    ok(/R 1500\.00 went out this period/.test(note),
      `the empty donut states the spend it cannot break down — got: ${note}`);
    ok(/categories in Transactions/.test(note), 'and says what to do about it');
    ok(/uncategorised, not shown/.test(nodes.get('dashSplitSub').textContent),
      'the sub-line carries the figure too');
  }

  /* A fully categorised period must NOT grow the note — it would be a
     permanent line of nothing on the tidy vaults this is meant to help. */
  {
    const CLEAN = { ...MIXED,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-03', 'Woolworths', 'Groceries', -1200],
        ['2026-07-08', 'Uber', 'Transport', -300],
        ['2026-07-25', 'Payday', 'Salary', 20000],
      ]) };
    const { ctx, nodes } = await mount(CLEAN);
    ctx.renderDashboard();
    const sub = nodes.get('dashSplitSub').textContent;
    ok(!/uncategorised/.test(sub), `a clean period says nothing about uncategorised — got: ${sub}`);
  }

  console.log(`PASS — dashboard cards fail independently, and the donut declares what it hides (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
