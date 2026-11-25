'use strict';
/* THREE WHITE GLYPHS ON THE DARK THEME'S PRIMARY SWAP TO THE DARK INK (audit CSS-15, 2026-11-25).

   White on the dark theme's emerald (rgb(16,185,129)) is 2.54:1 — and 1.52:1
   against the bright accent end of the logo's gradient. Eight sibling rules
   already lay --ink-on-accent over an accent fill under .bud-dark (the avatar,
   the gradient button, the drawer's current-page icon, the done tick .ei-tick);
   three had been missed:

     .brand-logo        the topbar logo's glyph, on the accent -> primary gradient
     .splash-logo       the gate's logo, on the same gradient
     .fs-mark.is-done   the first-steps card's tick, on --color-primary

   The fix is the same move as its siblings: under .bud-dark the ink is
   --ink-on-accent and the fill is left alone. The light theme keeps its white
   (3.74:1 at the logos' accent end — a graphic, held to 3:1 — and 7.68:1 on the
   tick). Measured in Chromium, dark default palette: 2.54 -> 7.93 on the
   primary end and 1.52 -> 13.20 on the accent end.

     node tests/css-dark-ink-on-primary.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';

const hex = h => { const m = /^#([0-9a-f]{6})$/i.exec(String(h).trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const sets = { light: [], dark: [] };
for (const r of rules) {
  for (const s of r.selectors) {
    const m = /^\.budget-app-root\.bud-palette-([a-z-]+)(\.bud-dark)?$/.exec(s);
    if (!m || r.context.length) continue;
    const get = p => { const d = r.decls.find(x => x.prop === p); return d ? hex(d.value) : null; };
    const t = { name: m[1], accent: get('--color-accent'), primary: get('--color-primary') };
    if (t.accent && t.primary) sets[m[2] ? 'dark' : 'light'].push(t);
  }
}
ok(sets.light.length >= 4 && sets.dark.length >= 4, `expected the four palettes in both themes, found ${sets.light.length} light / ${sets.dark.length} dark`);

const rootDark = rules.find(r => r.context.length === 0 && r.selectors.includes(`${R}.bud-dark`) && r.decls.some(d => d.prop === '--ink-on-accent'));
const inkDark = rootDark && hex(rootDark.decls.find(d => d.prop === '--ink-on-accent').value);
ok(inkDark, 'the dark theme defines --ink-on-accent as a literal');

const last = (sel, prop) => {
  let hit = null;
  for (const r of rules) {
    if (r.context.length || !r.selectors.includes(sel)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = { ...d };
  }
  return hit;
};

/* [class, selector of the light base, whether the fill reaches the accent end] */
const GLYPHS = [
  ['.brand-logo', `${R} .brand-logo`, `${R}.bud-dark .brand-logo`, true],
  ['.splash-logo', `${R} .splash-logo`, `${R}.bud-dark .splash-logo`, true],
  ['.fs-mark.is-done', `${R} .fs-mark.is-done`, `${R}.bud-dark .fs-mark.is-done`, false],
];
for (const [name, base, dark, gradient] of GLYPHS) {
  const d = last(dark, 'color');
  ok(d && d.value === 'var(--ink-on-accent)',
    `${name} should take --ink-on-accent under .bud-dark (white on the dark emerald is 2.54:1); found ${d ? `"${d.value}" at ${locate(d.line)}` : `no ${dark} rule outside a media query`}`);
  const b = last(base, 'color');
  ok(b && /^#(fff|ffffff)$/i.test(b.value), `${name} keeps its white in the light theme (found ${b ? b.value : 'none'})`);
  for (const t of sets.dark) {
    const ends = gradient ? [t.accent, t.primary] : [t.primary];
    for (const e of ends) {
      const q = inkDark && ratio(inkDark, e);
      ok(q >= 4.5, `${t.name} dark: ${name}'s ink on ${e === t.primary ? '--color-primary' : '--color-accent'} is ${q && q.toFixed(2)}:1 (< 4.5)`);
    }
  }
  /* The override must out-rank the base by specificity, not by luck of order:
     it adds .bud-dark to the root, so the base can never win. */
  ok(dark.split('.').length > base.split('.').length, `${name}: the dark rule is more specific than the base`);
}

if (failures.length) { console.error(`FAIL — css-dark-ink-on-primary: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-dark-ink-on-primary: the logo glyphs and the done mark take the dark ink under .bud-dark and clear 4.5:1 on all four palettes (${checks} checks).`);
