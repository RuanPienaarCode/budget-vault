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

/* A vault with an actual balance sheet, for the position band. Deliberately
   spread across all four ledgers it reads — accounts (two of them savings and
   investment), the Assets page, the Debt page and Owed Money — because the
   band's whole claim is that it agrees with each of those pages.

   The owed row is PART-recovered (2 000 lent, 500 back). That is the case a
   second copy of the arithmetic gets wrong: it reports 2 000 still owed, which
   is why outstandingOf lives in owed-math.js and not in two places. */
const LEDGERS = {
  [`${B}/Accounts/Savings.md`]: '---\ntype: savings\ntx_label: "Savings"\nbalance: 5000\n---\n',
  [`${B}/Accounts/Invest.md`]: '---\ntype: investment\ntx_label: "Invest"\nbalance: 12000\n---\n',
  [`${B}/Assets.md`]:
    '---\nkind: assets\n---\n\n| Name | Type | Value | Valued | Notes |\n|---|---|---:|---|---|\n' +
    '| House | property | 800000 | 2026-01-15 |  |\n',
  [`${B}/Debts.md`]:
    '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start | Category | Status | Notes |\n' +
    '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n' +
    '| Bond | Bank | home loan | 40000 | 60000 | 9.5 | 1200 | 0 | 2020-01-01 | Housing | active |  |\n',
  [`${B}/Owed Money.md`]:
    '---\nkind: owed\n---\n\n| Person | Amount | Description | Due | Status | Repaid | Lent |\n|---|---:|---|---|---|---:|---|\n' +
    '| Sam | 2000 | Car repair |  | outstanding | 500 | 2026-05-01 |\n',
};
const POSITION = { ...MIXED, ...LEDGERS };

/* A credit-card account in the red AND a card row on the Debt page — the shape
   worth.cardOverlap() exists to disclose. It deliberately does not guess which
   is the duplicate: names are free text, so any matching rule would be wrong on
   real data in both directions. */
const OVERLAP = { ...POSITION,
  [`${B}/Accounts/Visa.md`]: '---\ntype: credit_card\ntx_label: "Visa"\nbalance: -3000\n---\n',
  [`${B}/Debts.md`]:
    '---\nkind: debts\n---\n\n| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start | Category | Status | Notes |\n' +
    '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n' +
    '| Visa | Bank | credit card | 3000 | 3000 | 21 | 500 | 0 | 2025-01-01 | Debt | active |  |\n',
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
  'dashSplit', 'dashSplitSub', 'dashBudget', 'dashBudgetSub',
  'dashPositionCard', 'dashPositionKpis', 'dashPositionSub', 'dashPositionNote'];

/* Every card that owns a container of its own and must survive each other,
   with the marker proving each one really drew. The fixture's single account
   carries no balance_updated, so the staleness card has something to say
   rather than returning early.

   MIXED deliberately carries NO debts and a positive balance, so none of the
   position tiles legitimately renders in `text-danger` — the happy-path sweep
   below reads that class as "a card reported a failure", and a red Debt tile
   would look identical to one. The red path gets its own fixture (POSITION). */
