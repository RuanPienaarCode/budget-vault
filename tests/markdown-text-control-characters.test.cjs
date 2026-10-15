'use strict';
/* escMdText drops C0 control characters (2026-10-14 audit, L4a-10).

   A NUL in a bank description reached the Markdown exports as a literal NUL
   byte: Obsidian renders nothing for it and a diff or grep tool takes the note
   for binary. The CSV, XLSX and PDF writers had each already dropped the same
   set (csv.js CONTROLS); the Markdown path was the one that kept it. Tab is
   text, LF and CR are line breaks (<br>) and are unchanged.
     node tests/markdown-text-control-characters.test.cjs */

const assert = require('assert');
const { escMdText } = require('../src/markdown');
const { stripControls } = require('../src/csv');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

eq(escMdText('EFT\u0000 REF\u0007 1'), 'EFT REF 1', 'NUL and BEL are dropped');
eq(escMdText('a\u0001b\u0008c\u000Bd\u000Ce\u000Ef\u001Fg'), 'abcdefg', 'every other C0 control is dropped');
eq(escMdText('a\tb'), 'a\tb', 'a tab is kept');
eq(escMdText('a\nb\r\nc\rd'), 'a<br>b<br>c<br>d', 'line breaks still become <br>');
eq(escMdText('x\u0000|y'), 'x&#124;y', 'a control beside a pipe changes nothing else');
eq(escMdText('\u0000[x]\u0000'), '\\[x\\]', 'and a NUL cannot hide an active character from the escaping');
// the same set the CSV path strips, over every code point below the space
for (let c = 0; c < 32; c++) {
  const ch = String.fromCharCode(c);
  const kept = /[\t\n\r]/.test(ch);
  eq(escMdText(`a${ch}b`).includes('\u0000') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(escMdText(`a${ch}b`)), false,
    `U+00${c.toString(16).padStart(2, '0')} leaves no raw control byte`);
  eq(stripControls(`a${ch}b`) === `a${ch}b`, kept, `csv.js agrees on whether U+00${c.toString(16).padStart(2, '0')} is text`);
}
console.log(`PASS — escMdText strips C0 controls like the CSV path (${checks} checks)`);
