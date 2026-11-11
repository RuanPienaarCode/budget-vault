'use strict';
/* The two places a contributor reads how root styles.css is built say what
   the build does (wave 2 of the 2026-11-11 audit).

   Since wave 1 the build writes root styles.css as scripts/css-sources.cjs
   `shipped()`: the listed sources concatenated and THEN stripped of comments
   and whitespace (tests/css-shipped-minified proves it is still the same
   rules). CLAUDE.md's "Build output is not source" and build.sh's header went
   on describing a plain concatenation — and build.sh's still named the two
   files the stylesheet was made of before the October 2026 redesign made it
   ten. A reader told "styles.css is the sources, concatenated" who then diffs
   the shipped file against them, or greps it for a comment, is looking for
   something the build removed.

   A doc guard is only worth having if it is tied to the fact, so the fact is
   asked first: while `shipped()` differs from the bare assembly, both
   documents must say the sheet is stripped; the day the build goes back to a
   bare concatenation this suite fails and says to turn the sentences back.

   .github/workflows/release.yml carries the same stale sentence. It is a CI
   workflow file, held for the owner, and is deliberately not asserted here.

     node tests/build-docs-say-how-styles-ship.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { assemble, shipped, CSS_SOURCES } = require('../scripts/css-sources.cjs');

/* ---- the fact ---- */
const whole = assemble();
const sent = shipped();
ok(sent.length < whole.length && !/\/\*(?!!)/.test(sent.slice(sent.indexOf('*/') + 2)),
  'the build ships the assembled sources with their comments and whitespace removed — if this is false the build '
  + 'concatenates again, and CLAUDE.md and build.sh should say so');
ok(/writeFileSync\(rel\('styles\.css'\), require\('\.\/scripts\/css-sources\.cjs'\)\.shipped\(\)\)/.test(read('esbuild.config.mjs')),
  'and esbuild.config.mjs is where root styles.css is written from it');

/* ---- the two documents ---- */
const flat = s => s.replace(/^#\s?/gm, '').replace(/\s+/g, ' ');
for (const [name, text] of [['CLAUDE.md', flat(read('CLAUDE.md'))], ['build.sh', flat(read('build.sh').split('\nset -euo pipefail')[0])]]) {
  ok(/scripts\/css-sources\.cjs/.test(text), `${name} points at the one list of stylesheet sources`);
  ok(/stripped of comments and whitespace/.test(text), `${name} says the shipped stylesheet is stripped of comments and whitespace`);
  ok(/esbuild\.config\.mjs/.test(text), `${name} names the file that does it`);
}
ok(!/src\/styles\.css \(hand-written\) \+ src\/styles-presets\.css \(generated\)/.test(read('build.sh')),
  `build.sh no longer says the stylesheet is two files — it is the ${CSS_SOURCES.length} in the list`);
ok(/src\/statement\/\*\.css/.test(read('build.sh')), 'build.sh sends ordinary CSS work to the statement sheets as well as src/styles.css');

console.log(`PASS build-docs-say-how-styles-ship (${checks} checks)`);
