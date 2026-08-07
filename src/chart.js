'use strict';
/* Shared inline-SVG chart primitives.

   Hand-rolled rather than library-backed on purpose. The plugin ships as one
   bundled main.js with no node_modules and no package.json; a charting library
   would be several times the size of everything else here combined, on a phone,
   to draw four static charts. Everything below is plain SVG through
   createElementNS, which has nothing to fear from the iOS 15 WebKit floor.

   Two things every chart MUST get right — and the reason this file exists
   rather than a second private copy of the trend chart's helpers:

     1. Colours are read from the live CSS custom properties at render time,
        never baked in. The palette is theme-switched, so a hard-coded hex
        renders invisible in one of the two themes.
     2. A bare <svg> is nothing to a screen reader. createChart() wires
        role="img" and aria-label so a new chart cannot forget them.

   No DOM measurement anywhere: every chart draws into a fixed viewBox and is
   scaled by CSS. That keeps rendering correct inside a hidden tab, which is
   where every view except the active one lives — getBoundingClientRect() on a
   `display:none` section returns zeroes and would silently collapse the
   geometry. */

const { el } = require('./util');

const NS = 'http://www.w3.org/2000/svg';

/* ------------------------------- theme -------------------------------- */

/* Live palette read. Fallbacks match styles.css's light theme so a chart still
   draws if it somehow renders before the stylesheet lands. */
function themeColors(root) {
  const css = getComputedStyle(root);
  const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
  return {
    success:    v('--color-success', '#22c55e'),
    danger:     v('--color-danger', '#f43f5e'),
    warning:    v('--color-warning', '#f59e0b'),
    info:       v('--color-info', '#0ea5e9'),
    accent:     v('--color-accent', '#0d9488'),
    primary:    v('--color-primary', '#065f46'),
    investment: v('--color-investment', '#6f42c1'),
    muted:      v('--ink-faint', '#5f6779'),
    /* Dot holes punch through to the card behind them, so this tracks the card
       surface rather than the page. Kept as the literal pair the trend chart
       has always used: --surface is close but not identical, and changing it
       here would be a silent visual change to a shipped chart. */
    hole: root.classList.contains('bud-dark') ? '#0a0f1e' : '#ffffff',
  };
}

/* ---------------------------- slice colours ----------------------------

   Category colours are the user's, set in each Categories/<name>.md. Nothing
   has ever stopped two categories carrying the same one, and in practice they
   do — a real vault here had 15 categories on #dc3545 and 10 on #3b82f6 — so a
   donut drawn straight from them comes out as several wedges of the same red
   and several of the same blue, which is a chart that cannot be read.

   distinctColors() below fixes that at RENDER time and never writes to the
   vault: a colour someone chose deliberately is still theirs, it just cannot
   be worn by two wedges at once. */

/* Fallback wedge colours.

   Fixed hexes rather than theme variables: a wedge must stay the same colour
   when the theme flips, and the plugin's --color-* set is redefined between
   light and dark. Every entry clears 1.9:1 on the light card and 3:1 on the
   dark one, and no two are closer than 173 under colorDistance() — comfortably
   past the ~115 where two fills stop being tellable apart at wedge size, and
   past SLICE_MIN_DISTANCE so the palette can always satisfy its own rule.

   Deliberately no red, and no near-red: red means "over budget" on the trend
   chart and in the budget table, so a category wearing it would have the
   dashboard signalling something it does not mean. That is easy to break by
   eye — the first draft of this list had #ea580c in it, which scores 90
   against #ef4444 and reads as plain red on a wedge — so tests/slice-colours
   pins every entry at least SLICE_MIN_DISTANCE away from the common reds
   rather than trusting the hue name. */
const SLICE_PALETTE = [
  '#fb923c', '#0ea5e9', '#a16207', '#0369a1', '#84cc16',
  '#6366f1', '#15803d', '#e879f9', '#34d399', '#a21caf',
];

/* Below this distance two fills read as "the same colour" on a wedge. Measured
   against the colours real category files actually carry: the closest genuinely
   distinguishable pair sat at 133 and the worst confusable pair at 79, so 130
   separates them. It also has to stay under the palette's own 148 minimum, or
   the palette would reject its own entries and have nothing left to hand out. */
const SLICE_MIN_DISTANCE = 130;

/* The colour promptCreateCategory() stamps on every new category file, and the
   loader's fallback for a file with no colour at all. Neither is a choice
   anyone made, so both are treated as "unset" and always replaced — otherwise
   the first category to be drawn wins grey and every donut has a wedge the
   same colour as its own "Other". */
const PLACEHOLDER_COLORS = ['#888', '#888888'];

/* "#abc", "#aabbcc" or "rgb(…)" → [r,g,b]; anything else → null.
   Both forms are needed: frontmatter is hand-written hex, but a colour read
   back through getComputedStyle arrives as rgb(). A colour that parses as
   neither (a CSS keyword, a typo) is left alone rather than guessed at. */
