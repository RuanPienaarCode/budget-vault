'use strict';
/* Chart and SVG invariants — the class of bug a 13-agent audit found living
   entirely in the CALLERS of src/chart.js, not in the primitives themselves.

   Two shipped, both CRITICAL, and neither was catchable by any test that
   existed before this file:

     1. THE SAVINGS GROWTH CHART (src/views/savings.js renderGrowth) scaled its
        y-axis to the series' FINAL point while `capital + posted` is not
        monotonic — a fund that peaked at R180 000 before a R150 000
        withdrawal closed at R30 000, the plot scaled to R30 000, and most of
        the curve mapped ABOVE `padT`, where the chart's own `clip-path`
        discarded it. No y-axis, no gridline labels: nothing else on screen
        could have revealed the wrong scale.

     2. THE SCORE FLOW SANKEY (src/views/score.js buildFlowSankey) laid its
        four bands out against a hard 100 while money-flow.js's percentages
        legitimately exceed 100 in a deficit period (spend + saving > income).
        At a 124% sum, a real band's rect, name and amount all laid out below
        the bottom of a 280-unit viewBox and were clipped away entirely — the
        reader saw three bands where there were four.

   Both are now fixed. This file exists to pin the SHAPE of both bugs — "a
   scale computed from the wrong extent silently discards real data" — as a
   set of invariants that run over every chart the app draws, plus a set of
   invariants over src/chart.js's primitives in isolation.

   Two layers:

     A. VIEW-LEVEL, over every <svg> a rendered view actually produces (a real
        loadVault + a real view module + tests/helpers/dom-stub.cjs's small
        DOM). Nothing here re-derives what a chart SHOULD look like from the
        view's own source — it only checks properties that must hold of ANY
        correctly drawn chart, so it survives a view being refactored.

     B. PRIMITIVE-LEVEL, over src/chart.js's exported functions directly —
        pure, no DOM, run in bare node.

   Bare-node script, house convention: `require('assert')`, count checks, one
   PASS line, non-zero exit on failure. tests/donut-percentages.test.cjs and
   tests/slice-colours.test.cjs are the closest relatives; donut-percentages'
   own `naiveRound` negative control is the standard this file matches — see
   SECTION C below for the three negative controls this file keeps to that
   same bar.

     node tests/chart-invariants.test.cjs        # non-zero exit on failure
*/

const assert = require('assert');
const { stubObsidian, makeCtx, loadInto } = require('./helpers/harness.cjs');
stubObsidian();
const { makeDom, installDom, descend } = require('./helpers/dom-stub.cjs');
const {
  scales, gridlines, arcPath, linePath, areaPath, distinctColors,
  historicalRanges, rangeFor, rangePills, RANGES, parseColor,
} = require('../src/chart');
const { periodFlow } = require('../src/money-flow');
const { sharePercents, largestRemainder } = require('../src/share-percents');
const { growthSeries } = require('../src/savings-math');

let checks = 0, fail = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fail++; console.log(`  FAIL ${msg}`); } };
const eq = (a, b, msg) => {
  const same = (Array.isArray(a) || Array.isArray(b)) ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);
  ok(same, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
};
const close = (a, b, msg, eps = 0.001) => ok(Math.abs(a - b) < eps, `${msg} (got ${a}, want ~${b})`);

/* ======================================================================= *
 * SECTION A — geometry readers. Generic over ANY <path>/<rect>/<circle>/
 * <line>/<text>/<polyline> this app's charts draw, so they need no updating
 * when a view's own layout changes.
 * ======================================================================= */

/* Pulls every (x, y) coordinate PAIR a path `d` string places a pen at. Two
   things make this simpler than a general SVG path parser, and both are true
   of every `d` this codebase's charts emit (chart.js's linePath/areaPath/
   arcPath, and the view-local copies in savings.js and accounts.js that
   follow the same grammar): only M, L and A commands ever appear, and there
   is exactly one coordinate (M/L) or one endpoint (A, the last two of its
   seven numbers) per command — never an implicit repeat. Both `12.3,45.6`
   (chart.js's own linePath/arcPath) and `12.3 45.6` (savings.js's and
   accounts.js's hand-rolled paths) are in real use, so numbers are pulled by
   regex rather than assumed comma-separated. */
function pathPoints(d) {
  if (!d || typeof d !== 'string') return [];
  const pts = [];
  const re = /([MLA])([^MLAZ]*)/gi;
  let m;
  while ((m = re.exec(d))) {
    const cmd = m[1].toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (cmd === 'A' && nums.length >= 7) pts.push([nums[nums.length - 2], nums[nums.length - 1]]);
    else if ((cmd === 'M' || cmd === 'L') && nums.length >= 2) pts.push([nums[0], nums[1]]);
  }
  return pts;
}

/* Every point a single element plants on the canvas — enough to bound it, not
   a full render. A <circle>'s bounding box (cx±r) rather than its true outline
   is deliberately conservative: chart.js never draws an off-centre circle, so
   the corners of that box are never tighter than the real shape. */
/* A shape built with SOME of its geometry left for a later pointer/keyboard
   event to fill in (dashboard.js's `trend-focus` group: five nodes built
   once with no cx/cy at all, moved into place on first focus, hidden at
   rest by CSS) is not yet a drawn point. `has()` tells "attribute present"
   apart from "attribute present and equal to 0" — the distinction that
   matters, since treating an absent cx/cy as 0 turned every one of those
   five inert nodes into a false "point at the origin" here. */
