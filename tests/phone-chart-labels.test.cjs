'use strict';
/* Chart axis labels at phone size (src/chart.js, axisLabels + phoneWidth).

   The charts draw into a 1000-unit viewBox scaled to ~0.35 on a 375px phone, so
   13-unit axis text was 4.5px. The phone stylesheet lifts it to PHONE_TEXT (32)
   units, and text that size takes four times the room: the eight labels an axis
   used to carry would print over one another ("Sep 2029" is ~150 units wide at
   that size, the old pitch 125). So on a phone axisLabels keeps at most five and
   never packs two closer than the widest one needs. This pins:

     1. on a DESKTOP (no window, or a wide one) the labels chosen are exactly the
        ones the pre-phone algorithm chose, for every series length — the phone
        change must not move a desktop chart;
     2. on a phone, for every length and for short and long label text, the first
        and last labels are always drawn, at most five are, and no two overprint
        (extents estimated at PHONE_TEXT x 0.58 per character, anchored the way
        axisLabels anchors them);
     3. a window without matchMedia (an embedded webview) falls back to desktop.

     node tests/phone-chart-labels.test.cjs */
const assert = require('assert');
const { stubObsidian } = require('./helpers/harness.cjs');
stubObsidian();
const { axisLabels, scales, PHONE_TEXT, PHONE_TEXT_WIDE, phoneWidth, phoneLayout } = require('../src/chart');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const W = 1000;
function draw(labels, opts) {
  const s = scales({ w: W, h: 300, count: labels.length, max: 10 });
  const out = [];
  const add = (tag, attrs) => { const n = { attrs }; out.push(n); return n; };
  axisLabels(add, s, labels, 300, opts);
  return out.map(n => ({ x: n.attrs.x, anchor: n.attrs['text-anchor'] }));
}
/* The algorithm as it stood before the phone branch — the desktop oracle. */
function legacy(labels, { maxLabels = 8, band = false } = {}) {
  const s = scales({ w: W, h: 300, count: labels.length, max: 10 });
  const n = labels.length, stride = Math.max(1, Math.ceil(n / maxLabels)), out = [];
  labels.forEach((text, i) => {
    const last = i === n - 1;
    if (!last && (i % stride !== 0 || n - 1 - i < stride / 2)) return;
    out.push({ x: band ? s.band(i) : s.x(i), anchor: i === 0 && !band ? 'start' : last && !band ? 'end' : 'middle' });
  });
  return out;
}
const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i));

/* ---- 1. desktop is unchanged ---- */
delete global.window;
for (const band of [false, true]) for (const n of [1, 2, 3, 7, 8, 9, 12, 24, 30, 52, 61]) {
  const labels = mk(n, i => `Sep ${2026 + i}`);
  eq(draw(labels, { band }), legacy(labels, { band }), `desktop, n=${n}, band=${band}: the pre-phone selection`);
}
global.window = { matchMedia: q => ({ matches: q === '(min-width: 1px)' }) };
eq(draw(mk(30, i => `L${i}`)), legacy(mk(30, i => `L${i}`)), 'a window that is not a phone draws the desktop labels');

/* ---- 3. no matchMedia ---- */
global.window = {};
eq(draw(mk(30, i => `L${i}`)), legacy(mk(30, i => `L${i}`)), 'a window without matchMedia falls back to the desktop labels');

/* ---- 2. phone ---- */
global.window = { matchMedia: q => ({ matches: q === '(max-width: 600px)' }) };
let worst = Infinity;
for (const [name, f] of [['short', i => `${i + 1}`], ['month', i => `Sep ${26 + (i % 40)}`], ['long', i => `Sep ${2026 + i}`]]) {
  for (const band of [false, true]) for (let n = 2; n <= 60; n++) {
    const labels = mk(n, f);
    const out = draw(labels, { band });
    const tag = `phone ${name} n=${n} band=${band}`;
    ok(out.length <= 5, `${tag}: at most five labels (got ${out.length})`);
    ok(out.length >= 2, `${tag}: the first and last are both drawn`);
    // extents
    const widest = Math.max(...labels.map(l => l.length)) * PHONE_TEXT * 0.58;
    const ext = out.map(o => o.anchor === 'start' ? [o.x, o.x + widest] : o.anchor === 'end' ? [o.x - widest, o.x] : [o.x - widest / 2, o.x + widest / 2]);
    for (let i = 1; i < ext.length; i++) {
      const gap = ext[i][0] - ext[i - 1][1];
      worst = Math.min(worst, gap);
      ok(gap >= 0, `${tag}: labels ${i} and ${i + 1} overprint by ${(-gap).toFixed(0)} units`);
    }
  }
}
ok(Number.isFinite(worst), `sanity: ${checks} label sets checked, tightest gap ${worst.toFixed(0)} units`);

/* ---- 4. phoneLayout(): a phone held sideways (landscape phone charts) -------
   Obsidian puts .is-phone on <body> in either orientation, but a landscape
   iPhone is 667px+, so (max-width: 600px) is false there. The Savings charts
   draw their roomier geometry when EITHER is true, so a phone can be turned
   after the chart was drawn without the text outgrowing its space. */
{
  const body = cls => ({ classList: { contains: c => cls.includes(c) } });
  const win = narrow => ({ matchMedia: q => ({ matches: narrow && q === '(max-width: 600px)' }) });
  const saved = global.document;
  delete global.window; delete global.document;
  ok(phoneLayout() === false, 'no window and no document (bare node): not a phone');
  global.window = win(false); global.document = { body: body([]) };
  ok(phoneWidth() === false && phoneLayout() === false, 'a wide window with no .is-phone is a desktop: the desktop geometry');
  global.window = win(false); global.document = { body: body(['is-mobile']) };
  ok(phoneLayout() === false, 'a tablet (.is-mobile without .is-phone) keeps the desktop geometry');
  global.window = win(false); global.document = { body: body(['is-mobile', 'is-phone', 'is-ios']) };
  ok(phoneWidth() === false, 'a landscape phone is wider than 600px, so phoneWidth() stays false (the axis thinning is unchanged)');
  ok(phoneLayout() === true, 'but phoneLayout() is true for it: .is-phone on <body>');
  global.window = win(true); global.document = { body: body([]) };
  ok(phoneLayout() === true, 'a narrow window is a phone even before Obsidian has set .is-phone');
  global.window = win(false); global.document = { body: null };
  ok(phoneLayout() === false, 'a document with no <body> yet does not throw');
  global.document = { get body() { throw new Error('boom'); } };
  ok(phoneLayout() === false, 'a throwing document falls back to the desktop geometry');
  ok(PHONE_TEXT_WIDE * 0.6 >= 11 && PHONE_TEXT_WIDE < PHONE_TEXT, `${PHONE_TEXT_WIDE} units is >= 11px at the landscape 0.6 scale and smaller than the portrait ${PHONE_TEXT}`);
  delete global.window; if (saved) global.document = saved; else delete global.document;
}

delete global.window;
console.log(`PASS phone-chart-labels (${checks} checks, tightest phone gap ${worst.toFixed(0)} units)`);
