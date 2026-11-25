'use strict';
/* A HOVER TINT MUST NOT STICK ON A TOUCH SCREEN (2026-11-25 audit, CSS-11).

   On an iPhone a tap "hovers" the element and the browser keeps it hovered
   until the next tap somewhere else. A `:hover` rule written bare therefore
   leaves the menu button tinted, the table row highlighted, the figure
   underlined after the finger has gone, and nothing on the page says why.
   `@media (hover: hover)` is true only where the primary pointer can really
   hover, so a rule inside it never applies to a tap. The audit counted 58 bare
   `:hover` rules in src/styles.css; they were wrapped IN PLACE (an @media block
   adds no specificity, and a rule that stays where it was keeps its cascade
   position against the rules around it, several of which depend on it — the
   KPI figures' underline off/on pair, the Plan card's overspent border).

   WHAT THIS PINS. Every rule of src/styles.css (the legacy sheet, where all 58
   lived) whose selector list names a positive `:hover` sits inside an
   `@media (hover: hover)` block, or is on the allowlist below with the reason
   it is safe bare. A mixed list (`.a:hover, .a.dragover`) counts as bare: the
   state half of it, `.dragover`, must work on a touch screen, so it is its own
   rule outside the block and the hover half is inside it.

   `:not(:hover)` is not a hover tint — it is the resting state, which a touch
   screen has too — so it is not looked for.

   The statement lanes (src/statement/*.css) are a different file with a
   different owner and are not read here.

     node tests/css-hover-guarded.test.cjs [path/to/stylesheet.css]
   (the optional path is for the negative control: point it at a copy with a
   rule unwrapped and it must fail). */

const fs = require('fs');
const path = require('path');
const { readRulesOf } = require('./helpers/css-sources.cjs');

const file = process.argv[2] || path.join(__dirname, '..', 'src', 'styles.css');
const rules = readRulesOf(fs.readFileSync(file, 'utf8'), 'styles.css');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };

/* Selectors that may stay bare, with the reason each is safe. A new entry has
   to say why a stuck hover is harmless there. */
const ALLOWED = new Map([
  ['.budget-app-root .dock-save:not(:disabled):hover',
    'restates the resting fill and label of .dock-save:not(:disabled) in the same rule, value for value — ' +
    'it exists only to out-rank the dock\'s own hover tint (itself inside the hover block), so a stuck ' +
    'hover shows nothing different from rest (palette.test.cjs 7b holds the pair)'],
  ['.budget-app-root.bud-dark .dock-save:not(:disabled):hover',
    'the dark twin of the rule above, for the same reason'],
]);

const hasHover = sel => /:hover/.test(sel.replace(/:not\(\s*:hover\s*\)/g, ''));
const HOVER_MEDIA = /\(\s*hover\s*:\s*hover\s*\)/;

const bare = [];
let guarded = 0;
const seenAllowed = new Set();
for (const r of rules) {
  for (const sel of r.selectors.filter(hasHover)) {
    if (r.context.some(c => c.startsWith('@media') && HOVER_MEDIA.test(c))) { guarded++; continue; }
    if (ALLOWED.has(sel)) { seenAllowed.add(sel); continue; }
    bare.push(`line ${r.line}  ${sel}${r.context.length ? '   (in ' + r.context.join(' ') + ')' : ''}`);
  }
}

ok(guarded > 40, `sanity: the reader should find the guarded hover rules (found ${guarded})`);
ok(bare.length === 0,
  `${bare.length} :hover selector(s) in src/styles.css sit outside @media (hover: hover) — on a touch screen a tap leaves ` +
  'the hover state stuck on. Wrap the rule in place in `@media (hover: hover) { … }` (keep it where it is: the cascade ' +
  'order is part of the design), put a non-hover half of a selector list in its own rule, or — only if a stuck hover ' +
  'is provably invisible — add the selector to ALLOWED with the reason:\n    ' + bare.join('\n    '));
for (const sel of ALLOWED.keys()) {
  ok(seenAllowed.has(sel), `ALLOWED lists "${sel}" but no such bare rule exists any more — remove the entry`);
}

/* The state half of a mixed list really is outside the block: the Import drop
   zone must light under a dragged file on a touch screen too. */
const drag = rules.filter(r => r.selectors.includes('.budget-app-root .upload-area.dragover'));
ok(drag.length > 0 && drag.every(r => !r.context.some(c => HOVER_MEDIA.test(c))),
  '.upload-area.dragover is a drag state and must not be inside @media (hover: hover)');

if (failures.length) {
  console.error(`FAIL — css-hover-guarded: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-hover-guarded: ${guarded} :hover selectors sit inside @media (hover: hover), ${ALLOWED.size} justified exceptions, the drag state stays outside (${checks} checks).`);
