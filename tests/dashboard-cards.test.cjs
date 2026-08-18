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

/* A vault built to catch the two things the comparison column got wrong.

   Three complete months, each with the SAME four spending shapes, so every
   baseline is exact and any movement in the change column comes from the month
   on screen rather than from arithmetic drift:

     Rent    10 000 on the 1st          — bills before the window opens
     Food     300 on the 3rd, 7th,      — spread through the month
              12th, 20th and 27th
     Late   2 000 on the 25th           — bills AFTER a 9-day window closes
     Early    400 on the 20th           — same, but paid early this month
     Phone  636,40 on the 1st           — chosen for its cents; see below

   August is the running month and the clock is pinned to the 9th, which is
   what makes it a test rather than a coincidence. Nine days of August against
   three whole Julys is exactly the comparison that shipped, and it reported
   Late as −100% and Food as −40% while nothing at all had gone wrong. */
const CMP_CATS = {
  [`${B}/Categories/Rent.md`]: '---\ntype: expense\ncolor: "#e74c3c"\n---\n',
  [`${B}/Categories/Food.md`]: '---\ntype: expense\ncolor: "#3498db"\n---\n',
  [`${B}/Categories/Late.md`]: '---\ntype: expense\ncolor: "#9b59b6"\n---\n',
  [`${B}/Categories/Early.md`]: '---\ntype: expense\ncolor: "#f39c12"\n---\n',
  [`${B}/Categories/Phone.md`]: '---\ntype: expense\ncolor: "#1abc9c"\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
};
const settledMonth = m => txFile([
  [`2026-${m}-01`, 'Landlord', 'Rent', -10000],
  [`2026-${m}-01`, 'Telco', 'Phone', -636.40],
  [`2026-${m}-03`, 'Shop', 'Food', -300],
  [`2026-${m}-07`, 'Shop', 'Food', -300],
  [`2026-${m}-12`, 'Shop', 'Food', -300],
  [`2026-${m}-20`, 'Shop', 'Food', -300],
  [`2026-${m}-20`, 'Gym', 'Early', -400],
  [`2026-${m}-25`, 'Insurer', 'Late', -2000],
  [`2026-${m}-25`, 'Payday', 'Salary', 20000],
  [`2026-${m}-27`, 'Shop', 'Food', -300],
]);
const COMPARE = {
  [`${B}/Settings.md`]: SETTINGS, ...CMP_CATS, ...ACCOUNT,
  [`${B}/Transactions/Cheque/2026-05.md`]: settledMonth('05'),
  [`${B}/Transactions/Cheque/2026-06.md`]: settledMonth('06'),
  [`${B}/Transactions/Cheque/2026-07.md`]: settledMonth('07'),
  /* August, nine days in. Rent has risen, food is genuinely ahead of its own
     first nine days, the gym was paid on the 3rd instead of the 20th, and the
     insurer has not billed yet — which is not a saving, it is the 9th. */
  [`${B}/Transactions/Cheque/2026-08.md`]: txFile([
    ['2026-08-01', 'Landlord', 'Rent', -11800],
    ['2026-08-02', 'Telco', 'Phone', -914.60],
    ['2026-08-02', 'Shop', 'Food', -300],
    ['2026-08-03', 'Gym', 'Early', -400],
    ['2026-08-04', 'Shop', 'Food', -300],
    ['2026-08-08', 'Shop', 'Food', -300],
  ]),
};

/* The clock, pinned. currentPeriod() and todayIso() both read `new Date()`,
   and the whole part-period question is "what day is it" — a suite that let
   the real date through would assert something different every morning and
   pass or fail on the calendar. Subclassed rather than replaced so every
   OTHER use of Date in the loader and the period maths still works: only the
   no-argument constructor and now() are answered from the fixed instant. */
