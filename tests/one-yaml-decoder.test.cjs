'use strict';
/* A frontmatter value is un-escaped ONCE, by one function, at one boundary.

   yamlStr writes a quoted scalar with `\` `"` `\r` `\n` `\t` escaped; the
   reader half that undoes exactly those four is unquoteYaml in markdown.js,
   called by parseFrontmatter as the value comes off the page. note-file.js
   carried a second copy of that decoder — unyaml() — until ISSUE 54 moved the
   reader half next to the writer it inverts. The calls went then; the function
   itself sat on in module scope, uncalled and unexported, for long enough to be
   found by a dead-code sweep.

   Dead is not harmless here. A second decoder beside the live path is an
   invitation to wire it back up, and the failure it causes is silent data
   corruption rather than a crash: a subject reading `Back\slash` loses its
   backslash, and the two literal characters of `path a\nb` become a real
   newline — so the subject no longer EQUALS the debt it names and every note
   about that debt reads as unmatched. This repo's recurring bug shape is "two
   figures derived by different rules"; two decoders for one escape is the same
   shape one layer down.

   Three claims:

     1. src/note-file.js declares no frontmatter decoder of its own — a source
        grep, the same shape tests/money-input-guard.test.cjs uses, because the
        next copy of that loop is how the rule comes back,
     2. the ONE reader half exists and is wired: markdown.js exports
        unquoteYaml and parseFrontmatter runs it,
     3. decoding twice really does corrupt the two subjects above, so claim 1
        is guarding something and not merely tidying.

   Claim 3's companion is tests/notes.test.cjs check 10, which round-trips those
   same subjects through serializeNote → parseNote. That check catches a
   reintroduction that is WIRED IN; this file catches one that is merely
   sitting there.

     node tests/one-yaml-decoder.test.cjs
*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { parseFrontmatter, yamlStr, unquoteYaml } = require('../src/markdown');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

/* Comments are stripped first, and that is deliberate: the removal LEFT the
   lesson in prose above parseNote — naming unquoteYaml, and quoting the escape
   sequences that made a chain of .replace() calls wrong — because a reader who
   never saw the old decoder cannot otherwise see why the reader half lives in
   markdown.js. A guard that could not tell code from the comment explaining it
   would force that explanation out, which is the opposite of what this repo
   wants from a comment. */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

/* ---- 1: note-file.js declares no decoder of its own -------------------- */

/* Two greps, because a copy could come back under any name. The identifier
   catches the function as it was; the escaped-backslash string literal — the
   four characters `'\\'` — catches the loop whatever it is called, since no
   decoder can tell an escape from a literal without comparing against one.
   Live note-file.js code contains that literal nowhere. */
const BACKSLASH_LITERAL = "'" + '\\\\' + "'";
const noteFile = stripComments(read('note-file.js'));

eq(noteFile.includes('unyaml'), false,
  'src/note-file.js has no unyaml() — the reader half lives in markdown.js, beside the yamlStr it inverts');
eq(noteFile.includes(BACKSLASH_LITERAL), false,
  'and no un-escape loop under another name — nothing in its live code inspects a YAML backslash escape');

/* The greps have to be able to fail, or they pin nothing. */
ok(stripComments('/* unyaml() used to live here */').indexOf('unyaml') === -1,
  'the stripper removes a block comment, so prose about the removal does not trip the grep');
ok(stripComments("if (s[i] !== '\\\\') out += s[i];").includes(BACKSLASH_LITERAL),
  'and leaves real code alone, so a reintroduced decoder DOES trip it');

/* ---- 2: the one reader half exists, and is wired ----------------------- */

const markdown = read('markdown.js');
ok(typeof unquoteYaml === 'function', 'markdown.js exports unquoteYaml — the reader half is reachable');
ok(/if \(\/\^".\*"\$\/\.test\(val\)\) val = unquoteYaml\(val\);/.test(markdown),
  'and parseFrontmatter calls it on a quoted scalar, so no caller has to remember to decode');

/* Gated on the value having arrived QUOTED, which is exactly when yamlStr
   wrote it — an unquoted hand-written scalar is nobody's escaped value. */
eq(parseFrontmatter('---\nx: a\\nb\n---\n').fm.x, 'a\\nb',
  'an UNQUOTED scalar is handed back untouched');

/* ---- 3: decoding twice corrupts, so claim 1 guards something ----------- */

/* The second decode, written out here rather than imported, because the whole
   point of this file is that no second copy exists in src/ to import. */
const decodeAgain = (v) => {
  const s = (v ?? '').toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i === s.length - 1) { out += s[i]; continue; }
    const next = s[++i];
    out += next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next;
  }
  return out;
};

const onceOffDisk = (subject) =>
  parseFrontmatter(`---\nnote_subject: ${yamlStr(subject)}\n---\n`).fm.note_subject;

for (const subject of ['Back\\slash', 'path a\\nb', 'Fee "query"', 'Standard Bank\nAccess Bond']) {
  eq(onceOffDisk(subject), subject, `one decode is a true inverse of yamlStr — ${JSON.stringify(subject)}`);
}

eq(decodeAgain(onceOffDisk('Back\\slash')), 'Backslash',
  'a second decode EATS the backslash — the subject stops matching the debt it names');
eq(decodeAgain(onceOffDisk('path a\\nb')), 'path a\nb',
  'and turns two literal characters into a real newline, which is the same defect one turn on');

console.log(`PASS — one YAML decoder, in markdown.js, and note-file.js declares none (${checks} assertions).`);
