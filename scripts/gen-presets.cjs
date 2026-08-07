'use strict';
/* Emits src/styles-presets.css from the seeds in scripts/presets.cjs.

   build.sh runs this, then concatenates src/styles.css + src/styles-presets.css
   into the root styles.css that Obsidian loads. That is why the hand-written
   stylesheet moved to src/: root styles.css is now BUILD OUTPUT, exactly like
   main.js, and hand-editing it loses the edit on the next build. Edit
   src/styles.css instead.

   Emitting to a separate file rather than splicing into the hand-written one is
   deliberate. A generated region inside a file people edit by hand needs
   sentinel comments and a guard test to notice when someone types inside the
   fence; two files need neither, because nobody hand-edits a file whose first
   line says it is generated.

   Cascade: the base blocks in src/styles.css are (0,1,0) and (0,2,0). Every
   block here carries the palette class too, making it (0,2,0) and (0,3,0), so a
   preset beats the base regardless of source order and without !important.
   vault-green is emitted like the rest and is simply a no-op restatement of the
   base — see the reproduction test for why it exists at all. */

const fs = require('fs');
const path = require('path');
const { derive } = require('./palette.cjs');
const { PRESETS } = require('./presets.cjs');

const OUT = path.join(__dirname, '..', 'src', 'styles-presets.css');

function blockFor(preset, mode) {
  const seeds = preset[mode];
  const overrides = preset[mode === 'light' ? 'lightOverrides' : 'darkOverrides'] || {};
  const tokens = derive(seeds, mode, overrides);
  const sel = mode === 'light'
    ? `.budget-app-root.bud-palette-${preset.id}`
    : `.budget-app-root.bud-palette-${preset.id}.bud-dark`;
  const width = Math.max(...Object.keys(tokens).map(k => k.length));
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}:${' '.repeat(width - k.length)} ${v};`)
    .join('\n');
  return `${sel} {\n${body}\n}`;
}

function generate() {
  const parts = [
    '/* ============================================================',
    '   GENERATED FILE — do not edit.',
    '',
    '   Written by scripts/gen-presets.cjs from the seeds in',
    '   scripts/presets.cjs, then concatenated onto src/styles.css by',
    '   build.sh to produce the root styles.css Obsidian loads.',
    '',
    '   To change a palette, edit the seeds and rebuild. Editing this',
    '   file loses the edit on the next build.',
    '   ============================================================ */',
    '',
  ];
  for (const p of PRESETS) {
    parts.push(`/* ---- ${p.name} (${p.id}) ---- */`);
    parts.push(blockFor(p, 'light'));
    parts.push(blockFor(p, 'dark'));
    parts.push('');
  }
  return parts.join('\n');
}

if (require.main === module) {
  const css = generate();
  fs.writeFileSync(OUT, css, 'utf8');
  const n = PRESETS.length;
  console.log(`gen-presets — ${n} palettes, ${n * 2} blocks -> src/styles-presets.css`);
}

module.exports = { generate, blockFor };
