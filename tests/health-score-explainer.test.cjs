'use strict';
/* The score tile's explanation panel — the three ways it opens, and the one
   ordering bug that made one of them do nothing at all.

   THE BUG THIS EXISTS FOR. The panel first opened on `focus` as well as on
   `click`. On a desktop that looked perfect, because hover opened it and no
   click ever happened. On a phone every tap did nothing: focus lands before
   click, so the pair ran open-then-toggle and left the panel exactly as shut as
   it started. Nothing threw, the guard suite stayed green, and the only place
   the failure existed was under a finger — which is where most of this plugin
   is used. So the real tap SEQUENCE is rehearsed here rather than the click
   handler alone; asserting on a lone click would have passed throughout.

   Drives the REAL views/dashboard.js against the in-memory vault and the DOM
   double, so the assertions are about what the view builds, not about a
   restatement of it.

     node tests/health-score-explainer.test.cjs   # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const B = 'Budget';
const SETTINGS = { month_start_day: 23, currency: 'R', country: 'za' };

/* A household that scores in the middle of the range with one clear drag, so
   the panel has a fix line to render and a weak row to tone. Six completed
   periods of the same figures keeps the averages hand-checkable. */
const TX = period => `---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n`
  + `| ${period}-01 | Salary | Salary | 45000.00 | | | |\n`
  + `| ${period}-05 | Groceries | Groceries | -20000.00 | | | |\n`;

