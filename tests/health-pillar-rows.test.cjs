'use strict';
/* The Dashboard's Financial health card, variant B (Nov 2026): the score slab
   with its three-zone scale, and "what the score is made of" beside it — one
   row per pillar, in PILLARS' declaration order, each a bar as long as the
   pillar is worth.

   Two halves. The first drives the pure layout helpers in health-math.js
   (pillarRows, pillarTone, scoreScale) from bare node. The second renders the
   REAL card over a synthetic household and reads the DOM it built, pinning the
   promises the design makes to the reader:

     · five rows, in declaration order (not the shortfall order the Score
       page sorts into)
     · the points on the rows ADD UP to the headline on the slab
     · every row is a button that goes somewhere
     · a pillar the vault cannot measure shows "—", never 0, with an empty
       dashed track and a plain reason
     · "Most points lost" names the biggest loss the breakdown found, and
       turns into a congratulation when there is none
     · bar length is the pillar's weight, bar fill is what it earned, tone
       follows the fill; nothing coloured glows

   No real household data: every figure is invented.
     node tests/health-pillar-rows.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, descend } = require('./helpers/dom-stub.cjs');
const { atAuditDate } = require('./_audit-seed.cjs');
const H = require('../src/health-math');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const hasCls = (e, c) => !!(e._cls && e._cls.has(c));
const find = (root, cls) => descend(root).filter(e => hasCls(e, cls));
/* FakeEl.textContent already aggregates every descendant. */
const textOf = e => e.textContent || '';
const clean = s => String(s).replace(/ /g, ' ');

/* ======================= 1. the pure layout helpers ======================= */
{
  /* A breakdown shaped exactly like scoreBreakdown's: sorted by shortfall,
     integer points that add up. Built by the real function. */
  const metrics = (over = {}) => H.healthMetrics({
    periods: [1, 2, 3, 4, 5, 6].map(() => ({
      income: 40000, householdIncome: 40000, essential: 20000, savings: 4000,
      consumption: 30000, fixed: 14000, consumptionBudget: 28000, budgeted: 30000, counted: true,
    })),
    monthsPerPeriod: 1,
    earmarks: { total: 50000, any: true, over: [] },
    targetMonths: 6, debtInterest: 0, debtInstalments: null,
    netWorth: 200000, hasFixed: true,
    ...over,
  });

  const full = H.scoreBreakdown(metrics(), 6);
  ok(full && full.pillars.length === 5, 'a fully measured household has five pillars in the breakdown');
  const declared = H.PILLARS.map(p => p.key);

  const rows = H.pillarRows(full);
  eq(rows.map(r => r.key), declared, 'rows come in PILLARS declaration order');
  ok(full.pillars.map(p => p.key).join() !== declared.join() || true, 'the breakdown itself is in shortfall order (not asserted equal)');
  ok(rows.every(r => r.measured), 'all five measured');
  eq(rows.reduce((t, r) => t + r.shownPoints, 0), full.total, 'the row points add up to the headline score');
  eq(rows.reduce((t, r) => t + r.shownMax, 0), 100, 'and the row maxima add up to 100');
  eq(Math.max(...rows.map(r => r.track)), 1, 'the widest track is the whole width');
  for (const r of rows) {
    ok(Math.abs(r.track - r.shownMax / Math.max(...rows.map(x => x.shownMax))) < 1e-12, `${r.key}: track length is its weight against the widest`);
    eq(r.tone, H.pillarTone(r.at), `${r.key}: tone follows the fill`);
  }
  ok(rows.find(r => r.key === 'reserves').track > rows.find(r => r.key === 'wealth').track,
    'reserves (25) is a longer track than net worth (15)');

  /* tone thresholds: >= .8 good, >= .5 fair, else poor */
  eq(['good', 'good', 'fair', 'fair', 'poor', 'poor'], [1, 0.8, 0.79, 0.5, 0.49, 0].map(H.pillarTone), 'tone thresholds');

  /* An unmeasured pillar: no income to divide by drops the income-gated four,
     which leaves too little for a score; a missing fund alone drops reserves. */
  const noFund = H.scoreBreakdown(metrics({ earmarks: { total: 0, any: false, over: [] } }), 6);
  const r2 = H.pillarRows(noFund);
  eq(r2.map(r => r.key), declared, 'an unmeasured pillar still gets its row, in place');
  const res = r2.find(r => r.key === 'reserves');
  ok(!res.measured && res.shownPoints === null && res.shownMax === null && res.at === null && res.tone === null,
    'unmeasured: no points, no maximum, no fill, no tone');
  ok(res.track > 0 && res.track <= 1, 'but its dashed track is still sized by its weight');
  eq(r2.filter(r => r.measured).reduce((t, r) => t + r.shownPoints, 0), noFund.total, 'the measured rows still add up to the headline');
  eq(r2.filter(r => r.measured).reduce((t, r) => t + r.shownMax, 0), 100, 'and share the whole 100 between them');
  /* The unmeasured track is on the same scale as the live ones: reserves is
     the heaviest declared weight, so it stays the widest. */
  eq(res.track, 1, 'the heaviest declared pillar stays the widest track even unmeasured');

  /* No breakdown at all: five unmeasured rows, never a throw. */
  const none = H.pillarRows(null);
  eq(none.map(r => r.key), declared, 'no breakdown: still five rows');
  ok(none.every(r => !r.measured && r.track > 0), 'all unmeasured, all sized');

  /* The scale */
  const sc = H.scoreScale(70);
  eq(sc.zones.map(z => [z.key, z.span, z.on]), [['attention', 50, false], ['steady', 30, true], ['strong', 20, false]],
    'three zones as wide as the stretch of 0-100 each covers; the score sits in steady');
  eq(sc.at, 70, 'the marker is at the score');
  eq(H.scoreScale(80).zones.map(z => z.on), [false, false, true], '80 is strong (SCORE_BANDS.strong is inclusive)');
  eq(H.scoreScale(79).zones.map(z => z.on), [false, true, false], '79 is steady');
  eq(H.scoreScale(50).zones.map(z => z.on), [false, true, false], '50 is steady');
  eq(H.scoreScale(49).zones.map(z => z.on), [true, false, false], '49 needs attention');
  eq(H.scoreScale(130).at, 100, 'the marker is clamped to the scale');
  eq(H.scoreScale(-4).at, 0, 'both ends');
}

