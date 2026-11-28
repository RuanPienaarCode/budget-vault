'use strict';
/* THE SPLASH GATE'S BACKGROUND DRIFT MUST END (issue #194).

   The "Enter budget" gate (#splashGate) sits over the pane, un-entered, for as
   long as the reader leaves the Budget view alone. Its two decorative gradient
   layers (.splash-gate::before / ::after) carried `animation: ... infinite`, so
   a gate nobody was watching kept the window repainting at the display rate.
   The reporter measured a Linux/Electron desktop going from 7.4 W to 17.1 W and
   the GPU from 0% to 80% with nothing but the gate on screen, and back to
   7.07 W with `animation: none` on those two pseudo-elements.

   The fix is a bound on the run, not a pause on a visibility signal: a
   background tab is detached by Obsidian and a display:none gate runs nothing
   already, and the case that is left (an attached gate in a window covered by
   another, where document.visibilityState still says "visible") has no signal
   to hang a pause on. See the comment above the rule in src/styles.css.

   WHAT THIS PINS, on the sheet as assembled from src/ AND on the shipped root
   styles.css (a source fixed but not rebuilt would otherwise pass):
     1. no animation on the gate, its two layers or anything inside it repeats
        forever: no `infinite` in an `animation` shorthand or an
        `animation-iteration-count`.
     2. each layer's animation still exists and runs a finite, explicit number
        of passes (a bare `animation: name 26s` is one pass too, but the count is
        written so the next edit cannot lose it unnoticed) and holds its last
        frame (`forwards`/`both`) so it settles instead of snapping.
     3. the keyframes begin and end on the same pose (one rule carries `0%` and
        `100%`), so "holds its last frame" is the pose the layer started in and
        the end of the run is not a visible jump.
     4. the reduced-motion block that turns the drift off is still there.
     5. the sweep is not blind: the rules it looked at include both layers.

     node tests/splash-drift-bounded.test.cjs [path/to/stylesheet.css]
   (the optional path is for the negative control: point it at a sheet with
   `infinite` restored and it must fail.) */

const fs = require('fs');
const path = require('path');
const { readRules, readRulesOf } = require('./helpers/css-sources.cjs');

const override = process.argv[2];
const SHEETS = override
  ? [[override, readRulesOf(fs.readFileSync(override, 'utf8'), 'styles.css')]]
  : [
    ['src/ (assembled)', readRules()],
    ['root styles.css (shipped)', readRulesOf(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'), 'styles.css')],
  ];

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

const onGate = r => r.selectors.some(s => /\.splash-gate\b/.test(s));
const noMotion = r => r.context.some(c => /prefers-reduced-motion\s*:\s*reduce/.test(c));
const LAYERS = [
  ['::before', 'bud-splash-drift-a'],
  ['::after', 'bud-splash-drift-b'],
];

for (const [label, rules] of SHEETS) {
  const gate = rules.filter(onGate);

  // 1. nothing on the gate repeats forever.
  for (const r of gate) {
    for (const d of r.decls) {
      if (d.prop === 'animation' || d.prop === 'animation-iteration-count') {
        ok(!/\binfinite\b/.test(d.value),
          `${label}: line ${d.line}: "${r.prelude}" has ${d.prop}: ${d.value} — the gate would repaint the window forever`);
      }
    }
  }

  // 2. each layer still drifts, a bounded number of times, and settles.
  for (const [pseudo, keyframes] of LAYERS) {
    const anim = gate
      .filter(r => !noMotion(r) && r.selectors.some(s => s.endsWith(`.splash-gate${pseudo}`)))
      .flatMap(r => r.decls.filter(d => d.prop === 'animation'));
    ok(anim.length === 1, `${label}: .splash-gate${pseudo} should carry exactly one animation declaration, found ${anim.length}`);
    const v = anim.length ? anim[anim.length - 1].value : '';
    ok(v.split(/\s+/).includes(keyframes), `${label}: .splash-gate${pseudo} should run ${keyframes}, has "${v}"`);
    ok(/(^|\s)(\d+)(\s|$)/.test(v.replace(/[\d.]+m?s/g, '')),
      `${label}: .splash-gate${pseudo} animation "${v}" should state its iteration count`);
    ok(/\b(forwards|both)\b/.test(v), `${label}: .splash-gate${pseudo} animation "${v}" should hold its last frame (forwards)`);

    // 3. same pose at both ends.
    const frames = rules.filter(r => r.context.some(c => c === `@keyframes ${keyframes}`));
    ok(frames.some(r => r.selectors.includes('0%') && r.selectors.includes('100%')),
      `${label}: @keyframes ${keyframes} should open and close on one shared pose ("0%, 100%")`);
  }

  // 4. reduced motion still stills both layers.
  const still = gate.filter(noMotion);
  for (const [pseudo] of LAYERS) {
    ok(still.some(r => r.selectors.some(s => s.endsWith(`.splash-gate${pseudo}`)) &&
      r.decls.some(d => d.prop === 'animation' && d.value.trim() === 'none')),
    `${label}: the prefers-reduced-motion block should still set animation: none on .splash-gate${pseudo}`);
  }

  // 5. the sweep saw the layers.
  ok(gate.length >= 5, `${label}: only ${gate.length} .splash-gate rules found — the sweep is not reading the gate`);
}

if (failures.length) {
  console.error(`splash-drift-bounded.test.cjs — ${failures.length} of ${checks} checks FAILED`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`PASS splash-drift-bounded.test.cjs — ${checks} checks OK`);
