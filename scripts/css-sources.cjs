'use strict';
/* The stylesheet's source files, in the ONE order they are assembled in.

   Root styles.css is BUILD OUTPUT: the plain concatenation of the files below.
   esbuild.config.mjs writes it from this list, and every CSS guard test reads
   the same list through tests/helpers/css-sources.cjs, so "the stylesheet" means
   exactly one thing in the build and in the tests. Before the October 2026
   statement-type redesign that meant two files and each test spelled them out;
   with a foundation sheet plus three page lanes a rule can live in any of six,
   and a guard that read only src/styles.css would have passed while looking at
   nothing the lanes wrote.

   THE ORDER IS THE CASCADE. Equal-specificity rules resolve by source order, so:

     1. fonts      generated @font-face block (scripts/fonts.cjs). First, so a
                   later file can use the family and nothing can restyle it.
     2. base       src/styles.css, the hand-written legacy sheet.
     3. foundation src/statement/foundation.css: the type system (tokens, the
                   global figure/label/title treatment, the statement classes).
                   Overrides the base by being later.
     4. lanes      one file per page group (dashboard, budget, transactions), so
                   three lanes can restyle three groups of pages without ever
                   editing the same file. They win over foundation by being
                   later; none of them wins over another because no two lanes
                   share a class.
     5. presets    src/styles-presets.css, generated palette blocks. Last, as it
                   has always been: they carry the palette class on top of the
                   root, so they win on specificity too, and keeping the
                   generated half at the end keeps the file readable.

   Every file must end with a newline: the assembly is a bare concatenation (no
   separator is inserted). tests/css-sources asserts the newline so a file that
   forgets it cannot glue its last rule to the next file's first. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const CSS_SOURCES = [
  'src/styles-fonts.css',
  'src/styles.css',
  'src/statement/foundation.css',
  'src/statement/dashboard.css',
  'src/statement/budget.css',
  'src/statement/transactions.css',
  'src/styles-presets.css',
];

/* [{ rel, text, start }] — `start` is the 1-based line of the ASSEMBLED file
   where this source begins, so a rule's position in the shipped styles.css can
   be turned back into "file X, line Y" in a failure message. */
function readSources() {
  let line = 1;
  return CSS_SOURCES.map(rel => {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const out = { rel, text, start: line };
    line += (text.match(/\n/g) || []).length;
    return out;
  });
}

function assemble() {
  return readSources().map(s => s.text).join('');
}

module.exports = { CSS_SOURCES, readSources, assemble };
