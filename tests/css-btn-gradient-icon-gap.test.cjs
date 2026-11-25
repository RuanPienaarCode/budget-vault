'use strict';
/* THE PRIMARY BUTTON LAYS ITS ICON AND LABEL OUT LIKE THE GHOST ONE (audit VIS-4, 2026-11-25).

   .btn-ghost has been `inline-flex; align-items: center; gap: 6px` since the
   Airy Glass pass; .btn-gradient never got the gap, so the plus on "Add receipt"
   and "New note" and the file glyph on "Create report" touched their words, and
   with a glyph on one button and a different one beside it the pair sat on
   different baselines ("Create report" 7px above "Copy report").

   Pinned: .btn-gradient's base rule says the same three things .btn-ghost's
   does. The shell's buttons put a whitespace text node between the icon span
   and the label; in a flex container that is dropped, so the gap is the only
   spacing left, and it must exist.

     node tests/css-btn-gradient-icon-gap.test.cjs */

const { readRules } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();

const last = (sel, prop) => {
  let hit = null;
  for (const r of rules) {
    if (r.context.length || !r.selectors.includes(sel)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = d.value;
  }
  return hit;
};
for (const prop of ['display', 'align-items', 'gap']) {
  const ghost = last('.budget-app-root .btn-ghost', prop);
  const grad = last('.budget-app-root .btn-gradient', prop);
  ok(ghost, `precondition: .btn-ghost sets ${prop}`);
  ok(grad === ghost, `.btn-gradient ${prop} (${grad}) matches .btn-ghost (${ghost})`);
}
ok(last('.budget-app-root .btn-gradient', 'gap') === '6px', 'the gap is the 6px the ghost button uses');

if (failures.length) { console.error(`FAIL — css-btn-gradient-icon-gap: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-btn-gradient-icon-gap: .btn-gradient has the ghost button's inline-flex, centring and 6px icon gap (${checks} checks).`);
