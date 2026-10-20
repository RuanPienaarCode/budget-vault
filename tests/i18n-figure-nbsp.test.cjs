'use strict';
/* A figure inside a translated sentence must not break across lines.

   Audit of 20 Oct 2026: on a real vault a signed figure in brackets wrapped
   with its first group on one line and the rest on the next — "(−R 12" /
   "345)", to use made-up figures — and on a phone "R 48" / "000,00". Both
   are the same mechanism. The za locale groups thousands with U+0020 and money puts a
   U+0020 after the symbol, so every gap inside a figure is an ordinary
   breaking space, and a browser is entitled to wrap at any of them. Read
   across a line break, "R 12" is a different number from "R 12 345" — the
   wrap does not just look untidy, it misstates the amount.

   The fix is in src/i18n.js interpolate(): a param VALUE that is, as a whole,
   a figure has its U+0020 spaces replaced with U+00A0. Anything that is not
   wholly a figure — a category name, "3 accounts", a date such as "Oct 21" —
   is left exactly as it was passed in. This suite pins both halves: the shapes
   that must be glued, the shapes that must not be touched, and the end-to-end
   path through t() with a real English key.

   Also pinned: the PDF export's text path still reads a glued figure as
   encodable text (pdf.js normalizeText maps U+00A0 back to a space before the
   WinAnsi check), so the change cannot send an export to the raster path.

     node tests/i18n-figure-nbsp.test.cjs
*/

const assert = require('assert');
const path = require('path');

let checks = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const SRC = path.join(__dirname, '..', 'src');
const i18n = require(path.join(SRC, 'i18n.js'));
const { t, setLanguage, nbspFigure, interpolate } = i18n;

const NB = '\u00a0';
const MINUS = '−';
const show = s => JSON.stringify(s).replace(/\u00a0/g, '␣');

ok(typeof nbspFigure === 'function', 'i18n.nbspFigure is exported');
ok(typeof interpolate === 'function', 'i18n.interpolate is exported');

/* ---- 1. wholly a figure: every U+0020 becomes U+00A0 ---- */
const GLUED = [
  // money, the za shape: symbol, space, grouped digits
  ['R 12 345', `R${NB}12${NB}345`],
  ['R 48 000,00', `R${NB}48${NB}000,00`],
  // a signed part, minus BEFORE the symbol (currency.js formatSigned)
  [`${MINUS}R 12 345`, `${MINUS}R${NB}12${NB}345`],
  // a balance, minus AFTER the symbol (currency.js formatAmount)
  ['R -50,00', `R${NB}-50,00`],
  ['+R 3 922', `+R${NB}3${NB}922`],
  ['€ 640,00', `€${NB}640,00`],
  ['$ 1,234.56', `$${NB}1,234.56`],
  ['¥ 12,000', `¥${NB}12,000`],
  ['Rp 23 800,00', `Rp${NB}23${NB}800,00`],
  ['US$ 1,200.00', `US$${NB}1,200.00`],
  // a conflicted account is labelled by its ISO code (currency.js symbolOf)
  ['USD 1 200,00', `USD${NB}1${NB}200,00`],
  ['kr 300', `kr${NB}300`],
  ['Rs. 1 200', `Rs.${NB}1${NB}200`],
  ['R 0', `R${NB}0`],
  // a grouped number with no symbol
  ['12 345', `12${NB}345`],
  ['1 234 567,89', `1${NB}234${NB}567,89`],
  [`${MINUS}12 345`, `${MINUS}12${NB}345`],
  // a percent with the French-style gap
  ['12 %', `12${NB}%`],
  ['12,5 %', `12,5${NB}%`],
  [`${MINUS}3 %`, `${MINUS}3${NB}%`],
  // already partly glued: finishing the job, never undoing it
  [`R${NB}12 345`, `R${NB}12${NB}345`],
];
for (const [input, want] of GLUED) {
  eq(nbspFigure(input), want, `${show(input)} is a figure and must read ${show(want)}, got ${show(nbspFigure(input))}`);
  eq(nbspFigure(want), want, `${show(want)} is already glued and must be left as it is`);
}

/* ---- 2. not wholly a figure: returned byte-for-byte ---- */
const UNTOUCHED = [
  'Garden and pool',
  '3 accounts',
  'Oct 21',
  'Oct 21, 2027',
  'Mai 21',
  'Jul 23 – Aug 22, 2026',
  'R 1 200 of R 3 000',
  'R 1 200/mo',
  'Groceries 2',
  '2026-10-20',
  'Last 3 months',
  'September 2026',
  '(1 year)',
  '',
  'R',
  '12',
  '1,234.56',
];
for (const input of UNTOUCHED) {
  eq(nbspFigure(input), input, `${show(input)} is not wholly a figure and must be left untouched, got ${show(nbspFigure(input))}`);
}
// Non-strings: a count passed as a number has no space to glue, and is still stringified.
eq(nbspFigure(3), '3', 'a number param is stringified as before');
eq(nbspFigure(1234.5), '1234.5', 'a float param is stringified as before');

/* ---- 3. interpolate: only the figure params are glued ---- */
eq(interpolate('{name}: {amount} over {count} accounts since {date}',
  { name: 'Garden and pool', amount: `${MINUS}R 12 345`, count: 3, date: 'Oct 21' }),
  `Garden and pool: ${MINUS}R${NB}12${NB}345 over 3 accounts since Oct 21`,
  'the figure is glued, the name, count and date are not');
eq(interpolate('Left: {missing}', { amount: 'R 1' }), 'Left: {missing}',
  'an unknown placeholder still stands verbatim');
eq(interpolate('plain', null), 'plain', 'no params returns the string unchanged');

/* ---- 4. end to end through t(), with a real English key ---- */
setLanguage('en');
const note = t('bud.total.incomeNote', { amount: 'R 12 345,00' });
eq(note, `R${NB}12${NB}345,00 received so far`, `t() glues the figure: ${show(note)}`);
ok(!/R 12|12 345/.test(note), 'no breaking space survives inside the figure');
const unnamed = t('bud.unnamed.note', { count: 2, amount: 'R 48 000,00' });
ok(unnamed.includes(`(R${NB}48${NB}000,00 in total)`), `plural entry glues its figure too: ${show(unnamed)}`);
ok(unnamed.startsWith('2 rows in'), 'the sentence around it keeps its ordinary spaces');

/* ---- 5. the PDF text path still encodes a glued figure ---- */
const pdf = require(path.join(SRC, 'pdf.js'));
eq(pdf.normalizeText(note), 'R 12 345,00 received so far', 'pdf normalizeText maps U+00A0 back to a space');
ok(pdf.canEncode(note), 'a glued figure is WinAnsi-encodable, so the export stays vector text, not raster');
ok(pdf.canEncode(t('bud.total.incomeNote', { amount: `${MINUS}R 12 345` })), 'so is a signed one (U+2212 maps to a hyphen)');

/* ---- 6. the iOS 15 floor: no lookbehind in the module that carries the shape ---- */
const fs = require('fs');
ok(!/\(\?<[=!]/.test(fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8')), 'src/i18n.js carries no regex lookbehind');

console.log(`PASS — figures in translated prose are unbreakable (${checks} checks).`);
