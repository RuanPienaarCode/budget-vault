'use strict';
/* The Dashboard's arrival motion: figures count up to what they say, then
   shine — a band of light sweeps across them in their own colour; a few
   motes float up through the score tile as it lands; the bars grow in and
   spark, in their own colours, at the end of each segment.

   DECORATION OVER A FINISHED PAGE. Every view renders its final text first,
   synchronously, exactly as before — the reconciliation script, the guard
   tests and a screen reader all read the real figure. Motion is scheduled
   after, rewinds the text node to its start, counts back to the same string
   and stops on it. If anything here is skipped or throws, the page is
   already right.

   ONE TIMER PER FIGURE, ALL ELSE CSS. The count needs a per-tick text write,
   so it runs on a short interval keyed off the clock rather than
   requestAnimationFrame: rAF is starved while a pane is hidden and would
   freeze a half-counted figure (see confetti() in views/score.js). A
   throttled interval just lands late — the first tick past the duration
   writes the final string. The shine, particles and bar growth are keyframes
   in src/styles.css.

   ONLY WHEN SOMETHING MOVED. A figure counts from the value it showed last
   time, and does nothing when that value is unchanged — the dashboard
   re-renders on every save and vault change, and a page that replayed its
   entrance every time a file was written would be noise. replay() forgets,
   so arriving on the Dashboard plays it from zero again.

   Particles are placed by index, not at random, so the same figure lands the
   same way twice. Nothing under reduced motion, nothing outside a live
   document. Pure DOM, no obsidian import; tests/dash-motion.test.cjs pins
   the text rewriting. */

const COUNT_MS = 900;
const GLOW_MS = 1400;
const SPARK_MS = 1300;
const TONES = ['good', 'fair', 'poor', 'calm'];

/* The one number inside a printed figure, with the separators it was printed
   in. "R 12 345,67" → prefix "R ", value 12345.67, group " ", 2 decimals.
   `decimal` is the locale's decimal mark — the only way to tell "2,015"
   (two thousand and fifteen) from "3,9" (three point nine). */
