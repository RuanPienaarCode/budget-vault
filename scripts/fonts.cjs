'use strict';
/* Emits src/styles-fonts.css: the bundled typeface as an @font-face block with
   the font file embedded as a base64 data URI.

   WHY EMBEDDED. The plugin is three files (manifest.json, main.js, styles.css)
   and Obsidian loads only those. A relative url(assets/fonts/...) would point at
   a folder that does not exist in the user's vault, and a Google Fonts link
   would put a network request, and a third party, behind a plugin whose pitch is
   "no account, no server". A data URI travels inside styles.css, works offline
   and on iOS, and needs no loader.

   WHY GENERATED. Same reason as the palette blocks (scripts/gen-presets.cjs):
   a 60KB base64 blob has no business inside a file people edit by hand, and a
   generated file whose first line says so is one nobody hand-edits. The woff2
   file under assets/fonts/ is the source of truth; tests/fonts.test.cjs fails
   when the generated sheet drifts from it, and the scorecard's clean
   `npm ci && npm run build` reproduces it because esbuild.config.mjs runs this
   script before it assembles styles.css.

   FAMILY NAME is 'BV Geist', not the font's own name, so a copy of Geist the
   reader happens to have installed can never shadow the bundled file (and the
   bundled file can never be mistaken for it). Geist is SIL OFL 1.1; its licence
   text sits beside the file in assets/fonts/ and the copyright line is repeated
   in NOTICE.

   AXES, read from the file's fvar table rather than from the vendor page:
     Geist  wght 100-900  (no width or optical-size axis)
   `font-weight` carries the range as a descriptor.

   font-display: swap — the text paints at once in the fallback stack and
   re-flows when the face is decoded. With the font inline it decodes within a
   frame or two, and `swap` is the choice that can never leave text invisible.

     node scripts/fonts.cjs        # writes src/styles-fonts.css */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'styles-fonts.css');

const FONTS = [
  {
    family: 'BV Geist',
    file: 'assets/fonts/geist-latin-wght-normal.woff2',
    weight: '100 900',
    stretch: null,
    note: 'Geist, latin subset, wght axis',
  },
];

function block(f) {
  const b64 = fs.readFileSync(path.join(ROOT, f.file)).toString('base64');
  return [
    `/* ${f.note} — ${f.file} */`,
    '@font-face {',
    `  font-family: '${f.family}';`,
    '  font-style: normal;',
    `  font-weight: ${f.weight};`,
    ...(f.stretch ? [`  font-stretch: ${f.stretch};`] : []),
    '  font-display: swap;',
    `  src: url("data:font/woff2;base64,${b64}") format("woff2");`,
    '}',
    '',
  ].join('\n');
}

function generate() {
  return [
    '/* ============================================================',
    '   GENERATED FILE — do not edit.',
    '',
    '   Written by scripts/fonts.cjs from the woff2 file in',
    '   assets/fonts/, then concatenated into the root styles.css by',
    '   esbuild.config.mjs (order: scripts/css-sources.cjs).',
    '',
    '   Geist is SIL Open Font License 1.1; see NOTICE and',
    '   assets/fonts/OFL-Geist.txt.',
    '',
    '   To change the face, replace the file under assets/fonts/ and',
    '   rebuild. Editing this file loses the edit on the next build.',
    '   ============================================================ */',
    '',
    ...FONTS.map(block),
  ].join('\n');
}

if (require.main === module) {
  const css = generate();
  fs.writeFileSync(OUT, css, 'utf8');
  console.log(`fonts — ${FONTS.length} face, ${Math.round(css.length / 1024)}KB -> src/styles-fonts.css`);
}

module.exports = { generate, FONTS, OUT };