function elementPoints(e) {
  const has = k => e.getAttribute(k) != null;
  const n = k => Number(e.getAttribute(k));
  // A hit-target: invisible on purpose (chart.js's trackPoints() replaces
  // per-point hit shapes with a whole-chart handler; the <title>-only
  // fallback below it draws a full-height transparent strip per point that
  // deliberately overlaps the axis padding — it is a click surface, not ink).
  if (e.getAttribute('fill') === 'transparent') return [];
  switch (e.tagName) {
    case 'PATH': return pathPoints(e.getAttribute('d'));
    case 'RECT': {
      if (!has('x') || !has('y') || !has('width') || !has('height')) return [];
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    }
    case 'LINE': {
      if (!has('x1') || !has('y1') || !has('x2') || !has('y2')) return [];
      return [[n('x1'), n('y1')], [n('x2'), n('y2')]];
    }
    case 'CIRCLE': {
      if (!has('cx') || !has('cy')) return [];
      const cx = n('cx'), cy = n('cy'), r = has('r') ? n('r') : 0;
      return [[cx - r, cy - r], [cx + r, cy + r]];
    }
    case 'TEXT': {
      if (!has('x') || !has('y')) return [];
      return [[n('x'), n('y')]];
    }
    case 'POLYLINE': {
      const raw = e.getAttribute('points') || '';
      return raw.trim().split(/\s+/).filter(Boolean).map(p => p.split(',').map(Number))
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    }
    default: return [];
  }
}

function allNodes(e, out = []) {
  if (e.nodeType === 1) out.push(e);
  for (const c of e.children || []) allNodes(c, out);
  return out;
}

/* Every <svg> reachable from any node the mount produced. dom-stub's `$` hands
   out an independent element per id, not all hung off one shared root, so
   every mounted container has to be walked — not just ctx.root. */
function svgsIn(nodes) {
  const out = [];
  for (const node of nodes.values()) {
    for (const e of allNodes(node)) if (e.tagName === 'SVG') out.push(e);
  }
  return out;
}

const ATTR_LIST = ['d', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'transform', 'points', 'stroke-dasharray', 'offset'];

/* ------------------------------------------------------------------------ *
 * A1/A2 — structural corruption. A malformed `d` renders as an INVISIBLE
 * shape with no thrown error; this is the whole reason these are worth
 * asserting even though nothing here ever computed a bug from them directly.
 * ------------------------------------------------------------------------ */
function checkNoCorruption(svg, label) {
  for (const e of allNodes(svg)) {
    for (const a of ATTR_LIST) {
      const v = e.getAttribute(a);
      if (v == null) continue;
      ok(!/NaN|Infinity|undefined/.test(v), `${label}: <${e.tagName}> ${a}="${v}" is malformed`);
    }
    if (e.tagName === 'PATH') {
      const d = e.getAttribute('d');
      ok(d != null && String(d).trim().length > 0, `${label}: a <path> has an empty or missing d`);
    }
  }
}

/* ------------------------------------------------------------------------ *
 * A3 — every drawn point lies inside its OWN plot area / clip rect. This is
 * the one that catches CRITICAL 1: chart.js's charts declare a <clipPath>
 * with one <rect>, and put the animated geometry in a <g clip-path="url(#…)">
 * that references it (savings.js's `-wipe` ids). A point that needed the clip
 * to hide it was placed wrongly in the first place — clipping is for the
 * ENTRY ANIMATION, not for making bad geometry invisible.
 * ------------------------------------------------------------------------ */
function checkClipContainment(svg, label, eps = 3) {
  const clipRects = new Map();
  for (const cp of allNodes(svg).filter(e => e.tagName === 'CLIPPATH')) {
    const id = cp.getAttribute('id');
    const r = allNodes(cp).find(e => e.tagName === 'RECT');
    if (id && r) {
      clipRects.set(id, {
        x: Number(r.getAttribute('x')) || 0, y: Number(r.getAttribute('y')) || 0,
        w: Number(r.getAttribute('width')) || 0, h: Number(r.getAttribute('height')) || 0,
      });
    }
  }
  if (!clipRects.size) return 0;
  let groupsChecked = 0;
  for (const e of allNodes(svg)) {
    const cpAttr = e.getAttribute && e.getAttribute('clip-path');
    if (!cpAttr) continue;
    const m = /url\(#([^)]+)\)/.exec(cpAttr);
    const bounds = m && clipRects.get(m[1]);
    if (!bounds) continue;
    groupsChecked++;
    for (const d of allNodes(e)) {
      for (const [x, y] of elementPoints(d)) {
        ok(x >= bounds.x - eps && x <= bounds.x + bounds.w + eps,
          `${label}: a point at x=${x} escapes its own clip rect [${bounds.x}, ${bounds.x + bounds.w}] `
          + `(<${d.tagName}> under clip-path #${m[1]}) — this is the CRITICAL-1 shape: a wrong scale `
          + `hides real data behind the wipe clip instead of the entry animation`);
        ok(y >= bounds.y - eps && y <= bounds.y + bounds.h + eps,
          `${label}: a point at y=${y} escapes its own clip rect [${bounds.y}, ${bounds.y + bounds.h}] `
          + `(<${d.tagName}> under clip-path #${m[1]}) — this is the CRITICAL-1 shape`);
      }
    }
  }
  return groupsChecked;
}

/* ------------------------------------------------------------------------ *
 * A4 — where a set of segments is laid out along a fixed extent (the chart's
 * own declared viewBox), the laid extent does not exceed it. This is the one
 * that catches CRITICAL 2: the sankey's bands, and any other chart that lays
 * rects/text/lines out proportionally, must stay inside the SVG's own
 * viewBox — the canvas the reader can actually see. `eps` is generous enough
 * to absorb a stroke halo or a `.toFixed(1)` rounding, and nowhere near
 * generous enough to absorb a whole clipped-away band (which the real bug
 * put ~15+ units past the edge on a 280-unit chart).
 * ------------------------------------------------------------------------ */
function checkViewBoxContainment(svg, label, eps = 4) {
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some(Number.isNaN)) return; // no viewBox: nothing to check against
  const [vx, vy, vw, vh] = vb;
  for (const e of allNodes(svg)) {
    if (e.tagName === 'DEFS' || e.tagName === 'CLIPPATH' || e.tagName === 'LINEARGRADIENT' || e.tagName === 'STOP') continue;
    for (const [x, y] of elementPoints(e)) {
      ok(x >= vx - eps && x <= vx + vw + eps,
        `${label}: <${e.tagName}> x=${x} is outside the declared viewBox [${vx}, ${vx + vw}] — `
        + `this is the CRITICAL-2 shape: geometry laid out past its own canvas`);
      ok(y >= vy - eps && y <= vy + vh + eps,
        `${label}: <${e.tagName}> y=${y} is outside the declared viewBox [${vy}, ${vy + vh}] — `
        + `this is the CRITICAL-2 shape`);
    }
  }
}

