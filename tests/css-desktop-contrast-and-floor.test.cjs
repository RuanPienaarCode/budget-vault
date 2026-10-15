'use strict';
/* TWO CHIPS READ AT 4.5:1 ON A DESKTOP, AND NO DESKTOP TEXT IS UNDER 11px (audit L6-04, L6-05).

   Measured in Chromium with Obsidian 1.14.4's real app.css over the synthetic
   household, at 1024 and 1280px, every plugin x Obsidian theme pair.

   CONTRAST (L6-04). The phone layer already mutes both of these (phone.css
   section 7, "the desktop palette is unchanged" - which is the bug: the desktop
   is where they were measured):

     - the Plan's `.kind` chip ("UIF" and the other source kinds): --color-accent
       on its 14% tint of itself over the pale tile, rgb(13,148,136) on
       rgb(209,232,230), 2.93:1 at 11.5px, in the light plugin theme. The text
       goes to --text-muted, the same token the phone rule uses; the fill is what
       carries the accent.
     - `button.ei-tick.done` in the dark plugin theme: #fff on the dark palette's
       emerald, rgb(16,185,129), 2.54:1 at 10px. The dark theme sets
       --ink-on-accent for exactly this (a near-black ink laid over the accent
       fill), and the phone rule already reads it.

   SIZE (L6-05). Text under 11px on a desktop: `.acct-pill`, `.acct-seg-n`,
   `.env-share` 10.5px, `.acct-caret` 10.4px, `.ei-tick` 10px, inline code
   10.6px (.9em of an 11.8px note), the dashboard donut's caption 10.6px and the
   Savings charts' "Growth with no date" note 9.5px / month labels 12px at the
   0.85 scale a 1024px window draws them at. The phone layer raises these to its
   12px floor already; the desktop floor is 11px, the size iOS's own smallest
   text style uses, and the chart text is raised in user units (a CSS font-size
   beats the SVG attribute, as the phone pass relies on) because an SVG label
   scales with its card.

   The palette is sealed: every colour here is an existing token.

     node tests/css-desktop-contrast-and-floor.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';

/* ---- colour arithmetic ---- */
const hex = h => { const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (base, ink, a) => base.map((v, i) => v * (1 - a) + ink[i] * a);

/* ---- tokens: the four palettes in both themes, read from the generated blocks (read-only) ---- */
const sets = { light: [], dark: [] };
for (const r of rules) {
  for (const s of r.selectors) {
    const m = /^\.budget-app-root\.bud-palette-([a-z-]+)(\.bud-dark)?$/.exec(s);
    if (!m || r.context.length) continue;
    const get = p => { const d = r.decls.find(x => x.prop === p); return d ? hex(d.value) : null; };
    const t = { name: m[1], surface: get('--surface'), muted: get('--text-muted'), accent: get('--color-accent'), primary: get('--color-primary') };
    if (t.surface && t.muted && t.accent && t.primary) sets[m[2] ? 'dark' : 'light'].push(t);
  }
}
ok(sets.light.length >= 4 && sets.dark.length >= 4, `expected the four palettes in both themes, found ${sets.light.length} light / ${sets.dark.length} dark`);

/* The ink the dark theme lays over an accent fill. */
const rootDark = rules.find(r => r.context.length === 0 && r.selectors.includes(`${R}.bud-dark`) && r.decls.some(d => d.prop === '--ink-on-accent'));
const inkDark = rootDark && hex(rootDark.decls.find(d => d.prop === '--ink-on-accent').value);
ok(inkDark, 'the dark theme defines --ink-on-accent as a literal');

const last = (sel, prop, ctx = []) => {
  let hit = null;
  for (const r of rules) {
    if (JSON.stringify(r.context) !== JSON.stringify(ctx) || !r.selectors.includes(sel)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d, rule: r };
  }
  return hit;
};

/* The pale tiles a chip sits on over the page glow, measured in the browser
   (a card is translucent glass, so it is never pure --surface). */
const LIGHT_BASES = t => [t.surface, [241, 246, 246], [240, 243, 246]];
const DARK_BASES = t => [t.surface, [8, 11, 22]];

/* ---- 1. .kind: muted ink in the light theme, the accent kept in the dark ---- */
{
  const d = last(`${R}:not(.bud-dark) .kind`, 'color');
  ok(d && d.value === 'var(--text-muted)',
    `the light-theme .kind chip should take --text-muted (the accent was 2.93:1 on its own tint); found ${d ? `"${d.value}" at ${locate(d.line)}` : 'no :not(.bud-dark) .kind rule outside a media query'}`);
  /* The two fills the chip can have: the @supports tint (accent 14%) and its
     rgba(127,127,127,.16) fallback. */
  for (const t of sets.light) for (const base of LIGHT_BASES(t)) {
    for (const [what, fill] of [['accent 14% tint', mix(base, t.accent, 0.14)], ['grey fallback', mix(base, [127, 127, 127], 0.16)]]) {
      const q = ratio(t.muted, fill);
      ok(q >= 4.5, `${t.name} light: .kind --text-muted on the ${what} over ${base.map(Math.round)} is ${q.toFixed(2)}:1 (< 4.5)`);
    }
  }
  /* Dark keeps the accent; it clears 4.5 on every palette, so nothing there moves. */
  for (const t of sets.dark) for (const base of DARK_BASES(t)) {
    const q = ratio(t.accent, mix(base, t.accent, 0.14));
    ok(q >= 4.5, `${t.name} dark: .kind --color-accent on its tint is ${q.toFixed(2)}:1 (< 4.5)`);
  }
}

/* ---- 2. button.ei-tick.done: dark ink on the dark emerald ---- */
{
  const d = last(`${R}.bud-dark .ei-tick.done`, 'color');
  ok(d && d.value === 'var(--ink-on-accent)',
    `the dark-theme done tick should take --ink-on-accent (white on the emerald was 2.54:1); found ${d ? `"${d.value}" at ${locate(d.line)}` : 'no .bud-dark .ei-tick.done rule outside a media query'}`);
  for (const t of sets.dark) {
    const q = inkDark && ratio(inkDark, t.primary);
    ok(q >= 4.5, `${t.name} dark: the done tick's ink on --color-primary is ${q && q.toFixed(2)}:1 (< 4.5)`);
  }
  const base = last(`${R} .ei-tick.done`, 'color');
  ok(base && /^#(fff|ffffff)$/i.test(base.value), 'the light theme keeps its white tick');
  for (const t of sets.light) {
    const q = ratio([255, 255, 255], t.primary);
    ok(q >= 4.5, `${t.name} light: the white done tick on --color-primary is ${q.toFixed(2)}:1 (< 4.5)`);
  }
}

/* ---- 3. the size floor ---- */
const tokens = {};
for (const r of rules) for (const d of r.decls) if (/^--st-/.test(d.prop) && r.context.length === 0 && r.selectors.some(s => s === ':root' || s === R)) tokens[d.prop] = d.value;
/* The smallest size a font-size declaration can come out at, in px: a literal px,
   a --st-* token, or max()/clamp() of those; an em or % is unknown, so 0. */
const lowerBound = v => {
  v = String(v).trim();
  let m = /^(-?[\d.]+)px$/.exec(v); if (m) return Number(m[1]);
  m = /^var\((--[a-z-]+)\)$/.exec(v); if (m) return tokens[m[1]] !== undefined ? lowerBound(tokens[m[1]]) : 0;
  m = /^max\((.*)\)$/.exec(v);
  if (m) { const args = []; let d = 0, cur = ''; for (const c of m[1]) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && d === 0) { args.push(cur); cur = ''; } else cur += c; } args.push(cur); return Math.max(...args.map(lowerBound)); }
  return 0;
};
const FLOOR = 11;
ok(lowerBound('max(0.9em, 11px)') === 11 && lowerBound('var(--st-chip)') === 11.5 && lowerBound('0.85em') === 0, 'the size reader itself understands px, a token, max() and em');
for (const sel of ['.acct-pill', '.acct-seg-n', '.acct-caret', '.env-share', '.ei-tick', '.kind', '.debt-plan .dp-tag', '.acct-badge', '.acct-drawer-l']) {
  /* The cascade keeps the last base-context declaration of a font-size for the
     exact selector, whichever file it sits in. */
  const d = last(`${R} ${sel}`, 'font-size');
  if (!d) { ok(false, `${sel} has no font-size rule to read`); continue; }
  ok(lowerBound(d.value) >= FLOOR, `${sel} { font-size: ${d.value} } at ${locate(d.line)} is under ${FLOOR}px on a desktop`);
}
for (const sel of ['code', '.import-help code']) {
  const d = last(`${R} ${sel}`, 'font-size');
  ok(d && lowerBound(d.value) >= FLOOR, `${sel} { font-size: ${d ? d.value : 'none'} } is under ${FLOOR}px beside a small note (a bare .85em / .9em of 11.8px is 10.6px)`);
}