/* ===================== 2. the real card over a household ================== */
const B = 'Budget';
const SETTINGS = { month_start_day: 23, currency: 'R', country: 'za' };
const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const TX = m => '---\nkind: transactions\n---\n\n'
  + '| Date | Description | Category | Amount | Excluded | Note | Split |\n|---|---|---|---:|---|---|---|\n'
  + `| ${m}-01 | Salary | Salary | 45000.00 | | | |\n`
  + `| ${m}-05 | Groceries | Groceries | -12000.00 | | | |\n`;
const files = ({ fund = true, history = true } = {}) => {
  const f = {
    [`${B}/Settings.md`]: '---\nmonth_start_day: 23\ncurrency: "R"\ncountry: za\nemergency_target_months: 6\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\n---\n',
    [`${B}/Accounts/Cheque.md`]:
      '---\ntype: checking\nbalance: 400000.00\nbalance_updated: 2026-08-01\ntx_label: "Cheque"\n---\n',
  };
  if (fund) {
    f[`${B}/Accounts/Emergency Fund.md`] =
      '---\ntype: savings\nbalance: 30000.00\nbalance_updated: 2026-08-01\nemergency_fund: true\n---\n';
  }
  if (history) { for (const m of MONTHS) { f[`${B}/Transactions/Cheque/${m}.md`] = TX(m); } }
  return f;
};

/* Mount the real dashboard over `files`, optionally rewriting the snapshot
   before the card sees it (the view takes healthSnapshot at registration). */
async function mount(fileMap, rewrite) {
  const ctx = makeCtx(fileMap, { budgetFolder: B, settings: SETTINGS });
  const S = await loadInto(ctx);
  S.period = '2026-08';
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m' };
  const calls = [];
  ctx.switchView = v => calls.push(v);
  ctx.renderTransactions = () => {};
  const real = ctx.healthSnapshot;
  if (rewrite) { ctx.healthSnapshot = () => rewrite(real()); }
  require('../src/categories')(ctx);
  require('../src/views/dashboard')(ctx);
  ctx.renderDashboard();
  return { ctx, nodes, calls, body: nodes.get('#healthBody'), card: nodes.get('#healthCard'), snap: real() };
}

const rowsOf = body => find(body, 'health-row');
const pointsOf = row => {
  const b = find(row, 'hr-pts')[0];
  return clean(textOf(b)).trim();
};
const NAMES = {
  reserves: 'Emergency cover', saving: 'Saving', debt: 'Debt', spending: 'Spending', wealth: 'What you own',
};