const RealDate = Date;
function atDate(iso, fn) {
  const [y, m, d] = iso.split('-').map(Number);
  const fixed = () => new RealDate(y, m - 1, d, 12, 0, 0);
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixed().getTime()); }
    static now() { return fixed().getTime(); }
  }
  global.Date = FakeDate;
  return Promise.resolve().then(fn).finally(() => { global.Date = RealDate; });
}

/* category name -> { val, base, delta, cls }, read off the rendered legend
   rather than off the functions that built it — the column is a reading
   problem, so the assertions have to be about what reaches the screen. */
function legendRows(node) {
  const out = new Map();
  for (const li of all(node, e => e.tagName === 'LI')) {
    if (li._cls.has('donut-legend-head')) continue;
    const pick = cls => (all(li, e => e._cls.has(cls))[0] || {}).textContent;
    const name = pick('dl-name');
    if (name === undefined) continue;
    const d = all(li, e => e._cls.has('dl-delta'))[0];
    out.set(name, {
      val: pick('dl-val'), base: pick('dl-base'), delta: d && d.textContent,
      cls: d && [...d._cls].find(c => c.startsWith('is-')),
    });
  }
  return out;
}

/* ------------------------------- mounting ------------------------------- */
/* Every card container renderDashboard touches. A card missing from here still
   "passes" — its guard catches the null and the suite stays green — so the
   card is then being tested only for the fact that it fails safely, which is
   not what anyone reading this file would assume. Add new cards here as they
   land. */
