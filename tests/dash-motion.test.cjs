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
        count lands, and the glow comes off after.

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
  return {
    node, isConnected: true, childNodes: [node], offsetWidth: 0,
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c) },
    has: c => cls.has(c),
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
  eq(el.node.nodeValue, '12 345,67', 'text is untouched until the deferred start');
  win.run(0);
  eq(el.node.nodeValue, '0,00', 'rewound to the start');
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
  eq(gone.node.nodeValue, '62', 'a node detached before the start is left alone');
  eq(live.pending(), 0, 'and starts nothing');

  const bare = createDashMotion({ win: null });
  const el2 = fig('62');
  eq(bare.count(el2, { key: 's' }), 0, 'bare node: no-op');
  eq(el2.node.nodeValue, '62', 'bare node: text untouched');
  eq(bare.count(null, { key: 'x' }), 0, 'no element: no-op');
  eq(bare.count(fig('—'), { key: 'x' }), 0, 'no figure: no-op');
}

console.log(`dash-motion.test.cjs — ${checks} checks OK`);