const CARDS = [
  ['heroCard', 'hero-grid'],
  ['dashStale', 'kpi-caveat-txt'],
  ['trendChart', null],
  ['dashSplit', null],
  ['dashBudget', null],
  ['dashPositionKpis', 'mini'],
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
    eq(all(nodes.get('dashPositionKpis'), e => e._cls.has('mini')).length, 4,
      'the position band draws its four tiles');
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

  /* --------------- 6. the position band is NOT period-scoped ------------ *
     The invariant the whole band rests on. Every other card here answers "what
     happened in this period"; these four answer "what is true today", and they
     sit under a period switcher that moves everything above them.

     If a period value ever creeps into renderPosition, the band quietly becomes
     a lie — and the symptom would be indistinguishable from a card that had
     stopped updating, which is the exact misreading the guards at the top of
     views/dashboard.js exist to prevent. Pinned by rendering the same vault at
     two different periods and demanding the tiles come out byte-identical. */
  {
    const { ctx, S, nodes } = await mount(POSITION);
    ctx.renderDashboard();
    const july = nodes.get('dashPositionKpis').textContent;

    S.period = '2026-06';
    ctx.renderDashboard();
    const june = nodes.get('dashPositionKpis').textContent;

    eq(june, july, 'the position tiles must read identically in any period');
    ok(/Where you stand|do not move with the period/.test(nodes.get('dashPositionSub').textContent),
      'and the subtitle says so, so a reader is not left guessing');
    // The hero, by contrast, MUST have moved — otherwise this test would pass
    // just as happily against a dashboard that had stopped rendering at all.
    ctx.renderDashboard();
    ok(/20000|20 000/.test(nodes.get('heroCard').textContent),
      'the period cards still track the period (control for the check above)');
  }

  /* --------- 7. the tiles agree with the pages they summarise ----------- *
     A tile that disagrees with the page it links to is worse than no tile, so
     the arithmetic is borrowed from worth() and owedSummary() rather than
     recomputed. Asserted against the fixture's own figures. */
  {
    const { ctx, S, nodes } = await mount(POSITION);
    ctx.renderDashboard();
    const txt = nodes.get('dashPositionKpis').textContent;

    const w = require('../src/worth').worth(S.accounts, S.debts, S.assets);
    const o = require('../src/owed-math').owedSummary(S.owed);
    // 100 cheque + 5 000 savings + 12 000 investment + 800 000 house = 817 100
    // owed: 40 000 bond + 0 overdrawn = 40 000  →  net 777 100
    eq(w.assets, 817100, 'fixture owns 817 100');
    eq(w.liabilities, 40000, 'and owes 40 000');
    eq(o.outstanding, 1500, 'with 1 500 still lent out (2 000 less a 500 repayment)');

    ok(txt.includes('R 777100'), `net worth tile carries worth().net — got: ${txt}`);
    ok(txt.includes('R -40000'), 'the debt tile is negated for display, like the Savings page');
    ok(txt.includes('R 1500'), 'and owed-to-you is net of the part-payment, not the 2 000 lent');
    ok(txt.includes('R 17000'), 'savings + investments are summed into one tile');
    ok(/oldest out \d+ days/.test(txt), 'the owed tile reports age, not a due date');
  }

  /* --------- 8. a vault with no balance sheet gets no balance sheet ----- *
     Four tiles reading R0.00 is not an empty state — it is a balance sheet
     asserting the reader owns nothing, which on a fresh install is a statement
     about the import being incomplete rather than about their finances. */
  {
    const BARE = { [`${B}/Settings.md`]: SETTINGS, ...CATS, ...BUDGET,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-03', 'Woolworths', 'Groceries', -1200]]) };
    const { ctx, nodes } = await mount(BARE);
    ctx.renderDashboard();
    eq(all(nodes.get('dashPositionKpis'), e => e._cls.has('mini')).length, 0,
      'no ledger, no tiles');
    ok(nodes.get('dashPositionCard')._cls.has('hidden'), 'and the whole band stands down');
    // The period cards above are unaffected — this vault still has spending.
    ok(has(nodes.get('heroCard'), 'hero-grid'), 'while the period cards carry on');
  }

  /* --------- 9. the double-count caveat travels with the figure --------- *
     A credit card can honestly live on the Accounts page OR the Debt page, and
     nothing stops both. The Savings page discloses it; stating the same net
     worth here without the same sentence would put two net-worth figures in the
     app, one qualified and one not — and the unqualified one first. */
  {
    const { ctx, nodes } = await mount(OVERLAP);
    ctx.renderDashboard();
    const note = nodes.get('dashPositionNote').textContent;
    ok(/counted twice/.test(note), `the overlap is disclosed — got: ${note}`);

    // …and stays silent when there is nothing to disclose.
    const { ctx: c2, nodes: n2 } = await mount(POSITION);
    c2.renderDashboard();
    eq(n2.get('dashPositionNote').textContent, '',
      'a vault with no card overlap gets no line about one');
  }

  /* -------- 10. the staleness caveat now qualifies the right number ----- *
     It used to sit under the hero, where it qualified four cards built entirely
     from TRANSACTIONS — which never go stale and never depended on it. It now
     sits inside the position band, under the net worth those balances are
     summed into. */
  {
    const { ctx, nodes } = await mount(POSITION);
    ctx.renderDashboard();
    const txt = nodes.get('dashStale').textContent;
    ok(/Built from .* nobody has confirmed recently/.test(txt),
      `the caveat reads as provenance for the total above it — got: ${txt}`);
    ok(/Review balances/.test(txt), 'and still offers the way to fix it');
  }

  console.log(`PASS — dashboard cards fail independently, the donut declares what it hides, and the position band ignores the period (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
