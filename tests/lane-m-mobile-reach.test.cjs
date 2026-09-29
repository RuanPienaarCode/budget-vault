'use strict';
/* MOBILE REACH — the four things a 375px click-through found unreachable.

   1. Transactions (868px) and Budget (1013px) rows put Split / Delete / Note /
      Exclude and the assume-spent / fixed / clear / delete buttons past the
      right edge of a ~365px scroller.
   2. The period pill ellipsised its own label ("Jul 23 – Au…").
   3. The Budget export dialog's Export button sat below the fold.
   4. The donut legend cut "Debt Repayments" to "Debt Repa…".

   The suite renders no pages, so this pins the CSS that fixes them, and the
   one property that makes a fix like this safe to ship: none of it may apply
   above the phone breakpoint, because desktop was correct and stays that way.
   Measured, not asserted, in the preview harness: table width 868 -> 365 and
   1013 -> 365, label scrollWidth == clientWidth, Export button 1244 -> 734 in
   a 812px viewport, legend name 2 lines rather than clipped.

   Negative control: delete the sticky rule, or move #txTable out of its @media
   block, and this fails.

     node tests/lane-m-mobile-reach.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
const built = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const presets = fs.readFileSync(path.join(ROOT, 'src/styles-presets.css'), 'utf8');

/* Comments blanked (same length) so a selector quoted in prose is not a rule. */
const blank = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const css = blank(src);

/* Every top-level block as { head, body }. Walks braces, so a nested @media
   body stays whole. */
function blocks(text) {
  const out = []; let depth = 0, start = 0, head = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { if (depth === 0) { head = text.slice(start, i).trim(); start = i + 1; } depth++; }
    else if (ch === '}') { depth--; if (depth === 0) { out.push({ head, body: text.slice(start, i) }); start = i + 1; } }
  }
  return out;
}
const top = blocks(css);
const phone = top.filter(b => /^@media\s*\(max-width:\s*600px\)$/.test(b.head)).map(b => b.body).join('\n');
const phone560 = top.filter(b => /^@media\s*\(max-width:\s*560px\)$/.test(b.head)).map(b => b.body).join('\n');
ok(phone.length > 0, 'found the 600px media blocks');

/* The build is current: root styles.css is exactly the two source halves. */
ok(built === src + presets, 'root styles.css is the built src/styles.css + presets (run npm run build)');

/* --- desktop is untouched: nothing new sits outside a media block ----------- */
const outsideMedia = top.filter(b => !b.head.startsWith('@')).map(b => b.head).join('\n');
ok(!/#txTable|#budTable/.test(outsideMedia), 'no #txTable / #budTable rule applies above the phone breakpoint');
ok(!/budget-export-actions[^,{]*:not\(\.setting-item-heading\)/.test(outsideMedia), 'the sticky export row is phone-only');

/* --- 1. rows are stacked, every cell placed, no horizontal scroll needed --- */
ok(/#txTable tbody tr[^{]*\{[^}]*display:\s*grid/.test(phone), 'Transactions rows are grids on a phone');
ok(/#budTable tbody tr:not\(\.type-row\)[^{]*\{[^}]*display:\s*grid/.test(phone), 'Budget rows are grids on a phone');
for (let n = 1; n <= 8; n++) ok(new RegExp(`#txTable tbody td:nth-child\\(${n}\\)`).test(phone), `Transactions cell ${n} is placed`);
for (let n = 1; n <= 6; n++) ok(new RegExp(`#budTable tbody td:nth-child\\(${n}\\)`).test(phone), `Budget cell ${n} is placed`);
ok(/#txTable thead[\s\S]*?clip:\s*rect/.test(phone), 'the header row is clipped, not display:none, so assistive tech keeps it');
ok(!/clip-path/.test(css), 'no clip-path (the review linter docks it; .sr-only documents why)');

/* --- 2. the period label is never clipped ----------------------------------- */
const pill = (phone.match(/\.header-period-pill \.pnav-label\s*\{[^}]*\}/) || [''])[0];
ok(pill && !/text-overflow:\s*ellipsis/.test(pill) && /white-space:\s*normal/.test(pill), 'the phone period label wraps instead of ellipsising');
ok(/\.header-period-pill\s*\{[^}]*flex-wrap:\s*wrap/.test(phone), 'the pill wraps so the label gets its own row');

/* --- 3. Export row is pinned, and outranks Obsidian's transparent setting-item */
const sticky = phone.match(/\.modal\.budget-export-modal \.setting-item\.budget-export-actions:not\(\.setting-item-heading\)\s*\{[^}]*\}/);
ok(sticky, 'the export action row has a phone rule at (0,5,0), above Obsidian\'s (0,4,0)');
ok(/position:\s*sticky/.test(sticky[0]) && /background-color:/.test(sticky[0]), 'it is sticky and opaque');

/* --- 4. legend names wrap ---------------------------------------------------- */
const name = (phone560.match(/\.donut-legend \.dl-name\s*\{[^}]*\}/) || [''])[0];
ok(/white-space:\s*normal/.test(name) && !/text-overflow:\s*ellipsis/.test(name), 'legend names wrap on a phone');
ok(/overflow-wrap:\s*break-word;\s*[^}]*overflow-wrap:\s*anywhere/.test(name), '`anywhere` has a Safari 15.0-15.3 fallback ahead of it');
ok(/\.donut-legend li \.dl-link\s*\{\s*gap:\s*7px/.test(phone560), 'the linked legend gets the 7px gap its own comment asked for');

/* --- iOS 15 floor for what this lane added ---------------------------------- */
const added = phone + phone560;
ok(!/color-mix\(/.test(added) && !/:focus-visible/.test(added) && !/\(\?<[=!]/.test(added), 'no color-mix / bare :focus-visible in the phone blocks');

console.log(`PASS — mobile reach: ${checks} checks`);
