'use strict';
/* The Dashboard's arrival motion (src/dash-motion.js).

   The glow, the particles and the bar growth are CSS keyframes and are not
   pinned here. What is pinned is the part that rewrites real figures:

     1. a printed figure is read back in its own separators — the locale's
        decimal mark decides "2,015" from "3,9" — and reprinted in them;
     2. a count lands on EXACTLY the text the view rendered, never past it,
        and climbs without stepping back;
     3. it plays only when the figure changed, and replay() plays it again;
     4. reduced motion, a detached node or bare node mean no timer and the
        rendered text untouched;
     5. a figure with a verdict glows (in its own colour, set in CSS) when the
        count lands, and the glow comes off after;
     6. the figure is rewound BEFORE the first paint — never the final figure
        for a frame, then zero, then the count (the flicker of 23 Oct 2026);
     7. a re-render mid-entrance (a save, a vault change, the phone syncing)
        picks the entrance up on the new nodes where the old ones were —
        never a snap to the end, never a start over.

     node tests/dash-motion.test.cjs */
const assert = require('assert');
const { createDashMotion, parseFigure, printLike } = require('../src/dash-motion');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ------------------------------ fake world ------------------------------ */
function fakeWin({ reduce = false } = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map();      // id → { at, fn, every }
  const win = {
    performance: { now: () => now },
    matchMedia: () => ({ matches: reduce }),
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: id => timers.delete(id),
    pending: () => timers.size,
    /* Advance the clock to `to`, firing every timer due on the way, in order. */
    run(to) {
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= to && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = to;
    },
  };
  return win;
}
function fig(text) {
  const node = { nodeType: 3, nodeValue: text };
  const cls = new Set();
  const props = {};
  return {
    node, isConnected: true, childNodes: [node], offsetWidth: 0,
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c) },
    style: { animationDelay: '', setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } },
    has: c => cls.has(c),
    prop: k => props[k],
  };
}

/* ---------------------- 1. reading a printed figure ---------------------- */
{
  const f = parseFigure('R 12 345,67', ',');
  eq([f.prefix, f.value, f.group, f.decimals, f.suffix], ['R ', 12345.67, ' ', 2, ''], 'ZA money');
  eq(printLike(f, 950.5), 'R 950,50', 'reprinted small, in the same marks');
  eq(printLike(f, 12345.67), 'R 12 345,67', 'reprinted at the end, identical');
  eq(parseFigure('3,9', ',').value, 3.9, 'a decimal comma in a comma locale');
  eq(parseFigure('2,015', '.').value, 2015, 'a thousands comma in a full-stop locale');
  eq(printLike(parseFigure('¥ 2,015', '.'), 2015), '¥ 2,015', 'grouping kept');
  eq(printLike(parseFigure('4%', '.'), 3.6), '4%', 'whole figures round to whole');
  eq(parseFigure('62', '.').value, 62, 'a bare score');
  eq(parseFigure('—', '.'), null, 'a dash is not a figure');
  eq(printLike(parseFigure('R 12 000', ','), 1234567), 'R 1 234 567', 'groups in threes past the final size');
}