function parseColor(value) {
  const raw = (value || '').trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(raw);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/* Distance between two colours, 0 (identical) to ~765.

   "Redmean" — a weighted RGB metric — rather than plain euclidean distance.
   It costs one extra divide and is markedly better at agreeing with the eye
   about blues, which is exactly where category colours collide: plain RGB
   scores #3b82f6 against #0d6efd far enough apart to keep both, and on screen
   they are the same blue. A full Lab conversion would be better still and is
   not worth the code here. */
function colorDistance(a, b) {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(
    (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

/* Resolve a list of wanted colours to ones that can actually be told apart.

   `wanted` MUST arrive in priority order — largest wedge first — because the
   rule is "first claim wins": the biggest slice keeps the colour its category
   file asks for, and the smaller ones that would have duplicated it move to
   the palette. Sorted the other way round, the largest wedge on the chart is
   the one that gets its colour taken away, which is the most visible possible
   place to overrule the user.

   `reserved` are colours already spoken for by something not in this list —
   the muted "Other" wedge — so nothing is assigned close enough to be mistaken
   for it. Returns the ORIGINAL string when a colour is kept, so a hand-written
   #3B82F6 is not silently rewritten to lowercase in the legend swatch. */
function distinctColors(wanted, { reserved = [], palette = SLICE_PALETTE,
                                  minDistance = SLICE_MIN_DISTANCE } = {}) {
  const taken = reserved.map(parseColor).filter(Boolean);
  const clashes = rgb => taken.some(t => colorDistance(rgb, t) < minDistance);
  const out = [];
  for (const raw of wanted) {
    const placeholder = PLACEHOLDER_COLORS.includes((raw || '').trim().toLowerCase());
    const own = placeholder ? null : parseColor(raw);
    if (own && !clashes(own)) { taken.push(own); out.push(raw); continue; }
    /* More wedges than the palette can keep apart — only reachable if the
       slice count is raised past the palette length. Wrapping repeats a colour,
       which is the same failure this function exists to prevent, but a repeat
       at position 11 beats leaving a wedge with no fill at all. */
    const pick = palette.find(p => !clashes(parseColor(p))) || palette[out.length % palette.length];
    taken.push(parseColor(pick));
    out.push(pick);
  }
  return out;
}

/* ------------------------------ scaffold ------------------------------ */

/* An <svg> plus the `add(tag, attrs, parent)` helper every chart builds with.
   `label` is the screen-reader description — it is the ONLY thing a
   non-sighted reader gets, so it should state what the chart shows, not that
   it is a chart. */
function createChart({ w, h, label, cls }) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  if (cls) svg.setAttribute('class', cls);
  // currentColor drives axis text and gridlines, so both follow the theme
  // without a second getComputedStyle read per element.
  svg.style.color = 'var(--text-primary)';
  const add = (tag, attrs = {}, parent = svg) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, val] of Object.entries(attrs)) {
      if (val !== null && val !== undefined) n.setAttribute(k, val);
    }
    parent.append(n);
    return n;
  };
  return { svg, add };
}

/* Value→pixel mappers for a padded plot box.

   `x(i)` spreads `count` points edge to edge — for lines, where the first and
   last points sit ON the axis ends. `band(i)` centres them in `count` equal
   slots instead — for bars, where a point owns a width rather than a position.
   Using x() for bars is the classic off-by-half that pushes the last bar off
   the right edge. */
function scales({ w, h, padL = 24, padR = 24, padT = 24, padB = 40, count, max, min = 0 }) {
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const span = (max - min) || 1;
  const slots = Math.max(1, count);
  return {
    padL, padR, padT, padB, innerW, innerH, count,
    x: i => (count <= 1 ? padL + innerW / 2 : padL + i * (innerW / (count - 1))),
    band: i => padL + (i + 0.5) * (innerW / slots),
    bandWidth: innerW / slots,
    y: v => padT + (1 - (v - min) / span) * innerH,
    baseline: padT + innerH,
  };
}

/* Horizontal rules behind the data. Deliberately faint: they are a reading
   aid, and at full contrast they compete with the series. */
function gridlines(add, s, w, rows = 4) {
  for (let g = 1; g < rows; g++) {
    const gy = s.padT + g * (s.innerH / rows);
    add('line', {
      x1: s.padL, x2: w - s.padR, y1: gy, y2: gy,
      stroke: 'currentColor', 'stroke-opacity': '0.06',
    });
  }
}

/* X-axis labels, thinned so they never collide.

   A year of weekly periods is 52 points; drawing 52 labels across 1000 units
   produces an unreadable smear, and on a phone that smear is the whole chart.
   `stride` keeps roughly `maxLabels` of them, always including the last one so
   the axis ends on a real date rather than wherever the stride happened to
   land.

   Two edge cases that only show up with long labels ("Sep 2029" rather than
   "Sep 26"), both of which shipped visibly broken on the first draft:

     - The end labels are centred on points sitting ON the axis ends, so half
       of each one hangs off the viewBox and gets clipped. They anchor to the
       inside instead. Widening the padding would fix the clipping too, but at
       the cost of squeezing the plot on every chart to suit its two outermost
       labels.
     - Forcing the last label can land it right beside the final stride label
       and overprint it. A stride label inside half a stride of the end is
       dropped in favour of the end, which is the one that has to be there. */