function checkChart(svg, label) {
  checkNoCorruption(svg, label);
  checkClipContainment(svg, label);
  checkViewBoxContainment(svg, label);
}

function checkAll(nodes, label) {
  const svgs = svgsIn(nodes);
  for (let i = 0; i < svgs.length; i++) checkChart(svgs[i], `${label} svg#${i}`);
  return svgs.length;
}

/* ======================================================================= *
 * SECTION B — drive real views over vaults built to exercise the edges:
 * non-monotonic savings, a deficit period, a single data point, an
 * all-negative account split, one slice at 100%.
 * ======================================================================= */

const B = 'Budget';
const SETTINGS = '---\nmonth_start_day: 1\ncurrency: "R"\ncountry: za\n---\n';
const txFile = (rows, extraFm = '') =>
  `---\ntags: [finance, finance/budget, finance/budget/transactions]\n${extraFm}---\n\n`
  + '| Date | Description | Category | Amount | Excluded | Note |\n|---|---|---|---:|---|---|\n' + rows;
const row = (date, desc, cat, amt) => `| ${date} | ${desc} | ${cat} | ${amt.toFixed(2)} |  |  |\n`;

async function mountView(files, { viewFile, register, extra } = {}) {
  const ctx = makeCtx(files);
  const S = await loadInto(ctx);
  S.period = '2026-07';
  const { $, nodes } = makeDom();
  ctx.$ = $; ctx.$$ = () => [];
  ctx.root = $('#root');
  ctx.view = { containerEl: $('#root') };
  ctx.money = (v, dp = 2) => `R ${Number(v).toFixed(dp)}`;
  ctx.moneyIn = (sym, v, dp = 2) => `${sym} ${Number(v).toFixed(dp)}`;
  ctx.plugin.settings = { ...ctx.plugin.settings, chartTrendRange: '6m', chartDebtRange: '5y' };
  // Cross-view click targets: never CALLED during a render, only referenced
  // inside onclick closures, but wired defensively the way every mount
  // fixture in this repo already does.
  // Cross-view actions (editBalance, editAccount, deleteAccount, …) are only
  // ever reached from an onclick closure, never called while a render itself
  // runs — so they need no stub here, and stubbing them would collide with
  // views/accounts.js's own ctx.provide() (which supplies the real ones and
  // throws on a redefinition — see harness.cjs). `render` is the one name
  // nothing else provides.
  ctx.render = ctx.render || (() => {});
  ctx.switchView = ctx.switchView || (() => {});
  const { el } = require('../src/dom');
  ctx.typeBadge = ctx.typeBadge || (type => el('span', { class: `category-badge badge-${type}` }, type));
  require('../src/categories')(ctx);
  if (extra) extra(ctx, $);
  register(ctx);
  return { ctx, S, nodes, $ };
}

/* ---- B1. dashboard: trend line + spending donut, a mixed happy-path vault
   plus a single-category donut (one slice at 100%). ---- */
