'use strict';
/* :focus-visible fallback parity guard.

   `:focus-visible` is Safari 15.4+, and this plugin's engine floor is iOS 15.0.
   An UNKNOWN pseudo-class doesn't degrade — it invalidates the whole rule — so
   on 15.0-15.3 every `.x:focus-visible { outline: … }` simply isn't there, and
   the control it belonged to has no visible focus ring at all. For a keyboard
   or iPad-with-keyboard user that is an accessibility regression, not a
   cosmetic one.

   styles.css handles this with a hand-written `@supports not selector(...)`
   block mirroring each rule onto plain `:focus`. Hand-written is the problem:
   it is a second list that has to be remembered, and nothing connected the two.
   The topbar Import button shipped in 1.0.27 with a `:focus-visible` rule and
   no counterpart, and stayed that way for five releases — invisible precisely
   because the engine that reveals it is the one nobody develops on.

   So this pins the two lists together: every selector that gets a
   `:focus-visible` ring must have a `:focus` ring inside the fallback block,
   and vice versa (a fallback entry with no live rule is dead CSS and usually
   means a selector was renamed on one side only).

   Deliberately NOT a full CSS parse — a regex over the two regions is enough
   for a house stylesheet, and a parser dependency would cost more than the bug. */

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

let fail = 0;
const check = (msg, cond) => {
  if (cond) return;
  fail++;
  console.log(`  FAIL ${msg}`);
};

/* ---- split the stylesheet into "inside the fallback" and "everything else" ----
   Brace-matched rather than line-counted: the block contains nested rules, and
   a line-range would silently rot the first time a rule is added to it. */
const OPENER = '@supports not selector(:focus-visible)';
const at = css.indexOf(OPENER);
if (at === -1) {
  console.log('\nFAIL — no `@supports not selector(:focus-visible)` block in styles.css.\n' +
    'Either the fallback was deleted (every :focus-visible ring is now missing on iOS 15.0-15.3),\n' +
    'or it was reworded — in which case update OPENER here so the guard keeps watching it.');
  process.exit(1);
}
const open = css.indexOf('{', at);
let depth = 0, end = -1;
for (let i = open; i < css.length; i++) {
  if (css[i] === '{') depth++;
  else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
check('the @supports block closes (balanced braces)', end !== -1);
if (end === -1) { console.log('\nFAIL — unbalanced braces after the fallback block.'); process.exit(1); }

const inside = css.slice(open + 1, end);
const outside = css.slice(0, at) + css.slice(end + 1);

/* ---- collect the two selector sets ----
   Selectors are normalised to their base (pseudo stripped, whitespace
   collapsed) so `.a .b:focus-visible` and `.a .b:focus` compare equal. */
const norm = s => s.replace(/\s+/g, ' ').trim();
const collect = (text, pseudo) => {
  const out = new Set();
  // A selector runs from `.budget-app-root` up to the next comma or brace.
  const re = new RegExp(String.raw`\.budget-app-root[^,{}]*?${pseudo}(?![\w-])`, 'g');
  for (const m of text.matchAll(re)) out.add(norm(m[0].slice(0, -pseudo.length)));
  return out;
};

const live = collect(outside, ':focus-visible');
const fallback = collect(inside, ':focus');

check('there are :focus-visible rules to guard at all', live.size > 0);
check('the fallback block is not empty', fallback.size > 0);

/* ---- the parity assertions ---- */
for (const sel of live) {
  check(`"${sel}" has a :focus-visible ring but NO :focus fallback — ` +
        'invisible focus on iOS 15.0-15.3. Add it to the @supports block in styles.css.',
    fallback.has(sel));
}
for (const sel of fallback) {
  check(`"${sel}" has a :focus fallback but no :focus-visible rule — ` +
        'dead CSS, usually a rename applied to only one of the two lists.',
    live.has(sel));
}

/* The specific regression this was written for, pinned by name so a future
   rename can't quietly drop it back out of the set. */
check('.topbar-icon-btn (the topbar Import button) is covered — the 1.0.27 miss',
  live.has('.budget-app-root .topbar-icon-btn') && fallback.has('.budget-app-root .topbar-icon-btn'));

const total = live.size + fallback.size + 3;
console.log(fail
  ? `\nFAIL — ${fail} check(s) in :focus-visible fallback parity`
  : `\nPASS — :focus-visible fallback parity intact (${live.size} rings, each mirrored onto :focus; ${total} checks).`);
process.exit(fail ? 1 : 0);