function axisLabels(add, s, labels, h, { maxLabels = 8, band = false } = {}) {
  const n = labels.length;
  const stride = Math.max(1, Math.ceil(n / maxLabels));
  labels.forEach((text, i) => {
    const last = i === n - 1;
    if (!last && (i % stride !== 0 || n - 1 - i < stride / 2)) return;
    add('text', {
      x: band ? s.band(i) : s.x(i), y: h - 12,
      'text-anchor': i === 0 && !band ? 'start' : last && !band ? 'end' : 'middle',
      'font-size': '13', fill: 'currentColor', 'fill-opacity': '0.45',
      'font-family': 'inherit',
    }).textContent = text;
  });
}

/* --------------------------------- marks ------------------------------- */

const linePath = pts => 'M' + pts.map(p => `${p[0]},${p[1]}`).join(' L ');

/* A line closed down to the baseline, for a filled area under it. */
const areaPath = (pts, baseline) =>
  linePath(pts) + ` L ${pts[pts.length - 1][0]},${baseline} L ${pts[0][0]},${baseline} Z`;

/* A top-to-transparent fill, returned as the url(#id) to hand to `fill`.
   `id` must be unique per chart: two charts on one view sharing an id means
   whichever rendered last wins, and the other quietly takes its colour. */
function areaGradient(add, id, color, opacity = 0.22) {
  const defs = add('defs', {});
  const grad = add('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  add('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': String(opacity) }, grad);
  add('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' }, grad);
  return `url(#${id})`;
}

/* A donut segment between two angles (radians, 0 = 3 o'clock).

   The sweep is clamped just under a full turn: at exactly 2π the start and end
   points coincide and the A command has no way to tell "no arc" from "the whole
   circle", so a single-category donut would render as nothing at all. The
   hairline this leaves is well under a pixel at any size we draw. */
function arcPath(cx, cy, rOut, rIn, a0, a1) {
  const end = Math.min(a1, a0 + Math.PI * 2 - 0.0001);
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const large = end - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(rOut, a0), [x1, y1] = p(rOut, end);
  const [x2, y2] = p(rIn, end), [x3, y3] = p(rIn, a0);
  return `M ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} ` +
         `L ${x2} ${y2} A ${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3} Z`;
}

/* Native SVG tooltip. Works with touch-and-hold on iOS and is read by screen
   readers, which a CSS-only tooltip is not. */
function tip(add, node, text) {
  add('title', {}, node).textContent = text;
}

/* -------------------------------- ranges ------------------------------- */

/* Time ranges offered by the chart controls.

   `months` is calendar months in both directions — backwards for charts drawn
   from transaction history, forwards for charts projected from a repayment
   schedule. Months rather than periods because a period is a pay cycle, which
   may be a week: "6M" has to mean six months whether that is 6 points or 26.

   `historical: false` marks the ranges that only make sense projected forward.
   Nobody has ten years of imported statements, and offering 10Y on the spending
   trend would draw nine flat-zero years and read as "you spent nothing until
   last year" — which is a lie the chart would be telling on our behalf. */
const RANGES = [
  { key: '3m',  label: '3M',  months: 3,   historical: true },
  { key: '6m',  label: '6M',  months: 6,   historical: true },
  { key: '1y',  label: '1Y',  months: 12,  historical: true },
  { key: '5y',  label: '5Y',  months: 60,  historical: false },
  { key: '10y', label: '10Y', months: 120, historical: false },
];

const historicalRanges = () => RANGES.filter(r => r.historical);
const rangeFor = key => RANGES.find(r => r.key === key);

/* Segmented pill control. Returns the element; the caller mounts it.

   role="group" rather than a radiogroup: these are buttons that act
   immediately, and announcing them as radios promises a selection the reader
   then has to commit, which is not what happens. aria-pressed carries the
   state instead. */
function rangePills({ ranges, value, onPick, label }) {
  const wrap = el('div', { class: 'chart-range', role: 'group', 'aria-label': label });
  for (const r of ranges) {
    const active = r.key === value;
    wrap.append(el('button', {
      type: 'button',
      class: `chart-range-btn${active ? ' is-active' : ''}`,
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => { if (!active) onPick(r.key); },
    }, r.label));
  }
  return wrap;
}

module.exports = {
  NS, themeColors, createChart, scales, gridlines, axisLabels,
  linePath, areaPath, areaGradient, arcPath, tip,
  SLICE_PALETTE, parseColor, colorDistance, distinctColors,
  RANGES, historicalRanges, rangeFor, rangePills,
};
