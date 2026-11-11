'use strict';
/* The stylesheet's source files, in the ONE order they are assembled in.

   Root styles.css is BUILD OUTPUT: the files below, concatenated (`assemble`)
   and then stripped of comments and whitespace (`shipped`, at the bottom of
   this file). esbuild.config.mjs writes it from this list, and every CSS guard
   test reads the same list through tests/helpers/css-sources.cjs, so "the
   stylesheet" means exactly one thing in the build and in the tests. Before the October 2026
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
     4. lanes      one file per page group (dashboard, budget, transactions,
                   accounts), so the lanes can restyle their pages without ever
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
  'src/statement/accounts.css',
  'src/statement/phone.css',
  'src/statement/phone-tables.css',
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

/* The one comment the shipped stylesheet keeps.

   The sheet embeds Geist as a data URI, and Geist is SIL OFL 1.1: it may be
   bundled with software provided its copyright notice and licence travel with
   each copy — as a text file, a human-readable header, or the font's own
   metadata. In this repo that is NOTICE and assets/fonts/OFL-Geist.txt. But
   styles.css is published as a release asset on its own, with neither file
   beside it, and the build below removes every comment the sources carry —
   including the generated font sheet's own "Geist is SIL Open Font License
   1.1" header. So the notice is put back here, as the header of the file that
   actually carries the font.

   The copyright line is READ from the licence text rather than retyped, the
   same way tests/fonts.test.cjs checks NOTICE against it, so replacing the
   font cannot leave a stale name on the shipped file. Plain ASCII on purpose:
   a comment is the one part of the file esbuild passes through untouched, and
   an ASCII header reads correctly whatever the file is later served as.

   It also does the job the generated sheets' "do not edit" banners used to do
   at the top of the root file: say that this is build output. */
function FONT_NOTICE() {
  const copyright = fs.readFileSync(path.join(ROOT, 'assets/fonts/OFL-Geist.txt'), 'utf8').split('\n')[0].trim();
  if (!/^Copyright /.test(copyright) || copyright.includes('*/') || /[^\x20-\x7e]/.test(copyright)) {
    throw new Error('assets/fonts/OFL-Geist.txt must open with a plain-ASCII copyright line — '
      + 'it is repeated in the header of the shipped stylesheet');
  }
  return [
    '/* Budget Vault - styles.css is BUILD OUTPUT. Edit the sources under src/ and run',
    '   npm run build; an edit made here is lost on the next build.',
    '',
    '   Embeds the Geist typeface (as "BV Geist").',
    `   ${copyright}`,
    '   Licensed under the SIL Open Font License, Version 1.1: https://openfontlicense.org',
    '   The full licence text is assets/fonts/OFL-Geist.txt in the plugin\'s source repository. */',
  ].join('\n');
}

/* What the build writes to root styles.css: the assembly with its comments and
   whitespace removed, under the font notice.

   The sources are commented far more heavily than most CSS — 37.6% of the
   assembled sheet was comment when this was added, 598 KB shipped where 332 KB
   carries every rule. Those comments are for whoever edits src/. Shipping them
   meant every install downloaded, synced and tokenised them on every load.

   WHITESPACE ONLY — `minifyWhitespace`, not `minify`, and no `target`. The full
   pass also rewrites values and merges rules, and a target would lower syntax
   esbuild believes the floor lacks; this sheet's iOS 15 fallbacks are
   hand-written @supports pairs that the guard tests hold in a particular
   shape. Those guards all read the SOURCES, so they only speak for the shipped
   file while it is the same rules, token for token. Measured, the full pass
   would save a further 1,885 bytes (0.6%); it is not worth shipping a
   stylesheet no test has read. The only thing this pass rewrites besides
   whitespace is quote marks (`[role='table']` to `[role=table]`), which
   tests/css-shipped-minified.test.cjs accounts for when it proves the two
   texts are otherwise identical.

   charset utf8 so a non-ASCII character in a `content:` string ships as the
   author wrote it rather than as a CSS escape — the same "change nothing but
   whitespace" rule. legalComments none so the notice above is the only comment,
   whatever a source file may one day mark as `/*!`.

   esbuild is required here, inside the function, not at the top of the file:
   every CSS guard test loads this module for CSS_SOURCES and assemble(), and
   only the build and the two tests that compare against the shipped file need
   the bundler installed. transformSync, because the build and the tests both
   want the text now, and because the same input must give the same bytes on
   the machine the community scorecard rebuilds this on. */
function shipped(text = assemble()) {
  const esbuild = require('esbuild');
  return esbuild.transformSync(text, {
    loader: 'css',
    minifyWhitespace: true,
    charset: 'utf8',
    legalComments: 'none',
    banner: FONT_NOTICE(),
    logLevel: 'silent',
  }).code;
}

module.exports = { CSS_SOURCES, readSources, assemble, shipped, FONT_NOTICE };
