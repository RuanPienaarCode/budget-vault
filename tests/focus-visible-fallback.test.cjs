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

   EVERY selector, not only the ones under `.budget-app-root`. The first
   version of this guard matched selectors starting `.budget-app-root` and
   nothing else, and the export dialog — body-mounted like every Obsidian
   modal, so its rules are `.budget-export-modal button…` — shipped two
   `:focus-visible` rings (its format/range pills and its links) with no
   `:focus` twin, which this suite could not see. Those were found by the
   7 Oct 2026 audit, not by a guard. Comments are blanked first, so prose that
   mentions the pseudo-class cannot be read as a selector now that the match
   is no longer anchored to a class name.

   Reads the build INPUT — src/styles.css and the generated
   src/styles-presets.css, which together are byte-for-byte the shipped
   styles.css (css-class-coverage.test.cjs asserts that identity) — rather
   than the repo-root build output. Reading the output meant running this
   file directly while editing (the workflow CLAUDE.md describes) checked
   whatever the last build left behind, not the stylesheet being edited.

   Deliberately NOT a full CSS parse — a regex over the two regions is enough
   for a house stylesheet, and a parser dependency would cost more than the bug. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/* Blanked, not stripped, so offsets and the brace walk below are unchanged. */
const css = (read('src/styles.css') + read('src/styles-presets.css'))
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

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
  console.log('\nFAIL — no `@supports not selector(:focus-visible)` block in src/styles.css.\n' +
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
   A selector runs from a boundary — the start, a brace, or the comma before it
   in a selector list — up to the pseudo-class. Normalised to its base (pseudo
   stripped, whitespace collapsed) so `.a .b:focus-visible` and `.a .b:focus`
   compare equal. At-rule preludes are skipped: `@supports not
   selector(:focus-visible)` names the pseudo-class without being a ring. */
const norm = s => s.replace(/\s+/g, ' ').trim();
const collect = (text, pseudo) => {
  const out = new Set();
  const re = new RegExp(String.raw`(?:^|[{},])\s*([^{},;]*?)${pseudo}(?![\w-])`, 'g');
  for (const m of text.matchAll(re)) {
    const sel = norm(m[1]);
    if (sel && !sel.startsWith('@')) out.add(sel);
  }
  return out;
};

const live = collect(outside, ':focus-visible');
const fallback = collect(inside, ':focus');

check('there are :focus-visible rules to guard at all', live.size > 0);
check('the fallback block is not empty', fallback.size > 0);

/* ---- the parity assertions ---- */
for (const sel of live) {
  check(`"${sel}" has a :focus-visible ring but NO :focus fallback — ` +
        'invisible focus on iOS 15.0-15.3. Add it to the @supports block in src/styles.css.',
    fallback.has(sel));
}
for (const sel of fallback) {
  check(`"${sel}" has a :focus fallback but no :focus-visible rule — ` +
        'dead CSS, usually a rename applied to only one of the two lists.',
    live.has(sel));
}

/* The specific regressions this was written for, pinned by name so a future
   rename can't quietly drop them back out of the set. */
check('.topbar-icon-btn (the topbar Import button) is covered — the 1.0.27 miss',
  live.has('.budget-app-root .topbar-icon-btn') && fallback.has('.budget-app-root .topbar-icon-btn'));
check('the export dialog\'s pills and links are covered — the body-mounted miss',
  ['.budget-export-modal button.budget-export-pill', '.budget-export-modal button.budget-export-link']
    .every(s => live.has(s) && fallback.has(s)));
const outsideRoot = [...live].filter(s => !s.includes('.budget-app-root'));
check('the guard sees rings outside .budget-app-root at all (else the widening is vacuous)', outsideRoot.length > 0);

const total = live.size + fallback.size + 5;
console.log(fail
  ? `\nFAIL — ${fail} check(s) in :focus-visible fallback parity`
  : `\nPASS — :focus-visible fallback parity intact (${live.size} rings, ${outsideRoot.length} of them body-mounted, each mirrored onto :focus; ${total} checks).`);
process.exit(fail ? 1 : 0);
