'use strict';
/* A hand-typed money cell is parsed by ONE function, and never by parseFloat.

   The bug this pins was not a wrong figure on a screen; it was data loss on
   disk, and it was silent. table-schema.js's money() preserves the verbatim
   text of a cell the loader could not read in `<key>Raw`, and the writer
   prefers that text over the fabricated 0 beside it — that is what stops a save
   erasing what the reader typed. Every in-place editor of one of those fields
   clears its own `<key>Raw`, which is correct: a number typed in the field
   supersedes the unreadable text.

   The two halves only work together. While the editors parsed with
   `parseFloat(e.target.value) || 0`, an empty field read as 0 AND cleared the
   raw, so a balance of "1 234 567,89" went to 0.00 on disk with no toast and
   nothing to undo. An empty field is not a hypothetical: a plain number input
   reports exactly that when an SA-locale numeric keypad writes "15 000 000,00"
   into it, which is the case views/assets.js's own comment was written for.
   Assets was fixed then; debts, owed, services and budgets were not, and kept
   the bug for five more fields.

   Two claims:

     1. no view parses a money input with parseFloat — a source grep, the same
        shape tests/budget-file.test.cjs uses for its duplicate-header check,
        because the next copy of this handler is how the rule comes back,
     2. normalizeAmount answers null (not 0) for every cell that holds no
        number, which is the property the handlers rely on. The parseFloat
        answers are asserted beside them so this file states the difference
        rather than trusting the reader to remember it.

     node tests/money-input-guard.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { normalizeAmount } = require('../src/amount');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* ---- 1: no view parses a money input with parseFloat -------------------- */

/* Comments are stripped first, and that is not incidental: the fix deliberately
   LEFT the offending expression quoted in prose — in views/debts.js's editMoney
   comment and in table-schema.js's money() contract — because a reader who does
   not know what the old code looked like cannot see why the two halves have to
   move together. A guard that cannot tell code from the comment explaining it
   would force those explanations out, which is the opposite of what this repo
   wants from a comment. */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const viewsDir = path.join(__dirname, '..', 'src', 'views');
const offenders = [];
for (const f of fs.readdirSync(viewsDir).filter(n => n.endsWith('.js'))) {
  const code = stripComments(fs.readFileSync(path.join(viewsDir, f), 'utf8'));
  code.split('\n').forEach((line, i) => {
    if (line.includes('parseFloat(e.target.value)')) offenders.push(`src/views/${f}:${i + 1}`);
  });
}
eq(offenders, [], 'no view reads a money input with parseFloat — normalizeAmount is the one parser');

/* The guard has to be able to fail, or it pins nothing. */
ok(stripComments('const a = 1; /* parseFloat(e.target.value) */').indexOf('parseFloat') === -1,
  'the comment stripper removes a block comment, so prose about the bug does not trip the grep');
ok(stripComments('x = parseFloat(e.target.value) || 0;').indexOf('parseFloat(e.target.value)') !== -1,
  'and leaves real code alone, so a reintroduced handler DOES trip it');

/* ---- 2: null, not 0, for a cell holding no number ---------------------- */

/* The empty string is the important one. It is what the browser reports for a
   number input the user cleared, and — the case assets.js was fixed for — what
   it reports when a locale keypad writes a grouped figure the input cannot
   hold. Read as 0 it silently zeroes a real balance. */
for (const blank of ['', '   ', 'abc', '--100']) {
  eq(normalizeAmount(blank), null, `normalizeAmount(${JSON.stringify(blank)}) is null — no number in there`);
  eq(Math.max(0, parseFloat(blank) || 0), 0, `...where parseFloat would have said 0 (${JSON.stringify(blank)})`);
}

/* And the figures a South African vault actually holds, which parseFloat reads
   as a different number rather than as no number — the quieter half of the bug,
   because 15 looks like something a reader might have typed. */
eq(normalizeAmount('15 000 000,00'), 15000000, 'a space-grouped comma-decimal amount reads in full');
eq(parseFloat('15 000 000,00') || 0, 15, '...where parseFloat reads 15');
eq(normalizeAmount('R4 000'), 4000, 'a symbol-prefixed amount reads in full');
eq(parseFloat('R4 000') || 0, 0, '...where parseFloat reads 0');

/* 0 still parses, so a reader who genuinely means nought is not blocked by the
   guard — the handlers only refuse null. */
eq(normalizeAmount('0'), 0, 'a deliberate 0 is a number, and still writes');

console.log(`PASS — a hand-typed money cell has one parser, and no view uses parseFloat (${checks} assertions).`);
