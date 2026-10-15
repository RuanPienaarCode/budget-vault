'use strict';
/* TEXT IN THE PLUGIN CAN BE SELECTED AND COPIED, AND THE CONTROLS STILL CANNOT (audit L5-05).

   Obsidian's app.css sets `user-select: none` on `body`, and the property
   inherits, so on a phone nothing in the plugin could be selected: the long
   press on a merchant name, an account number, a reference or an amount
   selected nothing, and there was no way to copy one out of the app. Measured
   in Chromium against Obsidian 1.14.4's real app.css: `.budget-app-root`, a
   Transactions description cell, a hero figure and the search field all
   computed to `none`.

   Ruan's call (fix wave, 15 Oct 2026): allow selecting text in the content,
   keep `none` on the things a finger drives: buttons, the drawer and top bar,
   a <summary> toggle, the column-resize grip and charts (a finger drag on a
   chart scrubs its readout; it must not also select the axis labels).

   Both spellings, always: Safari reads only the -webkit- one before 17, and
   iOS 15 is the floor.

   Negative controls, each run by hand: delete the root rule; drop the
   -webkit- twin of either rule; drop `button` from the none list. Each fails.

     node tests/css-text-selection.test.cjs */

const { readRules, locate } = require('./helpers/css-sources.cjs');
let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const rules = readRules();
const R = '.budget-app-root';
const val = (r, p) => { const d = r.decls.find(x => x.prop === p); return d ? d.value : null; };

const root = rules.filter(r => r.context.length === 0 && r.selectors.includes(R) && (val(r, 'user-select') || val(r, '-webkit-user-select')));
ok(root.length === 1, `exactly one base .budget-app-root rule sets user-select (found ${root.length})`);
if (root.length) {
  ok(val(root[0], 'user-select') === 'text', `.budget-app-root { user-select: text } at ${locate(root[0].line)}`);
  ok(val(root[0], '-webkit-user-select') === 'text', `.budget-app-root { -webkit-user-select: text } at ${locate(root[0].line)} (Safari before 17 reads only the prefixed property)`);
}

/* The things a finger drives keep `none`. */
const NONE = ['button', 'summary', '.app-drawer', '.topbar', '.acct-grip', 'svg'];
const none = rules.filter(r => r.context.length === 0 && val(r, 'user-select') === 'none');
for (const sel of NONE) {
  const full = `${R} ${sel}`;
  const hit = none.find(r => r.selectors.includes(full));
  ok(hit, `${full} should keep user-select: none (a finger drives it)`);
  ok(hit && val(hit, '-webkit-user-select') === 'none', `${full} should also set -webkit-user-select: none`);
}

/* Content must not be caught by an over-broad none: no universal selector, and
   no form field (WebKit stops a field taking typed text under user-select:none). */
for (const r of rules) {
  if (!(val(r, 'user-select') === 'none' || val(r, '-webkit-user-select') === 'none')) continue;
  for (const s of r.selectors) {
    ok(!/(^|\s)\*(\s|$)/.test(s) && !/\b(input|textarea|select)\b/.test(s) && !/\b(td|th|p|code|h[1-6]|li)\b$/.test(s),
      `user-select: none at ${locate(r.line)} ("${s}") reaches content or a form field; it belongs on controls only`);
  }
}
/* Nothing makes a card or table cell unselectable through a class either. */
for (const r of none) for (const s of r.selectors) {
  ok(!/\.(card|table|num|fine-note|text-muted|hero-num|sub|sub-note)\b/.test(s), `user-select: none at ${locate(r.line)} ("${s}") reaches readable content`);
}

if (failures.length) {
  console.log(`FAIL — css-text-selection: ${failures.length} of ${checks} checks\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`PASS — css-text-selection: ${checks} checks (content selectable, prefixed twins, none kept on buttons/summary/drawer/top bar/grip/charts).`);