const IDS = ['heroCard', 'dashStale', 'trendChart', 'trendSub', 'trendRange',
  'leftCard', 'leftBody', 'leftSub',
  'dashSplit', 'dashSplitSub', 'splitRange', 'dashBudget', 'dashBudgetSub',
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

async function mount(files, period = '2026-07') {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);            // real io + period + load
  S.period = period;

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
    /* The what's-left card is conditional by design — it hides rather than
       showing three zeroes — so the contract is that it DECIDES, without
       throwing, and says so through the hidden class either way. Its
       arithmetic is covered in tests/committed.test.cjs. */
    ok(!has(nodes.get('leftBody'), 'text-danger'), "what's left reports no failure");
    ok(typeof nodes.get('leftCard')._cls.has('hidden') === 'boolean',
      "what's left decided whether it has anything to show");
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

  /* ------- 11. the comparison column measures spending, not the date ---- *
     Two bugs, one column.

     A part-month was being read against whole months. On the 9th of August the
     card announced a 39% fall in food and a 56% fall in medical costs, and both
     figures were reporting nothing but the calendar — the money simply had not
     been spent YET. The baseline is now the same elapsed window of each earlier
     period, so a comparison is a comparison.

     And the unit switched per row. Above a size threshold the column printed a
     percentage, below it rands, with the threshold set against the period's own
     total — so a category could change unit month to month without changing its
     own behaviour, and a reader who wanted to know what "−39%" cost had to work
     it out. Rands throughout now; the baseline beside it carries the scale. */
  await atDate('2026-08-09', async () => {
    const { ctx, nodes } = await mount(COMPARE, '2026-08');
    ctx.plugin.settings.splitCompareRange = '3m';
    ctx.renderDashboard();
    const rows = legendRows(nodes.get('dashSplit'));

    /* The bill that has not arrived yet. Against whole months this read
       "−100%" — a saving of two thousand rand that had not happened. Against
       the first nine days of each earlier month it reads as what it is: by this
       point in the month, this category normally costs nothing, and it has. */
    eq(rows.get('Late'), undefined,
      'a category with nothing spent yet is not a slice of this period at all');

    /* Spent EARLY instead. Same 400 every month, but on the 3rd rather than the
       20th, so against the same nine days it is genuinely ahead — a real
       signal, and one whole-month averaging erased to "0%". */
    const early = rows.get('Early');
    eq(early.base, 'R 0', 'by day 9 this category has historically cost nothing');
    eq(early.delta, '+R 400', 'so paying it early this month IS the change');
    eq(early.cls, 'is-up', 'and it is a rise, not a new category');

    /* Food, the row that shipped as "−39%". Five charges a month, two of them
       inside the first nine days: 600 is the honest baseline, not 1 500. */
    const food = rows.get('Food');
    eq(food.val, 'R 900', 'nine days of August');
    eq(food.base, 'R 600', 'against the same nine days of May, June and July');
    eq(food.delta, '+R 300', 'which is a rise — the old column called it a 39% fall');
    eq(food.cls, 'is-up', 'and colours it accordingly');

    /* Rent bills on the 1st, so it was the ONE row the old comparison got
       right. It has to keep being right. */
    eq(rows.get('Rent').base, 'R 10000', 'a first-of-the-month bill is fully inside any window');
    eq(rows.get('Rent').delta, '+R 1800', 'and its rise is unaffected by the fix');

    /* Rounding, in the order that makes the row add up. R 915 − R 636 is R 279
       on screen; subtracting first and rounding after printed R 278 beside two
       figures that plainly differ by 279. */
    const phone = rows.get('Phone');
    eq([phone.val, phone.base, phone.delta], ['R 915', 'R 636', '+R 279'],
      'the change is the difference between the two figures printed beside it');

    /* One unit, every row — the actual complaint. */
    for (const [cat, r] of rows) {
      ok(!/%/.test(r.delta || ''), `${cat}'s change is an amount, not a percentage`);
    }

    /* And the baseline column says it is a part-month, because it no longer
       reads as a typical one. */
    const note = nodes.get('dashSplit').textContent;
    ok(/9 days old/.test(note) && /first 9 days/.test(note),
      `the running period declares its window — got: ${note}`);
  });

  /* A period that has FINISHED compares whole against whole, and says nothing
     about windows — there is no caveat left to make. */
  await atDate('2026-08-09', async () => {
    const { ctx, nodes } = await mount(COMPARE, '2026-07');
    ctx.plugin.settings.splitCompareRange = '3m';
    ctx.renderDashboard();
    const rows = legendRows(nodes.get('dashSplit'));

    eq(rows.get('Food').base, 'R 1500', 'a complete period is measured against complete ones');
    eq(rows.get('Late').base, 'R 2000', 'including the bills that land late in the month');
    for (const cat of ['Food', 'Late', 'Rent', 'Early']) {
      eq(rows.get(cat).delta, 'R 0', `${cat} spent exactly its own average`);
      eq(rows.get(cat).cls, 'is-flat', `so ${cat} gets no colour`);
    }
    ok(!/days old/.test(nodes.get('dashSplit').textContent),
      'and a finished period explains no window');
  });

  /* ===================================================================== *
     12–17. Six figures that were arithmetically right and read wrong.

     Every one of these was found by loading a real vault and asking whether
     the numbers on one screen agreed with each other. None of them threw, none
     of them was caught by a total, and each one is the kind of quiet
     disagreement that teaches a reader the page cannot be trusted — which is
     the expensive failure, because it is never reported as a bug.
     ===================================================================== */

  /* -------- 12. the Debt tile names the ledger it actually read --------- *
     `w.fromDebts && w.fromAccounts` asked only whether BOTH ledgers were in
     play, and otherwise fell through to a count of DEBT-PAGE rows. So a vault
     whose only liability is an overdrawn account printed that account's
     balance under the words "0 active" — a tile stating a debt and denying it
     in the same breath. Measured on a real vault: R8 874 on a credit card,
     nothing on the Debt page at all. */
  {
    /* MIXED carries no Debts.md, so this is the accounts-only shape exactly. */
    const CARD_ONLY = { ...MIXED,
      [`${B}/Accounts/Visa.md`]: '---\ntype: credit_card\ntx_label: "Visa"\nbalance: -3000\n---\n' };
    const { ctx, nodes } = await mount(CARD_ONLY);
    ctx.renderDashboard();
    const txt = nodes.get('dashPositionKpis').textContent;
    ok(/all on 1 account/.test(txt), `debt on accounts alone says so — got: ${txt}`);
    ok(!/0 active/.test(txt), 'and never denies the figure printed above it');
  }
  {
    /* Debt page only — the branch that was already right, pinned so the new
       three-way test cannot quietly swallow it. */
    const { ctx, nodes } = await mount(POSITION);
    ctx.renderDashboard();
    const txt = nodes.get('dashPositionKpis').textContent;
    ok(/1 active/.test(txt), `a debt-page row is still counted as one — got: ${txt}`);
    ok(!/all on/.test(txt), 'and is not described as sitting on an account');
  }
  {
    /* Both ledgers — still the split sentence, which names both figures. */
    const { ctx, nodes } = await mount(OVERLAP);
    ctx.renderDashboard();
    ok(/on accounts · .* on the debt page/.test(nodes.get('dashPositionKpis').textContent),
      'both ledgers in play still get the split');
  }

  /* ----- 13. the donut accounts for the WHOLE gap to "Total Spent" ------ *
     The note used to disclose the uncategorised half only, and to disclose it
     NET. Two ways that goes silent while the figures disagree:

       a refund inside an expense category shrinks a slice without being
       uncategorised at all; and

       a period holding more uncategorised money IN than OUT nets positive, so
       `-Math.min(0, …)` clamped the note to zero — on a real vault, R16 895
       out against R21 440 in, printing nothing while the two figures sat
       R17 195 apart.

     The note is now measured against `spend` itself, so it covers the whole
     difference by construction rather than by a rule that has to be kept in
     step with the slices. */
  {
    const GAP = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,
      [`${B}/Transactions/Cheque/2026-06.md`]: txFile([['2026-06-05', 'Shop', 'Groceries', -800]]),
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-03', 'Woolworths', 'Groceries', -1200],
        ['2026-07-06', 'Refund', 'Groceries', 200],       // shrinks a slice, is not uncategorised
        ['2026-07-11', 'EFT 4471', '', -500],             // uncategorised out
        ['2026-07-12', 'EFT 4472', '', 900],              // …and more back in, so the bucket nets POSITIVE
      ]),
    };
    const { ctx, nodes } = await mount(GAP);
    ctx.renderDashboard();
    const sub = nodes.get('dashSplitSub').textContent;
    ok(/R 500\.00 uncategorised, not shown/.test(sub),
      `the uncategorised half is the GROSS outflow, not the net — got: ${sub}`);
    ok(/R 200\.00 in refunds netted off/.test(sub),
      `and the refund half is named too — got: ${sub}`);
    /* The point of the whole card: donut + everything it declared == the hero. */
    const sum = ctx.periodSummary('2026-07');
    eq(sum.spend, 1700, 'hero counts both outgoing rows gross');
    eq(sum.uncatSpend, 500, 'and periodSummary reports the outgoing half of the bucket separately');
    const shown = 1000;                       // Groceries: 1200 out, 200 back
    eq(shown + 500 + 200, sum.spend, 'donut + what it declared leaves nothing unexplained');

    /* The SAME disclosure, one tile up. The donut had always declared its gap
       on the spending side while the Income tile above it stayed silent about
       the other half: the R900 that came in with no category is not counted as
       income (it could be a transfer in from savings), so the figure is short
       by exactly that and has to say so. The refund is deliberately NOT in the
       note — it is money back inside a category, already netted off that
       category's own actual. */
    eq(sum.uncatIncome, 900, 'the incoming half of the uncategorised bucket is reported');
    const hero = nodes.get('heroCard').textContent;
    ok(/R 900\.00 in, not counted/.test(hero),
      `the Income tile discloses money that arrived without a category — got: ${hero}`);
    ok(!/1 100\.00 in, not counted/.test(hero),
      'and does not sweep the refund in with it');
  }

  /* --- 13b. a category name no category file answers to ---------------- *
     Its own state, and the one that used to be silent in every direction.
     Deleting a category leaves the name on its rows on purpose, and there is
     no rename UI — so renaming one orphans every row that used it. `catType`
     answered null for those rows, which reads downstream as "not income", so
     the outgoing ones landed in spend while the INCOMING ones were counted by
     nothing at all and announced by nothing: the "Uncategorised" tile only
     ever counted a BLANK category. */
  {
    const ORPHAN = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-03', 'Woolworths', 'Groceries', -1200],
        ['2026-07-05', 'Refund run', 'Grocries', 400],     // renamed away, money IN
        ['2026-07-08', 'Old name', 'Grocries', -300],      // …and money out
        ['2026-07-09', 'Case slip', 'groceries', -100],    // matching is exact: this is missing too
      ]),
    };
    const { ctx, nodes } = await mount(ORPHAN);
    ctx.renderDashboard();
    const sum = ctx.periodSummary('2026-07');

    eq(sum.unknown.count, 3, 'three rows name a category no file answers to');
    eq(sum.unknown.names.slice().sort(), ['Grocries', 'groceries'], 'two distinct names, case included');
    eq(sum.uncategorised, 0, 'and none of them is "uncategorised" — that word means a BLANK category');
    eq(sum.unknown.income, 400, 'the incoming half is reported rather than vanishing');
    eq(sum.spend, 1600, 'the outgoing halves are still gross spend — money out is money out');
    eq(ctx.periodDeficit('2026-07'), 1200, 'and the deficit credits the R400 that came back in');

    const hero = nodes.get('heroCard').textContent;
    ok(/Missing categories/.test(hero), `the hero names the state out loud — got: ${hero}`);
    ok(/3 transactions — recategorise/.test(hero), `and says how many rows it touches — got: ${hero}`);
    ok(/R 400\.00 in, not counted/.test(hero), 'the orphaned deposit is disclosed beside Income too');
    /* WHICH categories used to ride only on a hover title — unreachable by a
       tap, on the platform this plugin explicitly targets. They must be
       readable TEXT, not merely present as an attribute a touch never fires. */
    ok(/Grocries/.test(hero) && /groceries/.test(hero),
      `both orphaned names are visible text on the tile, not only a title — got: ${hero}`);
  }

  /* --- 13c. more orphaned names than the tile has room for --------------- *
     Five distinct names would run a phone-width card off its own edge, so the
     tile shows the first few and folds the rest into a "+N more" tail — the
     same shape acct.deck.more already uses for an overflowing list. The title
     still carries every name, for a mouse hovering the tile. */
  {
    const cats = ['Aa', 'Bb', 'Cc', 'Dd', 'Ee'];
    const MANY_ORPHANS = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile(
        cats.map((c, i) => [`2026-07-0${i + 1}`, `Row ${c}`, c, -100])),
    };
    const { ctx, nodes } = await mount(MANY_ORPHANS);
    ctx.renderDashboard();
    const sum = ctx.periodSummary('2026-07');
    eq(sum.unknown.count, 5, 'all five rows name a category no file answers to');
    eq(sum.unknown.names.slice().sort(), cats, 'all five distinct names are counted');

    const hero = nodes.get('heroCard').textContent;
    ok(/Aa/.test(hero) && /Bb/.test(hero) && /Cc/.test(hero),
      `the first names shown are visible text — got: ${hero}`);
    ok(/\+2 more/.test(hero), `the rest fold into a "+N more" tail — got: ${hero}`);
    const missingStat = all(nodes.get('heroCard'), n => n._cls && n._cls.has('st'))
      .find(n => (n.attrs && n.attrs.title || '').includes('Ee'));
    ok(missingStat, 'the full name list still rides on the title, for a mouse hover');
  }

  /* --- 14. spend nobody budgeted for is not a blank Remaining cell ------ *
     The cell was written only when there was a budget to subtract from, so
     spending in a category with no budget row showed "—", a full bar and an
     EMPTY Remaining — which reads as "nothing to report" when the truth is
     that it is over budget by the whole amount. Three such rows on the vault
     this was found on came to R995, and they are exactly why the column did
     not add up to the figure in the hero. */
  {
    const UNBUDGETED = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-03', 'Woolworths', 'Groceries', -1200],
        ['2026-07-08', 'Uber', 'Transport', -300],
        ['2026-07-09', 'Payday', 'Salary', 5000],
      ]),
    };
    /* Salary is income with no budget row: it must NOT be reported as overspend. */
    const { ctx, nodes } = await mount(UNBUDGETED);
    ctx.renderDashboard();
    const cells = new Map();
    for (const tr of all(nodes.get('dashBudget'), e => e.tagName === 'TR')) {
      const tds = tr.children.filter(c => c.tagName === 'TD');
      if (tds.length === 5) cells.set(tds[0].textContent.trim(), { budget: tds[1].textContent, rem: tds[4] });
    }
    eq(cells.get('Salary').budget, '—', 'income here carries no budget either');
    eq(cells.get('Salary').rem.textContent, '',
      'but beating an income target is not overspending, so it stays blank');
    eq(cells.get('Groceries').rem.textContent, 'R 3800.00', 'a budgeted row is unchanged');
  }
  {
    /* And an unbudgeted EXPENSE now states the shortfall, in red. */
    const OVERSPEND = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
      [`${B}/Budgets/2026-07.md`]:
        '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 |  |\n',
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-03', 'Woolworths', 'Groceries', -1200],
        ['2026-07-08', 'Uber', 'Transport', -300],       // budgeted nowhere
      ]),
    };
    const { ctx, nodes } = await mount(OVERSPEND);
    ctx.renderDashboard();
    for (const tr of all(nodes.get('dashBudget'), e => e.tagName === 'TR')) {
      const tds = tr.children.filter(c => c.tagName === 'TD');
      if (tds.length === 5 && tds[0].textContent.trim() === 'Transport') {
        eq(tds[4].textContent, 'R -300.00', 'unbudgeted spend is short by the whole amount');
        ok(tds[4]._cls.has('text-danger'), 'and says so in red');
        ok(has(tr, 'bg-danger'), 'with a bar that agrees with the cell beside it');
      }
    }
  }

  /* ------ 15. the trend budgets no month that was never budgeted -------- *
     budgetTotals returns 0 for a period with no budget file, and the dashed
     line was drawn straight through it — landing on the baseline, which reads
     as "you budgeted nothing" when what happened is that nothing was budgeted.
     On the vault this was found on, a 1Y range covered four such months and
     the line visibly collapsed into the floor across them. The focus dot
     already refused to mark those points; the line was the last thing still
     asserting the zero. */
  {
    const GAPPY = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
      /* May and July budgeted, June deliberately not — so a single line would
         have to dive to the floor and climb back out. */
      [`${B}/Budgets/2026-05.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 |  |\n',
      [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 |  |\n',
      [`${B}/Transactions/Cheque/2026-05.md`]: txFile([['2026-05-05', 'Shop', 'Groceries', -800]]),
      [`${B}/Transactions/Cheque/2026-06.md`]: txFile([['2026-06-05', 'Shop', 'Groceries', -900]]),
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-05', 'Shop', 'Groceries', -700]]),
    };
    const { ctx, nodes } = await mount(GAPPY);
    ctx.renderDashboard();
    const svg = nodes.get('trendChart').children.find(c => c.tagName === 'SVG');
    const dashed = all(svg, e => e.tagName === 'POLYLINE' && e.attrs['stroke-dasharray']);
    eq(dashed.length, 0,
      'two budgeted months either side of an unbudgeted one share no line');
    const marks = all(svg, e => e.tagName === 'CIRCLE' && e.attrs['fill-opacity'] === '0.28');
    eq(marks.length, 2, 'each lone budgeted period is still marked');
  }
  {
    /* Consecutive budgeted periods DO join up — the fix must not shred a line
       that was always correct. */
    const RUN = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
      [`${B}/Budgets/2026-06.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 5000.00 |  |\n',
      [`${B}/Budgets/2026-07.md`]: '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n| Groceries | expense | 4000.00 |  |\n',
      [`${B}/Transactions/Cheque/2026-06.md`]: txFile([['2026-06-05', 'Shop', 'Groceries', -900]]),
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-05', 'Shop', 'Groceries', -700]]),
    };
    const { ctx, nodes } = await mount(RUN);
    ctx.renderDashboard();
    const svg = nodes.get('trendChart').children.find(c => c.tagName === 'SVG');
    const dashed = all(svg, e => e.tagName === 'POLYLINE' && e.attrs['stroke-dasharray']);
    eq(dashed.length, 1, 'an unbroken run is still one line');
    eq(dashed[0].attrs.points.split(' ').length, 2, 'through both of its points');
  }

  /* ---- 16. "% allocated" is not a function of what day it is today ----- *
     The denominator was the income that had LANDED so far. Early in a running
     period that is a part-month figure, so the line said nothing about the
     budget and everything about the date — and read as settled, because
     nothing in it says when it was measured. A single small invoice arriving
     before the salary printed "19252% allocated". */
  await atDate('2026-07-02', async () => {
    const RUNNING = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,   // BUDGET names no income
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-01', 'Small invoice', 'Salary', 255],                 // the salary has not landed
        ['2026-07-02', 'Woolworths', 'Groceries', -400],
      ]),
    };
    const { ctx, nodes } = await mount(RUNNING);
    ctx.renderDashboard();
    const txt = nodes.get('heroCard').textContent;
    ok(!/allocated/.test(txt),
      `a running period with no budgeted income has no honest denominator — got: ${txt}`);
  });
  await atDate('2026-08-15', async () => {
    /* The same period, FINISHED. Its actual income no longer moves, so it is a
       fair denominator again and the line comes back. */
    const DONE = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT, ...BUDGET,
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([
        ['2026-07-25', 'Payday', 'Salary', 12000],
        ['2026-07-03', 'Woolworths', 'Groceries', -400],
      ]),
    };
    const { ctx, nodes } = await mount(DONE, '2026-07');
    ctx.renderDashboard();
    ok(/50% allocated/.test(nodes.get('heroCard').textContent),
      'a finished period states its own share: 6 000 budgeted against 12 000 earned');
  });
  await atDate('2026-07-02', async () => {
    /* And a budget that DOES name its income keeps the figure all period,
       because the denominator no longer moves. */
    const WITH_INCOME = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
      [`${B}/Budgets/2026-07.md`]:
        '---\nkind: budget\n---\n\n| Category | Type | Amount | Notes |\n|---|---|---:|---|\n' +
        '| Groceries | expense | 5000.00 |  |\n| Salary | income | 10000.00 |  |\n',
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-01', 'Small invoice', 'Salary', 255]]),
    };
    const { ctx, nodes } = await mount(WITH_INCOME);
    ctx.renderDashboard();
    ok(/50% allocated/.test(nodes.get('heroCard').textContent),
      'budgeted income is the denominator, so day 1 reads the same as day 31');
  });

  /* ---- 17. "old" carries a size, not only an age ----------------------- *
     The tiles quote what the account files SAY, deliberately — they have to
     agree with the Savings and Debt pages, which state the same figures. But
     the caveat under them said only that a balance was old, which leaves the
     reader no way to tell whether that matters by a rand or by twenty
     thousand. On the vault this was found on it was twenty thousand, sitting
     under a net worth stated to the cent. */
  await atDate('2026-07-20', async () => {
    const DRIFTED = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS,
      [`${B}/Accounts/Cheque.md`]:
        '---\ntype: checking\ntx_label: "Cheque"\nbalance: 1000\nbalance_updated: 2026-05-01\n---\n',
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-10', 'Payday', 'Salary', 4000]]),
    };
    const { ctx, nodes } = await mount(DRIFTED);
    ctx.renderDashboard();
    const txt = nodes.get('dashStale').textContent;
    ok(/imply R 4 ?000 more/.test(txt.replace(/ /g, ' ')),
      `the caveat sizes the drift it is warning about — got: ${txt}`);
  });
  {
    /* A vault whose balances have not moved says nothing extra — the sentence
       is about a difference, and there isn't one. */
    const { ctx, nodes } = await mount(POSITION);
    ctx.renderDashboard();
    ok(!/imply/.test(nodes.get('dashStale').textContent),
      'no drift, no drift sentence');
  }

  /* --------- a card whose NAME does not survive safeSeg still cycles -------
     The settlement-cycle rows used to be collected by comparing each folder
     label against raw `tx_label || name`. But the plugin itself stores an
     account's transactions under safeSeg(name) — "Visa: Gold" writes to
     Transactions/Visa- Gold/ — so a settle-monthly card with a filesystem-
     illegal character in its name had its rows counted by accountIndex and
     reconcile while NEVER joining cardRows: cardSpend read 0, no cycle
     formed, and `free` subtracted the full card balance instead of the cycle
     treatment. Same card, two different free figures, decided by a character
     in its name. The folder is now resolved through accountForLabel — the
     same three-way door every other consumer uses. */
  await atDate('2026-07-15', async () => {
    const CYCLE_VAULT = {
      [`${B}/Settings.md`]: SETTINGS, ...CATS,
      [`${B}/Accounts/Cheque.md`]:
        '---\ntype: checking\ntx_label: "Cheque"\nbalance: 9000\nbalance_updated: 2026-07-14\n---\n',
      [`${B}/Accounts/Visa: Gold.md`]:
        '---\ntype: credit_card\nsettle_monthly: true\nbalance: -2500\nbalance_updated: 2026-07-14\n---\n',
      /* Three paydays, so findRecurringCredit can prove the settling income. */
      [`${B}/Transactions/Cheque/2026-04.md`]: txFile([['2026-04-25', 'Payday', 'Salary', 20000]]),
      [`${B}/Transactions/Cheque/2026-05.md`]: txFile([['2026-05-25', 'Payday', 'Salary', 20000]]),
      [`${B}/Transactions/Cheque/2026-06.md`]: txFile([['2026-06-25', 'Payday', 'Salary', 20000]]),
      [`${B}/Transactions/Cheque/2026-07.md`]: txFile([['2026-07-03', 'Woolworths', 'Groceries', -700]]),
      /* The card's own folder, exactly where the plugin writes it. */
      [`${B}/Transactions/Visa- Gold/2026-07.md`]: txFile([
        ['2026-07-05', 'Woolworths', 'Groceries', -1500],
        ['2026-07-09', 'Uber', 'Transport', -1000],
      ]),
    };
    const { ctx, nodes } = await mount(CYCLE_VAULT);
    ctx.renderDashboard();
    ok(has(nodes.get('leftBody'), 'left-cycle'),
      'the cycle band forms — the renamed-on-disk folder still reaches cardRows');
    const band = all(nodes.get('leftBody'), e => e._cls.has('left-cycle'))[0];
    ok(/2500/.test(band.textContent.replace(/[\s,.  ]/g, '')),
      `the band measures the card's OWN spending (R2 500), not zero — got "${band.textContent}"`);
  });

  console.log(`PASS — dashboard cards fail independently, the donut declares what it hides, the position band ignores the period, the comparison column measures spending rather than the date, and six figures that read wrong now agree with each other (${checks} assertions).`);
})().catch(e => { console.error(e); process.exit(1); });