function parseFigure(text, decimal) {
  const m = /\d(?:[\d\s  .,'’]*\d)?/.exec(String(text || ''));
  if (!m) return null;
  const body = m[0];
  let intPart = body;
  let decimals = 0;
  const at = body.lastIndexOf(decimal);
  if (at > 0 && /^\d{1,2}$/.test(body.slice(at + 1))) {
    intPart = body.slice(0, at);
    decimals = body.length - at - 1;
  }
  const group = (/\D/.exec(intPart) || [''])[0];
  const digits = intPart.replace(/\D/g, '') + (decimals ? '.' + body.slice(at + 1) : '');
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return {
    prefix: text.slice(0, m.index), suffix: text.slice(m.index + body.length),
    value, decimals, group, decimal,
  };
}

/* `v` printed in the shape `f` was parsed from. Grouped in threes, which is
   the only grouping money() produces. */
function printLike(f, v) {
  const fixed = Math.abs(v).toFixed(f.decimals);
  const [i, d] = fixed.split('.');
  const grouped = f.group ? i.replace(/\B(?=(\d{3})+(?!\d))/g, f.group) : i;
  return f.prefix + grouped + (d ? f.decimal + d : '') + f.suffix;
}

function firstNumberText(node) {
  if (!node) return null;
  if (node.nodeType === 3) return /\d/.test(node.nodeValue) ? node : null;
  for (const kid of Array.from(node.childNodes || [])) {
    const hit = firstNumberText(kid);
    if (hit) return hit;
  }
  return null;
}

function createDashMotion({ decimal = '.', group = ' ', win = (typeof window !== 'undefined' ? window : null) } = {}) {
  const shown = new Map();     // key → the value that figure showed last
  const clock = () => (win && win.performance && typeof win.performance.now === 'function' ? win.performance.now() : Date.now());

  /* Asked live: a reader who turns reduced motion on mid-session means now. */
  function live() {
    if (!win || typeof win.setTimeout !== 'function' || typeof win.matchMedia !== 'function') return false;
    return !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  /* Functions or values: the household can change its number format while
     the page is open, so the view passes getters. */
  const dec = () => (typeof decimal === 'function' ? decimal() : decimal);
  const grp = () => (typeof group === 'function' ? group() : group);

  /* True when `key` should play: first sight, or a different value. Records
     the new value either way, so a skipped play is not replayed later. */
  function changed(key, value) {
    const had = shown.has(key);
    const was = shown.get(key);
    shown.set(key, value);
    return !had || was !== value;
  }

  function later(fn, ms = 0) { win.setTimeout(() => { try { fn(); } catch (e) { /* decoration only */ } }, ms); }

  function flash(el, tone, cls = 'bud-shine', delay = 0) {
    if (!el || !el.classList || !TONES.includes(tone)) return;
    if (delay) { later(() => { if (el.isConnected) flash(el, tone, cls); }, delay); return; }
    /* The tone only says WHETHER a figure has a verdict to shine; the colour
       is the figure's own (styles.css .bud-shine sweeps light across it). */
    el.classList.remove(cls);
    void el.offsetWidth;       // restart the keyframe if it is still running
    el.classList.add(cls);
    later(() => el.classList.remove(cls), GLOW_MS);
  }

  /* Count `el`'s figure up from what it last showed (0 on first sight), then
     shine. `glowEl` is what shines — the figure itself by default. Returns the
     count's duration when it plays, 0 when it does not. */
  function count(el, { key, tone, glowEl, ms = COUNT_MS, from } = {}) {
    if (!el) return 0;
    const node = firstNumberText(el);
    if (!node) return 0;
    const finalText = node.nodeValue;
    const f = parseFigure(finalText, dec());
    if (!f) return 0;
    /* A final figure under a thousand printed no separator to copy, but the
       count may start above one (a period change from R 12 000 to R 950). */
    if (!f.group) f.group = grp();
    const prev = shown.has(key) ? shown.get(key) : (from === undefined ? 0 : from);
    if (!changed(key, f.value) || !live() || prev === f.value) return 0;
    later(() => {
      if (!el.isConnected) return;
      const start = clock();
      node.nodeValue = printLike(f, prev);
      const timer = win.setInterval(() => {
        const p = Math.min(1, (clock() - start) / ms);
        if (!el.isConnected || p >= 1) {
          win.clearInterval(timer);
          node.nodeValue = finalText;
          if (el.isConnected) flash(glowEl || el, tone);
          return;
        }
        const e = 1 - Math.pow(1 - p, 3);
        node.nodeValue = printLike(f, prev + (f.value - prev) * e);
      }, 16);
    });
    return ms;
  }

  /* A few motes floating slowly up through `host` after `delay` ms, clipped
     to its box — a settling, not a celebration. `host` must be positioned;
     the layer is taken down once both passes of the slowest mote are over. */
  function float(host, { pieces = 10, delay = 0 } = {}) {
    if (!host || !live() || typeof document === 'undefined') return;
    later(() => {
      if (!host.isConnected) return;
      const layer = document.createElement('div');
      layer.className = 'bud-float';
      layer.setAttribute('aria-hidden', 'true');
      let longest = 0;
      for (let i = 0; i < pieces; i++) {
        const dur = 2600 + ((i * 7) % 5) * 300;
        const wait = ((i * 3) % pieces) * 140;
        longest = Math.max(longest, wait + dur * 2);
        const mote = document.createElement('i');
        mote.className = 'bud-mote';
        mote.style.cssText = `left:${(8 + ((i * 37) % 84)).toFixed(0)}%;bottom:${(4 + ((i * 23) % 40)).toFixed(0)}%;`
          + `--bud-size:${2 + (i % 3)}px;--bud-rise:${30 + ((i * 11) % 5) * 10}px;`
          + `--bud-sway:${(((i % 5) - 2) * 6)}px;--bud-dur:${dur}ms;animation-delay:${wait}ms`;
        layer.append(mote);
      }
      host.insertBefore(layer, host.firstChild);
      later(() => layer.remove(), longest + 200);
    }, delay);
  }

  /* Grow `bar`'s segments in (CSS: .bud-bar-in), then spark at each `stops`
     percentage along it, in `tones` order, at `times` ms (when that segment's
     keyframe ends). Plays only when `value` changed. */
  function bar(barEl, { key, value, stops = [], tones = [], times = [], growMs = 700 } = {}) {
    if (!barEl || !changed(key, value) || !live() || typeof document === 'undefined') return;
    barEl.classList.add('bud-bar-in');
    later(() => {
      if (!barEl.isConnected) return;
      const parent = barEl.offsetParent;
      if (!parent) return;
      stops.forEach((pct, n) => {
        if (!(pct > 0)) return;
        const layer = document.createElement('div');
        layer.className = `bud-sparks bud-sparks--bar bud-sparks--${tones[n] || 'good'}`;
        layer.setAttribute('aria-hidden', 'true');
        layer.style.left = `${(barEl.offsetLeft + barEl.offsetWidth * Math.min(100, pct) / 100).toFixed(1)}px`;
        layer.style.top = `${(barEl.offsetTop + barEl.offsetHeight / 2).toFixed(1)}px`;
        for (let i = 0; i < 12; i++) {
          const a = -Math.PI / 2 + ((i - 5.5) / 5.5) * 1.25;
          const r = 22 + (i % 3) * 12;
          const bit = document.createElement('i');
          bit.className = 'bud-spark';
          bit.style.cssText = `--bud-dx:${(Math.cos(a) * r).toFixed(1)}px;--bud-dy:${(Math.sin(a) * r).toFixed(1)}px;`
            + `--bud-size:${4 + (i % 2) * 2}px;animation-delay:${(i % 3) * 30}ms`;
          layer.append(bit);
        }
        later(() => { if (barEl.isConnected) parent.append(layer); later(() => layer.remove(), SPARK_MS); },
          times[n] === undefined ? growMs : times[n]);
      });
      later(() => barEl.classList.remove('bud-bar-in'), growMs * 2 + 600);
    });
  }

  return { count, float, bar, flash, replay: () => shown.clear(), live };
}

module.exports = { createDashMotion, parseFigure, printLike };
