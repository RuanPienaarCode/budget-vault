'use strict';
/* Palette derivation — 13 authored seeds per mode become the 19 custom
   properties a preset actually sets.

   BUILD TIME ONLY. Nothing here is bundled into main.js, and that is the point:
   the plugin ships literal CSS and toggles a class, so no colour arithmetic runs
   on a user's phone and nothing new leans on `color-mix()`, which the iOS 15
   WebKit floor does not have.

   Why seeds at all, rather than writing each preset's 19 values by hand: most of
   the 19 are not decisions. A focus ring is the primary at 20% and never
   anything else; `--ink-dim` has been a second name for `--text-muted` in both
   themes since the palette was written. Authoring those by hand is how they
   drift apart — styles.css already carried a comment admitting --focus-ring was
   "kept in sync with it by hand, per theme", which is a standing invitation to a
   bug. Derived, they cannot drift.

   Why light and dark are authored SEPARATELY (two seed blocks, not one): the
   shipped dark palette is not a transform of the light one and never was. Under
   a lightness inversion the two modes' relative luminances would sum to roughly
   a constant; measured on the real palette they range from 0.32 to 1.01, and
   --text-light sits at 0.135 light against 0.189 dark — nearly the SAME
   brightness in both modes, where an inversion would put it near 0.87. The
   surface-to-background separation is 17x wider in light than in dark, because
   dark mode separates those two by hue and alpha instead of brightness. No
   function reproduces that; a generator that claimed to would be hardcoding
   Airy Glass and calling it derivation. */

/* --------------------------- colour primitives --------------------------- */

/* "#abc" / "#aabbcc" -> [r,g,b]. Anything else throws: a seed is authored by
   hand and a typo in one must stop the build, not silently paint a preset
   black. */
function rgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`seed is not a hex colour: ${JSON.stringify(hex)}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

/* WCAG relative luminance, used only by the contrast gate in the test. */
function luminance(hex) {
  const f = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = rgb(hex).map(c => f(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* WCAG contrast ratio between two OPAQUE colours. Both arguments must be hex:
   a ratio against a translucent surface is not defined without knowing what is
   behind it, and quietly compositing against a guess is how a "passing" number
   gets reported for a pair nobody can actually read. */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/* A hex plus an alpha, as the `rgba(r,g,b,a)` CSS wants. */
function alpha(hex, a) {
  return `rgba(${rgb(hex).join(',')},${a})`;
}

/* Just the channels, for a token a stylesheet completes itself:
   `rgba(var(--glow-primary-rgb), .15)`. Substitution happens before the value
   is parsed, so this is plain CSS on every engine back to Safari 9 — no
   color-mix(), nothing the iOS 15 floor lacks. */
function rgbTriple(hex) {
  return rgb(hex).join(',');
}

/* The ambient glow colours — the radial washes behind the app and the splash
   gate, and the two brand-logo shadows.

   MODE-INVARIANT, and derived from the palette's DARK seeds even in light mode.
   That looks wrong until you check what shipped: the hand-written glow is
   painted in the dark palette's emerald, mint and gold under BOTH themes, and
   always has been. It works because a saturated colour designed to read on
   black is exactly what survives being laid over a light page at 13% — the
   light-mode brand colours are too dark and turn the wash muddy.

   Emitted once, into the light block only. That block's selector matches the
   root whether or not it also carries .bud-dark, so a property set there
   applies in both modes — the same trick the base stylesheet already uses for
   the fourteen tokens it defines once.

   Deriving these rather than authoring them per palette is what makes Vault
   Green come out unchanged: its dark seeds ARE the values the glow was written
   with, so the generator reproduces the shipped wash exactly while every other
   palette gets its own. */
function glowTokens(preset) {
  return {
    '--glow-accent-rgb': rgbTriple(preset.dark.accent),
    '--glow-primary-rgb': rgbTriple(preset.dark.primary),
    '--glow-gold-rgb': rgbTriple(preset.dark.gold),
    /* The one glow taken from the LIGHT seeds. The splash gate's lower wash
       used the light-mode accent where its upper wash used the dark one —
       a deliberate depth cue, kept rather than flattened. */
    '--glow-deep-rgb': rgbTriple(preset.light.accent),
  };
}

/* --------------------------- the derivation ----------------------------- */

/* Alphas that differ between the two modes. Lifted verbatim from the shipped
   palette rather than picked afresh — the whole point of running Vault Green
   through this generator is that it comes out the other side unchanged, so
   every constant here has to be the one the hand-written palette already used. */
const MODE = {
  light: { border: '.09', line: '.055', ring: '0.20' },
  dark: { border: '.08', line: '.04', ring: '0.28' },
};

/* Seeds every preset must supply, per mode. Listed so a preset missing one
   fails loudly at build time instead of emitting a block with a hole in it. */
const SEEDS = [
  'primary', 'primaryDark', 'accent', 'gold',
  'surface', 'bodyBg', 'bg1',
  'textPrimary', 'textMuted', 'textLight',
  'inkBase', 'glass', 'glassHi',
];

/* One mode of one preset: 13 seeds in, 19 declarations out.

   `overrides` is the escape hatch, and it is deliberately narrow. Some tokens
   genuinely are not derivable — light mode's --color-primary-light is #dcf5ec,
   a borrowed hand-made tint whose implied mix percentages scatter per channel
   (14.1 / 6.2 / 10.3), because it was picked by eye rather than computed. Rather
   than bend the derivation into a shape that reproduces one such value and
   nothing else, a preset may state the literal. The COUNT of overrides is the
   measurement worth watching: Vault Green needs exactly one, and a preset
   needing many would be telling you the seed set is wrong. */
function derive(seeds, mode, overrides = {}) {
  const missing = SEEDS.filter(k => !(k in seeds));
  if (missing.length) throw new Error(`${mode} seeds missing: ${missing.join(', ')}`);
  const m = MODE[mode];
  if (!m) throw new Error(`unknown mode: ${mode}`);

  const out = {
    '--color-primary': seeds.primary,
    '--color-primary-dark': seeds.primaryDark,
    /* Dark mode's tint is exactly the primary at 18% — verified against all
       four shipped *-light tokens, which are their base at exactly 12%. Light
       mode has no such rule (see the overrides note above). */
    '--color-primary-light': alpha(seeds.primary, '0.18'),
    '--color-accent': seeds.accent,
    '--color-gold': seeds.gold,

    '--surface': seeds.surface,
    '--body-bg': seeds.bodyBg,
    /* --bg-0 has been a second name for --body-bg in both shipped modes. */
    '--bg-0': seeds.bodyBg,
    '--bg-1': seeds.bg1,
    '--surface-glass': seeds.glass,
    '--surface-glass-hi': seeds.glassHi,

    '--text-primary': seeds.textPrimary,
    '--text-muted': seeds.textMuted,
    '--text-light': seeds.textLight,
    /* Likewise: --ink-dim and --ink-faint are the same two colours under
       different names, in both modes. Derived so they cannot drift. */
    '--ink-dim': seeds.textMuted,
    '--ink-faint': seeds.textLight,

    /* Hairlines are the mode's ink at a fixed alpha — near-black over a light
       page, white over a dark one — which is why inkBase is a seed rather than
       something read off the text colour. */
    '--border-color': `rgba(${seeds.inkBase},${m.border})`,
    '--line-soft': `rgba(${seeds.inkBase},${m.line})`,

    /* The ring the hand-written palette warned was synced by hand. It is the
       primary at 20% light / 28% dark, exactly, in both shipped themes. */
    '--focus-ring': alpha(seeds.primary, m.ring),
  };

  for (const [k, v] of Object.entries(overrides)) {
    if (!(k in out)) throw new Error(`override for a token this does not emit: ${k}`);
    out[k] = v;
  }
  return out;
}

module.exports = { rgb, luminance, contrast, alpha, rgbTriple, glowTokens, derive, SEEDS, MODE };