/* ------------------------- 2. a count lands true ------------------------- */
{
  const win = fakeWin();
  const m = createDashMotion({ decimal: ',', group: ' ', win });
  const el = fig('12 345,67');
  const ms = m.count(el, { key: 'hero', tone: 'good' });
  eq(ms, 900, 'returns its duration when it plays');
  eq(el.node.nodeValue, '0,00', 'rewound to the start before anything can paint');
  let last = 0;
  for (let t = 16; t <= 960; t += 16) {
    win.run(t);
    const v = parseFigure(el.node.nodeValue, ',').value;
    ok(v >= last && v <= 12345.67, `climbs, never past the figure (t=${t}: ${el.node.nodeValue})`);
    last = v;
  }
  eq(el.node.nodeValue, '12 345,67', 'lands on exactly the rendered text');
  eq(win.pending() > 0, true, 'only the glow timer is left');
  ok(el.has('bud-shine'), 'glows when it lands');
  win.run(5000);
  ok(!el.has('bud-shine'), 'and the glow comes off');
  eq(win.pending(), 0, 'no timer outlives the count');

  /* 3. the same figure again does nothing; a new figure counts from the old */
  const again = fig('12 345,67');
  eq(m.count(again, { key: 'hero', tone: 'good' }), 0, 'an unchanged figure does not replay');
  win.run(6000);
  eq(again.node.nodeValue, '12 345,67', 'and is left as rendered');
  const moved = fig('20 000,00');
  m.count(moved, { key: 'hero' });
  win.run(6000);
  eq(moved.node.nodeValue, '12 345,67', 'a changed figure counts from what was shown');
  win.run(7000);
  eq(moved.node.nodeValue, '20 000,00', 'to the new one');
  ok(!moved.has('bud-shine'), 'no tone, no glow');
  m.replay();
  const back = fig('20 000,00');
  eq(m.count(back, { key: 'hero' }), 900, 'replay() plays an unchanged figure again');
}

/* ---------------------- 4. nothing nobody can see ----------------------- */
{
  const win = fakeWin({ reduce: true });
  const m = createDashMotion({ win });
  const el = fig('62');
  eq(m.count(el, { key: 's', tone: 'fair' }), 0, 'reduced motion: no count');
  eq(win.pending(), 0, 'reduced motion: no timer');
  eq(el.node.nodeValue, '62', 'reduced motion: text untouched');

  const live = fakeWin();
  const m2 = createDashMotion({ win: live });
  const gone = fig('62');
  m2.count(gone, { key: 's' });
  gone.isConnected = false;
  live.run(2000);
  eq(gone.node.nodeValue, '62', 'a node detached mid-count is put back as rendered');
  eq(live.pending(), 0, 'and keeps no timer');

  const bare = createDashMotion({ win: null });
  const el2 = fig('62');
  eq(bare.count(el2, { key: 's' }), 0, 'bare node: no-op');
  eq(el2.node.nodeValue, '62', 'bare node: text untouched');
  eq(bare.count(null, { key: 'x' }), 0, 'no element: no-op');
  eq(bare.count(fig('—'), { key: 'x' }), 0, 'no figure: no-op');
}

/* ----------- 6. built before it is attached: wait, never snap ----------- */
{
  const win = fakeWin();
  const m = createDashMotion({ win });
  const el = fig('100');
  el.isConnected = false;                 // the hero is counted, then appended
  m.count(el, { key: 'hero' });
  win.run(160);
  ok(el.node.nodeValue !== '100', `still counting while detached (${el.node.nodeValue})`);
  el.isConnected = true;
  win.run(400);
  const v = Number(el.node.nodeValue);
  ok(v > 0 && v < 100, `climbs once attached (${v})`);
  win.run(1000);
  eq(el.node.nodeValue, '100', 'and lands');
}