(async () => {
  const CATS = {
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#c0392b"\n---\n',
    [`${B}/Categories/Transport.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
  };
  const ACCOUNT = { [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 100\n---\n' };
  const MIXED = {
    [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
    [`${B}/Transactions/Cheque/2026-06.md`]: txFile(
      row('2026-06-05', 'Woolworths', 'Groceries', -800) + row('2026-06-25', 'Payday', 'Salary', 20000)),
    [`${B}/Transactions/Cheque/2026-07.md`]: txFile(
      row('2026-07-03', 'Woolworths', 'Groceries', -1200) + row('2026-07-08', 'Uber', 'Transport', -300)
      + row('2026-07-25', 'Payday', 'Salary', 20000)),
  };
  const { ctx: cMixed, nodes: nMixed } = await mountView(MIXED, { register: require('../src/views/dashboard') });
  cMixed.renderDashboard();
  const n1 = checkAll(nMixed, 'dashboard/mixed');
  ok(n1 >= 2, `dashboard/mixed drew at least the trend and the donut (got ${n1})`);

  /* One category at 100% of a period's spend — arcPath's own clamp-at-2π
     boundary, exercised through the real donut rather than in isolation. */
  const ONE_CAT = {
    [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
    [`${B}/Transactions/Cheque/2026-06.md`]: txFile(row('2026-06-05', 'Woolworths', 'Groceries', -800)),
    [`${B}/Transactions/Cheque/2026-07.md`]: txFile(row('2026-07-03', 'Woolworths', 'Groceries', -1200)),
  };
  const { ctx: cOne, nodes: nOne } = await mountView(ONE_CAT, { register: require('../src/views/dashboard') });
  cOne.renderDashboard();
  checkAll(nOne, 'dashboard/one-category');

  /* A single data point: the trend chart's own documented empty state (fewer
     than two periods), which must draw NO malformed svg — scales({count:1})
     is exercised directly in the primitive section below. */
  const SINGLE = {
    [`${B}/Settings.md`]: SETTINGS, ...CATS, ...ACCOUNT,
    [`${B}/Transactions/Cheque/2026-07.md`]: txFile(row('2026-07-03', 'Woolworths', 'Groceries', -1200)),
  };
  const { ctx: cSingle, nodes: nSingle } = await mountView(SINGLE, { register: require('../src/views/dashboard') });
  cSingle.renderDashboard();
  checkAll(nSingle, 'dashboard/single-period');

  /* ---- B2. savings: the exact CRITICAL-1 shape — a fund that peaks well
     above its own closing balance. ---- */
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(2025, 3, 12, 12, 0, 0); }
    static now() { return new PinnedDate().getTime(); }
  }
  global.Date = PinnedDate;
  const NONMONO = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Categories/Transfer.md`]: '---\ntype: expense\ncolor: "#2980b9"\n---\n',
    [`${B}/Accounts/Growth Fund.md`]: '---\ntype: investment\ntx_label: "Growth Fund"\nbalance: 30000\n'
      + 'balance_updated: 2025-04-01\nstarting_amount: 20000\ninception_date: 2025-01-01\n---\n',
    // Peaks at 20 000 + 160 000 = 180 000 in February, then a 150 000
    // withdrawal in March closes at 30 000 — the same shape the bug report
    // gives verbatim (R180 000 peak, R150 000 withdrawal, R30 000 close).
    [`${B}/Transactions/Growth Fund/2025-02.md`]: txFile(row('2025-02-05', 'Big deposit', 'Transfer', 160000)),
    [`${B}/Transactions/Growth Fund/2025-03.md`]: txFile(row('2025-03-10', 'Withdrawal', 'Transfer', -150000)),
  };
  const { ctx: cGrowth, nodes: nGrowth } = await mountView(NONMONO, { register: require('../src/views/savings') });
  cGrowth.renderSavings();
  const growthSvgCount = checkAll(nGrowth, 'savings/non-monotonic-growth');
  ok(growthSvgCount >= 1, `the non-monotonic growth chart actually drew an svg to check (got ${growthSvgCount})`);
  /* And specifically: the clip-guarded group was found and checked, not
     silently skipped because no clipPath matched. A containment check that
     never ran would pass this suite for the wrong reason. */
  {
    const svg = svgsIn(nGrowth).find(s => (s.getAttribute('class') || '').includes('growth-svg'));
    ok(svg, 'the growth chart svg is present (class="growth-svg")');
    if (svg) {
      const groupsChecked = checkClipContainment(svg, 'savings/non-monotonic-growth (recheck)');
      ok(groupsChecked >= 1, `the growth chart's clip-guarded group was actually found and checked `
        + `(got ${groupsChecked}) — a check that never runs proves nothing`);
    }
  }
  global.Date = RealDate;

  /* ---- B3. worth composition bar: assets dwarfed by debt, and vice versa —
     the shared-scale bar chart's own extreme cases. ---- */
  const HEAVY_DEBT = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 500\n---\n',
    [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
      + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
      + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
      + '| Bond | Bank | home loan | 900000.00 | 1000000.00 | 11.25 | 9500.00 | 0.00 | 2020-01-01 | | active | |\n',
  };
  const { ctx: cWorth, nodes: nWorth } = await mountView(HEAVY_DEBT, { register: require('../src/views/savings') });
  cWorth.renderSavings();
  checkAll(nWorth, 'savings/heavy-debt-worth-bar');

  /* ---- B4. accounts: an all-negative split (the donut's own documented
     early return — nothing drawn, nothing malformed either) and a single
     positive group (one slice at 100%, real accounts.js path). ---- */
  const ALL_NEG = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Accounts/Visa.md`]: '---\ntype: credit_card\ntx_label: "Visa"\nbalance: -3000\n---\n',
    [`${B}/Accounts/Amex.md`]: '---\ntype: credit_card\ntx_label: "Amex"\nbalance: -1500\n---\n',
  };
  const { ctx: cNeg, nodes: nNeg } = await mountView(ALL_NEG, { register: require('../src/views/accounts') });
  cNeg.renderAccounts();
  const negSvgs = checkAll(nNeg, 'accounts/all-negative');
  eq(negSvgs, 0, 'an all-negative account split draws no donut rather than a malformed one');

  const ONE_GROUP = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 5000\n---\n',
  };
  const { ctx: cOneG, nodes: nOneG } = await mountView(ONE_GROUP, { register: require('../src/views/accounts') });
  cOneG.renderAccounts();
  checkAll(nOneG, 'accounts/one-group-100pct');

  /* ---- B5. debts: a stalled plan (payment at or below monthly interest),
     the exact case debts.js's own comment says used to run off the top of a
     chart scaled to the opening balance instead of the visible peak. ---- */
  const STALLED = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Debts.md`]: '---\nkind: debts\n---\n\n'
      + '| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |\n'
      + '|---|---|---|---:|---:|---:|---:|---:|---|---|---|---|\n'
      + '| Card | Bank | credit card | 10000.00 | 10000.00 | 30.00 | 100.00 | 0.00 | 2024-01-01 | | active | |\n',
  };
  const { ctx: cDebt, nodes: nDebt, $: dbg$ } = await mountView(STALLED, { register: require('../src/views/debts') });
  dbg$('#debtStrategy').value = 'avalanche';
  dbg$('#debtExtra').value = '';
  cDebt.renderDebts();
  checkAll(nDebt, 'debts/stalled-plan');

  /* ---- B6. score: the exact CRITICAL-2 shape — a deficit period whose
     bands sum to well past 100% of income. ---- */
  const DEFICIT = {
    [`${B}/Settings.md`]: SETTINGS,
    [`${B}/Categories/Rent.md`]: '---\ntype: housing\nfixed: true\ncolor: "#e74c3c"\n---\n',
    [`${B}/Categories/Groceries.md`]: '---\ntype: expense\ncolor: "#3498db"\n---\n',
    [`${B}/Categories/Salary.md`]: '---\ntype: income\ncolor: "#27ae60"\n---\n',
    [`${B}/Categories/Transfer.md`]: '---\ntype: expense\ncolor: "#8e44ad"\n---\n',
    [`${B}/Accounts/Cheque.md`]: '---\ntype: checking\ntx_label: "Cheque"\nbalance: 500\n---\n',
    [`${B}/Accounts/Emergency Fund.md`]: '---\ntype: savings\ntx_label: "Emergency Fund"\nbalance: 2000\n---\n',
    [`${B}/Transactions/Cheque/2026-07.md`]: txFile(
      row('2026-07-01', 'Payday', 'Salary', 10000)
      + row('2026-07-02', 'Landlord', 'Rent', -6000)
      + row('2026-07-05', 'Shop', 'Groceries', -9000)),
    [`${B}/Transactions/Emergency Fund/2026-07.md`]: txFile(row('2026-07-06', 'Transfer in', 'Transfer', 2000)),
  };
  /* score.js's flow card reads currentPeriod() (today's real clock), not
     S.period — pin the clock into the same July window the fixture's rows
     live in, or the "current period" silently lands on an empty August and
     the whole card renders nothing to check. */
  const RealDate2 = Date;
  class PinnedDate2 extends RealDate2 {
    constructor(...a) { if (a.length) super(...a); else super(2026, 6, 15, 12, 0, 0); }
    static now() { return new PinnedDate2().getTime(); }
  }
  global.Date = PinnedDate2;
  const { ctx: cScore, S: sScore, nodes: nScore } = await mountView(DEFICIT, { register: require('../src/views/score') });
  sScore.period = '2026-07';
  cScore.renderScore();
  global.Date = RealDate2;
  const scoreSvgs = checkAll(nScore, 'score/deficit-sankey');
  {
    const sankey = svgsIn(nScore).find(s => (s.getAttribute('class') || '').includes('score-flow-sankey'));
    ok(sankey, `the deficit period's sankey actually drew (got ${scoreSvgs} svgs) — a fixture that never `
      + `reaches the chart proves nothing about it`);
    if (sankey) {
      /* Confirms the fixture actually trips the deficit shape, the same way
         donut-percentages' naiveRound negative control confirms ITS fixture
         trips the rounding bug — see SECTION C for the full negative control
         against a scratch reproduction of the old (÷100) layout. */
      const rects = allNodes(sankey).filter(e => e.tagName === 'RECT' && e.getAttribute('class'));
      ok(rects.length >= 3, `the sankey drew multiple band rects (got ${rects.length})`);
    }
  }

  console.log(`  view-level: ${checks} checks so far, ${fail} failed`);
})().then(runSectionC).then(runSectionD).catch(e => { console.error('FAIL —', e.stack || e.message); process.exit(1); });

