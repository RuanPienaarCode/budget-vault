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
   entrance every time a file was written would be noise. A re-render that
   lands MID-entrance carries the entrance over to the new nodes (see
   `runs`). replay() forgets both, so arriving on the Dashboard plays it from
   zero again.

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
  /* Entrances in flight, by key: when each began and when it is over. The
     view rebuilds every node on each render, and a render can land in the
     middle of an entrance — a save, a vault change, the phone syncing, the
     reload Obsidian's own start-up sets off. The new node picks the entrance
     up where the old one was: never a snap to the end (the figure jumping,
     a bar popping full, the motes vanishing), never a start over. */
  const runs = new Map();
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
  function inFlight(id, now) {
    const run = runs.get(id);
    return run && now < run.end ? run : null;
  }

  function later(fn, ms = 0) { win.setTimeout(() => { try { fn(); } catch (e) { /* decoration only */ } }, ms); }
  /* A keyframe joined `skip` ms in: a negative delay starts it part-way. */
  const delayBy = skip => (skip > 0 ? `-${Math.round(skip)}ms` : '');

  /* Add `cls` to `el` for GLOW_MS, `delay` ms from now. With a `key`, a
     second call while that one is still running (the same tile, rebuilt)
     joins it part-way instead of starting it again. */
  function flash(el, tone, { cls = 'bud-shine', delay = 0, key } = {}) {
    if (!el || !el.classList || !TONES.includes(tone)) return;
    const now = clock();
    const id = key === undefined ? null : `${cls}:${key}`;
    let run = id && inFlight(id, now);
    if (!run) {
      run = { start: now + delay, end: now + delay + GLOW_MS };
      if (id) runs.set(id, run);
    }
    const on = () => {
      const skip = clock() - run.start;
      if (skip >= GLOW_MS) return;
      /* The tone only says WHETHER a figure has a verdict to shine; the
         colour is the figure's own (styles.css .bud-shine sweeps light
         across it). */
      el.classList.remove(cls);
      void el.offsetWidth;     // restart the keyframe if it is still running
      if (el.style) el.style.animationDelay = delayBy(skip);
      el.classList.add(cls);
      later(() => { el.classList.remove(cls); if (el.style) el.style.animationDelay = ''; }, GLOW_MS - skip);
    };
    const wait = run.start - now;
    if (wait > 0) later(() => { if (el.isConnected) on(); }, wait);
    else on();
  }

  /* Count `el`'s figure up from what it last showed (0 on first sight), then
     shine. `glowEl` is what shines — the figure itself by default. Returns the
     count's duration when it plays, 0 when it does not.

     The figure is rewound HERE, in the render's own task, so the page never
     paints the final figure for a frame and then drops it to the start — the
     flash a deferred rewind made. The first tick checks the clock, so a node
     appended after this call (the hero is counted, then attached) just
     counts once it is on the page. */
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
    const now = clock();
    const id = `count:${key}`;
    const was = inFlight(id, now);
    let run;
    if (was) {
      /* Rebuilt mid-entrance. The same figure carries on along the same
         clock; a new one counts on from whatever is on screen now. */
      shown.set(key, f.value);
      if (!live()) return 0;
      run = was.to === f.value ? was : { from: valueAt(was, now), to: f.value, start: now, ms };
    } else {
      const prev = shown.has(key) ? shown.get(key) : (from === undefined ? 0 : from);
      if (!changed(key, f.value) || !live() || prev === f.value) return 0;
      run = { from: prev, to: f.value, start: now, ms };
    }
    run.end = run.start + run.ms + GLOW_MS;
    runs.set(id, run);
    const land = () => {
      node.nodeValue = finalText;
      if (el.isConnected) flash(glowEl || el, tone, { key });
    };
    if (now - run.start >= run.ms) { land(); return run.ms; }
    node.nodeValue = printLike(f, valueAt(run, now));
    let seen = el.isConnected;
    const timer = win.setInterval(() => {
      const t = clock();
      if (!el.isConnected) {
        /* Taken off the page (a re-render; its successor carries on), or
           never put on it in time: leave the rendered text and stop. */
        if (seen || t - run.start >= run.ms) { win.clearInterval(timer); node.nodeValue = finalText; }
        return;
      }
      seen = true;
      if (t - run.start >= run.ms) { win.clearInterval(timer); land(); return; }
      node.nodeValue = printLike(f, valueAt(run, t));
    }, 16);
    return run.ms;
  }
  function valueAt(run, t) {
    const p = Math.min(1, Math.max(0, (t - run.start) / run.ms));
    return run.from + (run.to - run.from) * (1 - Math.pow(1 - p, 3));
  }

  /* A few motes floating slowly up through `host` after `delay` ms, clipped
     to its box — a settling, not a celebration. `host` must be positioned;
     the layer is taken down once both passes of the slowest mote are over.
     With a `key`, a rebuilt host gets the same motes, mid-float. */
  function float(host, { pieces = 10, delay = 0, key } = {}) {
    if (!host || !live() || typeof document === 'undefined') return;
    const motes = [];
    let longest = 0;
    for (let i = 0; i < pieces; i++) {
      const dur = 2600 + ((i * 7) % 5) * 300;
      const wait = ((i * 3) % pieces) * 140;
      longest = Math.max(longest, wait + dur * 2);
      motes.push({ i, dur, wait });
    }
    const now = clock();
    const id = key === undefined ? null : `float:${key}`;
    let run = id && inFlight(id, now);
    if (!run) {
      run = { start: now + delay, end: now + delay + longest };
      if (id) runs.set(id, run);
    }
    const mount = () => {
      if (!host.isConnected) return;
      const skip = Math.max(0, clock() - run.start);
      const layer = document.createElement('div');
      layer.className = 'bud-float';
      layer.setAttribute('aria-hidden', 'true');
      for (const { i, dur, wait } of motes) {
        const mote = document.createElement('i');
        mote.className = 'bud-mote';
        mote.style.cssText = `left:${(8 + ((i * 37) % 84)).toFixed(0)}%;bottom:${(4 + ((i * 23) % 40)).toFixed(0)}%;`
          + `--bud-size:${2 + (i % 3)}px;--bud-rise:${30 + ((i * 11) % 5) * 10}px;`
          + `--bud-sway:${(((i % 5) - 2) * 6)}px;--bud-dur:${dur}ms;animation-delay:${Math.round(wait - skip)}ms`;
        layer.append(mote);
      }
      host.insertBefore(layer, host.firstChild);
      later(() => layer.remove(), longest - skip + 200);
    };
    const wait = run.start - now;
    if (wait > 0) later(mount, wait);
    else if (now < run.end) mount();
  }

  /* Grow `bar`'s segments in (CSS: .bud-bar-in), then spark at each `stops`
     percentage along it, in `tones` order, at `times` ms (when that segment's
     keyframe ends). Plays only when `value` changed; a rebuilt bar mid-growth
     carries on from where the old one was (CSS reads --bud-skip). */
  function bar(barEl, { key, value, stops = [], tones = [], times = [], growMs = 700 } = {}) {
    if (!barEl) return;
    const now = clock();
    const id = `bar:${key}`;
    let run = inFlight(id, now);
    if (run && run.value === value) {
      if (!live() || typeof document === 'undefined') return;
    } else {
      if (!changed(key, value) || !live() || typeof document === 'undefined') return;
      run = { start: now, end: now + growMs * 2 + 600, value };
      runs.set(id, run);
    }
    const skip = now - run.start;
    if (barEl.style && skip > 0) barEl.style.setProperty('--bud-skip', `${Math.round(skip)}ms`);
    barEl.classList.add('bud-bar-in');
    later(() => {
      if (!barEl.isConnected) return;
      const parent = barEl.offsetParent;
      if (!parent) return;
      stops.forEach((pct, n) => {
        const at = (times[n] === undefined ? growMs : times[n]) - skip;
        if (!(pct > 0) || at < 0) return;   // that spark already flew, over the old bar
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
        later(() => { if (barEl.isConnected) parent.append(layer); later(() => layer.remove(), SPARK_MS); }, at);
      });
    });
    later(() => {
      barEl.classList.remove('bud-bar-in');
      if (barEl.style) barEl.style.removeProperty('--bud-skip');
    }, run.end - now);
  }

  return { count, float, bar, flash, replay: () => { shown.clear(); runs.clear(); }, live };
}

module.exports = { createDashMotion, parseFigure, printLike };
