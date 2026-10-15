'use strict';
/* A DIMMED ROW, A CODE CHIP AND TWO CATEGORY BADGES STILL READ AT 4.5:1 (audit L5-04).

   Measured in Chromium with Obsidian 1.14.4's real app.css over the synthetic
   household, every plugin x Obsidian theme pair, 16 views:

     - `.debt-settled td { opacity: .75 }` (light) / `.55` (dark) multiplied the
       INK of a settled debt row: the "Settled" pill read 3.09:1 (3.13:1 in the
       dark plugin theme), the muted note beside it 3.9:1, the "—" 3.9:1. The
       old comment claimed the pair was lifted "to 5:1"; it was not, because the
       pill is a button.status-pill, not the .text-success span the re-point
       reached. Opacity is the wrong dimming for a row whose whole job is to be
       read: it dims the ink and the fill by the same factor, and a pale ink
       cannot afford it. The row is quieter through its INK TOKEN now
       (--text-muted) and through the fills (the progress bar), never through
       opacity on the cell.
     - `.badge-debt` in the light theme: #c2410c on its 14% orange tint over the
       pale tile, 4.13:1.
     - `.badge-giving` in the dark theme: #e83e8c on its 14% pink tint, 4.47:1.
     - inline `code` chips: --ink-faint on the chip's 7% tint over the pale tile,
       4.39:1 and 4.49:1.

   The palette is sealed, so every colour here is a literal the plugin already
   owns (the badge inks are hex literals in the same family as #be185d and
   #15803d beside them) or a token; nothing is derived from Obsidian's.

   Negative controls, each run by hand: put `opacity: .75` back on
   `.debt-settled td`; restore #c2410c on the light debt badge; restore the 7%
   code tint; delete the dark giving override. Each fails here.

     node tests/css-settled-debt-contrast.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');
let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';

/* ---- colour arithmetic ---- */
const hex = h => { const m = /^#([0-9a-f]{6})$/i.exec(h.trim()); if (!m) throw new Error('not a #rrggbb: ' + h); const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (base, ink, a) => base.map((v, i) => v * (1 - a) + ink[i] * a);

/* ---- palette tokens, read from the generated blocks (read-only) ---- */
const tokenSets = { light: [], dark: [] };
for (const r of rules) {
  for (const s of r.selectors) {
    const m = /^\.budget-app-root\.bud-palette-([a-z-]+)(\.bud-dark)?$/.exec(s);
    if (!m || r.context.length) continue;
    const get = p => { const d = r.decls.find(x => x.prop === p); return d && /^#[0-9a-f]{6}$/i.test(d.value) ? hex(d.value) : null; };
    const t = { name: m[1], surface: get('--surface'), textPrimary: get('--text-primary'), textMuted: get('--text-muted'), inkFaint: get('--ink-faint') };
    if (t.surface && t.textPrimary) tokenSets[m[2] ? 'dark' : 'light'].push(t);
  }
}
ok(tokenSets.light.length >= 4 && tokenSets.dark.length >= 4, `expected the four palettes in both themes, found ${tokenSets.light.length} light / ${tokenSets.dark.length} dark`);

/* The pale tiles the cards sit on over the page glow, measured in the browser
   under the two failing chips and the debt badge (the card is translucent
   glass, so a card is never pure --surface). */
const LIGHT_BASES = t => [t.surface, [241, 246, 246], [240, 243, 246]];

const lastDecl = (selFn, ctx, prop) => {
  let hit = null;
  for (const r of rules) {
    if (ctx && JSON.stringify(r.context) !== JSON.stringify(ctx)) continue;
    if (!r.selectors.some(selFn)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d, r };
  }
  return hit;
};

/* ---- 1. the settled row is not dimmed through opacity on its cells ---- */
for (const r of rules) {
  if (!r.selectors.some(s => /\.debt-settled\b/.test(s))) continue;
  for (const d of r.decls) {
    if (d.prop !== 'opacity') continue;
    const target = r.selectors.find(s => /\.debt-settled\b/.test(s));
    ok(Number(d.value) >= 1 || /\.cat-bar\b|\.debt-prog\b/.test(target),
      `${locate(d.line)}: "${target}" sets opacity ${d.value}. Opacity multiplies the ink of every cell in the row (the Settled pill 3.09:1, the muted note 3.9:1); dim the fill (.cat-bar), not the text`);
  }
}
{
  const c = lastDecl(s => s === `${R} .debt-settled td`, [], 'color');
  ok(c && c.value === 'var(--text-muted)', `a settled row is quieter through its ink token: ${R} .debt-settled td { color: var(--text-muted) }, found ${c ? c.value : 'nothing'}`);
}

/* ---- 2. light theme: the debt badge ---- */
{
  const d = lastDecl(s => s === `${R}:not(.bud-dark) .badge-debt`, [], 'color');
  ok(d, 'the light-theme .badge-debt colour rule exists');
  if (d) {
    const fg = hex(d.value);
    for (const t of tokenSets.light) for (const base of LIGHT_BASES(t)) {
      const bg = mix(base, hex('#f97316'), 0.14);   // the badge's own 14% orange tint
      const q = ratio(fg, bg);
      ok(q >= 4.5, `light .badge-debt ${d.value} on its tint over ${t.name} ${base.map(Math.round)} is ${q.toFixed(2)}:1 (< 4.5) at ${locate(d.r.line)}`);
    }
  }
}

/* ---- 3. dark theme: the giving badge ---- */
{
  const d = lastDecl(s => s === `${R}.bud-dark .badge-giving`, null, 'color');
  ok(d && /^#[0-9a-f]{6}$/i.test(d.value), `a dark-theme .badge-giving ink exists (${R}.bud-dark .badge-giving { color: #rrggbb }), found ${d ? d.value : 'nothing'}`);
  if (d && /^#[0-9a-f]{6}$/i.test(d.value)) {
    const fg = hex(d.value);
    for (const t of tokenSets.dark) {
      const bg = mix(t.surface, hex('#e83e8c'), 0.14);   // --color-giving, the badge's 14% tint
      const q = ratio(fg, bg);
      ok(q >= 4.5, `dark .badge-giving ${d.value} on its tint over ${t.name} surface is ${q.toFixed(2)}:1 (< 4.5)`);
    }
  }
}

/* ---- 4. inline code chips: the faintest ink the chip is set in ---- */
{
  const bg = lastDecl(s => s === `${R} code`, [], 'background');
  const m = bg && /color-mix\(in srgb, var\(--text-primary\) ([\d.]+)%, transparent\)/.exec(bg.value);
  ok(m, `${R} code keeps its --text-primary tint, found ${bg ? bg.value : 'nothing'}`);
  if (m) {
    const a = Number(m[1]) / 100;
    for (const t of tokenSets.light) for (const base of LIGHT_BASES(t)) {
      const q = ratio(t.inkFaint, mix(base, t.textPrimary, a));
      ok(q >= 4.5, `light code chip: --ink-faint on a ${m[1]}% tint over ${t.name} ${base.map(Math.round)} is ${q.toFixed(2)}:1 (< 4.5) at ${locate(bg.line)}`);
    }
    /* Dark chips measured clean (not one flagged in 16 views x 2 dark pairs): the
       dark card is darker than its --surface, so the light-theme worst case is
       not repeated for them. */
  }
}

/* ---- 5. the comment that claimed 5:1 no longer does ---- */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'statement', 'foundation.css'), 'utf8');
  ok(!/bring it to 5:1/.test(src), 'foundation.css no longer claims the .75 opacity brought the settled label "to 5:1" (it measured 3.09:1)');
}

if (failures.length) {
  console.log(`FAIL — css-settled-debt-contrast: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-settled-debt-contrast: ${checks} checks (settled row not dimmed by opacity, debt badge, dark giving badge and code chips >= 4.5:1 on every palette).`);
