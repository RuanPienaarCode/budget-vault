'use strict';
/* Every timer the controller schedules by hand is unwound when the view closes
   (2026-11-11 audit, task 13 — the `S._foodQ` half).

   controller.js keeps four search-debounce handles on S (`_q`, `_acctQ`,
   `_noteQ`, `_foodQ`) and schedules them with a bare setTimeout rather than
   through Obsidian's register* helpers, so nothing unwinds them automatically.
   destroy() — called from BudgetView.onClose — cleared three. The fourth, the
   Food page's item search, was added after the list was written: typing in
   that box and closing the view inside 200 ms left renderFood() to fire into a
   view whose contentEl had been emptied.

   mountApp() cannot be built in bare node (it needs a DOMParser shell — see
   tests/reload-from-disk.test.cjs), so this is held at the source, and held
   GENERALLY rather than for the one name: every `S.<handle> = setTimeout(` in
   controller.js must have its `clearTimeout(S.<handle>)` inside destroy's
   body. A fifth debounce added the way the fourth was fails here the day it is
   written, not at the next audit.

     node tests/controller-destroy-clears-timers.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');

/* destroy's body: from `destroy: () => {` to the brace that closes it. */
const start = src.indexOf('destroy: () => {');
ok(start !== -1, 'controller.js still returns a destroy()');
let depth = 0, end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}' && --depth === 0) { end = i; break; }
}
ok(end > start, 'destroy\'s body is readable');
const body = src.slice(start, end);

const scheduled = [...new Set([...src.matchAll(/\bS\.(_\w+)\s*=\s*setTimeout\(/g)].map(m => m[1]))].sort();
ok(scheduled.length >= 4, `the hand-scheduled handles on S are recognisable (${scheduled.join(', ')})`);
ok(scheduled.includes('_foodQ'), 'the Food item search is one of them');

const cleared = scheduled.filter(h => new RegExp(`clearTimeout\\(S\\.${h}\\)`).test(body));
eq(scheduled.filter(h => !cleared.includes(h)), [],
  'T13b: every debounce handle scheduled on S is cleared in destroy() — none outlives the view');

/* The S literal declares each handle beside the others, which is where the
   next one will be added: the declared set and the scheduled set agree, so a
   handle cannot be declared, scheduled under another name, and missed. */
const declared = [...src.matchAll(/^\s+(_\w+):\s*0,\s*\/\/.*debounce timer handle/gm)].map(m => m[1]).sort();
eq(declared, scheduled, 'the debounce handles S declares are exactly the ones scheduled');

console.log(`PASS controller-destroy-clears-timers (${checks} checks)`);
