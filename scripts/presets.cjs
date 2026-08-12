'use strict';
/* Preset seed data — the authored half of the palette system.

   BUILD TIME ONLY, like scripts/palette.cjs. The plugin bundle carries only the
   id->label map in src/constants.js (which the settings dropdown needs) and
   tests/palette.test.cjs pins the two lists together, so the dropdown can never
   offer a palette that has no CSS behind it.

   `vault-green` is the palette the plugin has always shipped, transcribed from
   the hand-written blocks at the top of src/styles.css. It goes through the
   generator like every other preset ON PURPOSE. If the seed set could not
   reproduce the one palette that was designed by hand, it would not be
   expressive enough to be worth having — and the failure would otherwise stay
   invisible, because the default would keep looking right while every generated
   preset quietly looked worse. tests/palette.test.cjs asserts the generated
   vault-green matches the hand-written blocks colour-for-colour, so the seed set
   is measured against a real design rather than against itself.

   What a preset may NOT change: --color-success / danger / warning / info and
   the three category-kind colours. Those carry MEANING, not brand — red means
   over budget, and the donut palette in src/chart.js is documented as
   deliberately containing no red so a category can never signal something it
   does not mean. A preset that recoloured danger would break the same contract.
   They stay in src/styles.css, identical under every palette. */

/* Seeds, per mode:
     primary/primaryDark/accent/gold  brand
     surface/bodyBg/bg1               opaque surfaces
     glass/glassHi                    the translucent card fills (authored, not
                                      derived: dark mode's two glass tints are
                                      different navies, neither of them the
                                      surface colour, so no single rule covers
                                      both without inventing one)
     textPrimary/textMuted/textLight  text, darkest to faintest
     inkBase                          "r,g,b" the hairlines are drawn in */

const PRESETS = [
  {
    id: 'vault-green',
    name: 'Vault Green',
    light: {
      primary: '#065f46', primaryDark: '#054334', accent: '#0d9488', gold: '#b45309',
      surface: '#ffffff', bodyBg: '#eef1f4', bg1: '#ffffff',
      glass: 'rgba(255,255,255,.62)', glassHi: 'rgba(255,255,255,.8)',
      textPrimary: '#12151c', textMuted: '#4b5262', textLight: '#5f6779',
      inkBase: '15,23,32',
    },
    /* The one token in the whole system that refuses to derive. #dcf5ec is a
       hand-picked tint, not the primary at any single percentage — its implied
       mix scatters 14.1 / 6.2 / 10.3 across the channels. Stated rather than
       approximated, because approximating it would change the shipped look. */
    lightOverrides: { '--color-primary-light': '#dcf5ec' },
    dark: {
      primary: '#10b981', primaryDark: '#059669', accent: '#6ee7b7', gold: '#fbbf24',
      surface: '#12162a', bodyBg: '#04050b', bg1: '#080b16',
      glass: 'rgba(18,24,44,.42)', glassHi: 'rgba(34,44,78,.42)',
      /* textLight feeds --ink-faint, and it has to clear AA against `surface`,
         not merely against `bodyBg`. It was #6f7799 — 4.63:1 on the page, but
         4.07:1 on the lighter card surface, which is where nearly every
         consumer of that token actually sits: card subtitles, KPI labels,
         account sub-lines, the ages under Owed and Assets. ~48 uses.
         #7d85a7 measures 4.93:1 on surface and 5.61:1 on bodyBg, and stays in
         family with the other three dark presets (4.56-4.59 against their own
         surfaces). This was the only one of the eight palettes that failed. */
      textPrimary: '#f2f4fe', textMuted: '#b3bad6', textLight: '#7d85a7',
      inkBase: '255,255,255',
    },
  },

  /* The three below are new. Each keeps Airy Glass's STRUCTURE — a near-white
     page with white cards in light, a near-black page with a raised tinted card
     in dark — and moves the hue. Every text/surface pair is gated at WCAG AA by
     tests/palette.test.cjs, which is why the muted greys carry a hue cast rather
     than being pure neutrals: a tinted grey light enough to look right on a
     tinted page still has to clear 4.5:1 against it. */

  {
    id: 'ocean',
    name: 'Ocean',
    light: {
      primary: '#0c4a6e', primaryDark: '#082f49', accent: '#0891b2', gold: '#c2410c',
      surface: '#ffffff', bodyBg: '#eef2f6', bg1: '#ffffff',
      glass: 'rgba(255,255,255,.62)', glassHi: 'rgba(255,255,255,.8)',
      textPrimary: '#101720', textMuted: '#485566', textLight: '#5b697c',
      inkBase: '12,26,40',
    },
    lightOverrides: { '--color-primary-light': '#dbeafe' },
    dark: {
      primary: '#38bdf8', primaryDark: '#0284c7', accent: '#7dd3fc', gold: '#fb923c',
      surface: '#111a2e', bodyBg: '#03060e', bg1: '#070d1a',
      glass: 'rgba(17,28,50,.42)', glassHi: 'rgba(32,50,84,.42)',
      textPrimary: '#eef4ff', textMuted: '#adbcd6', textLight: '#74849e',
      inkBase: '255,255,255',
    },
  },

  {
    id: 'plum',
    name: 'Plum',
    light: {
      primary: '#6b21a8', primaryDark: '#4c1d78', accent: '#9333ea', gold: '#a16207',
      surface: '#ffffff', bodyBg: '#f2eef6', bg1: '#ffffff',
      glass: 'rgba(255,255,255,.62)', glassHi: 'rgba(255,255,255,.8)',
      textPrimary: '#17111e', textMuted: '#524661', textLight: '#655874',
      inkBase: '26,15,34',
    },
    lightOverrides: { '--color-primary-light': '#f3e8ff' },
    dark: {
      primary: '#c084fc', primaryDark: '#9333ea', accent: '#e9d5ff', gold: '#fcd34d',
      surface: '#1b1430', bodyBg: '#08040e', bg1: '#0f0a1c',
      glass: 'rgba(27,20,48,.42)', glassHi: 'rgba(48,36,82,.42)',
      textPrimary: '#f6f0ff', textMuted: '#c3b4d8', textLight: '#877ca5',
      inkBase: '255,255,255',
    },
  },

  {
    id: 'slate',
    name: 'Slate',
    light: {
      primary: '#334155', primaryDark: '#1e293b', accent: '#475569', gold: '#92400e',
      surface: '#ffffff', bodyBg: '#eef0f3', bg1: '#ffffff',
      glass: 'rgba(255,255,255,.62)', glassHi: 'rgba(255,255,255,.8)',
      textPrimary: '#12151a', textMuted: '#4a5260', textLight: '#5d6674',
      inkBase: '15,20,28',
    },
    lightOverrides: { '--color-primary-light': '#e2e8f0' },
    dark: {
      primary: '#94a3b8', primaryDark: '#64748b', accent: '#cbd5e1', gold: '#d4a373',
      surface: '#161a22', bodyBg: '#050609', bg1: '#0a0d13',
      glass: 'rgba(22,26,34,.42)', glassHi: 'rgba(40,48,62,.42)',
      textPrimary: '#f1f4f8', textMuted: '#b4bcc9', textLight: '#7a8392',
      inkBase: '255,255,255',
    },
  },
];

/* The palette that applies when the setting is unset or names something that no
   longer exists. Must be a real preset id. */
const DEFAULT_PRESET = 'vault-green';

module.exports = { PRESETS, DEFAULT_PRESET };