/* ======================================================================= *
 * SECTION C — negative controls. Three assertions, each proven to catch a
 * REAL regression by reintroducing the old broken geometry in a scratch copy
 * (never touching src/) and showing it goes RED against the very same
 * checker that is GREEN against main.
 * ======================================================================= */
async function runSectionC() {
  /* ---- C1. CRITICAL 1, reproduced: scale to the FINAL point only. ----
     savings.js's real formula (see its own comment on `seriesTop`/
     `seriesFloor`) is:
       seriesTop   = Math.max(...stacks, dated + Math.max(0, undated), dated, 1)
       seriesFloor = Math.min(0, ...stacks)
     The bug this file exists to catch used the LAST stack value as the top
     and a hard-coded floor of 0 — exactly what shipped. Both versions are run
     over the SAME real growthSeries() output (the pure function main uses),
     so the only thing that differs is the scale. */
  const catType = () => null; // no category carries income-type growth in this fixture
  const entries = [{
    account: { balance: 30000, starting_amount: 20000, inception_date: '2025-01-01' },
    rows: [
      { date: '2025-02-05', amount: 160000, cat: 'Transfer' },
      { date: '2025-03-10', amount: -150000, cat: 'Transfer' },
    ],
  }];
  const s = growthSeries(entries, catType, { today: '2025-04-12' });
  ok(s.points.length >= 3, `the negative-control fixture actually produces a multi-point series (got ${s.points.length})`);

  const padT = 22, padB = 28, H = 250, innerH = H - padT - padB;
  const stacks = s.points.map(p => p.capital + p.posted);

  const oldY = (() => {
    const seriesTop = stacks[stacks.length - 1];               // BUG: last point only
    const seriesFloor = 0;                                      // BUG: no Math.min(0, ...stacks)
    const span = (seriesTop - seriesFloor) * 1.08 || 1;
    return v => padT + innerH - ((v - seriesFloor) / span) * innerH;
  })();
  const newY = (() => {
    const seriesTop = Math.max(...stacks, 1);
    const seriesFloor = Math.min(0, ...stacks);
    const span = (seriesTop - seriesFloor) * 1.08 || 1;
    return v => padT + innerH - ((v - seriesFloor) / span) * innerH;
  })();

  const oldOut = stacks.filter(v => { const y = oldY(v); return y < padT - 3 || y > padT + innerH + 3; });
  const newOut = stacks.filter(v => { const y = newY(v); return y < padT - 3 || y > padT + innerH + 3; });
  ok(oldOut.length > 0, `NEGATIVE CONTROL — the old "scale to the final point" formula must map at least one `
    + `real point outside the clip rect, or this fixture proves nothing about CRITICAL 1 (got 0 of ${stacks.length} out)`);
  eq(newOut.length, 0, `the real (fixed) formula maps every point inside the clip rect `
    + `(got ${newOut.length} of ${stacks.length} out) — this is the GREEN half of the same check`);
  console.log(`  C1 negative control: old formula put ${oldOut.length}/${stacks.length} points outside `
    + `the clip rect; the real formula puts 0/${stacks.length} outside.`);

  /* ---- C2. CRITICAL 2, reproduced: lay four bands out against a hard 100
     rather than max(100, their own sum). Run over REAL periodFlow() output
     for the same deficit shape the view-level DEFICIT fixture above drives
     through the actual renderer. ---- */
  const flow = periodFlow({
    income: 10000, spentTotal: 15000, budgeted: 0,
    spendByCat: { Rent: 6000, Groceries: 9000 },
    fixedCats: new Set(['Rent']),
    catType: cat => (cat === 'Rent' ? 'housing' : 'expense'),
    savingContribution: 2000, debts: [],
  });
  const percents = [flow.bands.percents.committed, flow.bands.percents.living,
    flow.bands.percents.saving, flow.bands.percents.notYetSpent];
  const pctSum = percents.reduce((s2, v) => s2 + Math.max(0, v), 0);
  ok(pctSum > 100, `NEGATIVE CONTROL fixture — the deficit period's bands must sum past 100% of income `
    + `or this proves nothing about CRITICAL 2 (got ${pctSum}%)`);

  const PAD_T = 14, PAD_B = 14, GAP = 8, ROW_H_MIN = 3, H2 = 280;
  const innerH2 = H2 - PAD_T - PAD_B - GAP * 3;
  const layOld = span => {
    let y = PAD_T;
    return percents.map(p => {
      let h = Math.max(0, (Math.max(0, p) / span) * innerH2);
      if (h > 0 && h < ROW_H_MIN) h = ROW_H_MIN;
      const top = y, bottom = y + h;
      y = bottom + GAP;
      return { top, bottom };
    });
  };
  const oldLaid = layOld(100);                          // BUG: hard 100, matches the shipped code
  const newLaid = layOld(Math.max(100, pctSum));         // FIX: money-flow's own documented scaling

  const oldOverflow = oldLaid.filter(r => r.bottom > H2 - PAD_B + 0.5);
  const newOverflow = newLaid.filter(r => r.bottom > H2 - PAD_B + 0.5);
  ok(oldOverflow.length > 0, `NEGATIVE CONTROL — laying the deficit period's bands out against a hard 100 `
    + `must push at least one band's bottom edge past the viewBox, or this fixture proves nothing about `
    + `CRITICAL 2 (got 0 of ${oldLaid.length} overflowing, viewBox bottom ${H2 - PAD_B})`);
  eq(newOverflow.length, 0, `laid out against max(100, their own sum), no band's bottom edge exceeds `
    + `the viewBox (got ${newOverflow.length} of ${newLaid.length} overflowing)`);
  console.log(`  C2 negative control: laying bands against a hard 100 overflowed `
    + `${oldOverflow.length}/${oldLaid.length} rows past a ${H2 - PAD_B}-unit bottom edge; `
    + `laying against max(100, sum) overflowed ${newOverflow.length}/${newLaid.length}.`);

  /* ---- C3. largestRemainder's documented precondition: Σvalues ≤ target.
     This is not a bug to fix — it is the root CAUSE of CRITICAL 2's shape at
     the arithmetic layer, and src/money-flow.js now guards it explicitly
     (`rawSum <= 100 ? largestRemainder(...) : rawPercents.map(Math.round)`).
     Documented here, not "fixed": largestRemainder is used elsewhere
     (dashboard's donut, health-math's score breakdown) precisely because it
     DOES sum to target when the precondition holds, and changing its
     contract would be the wrong fix for a caller-side violation. */
  const oversum = [70, 70, 70];                       // sums to 210, target 100
  const badOut = largestRemainder(oversum, 100);
  const badSum = badOut.reduce((s2, v) => s2 + v, 0);
  ok(badSum !== 100, `NEGATIVE CONTROL — largestRemainder given Σvalues > target must NOT sum to target `
    + `(got [${badOut}] summing to ${badSum}) — this is the documented precondition violation, `
    + `not something this file may "fix"`);
  eq(badSum, oversum.reduce((s2, v) => s2 + Math.floor(v), 0),
    'given an oversum input, largestRemainder returns bare floors (its top-up loop never runs — `left` is negative)');
  /* And the real caller (money-flow.js) never actually reaches this failure
     mode — the deficit fixture above (pctSum > 100) took the OTHER branch. */
  {
    const rawSum = [
      (6000 / 10000) * 100, (9000 / 10000) * 100, (2000 / 10000) * 100, 0,
    ].reduce((s2, v) => s2 + v, 0);
    ok(rawSum > 100, 'the real deficit fixture\'s raw percent sum exceeds 100, matching the guard\'s "else" branch');
  }

  console.log(`  Section C (negative controls): ${checks} checks so far, ${fail} failed`);
}