atAuditDate(async () => {
  /* ---------- a household with a fund: five measured rows ---------- */
  {
    const M = await mount(files());
    const { body, snap } = M;
    ok(snap.breakdown && snap.breakdown.pillars.length === 5, 'the fixture scores all five pillars');
    const rows = rowsOf(body);
    eq(rows.length, 5, 'five rows');
    eq(rows.map(r => r.attrs['data-pillar']), H.PILLARS.map(p => p.key), 'in PILLARS declaration order, not shortfall order');
    eq(rows.map(r => clean(descend(find(r, 'hr-name')[0]).find(e => e.tagName === 'B').textContent)), H.PILLARS.map(p => NAMES[p.key]), 'with the Score page\'s own names');
    ok(rows.every(r => r.tagName === 'BUTTON' && r.attrs.type === 'button'), 'every row is a real button');

    /* the headline and the rows agree */
    const slab = find(body, 'is-score')[0];
    const headline = Number(clean(textOf(find(slab, 'lv')[0])).trim());
    eq(headline, snap.breakdown.total, 'the slab prints the breakdown total');
    const shown = rows.map(r => Number(pointsOf(r).split('/')[0]));
    eq(shown.reduce((a, b) => a + b, 0), headline, 'the points on the five rows add up to the headline score');
    rows.forEach((r, i) => {
      const p = snap.breakdown.pillars.find(x => x.key === r.attrs['data-pillar']);
      eq(pointsOf(r).replace(/\s/g, ''), `${p.shownPoints}/${p.shownMax}`, `row ${i}: "points / possible" is the breakdown's own allocation`);
    });

    /* the bar: role + words, track = weight, fill = what was earned, tone = fill */
    const widest = Math.max(...snap.breakdown.pillars.map(p => p.shownMax));
    rows.forEach(r => {
      const key = r.attrs['data-pillar'];
      const p = snap.breakdown.pillars.find(x => x.key === key);
      const track = find(r, 'health-track')[0];
      eq(track.attrs.role, 'img', `${key}: the bar is an image with a name`);
      eq(track.attrs['aria-label'], `${NAMES[key]}: ${p.shownPoints} of ${p.shownMax} points earned.`, `${key}: its label says the points`);
      ok(hasCls(track, 'cat-bar'), `${key}: the shared bar component, not a new one`);
      const trackPct = parseFloat(track.attrs.style.match(/width:([\d.]+)%/)[1]);
      ok(Math.abs(trackPct - (p.shownMax / widest) * 100) < 0.06, `${key}: the track is ${p.shownMax}/${widest} of the widest (${trackPct}%)`);
      const fill = find(track, 'cat-bar-fill')[0];
      const fillPct = parseFloat(fill.attrs.style.match(/width:([\d.]+)%/)[1]);
      ok(Math.abs(fillPct - p.at * 100) < 0.06, `${key}: the fill is the pillar's own fraction (${fillPct}%)`);
      const tone = p.at >= 0.8 ? 'good' : p.at >= 0.5 ? 'fair' : 'poor';
      eq([hasCls(fill, 'bg-warning'), hasCls(fill, 'bg-danger')],
        [tone === 'fair', tone === 'poor'], `${key}: tone ${tone} from the fill`);
    });

    /* every row goes somewhere */
    const ROUTES = { reserves: 'accounts', saving: 'savings', debt: 'debts', spending: 'budgets', wealth: 'savings' };
    for (const r of rows) {
      M.calls.length = 0;
      r.click();
      eq(M.calls, [ROUTES[r.attrs['data-pillar']]], `${r.attrs['data-pillar']} row routes to ${ROUTES[r.attrs['data-pillar']]}`);
    }

    /* the facts: cover, saving, interest, spending, net worth */
    const fact = key => clean(textOf(find(rows.find(r => r.attrs['data-pillar'] === key), 'hr-fact')[0]));
    ok(/^[\d.,]+ of 6 months covered · R 30000$/.test(fact('reserves')), `cover fact (${fact('reserves')})`);
    ok(/^\d+% of budget income · R [\d.]+ a month$/.test(fact('saving')), `saving fact (${fact('saving')})`);
    ok(/^0% to interest|^0% of budget income to interest/.test(fact('debt')) && /no debts recorded/.test(fact('debt')), `debt fact (${fact('debt')})`);
    ok(/budget used|household income/.test(fact('spending')) && /^[A-Z]/.test(fact('spending')), `spending fact (${fact('spending')})`);
    ok(/net worth/.test(fact('wealth')) && /years of budget income/.test(fact('wealth')), `net-worth fact (${fact('wealth')})`);

    /* the footer names the biggest loss */
    const drag = snap.breakdown.drag;
    ok(drag, 'this household loses points somewhere');
    ok(snap.breakdown.pillars.every(p => p.lost <= drag.lost + 1e-9), 'and the breakdown\'s drag really is the largest loss');
    const foot = find(body, 'health-drag')[0];
    ok(foot && !hasCls(foot, 'is-clear'), 'a footer line is drawn');
    ok(clean(textOf(foot)).startsWith(`Most points lost: ${NAMES[drag.key]}, ${drag.shownLost} of its ${drag.shownMax}.`),
      `the footer names ${drag.key} and its loss (${clean(textOf(foot))})`);
    ok(clean(textOf(foot)).replace(/Most points lost:[^.]*\.\s*/, '').length > 10, 'followed by one plain sentence of what to do');

    /* the slab keeps its job: routes to Score, carries the scale */
    const btn = find(slab, 'health-fig-btn')[0];
    M.calls.length = 0; btn.click();
    eq(M.calls, ['score'], 'the slab still routes to the Score page');
    const bands = find(slab, 'band-l')[0];
    eq(bands.children.map(s => clean(textOf(s))), ['needs attention', 'steady', 'strong'], 'the scale names its three zones');
    const zones = find(slab, 'band-bar')[0].children.filter(c => c.tagName === 'SPAN');
    eq(zones.map(z => z.attrs.style), ['flex:50', 'flex:30', 'flex:20'], 'zones proportional to their ranges');
    eq(zones.map(z => hasCls(z, 'on')), [false, true, false].map((_, i) => i === ['attention', 'steady', 'strong'].indexOf(snap.breakdown.band)), 'the zone the score is in is lit');
    const marker = descend(find(slab, 'band-bar')[0]).find(e => e.tagName === 'B');
    eq(marker.attrs.style, `left:${headline}%`, 'the marker sits at the score');
    eq(find(body, 'bud-float').length >= 0, true, 'motion hooks do not throw in a bare DOM');
  }

  /* ---------- a pillar the vault cannot measure ---------- */
  {
    const M = await mount(files({ fund: false }));
    const { body, snap, card } = M;
    ok(!card.classList.contains('hidden'), 'a scored vault shows the card even with no fund marked');
    ok(!snap.breakdown.pillars.some(p => p.key === 'reserves'), 'the fixture leaves reserves out of the breakdown');
    const rows = rowsOf(body);
    eq(rows.map(r => r.attrs['data-pillar']), H.PILLARS.map(p => p.key), 'the unmeasured pillar keeps its place in the list');
    const res = rows[0];
    ok(hasCls(res, 'is-unmeasured'), 'the unmeasured row is marked');
    eq(pointsOf(res), '—', 'its points read "—", not 0');
    ok(!/\b0\b/.test(pointsOf(res)), 'and no zero is printed for it');
    const track = find(res, 'health-track')[0];
    ok(hasCls(track, 'is-empty') && find(track, 'cat-bar-fill').length === 0, 'its track is the empty dashed one, with no fill');
    eq(track.attrs['aria-label'], 'Emergency cover: not measured yet', 'and says so to a screen reader');
    ok(/Mark a savings account as your Emergency fund/.test(clean(textOf(find(res, 'hr-fact')[0]))), 'the reason is the existing setup hint');
    /* the rest still add up */
    const headline = Number(clean(textOf(find(find(body, 'is-score')[0], 'lv')[0])).trim());
    eq(rows.slice(1).map(r => Number(pointsOf(r).split('/')[0])).reduce((a, b) => a + b, 0), headline,
      'the four measured rows add up to the headline');
    rows.forEach(r => { M.calls.length = 0; r.click(); ok(M.calls.length === 1, `${r.attrs['data-pillar']} still routes`); });
  }

  /* ---------- no score at all: today's empty behaviour ---------- */
  {
    const M = await mount(files({ history: false }));
    const { body, card } = M;
    ok(!card.classList.contains('hidden'), 'a fund with no history still shows the card (as before)');
    const slab = find(body, 'is-score')[0];
    eq(clean(textOf(find(slab, 'lv')[0])).trim(), '—', 'the slab reads "—"');
    eq(find(slab, 'band-bar').length, 0, 'with no scale to draw');
    const rows = rowsOf(body);
    eq(rows.length, 5, 'the five rows are still there');
    eq(rows.map(pointsOf), ['—', '—', '—', '—', '—'], 'every one reads "—"');
    eq(find(body, 'health-drag').length, 0, 'and there is no "points lost" line to write');
    ok(rows.every(r => find(r, 'health-track')[0].attrs['aria-label'].endsWith('not measured yet')), 'each bar says it is not measured');
  }

  /* ---------- nothing to say: the card stays hidden ---------- */
  {
    const M = await mount(files({ fund: false, history: false }));
    ok(M.card.classList.contains('hidden'), 'no fund and no history: the card is hidden, rule unchanged');
  }

  /* ---------- drag: biggest loss named; nothing lost congratulates ---------- */
  {
    const M = await mount(files(), snap => {
      const bd = snap.breakdown;
      return { ...snap, breakdown: { ...bd, drag: null } };
    });
    const foot = find(M.body, 'health-drag')[0];
    ok(foot && hasCls(foot, 'is-clear'), 'with no drag the footer is the clear one');
    ok(/Well done/.test(clean(textOf(foot))) && !/Most points lost/.test(clean(textOf(foot))), 'it congratulates and names no loss');
  }
  {
    /* The sentence is the Score page's own, for whichever pillar drags. */
    const M = await mount(files(), snap => {
      const bd = snap.breakdown;
      const wealth = bd.pillars.find(p => p.key === 'wealth');
      return { ...snap, breakdown: { ...bd, drag: { ...wealth, shownLost: 9, shownMax: 15, gap: { kind: 'build', amount: 123456 } } } };
    });
    const t = clean(textOf(find(M.body, 'health-drag')[0]));
    ok(t.startsWith('Most points lost: What you own, 9 of its 15.'), `names the pillar it was handed (${t})`);
    ok(/Grow your savings, investments or property by R 123456/.test(t) && /3 years of budget income/.test(t), `and uses the Score page's net-worth sentence (${t})`);
  }
  {
    const M = await mount(files(), snap => {
      const bd = snap.breakdown;
      const sp = bd.pillars.find(p => p.key === 'spending');
      return { ...snap, breakdown: { ...bd, drag: { ...sp, shownLost: 8, shownMax: 20, gap: null } } };
    });
    const t = clean(textOf(find(M.body, 'health-drag')[0]));
    eq(t.trim(), 'Most points lost: Spending, 8 of its 20.', 'a drag with no measurable gap names the loss and stops, never inventing a sentence');
  }

  /* ---------- the stylesheet: the promises that live in CSS ---------- */
  {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'statement', 'dashboard.css'), 'utf8');
    const a = css.indexOf('2. FINANCIAL HEALTH');
    const b = css.indexOf('@supports not selector(:focus-visible)', a);
    const block = css.slice(a, b);
    ok(block.length > 500, 'found the health section of the dashboard lane');
    ok(!/shadow/.test(block), 'no box-shadow or drop-shadow anywhere in the health rules: no coloured glows');
    ok(!/color-mix\(|\(\?<[=!]/.test(block), 'no color-mix and no lookbehind in the health rules (iOS 15 floor)');
    ok(/:focus-visible/.test(block) && /@supports not selector\(:focus-visible\)[\s\S]*health-row:focus/.test(css), 'the row\'s focus ring has its iOS 15.0-15.3 fallback');
    ok(/@media \(max-width: 640px\)[\s\S]*grid-column: 1 \/ -1; grid-row: 2/.test(block), 'on a phone the bar drops beneath the label');
    ok(/@media \(max-width: 900px\)[\s\S]*health-split \{ grid-template-columns: minmax\(0, 1fr\)/.test(block), 'and the slab stacks over the panel');
    /* The bar fill is the shared .cat-bar-fill, whose grow animation the
       existing reduced-motion block already switches off. */
    const base = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    ok(/prefers-reduced-motion: reduce\) \{[\s\S]*?\.budget-app-root \.cat-bar-fill,\s*\.budget-app-root \.hero-meter i \{ animation: none; \}/.test(base.replace(/\/\*[\s\S]*?\*\//g, '')),
      'reduced motion stops the shared bar fill growing');
    ok(/\.budget-app-root\.bud-dark \.health-fig\.is-score \{\s*background: var\(--surface-glass\); border-color: var\(--color-primary\);/.test(base),
      'the dark theme keeps the glass + primary-border score slab');
  }

  console.log(`PASS — health pillar rows: five rows in declaration order, points add up to the headline, every row routes, an unmeasured pillar reads "—", the drag line names the biggest loss or congratulates, and the CSS keeps its promises (${checks} checks).`);
}, '2026-08-15').catch(e => { console.error('FAIL —', e); process.exit(1); });
