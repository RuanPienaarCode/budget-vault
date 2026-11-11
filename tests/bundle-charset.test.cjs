'use strict';
/* THE BUNDLE IS WRITTEN AS UTF-8, AND STAYS VALID UTF-8.

   esbuild's default is to write its output as ASCII, escaping every character
   above U+007E as \uXXXX. That is the right default for a file of unknown
   provenance and the wrong one for this plugin, which carries twelve language
   tables: six bytes for every Devanagari, Japanese or Chinese character that
   UTF-8 stores in three. Measured on the 1.59.0 bundle, lang/hi.js alone was
   354 KB because of it, there were 96,607 such escapes in main.js, and
   `charset: 'utf8'` in esbuild.config.mjs took the bundle from 2,632 KB to
   2,325 KB — 307 KB that every install downloaded, synced and parsed for
   nothing.

   Obsidian reads main.js as UTF-8 text on every platform (it is how the vault
   adapter reads any file), so the escaped and the native spelling evaluate to
   the same strings. What this guards is the setting itself, which is one line
   in a config file and looks optional:

     1. esbuild.config.mjs asks for it;
     2. the bundle really carries its text natively — the languages' own names
        are in it as written, and \uXXXX escapes are down to the handful the
        SOURCE writes on purpose (a no-break space, U+2028, the bidi controls
        the sanitiser names), not one per translated character;
     3. the file is strictly valid UTF-8 with no byte-order mark, so nothing
        that reads it — Obsidian, the release workflow, a sync client — is
        handed a byte sequence it has to guess about;
     4. and it holds no raw U+2028 / U+2029, the two characters that are line
        terminators to a JavaScript parser older than ES2019. esbuild keeps
        those escaped under either charset; this is the tripwire if that ever
        changes.

   That the UTF-8 bundle still EVALUATES is tests/bundle-smoke.test.cjs's job,
   and it runs against the same file.

   Reads the BUILT main.js, so run it after a build:  ./build.sh, or
     npm run build && node tests/bundle-charset.test.cjs */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'main.js');
ok(fs.existsSync(BUNDLE), 'main.js is missing — run ./build.sh first');

/* ---- 1. the build asks for it ---- */
const config = fs.readFileSync(path.join(ROOT, 'esbuild.config.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
ok(/\bcharset:\s*'utf8'/.test(config),
  "esbuild.config.mjs must pass charset: 'utf8' — without it every non-ASCII character in the "
  + 'twelve language tables is written as a six-byte \\uXXXX escape (307 KB on the 1.59.0 bundle)');

/* ---- 3. strictly valid UTF-8, no byte-order mark ---- */
const bytes = fs.readFileSync(BUNDLE);
let text;
assert.doesNotThrow(() => { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); },
  'main.js is not valid UTF-8 — a truncated or re-encoded bundle');
checks++;
ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), 'main.js must not open with a byte-order mark');
ok(!text.includes('\uFFFD'), 'main.js holds no U+FFFD replacement character — the mark of text decoded with the wrong charset somewhere upstream');

/* ---- 2. the text is carried natively ---- */
/* Read from the module the bundle was built from, so a renamed language cannot
   leave this asserting on a string nothing ships. */
const { LANGUAGE_NAMES } = require(path.join(ROOT, 'src', 'i18n.js'));
const nonAscii = Object.entries(LANGUAGE_NAMES).filter(([, name]) => /[^\x00-\x7e]/.test(name));
ok(nonAscii.length >= 5, `several languages are named in a non-Latin or accented script (${nonAscii.length})`);
for (const [code, name] of nonAscii) {
  ok(text.includes(name), `the bundle carries ${code}'s own name as written ("${name}"), not as \\uXXXX escapes`);
}
const escapes = (text.match(/\\u[0-9a-fA-F]{4}/g) || []).length;
ok(escapes < 500,
  `main.js holds ${escapes} \\uXXXX escapes — with charset: 'utf8' only the few the source spells out `
  + 'on purpose remain (35 when this was written, against 96,607 without it)');

/* ---- 4. no raw line/paragraph separator ---- */
ok(!/[\u2028\u2029]/.test(text),
  'main.js holds a raw U+2028 or U+2029 — inside a string literal that is a line terminator to a '
  + 'pre-ES2019 parser. esbuild escapes them; something upstream of it did not');

console.log(`PASS bundle-charset — main.js is UTF-8 as built: ${nonAscii.length} native names present, `
  + `${escapes} escapes left, ${bytes.length} bytes (${checks} checks)`);