/* The Savings charts draw into a 1000-unit viewBox that CSS scales to the card;
   the card is ~850px or wider on a desktop (the table-reach test's 1024px
   window is 902px), a 0.85 scale. */
{
  const SCALE = 0.85;
  const d = last(`${R} .stack-wrap svg text`, 'font-size');
  ok(d && lowerBound(d.value) * SCALE >= FLOOR,
    `.stack-wrap svg text { font-size: ${d ? d.value : 'none'} } x ${SCALE} should be >= ${FLOOR}px (the month labels were 12 units = 10.2px, "Growth with no date" 9.5 = 8.1px)`);
  /* It is a DESKTOP floor under the phone's: the phone rules are later in the
     file and keep winning at 600px and below. */
  const phone = last(`${R} .stack-wrap svg text`, 'font-size', ['@media (max-width: 600px)']);
  ok(phone && d && phone.line > d.line, 'the phone chart-text rule comes AFTER the desktop floor, so it still wins on a phone');
  /* The dashboard donut's caption is 13 units in a 320-unit viewBox. */
  const w = last(`${R} .donut-wrap svg.donut`, 'width');
  ok(w && 13 * (parseFloat(w.value) / 320) >= FLOOR,
    `.donut-wrap svg.donut { width: ${w ? w.value : 'none'} } draws the 13-unit caption at ${w ? (13 * parseFloat(w.value) / 320).toFixed(1) : '?'}px (< ${FLOOR}px; the phone's 280px gives 11.4)`);
}

if (failures.length) { console.error(`FAIL — css-desktop-contrast-and-floor: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-desktop-contrast-and-floor: the Plan kind chip and the dark done tick clear 4.5:1 on four palettes, and no desktop text or chart label is under ${FLOOR}px (${checks} checks).`);