/* ======================================================================= *
 * SECTION D — primitive-level invariants over src/chart.js directly. Pure
 * functions; bare node, no DOM (rangePills needs one, so installDom() runs
 * first for that one block only).
 * ======================================================================= */
async function runSectionD() {
  /* ---- D1. arcPath: sweeps sum to 2π, large-arc flag correct either side
     of 0.5, degenerate cases produce valid path data. ---- */
  {
    const cx = 100, cy = 100, rOut = 80, rIn = 50;
    /* Every fraction from a hairline sliver to the whole circle, both exactly
       at and either side of the 0.5 large-arc boundary. */
    for (const fractions of [
      [0.1, 0.9], [0.5, 0.5], [0.25, 0.25, 0.25, 0.25], [0.01, 0.01, 0.01, 0.97],
      [1.0], [0.001, 0.999], [0.4999, 0.5001],
    ]) {
      let a = -Math.PI / 2;
      let sweptTotal = 0;
      for (const f of fractions) {
        const sweep = f * Math.PI * 2;
        const d = arcPath(cx, cy, rOut, rIn, a, a + sweep);
        ok(!/NaN|Infinity|undefined/.test(d), `arcPath(${f}): no malformed d ("${d.slice(0, 40)}…")`);
        ok(d.trim().length > 0, `arcPath(${f}): non-empty d`);
        /* The large-arc flag (the 4th positional arg to the outer A command)
           must be 1 iff the swept angle exceeds π — exactly chart.js's own
           `end - a0 > Math.PI ? 1 : 0`, re-derived from the ACTUAL angles
           rather than re-read from the source, so a flipped `>=`/`>` in
           chart.js would still be caught. */
        const outerA = d.match(/A ([\d.]+) [\d.]+ 0 (\d) (\d) ([\d.-]+) ([\d.-]+)/);
        ok(outerA, `arcPath(${f}): outer A command is present and parses`);
        if (outerA) {
          const wantLarge = sweep > Math.PI ? '1' : '0';
          eq(outerA[2], wantLarge, `arcPath(${f}): large-arc flag matches the swept angle (${sweep.toFixed(3)} rad)`);
          eq(outerA[3], '1', `arcPath(${f}): sweep flag is always 1 (clockwise, SVG's own convention)`);
        }
        sweptTotal += sweep;
        a += sweep;
      }
      close(sweptTotal, Math.PI * 2, `arcPath: fractions [${fractions}] sweep to a full 2π total`, 0.0001);
    }
  }
  /* Degenerate slice sets: one slice at 100%, a slice at 0, all zero, a
     single point (rOut === rIn), two identical points (a0 === a1). */
  {
    const oneAt100 = arcPath(100, 100, 80, 50, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
    ok(!/NaN|Infinity/.test(oneAt100), 'arcPath: a single 100% slice produces valid path data (the 2π clamp)');
    ok(oneAt100.trim().length > 0, 'arcPath: a single 100% slice is non-empty');

    const zeroSlice = arcPath(100, 100, 80, 50, 0, 0);
    ok(!/NaN|Infinity/.test(zeroSlice), 'arcPath: a zero-width slice (a0 === a1) produces valid path data');

    const point = arcPath(100, 100, 0, 0, 0, Math.PI);
    ok(!/NaN|Infinity/.test(point), 'arcPath: rOut === rIn === 0 (a single point) produces valid path data');

    const samePoint = arcPath(100, 100, 80, 80, 0.3, 0.3);
    ok(!/NaN|Infinity/.test(samePoint), 'arcPath: rOut === rIn (a ring collapsed to a line) produces valid path data');
  }

  /* ---- D2. scales(): count<=1, count===0, min===max never divide by zero. ---- */
  {
    for (const count of [0, 1]) {
      const s = scales({ w: 1000, h: 300, count, max: 100 });
      const x0 = s.x(0);
      ok(Number.isFinite(x0), `scales({count:${count}}).x(0) is finite (got ${x0})`);
      ok(Number.isFinite(s.y(50)), `scales({count:${count}}).y(50) is finite`);
      ok(Number.isFinite(s.band(0)) && Number.isFinite(s.bandWidth),
        `scales({count:${count}}).band(0)/bandWidth are finite`);
    }
    {
      // min === max: span would be 0 without the `|| 1` fallback.
      const s = scales({ w: 1000, h: 300, count: 5, max: 50, min: 50 });
      for (let i = 0; i < 5; i++) ok(Number.isFinite(s.y(50)), `scales({min:50,max:50}).y(50) is finite at i=${i}`);
    }
  }

  /* ---- D3. distinctColors: no duplicate within SPLIT_SLICES (dashboard.js's
     own constant, currently 8 — see its own comment for why: any more and a
     phone's legend becomes a wall of text), and the documented input shapes:
     the #888 placeholder, an unparseable keyword, null/undefined, and a live
     var(--x) reference (arrives unresolved when getComputedStyle has nothing
     to say, e.g. a chart built before the stylesheet lands). ---- */
  {
    const SPLIT_SLICES = 8; // src/views/dashboard.js's own const, mirrored here — see its comment
    const { colorDistance } = require('../src/chart');
    const worst = colors => {
      const rgb = colors.map(parseColor).filter(Boolean);
      let w = Infinity;
      for (let i = 0; i < rgb.length; i++) for (let j = i + 1; j < rgb.length; j++) w = Math.min(w, colorDistance(rgb[i], rgb[j]));
      return w;
    };
    const eightIdentical = Array(SPLIT_SLICES).fill('#dc3545');
    const got = distinctColors(eightIdentical, { reserved: ['#5f6779'] });
    const uniq = new Set(got.map(c => c.toLowerCase()));
    eq(uniq.size, SPLIT_SLICES, `distinctColors: ${SPLIT_SLICES} identical wanted colours resolve to `
      + `${SPLIT_SLICES} distinct ones (got ${uniq.size})`);

    // The exact mixed-input shapes a real category list can hand distinctColors.
    const mixed = ['#888', '#888888', 'rebeccapurple', null, undefined, 'var(--color-accent)', '#3b82f6'];
    let mixedResolved = null, mixedThrew = null;
    try { mixedResolved = distinctColors(mixed, { reserved: ['#5f6779'] }); } catch (e) { mixedThrew = e; }
    ok(!mixedThrew, `distinctColors does not throw on placeholder/unparseable/null/undefined/var() inputs `
      + `together (threw: ${mixedThrew && mixedThrew.message})`);
    if (mixedResolved) {
      eq(mixedResolved.length, mixed.length, 'distinctColors: one colour out per colour in, even for the mixed set');
      ok(mixedResolved.every(c => parseColor(c)), 'every resolved colour in the mixed set actually parses');
      const mixedWorst = worst(mixedResolved);
      ok(mixedWorst >= 130, `distinctColors: the mixed-input set stays mutually distinct (worst ${mixedWorst.toFixed(0)})`);
    }

    // null and undefined specifically, alone — not just buried in a mixed list.
    const nullish = distinctColors([null, undefined, null], { reserved: ['#5f6779'] });
    eq(nullish.length, 3, 'distinctColors: null/undefined-only input still returns one colour per input');
    ok(nullish.every(c => parseColor(c)), 'distinctColors: null/undefined inputs resolve to real, parseable colours');
  }

  /* ---- D4. sharePercents sums to exactly 100 for any positive input set
     (fuzzed, distinct fixtures from donut-percentages.test.cjs's own —
     that file owns the deep coverage of this property; this is the
     chart-invariants-owned sanity check that a caller feeding it real
     `chart.js`-drawn amounts stays covered too). ---- */
  {
    const fuzzSets = [
      [1], [1, 1], [1, 1, 1], [7, 3, 3, 3, 3, 1],
      [0.1, 0.2, 0.3, 0.4], [1000000, 1, 1], [1, 2, 4, 8, 16, 32, 64, 128],
    ];
    for (const amounts of fuzzSets) {
      const out = sharePercents(amounts);
      eq(out.reduce((s2, v) => s2 + v, 0), 100, `sharePercents([${amounts}]) sums to exactly 100`);
    }
    eq(sharePercents([0, 0, 0]).reduce((s2, v) => s2 + v, 0), 0, 'sharePercents of an all-zero set is all zero, not NaN');
  }

  /* ---- D5. historicalRanges/rangeFor/rangePills: no off-by-one at the
     period boundary. 3M/6M/1Y always; 5Y only past five years of history;
     All only past one year — and the boundary itself (exactly 12, exactly
     60 months) goes the documented way. ---- */
  {
    const keysFor = span => historicalRanges(span).map(r => r.key);
    eq(keysFor(0), ['3m', '6m', '1y'], 'historicalRanges(0): the three that always show, nothing else');
    eq(keysFor(12), ['3m', '6m', '1y'], 'historicalRanges(12): exactly one year of history — no All yet (boundary)');
    eq(keysFor(13), ['3m', '6m', '1y', 'all'], 'historicalRanges(13): one month past a year earns All');
    eq(keysFor(60), ['3m', '6m', '1y', 'all'], 'historicalRanges(60): exactly five years — no 5Y yet (boundary)');
    eq(keysFor(61), ['3m', '6m', '1y', '5y', 'all'], 'historicalRanges(61): one month past five years earns 5Y too');

    ok(rangeFor('1y') && rangeFor('1y').months === 12, 'rangeFor("1y") resolves to the 12-month range');
    eq(rangeFor('not-a-real-range'), undefined, 'rangeFor of an unknown key is undefined, not a throw or a default');

    installDom();
    let picked = null;
    const wrap = rangePills({ ranges: RANGES.filter(r => r.historical), value: '6m', onPick: k => { picked = k; }, label: 'Range' });
    ok(wrap && wrap.tagName === 'DIV', 'rangePills returns a mounted element');
    const active = descend(wrap).filter(e => e.getAttribute && e.getAttribute('aria-pressed') === 'true');
    eq(active.length, 1, 'rangePills: exactly one button is aria-pressed at a time');
    ok(active[0] && active[0].textContent === '6M', 'rangePills: the pressed button is the one matching `value`');
    const btns = descend(wrap).filter(e => e.tagName === 'BUTTON');
    const threeM = btns.find(b => b.textContent === '3M');
    if (threeM) threeM.click();
    eq(picked, '3m', 'rangePills: clicking an inactive pill fires onPick with its key');
  }

  /* ---- D6. gridlines: pure geometry, never NaN/Infinity regardless of the
     row count or a degenerate scale. ---- */
  {
    installDom();
    for (const rows of [0, 1, 4, 12]) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const add = (tag, attrs = {}) => {
        const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
        svg.append(n);
        return n;
      };
      const s = scales({ w: 1000, h: 300, count: 5, max: 100 });
      gridlines(add, s, 1000, rows);
      for (const line of svg.children) {
        for (const a of ['x1', 'x2', 'y1', 'y2']) {
          ok(!/NaN|Infinity/.test(String(line.getAttribute(a))), `gridlines(rows=${rows}): ${a} is not NaN/Infinity`);
        }
      }
    }
  }

  /* ---- D7. linePath/areaPath round-trip through this file's own pathPoints
     tokenizer, proving section A's geometry reader is trustworthy before it
     is relied on above. ---- */
  {
    const pts = [[0, 10], [25.5, -3.2], [100, 0]];
    const lp = linePath(pts);
    const readBack = pathPoints(lp);
    eq(readBack.length, pts.length, 'pathPoints reads back the same number of points linePath wrote');
    for (let i = 0; i < pts.length; i++) {
      close(readBack[i][0], pts[i][0], `pathPoints: point ${i} x round-trips through linePath`);
      close(readBack[i][1], pts[i][1], `pathPoints: point ${i} y round-trips through linePath`);
    }
    const ap = areaPath(pts, 50);
    const apPts = pathPoints(ap);
    ok(apPts.length >= pts.length, 'pathPoints reads back at least the line points from an areaPath');
  }

  console.log(`\nSection D (primitives): ${checks} checks so far, ${fail} failed`);

  if (fail) {
    console.log(`\nFAIL — ${fail} of ${checks} chart-invariant checks failed.`);
    process.exit(1);
  }
  console.log(`PASS — chart and SVG invariants hold across every view, and both shipped criticals `
    + `(non-monotonic savings scaling, deficit-period sankey overflow) are pinned with negative controls `
    + `(${checks} assertions).`);
}
