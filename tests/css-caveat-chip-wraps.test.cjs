'use strict';
/* A CAVEAT CHIP WHOSE SENTENCE WRAPS KEEPS A SHAPE (audit VIS-7, 2026-11-25).

   .caveat-chip-btn was `border-radius: 999px`: right for the one-line chip it
   was drawn for, wrong for the long sentence the Debt table feeds it ("on this
   plan it would be R 164 000 by now"). In a narrow cell that wraps to three
   lines and the 999px radius becomes half of the SHORTER side: a 90x66px oval
   with the first and last words poking out of the curve.

   A fixed 12px radius is the same shape for a one-line chip (the chip is
   min-height 24px, so 12px is exactly the pill's semicircle) and stays a
   rounded rectangle when it grows. The text starts at the left edge, as the
   detail line under it does; the button is a flex box, so that needs
   justify-content as well as text-align (css-button-text-align holds the
   general rule, this pins the chip).

     node tests/css-caveat-chip-wraps.test.cjs */

const { readRules } = require('./helpers/css-sources.cjs');

let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const SEL = '.budget-app-root .caveat-chip-btn';

const last = prop => {
  let hit = null;
  for (const r of rules) {
    if (r.context.length || !r.selectors.includes(SEL)) continue;
    for (const d of r.decls) if (d.prop === prop) hit = d.value;
  }
  return hit;
};

const radius = last('border-radius');
const minH = last('min-height');
ok(radius && /^\d+(\.\d+)?px$/.test(radius), `border-radius is a fixed length (found ${radius})`);
const rPx = parseFloat(radius);
ok(rPx <= 16, `the radius is modest, so a wrapped chip is a rounded rectangle, not an oval (${radius})`);
ok(minH && rPx >= parseFloat(minH) / 2, `and it is still at least half the one-line height, so a one-line chip keeps its pill ends (${radius} vs min-height ${minH})`);
ok(/^(left|start)$/.test(last('text-align') || ''), `wrapped text starts at the left (text-align: ${last('text-align')})`);
ok(/^(flex-start|start|left)$/.test(last('justify-content') || ''), `and the flex button agrees (justify-content: ${last('justify-content')})`);

if (failures.length) { console.error(`FAIL — css-caveat-chip-wraps: ${failures.length} of ${checks} checks\n  ` + failures.join('\n  ')); process.exit(1); }
console.log(`PASS — css-caveat-chip-wraps: the chip has a fixed modest radius equal to its one-line pill and left-aligned wrapped text (${checks} checks).`);