/* ------------- 7. a re-render mid-entrance carries it over -------------- */
{
  const win = fakeWin();
  const m = createDashMotion({ win });
  const old = fig('1 000');
  m.count(old, { key: 'hero', tone: 'good' });
  win.run(450);
  const mid = Number(old.node.nodeValue.replace(/\D/g, ''));
  ok(mid > 0 && mid < 1000, `mid-count (${mid})`);
  /* The view rebuilds: the old node is gone, a new one holds the final text. */
  old.isConnected = false;
  const fresh = fig('1 000');
  eq(m.count(fresh, { key: 'hero', tone: 'good' }), 900, 'the new node plays on');
  const picked = Number(fresh.node.nodeValue.replace(/\D/g, ''));
  ok(picked >= mid && picked - mid < 20, `from where the old one was on the same clock, not zero, not the end (${mid} → ${picked})`);
  win.run(700);
  const on = Number(fresh.node.nodeValue.replace(/\D/g, ''));
  ok(on > 950 && on < 1000, `still on the same clock — not restarted, not finished (${on})`);
  win.run(920);
  eq(fresh.node.nodeValue, '1 000', 'lands when the first one would have');
  ok(fresh.has('bud-shine'), 'and shines');
  eq(old.node.nodeValue, '1 000', 'the old node is left as rendered');
  ok(!old.has('bud-shine'), 'and never shines');

  /* A rebuild during the shine: the new node shines on, part-way through. */
  win.run(1100);
  fresh.isConnected = false;
  const late = fig('1 000');
  m.count(late, { key: 'hero', tone: 'good' });
  eq(late.node.nodeValue, '1 000', 'already landed');
  ok(late.has('bud-shine'), 'shining at once, not a bare frame first');
  ok(/^-\d+ms$/.test(late.style.animationDelay) && parseInt(late.style.animationDelay, 10) <= -150,
    `the sweep resumes part-way (${late.style.animationDelay})`);
  win.run(5000);
  ok(!late.has('bud-shine'), 'and comes off');
  eq(late.style.animationDelay, '', 'with its delay');
  eq(m.count(fig('1 000'), { key: 'hero', tone: 'good' }), 0, 'once over, an unchanged figure is still');

  /* A rebuild mid-count with a NEW figure counts on from what is showing. */
  m.replay();
  const a = fig('1 000');
  m.count(a, { key: 'x' });
  win.run(5450);
  const at = Number(a.node.nodeValue.replace(/\D/g, ''));
  a.isConnected = false;
  const b = fig('2 000');
  m.count(b, { key: 'x' });
  const from = Number(b.node.nodeValue.replace(/\D/g, ''));
  ok(from >= at && from - at < 20, `retargets from the figure on screen (${at} → ${from})`);
  win.run(7000);
  eq(b.node.nodeValue, '2 000', 'to the new one');
}

/* ------------- 8. the ring and the bars carry over the same way ---------- */
{
  const win = fakeWin();
  const m = createDashMotion({ win });
  const t1 = fig('');
  m.flash(t1, 'good', { cls: 'bud-ring', delay: 900, key: 'score' });
  ok(!t1.has('bud-ring'), 'waits its delay');
  win.run(1000);
  ok(t1.has('bud-ring'), 'rings');
  t1.isConnected = false;
  const t2 = fig('');
  m.flash(t2, 'good', { cls: 'bud-ring', delay: 900, key: 'score' });
  ok(t2.has('bud-ring'), 'a rebuilt tile rings at once');
  eq(t2.style.animationDelay, '-100ms', 'part-way in');
  win.run(3000);
  ok(!t2.has('bud-ring'), 'and stops');

  global.document = { createElement: () => ({ setAttribute() {}, append() {}, style: {} }) };
  try {
    const b1 = fig('');
    m.bar(b1, { key: 'bar', value: 40 });
    ok(b1.has('bud-bar-in'), 'a bar grows');
    eq(b1.prop('--bud-skip'), undefined, 'from the start');
    win.run(3300);
    b1.isConnected = false;
    const b2 = fig('');
    m.bar(b2, { key: 'bar', value: 40 });
    ok(b2.has('bud-bar-in'), 'a rebuilt bar keeps growing');
    eq(b2.prop('--bud-skip'), '300ms', 'from where the old one was');
    win.run(6000);
    ok(!b2.has('bud-bar-in'), 'and settles');
    eq(b2.prop('--bud-skip'), undefined, 'clean');
    const b3 = fig('');
    m.bar(b3, { key: 'bar', value: 40 });
    ok(!b3.has('bud-bar-in'), 'an unchanged bar after the entrance stays still');
  } finally { delete global.document; }
}

console.log(`dash-motion.test.cjs — ${checks} checks OK`);