const FILES = {
  [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
  [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
  [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
  /* Earmarked, and deliberately short of the six-month target so the emergency
     row is the drag and the fix line has a real figure to name. */
  [`${B}/Accounts/Emergency Fund.md`]:
    '---\ntype: savings\nbalance: 60000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\n---\n',
  [`${B}/Accounts/Cheque.md`]:
    '---\ntype: checking\nbalance: 5000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
};
for (const m of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) {
  FILES[`${B}/Transactions/Cheque/${m}.md`] = TX(m);
}

async function mount(files = FILES, period = '2026-08') {
  const ctx = makeCtx(files, { budgetFolder: B, settings: SETTINGS });
  const S = await loadInto(ctx);
  S.period = period;
  const { $, nodes } = makeDom();
  ctx.$ = $;
  ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  const { el } = require('../src/dom');
  ctx.typeBadge = t => el('span', { class: `category-badge badge-${t}` }, t);
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  require('../src/categories')(ctx);
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();
  return { ctx, S, nodes };
}

const hasCls = (el, c) => !!(el._cls && el._cls.has(c));
const find = (root, cls) => descend(root).filter(e => hasCls(e, cls));
const textOf = el => descend(el).map(e => e.textContent || '').join(' ') + (el.textContent || '');

(async () => {
  const { nodes } = await mount();
  const body = nodes.get('#healthBody');

  /* ---- 1. the panel is built, and starts closed ---- */
  const btns = find(body, 'health-why-btn');
  eq(btns.length, 1, 'exactly one tile explains itself — the score');
  const btn = btns[0];
  const tile = btn._parent;
  const pops = find(body, 'health-why');
  eq(pops.length, 1, 'and it carries exactly one explanation panel');
  ok(!hasCls(tile, 'is-why-open'), 'which starts closed');
  eq(btn.attrs['aria-expanded'], 'false', 'and says so through aria-expanded');
  eq(btn.attrs['aria-controls'], pops[0].attrs.id,
    'the button names the panel it controls, so it is not read as loose text after it');

  /* ---- 2. THE TAP. focus lands first, then click — the sequence that used to
     cancel itself out and leave every phone tap doing nothing. ---- */
  btn._fire('focus');
  btn._fire('click');
  ok(hasCls(tile, 'is-why-open'),
    'a real tap (focus then click) OPENS the panel — the regression that shipped nothing to phones');
  eq(btn.attrs['aria-expanded'], 'true', 'and announces itself open');

  /* ---- 3. tapping again dismisses it, so a finger is not trapped ---- */
  btn._fire('click');
  ok(!hasCls(tile, 'is-why-open'), 'a second tap closes it again');
  eq(btn.attrs['aria-expanded'], 'false', 'and announces itself closed');

  /* ---- 4. hover, where hovering is real. The double reports no fine pointer,
     so the hover path must NOT fire — that is what keeps a hover-only
     affordance from being invented for a touchscreen. ---- */
  btn._fire('pointerenter');
  ok(!hasCls(tile, 'is-why-open'),
    'pointerenter does nothing without a fine pointer, per the capability rule');

  /* ---- 5. the keyboard. A <button> fires click on Enter and Space, so the
     toggle above IS the keyboard path; Escape closes it. ---- */
  btn._fire('click');
  ok(hasCls(tile, 'is-why-open'), 'Enter or Space reaches the same toggle a tap does');
  btn._fire('keydown', { key: 'Escape' });
  ok(!hasCls(tile, 'is-why-open'), 'and Escape closes it');

  /* ---- 5b. DISMISSAL, and the touch that must not dismiss it ----
     The panel is a sibling of the button holding nothing focusable, so a finger
     on its own text blurs the button. Closing on a bare blur made the panel
     unreadable on a phone: the first touch on it — including the drag that
     scrolls it into view below 900px — shut it again. Focus falls to <body>
     there, rather than moving into the panel, and that is the signal.

     Both directions are rehearsed, because a fix that simply never closes would
     pass a one-sided test. The close is deferred a tick, so each case waits. */
  const tick = () => new Promise(r => setTimeout(r, 0));
  btn._fire('click');
  ok(hasCls(tile, 'is-why-open'), 'open again, to be dismissed');
  document.activeElement = document.body;      // a touch on unfocusable text
  btn._fire('blur');
  await tick();
  ok(hasCls(tile, 'is-why-open'),
    'a touch INSIDE the panel leaves it open — focus fell to <body>, the reader did not leave');

  const elsewhere = new (require('./helpers/dom-stub.cjs').FakeEl)('button');
  document.body.append(elsewhere);
  document.activeElement = elsewhere;          // a real tab-away
  btn._fire('blur');
  await tick();
  ok(!hasCls(tile, 'is-why-open'),
    'but focus genuinely moving to another control does close it');
  document.activeElement = document.body;

  /* ---- 6. what it actually says ---- */
  const pop = pops[0];
  const text = textOf(pop);
  ok(/How this score works/.test(text), 'the panel leads with what the score is');
  ok(/80 and up is strong/.test(text), 'gives the bands');
  ok(/Emergency cover/.test(text) && /Saving/.test(text) && /Debt/.test(text)
    && /Spending/.test(text) && /What you own/.test(text),
    'names every pillar it scored');
  ok(!/dash\.health\./.test(text), 'and leaks no untranslated key');

  /* The rows must add up to the headline ON SCREEN. health-math pins the
     arithmetic; this pins that the view prints the allocated integers rather
     than rounding each one itself — the bug that showed 0 + 26 + 17 beside 42. */
  const shown = find(pop, 'health-why-pts').map(e => textOf(e));
  ok(shown.length >= 3, `every scorable pillar gets a row (got ${shown.length})`);
  const sum = shown.reduce((t, s) => t + parseInt(s, 10), 0);
  const headline = parseInt(textOf(find(body, 'health-fig')[3]), 10);
  eq(sum, headline, `the rows sum to the headline on screen (${shown.join(' + ')} vs ${headline})`);

  /* ---- 7. the one actionable line ---- */
  const fix = find(pop, 'health-why-fix');
  eq(fix.length, 1, 'exactly one closing instruction');
  ok(/Costing you most/.test(textOf(fix[0])), 'which names what to fix first');
  ok(/R /.test(textOf(fix[0])), 'and gives a figure rather than an adjective');

  /* ---- 8. a vault with nothing to fix gets praise, not a drag of zero ----
     Every component at full marks: cover well past six months of the R20 000
     essentials, R9 500 a period into the fund (21% of R45 000, over the 20%
     benchmark) and no debts at all. The contributions have to be REAL rows in
     the fund's own folder, because the savings rate is measured from the
     account's inflows rather than from anything the account file asserts. */
  {
    const rich = { ...FILES,
      [`${B}/Categories/Savings.md`]: '---\ntype: savings\n---\n',
      [`${B}/Accounts/Emergency Fund.md`]:
        '---\ntype: savings\nbalance: 1700000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\n---\n' };
    for (const m of ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']) {
      rich[`${B}/Transactions/Emergency Fund/${m}.md`] =
        '---\nkind: transactions\n---\n\n| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
        + `| ${m}-06 | Transfer in | Savings | 9500.00 | | | |\n`;
    }
    const { nodes: n2 } = await mount(rich);
    const fix2 = find(n2.get('#healthBody'), 'health-why-fix');
    eq(fix2.length, 1, 'the panel still closes with one line');
    ok(!/Costing you most/.test(textOf(fix2[0])),
      'but a fully covered household is not told it has a biggest drag');
    ok(/full marks/i.test(textOf(fix2[0])),
      'it is told the opposite');
  }

  console.log(`PASS — score explainer: opens by tap, keyboard and (capability permitting) hover, and its rows add up to the headline (${checks} assertions).`);
})().catch(e => { console.error('FAIL —', e.message); process.exit(1); });
